// External CLI fixture for the real desktop-profile integration test.
package main

import (
 "encoding/json"
 "fmt"
 "io"
 "os"
 "path/filepath"
 "time"
)
func main() {
 args := os.Args[1:]
 if len(args) < 2 { os.Exit(2) }
 if args[0] == "auth" {
  fmt.Println(`{"appId":"cli_fixture","identities":{"user":{"available":true,"status":"ready","openId":"ou_owner"}}}`)
  return
 }
 root := os.Getenv("DSH_FEISHU_FIXTURE")
 if args[0] == "event" {
  fmt.Fprintln(os.Stderr, "[event] ready event_key=im.message.receive_v1")
  done := make(chan struct{})
  go func(){ io.Copy(io.Discard, os.Stdin); close(done) }()
  sent := false
  for {
   select { case <-done: return; default: }
   if !sent {
    if b, err := os.ReadFile(filepath.Join(root,"incoming.json")); err == nil {
     fmt.Println(string(b)); fmt.Println(string(b)); sent = true
    }
   }
   time.Sleep(50*time.Millisecond)
  }
 }
 if args[0] == "im" {
  content := ""
  target := ""
  for i := 0; i+1 < len(args); i++ {
   if args[i] == "--content" { content = args[i+1] }
   if args[i] == "--message-id" { target = args[i+1] }
  }
  b,_ := json.Marshal(map[string]string{"content":content,"target":target})
  f,err := os.OpenFile(filepath.Join(root,"replies.jsonl"),os.O_CREATE|os.O_APPEND|os.O_WRONLY,0600)
  if err != nil { os.Exit(5) }
  fmt.Fprintln(f,string(b)); f.Close()
  fmt.Println(`{"ok":true}`)
  return
 }
 os.Exit(2)
}
