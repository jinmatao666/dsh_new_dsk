package ragflow

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"time"
)

const maxResponseBytes = 16 << 20

// Client keeps the RAGFlow API key on the server.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

type envelope struct {
	Code    int             `json:"code"`
	Data    json.RawMessage `json:"data"`
	Message string          `json:"message"`
}

// Dataset is the subset of RAGFlow dataset metadata owned by OneAPI.
type Dataset struct {
	Id   string `json:"id"`
	Name string `json:"name"`
}

// Document is the subset displayed by the desktop knowledge page.
type Document struct {
	Id         string  `json:"id"`
	Name       string  `json:"name"`
	Location   string  `json:"location"`
	Size       int64   `json:"size"`
	Run        string  `json:"run"`
	Progress   float64 `json:"progress"`
	ChunkCount int64   `json:"chunk_count"`
	CreateTime int64   `json:"create_time"`
	UpdateTime int64   `json:"update_time"`
}

// Chunk is one parsed piece of a document.
type Chunk struct {
	Id      string `json:"id"`
	Content string `json:"content"`
}

// Completion is a non-streaming knowledge answer with source metadata.
type Completion struct {
	Answer    string          `json:"answer"`
	Reference json.RawMessage `json:"reference"`
	SessionId string          `json:"session_id"`
}

// SessionMessage is one turn stored inside a RAGFlow chat session.
// RAGFlow list-sessions attaches per-assistant `reference` chunk lists; NormalizeSessionHistory
// turns those into desktop `citations` and clears the raw reference before returning.
type SessionMessage struct {
	Role      string          `json:"role"`
	Content   string          `json:"content"`
	Reference json.RawMessage `json:"reference,omitempty"`
	Citations []Citation      `json:"citations,omitempty"`
}

// NewFromEnvironment resolves deployment-owned RAGFlow connection settings.
func NewFromEnvironment() (*Client, error) {
	rawURL := strings.TrimRight(strings.TrimSpace(os.Getenv("RAGFLOW_BASE_URL")), "/")
	apiKey := strings.TrimSpace(os.Getenv("RAGFLOW_API_KEY"))
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, errors.New("RAGFLOW_BASE_URL 未配置或无效")
	}
	if apiKey == "" {
		return nil, errors.New("RAGFLOW_API_KEY 未配置")
	}
	return &Client{baseURL: rawURL, apiKey: apiKey, http: &http.Client{Timeout: 90 * time.Second}}, nil
}

func (c *Client) request(ctx context.Context, method, endpoint, contentType string, body io.Reader, result interface{}) error {
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+endpoint, body)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+c.apiKey)
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	response, err := c.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return err
	}
	if len(data) > maxResponseBytes {
		return errors.New("RAGFlow 响应过大")
	}
	var wrapped envelope
	if err := json.Unmarshal(data, &wrapped); err != nil {
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return fmt.Errorf("RAGFlow 请求失败（HTTP %d）", response.StatusCode)
		}
		return errors.New("RAGFlow 响应无效")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 || wrapped.Code != 0 {
		message := wrapped.Message
		if message == "" {
			message = string(data)
		}
		if message == "" {
			message = fmt.Sprintf("请求失败（HTTP %d）", response.StatusCode)
		}
		return fmt.Errorf("RAGFlow：%s", mapRagflowMessage(message))
	}
	if result == nil {
		return nil
	}
	if err := json.Unmarshal(wrapped.Data, result); err != nil {
		return errors.New("RAGFlow 响应字段无效")
	}
	return nil
}

