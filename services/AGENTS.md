# 后台维护位置

本目录是 `new-version` 分支的后台源码维护入口。OneAPI 位于 `services/one-api`，技能测试服务位于 `services/skill-test-runner`。

后续后台修改、源码打包和镜像构建均使用本仓库中的文件，不再使用 `E:\code\dsh\deepseek-harness-master`。历史 delivery 发布包是旧快照；其中硬编码旧仓库路径的打包脚本不得直接用于新发布。

迁入的源码保持原样；不要将本地密码、数据库、依赖目录、日志或历史编译产物加入版本控制。Docker 构建上下文为 `services/one-api`。
