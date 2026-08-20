```bash
 1. 构建默认主题（推荐）：
  cd web/air
  npm install --verbose
(set GOPROXY=https://mirrors.aliyun.com/goproxy/,direct)
go mod downlaod
# 编译 Windows 可执行文件（one-api.exe）
# -ldflags "-s -w"：可选，减小编译后文件体积（去掉调试信息）；
# -o one-api：指定输出文件名
go build -ldflags "-s -w" -o one-api
# 运行
./one-api --port 3000 
