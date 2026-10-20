# Den Widgets

Den 开源模块合集。清单与脚本参照 [ForwardWidget](https://github.com/InchStudio/ForwardWidgets) 的 `widgets` / `WidgetMetadata` 格式编写，提供可查看、可更新的独立插件；不附带媒体内容、服务器账号或服务口令。

## 导入链接

在支持模块合集的 Den 中打开 **设置 → 模块 → 右上角添加 → 通过链接添加**，粘贴：

```
https://raw.githubusercontent.com/huanhq99/Den-Widgets/main/manifest.json
```

也提供相同内容的 `.fwd` 清单：

```
https://raw.githubusercontent.com/huanhq99/Den-Widgets/main/den-widgets.fwd
```

新版 Den 默认展示此官方合集，不需要重复添加。进入合集，选择需要的模块安装；点击已安装的模块填写参数并检查连接。**合集、插件、内容来源是三个层次：导入清单不会安装所有插件，安装插件也不会把它放上首页。** 首页显示统一在 **设置 → 首页配置** 中选择。

GitHub 的 `blob` 文件页面不是原始文件；推荐复制上面的 Raw 链接。Den 也能转换本仓库的项目地址和 GitHub 文件链接。其他 ForwardWidget 客户端请使用 Raw / .fwd 链接。

## 1. 红果短剧

使用 `hongguo.js` 连接你自己部署的 [HongguoTV](https://github.com/N3urda/hongguoTV) API v1 服务。

1. 在合集中安装“红果短剧”。
2. 点击红果模块，填写完整的服务地址（包括协议、端口和必要的路径），例如 `http://NAS-IP:8787/`。
3. 如服务器设置了口令，在“服务口令”中填写；否则留空。
4. 点击“检查连接”。成功后，可在首页配置中添加红果模块或推荐分类。

支持推荐、搜索、分集、按需解析当前集。剧集 ID 保持字符串，避免大整数精度丢失。媒体代理地址必须与配置的服务同源，服务口令不会被发往外部 CDN。服务器本身需要能够正常请求上游；改用 HTTPS 不会修复上游返回的 502。

请求协议：`GET health`、`GET api/home?page=`、`GET api/search?q=&page=`、`GET api/series/{id}`、`GET api/episodes/{id}/play?fresh=1`。媒体链接只在开始播放该集时解析，不在详情页批量预解析。

## 2. 黄果接口适配

`huangguo.js` 是按用户提供脚本的接口结构重新实现的适配器，**没有转载原脚本、嵌入原脚本的代理密钥，也没有提供默认内容服务器**。

安装后填写你有权使用的 API 地址。若该接口返回加密封面，再填写你自己的封面解密代理与 Token；未配置代理时显示文字占位。提供热门、最新、排行榜、短剧、漫剧和搜索入口。分类无结果时保留空列表，不替换成其他分类。

兼容接口：`GET api/videos`、`GET api/search`、`GET api/ranks/hot`、`GET api/videos/{id}`、`GET api/videos/{id}/play?ep=`。打开 60 集详情不会发起 50 次播放解析；用户点第几集才请求哪集。封面代理 Token 不会附加到播放请求中。

实际服务可用性、封面代理和媒体播放取决于用户配置的服务。自动测试使用本地自建数据，没有访问或验证第三方内容站。

## 运行与更新

- 查看版本：进入合集列表，各模块右侧显示版本。
- 更新清单：点击合集中“刷新”。刷新不会重置模块参数或自动执行清单中的其他插件。
- 更新脚本：进入已安装模块，点击“更新模块”。配置和首页引用保持不变。
- 停用、移除：在模块设置中操作。收藏和首页位置保留，方便之后恢复。
- 分享来源：只分享清单链接。不要把自己的服务口令、Cookie、代理 Token 写入公开 JS 或提交到仓库。

## 给开发者

清单是 `manifest.json` / `den-widgets.fwd`，每项包含 `id`、`title`、`description`、`author`、`version`、`url`。增加插件时添加新的 JS 和清单条目，并同步提高版本。脚本必须导出 `WidgetMetadata` 及其声明的函数。

Den 支持 `Widget.http`、`Widget.storage`、常见 HTML/DOM 接口与可中断的 JS Worker。普通列表函数返回数组，`loadDetail` 返回详情/分集或播放地址。搜索及 `type: stream` 解析函数不会进入首页分类候选。此仓库没有宣称支持 ForwardWidget 的所有扩展或加密格式。

`loadDetail` 使用链接字符串；Den 另外传入兼容字符串转换的对象，其 `__parameters` 包含当前全局参数，因此从收藏打开详情时也能得到最新设置。其他客户端通过先运行列表函数保存的 `Widget.storage` 配置获取参数。`configCheckFunction` 是 Den 可选扩展，不影响列表/详情函数。

## 测试

不需要安装依赖，Node.js 22 或更新版本：

```
node checks.mjs
```

测试验证字符串 ID、分页、60 集详情零预解析、指定集按需解析、同源限制、参数、清单和空密钥默认值。`node checks.mjs --serve` 在本机 8798 端口启动用于 App 集成检查的合成数据接口；不是内容服务器。实际服务端播放兼容性需要另外验证。

## 许可

新增的适配器、清单、测试和文档使用 MIT 许可。Den 名称与图标用于标识此项目，不代表上游服务或 ForwardWidget 官方授权。