func jsonBody(value interface{}) (io.Reader, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

// Retrieval stays below Elasticsearch nested-clause limits that RAGFlow hybrid search can hit.
func chatPrompt(datasetId string) map[string]interface{} {
	return map[string]interface{}{
		"similarity_threshold":       0.2,
		"keywords_similarity_weight": 0.3,
		"top_n":                      6,
		"top_k":                      512,
		"rerank_model":               "",
		"empty_response":             "知识库中未找到相关内容。",
		"show_quote":                 true,
		"variables":                  []map[string]interface{}{{"key": "knowledge", "optional": true}},
		"prompt": "你是知识库助手。仅依据下列知识用纯文本回答用户问题；禁止 Markdown、加粗、标题符号与代码围栏；可用普通编号列表；知识不足时明确说明。" +
			"引用知识时，在相关句末标注 ##i$$，其中 i 为知识片段从 0 开始的序号；不要输出其它引用格式。" +
			"\n知识：\n{knowledge}\n以上是知识。",
		"dataset_ids": []string{datasetId},
	}
}

func chatPayload(name, datasetId, model string) map[string]interface{} {
	payload := map[string]interface{}{
		"name":        name,
		"dataset_ids": []string{datasetId},
		"prompt":      chatPrompt(datasetId),
	}
	if model != "" {
		payload["llm"] = map[string]string{"model_name": model}
	}
	return payload
}

func mapRagflowMessage(message string) string {
	if strings.Contains(message, "too_many_nested_clauses") || strings.Contains(message, "maxClauseCount") {
		return "知识库检索条件过多，请缩短问题或减少资料后再试；若仍失败，请管理员提高 Elasticsearch 的 indices.query.bool.max_clause_count"
	}
	lower := strings.ToLower(message)
	if strings.Contains(lower, "do not own the chat") || strings.Contains(lower, "don't own the chat") ||
		strings.Contains(lower, "not own the chat") {
		return "知识库对话已失效，正在重新建立"
	}
	return message
}

// TooManyNestedClauses reports whether RAGFlow failed on Elasticsearch clause limits.
func TooManyNestedClauses(err error) bool {
	if err == nil {
		return false
	}
	text := err.Error()
	return strings.Contains(text, "too_many_nested_clauses") ||
		strings.Contains(text, "maxClauseCount") ||
		strings.Contains(text, "知识库检索条件过多")
}

// ChatOwnershipLost reports whether the local chat mapping is no longer owned by this API key.
func ChatOwnershipLost(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "do not own the chat") ||
		strings.Contains(text, "don't own the chat") ||
		strings.Contains(text, "not own the chat") ||
		strings.Contains(text, "知识库对话已失效")
}

// CreateDataset creates one RAGFlow dataset.
func (c *Client) CreateDataset(ctx context.Context, name, description string) (Dataset, error) {
	body, _ := jsonBody(map[string]interface{}{"name": name, "description": description})
	var dataset Dataset
	err := c.request(ctx, http.MethodPost, "/api/v1/datasets", "application/json", body, &dataset)
	return dataset, err
}

// DeleteDataset compensates a failed local database insert.
func (c *Client) DeleteDataset(ctx context.Context, id string) error {
	body, _ := jsonBody(map[string]interface{}{"ids": []string{id}})
	return c.request(ctx, http.MethodDelete, "/api/v1/datasets", "application/json", body, nil)
}

// ListDocuments lists the first page of files in one dataset (up to 100).
func (c *Client) ListDocuments(ctx context.Context, datasetId string) ([]Document, error) {
	docs, _, err := c.ListDocumentsPage(ctx, datasetId, 1, 100, "")
	return docs, err
}

// ListDocumentsPage lists one page of files. keywords matches document titles in RAGFlow.
func (c *Client) ListDocumentsPage(ctx context.Context, datasetId string, page, pageSize int, keywords string) ([]Document, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 30
	}
	if pageSize > 100 {
		pageSize = 100
	}
	var result struct {
		Docs          []Document `json:"docs"`
		Total         int        `json:"total"`
		TotalDatasets int        `json:"total_datasets"`
	}
	query := url.Values{}
	query.Set("page", strconv.Itoa(page))
	query.Set("page_size", strconv.Itoa(pageSize))
	query.Set("orderby", "update_time")
	query.Set("desc", "true")
	if trimmed := strings.TrimSpace(keywords); trimmed != "" {
		query.Set("keywords", trimmed)
	}
	endpoint := "/api/v1/datasets/" + url.PathEscape(datasetId) + "/documents?" + query.Encode()
	if err := c.request(ctx, http.MethodGet, endpoint, "", nil, &result); err != nil {
		return nil, 0, err
	}
	total := result.Total
	if total == 0 {
		total = result.TotalDatasets
	}
	if total == 0 && len(result.Docs) > 0 {
		total = (page-1)*pageSize + len(result.Docs)
	}
	return result.Docs, total, nil
}

// DeleteDocuments removes files from one dataset.
func (c *Client) DeleteDocuments(ctx context.Context, datasetId string, ids []string) error {
	body, _ := jsonBody(map[string]interface{}{"ids": ids})
	return c.request(ctx, http.MethodDelete, "/api/v1/datasets/"+url.PathEscape(datasetId)+"/documents",
		"application/json", body, nil)
}

