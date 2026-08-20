package openai

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/songquanpeng/one-api/common/render"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/conv"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/relay/model"
	"github.com/songquanpeng/one-api/relay/relaymode"
	"github.com/songquanpeng/one-api/relay/timing"
)

const (
	dataPrefix       = "data: "
	done             = "[DONE]"
	dataPrefixLength = len(dataPrefix)
	// 提高 bufio.Scanner 单行上限：默认 bufio.MaxScanTokenSize = 64 KiB，
	// 上游模型一次性输出长 tool_calls.arguments（如 1.5 万字代码）时单条 SSE
	// data 行可能超过这个值，被 scanner 直接报 ErrTooLong 截断。设到 1 MiB 后
	// 实测不会再触发，且 buffer 是按需增长的，不会无谓占内存。
	maxSSELineSize = 1024 * 1024
)

func StreamHandler(c *gin.Context, resp *http.Response, relayMode int) (*model.ErrorWithStatusCode, string, *model.Usage) {
	responseText := ""
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), maxSSELineSize)
	scanner.Split(bufio.ScanLines)
	var usage *model.Usage

	common.SetEventStreamHeaders(c)

	// pendingPayload 缓存上一行 unmarshal 失败的 JSON 残体（不带 "data: " 前缀）。
	// 上游极少数情况下会在一条 SSE event 内部夹带多行（违反协议但确实出现过）或者
	// 在 args 字符串里包含字面 \n 导致 scanner 在中间切断。原实现 unmarshal 失败时
	// 直接 render.StringData 把残行透传给客户端 → ai-sdk JSON.parse 失败 → 误判为
	// truncation → 进 repair 路径 → 模型循环重试。改成 pending 累积重试：把残行
	// 拼到 pending 上，下一行来了一并尝试 unmarshal，成功后整体透传。
	pendingPayload := ""

	doneRendered := false
	for scanner.Scan() {
		data := scanner.Text()
		if len(data) < dataPrefixLength { // ignore blank line or wrong format
			continue
		}
		if data[:dataPrefixLength] != dataPrefix && data[:dataPrefixLength] != done {
			// 这一行没有 "data: " 前缀。可能是 pending 中残体的延续行。
			if pendingPayload != "" {
				pendingPayload += data
				if streamResponse, ok := tryUnmarshalChat(pendingPayload); ok {
					timing.Mark(c, timing.StageUpstreamFirstChunk, timing.F("chunk_bytes", len(pendingPayload)+dataPrefixLength))
					render.StringData(c, dataPrefix+pendingPayload)
					timing.Mark(c, timing.StageClientFirstWrite)
					for _, choice := range streamResponse.Choices {
						responseText += conv.AsString(choice.Delta.Content)
					}
					if streamResponse.Usage != nil {
						usage = streamResponse.Usage
					}
					pendingPayload = ""
				}
			}
			continue
		}
		if strings.HasPrefix(data[dataPrefixLength:], done) {
			// 收到 [DONE]，pending 还残留说明上游异常结束，丢弃残体而不是透传坏数据。
			if pendingPayload != "" {
				logger.SysError("dropping unparsable pending SSE payload at [DONE]: " + pendingPayload[:min(len(pendingPayload), 200)])
				pendingPayload = ""
			}
			render.StringData(c, data)
			timing.Mark(c, timing.StageClientFirstWrite)
			doneRendered = true
			continue
		}
		switch relayMode {
		case relaymode.ChatCompletions:
			payload := data[dataPrefixLength:]
			// 如果有未完成的 pending 残体，尝试拼接（覆盖"上游 SSE event 内含字面
			// 换行被 scanner 切成多行"的场景）。
			if pendingPayload != "" {
				combined := pendingPayload + payload
				if streamResponse, ok := tryUnmarshalChat(combined); ok {
					timing.Mark(c, timing.StageUpstreamFirstChunk, timing.F("chunk_bytes", len(combined)+dataPrefixLength))
					render.StringData(c, dataPrefix+combined)
					timing.Mark(c, timing.StageClientFirstWrite)
					for _, choice := range streamResponse.Choices {
						responseText += conv.AsString(choice.Delta.Content)
					}
					if streamResponse.Usage != nil {
						usage = streamResponse.Usage
					}
					pendingPayload = ""
					continue
				}
				// 拼接后仍然解析失败，丢弃旧 pending（视为"上游真发了坏数据"），
				// 把当前行重新作为新 payload 处理。
				logger.SysError("dropping unparsable SSE pending payload: " + pendingPayload[:min(len(pendingPayload), 200)])
				pendingPayload = ""
			}

			streamResponse, ok := tryUnmarshalChat(payload)
			if !ok {
				// 当前行 unmarshal 失败：不再像旧实现那样把残行透传给客户端
				// （那会让 ai-sdk 看到坏 JSON、走 repair 路径、模型循环重试）。
				// 缓存到 pending，等下一行来拼接。
				logger.SysError("buffering unparsable SSE payload, awaiting next line: " + payload[:min(len(payload), 200)])
				pendingPayload = payload
				continue
			}
			if len(streamResponse.Choices) == 0 && streamResponse.Usage == nil {
				// but for empty choice and no usage, we should not pass it to client, this is for azure
				continue // just ignore empty choice
			}
			timing.Mark(c, timing.StageUpstreamFirstChunk, timing.F("chunk_bytes", len(data)))
			render.StringData(c, data)
			timing.Mark(c, timing.StageClientFirstWrite)
			for _, choice := range streamResponse.Choices {
				responseText += conv.AsString(choice.Delta.Content)
			}
			if streamResponse.Usage != nil {
				usage = streamResponse.Usage
			}
		case relaymode.Completions:
			timing.Mark(c, timing.StageUpstreamFirstChunk, timing.F("chunk_bytes", len(data)))
			render.StringData(c, data)
			timing.Mark(c, timing.StageClientFirstWrite)
			var streamResponse CompletionsStreamResponse
			err := json.Unmarshal([]byte(data[dataPrefixLength:]), &streamResponse)
			if err != nil {
				logger.SysError("error unmarshalling stream response: " + err.Error())
				continue
			}
			for _, choice := range streamResponse.Choices {
				responseText += choice.Text
			}
		}
	}

	if err := scanner.Err(); err != nil {
		logger.SysError("error reading stream: " + err.Error())
	}

	if !doneRendered {
		render.Done(c)
	}

	err := resp.Body.Close()
	if err != nil {
		return ErrorWrapper(err, "close_response_body_failed", http.StatusInternalServerError), "", nil
	}

	return nil, responseText, usage
}

