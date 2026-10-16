package ali

import (
	"bufio"
	"encoding/json"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/common/render"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/helper"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	"github.com/songquanpeng/one-api/relay/model"
)

// https://help.aliyun.com/document_detail/613695.html?spm=a2c4g.2399480.0.0.1adb778fAdzP9w#341800c0f8w0r

const EnableSearchModelSuffix = "-internet"

func ConvertRequest(request model.GeneralOpenAIRequest) *ChatRequest {
	messages := make([]Message, 0, len(request.Messages))
	for i := 0; i < len(request.Messages); i++ {
		message := request.Messages[i]
		messages = append(messages, Message{
			Content: message.StringContent(),
			Role:    strings.ToLower(message.Role),
		})
	}
	enableSearch := false
	aliModel := request.Model
	if strings.HasSuffix(aliModel, EnableSearchModelSuffix) {
		enableSearch = true
		aliModel = strings.TrimSuffix(aliModel, EnableSearchModelSuffix)
	}
	request.TopP = helper.Float64PtrMax(request.TopP, 0.9999)
	return &ChatRequest{
		Model: aliModel,
		Input: Input{
			Messages: messages,
		},
		Parameters: Parameters{
			EnableSearch:      enableSearch,
			IncrementalOutput: request.Stream,
			Seed:              uint64(request.Seed),
			MaxTokens:         request.MaxTokens,
			Temperature:       request.Temperature,
			TopP:              request.TopP,
			TopK:              request.TopK,
			ResultFormat:      "message",
			Tools:             request.Tools,
		},
	}
}

func ConvertEmbeddingRequest(request model.GeneralOpenAIRequest) *EmbeddingRequest {
	return &EmbeddingRequest{
		Model: request.Model,
		Input: struct {
			Texts []string `json:"texts"`
		}{
			Texts: request.ParseInput(),
		},
	}
}

func ConvertImageRequest(request model.ImageRequest) *ImageRequest {
	var imageRequest ImageRequest
	imageRequest.Input.Prompt = request.Prompt
	imageRequest.Model = request.Model
	imageRequest.Parameters.N = request.N
	imageRequest.ResponseFormat = request.ResponseFormat

	if request.IsImageEdit() {
		// 图像编辑（wanx2.1-imageedit）：映射 function 与编辑参数，不传 size（由原图决定）。
		imageRequest.Input.Function = request.Function
		imageRequest.Input.BaseImageURL = request.Image
		imageRequest.Input.MaskImageURL = request.Mask
		imageRequest.Parameters.Strength = request.Strength
		imageRequest.Parameters.UpscaleFactor = request.UpscaleFactor
		imageRequest.Parameters.TopScale = request.TopScale
		imageRequest.Parameters.BottomScale = request.BottomScale
		imageRequest.Parameters.LeftScale = request.LeftScale
		imageRequest.Parameters.RightScale = request.RightScale
	} else {
		// 文生图：保留原有 size 映射（x → *）。
		imageRequest.Parameters.Size = strings.Replace(request.Size, "x", "*", -1)
	}

	return &imageRequest
}

// ConvertWan27ImageRequest：把通用 ImageRequest 转成 wan2.7 的 multimodal 同步请求体。
// 原图放进 messages[0].content 的 image 字段，指令放 text 字段，纯自然语言、无 mask/function。
func ConvertWan27ImageRequest(request model.ImageRequest) *Wan27ImageRequest {
	var req Wan27ImageRequest
	req.Model = request.Model
	content := make([]Wan27Content, 0, 3)
	// 多图参考（合成/融合）优先；无 Images 时回落单张 Image。两者都放进 content 的
	// image block（wan2.7 multimodal 按数组顺序理解，实测支持多张），指令放 text。
	if len(request.Images) > 0 {
		for _, img := range request.Images {
			if img != "" {
				content = append(content, Wan27Content{Image: img})
			}
		}
	} else if request.Image != "" {
		content = append(content, Wan27Content{Image: request.Image})
	}
	content = append(content, Wan27Content{Text: request.Prompt})
	req.Input.Messages = []Wan27Message{{Role: "user", Content: content}}
	// size：
	//   - 有参考图（改图/合成）：忽略像素尺寸，用档位（默认 2K）以保持参考图比例。
	//     上游 getImageRequest 会把空 size 注入成 "1024x1024"，若直接透传会强制方形、丢掉参考图
	//     比例（实测竖图参考 + 1024*1024 → 输出方形；改用 2K 档位 → 跟随参考图 0.667 比例）。
	//     仅当调用方显式给档位（1K/2K/4K）时尊重其档位。
	//   - 纯文生图（无参考图）：透传调用方像素尺寸（WxH → W*H）；未指定默认 2K。
	hasRef := len(request.Images) > 0 || request.Image != ""
	switch {
	case hasRef:
		if request.Size == "1K" || request.Size == "2K" || request.Size == "4K" {
			req.Parameters.Size = request.Size
		} else {
			req.Parameters.Size = "2K"
		}
	case request.Size != "":
		req.Parameters.Size = strings.Replace(request.Size, "x", "*", -1)
	default:
		req.Parameters.Size = "2K"
	}
	if request.N > 0 {
		req.Parameters.N = request.N
	}
	return &req
}

