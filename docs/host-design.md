# dsh-web-visualuiconfig host 端设计文档

> 状态：**阶段 1 + 阶段 3 + 角色风格主题 + skin 纪律重构已实现**（typecheck + build + 139 个测试全绿）。本文是 host 端开发的实现基准与后续阶段的文档锚点。
> 最后更新：阶段 5（保对比度推导 + 引擎重写）实现完成。

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

## 11. 测试（node:test + tsx，139 个用例全绿）

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
- `tests/host/character-tool.spec.ts` — 角色主题工具：参数校验、apply（资产落盘 + 配置叠加 +
  主题库回环）、同名替换、无决策/背景缺图报错、manage list/switch/deactivate/remove 往返、
  主题生命周期资产 GC
- `tests/shared/theme.spec.ts` — 共享主题层纯逻辑：patch 构建（accent/preset/seeds 互斥、
  null 清除、背景/favicon 引用）、激活快照、切换覆盖、关闭还原、删除、findTheme、sanitize
  回环与 dangling active 丢弃
- `tests/shared/color.spec.ts` — OKLab 转换链回环、gamut 拟合、WCAG 对比度锚点（移植自
  deepseek-harness-skin）
- `tests/shared/derive.spec.ts` — 4 色种推导（表面钉住/契约全过/中性阶有序/band 前景/veil
  阶梯/亮暗校正）、bent-stock 边界、resolveToken、auditSkin（移植）
- `tests/shared/extract.spec.ts` — 像素取色（明暗/表面保持/辅色/极值/透明像素/拒绝空图）、
  veil 自动调（默认/抬升/天花板失败）（移植）
- `tests/shared/render.spec.ts` — 属性作用域 CSS 生成（作用域/seeds 注释/可选字段/排序）
  （移植）
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

## 12.1 阶段 4 已实现：角色风格主题

用户给一张动漫角色图 + 一段角色介绍，agent 读图推导主题并应用，产出符合角色风格的
DSH UI。模型是语义引擎（`read_image` 读图 + `read` 读介绍 + 推导决策），插件负责校验、
落资产、叠加、入库。

### 配置模型（`src/shared/config.ts`）

```
config.themes = {
  active: string | null,        // 当前激活的主题 id（同一时刻至多一个生效）
  list: CharacterTheme[],       // 主题库
}
CharacterTheme = {
  id            // th-<djb2(name)>：确定性、ASCII 安全，重启/换浏览器不变
  name          // 显示名（角色名），查找的自然键
  description   // 角色介绍（截断 2000）
  sourceImage   // 角色图 asset 引用（复用 sha256 资产存储）
  createdAt
  patch         // 外观叠加补丁（base/panels/globalBackground/chrome，deepMerge 语义）
  snapshot      // 激活时捕获的外观快照（base/panels/globalBackground/chrome）
}
```

### 语义（`src/shared/theme.ts`，纯函数，两个半区共用）

- **同一时刻至多一个主题生效**。激活 = 先还原上一个激活主题的快照 → 捕获当前外观为新
  快照 → 叠加本主题 patch → 标记 active。切换 A→B 即整体替换；再切回 A 重新应用 A 的
  patch。
- **关闭 = 还原快照**：回到该主题启用前的外观（官方外观），主题仍留在库里可再切换。
- **删除激活中的主题**：先还原其快照再移除。
- **已知限制**：主题激活期间的手动微调不随主题保存——关闭/切换主题会还原到启用前的样子。
- **引擎零改动**：激活把叠加结果烤进 `base/panels/globalBackground/chrome`，引擎照常应用；
  浏览器半区通过 sanitize 自动获得 `themes` 字段。

### 工具（`src/host/character-tool.ts`，经 `ctx.inject(['tools','systemPrompt'])` 懒注册）

- `character_theme`：apply/创建主题。参数 name（必填，自然键，同名即替换）/ description /
  imagePath（存 asset）/ accent / preset / font / transparency / scrollbar / selection /
  background（用角色图做整页背景，默认 false）/ scrim / favicon / title。无图且无任何外观
  决策时报错；background/favicon 需要 imagePath。
- `character_theme_manage`：action list（默认）/ switch / deactivate / remove（后两者需
  name）。list 返回主题清单（含 [active] 标记与描述摘要）。
- **system prompt 指引**（`tool:character-theme`，order 112）：教模型如何从角色图+介绍推导
  主题——accent 取角色标志色（发/眼/服装）并保证对比度；preset 取最接近的色板；font 按
  性格（可爱→rounded、优雅→serif、冷酷/科技→mono）；transparency/scrim 按氛围；默认
  background=false（整页角色图伤可读性）；title 设为角色名。

### 资产 GC

`collectAssetHashes` 除既有字段外，递归扫描 `config.themes`（sourceImage + patch/snapshot
内所有 `asset:` 引用）——未激活的已保存主题图不会被误删；主题删除后随 GC 清理。

### 设置页管理（浏览器半区）

设置页「个性化 → 角色主题」小节（`PersonalizationSection.tsx`）列出全部已保存主题：角色图
缩略图、名称、介绍、[应用 / 关闭主题 / 删除]。操作直接调用 `src/shared/theme.ts` 的纯函数
（`activateTheme` / `deactivateTheme` / `removeTheme`，经 `findTheme` 定位），与 agent 工具
读写同一份 `themes` 文档——浏览器 PUT 与 host 工具在 sanitize 下天然一致。共享层函数因此
被内联进客户端 bundle（`shared/theme.ts` + `shared/patch.ts` 均为环境无关纯 JS）。

