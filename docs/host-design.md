# dsh-web-visualuiconfig host 端设计文档

> 状态：**阶段 1 + 阶段 3 已实现**（typecheck + build + 50 个测试全绿）。本文是 host 端开发的实现基准与后续阶段的文档锚点。
> 最后更新：阶段 3（Agent 可编程）实现完成。

## 1. 背景与动机

当前插件为纯浏览器侧架构：全部逻辑在 `src/client/`，配置持久化到 `localStorage`
（键 `dsh.personalization.v1`），host 半区（`src/index.ts`）是空壳 `apply()`，只占一个
cordis 插件位。该架构有四个结构性限制：

| 限制 | 现状 | host 端解决方式 |
| --- | --- | --- |
| 配置不跨浏览器/机器 | 只存 `localStorage` | 配置落盘到 `~/.dsh`，host 权威 |
| localStorage 配额（~5MB） | 背景图压缩后仍可能逼近配额，超限静默降级 | 图片存文件系统 |
| 2MB CSS `url()` 限制 | 需 blob URL hack（data URL 解码为 Blob） | 图片以稳定短 URL 静态服务，直接绕过 |
| 配置不可被 agent/脚本读写 | 数据在浏览器内，外部无入口 | HTTP API + cordis 服务 + 命令 |

## 2. 设计原则与已核实的宿主侧能力

### 2.1 原则

- **零补丁、零白名单**：不走 `settings.yaml` 官方通道（`WEB_SETTINGS_NAMESPACES` 是
  `packages/host/apiproxy/src/api-proxy.ts` 里的硬编码白名单，web 客户端只能读写名单内
  命名空间）。配置用插件自有 JSON 文件 + 自有 `/personalization` 路由，与 README 既有判断一致。
- **向后兼容**：纯浏览器（localStorage）路径完整保留为缓存与回退；旧配置升级无感迁移。
- **复用官方基础设施**：原子写、home 路径解析、命令注册全部用 `@deepseek-ai/*` 现成包。

### 2.2 已核实的宿主侧 API（实现依据）

| 能力 | API | 出处 |
| --- | --- | --- |
| HTTP 路由 | `ctx.webServer.register({ kind: 'exact'\|'prefix', path, handler })`，返回 disposer；handler 为原生 `node:http (req, res)` | `packages/host/webserver/src/index.ts`（`client-hmr` 同款用法） |
| WebSocket 升级 | `ctx.webServer.registerUpgrade({ path, handler })` | 同上 |
| 原子写文件 | `writeFileAtomic(path, content, { mode, dirMode })`（tmp+rename）；`withFileLock()`（跨进程写锁） | `@deepseek-ai/dsh-atomic-write` |
| 定位 ~/.dsh | `resolveDshHome()`（`DSH_HOME` → `~/.dsh`） | `@deepseek-ai/dsh-home-paths`（`attachment-local` 在用） |
| 命令注册 | `ctx.commands.register({ name, description, input: { hint }, handler })`，`inject: ['commands']` | `packages/goal/command-goal`（`/goal` 同款） |

### 2.3 依赖变更（实现注记：零外部依赖）

**实现采用零外部依赖路线**：开发机无 pnpm、npm registry 不可达（装不了新包），且 web
profile 的 node_modules 不携带 `@deepseek-ai` 宿主包，因此 host 半区只使用 Node 内置模块
（`node:fs` / `node:crypto` / `node:os` / `node:path` / `node:http` 类型）+ 运行时由 web
组合提供的 `ctx.webServer` 服务（`web-app` 自身即 `inject: ['webServer']`，已核实）。
`writeFileAtomic` 与 `resolveDshHome` 为本地自实现（同协议，约 20 行），`webServer` 类型
经 `src/host/types.ts` 的 cordis Context 增强声明（type-only，运行时零引用，build 产物
已验证无 `@deepseek-ai` 运行时导入）。

- 不新增 peerDependencies / devDependencies。
- 测试 runner 用 `node:test` + `tsx`（`node --import tsx --test "tests/**/*.spec.ts"`），
  不引入 vitest。

## 3. 存储设计（`src/host/store.ts`）

```
~/.dsh/dsh-web-personalization.json
{
  "schemaVersion": 1,   // 文件格式版本，未来不兼容变更时迁移
  "revision": 42,       // 单调递增写计数：SSE 同步 / 冲突检测
  "savedAt": "…",       // 最后写入时间（ISO）
  "config": { … }       // PersonalizationConfig，经 sanitizeConfig 清洗
}
```

