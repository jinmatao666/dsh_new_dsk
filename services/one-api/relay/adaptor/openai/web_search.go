package openai

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/client"
	"github.com/songquanpeng/one-api/relay/meta"
	"github.com/songquanpeng/one-api/relay/model"
	"github.com/songquanpeng/one-api/relay/relaymode"
)

// DashScope's multimodal families require SSE even for text-only web searches.
func multimodalSearch(modelName string) bool {
	name := strings.ToLower(modelName)
	for _, prefix := range []string{"qwen3.5", "qwen3.6", "qwen3.7-plus", "qwen3.7-flash", "qwen3.8"} {
		if name == prefix || strings.HasPrefix(name, prefix+"-") {
			return true
		}
	}
	return strings.HasPrefix(name, "qwen3.7-max-2026-") && name >= "qwen3.7-max-2026-06-08"
}

// Marked searches use DashScope because compatible chat completions omit sources.
// Ordinary chat requests retain their configured protocol and response format.
func convertSearchRequest(mode int, request *model.GeneralOpenAIRequest) (any, error) {
	if mode != relaymode.ChatCompletions || request.Stream {
		return nil, errors.New("managed web search requires non-streaming chat completions")
	}
	messages := request.Messages
	parameters := map[string]any{
		"result_format": "message", "enable_search": true,
		"search_options": map[string]any{"forced_search": true, "enable_source": true},
	}
	if multimodalSearch(request.Model) {
		messages = make([]model.Message, len(request.Messages))
		for i, message := range request.Messages {
			text, ok := message.Content.(string)
			if !ok {
				return nil, errors.New("managed web search requires text messages")
			}
			messages[i] = model.Message{Role: message.Role, Content: []map[string]string{{"text": text}}}
		}
		parameters["incremental_output"] = true
		parameters["enable_thinking"] = false
	}
	return map[string]any{
		"model":      request.Model,
		"input":      map[string]any{"messages": messages},
		"parameters": parameters,
	}, nil
}

func searchRequestURL(base string) (string, error) {
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("web search channel requires a DashScope HTTP base URL without credentials, query or fragment")
	}
	path := strings.TrimRight(u.Path, "/")
	path = strings.TrimSuffix(path, "/compatible-mode/v1")
	path = strings.TrimSuffix(path, "/api/v1")
	u.Path = path + "/api/v1/services/aigc/text-generation/generation"
	u.RawPath = ""
	return u.String(), nil
}

func (a *Adaptor) doSearchRequest(c *gin.Context, metadata *meta.Meta, body io.Reader) (*http.Response, error) {
	endpoint, err := searchRequestURL(metadata.BaseURL)
	if err != nil {
		return nil, err
	}
	if multimodalSearch(metadata.ActualModelName) {
		endpoint = strings.Replace(endpoint, "/aigc/text-generation/", "/aigc/multimodal-generation/", 1)
	}
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, endpoint, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+metadata.APIKey)
	if multimodalSearch(metadata.ActualModelName) {
		req.Header.Set("X-DashScope-SSE", "enable")
		req.Header.Set("Accept", "text/event-stream")
	}
	searchClient := *client.HTTPClient
	searchClient.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return errors.New("web search upstream redirects are not allowed")
	}
	return searchClient.Do(req)
}

func searchResponse(c *gin.Context, resp *http.Response, modelName string) (*model.ErrorWithStatusCode, *model.Usage) {
	defer resp.Body.Close()
	var body []byte
	var err error
	if resp.StatusCode == http.StatusOK && strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		body, err = aggregateSearchStream(resp.Body)
		if err != nil {
			return ErrorWrapper(err, "search_stream_invalid", http.StatusBadGateway), nil
		}
	} else {
		body, err = io.ReadAll(io.LimitReader(resp.Body, maxSearchResponseBytes+1))
		if err != nil {
			return ErrorWrapper(err, "read_search_response_failed", http.StatusBadGateway), nil
		}
		if len(body) > maxSearchResponseBytes {
			return ErrorWrapper(errors.New("search response exceeded 1 MiB"), "search_response_invalid", http.StatusBadGateway), nil
		}
	}
	var result struct {
		RequestID string `json:"request_id"`
		Code      string `json:"code"`
		Message   string `json:"message"`
		Output    struct {
			Choices    []TextResponseChoice `json:"choices"`
			SearchInfo json.RawMessage      `json:"search_info"`
		} `json:"output"`
		Usage struct {
			Input  int `json:"input_tokens"`
			Output int `json:"output_tokens"`
			Total  int `json:"total_tokens"`
		} `json:"usage"`
	}
	if err = json.Unmarshal(body, &result); err != nil {
		return ErrorWrapper(err, "search_response_invalid", http.StatusBadGateway), nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || result.Code != "" {
		status := resp.StatusCode
		if status >= 200 && status < 300 {
			status = http.StatusBadGateway
		}
		return ErrorWrapper(errors.New("DashScope web search failed: "+result.Code+" "+result.Message), "search_upstream_failed", status), nil
	}
	if len(result.Output.Choices) == 0 {
		return ErrorWrapper(errors.New("DashScope returned no search answer"), "search_response_invalid", http.StatusBadGateway), nil
	}
	for i := range result.Output.Choices {
		text, err := searchContentText(result.Output.Choices[i].Content)
		if err != nil {
			return ErrorWrapper(err, "search_response_invalid", http.StatusBadGateway), nil
		}
		result.Output.Choices[i].Content = text
	}
	usage := model.Usage{PromptTokens: result.Usage.Input, CompletionTokens: result.Usage.Output, TotalTokens: result.Usage.Total}
	if usage.TotalTokens == 0 {
		usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	}
	response, err := json.Marshal(struct {
		TextResponse
		SearchInfo json.RawMessage `json:"search_info,omitempty"`
	}{TextResponse: TextResponse{Id: result.RequestID, Model: modelName, Object: "chat.completion", Created: time.Now().Unix(), Choices: result.Output.Choices, Usage: usage}, SearchInfo: result.Output.SearchInfo})
	if err != nil || len(response) > maxSearchResponseBytes {
		return ErrorWrapper(errors.New("normalized search response exceeded 1 MiB or could not be encoded"), "search_response_invalid", http.StatusBadGateway), nil
	}
	c.Data(http.StatusOK, "application/json; charset=utf-8", response)
	return nil, &usage
}

