package openai

import (
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/relay/channeltype"
	"github.com/songquanpeng/one-api/relay/model"
	"github.com/songquanpeng/one-api/relay/relaymode"
)

func TestConvertRequestAddsSearchOnlyForMarkedBailianRequest(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		channelType int
		marked      bool
		wantSearch  bool
	}{
		{name: "marked Bailian request", channelType: channeltype.AliBailian, marked: true, wantSearch: true},
		{name: "ordinary Bailian request", channelType: channeltype.AliBailian, marked: false, wantSearch: false},
		{name: "marked compatible request", channelType: channeltype.OpenAICompatible, marked: true, wantSearch: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			context, _ := gin.CreateTestContext(nil)
			context.Set(ctxkey.WebSearch, tt.marked)
			request := &model.GeneralOpenAIRequest{}
			converted, err := (&Adaptor{ChannelType: tt.channelType}).ConvertRequest(context, relaymode.ChatCompletions, request)
			if err != nil {
				t.Fatalf("ConvertRequest returned error: %v", err)
			}
			if tt.wantSearch {
				parameters := converted.(map[string]any)["parameters"].(map[string]any)
				options := parameters["search_options"].(map[string]any)
				if parameters["enable_search"] != true || options["enable_source"] != true || options["forced_search"] != true {
					t.Fatalf("search parameters = %#v", parameters)
				}
			} else if converted != request || request.EnableSearch || request.SearchOptions != nil {
				t.Fatal("ordinary request was changed")
			}
		})
	}
}
