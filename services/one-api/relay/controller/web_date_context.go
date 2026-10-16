package controller

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/relay/model"
	"github.com/songquanpeng/one-api/relay/relaymode"
)

const webDateContextKey = "managed_web_date_context"

func needsWebDateContext(c *gin.Context, mode int, request *model.GeneralOpenAIRequest) bool {
	if mode != relaymode.ChatCompletions {
		return false
	}
	if c.GetBool(ctxkey.WebSearch) {
		return true
	}
	for _, tool := range request.Tools {
		if tool.Type == "function" && tool.Function.Name == "web_search" {
			return true
		}
	}
	return false
}

// The server supplies the same Beijing calendar date to the chat and search models,
// independent of the container timezone. Explicit dates in user questions remain intact.
func webDateInstruction(now time.Time) string {
	day := now.In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format("2006-01-02")
	return fmt.Sprintf("当前日期：%s（北京时间，Asia/Shanghai，UTC+08:00）。网页搜索涉及‘今天’‘最新’等相对时间时，以此日期为准；用户明确指定的日期或历史时间范围应保留。区分事件发生日期与网页发布日期，不把旧闻当作今日新闻。", day)
}

func datedSystemContent(content any, instruction string) (any, bool) {
	switch value := content.(type) {
	case nil:
		return instruction, true
	case string:
		return value + "\n\n" + instruction, true
	case []any:
		blocks := append([]any(nil), value...)
		return append(blocks, map[string]any{"type": "text", "text": instruction}), true
	default:
		return nil, false
	}
}

func appendWebDateContext(messages []model.Message, instruction string) []model.Message {
	if len(messages) > 0 && messages[0].Role == "system" {
		if content, ok := datedSystemContent(messages[0].Content, instruction); ok {
			messages[0].Content = content
			return messages
		}
	}
	return append([]model.Message{{Role: "system", Content: instruction}}, messages...)
}

// Patch only the system content in pass-through requests; typed reserialization
// would discard vendor extensions and per-message metadata.
func patchWebDateBody(reader io.Reader, instruction string) (io.Reader, error) {
	var payload map[string]json.RawMessage
	if err := json.NewDecoder(reader).Decode(&payload); err != nil {
		return nil, err
	}
	var messages []map[string]json.RawMessage
	if err := json.Unmarshal(payload["messages"], &messages); err != nil {
		return nil, err
	}
	patched := false
	if len(messages) > 0 && string(messages[0]["role"]) == `"system"` {
		var content any
		if raw := messages[0]["content"]; len(raw) > 0 {
			if err := json.Unmarshal(raw, &content); err != nil {
				return nil, err
			}
		}
		if updated, ok := datedSystemContent(content, instruction); ok {
			encoded, err := json.Marshal(updated)
			if err != nil {
				return nil, err
			}
			messages[0]["content"] = encoded
			patched = true
		}
	}
	if !patched {
		encoded, _ := json.Marshal(instruction)
		messages = append([]map[string]json.RawMessage{{"role": json.RawMessage(`"system"`), "content": encoded}}, messages...)
	}
	encoded, err := json.Marshal(messages)
	if err != nil {
		return nil, err
	}
	payload["messages"] = encoded
	body, err := json.Marshal(payload)
	return bytes.NewReader(body), err
}
