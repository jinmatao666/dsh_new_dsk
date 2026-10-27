# 共用敬请期待页面

[English](README.md) | 中文

本独立静态页面为未开放专家展示统一提示，不提供上传、登录、模型、任务、存储、原生桥或使用上报API。页面立即清除打开时的URL片段，不读取或核验票据；平台签发票据正常过期。不宣称服务已可用，也不承诺开放日期。

在本目录运行`python preview.py`，获取回环预览地址。运行`node --test test_page.mjs`执行专项静态检查。HTML自包含，可复制到已有静态服务器，无需仓库依赖。插图只作装饰；页头嵌入正式品牌的原始路径，本地保留`assets/brand-mark.svg`，不额外请求图片，也不在运行时读取其他项目。

生产部署时先让现有网关容器能读取此文件，再将[nginx.location.conf.example](nginx.location.conf.example)加入既有3300 server。示例假定容器内文件位置为`/usr/share/nginx/wanwei-coming-soon/index.html`，使用前必须确认实际挂载。如果容器还不能读取此目录，单加location无效；需另行安排挂载变更，不能覆盖网关其他配置。执行`nginx -t`，安全重载后验证真实请求。本地未验证容器部署。

规划的统一工作台地址为`http://ac.zjugis.com:3300/experts/coming-soon/`。部署后，多个未开放专家卡片可填写相同地址，但各自编号与提供方凭据仍须独立。页面不消费凭据，也不记录使用次数；某个专家开发完成后，仅把对应卡片换成真实工作台地址。本轮不修改现有卡片或生产路由。
