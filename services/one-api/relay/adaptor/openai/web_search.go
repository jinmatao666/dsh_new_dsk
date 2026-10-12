package openai

import (
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

// Marked searches use DashScope because compatible chat completions omit sources.
// Ordinary chat requests retain their configured protocol and response format.
func convertSearchRequest(mode int, request *model.GeneralOpenAIRequest) (any, error) {
	if mode != relaymode.ChatCompletions || request.Stream {
		return nil, errors.New("managed web search requires non-streaming chat completions")
	}
	return map[string]any{
		"model": request.Model,
		"input": map[string]any{"messages": request.Messages},
		"parameters": map[string]any{
			"result_format": "message", "enable_search": true,
			"search_options": map[string]any{"forced_search": true, "enable_source": true},
		},
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
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, endpoint, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+metadata.APIKey)
	searchClient := *client.HTTPClient
	searchClient.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return errors.New("web search upstream redirects are not allowed")
	}
	return searchClient.Do(req)
}

func searchResponse(c *gin.Context, resp *http.Response, modelName string) (*model.ErrorWithStatusCode, *model.Usage) {
	defer resp.Body.Close()
	const maxBytes = 1024 * 1024
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return ErrorWrapper(err, "read_search_response_failed", http.StatusBadGateway), nil
	}
	if len(body) > maxBytes {
		return ErrorWrapper(errors.New("search response exceeded 1 MiB"), "search_response_invalid", http.StatusBadGateway), nil
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
	usage := model.Usage{PromptTokens: result.Usage.Input, CompletionTokens: result.Usage.Output, TotalTokens: result.Usage.Total}
	if usage.TotalTokens == 0 {
		usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	}
	c.JSON(http.StatusOK, struct {
		TextResponse
		SearchInfo json.RawMessage `json:"search_info,omitempty"`
	}{TextResponse: TextResponse{Id: result.RequestID, Model: modelName, Object: "chat.completion", Created: time.Now().Unix(), Choices: result.Output.Choices, Usage: usage}, SearchInfo: result.Output.SearchInfo})
	return nil, &usage
}