// ParseDocuments starts asynchronous chunking for the given documents.
func (c *Client) ParseDocuments(ctx context.Context, datasetId string, ids []string) error {
	body, _ := jsonBody(map[string]interface{}{"document_ids": ids})
	return c.request(ctx, http.MethodPost, "/api/v1/datasets/"+url.PathEscape(datasetId)+"/chunks",
		"application/json", body, nil)
}

// ListChunks returns every parsed text chunk for one document.
// RAGFlow paginates GET .../documents/{id}/chunks (default page_size 30); this walks pages until total.
func (c *Client) ListChunks(ctx context.Context, datasetId, documentId string) ([]Chunk, error) {
	const pageSize = 100
	base := "/api/v1/datasets/" + url.PathEscape(datasetId) + "/documents/" + url.PathEscape(documentId) + "/chunks"
	var all []Chunk
	for page := 1; ; page++ {
		var result struct {
			Chunks []Chunk `json:"chunks"`
			Total  int     `json:"total"`
		}
		endpoint := fmt.Sprintf("%s?page=%d&page_size=%d", base, page, pageSize)
		if err := c.request(ctx, http.MethodGet, endpoint, "", nil, &result); err != nil {
			return nil, err
		}
		all = append(all, result.Chunks...)
		if len(result.Chunks) == 0 {
			break
		}
		if result.Total > 0 {
			if len(all) >= result.Total {
				break
			}
			continue
		}
		if len(result.Chunks) < pageSize {
			break
		}
	}
	return all, nil
}

const maxDownloadBytes = 20 << 20

// DownloadDocument reads one original file. RAGFlow returns the bytes directly, not the JSON envelope.
func (c *Client) DownloadDocument(ctx context.Context, datasetId, documentId string) (string, []byte, error) {
	endpoint := c.baseURL + "/api/v1/datasets/" + url.PathEscape(datasetId) + "/documents/" + url.PathEscape(documentId)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", nil, err
	}
	request.Header.Set("Authorization", "Bearer "+c.apiKey)
	response, err := c.http.Do(request)
	if err != nil {
		return "", nil, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxDownloadBytes+1))
	if err != nil {
		return "", nil, err
	}
	if len(data) > maxDownloadBytes {
		return "", nil, errors.New("文件超过 20MB，无法下载")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", nil, fmt.Errorf("RAGFlow 请求失败（HTTP %d）", response.StatusCode)
	}
	contentType := response.Header.Get("Content-Type")
	if strings.Contains(strings.ToLower(contentType), "json") {
		var wrapped envelope
		message := "RAGFlow 未返回文件内容"
		if json.Unmarshal(data, &wrapped) == nil && wrapped.Message != "" {
			message = wrapped.Message
		}
		return "", nil, fmt.Errorf("RAGFlow：%s", message)
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	return contentType, data, nil
}

// SplitDocumentUploadPath returns the sanitized parent folder and base file name.
// parentPath may come from an explicit form field; otherwise directory segments in filename are used.
func SplitDocumentUploadPath(filename, parentPath string) (string, string) {
	filename = strings.TrimSpace(strings.ReplaceAll(filename, "\\", "/"))
	parentPath = strings.TrimSpace(strings.ReplaceAll(parentPath, "\\", "/"))
	base := path.Base(filename)
	if base == "." || base == "/" || base == "" {
		base = filename
	}
	if parentPath == "" {
		dir := path.Dir(filename)
		if dir != "." && dir != "/" && dir != "" {
			parentPath = strings.Trim(dir, "/")
		}
	}
	return sanitizeParentPath(parentPath), base
}

func sanitizeParentPath(raw string) string {
	raw = strings.Trim(strings.ReplaceAll(raw, "\\", "/"), "/")
	if raw == "" {
		return ""
	}
	parts := strings.Split(raw, "/")
	clean := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" || part == "." {
			continue
		}
		if part == ".." || strings.ContainsRune(part, 0) {
			continue
		}
		clean = append(clean, part)
	}
	joined := strings.Join(clean, "/")
	if len([]rune(joined)) > 500 {
		return ""
	}
	return joined
}

