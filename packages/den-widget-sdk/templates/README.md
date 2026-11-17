# Den 模块开发

这是本地 SDK 创建的示例项目，接口域名为 example.invalid，不是真实内容服务。

1. 运行 `npm install` 安装生成时指定的本地 SDK 和 TypeScript。
2. 运行 `npm test`，用固定数据检查列表、搜索、详情与单个版本解析。
3. 运行 `npm run typecheck` 检查字段和支持的 API，运行 `npm run check` 检查元数据及函数。
4. 将 widget.js 中 API 地址、数据映射和 fixtures.json 改为自己的服务；只使用有权访问的内容。
5. 运行 `npm run build` 生成 dist/widget.js，放在可访问的 HTTPS 地址，在 Den 导入该脚本。

最终脚本是普通 JS，不包含 import、export、require、Node API 或 SDK 模拟器。
测试默认不联网。真实请求须显式允许 origin，切勿将 token 写进脚本或上传 fixtures。
本地测试不是 iPhone／Mac／TV 真机验收；每个目标 App 都需单独确认。
SDK 源码已公开，尚未发布 npm；package.json 指向生成时的本地 SDK 路径，不依赖尚未发布的 npm 包。
