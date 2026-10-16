package controller

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/songquanpeng/one-api/model"
)

func testSkillCall(name, args string) skillTestCall {
	c := skillTestCall{Id: "call1", Type: "function"}
	c.Function.Name = name
	c.Function.Arguments = args
	return c
}

func TestSkillTestLoopRetainsToolResultsAndClarifications(t *testing.T) {
	calls := 0
	tools := 0
	events := []string{}
	messages, err := skillTestLoop(context.Background(), []skillTestMessage{{Role: "system", Content: "中文测试"}, {Role: "user", Content: "转换文档"}},
		func(_ context.Context, m []skillTestMessage) (skillTestMessage, error) {
			calls++
			if calls == 1 {
				return skillTestMessage{Role: "assistant", ToolCalls: []skillTestCall{testSkillCall("execute", `{"command":"python skill/run.py"}`)}}, nil
			}
			if m[len(m)-1].Role != "tool" {
				t.Fatal("model did not receive tool result")
			}
			return skillTestMessage{Role: "assistant", ToolCalls: []skillTestCall{testSkillCall("ask_user", `{"question":"请提供原始文件"}`)}}, nil
		},
		func(context.Context, string, map[string]interface{}) (interface{}, error) {
			tools++
			return nil, errors.New("缺少输入文件")
		},
		func(m []skillTestMessage, e skillTestEvent) error { events = append(events, e.Kind); return nil })
	if err != nil || calls != 2 || tools != 1 {
		t.Fatalf("calls=%d tools=%d err=%v", calls, tools, err)
	}
	if !strings.Contains(messages[len(messages)-1].Content, "请提供原始文件") {
		t.Fatal("missing clarification")
	}
	if !strings.Contains(messages[3].Content, "缺少输入文件") {
		t.Fatal("tool failure not retained")
	}
	if !reflect.DeepEqual(events, []string{"assistant", "tool_start", "tool_result", "assistant", "tool_result"}) {
		t.Fatalf("events: %v", events)
	}
}

func TestSkillTestLoopCancellationNeverStartsNextTool(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	started := 0
	_, err := skillTestLoop(ctx, nil, func(context.Context, []skillTestMessage) (skillTestMessage, error) {
		cancel()
		return skillTestMessage{Role: "assistant", ToolCalls: []skillTestCall{testSkillCall("execute", `{"command":"sleep 30"}`)}}, nil
	}, func(context.Context, string, map[string]interface{}) (interface{}, error) { started++; return nil, nil }, func([]skillTestMessage, skillTestEvent) error { return nil })
	if !errors.Is(err, context.Canceled) || started != 0 {
		t.Fatalf("err=%v tools=%d", err, started)
	}
}

func TestSkillTestLoopMalformedArgumentsAndLimits(t *testing.T) {
	calls := 0
	tools := 0
	_, err := skillTestLoop(context.Background(), nil, func(context.Context, []skillTestMessage) (skillTestMessage, error) {
		calls++
		return skillTestMessage{Role: "assistant", ToolCalls: []skillTestCall{testSkillCall("execute", "{bad")}}, nil
	}, func(context.Context, string, map[string]interface{}) (interface{}, error) { tools++; return nil, nil }, func([]skillTestMessage, skillTestEvent) error { return nil })
	if err == nil || calls != 20 || tools != 0 {
		t.Fatalf("limit calls=%d tools=%d err=%v", calls, tools, err)
	}
}

func TestSkillTestJSONDoesNotRedirectCredentials(t *testing.T) {
	reached := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached = true }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 307) }))
	defer source.Close()
	var response map[string]interface{}
	err := skillTestJSON(context.Background(), source.URL, "private-secret", map[string]string{}, &response, 1024)
	if err == nil || reached || strings.Contains(err.Error(), "private-secret") {
		t.Fatalf("unsafe redirect: %v reached=%v", err, reached)
	}
}

func TestSkillTestJSONResponseLimitAndCredentials(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer trusted" {
			t.Error("missing internal auth")
		}
		w.Write([]byte(strings.Repeat("x", 100)))
	}))
	defer server.Close()
	var response interface{}
	if err := skillTestJSON(context.Background(), server.URL, "trusted", map[string]string{}, &response, 10); err == nil {
		t.Fatal("accepted oversized response")
	}
}

func TestSkillTestPendingAndSnapshot(t *testing.T) {
	skill := &model.PersonalSkill{Visibility: model.PersonalSkillPublic, ReviewStatus: model.PersonalSkillReviewPending, Assets: "bundle", Version: "1"}
	if err := skillTestPending(skill); err != nil {
		t.Fatal(err)
	}
	before := skillTestHash(skill)
	skill.Assets = "modified"
	if skillTestHash(skill) == before {
		t.Fatal("snapshot not invalidated")
	}
	skill.ReviewStatus = model.PersonalSkillReviewApproved
	if skillTestPending(skill) == nil {
		t.Fatal("approved skill accepted")
	}
	skill.Visibility = model.PersonalSkillPrivate
	skill.ReviewStatus = model.PersonalSkillReviewPending
	if skillTestPending(skill) == nil {
		t.Fatal("private upload accepted")
	}
}

func TestSkillTestUploadsRejectEscapeAndDuplicates(t *testing.T) {
	for _, name := range []string{"../secret", "/absolute", "dir/file", "dir\\file", "..", ""} {
		if validateSkillTestUploads([]skillTestUpload{{Name: name, ContentBase64: "YQ=="}}) == nil {
			t.Errorf("accepted %q", name)
		}
	}
	file := skillTestUpload{Name: "报告.docx", ContentBase64: "YQ=="}
	if validateSkillTestUploads([]skillTestUpload{file}) != nil {
		t.Fatal("rejected normal attachment")
	}
	if validateSkillTestUploads([]skillTestUpload{file, file}) == nil {
		t.Fatal("accepted duplicates")
	}
}

func TestSkillTestToolsOnlyExposeSandboxOperations(t *testing.T) {
	data, _ := json.Marshal(skillTestTools())
	if strings.Contains(string(data), "secret") || len(skillTestTools()) != 5 {
		t.Fatal("unexpected tools")
	}
}