小节顶部是**「从角色图生成」向导**（`src/client/character-wizard.ts`）：上传角色图 →
`compressImage` 压缩（复用既有管线）→ 96px 采样 RGBA → `analyzeImagePixels`
（`extractPalette` + `tuneCustomSkin`，纯函数可单测）→ 上传压缩图作资产 → 以 4 色种 +
明暗构建主题并激活。**无模型能力保底**：对话路径在非图像模型下失效时，向导仍可生成种子
主题；可读性审计（`pass`/`veil`）在 `tuneCustomSkin` 内自动完成。

## 12.2 阶段 5 已实现：保对比度推导 + 引擎重写（skin 纪律）

按 deepseek-harness-skin 的纪律重构（决策：引擎按纪律重写 / stock 带生成脚本 / 双轨取色）。

### 移植的纯函数层（`src/shared/`，全部环境无关、MIT 注明出处）

- `color.ts` — OKLab/OKLCh 数学（转换链、gamut 二分、WCAG 亮度/对比度、rgba/复合）。
- `derive.ts` — 4 色种 → 整套 73 级 `--dsw-static-*` 色阶 + brand 角色：中性阶**复刻上游
  对比度**（不是绝对亮度），accent 阶分段重映射钉住主阶；`auditSkin` 8 项可读性契约。
- `extract.ts` — 确定性取色：RGBA 直方图分桶 → 4 色种 + 明暗 + 明暗极值；`tuneCustomSkin`
  自动上调 veil 直到正文对「照片极值复合」达标。
- `render.ts` — 推导结果 → `body[data-dsh-skin]` 属性作用域 CSS。
- `stock.ts` / `stock.generated.ts` — 上游色板数据（73 阶 + 89 语义别名，OKLCh 快照）。

### 生成脚本（`scripts/build-stock.mjs` + `pnpm build:stock`）

从本地 harness 的 `design-platform.css` 提取（`--harness <root>` / `--css <path>` /
`DSH_HARNESS`），产出 `src/shared/stock.generated.ts`；内置 derive+audit smoke 门禁与
`--check` 防漂移。升级 DSH 后需重跑。

### 配置模型（`shared/config.ts`）

- `PaletteSeeds {accent, secondary, surface, text}`；`PanelConfig.palette` 与
  `PanelFollowConfig.palette` 新增 `seeds` + `appearance`（`'light'|'dark'|null`）。
- 4 个内置预设改为**每明暗一套 seeds**（引擎推导两套色板，浏览器按 `data-ds-dark-theme`
  选择）；角色主题携带单一 seeds + 钉住明暗。
- 三者互斥：设置 accent/preset/seeds 任一都会清掉其余（`buildThemePatch` / 设置页均显式
  置 null）。

### 引擎重写（`client/engine.ts`）

- **属性作用域**：全部规则挂 `html body[data-dsh-personal]`（+ `[data-ds-dark-theme]` 明暗
  变体），spec 高于皮肤体系的 `body[data-dsh-<skin>]`；摘属性即完整还原。
- **推导色板**：base/seeds 经 `deriveSkin`（按 seeds+scheme 缓存）生成全套 token 覆盖，
  替换旧的 color-mix accentGroup（保留为纯 accent 快捷路径）；面板级 palette 同级覆盖。
- **钉住明暗**：seeds 主题带 appearance 时改写 body 的 `data-ds-dark-theme`（皮肤同款语义），
  dispose 还原。
- **背景独立 fixed 层**：全局背景改为 `z-index:-1` 的 fixed div（含 scrim 变量），**不再写
  body 内联样式、无 `background-attachment: fixed`**；`[id=root]{background:0 0}` 结构 hack
  替换为仅当全局背景激活时输出的作用域 `background:transparent` 规则；面板 scrim 变量移入
  面板作用域规则（不再写 body）。
- **可读性契约**：推导即审计，`fitAccent` 自动校正（「accent 看不清」类 bug 从机制上消除）。

### 验证

typecheck / build / **139 个测试全绿**（新增 color/derive/extract/render 移植套件 57 例 +
引擎重写用例、seeds sanitize/工具/设置页用例）；`build:stock --check` 无漂移。

## 13. 风险清单

- 路由路径冲突：`/personalization` 干净，无冲突。
- 本机服务绑 127.0.0.1，暴露面小；PUT 限流 + sanitize + 文件名白名单（sha256 正则）
  防任意写入。
- Electron/file:// 平台走 IPC 桥不走 webServer——platform 是 `web`，`storageMode` 天然
  降级，无需特判。
- 需要重启 `dsh web` 生效（link: 安装方式的老规矩）。
- dispose 钩子不得触碰文件（见 §8）。

## 14. 修订历史

- v8（取色向导）：`src/client/character-wizard.ts`（analyzeImagePixels 纯分析 +
  samplePixelsFromDataUrl DOM 采样）；设置页「从角色图生成」UI + locale；测试增至 142。
- v7（skin 纪律重构）：移植 color/derive/extract/render + stock 生成脚本（`pnpm build:stock`）；
  配置模型引入 4 色种 seeds + appearance；引擎重写为属性作用域推导色板 + 背景 fixed 层 +
  明暗钉住，移除结构规则与 body 内联背景；`character_theme` 支持 seeds；测试增至 139。
- v6（角色风格主题已实现）：`config.themes` 主题库（多主题、单激活、快照还原）；
  `src/shared/theme.ts` 纯函数层 + `src/shared/patch.ts`（deepMerge 上移共享，host 侧
  re-export 保路径）；`character_theme` / `character_theme_manage` 工具与推导指引；
  `collectAssetHashes` 纳入主题引用；`renderShow` 显示当前主题；测试增至 76。
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