func EmbeddingHandler(c *gin.Context, resp *http.Response) (*model.ErrorWithStatusCode, *model.Usage) {
	var aliResponse EmbeddingResponse
	err := json.NewDecoder(resp.Body).Decode(&aliResponse)
	if err != nil {
		return openai.ErrorWrapper(err, "unmarshal_response_body_failed", http.StatusInternalServerError), nil
	}

	err = resp.Body.Close()
	if err != nil {
		return openai.ErrorWrapper(err, "close_response_body_failed", http.StatusInternalServerError), nil
	}

	if aliResponse.Code != "" {
		return &model.ErrorWithStatusCode{
			Error: model.Error{
				Message: aliResponse.Message,
				Type:    aliResponse.Code,
				Param:   aliResponse.RequestId,
				Code:    aliResponse.Code,
			},
			StatusCode: resp.StatusCode,
		}, nil
	}
	requestModel := c.GetString(ctxkey.RequestModel)
	fullTextResponse := embeddingResponseAli2OpenAI(&aliResponse)
	fullTextResponse.Model = requestModel
	jsonResponse, err := json.Marshal(fullTextResponse)
	if err != nil {
		return openai.ErrorWrapper(err, "marshal_response_body_failed", http.StatusInternalServerError), nil
	}
	c.Writer.Header().Set("Content-Type", "application/json")
	c.Writer.WriteHeader(resp.StatusCode)
	_, err = c.Writer.Write(jsonResponse)
	return nil, &fullTextResponse.Usage
}

func embeddingResponseAli2OpenAI(response *EmbeddingResponse) *openai.EmbeddingResponse {
	openAIEmbeddingResponse := openai.EmbeddingResponse{
		Object: "list",
		Data:   make([]openai.EmbeddingResponseItem, 0, len(response.Output.Embeddings)),
		Model:  "text-embedding-v1",
		Usage:  model.Usage{TotalTokens: response.Usage.TotalTokens},
	}

	for _, item := range response.Output.Embeddings {
		openAIEmbeddingResponse.Data = append(openAIEmbeddingResponse.Data, openai.EmbeddingResponseItem{
			Object:    `embedding`,
			Index:     item.TextIndex,
			Embedding: item.Embedding,
		})
	}
	return &openAIEmbeddingResponse
}

func responseAli2OpenAI(response *ChatResponse) *openai.TextResponse {
	fullTextResponse := openai.TextResponse{
		Id:      response.RequestId,
		Object:  "chat.completion",
		Created: helper.GetTimestamp(),
		Choices: response.Output.Choices,
		Usage: model.Usage{
			PromptTokens:     response.Usage.InputTokens,
			CompletionTokens: response.Usage.OutputTokens,
			TotalTokens:      response.Usage.InputTokens + response.Usage.OutputTokens,
		},
	}
	return &fullTextResponse
}

