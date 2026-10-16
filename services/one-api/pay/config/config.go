package config

// WxPayConfig 微信支付配置
type WxPayConfig struct {
	AppID          string // 应用ID
	MchID          string // 商户号
	APIv3Key       string // APIv3密钥（32位）
	SerialNo       string // 商户证书序列号
	PrivateKeyPath string // 商户私钥文件路径
	PubKeyID       string // 微信支付公钥ID
	PubKeyPath     string // 微信支付公钥文件路径
	NotifyURL      string // 支付回调通知地址
}

var Cfg = &WxPayConfig{
	AppID:          "wx95020644e79ce840",
	MchID:          "1104973994",
	APIv3Key:       "F7Q8Xn2A6c4B5sJZ0YkD3V9HUmRPTELW",
	SerialNo:       "21BB79CE0C99B256CC72DE238C288CB881D26CAB",
	PrivateKeyPath: `C:\Users\Administrator\Desktop\cret\apiclient_key.pem`,
	PubKeyID:       "PUB_KEY_ID_0111049739942026010600212263003800",
	PubKeyPath:     `C:\Users\Administrator\Desktop\cret\pub_key.pem`,
	NotifyURL:      "https://rebound-seating-visited-xbox.trycloudflare.com/pay/notify",
}
