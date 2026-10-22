package ragflow

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type uploadRoundTrip func(*http.Request) (*http.Response, error)

func (f uploadRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type deferredUploadReader struct {
	started *bool
	t       *testing.T
	source  io.Reader
}

func (r deferredUploadReader) Read(p []byte) (int, error) {
	if !*r.started {
		r.t.Fatal("file was read before the outgoing request started")
	}
	return r.source.Read(p)
}

func TestUploadDocumentStreamsSourceWithinMultipart(t *testing.T) {
	started := false
	client := &Client{baseURL: "http://ragflow.test", apiKey: "test-key", http: &http.Client{
		Transport: uploadRoundTrip(func(request *http.Request) (*http.Response, error) {
			started = true
			if request.Header.Get("Authorization") != "Bearer test-key" {
				t.Fatal("missing credential")
			}
			reader, err := request.MultipartReader()
			if err != nil {
				t.Fatal(err)
			}
			part, err := reader.NextPart()
			if err != nil || part.FileName() != "基础库.mdb" {
				t.Fatalf("part=%v err=%v", part, err)
			}
			body, err := io.ReadAll(part)
			if err != nil || string(body) != "MDB data" {
				t.Fatalf("body=%q err=%v", body, err)
			}
			if _, err := reader.NextPart(); err != io.EOF {
				t.Fatalf("multipart footer: %v", err)
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"code":0,"data":[{"id":"doc-1"}]}`)), Header: make(http.Header)}, nil
		}),
	}}
	documents, err := client.UploadDocument(context.Background(), "dataset", "基础库.mdb",
		deferredUploadReader{&started, t, strings.NewReader("MDB data")}, "")
	if err != nil || len(documents) != 1 || documents[0].Id != "doc-1" {
		t.Fatalf("documents=%v err=%v", documents, err)
	}
}
