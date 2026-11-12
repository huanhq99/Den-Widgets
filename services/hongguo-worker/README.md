# 红果 Cloudflare 部署教程（测试版）

把红果接口和可导入的 JS 一起部署到自己的 Cloudflare Workers。部署后，Den 直接访问你的 Worker，接口不回连 NAS，也不需要电脑一直开机。电脑仅用于下面的安装和部署命令。

**当前为测试版。** 2026-11-12 修正上游单集请求参数与签名后，生产 Worker 在本地真实 workerd 中，同一匿名会话的第 1、2 集均完成整文件传输（约 9.4 MB／8.5 MB）。原生 AVQueuePlayer 通过 Worker 解码两集，首集跳到片尾后自动接播第二集并继续出画。没有重新注册设备绕过换集，也没有使用登录账号。

这个结果修复了此前“第二集空响应”的已测场景，**不等于已验收所有剧集或全天长播**。线上 Cloudflare 0.1.1 已验证两集整文件传输、第一集完整实时播放与自动接入第二集超过 3 秒；未让第二集从头到尾实时播放。旧的自建部署需要更新后才包含修复。

这是保留 [N3urda/hongguoTV](https://github.com/N3urda/hongguoTV) **API v1** 格式的独立 Workers 适配服务，已更新底层匿名注册与签名请求。不是将原 Node 服务直接复制进 CF 编辑器。

## 1. 准备

- 一个 [Cloudflare 账号](https://dash.cloudflare.com/sign-up)，并能够使用 Workers。
- 电脑安装 [Node.js](https://nodejs.org/en/download) 22 或更新版本，以及 [Git](https://git-scm.com/downloads)。
- 能导入普通 ForwardWidget JS／合集的 Den。

macOS 打开“终端”，Windows 打开 PowerShell。以下命令逐条执行，不要把解释文字也复制进去。先检查安装：

```sh
node --version
npm --version
git --version
```

`node --version` 应为 `v22` 或更高版本。若命令不存在，先完成安装并重新打开终端。PowerShell 若提示脚本执行被禁止，可以改用 Windows“命令提示符”，无需为本教程关闭系统策略。

本项目不需要 Docker、Cloudflare Containers、KV、R2 或数据库，也不要求先购买域名。Workers 有 CPU、内存和请求等额度，**不承诺免费套餐能稳定处理整集视频**；实际额度以 [Cloudflare 官方限制](https://developers.cloudflare.com/workers/platform/limits/) 为准。本教程不包含套餐升级操作。

## 2. 下载源码并进入正确目录

```sh
git clone https://github.com/huanhq99/Den-Widgets.git
cd Den-Widgets/services/hongguo-worker
npm ci
npm test
```

本地 0.1.1 应看到全部 **32 项测试通过**；拉取更新后可核对 `package.json` 的版本为 0.1.1。这些测试验证接口、协议和传输逻辑，使用合成数据，不是对所有公网内容的播放保证。

从 GitHub 下载 ZIP 也可以：解压后进入其中的 `services/hongguo-worker` 文件夹，再执行 `npm ci` 和 `npm test`。**要进入这个子目录，不能在仓库首页目录直接部署。** 当前目录应同时看得到 `package.json`、`package-lock.json`、`wrangler.jsonc` 和 `src`。

无需将 `src/worker.mjs` 单个文件粘贴到网页编辑器；它依赖同目录的其他模块和打包配置。

## 3. 登录自己的 Cloudflare

仍在 `services/hongguo-worker` 目录执行：

```sh
npx wrangler login
npx wrangler whoami
```

按浏览器提示登录并授权，回到终端确认是你准备部署的账号。账号有多个账户时，部署命令可能让你选择目标账户。

Wrangler 登录是 Cloudflare 账号授权；后面要设置的 `BRIDGE_TOKEN` 则是给 Den 连接你的接口用的口令，两者用途不同。**不要把 Cloudflare API Token 填到 Den 里。**

## 4. 部署 Worker

默认名称是 `den-hongguo-api`。如同一 Cloudflare 账户已存在这个名称，部署会更新它；希望另建一个服务时，先用文本编辑器打开 `wrangler.jsonc`，仅将 `name` 改成自己的名称，例如：

```json
"name": "my-hongguo-api"
```

名称使用小写英文字母、数字和连字符。保留其余配置，特别是 `main`、`nodejs_compat` 和兼容日期。本项目固定 Wrangler 4.156.0、兼容日期 2026-10-30，使用这组配置完成了真实运行验证。

然后执行：

```sh
npx wrangler deploy
```

第一次使用 Workers 时，按提示创建自己的 `workers.dev` 子域。成功后，终端会输出类似地址：

```text
https://my-hongguo-api.你的子域.workers.dev
```

**记下你实际得到的地址。** 下文的 `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev` 全部要换成它，不要照抄占位地址。此时 API 返回503是正常的：下一步设置访问口令后才会开放。

## 5. 设置访问口令

先在电脑生成一个随机口令：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

将输出的口令保存到自己的密码管理器中，然后执行：

```sh
npx wrangler secret put BRIDGE_TOKEN
```

终端要求输入内容时，粘贴刚才生成的口令，按回车。它可能不会显示输入的字符。成功后，Cloudflare 会保存加密 Secret 并更新部署；不需要把口令写进源码再部署。可查看 Secret 名称是否存在：

```sh
npx wrangler secret list
```

列表应包含 `BRIDGE_TOKEN`，不会显示口令原文。忘记口令时重新执行 `secret put` 设置一个新的，并同步修改 Den 模块参数。

不要把自己的口令写入 `wrangler.jsonc`、JS、公开清单或 GitHub。也不要将 Cloudflare 登录凭据当成这个接口口令。

## 6. 检查部署是否成功

先在浏览器打开自己的合集地址：

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/manifest.json
```

应看到含 `widgets` 数组的 JSON，其中脚本 URL 指向你自己的 `/hongguo.js`。这是合集内容，浏览器显示文本是正常的。

再用终端检查需要口令的健康接口。以下示例中，替换地址和口令；Windows PowerShell 可把 `curl` 写为 `curl.exe`：

```sh
curl -i -A "DenPlayer/1.0" -H "Authorization: Bearer YOUR_ACCESS_TOKEN" "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/health"
```

期望状态为 **200**，JSON 包含 `service: "hongguotv"`、`apiVersion: 1`、`runtime: "cloudflare-workers"`、`status: "preview"`。浏览器直接打开 `/health` 没有带口令时返回 **401**，表示鉴权生效，不代表部署失败。

健康检查只验证连接与配置，不请求或证明内容源可用。

## 7. 导入 Den

1. 打开 **设置 → 模块 → 添加模块 → 通过链接添加**。
2. 粘贴你自己的合集链接：`https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/manifest.json`。
3. 预览并安装 **红果短剧（Cloudflare）**。
4. 打开已安装模块的参数，服务地址会自动填入你的 Worker 地址；在 **访问口令** 中粘贴刚才设置的 `BRIDGE_TOKEN` 值，点击检查连接。
5. 进入模块浏览或搜索。如需放到首页，再去 **设置 → 首页配置** 添加此来源。

也可以直接导入 `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/hongguo.js`，或用同域 `/widgets.fwd` 合集。

这里应导入 **Worker 部署后生成的链接**，不是 GitHub 的 `src/module-template.mjs` 或 `blob` 网页链接。脚本不包含访问口令，分享合集的人仍需分别获得你允许使用的接口口令。

这是独立第三方模块，不会替换已安装的内置红果，也不会自动改掉旧来源的接口参数。使用新模块时确认打开的是“红果短剧（Cloudflare）”。不同 Den 版本的菜单名称可能略有差异；本轮没有验收完整 App 内导入和播放。

## 8. 更新或修改口令

在项目的 `services/hongguo-worker` 目录执行：

```sh
git pull --ff-only
npm ci
npm test
npx wrangler deploy
```

Git 拉取有冲突时，先保留并处理自己修改过的 Worker `name`，不要直接覆盖本地配置。下载 ZIP 的用户可以下载新版，保留自己使用的 `name` 后重新安装、测试和部署。

同一名称的 Worker 更新代码时会保留已有 Secret。若另建名称，需对新 Worker 单独运行 `npx wrangler secret put BRIDGE_TOKEN`。

部署后，已有模块可在模块设置中更新脚本；保持自己的服务地址和口令。更换 Worker 域名时，更新模块地址，或重新导入新地址的合集。单纯修改代码不要求重新创建 Cloudflare 账号。

## 9. 常见问题

| 现象 | 检查与处理 |
| --- | --- |
| `npm ci` 找不到文件、Wrangler找不到配置 | 确认进入 `Den-Widgets/services/hongguo-worker`，不是仓库根目录。 |
| Node 版本过低或命令不存在 | 安装 Node.js 22+，重开终端，再检查 `node --version`。 |
| 没有部署地址或提示未登录 | 重新执行 `npx wrangler login`，检查账号、账户和 Worker 名称。 |
| API 503，提示配置 `BRIDGE_TOKEN` | 在同一个 Worker 项目目录执行 `npx wrangler secret put BRIDGE_TOKEN`。若是并发繁忙提示，稍后再试。 |
| API 401／模块提示口令无效 | Den 中填写的值应与 Worker Secret 一致，无 `Bearer ` 前缀和多余空格；不要填 Cloudflare API Token。 |
| API 429／匿名访问受限 | 上游匿名模型可能已不可用，服务也有有限重试保护；稍后再试。不要通过反复重部署或批量注册掩盖上游拒绝。 |
| API 502／内容源暂不可用 | 上游可能空响应、拒绝访问、超时或返回不支持的媒体封装；不是部署成功就能保证修复。保留错误时间和接口路径便于排查，不公开口令或签名媒体链接。 |
| 403／Cloudflare1010 | 检查响应来自CF还是上游；自测可使用上面的明确客户端UA。不要为绕过一次探测失败关闭账户安全设置。 |
| 模块列表正常，视频仍不能播 | 首页和详情走资料接口，播放还依赖上游模型、媒体与运行时额度；资料成功不代表播放链路成功。 |
| 某网络打不开 `workers.dev` | 先确认当前网络能访问该域名。可以自行绑定可访问的自定义域名，再从新域名导入；本文未验证所有地区和网络。 |

## 10. 目前验证到哪里

2026-11-10：30项自动测试、真实workerd14项传输检查通过；真实Cloudflare返回推荐24项、详情102集、搜索2项，播放准备、HEAD和首MiB Range通过；原生FFmpeg解码出1080×1920 HEVC首帧。最终线上配置6项和Mac Foundation URLSession默认UA3项通过。这些是单次测试记录，不是固定响应速度或全站可用承诺。

2026-11-12（本地 0.1.1）：32 项协议／接口检查通过；真实 workerd 首页 24 项、详情 63 集，同会话两集完整传输通过。AVQueuePlayer 通过 Worker 获得两集时长 112.4／171.8 秒，两集都解码出画，本地首集跳到片尾后自动进入第二集并播放超过 3 秒。线上更新后两集整文件 SHA-256 与本地完全一致，第一集完整播放后自然接入第二集超过 3 秒；两项传输均无丢字节。

**未验收：** 第二集完整实时长播、更多连续集数、暂停后长期重连、所有媒体封装，以及完整 Den App 内导入和播放。首次线上跳到片尾的 80 秒检查未完成接播，原失败已保留；相同参数重测成功。尚未验收长暂停、反复 seek 或所有网络条件。Android客户端或其他ForwardWidget宿主也没有验证。

此前同一匿名设备第二集模型曾返回200空内容；0.1.1 按上游当前 singleVideoModel 协议纠正请求，不混用旧 Medusa/Cookie 请求头。本实现每isolate十分钟最多注册2次，只有空响应允许有限刷新；403／429等明确拒绝立即停止，不无限轮换设备。流描述缓存最多2条、90秒；过期或换集可能再次受限。这个2次预算是本服务的保护值，不是上游官方公布的额度。

媒体按背压读取和解密，不将整片放入内存；生产媒体传输使用单次上游Range请求。每isolate最多4路媒体流并不是账户全球限流。可持续播放仍需可用的上游授权／协议，全站／长播仍需继续验证。

## 本地开发（可选）

在本目录创建仅供本机使用、已被Git忽略的 `.dev.vars`：

```text
BRIDGE_TOKEN="只用于本机的测试口令"
```

执行 `npm run dev`，以终端输出的本地地址测试。这个文件不会自动配置线上Secret，也不应该提交或分享。退出本地开发可按 Ctrl+C；关掉本地命令不影响已经部署的线上Worker。

## 来源与许可

- 外层API v1格式、部分媒体／签名算法：[N3urda/hongguoTV](https://github.com/N3urda/hongguoTV)，固定来源与改动见 [`src/vendor/NOTICE.txt`](src/vendor/NOTICE.txt)。
- 原始部分媒体算法：[woshishiq1/drpys](https://github.com/woshishiq1/drpys)，GPL-3.0来源许可保留。
- 当前注册、请求、密钥协议的参考：[beilunyang/openhongguo](https://github.com/beilunyang/openhongguo)，Apache-2.0来源许可保留。

**本目录的独立后端使用 [GPL-3.0-only](LICENSE)。** 独立Den模块适配器沿用 [MIT](MODULE-LICENSE.txt)。仓库根目录MIT许可不改变本后端及其上游部分的许可；后端不编译进Den App。本教程及服务代码提供部署方法，不提供共享账号、Cloudflare凭据或统一公共访问口令。

Wrangler命令与Secret操作可对照 [Cloudflare部署指南](https://developers.cloudflare.com/workers/get-started/guide/) 和 [Secret说明](https://developers.cloudflare.com/workers/configuration/secrets/)。