func searchContentText(content any) (string, error) {
	if content == nil {
		return "", nil
	}
	if text, ok := content.(string); ok {
		return text, nil
	}
	blocks, ok := content.([]any)
	if !ok {
		return "", errors.New("invalid search answer content")
	}
	var text strings.Builder
	for _, block := range blocks {
		item, ok := block.(map[string]any)
		if !ok {
			return "", errors.New("invalid search answer block")
		}
		if value, ok := item["text"].(string); ok {
			text.WriteString(value)
		}
	}
	return text.String(), nil
}

// Repeated source metadata counts toward wire traffic, not the final answer budget.
const (
	maxSearchResponseBytes = 1024 * 1024
	maxSearchWireBytes     = 32 * 1024 * 1024
	maxSearchFrameBytes    = 256 * 1024
	maxSearchAnswerBytes   = 128 * 1024
	maxSearchSourceBytes   = 128 * 1024
	maxSearchSources       = 64
)

// Accumulate incremental text, cumulative usage and sources from every SSE frame.
// Never return a partial answer after an upstream error or an unfinished stream.
func aggregateSearchStream(reader io.Reader) ([]byte, error) {
	var answer strings.Builder
	var requestID, finishReason string
	var usage map[string]any
	sources := []any{}
	seen := map[string]bool{}
	sourceBytes := 0
	consume := func(data string) error {
		if data == "" || data == "[DONE]" {
			return nil
		}
		var frame struct {
			RequestID string `json:"request_id"`
			Code      string `json:"code"`
			Message   string `json:"message"`
			Output    struct {
				Choices    []TextResponseChoice `json:"choices"`
				SearchInfo struct {
					Results []any `json:"search_results"`
				} `json:"search_info"`
			} `json:"output"`
			Usage map[string]any `json:"usage"`
		}
		if err := json.Unmarshal([]byte(data), &frame); err != nil {
			return err
		}
		if frame.Code != "" {
			return errors.New("DashScope web search failed: " + frame.Code + " " + frame.Message)
		}
		if frame.RequestID != "" {
			requestID = frame.RequestID
		}
		if frame.Usage != nil {
			usage = frame.Usage
		}
		if len(frame.Output.Choices) > 0 {
			choice := frame.Output.Choices[0]
			text, err := searchContentText(choice.Content)
			if err != nil {
				return err
			}
			if len(text) > maxSearchAnswerBytes-answer.Len() {
				return errors.New("search answer exceeded 128 KiB")
			}
			answer.WriteString(text)
			if choice.FinishReason != "" && choice.FinishReason != "null" {
				finishReason = choice.FinishReason
			}
		}
		for _, source := range frame.Output.SearchInfo.Results {
			encoded, err := json.Marshal(source)
			if err != nil {
				return err
			}
			key := string(encoded)
			if item, ok := source.(map[string]any); ok {
				if url, ok := item["url"].(string); ok && url != "" {
					key = "url:" + url
				}
			}
			if !seen[key] {
				if len(sources) >= maxSearchSources || len(encoded) > maxSearchSourceBytes-sourceBytes {
					return errors.New("search sources exceeded 64 entries or 128 KiB")
				}
				sources = append(sources, source)
				seen[key] = true
				sourceBytes += len(encoded)
			}
		}
		return nil
	}
	limited := &io.LimitedReader{R: reader, N: maxSearchWireBytes + 1}
	scanner := bufio.NewScanner(limited)
	scanner.Buffer(make([]byte, 4096), maxSearchFrameBytes+1)
	var data []string
	frameBytes := 0
	for scanner.Scan() {
		line := scanner.Text()
		if limited.N == 0 {
			return nil, errors.New("search stream exceeded 32 MiB")
		}
		frameBytes += len(line) + 1
		if frameBytes > maxSearchFrameBytes {
			return nil, errors.New("search SSE frame exceeded 256 KiB")
		}
		if line == "" {
			if err := consume(strings.Join(data, "\n")); err != nil {
				return nil, err
			}
			data = nil
			frameBytes = 0
		} else if strings.HasPrefix(line, "data:") {
			data = append(data, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if limited.N == 0 {
		return nil, errors.New("search stream exceeded 32 MiB")
	}
	if err := consume(strings.Join(data, "\n")); err != nil {
		return nil, err
	}
	if finishReason == "" || answer.Len() == 0 {
		return nil, errors.New("DashScope search stream ended without a completed answer")
	}
	return json.Marshal(map[string]any{
		"request_id": requestID, "usage": usage,
		"output": map[string]any{
			"choices":     []TextResponseChoice{{Message: model.Message{Role: "assistant", Content: answer.String()}, FinishReason: finishReason}},
			"search_info": map[string]any{"search_results": sources},
		},
	})
}
