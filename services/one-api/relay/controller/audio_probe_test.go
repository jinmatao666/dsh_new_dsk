package controller

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/songquanpeng/one-api/common/client"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/relay/channeltype"
	"github.com/stretchr/testify/require"
)

func TestProbeAudioTranscriptionUsesMultipartForCompatibleChannel(t *testing.T) {
	previousClient := client.HTTPClient
	client.HTTPClient = http.DefaultClient
	t.Cleanup(func() { client.HTTPClient = previousClient })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/v1/audio/transcriptions", r.URL.Path)
		require.Equal(t, "Bearer test-key", r.Header.Get("Authorization"))
		require.NoError(t, r.ParseMultipartForm(1<<20))
		require.Equal(t, "audio-model", r.FormValue("model"))
		file, _, err := r.FormFile("file")
		require.NoError(t, err)
		defer file.Close()
		wav, err := io.ReadAll(file)
		require.NoError(t, err)
		require.Equal(t, "RIFF", string(wav[:4]))
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"text":"测试成功"}`)
	}))
	defer server.Close()

	baseURL := server.URL + "/v1"
	channel := &model.Channel{Type: channeltype.OpenAICompatible, Key: "test-key", BaseURL: &baseURL}
	message, err, relayErr := ProbeAudioTranscription(context.Background(), channel, "audio-model")
	require.NoError(t, err)
	require.Nil(t, relayErr)
	require.Equal(t, "音频接口连通，识别结果：测试成功", message)
}

func TestProbeAudioTranscriptionUsesNativePayloadForAliBailian(t *testing.T) {
	previousClient := client.HTTPClient
	client.HTTPClient = http.DefaultClient
	t.Cleanup(func() { client.HTTPClient = previousClient })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/api/v1/services/aigc/multimodal-generation/generation", r.URL.Path)
		require.Equal(t, "disable", r.Header.Get("X-DashScope-SSE"))
		var request aliBailianTranscriptionRequest
		require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
		require.Equal(t, "qwen-audio-3.0-asr-flash", request.Model)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"output":{"text":"百炼测试成功"}}`)
	}))
	defer server.Close()

	baseURL := server.URL + "/compatible-mode/v1"
	channel := &model.Channel{Type: channeltype.AliBailian, Key: "test-key", BaseURL: &baseURL}
	message, err, relayErr := ProbeAudioTranscription(context.Background(), channel, "qwen-audio-3.0-asr-flash")
	require.NoError(t, err)
	require.Nil(t, relayErr)
	require.Equal(t, "音频接口连通，识别结果：百炼测试成功", message)
}

func TestAudioProbeWAVIsMono16KPCM(t *testing.T) {
	wav := audioProbeWAV()
	require.Equal(t, "RIFF", string(wav[:4]))
	require.Equal(t, "WAVE", string(wav[8:12]))
	require.Equal(t, uint16(1), binary.LittleEndian.Uint16(wav[22:24]))
	require.Equal(t, uint32(16000), binary.LittleEndian.Uint32(wav[24:28]))
	require.Equal(t, uint16(16), binary.LittleEndian.Uint16(wav[34:36]))
	require.Equal(t, uint32(len(wav)-8), binary.LittleEndian.Uint32(wav[4:8]))
	require.False(t, bytes.Equal(wav[44:], make([]byte, len(wav)-44)))
}