- **写入**：`writeFileAtomic(path, json, { mode: 0o600, dirMode: 0o700 })`——临时文件 +
  rename，读者永远看到完整旧或完整新内容；Windows 下 Node rename 可覆盖已存在文件。
- **读入**：JSON parse 失败 → 坏文件改名备份为 `.corrupt-<ts>.json` → 回退进程内缓存的
  「上次好值」→ 都没有则默认配置；成功 → `sanitizeConfig` 清洗。
- **并发**：单 dsh 实例内用一条 promise 链串行化写；`withFileLock` 兜底多实例边缘场景。
- **进程内状态**：`{ revision, config, subscribers }`，写后广播给 SSE 订阅者。

## 4. 路由 API 设计（`src/host/routes.ts`）

| 路由 | 方法 | 请求 | 响应 | 说明 |
| --- | --- | --- | --- | --- |
| `/personalization/config` | GET | — | `200 {revision, config}` 或 `404`（文件从未写入） | 404 时客户端用 localStorage/默认值 |
| `/personalization/config` | PUT | JSON 配置文档（限 1MB） | `200 {revision, config}`（sanitize 回显） | 服务端二次清洗；`413` 超限、`400` 非法 |
| `/personalization/reset` | POST | — | `200 {revision}` | 写入默认配置 + 触发资产 GC |
| `/personalization/assets` | PUT | 原始图片字节（限 ~10MB） | `200 { id: 'asset:<sha256>.<ext>', url }` | 存 `~/.dsh/personalization/<sha256>.<ext>`；MIME 白名单（jpg/png/webp/gif），非 PUT → 405 |
| `/personalization/assets/:id` | GET | — | 文件流 + `Cache-Control: immutable` | 文件名严格校验（`<64位hex>.<ext>`），防路径穿越 |
| `/personalization/events` | GET | — | SSE 通道 | 每次写后广播 `data: {revision}`（不带全量配置） |
| `/personalization/uninstall` | POST | — | `200` | 显式清理：删除配置文件 + 资产目录（见 §8） |

路由以 `prefix: '/personalization'` 注册，与现有 `/plugins`、`/api` 不冲突（最长前缀匹配
亦安全）。需要工具函数 `readJsonBody(req, { maxBytes })`：node:http 无内置 body 解析，
手动累计 chunk、超限即 413 中止、校验 Content-Type。

### 4.1 asset 引用格式（不改配置 schema）

图片字段保持 `string | null`，用前缀区分：

- `'asset:<sha256>'` → 引擎渲染为 `url('/personalization/assets/<sha256>.<ext>')`
  （普通短 URL，直接绕过 2MB CSS 限制，无需 blob hack）
- `'data:…'` → 现有 blob 解码路径（纯浏览器模式保留）
- `null` → 无背景

**GC**：每次 PUT config / reset 后，扫描配置内所有 `asset:` 引用，删除
`~/.dsh/personalization/` 下无引用的文件。多面板共享同一张源图只存一份。

## 5. 客户端改造设计

- **加载时序**：首帧仍同步读 localStorage（无闪烁）；挂载后异步
  `GET /personalization/config`，revision 更新则应用 + 重渲染。离线 / host 不可用 /
  404 → 完全回退现状。
- **存储模式**（设置页新增「配置存储」小节）：`仅此浏览器` / `跟随本机`。
  - 默认 `'host'`（决策 D1，见 §9）；`storageMode` 字段存入配置文档，sanitize 默认 `'host'`。
  - 旧 localStorage 文档无该字段 → sanitize 补 `'host'` → 自动迁移（见 §6）。
- **保存流**：`saveConfig` 先写 localStorage（缓存），host 模式下 debounce 300ms 后 PUT；
  PUT 失败 → 本次会话降级浏览器模式 + 设置页提示，下次保存重试。
- **上传流**：host 模式下 `image.ts` 压缩后 PUT 原始字节到 host 拿 `asset:` 引用；
  浏览器模式走现有 data URL 路径。

## 6. 启动自动迁移时序（默认 host 模式）

```
客户端挂载：
  1. 同步读 localStorage（首帧立即渲染）
  2. 异步 GET /personalization/config
     ├─ 200 → revision 更新则应用并重渲染（host 权威）
     └─ 404（host 无文件）→
          ├─ localStorage 有配置 → PUT 播种到 host（自动迁移），此后 host 权威
          └─ localStorage 空 → 保持默认配置，不建文件，首次保存时才 PUT

模式切换：
  host → browser：停止写 host，localStorage 权威；host 文件保留为快照（卸载时才清）
  browser → host：立即把 localStorage 配置 PUT 播种
```

