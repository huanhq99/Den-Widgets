# Den Widget SDK 0.2.0

面向模块作者的类型定义、项目模板、离线测试和命令行检查工具。新模块按统一协议编写，App 动态调用声明的函数，避免为每份脚本新增适配分支。

**当前为 0.2.0 开发预览版，暂未发布 npm。** 本版接口对应更新后的 Den App 运行层，App 尚未上传；旧版 App 不会因 SDK 更新自动增加能力。包名 `@denplayer/widget-sdk`，先克隆仓库后使用本地目录。

## 创建模块

需要 Node.js 22 或更新：

```sh
git clone https://github.com/huanhq99/Den-Widgets.git
cd Den-Widgets
node packages/den-widget-sdk/bin/den-widget.mjs init ../my-den-widget --id den.example --title 示例模块
cd ../my-den-widget
npm install
npm test
npm run typecheck
npm run check
npm run build
```

生成 widget.js、fixtures.json、测试、类型配置与说明。项目 SDK 依赖指向本机目录，另装 TypeScript 5.9.3；SDK 自身运行零依赖。换电脑需同步 SDK 或改为本地 SDK 安装包路径。

模板使用 example.invalid，只有固定数据测试可用。修改为自己的授权服务地址和数据映射，再将 dist/widget.js 托管为 HTTPS 原始文件，在 Den 模块管理中导入。

## 编写协议

最终脚本是 classic JS：全局 `WidgetMetadata`、可调用函数，不使用运行时 import／export／require／Node API。JSDoc 的 import 类型标注不会产生运行时依赖。build 验证元数据并复制单文件，不编译 TypeScript 或打包依赖。

模板完整演示：列表 → 搜索 → 详情 → 选中的版本解析。声明示例：

```js
/// <reference types="@denplayer/widget-sdk/env" />
/** @type {import('@denplayer/widget-sdk').Metadata} */
var WidgetMetadata = {
  id: 'den.example', title: '示例', version: '1.0.0',
  modules: [
    {id: 'latest', title: '最新', functionName: 'list'},
    {id: 'detail', title: '详情', functionName: 'loadDetail', type: 'detail'},
    {id: 'play', title: '播放解析', functionName: 'resolve', type: 'stream'}
  ]
};
```

- 列表返回 MediaItem 数组；详情返回 MediaItem 对象。`id` 建议字符串，大整数不要转 number。
- `link` 是待获取的详情／版本链接；`videoUrl` 是已解析的视频地址，不能填网页。`episodeItems` 放分集／版本，`seasons` 放季，`playSources` 放已解析地址及各自的 `customHeaders`。`duration` 单位秒。
- 详情不要解析所有分集。播放前 App 调用 `type: "stream"` 函数，传入条目字段、`item`、`__parameters`，只解析选中条目。
- 任意函数可用 `Provider.list` 命名空间。仅恰好叫 loadDetail 的函数收到宿主字符串转换；其他详情函数明确读取 argument.link。
- 可配置值声明在 globalParams，不把口令固化进公开脚本。完整类型见 [model.d.ts](types/model.d.ts)。

SDK 的明确字段要求面向新作者；App 对旧模块的兼容别名仍保留，不因新 SDK 严格检查被移除。

## 仍待补齐

- iPhone／iPad、Mac、Apple TV 原生端到端验收；现有自动检查运行于 Node。
- Rex 加密模块、弹幕／字幕专用模块调用链和交互式 WebView 不在本次兼容范围。
- npm 分发；当前克隆即用、可本地 npm pack，不需要等 npm 上架。

这些是开发预览版的边界，基础协议、模板和离线调试已经可以使用。

## API 与平台范围

| 能力 | 提供的接口 | 边界 |
| --- | --- | --- |
| HTTP | Widget.http.get／post／head／request、fetch | statusCode／status、字符串 headers、headers.get()、数组 headerValues；base64Data／zlibMode／allow_redirects |
| HTML | Widget.html.load | Cheerio 1.2.0 浏览器 load，支持 eq／map().get()／filter／html 等；保留 DOMParser 和旧节点 getAttribute／textContent |
| DOM | Widget.dom.parse／select／text／attr／remove | App 同一份 DOM 代码 |
| 存储 | Widget.storage.get／getAsync／set／remove／keys／clear | get 保留同步读取，缺省缺失值 null，可直接 await；set／remove／clear 可 await，keys 异步 |
| 共享缓存 | Widget.sharedCache.get／set／remove | namespace＋key 共享 JSON，成功后仅合并变更键；单条64 KiB、总1 MiB、每次256操作 |
| URL | URL／URLSearchParams／atob／btoa | 类型只包含公共子集；TV URL 属性不支持任意修改 |
| 定时器 | iOS／Mac 模拟配置的 setTimeout／clearTimeout | common／TV 无此能力，不写进公共类型 |
| TMDB | Widget.tmdb.get(path, options) | 返回数据；原生层注入凭据，仅允许指定公开路径且不跟随重定向；Node 只用 fixture |
| 小说／漫画／YouTube | denReadingKind／denNativeKind | 原生扩展，非 JS 提供器；Node 不测试原生 UI；common／TV 配置拒绝 |
| CatVod／REXENC | 独立协议／Rex 专有加密 | 此 SDK 不转换、不模拟 |