// UploadDocument streams one uploaded file to RAGFlow.
// When parentPath or filename includes directories, the relative path is preserved for desktop folder display.
func (c *Client) UploadDocument(ctx context.Context, datasetId, filename string, source io.Reader, parentPath string) ([]Document, error) {
	parent, base := SplitDocumentUploadPath(filename, parentPath)
	var payload bytes.Buffer
	writer := multipart.NewWriter(&payload)
	if parent != "" {
		if err := writer.WriteField("parent_path", parent); err != nil {
			return nil, err
		}
	}
	if _, err := writer.CreateFormFile("file", base); err != nil {
		return nil, err
	}
	headerLength := payload.Len()
	if err := writer.Close(); err != nil {
		return nil, err
	}
	// Only multipart framing is buffered; file bytes flow directly from the source.
	body := io.MultiReader(bytes.NewReader(payload.Bytes()[:headerLength]), source,
		bytes.NewReader(payload.Bytes()[headerLength:]))
	uploadClient := *c
	httpClient := *c.http
	httpClient.Timeout = 30 * time.Minute
	uploadClient.http = &httpClient
	var documents []Document
	err := uploadClient.request(ctx, http.MethodPost, "/api/v1/datasets/"+url.PathEscape(datasetId)+"/documents",
		writer.FormDataContentType(), body, &documents)
	if err != nil || parent == "" {
		return documents, err
	}
	relative := parent + "/" + base
	for index := range documents {
		if documents[index].Id == "" {
			continue
		}
		if documents[index].Name != relative {
			if updateErr := c.UpdateDocument(ctx, datasetId, documents[index].Id, map[string]interface{}{"name": relative}); updateErr == nil {
				documents[index].Name = relative
			}
		}
		if documents[index].Location == "" || documents[index].Location == base {
			documents[index].Location = relative
		}
	}
	return documents, nil
}

// UpdateDocument patches mutable RAGFlow document fields such as display name.
func (c *Client) UpdateDocument(ctx context.Context, datasetId, documentId string, fields map[string]interface{}) error {
	body, err := jsonBody(fields)
	if err != nil {
		return err
	}
	return c.request(ctx, http.MethodPatch,
		"/api/v1/datasets/"+url.PathEscape(datasetId)+"/documents/"+url.PathEscape(documentId),
		"application/json", body, nil)
}

// CreateChat creates a conversation-owned assistant with bounded retrieval settings.
func (c *Client) CreateChat(ctx context.Context, name, datasetId, model string) (Dataset, error) {
	body, _ := jsonBody(chatPayload(name, datasetId, model))
	var chat Dataset
	err := c.request(ctx, http.MethodPost, "/api/v1/chats", "application/json", body, &chat)
	return chat, err
}

// CreateSession creates the RAGFlow chat session paired with a local conversation.
func (c *Client) CreateSession(ctx context.Context, chatId, name string) (Dataset, error) {
	body, _ := jsonBody(map[string]string{"name": name})
	var session Dataset
	err := c.request(ctx, http.MethodPost, "/api/v1/chats/"+url.PathEscape(chatId)+"/sessions",
		"application/json", body, &session)
	return session, err
}

// ListSessionMessages returns the user and assistant turns stored for one session.
func (c *Client) ListSessionMessages(ctx context.Context, chatId, sessionId string) ([]SessionMessage, error) {
	var sessions []struct {
		Id       string           `json:"id"`
		Messages []SessionMessage `json:"messages"`
	}
	endpoint := "/api/v1/chats/" + url.PathEscape(chatId) + "/sessions?page=1&page_size=1&id=" + url.QueryEscape(sessionId)
	if err := c.request(ctx, http.MethodGet, endpoint, "", nil, &sessions); err != nil {
		return nil, err
	}
	if len(sessions) == 0 {
		return []SessionMessage{}, nil
	}
	return NormalizeSessionHistory(sessions[0].Messages), nil
}

// NormalizeSessionHistory keeps non-empty user/assistant turns and drops the leading assistant prologue.
// Assistant turns keep citation markers in content and attach ParseCitations from the stored reference.
func NormalizeSessionHistory(messages []SessionMessage) []SessionMessage {
	out := make([]SessionMessage, 0, len(messages))
	started := false
	for _, message := range messages {
		role := strings.TrimSpace(message.Role)
		content := strings.TrimSpace(message.Content)
		if role == "assistant" {
			content = PlainTextAnswer(content)
		}
		if content == "" || (role != "user" && role != "assistant") {
			continue
		}
		if !started {
			if role != "user" {
				continue
			}
			started = true
		}
		next := SessionMessage{Role: role, Content: content}
		if role == "assistant" {
			reference := message.Reference
			if len(bytesTrim(reference)) > 0 {
				citations := ParseCitations(reference, content)
				if len(citations) > 0 {
					next.Citations = citations
				}
			}
		}
		out = append(out, next)
	}
	return out
}