func streamResponseAli2OpenAI(aliResponse *ChatResponse) *openai.ChatCompletionsStreamResponse {
	if len(aliResponse.Output.Choices) == 0 {
		return nil
	}
	aliChoice := aliResponse.Output.Choices[0]
	var choice openai.ChatCompletionsStreamResponseChoice
	choice.Delta = aliChoice.Message
	if aliChoice.FinishReason != "null" {
		finishReason := aliChoice.FinishReason
		choice.FinishReason = &finishReason
	}
	response := openai.ChatCompletionsStreamResponse{
		Id:      aliResponse.RequestId,
		Object:  "chat.completion.chunk",
		Created: helper.GetTimestamp(),
		Model:   "qwen",
		Choices: []openai.ChatCompletionsStreamResponseChoice{choice},
	}
	return &response
}

func StreamHandler(c *gin.Context, resp *http.Response) (*model.ErrorWithStatusCode, *model.Usage) {
	var usage model.Usage
	scanner := bufio.NewScanner(resp.Body)
	// 与 openai adaptor 一致，把单行上限从默认 64 KiB 提到 1 MiB，避免上游一次性
	// 发送超长 tool_calls.arguments 时 scanner 报 ErrTooLong 截断。
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	scanner.Split(func(data []byte, atEOF bool) (advance int, token []byte, err error) {
		if atEOF && len(data) == 0 {
			return 0, nil, nil
		}
		if i := strings.Index(string(data), "\n"); i >= 0 {
			return i + 1, data[0:i], nil
		}
		if atEOF {
			return len(data), data, nil
		}
		return 0, nil, nil
	})

	common.SetEventStreamHeaders(c)

	for scanner.Scan() {
		data := scanner.Text()
		if len(data) < 5 || data[:5] != "data:" {
			continue
		}
		data = data[5:]

		var aliResponse ChatResponse
		err := json.Unmarshal([]byte(data), &aliResponse)
		if err != nil {
			logger.SysError("error unmarshalling stream response: " + err.Error())
			continue
		}
		if aliResponse.Usage.OutputTokens != 0 {
			usage.PromptTokens = aliResponse.Usage.InputTokens
			usage.CompletionTokens = aliResponse.Usage.OutputTokens
			usage.TotalTokens = aliResponse.Usage.InputTokens + aliResponse.Usage.OutputTokens
		}
		response := streamResponseAli2OpenAI(&aliResponse)
		if response == nil {
			continue
		}
		err = render.ObjectData(c, response)
		if err != nil {
			logger.SysError(err.Error())
		}
	}

	if err := scanner.Err(); err != nil {
		logger.SysError("error reading stream: " + err.Error())
	}

	render.Done(c)

	err := resp.Body.Close()
	if err != nil {
		return openai.ErrorWrapper(err, "close_response_body_failed", http.StatusInternalServerError), nil
	}
	return nil, &usage
}

func Handler(c *gin.Context, resp *http.Response) (*model.ErrorWithStatusCode, *model.Usage) {
	ctx := c.Request.Context()
	var aliResponse ChatResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return openai.ErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError), nil
	}
	err = resp.Body.Close()
	if err != nil {
		return openai.ErrorWrapper(err, "close_response_body_failed", http.StatusInternalServerError), nil
	}
	logger.Debugf(ctx, "response body: %s\n", responseBody)
	err = json.Unmarshal(responseBody, &aliResponse)
	if err != nil {
		return openai.ErrorWrapper(err, "unmarshal_response_body_failed", http.StatusInternalServerError), nil
	}
	if aliResponse.Code != "" {
		return &model.ErrorWithStatusCode{
			Error: model.Error{
				Message: aliResponse.Message,
				Type:    aliResponse.Code,
				Param:   aliResponse.RequestId,
				Code:    aliResponse.Code,
			},
			StatusCode: resp.StatusCode,
		}, nil
	}
	fullTextResponse := responseAli2OpenAI(&aliResponse)
	fullTextResponse.Model = "qwen"
	jsonResponse, err := json.Marshal(fullTextResponse)
	if err != nil {
		return openai.ErrorWrapper(err, "marshal_response_body_failed", http.StatusInternalServerError), nil
	}
	c.Writer.Header().Set("Content-Type", "application/json")
	c.Writer.WriteHeader(resp.StatusCode)
	_, err = c.Writer.Write(jsonResponse)
	return nil, &fullTextResponse.Usage
}