common 是保守公共子集，ios／mac 是 Node 模拟配置，tv 在 Node 中运行真实 TV bootstrap，底层 URL 仍由 Node 提供。**均不是 WKWebView／Catalyst／QuickJS 真机验证。** 各端安装版本也可能不同，发布模块前分别实际导入、浏览和播放。

宿主限制：脚本 2 MiB、单响应／结果 4 MiB、请求体 512 KiB、每次调用最多 40 请求、总执行 1–45 秒，原生单请求超时 3–45 秒。只支持无内嵌账号密码的 HTTP(S)。Node 网络读取 UTF-8；原生 TLS、URLSession 编码和 Cookie 等行为需另行验证。

## 调试

```sh
node packages/den-widget-sdk/bin/den-widget.mjs check path/to/widget.js --profile tv --json
node packages/den-widget-sdk/bin/den-widget.mjs run path/to/widget.js list --params '{"page":1}' --fixtures path/to/fixtures.json --kind list
node packages/den-widget-sdk/bin/den-widget.mjs build path/to/widget.js --out dist/widget.js
```

check 运行初始化并核对元数据／声明函数，不证明所有分支正确。run 的 --kind list／detail 检查返回格式。默认不联网，fixtures 按完整 URL 和方法精确匹配。真实请求须显式 --allow-origin https://api.example.com，相对地址用 --source-url；不允许跨域重定向自动携带凭据。

测试代码使用 `import {createRunner} from '@denplayer/widget-sdk/testing'`，调用 inspect()、invoke()、getStorage()；见模板测试。fixture 函数接收取消信号，自建 I/O 应响应取消。同步死循环／未完成 Promise 会终止 worker。SDK 默认总执行上限 5 秒，可用 --timeout 调整；Node 网络只受该总预算约束，未模拟原生独立的单请求超时。

**只在本地测试可信脚本。Node vm／worker 不是恶意代码安全沙盒。** 不自动下载执行未知模块。已知 token／Cookie／Authorization 字段及 URL 密钥参数会脱敏，原始脚本异常不输出；任意自定义字段或返回值仍可能含私密数据，不要直接公开测试输出。

方法／大小／缺 fixture 等检查失败直接终止调用；普通传输失败通过真实 HTTP Promise reject，模块可捕获。SDK 返回格式检查失败不提交本次测试 storage；App 的旧格式行为以原生实现为准。

0.2 与 0.1 的差异：headers[name] 现在是 Rex 风格字符串，旧数组读取改用 headerValues[name]；status 与 headers.get() 保留。storage.get(key) 无 fallback 时缺失值变为 null，getAsync 保留原行为。html.load 和 storage.get 仍支持同步调用与直接 await，但不承诺自身有 Promise.then；需要时使用 Promise.resolve(...) 或 getAsync。Cheerio 的 attr 缺失值是 undefined，each 支持链式调用。

共享缓存用于模块主动共享的数据，同一 namespace 不按作者隔离；不要存放账号密码或私有 token。私有 Widget.storage 仍按来源独立。多个 runner 可传入同一个 sharedCache 对象测试跨模块读写；getSharedCache() 可导出快照。

TMDB fixture 按 https://api.themoviedb.org/3/ 的实际路径和参数匹配。App 从既有 TMDB 设置读取凭据，不返回脚本；拒绝绝对地址、路径遍历和 account／authentication 等非公开接口。

## 维护

den-widget-core/2 是开发协议标识，与 App／SDK 版本分别维护。SDK 附真实生产桥接、DOM、TV bootstrap 及源文件 SHA256；维护者有相邻 DenPlayer 工程时运行：

```sh
npm run sdk:sync
npm run sdk:check
npm run sdk:test
```

新 API 先补 App 通用宿主，再更新类型／模板／测试／快照。不要在 SDK 虚构支持，也不要按作者、模块 ID、内容域名加执行白名单。

SDK 原始代码 MIT，DOM 上游完整许可见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)。打包不包含其他服务端工程或私有配置。