向后兼容关键点：旧文档自动补 `storageMode: 'host'` 并播种，用户无感；
`dsh.personalization.v1` 键继续作为缓存，纯浏览器回退路径（离线/Electron）始终可用。

## 7. 多标签页同步（SSE，纳入阶段 1）

客户端 `EventSource('/personalization/events')`，收到 `{revision}` 大于本地 → 重新 GET
应用。host 侧仿 `client-hmr` 的 `/plugins/events` 通道（约 20 行）。额外收益：阶段 3 的
agent/命令改配置后所有打开的标签页自动刷新——这是 BroadcastChannel（纯浏览器方案）
做不到的，故选 SSE。

## 8. 卸载清理（决策 D3 修正版：显式 uninstall 接口）

**不要**把文件删除挂在 `ctx.effect` dispose 钩子上——该钩子在插件重载和进程优雅退出时
也会执行，会导致每次 `dsh web` 重启误删用户配置。

- dispose 钩子只清理运行时状态：注销路由（`register` 返回的 disposer）、关闭 SSE 连接、
  释放 watcher，**永不碰文件**。
- `POST /personalization/uninstall`：删除 `~/.dsh/dsh-web-personalization.json` +
  `~/.dsh/personalization/` 目录；删除前校验路径前缀，只允许删自己的目录。
- README 卸载章节：说明清理方式（调用接口或手动删除两个路径）；残留文件无害且体积小。

## 9. 决策记录

| 编号 | 决策 | 结论 |
| --- | --- | --- |
| D1 | 存储模式默认值 | 默认「跟随本机」并自动迁移（升级无感） |
| D2 | 多标签页同步 | SSE 纳入阶段 1 |
| D3 | 卸载清理 | 显式 `POST /personalization/uninstall` 接口，dispose 不删文件 |
| D4 | 阶段 1 范围 | 完整闭环：API + 客户端接入 + 设置页 UI + SSE |

## 10. 阶段 1 交付清单（文件级）

```
新增：
  src/host/store.ts        # JSON 读写（自实现原子写）、损坏备份恢复、revision 管理
  src/host/assets.ts       # 图片落盘（sha256 命名白名单）、静态读取、GC 实现
  src/host/routes.ts       # /personalization 路由 + readJsonBody 工具 + SSE 通道 + uninstall
  src/host/types.ts        # webServer 服务的最小类型增强（零运行时依赖）
  src/shared/config.ts     # PersonalizationConfig 类型 + sanitizeConfig + storageMode
                           # + assetRef 解析（两个 bundle 共用，环境无关）
修改：
  src/index.ts             # apply(ctx)：inject ['webServer']，挂载 store/routes/assets，
                           # dispose 只清理运行时状态
  src/client/host.ts       # 浏览器 → host 传输层（fetch 封装，防御旧宿主回退）
  src/client/settings.ts   # 共享模型之上的 localStorage 缓存（STORAGE_KEY/load/save）
  src/client/image.ts      # （无需改动：上传分流在 PersonalizationSection 完成）
  src/client/engine.ts     # asset: 前缀 → url('/personalization/assets/...')（免 blob）
  src/client/PersonalizationSection.tsx  # 「配置存储」小节 + host 上传 + 缩略图 URL 解析
  src/client/index.ts      # 挂载时拉取 + 空 host 播种 + EventSource 订阅 SSE
  src/client/locales.ts    # zh/en 新文案
  package.json             # "test": node --import tsx --test（无新依赖）
  README.zh.md / README.md # 存储语义变更 + 卸载清理说明
```

> 注：client/image.ts 未改动——压缩仍产出 data URL，由设置页在 host 模式下调用
> `uploadImage()` 换为 `asset:` 引用；engine 的 data URL blob 路径保留（浏览器模式）。

## 11. 测试（node:test + tsx，50 个用例全绿）

- `tests/host/store.spec.ts` — 读写回环、损坏文件→备份+默认、revision 递增、并发写串行化、
  reset、uninstall
- `tests/host/patch.spec.ts` — deepMerge 语义（递归合并/undefined 跳过/null 清除/不动 base）、
  store.patch 合并与 sanitize
- `tests/host/assets.spec.ts` — save/read 回环、MIME 白名单 415、文件名校验、GC
- `tests/host/routes.spec.ts` — 真实 loopback HTTP：GET 404→PUT→GET、PATCH 深合并、400/413、
  reset 清资产、assets 回环与 415、路径穿越 404、405、SSE 广播、GC、uninstall
- `tests/host/commands.spec.ts` — 命令语法解析（合法/非法）、normalizeHex、runner 全操作
  （含本地图片文件路径、错误路径、reset）