// UpdateChat switches the assistant's dataset or model and keeps retrieval within ES clause limits.
func (c *Client) UpdateChat(ctx context.Context, chatId, datasetId, model string) error {
	payload := map[string]interface{}{
		"dataset_ids": []string{datasetId},
		"prompt":      chatPrompt(datasetId),
	}
	if model != "" {
		payload["llm"] = map[string]string{"model_name": model}
	}
	body, _ := jsonBody(payload)
	return c.request(ctx, http.MethodPut, "/api/v1/chats/"+url.PathEscape(chatId), "application/json", body, nil)
}

// Complete asks a question through the conversation-owned assistant.
func (c *Client) Complete(ctx context.Context, chatId, sessionId, question string) (Completion, error) {
	body, _ := jsonBody(map[string]interface{}{"question": question, "session_id": sessionId, "stream": false})
	var completion Completion
	err := c.request(ctx, http.MethodPost, "/api/v1/chats/"+url.PathEscape(chatId)+"/completions",
		"application/json", body, &completion)
	if err == nil {
		completion.Answer = PlainTextAnswer(completion.Answer)
	}
	return completion, err
}

// CompleteStream asks through the conversation-owned assistant and emits cumulative plain-text answers.
// emit receives the latest full answer so far; reference is set when RAGFlow includes source chunks;
// the final call sets done to true.
func (c *Client) CompleteStream(ctx context.Context, chatId, sessionId, question string,
	emit func(answer string, reference json.RawMessage, done bool) error) error {
	body, err := jsonBody(map[string]interface{}{"question": question, "session_id": sessionId, "stream": true})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/api/v1/chats/"+url.PathEscape(chatId)+"/completions", body)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+c.apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")
	streamClient := &http.Client{Timeout: 5 * time.Minute}
	response, err := streamClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		message := strings.TrimSpace(string(data))
		if message == "" {
			message = fmt.Sprintf("请求失败（HTTP %d）", response.StatusCode)
		}
		return fmt.Errorf("RAGFlow：%s", mapRagflowMessage(message))
	}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), maxResponseBytes)
	lastAnswer := ""
	var lastReference json.RawMessage
	finished := false
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}
		var wrapped envelope
		if err := json.Unmarshal([]byte(payload), &wrapped); err != nil {
			return errors.New("RAGFlow 流式响应无效")
		}
		if wrapped.Code != 0 {
			message := wrapped.Message
			if message == "" {
				message = payload
			}
			return fmt.Errorf("RAGFlow：%s", mapRagflowMessage(message))
		}
		trimmed := bytes.TrimSpace(wrapped.Data)
		if bytes.Equal(trimmed, []byte("true")) {
			finished = true
			if err := emit(lastAnswer, lastReference, true); err != nil {
				return err
			}
			return nil
		}
		var completion Completion
		if err := json.Unmarshal(wrapped.Data, &completion); err != nil {
			return errors.New("RAGFlow 流式响应字段无效")
		}
		lastAnswer = PlainTextAnswer(completion.Answer)
		if len(bytes.TrimSpace(completion.Reference)) > 0 && string(bytes.TrimSpace(completion.Reference)) != "null" {
			lastReference = completion.Reference
		}
		if err := emit(lastAnswer, lastReference, false); err != nil {
			return err
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	if !finished {
		if lastAnswer == "" {
			return errors.New("RAGFlow 流式响应未完成")
		}
		return emit(lastAnswer, lastReference, true)
	}
	return nil
}

// Recommend calls the deployment's API-key-compatible related-question endpoint.
func (c *Client) Recommend(ctx context.Context, question string) ([]string, error) {
	body, _ := jsonBody(map[string]string{"question": question})
	var questions []string
	err := c.request(ctx, http.MethodPost, "/api/v1/chat/recommandation", "application/json", body, &questions)
	return questions, err
}
