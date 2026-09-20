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
			got := converted.(*model.GeneralOpenAIRequest)
			if got.EnableSearch != tt.wantSearch {
				t.Fatalf("EnableSearch = %v, want %v", got.EnableSearch, tt.wantSearch)
			}
			if tt.wantSearch != (got.SearchOptions != nil && got.SearchOptions.ForcedSearch) {
				t.Fatalf("SearchOptions = %#v, want forced search %v", got.SearchOptions, tt.wantSearch)
			}
		})
	}
}
