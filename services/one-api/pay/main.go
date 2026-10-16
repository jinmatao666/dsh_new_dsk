package main

import (
	"fmt"
	"log"
	"net/http"

	"wechat-pay/handler"
)

func main() {
	mux := http.NewServeMux()

	// 前端页面
	mux.Handle("/", http.FileServer(http.Dir("static")))

	// POST /pay/create  - 创建 Native 支付订单，返回二维码 URL
	mux.HandleFunc("/pay/create", handler.CreateNativeOrder)

	// GET  /pay/query?out_trade_no=xxx - 查询订单状态
	mux.HandleFunc("/pay/query", handler.QueryOrder)

	// POST /pay/notify  - 微信支付回调通知（需公网可访问）
	mux.HandleFunc("/pay/notify", handler.PayNotify)

	addr := ":8080"
	fmt.Printf("服务启动，监听 %s\n", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