// tryUnmarshalChat 解析 ChatCompletions 流式响应的 data payload（不含 "data: " 前缀）。
// 返回 (响应, 是否解析成功)。仅用于 StreamHandler 内的 pending 累积重试逻辑。
func tryUnmarshalChat(payload string) (ChatCompletionsStreamResponse, bool) {
	var streamResponse ChatCompletionsStreamResponse
	if err := json.Unmarshal([]byte(payload), &streamResponse); err != nil {
		return streamResponse, false
	}
	return streamResponse, true
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func Handler(c *gin.Context, resp *http.Response, promptTokens int, modelName string) (*model.ErrorWithStatusCode, *model.Usage) {
	var textResponse SlimTextResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return ErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError), nil
	}
	err = resp.Body.Close()
	if err != nil {
		return ErrorWrapper(err, "close_response_body_failed", http.StatusInternalServerError), nil
	}
	err = json.Unmarshal(responseBody, &textResponse)
	if err != nil {
		return ErrorWrapper(err, "unmarshal_response_body_failed", http.StatusInternalServerError), nil
	}
	if textResponse.Error.Type != "" {
		return &model.ErrorWithStatusCode{
			Error:      textResponse.Error,
			StatusCode: resp.StatusCode,
		}, nil
	}
	// Reset response body
	resp.Body = io.NopCloser(bytes.NewBuffer(responseBody))

	// We shouldn't set the header before we parse the response body, because the parse part may fail.
	// And then we will have to send an error response, but in this case, the header has already been set.
	// So the HTTPClient will be confused by the response.
	// For example, Postman will report error, and we cannot check the response at all.
	for k, v := range resp.Header {
		c.Writer.Header().Set(k, v[0])
	}
	c.Writer.WriteHeader(resp.StatusCode)
	_, err = io.Copy(c.Writer, resp.Body)
	if err != nil {
		return ErrorWrapper(err, "copy_response_body_failed", http.StatusInternalServerError), nil
	}
	err = resp.Body.Close()
	if err != nil {
		return ErrorWrapper(err, "close_response_body_failed", http.StatusInternalServerError), nil
	}

	if textResponse.Usage.TotalTokens == 0 || (textResponse.Usage.PromptTokens == 0 && textResponse.Usage.CompletionTokens == 0) {
		completionTokens := 0
		for _, choice := range textResponse.Choices {
			completionTokens += CountTokenText(choice.Message.StringContent(), modelName)
		}
		textResponse.Usage = model.Usage{
			PromptTokens:     promptTokens,
			CompletionTokens: completionTokens,
			TotalTokens:      promptTokens + completionTokens,
		}
	}
	return nil, &textResponse.Usage
}
