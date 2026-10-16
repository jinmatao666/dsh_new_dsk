package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type skillTestCall struct {
	Id       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}
type skillTestMessage struct {
	Role       string          `json:"role"`
	Content    string          `json:"content"`
	ToolCalls  []skillTestCall `json:"tool_calls,omitempty"`
	ToolCallId string          `json:"tool_call_id,omitempty"`
}
type skillTestEvent struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
	Time int64  `json:"time"`
}

// Fixed internal endpoints are configured by the operator, never by uploaded skills.
// Redirects are rejected so bearer credentials cannot move to another origin.
func skillTestJSON(ctx context.Context, endpoint, secret string, request, response interface{}, limit int64) error {
	data, err := json.Marshal(request)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+secret)
	client := &http.Client{Timeout: 180 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return errors.New("测试服务请求失败，请检查内部服务连接或重试")
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil || int64(len(body)) > limit {
		return errors.New("测试响应超过限制或读取失败")
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		// Upstream errors may contain provider credentials or URLs; they stay server-side.
		return fmt.Errorf("测试请求失败（HTTP %d），请检查模型权限、额度和运行环境", res.StatusCode)
	}
	return json.Unmarshal(body, response)
}

func skillTestRunnerConfig() (string, string, error) {
	endpoint := strings.TrimRight(os.Getenv("SKILL_TEST_RUNNER_URL"), "/")
	secret := os.Getenv("SKILL_TEST_RUNNER_SECRET")
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") || len(secret) < 32 || strings.HasPrefix(secret, "replace") {
		return "", "", errors.New("技能测试服务未配置，请联系部署管理员")
	}
	return endpoint, secret, nil
}

func skillTestRunner(ctx context.Context, action string, request, response interface{}) error {
	endpoint, secret, err := skillTestRunnerConfig()
	if err != nil {
		return err
	}
	return skillTestJSON(ctx, endpoint+action, secret, request, response, 30*1024*1024)
}

func skillTestTools() []interface{} {
	definitions := []struct {
		name, description string
		properties        map[string]interface{}
		required          []string
	}{
		{"execute", "在隔离的 Linux 容器 /workspace 内执行 shell 命令。无网络，单条命令最多60秒。", map[string]interface{}{"command": map[string]string{"type": "string"}}, []string{"command"}},
		{"read_file", "读取工作区文本文件（前16000字节）；二进制文件用脚本解析。", map[string]interface{}{"path": map[string]string{"type": "string"}}, []string{"path"}},
		{"write_file", "写入工作区文本文件。正式交付文件放在 output/ 根目录。", map[string]interface{}{"path": map[string]string{"type": "string"}, "content": map[string]string{"type": "string"}}, []string{"path", "content"}},
		{"list_files", "列出工作区目录。", map[string]interface{}{"path": map[string]string{"type": "string"}}, []string{"path"}},
		{"ask_user", "需要澄清需求时向审核人提问，等待下一条回复。", map[string]interface{}{"question": map[string]string{"type": "string"}}, []string{"question"}},
	}
	result := make([]interface{}, 0, len(definitions))
	for _, d := range definitions {
		result = append(result, map[string]interface{}{"type": "function", "function": map[string]interface{}{"name": d.name, "description": d.description, "parameters": map[string]interface{}{"type": "object", "properties": d.properties, "required": d.required, "additionalProperties": false}}})
	}
	return result
}

// skillTestLoop logs every model-visible message before advancing. Tool failures are
// visible results, not successful executions. Cancellation prevents subsequent tools.
func skillTestLoop(ctx context.Context, messages []skillTestMessage,
	complete func(context.Context, []skillTestMessage) (skillTestMessage, error),
	tool func(context.Context, string, map[string]interface{}) (interface{}, error),
	save func([]skillTestMessage, skillTestEvent) error) ([]skillTestMessage, error) {
	emit := func(kind, text string) error {
		return save(messages, skillTestEvent{Kind: kind, Text: text, Time: time.Now().Unix()})
	}
	for step := 0; step < 20; step++ {
		if err := ctx.Err(); err != nil {
			return messages, err
		}
		if data, _ := json.Marshal(messages); len(data) > 2*1024*1024 {
			return messages, errors.New("测试上下文超过2 MB，请结束后新建测试")
		}
		reply, err := complete(ctx, messages)
		if err != nil {
			return messages, err
		}
		if reply.Role != "assistant" {
			return messages, errors.New("模型返回了无效的消息类型")
		}
		if len(reply.ToolCalls) > 8 {
			return messages, errors.New("模型单轮工具请求超过限制")
		}
		messages = append(messages, reply)
		if err = emit("assistant", reply.Content); err != nil {
			return messages, err
		}
		if len(reply.ToolCalls) == 0 {
			return messages, nil
		}
		waiting := false
		for _, call := range reply.ToolCalls {
			if err = ctx.Err(); err != nil {
				return messages, err
			}
			var args map[string]interface{}
			var result interface{}
			if call.Id == "" || call.Type != "function" {
				return messages, errors.New("模型工具调用格式无效")
			}
			if err = json.Unmarshal([]byte(call.Function.Arguments), &args); err != nil {
				result = map[string]string{"error": "工具参数不是合法JSON"}
			} else if call.Function.Name == "ask_user" {
				question, _ := args["question"].(string)
				if question == "" {
					result = map[string]string{"error": "请提供需要澄清的问题"}
				} else {
					waiting = true
					result = map[string]string{"status": "等待审核人回复", "question": question}
				}
			} else {
				if err = emit("tool_start", call.Function.Name+" · "+call.Function.Arguments); err != nil {
					return messages, err
				}
				result, err = tool(ctx, call.Function.Name, args)
				if err != nil {
					if ctx.Err() != nil {
						return messages, ctx.Err()
					}
					result = map[string]string{"error": err.Error()}
				}
			}
			data, marshalErr := json.Marshal(result)
			if marshalErr != nil {
				return messages, marshalErr
			}
			messages = append(messages, skillTestMessage{Role: "tool", Content: string(data), ToolCallId: call.Id})
			if err = emit("tool_result", call.Function.Name+" · "+string(data)); err != nil {
				return messages, err
			}
		}
		if waiting {
			return messages, nil
		}
	}
	return messages, errors.New("本轮达到20次模型调用上限，请检查技能或继续提问")
}

func skillTestCompletion(ctx context.Context, modelName, key string, messages []skillTestMessage) (skillTestMessage, error) {
	endpoint := os.Getenv("SKILL_TEST_RELAY_URL")
	if endpoint == "" {
		port := os.Getenv("PORT")
		if port == "" {
			port = "3000"
		}
		endpoint = "http://127.0.0.1:" + port + "/v1/chat/completions"
	}
	var response struct {
		Choices []struct {
			Message skillTestMessage `json:"message"`
		} `json:"choices"`
	}
	err := skillTestJSON(ctx, endpoint, "sk-"+key, map[string]interface{}{"model": modelName, "messages": messages, "tools": skillTestTools(), "stream": false, "max_tokens": 4096}, &response, 2*1024*1024)
	if err != nil {
		return skillTestMessage{}, err
	}
	if len(response.Choices) == 0 {
		return skillTestMessage{}, errors.New("模型未返回测试回复")
	}
	return response.Choices[0].Message, nil
}