- `tests/host/tool.spec.ts` — 工具参数校验（归一化/拒绝）、execute 全操作（组合 patch、
  无参摘要、本地背景图、错误路径、reset、removeBackground）
- `tests/client/shared.spec.ts` — sanitize（storageMode 默认/保留、剥离、legacy 迁移）、
  asset ref 解析
- `tests/client/engine.spec.ts` — jsdom：asset 背景渲染为短 URL、data URL 走 blob、
  favicon 类型/URL、面板背景规则、dispose 全还原

## 12. 阶段 3 已实现：Agent 可编程

四条程序化通路，全部实时广播（SSE）到所有打开的标签页：

1. **HTTP `PATCH /personalization/config`**（新增，agent/脚本最简路径）：body 为部分更新，
   host 深合并进当前文档（`src/host/patch.ts` 的 `deepMerge`：普通对象递归合并、`undefined`
   跳过、`null` 清除）→ sanitize → 写盘 → GC。agent 用 pwsh/bash 一条命令即可：
   `Invoke-RestMethod -Method Patch -Body '{"base":{"palette":{"accent":"#ff8800"}}}' .../personalization/config`；
   图片走 `PUT /personalization/assets`（本地文件字节）再 PATCH 引用。
2. **命令 `/personalization`**（`src/host/commands.ts`，经 `ctx.inject(['commands'])` 懒注册，
   不阻塞 apply）：`show`（默认）/ `set accent #hex` / `set preset ocean|violet|ember|rose` /
   `set glass 0-0.9` / `set font default|rounded|serif|mono` / `set storage host|browser` /
   `background set <本地图片路径>`（进程内读文件→存 asset→应用）/ `background remove` / `reset`。
   解析是纯函数（可单测），执行直接操作 store + assets，不经过 HTTP。
3. **cordis 服务 `ctx.personalization`**（`ctx.provide` 普通对象，随插件 fiber 销毁）：
   `read()` / `update(patch)`（深合并）/ `reset()` / `onUpdated(cb)`；其他插件
   `inject: ['personalization']` 即可用。
4. **agent 工具 `personalization`**（`src/host/tool.ts`，经 `ctx.inject(['tools','systemPrompt'])`
   懒注册）：模型说一句中文即可改主题。结构化可选参数（accent / preset / transparency /
   font / storage / backgroundImage / removeBackground / enabled / reset），映射为深合并 patch；
   标量校验抛描述性错误供模型重试；无参数调用返回当前配置摘要。定义是裸对象
   （`parameters` 与 `output.schema` 为已编译 JSON Schema——`defineTool` 的 spec→schema
   编译在 harness 包内，本插件不 import 它）。新工具默认放行（`tools/pre-execute` 无
   gate 时默认 `{ kind: 'allow' }`），无需审批。

> 命令 DSL 与工具的参数 id 同源（`commands.ts` 导出的 PRESET_IDS / FONT_IDS，与客户端
> 引擎的 PALETTE_PRESETS / FONT_PRESETS 镜像，host 不 import 客户端代码）。

## 13. 风险清单

- 路由路径冲突：`/personalization` 干净，无冲突。
- 本机服务绑 127.0.0.1，暴露面小；PUT 限流 + sanitize + 文件名白名单（sha256 正则）
  防任意写入。
- Electron/file:// 平台走 IPC 桥不走 webServer——platform 是 `web`，`storageMode` 天然
  降级，无需特判。
- 需要重启 `dsh web` 生效（link: 安装方式的老规矩）。
- dispose 钩子不得触碰文件（见 §8）。

## 14. 修订历史

- v5（agent 工具已实现）：`personalization` tool（`src/host/tool.ts`，裸定义 + 已编译 JSON
  Schema，懒注入 tools/systemPrompt）；`PRESET_IDS/FONT_IDS/renderShow` 从 commands 导出复用；
  测试增至 58。
- v4（阶段 3 已实现）：`PATCH /personalization/config`（deepMerge 部分更新）；`/personalization`
  命令（show/set/background/reset，懒注册不阻塞 apply）；`ctx.personalization` 服务；测试增至 50。
- v3（阶段 1 已实现）：零外部依赖 host；`src/host/types.ts` 类型桥；测试改 node:test + tsx；
  `GET /personalization/assets` 非 PUT → 405；sanitizeConfig 修复「提供 base 时被 legacy 覆盖」；
  浏览器模式不采纳/不播种 host；README 与本文档同步。
- v2（定稿）：纳入决策 D1–D4；修正卸载清理为显式 uninstall 接口；补自动迁移时序。
- v1：初版方案（存储 + 路由 + assets + 客户端改造 + SSE + 阶段 3 预告）。
