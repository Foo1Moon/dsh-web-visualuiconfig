# dsh-web-visualuiconfig — DSH Web GUI 可视化配置插件

[English](README.md) | 中文

一个可热插拔的 DeepSeek Harness (DSH) Web GUI 独立插件：在官方外观之上叠加一层可开关的可视化配置——背景图、遮罩浓度、半透明面板、主题色板（预设/自定义色）、字体、滚动条、选中色、favicon 与页面标题。样式逻辑在浏览器侧运行；配置默认持久化到 `~/.dsh` 下的本机文件，经插件自有的 `/personalization/*` 路由回传给浏览器，并保留「仅浏览器」回退。插件只通过 `cordis.patch.yml` 与 profile 机制挂载，不修改 DSH 源码。

![个性化设置页](docs/screenshots/Config.png)

## 能力

| 能力 | 说明 |
| --- | --- |
| 背景设置 | 每个面板（「全部面板」与单面板统一）都有「背景设置」：**纯色背景**（默认，面板显示底色，透明度仍可调半透明效果）或**背景图**（上传图按面板宽高比自动裁剪，渲染在该面板层级，遮罩可调）。「全部面板」上传是**源图桥**：只压缩不裁剪，各面板渲染时按自身宽高比 cover 裁剪；面板是否显示它取决于自身背景的「跟随主题」开关（存在独立背景的面板会给出提示） |
| 全局背景 | 编辑目标之外的页面级分组：整页**底层**背景图（渲染在 body），与各面板背景独立；面板没有自己的背景图时透出它，面板有自定义背景图时盖住它 |
| 面板透明度 | 0–0.9 滑块：0 = 官方不透明（背景图被面板完全遮住），向右面板越透明、背景图越透出；浮层（菜单/弹窗/输入）保持更高不透明度保证可读。不做 `backdrop-filter`：官方列容器上的 blur 会困住 fixed 浮层（设置弹窗等），这是 dsh-web-ui 皮肤体系验证过的边界 |
| 主题色板 | 4 个预设（海洋青 / 紫罗兰 / 暖橙 / 玫瑰红）+ 自定义 accent（`color-mix` 派生全档位），覆盖 `--dsw-static-deepseek-*` 与 aionui 面板的 `--aion-*` token，亮/暗自动适配 |
| 字体 | 圆润 / 衬线 / 等宽预设，或自定义 `font-family` 栈 |
| 滚动条 | 圆角滚动条，亮/暗两套配色 |
| 选中色 | 自定义 `::selection` 背景色 |
| 页面外观 | favicon（≤128px 图）与页面标题覆盖 |
| 面板级个性化 | 运行时检测当前存在的面板，「编辑目标」选单默认「全部面板」编辑基准外观（各面板的「跟随主题」开关继承它）；每个模块（面板透明度/主题色板/字体/滚动条/选中色/背景设置）都有「跟随主题」开关——单面板视图控制该面板该项，**「全部面板」视图批量控制所有面板的该项**；另有「全部跟随主题」总开关（两种视图都有）。当前面板：侧边栏、对话区、详情区、右侧文件/预览面板（aionui）、任务面板、SSH 面板 |
| 配置存储 | 设置页「配置存储」小节选择配置保存位置：**跟随本机**（默认——宿主侧持久化到 `~/.dsh/dsh-web-personalization.json`，重启仍生效且**换浏览器也跟随**）或**仅此浏览器**（原始的 `localStorage` 行为）。背景图作为文件存于 `~/.dsh/personalization/`，以短同源 URL 提供，不再受 localStorage 配额与 2MB CSS `url()` 限制 |
| 角色风格主题 | 给一张动漫角色图 + 一段角色介绍，agent 读图推导 **4 个色种**（accent/secondary/surface/text）+ 明暗 + 字体/透明度/滚动条/选中色/背景/标题，经 **OKLab 保对比度推导**（移植自 deepseek-harness-skin）生成整套 `--dsw-*` 色阶覆盖并应用。**两阶段确认制**：先给出 2-3 套候选方案与用户讨论，用户明确确认后才应用。主题存入库（`themes`），可随时切换/关闭/删除；关闭即还原启用前的官方外观 |

## 效果预览

背景图效果（前 / 后）：

| 背景图前 | 背景图后 |
| --- | --- |
| ![背景图前](docs/screenshots/before.png) | ![背景图后](docs/screenshots/after.png) |

在设置页中上传背景图：

![上传背景图](docs/screenshots/bgp.png)

## 安装

链接本地源码用于开发调试，安装后**重启 `dsh web`**：设置 → 设置面板左侧会出现「个性化」页面。

```sh
### 从本地源码安装（开发调试）
dsh plugin --profile web add link:C:/path/to/dsh-web-visualuiconfig
```

### 用 Agent 安装

不想手动敲命令的话，直接在 DSH 对话里让 agent 帮你装：它会克隆仓库、以 `link:` 方式挂载进 web profile，并提醒你重启 `dsh web`：

> 帮我安装 dsh-web-visualuiconfig 插件。

agent 实际执行的命令等价于：

```sh
git clone https://github.com/Foo1Moon/dsh-web-visualuiconfig.git
dsh plugin --profile web add link:<克隆到的路径>
```

## 配置存储

配置默认**跟随本机**：宿主侧持久化到 `~/.dsh/dsh-web-personalization.json`（图片作为文件存于 `~/.dsh/personalization/`），并经 `/personalization/*` 路由提供给任意浏览器——重启 `dsh web` 后仍生效，换浏览器或换电脑也跟随。设置页「配置存储」小节可切换为**仅此浏览器**（保留原始 `localStorage` 行为；`dsh.personalization.v1` 键始终作为缓存写入）。宿主侧不可用时（如升级后尚未重启），浏览器侧会透明降级为仅浏览器持久化。

无需修改 `~/.dsh/settings.yaml`，也不受 `dsh-host-apiproxy` 的 `WEB_SETTINGS_NAMESPACES` 白名单限制——插件自持配置文件和路由。

**卸载清理**：插件 dispose 不会删除配置文件与图片目录（否则每次重启 `dsh web` 都会误删）。需要清理时，手动删除 `~/.dsh/dsh-web-personalization.json` 与 `~/.dsh/personalization/`，或调用一次 `POST /personalization/uninstall`。

## 程序化控制

不经 GUI 即可驱动设置的四条通路（所有变更经 SSE 实时广播到所有打开的标签页）：

- **Agent 工具**——模型从自然语言即可改主题（「把主题改成暖橙」「设这张图为背景」）：agent
  看到结构化参数的 `personalization` 工具（`accent` / `preset` / `transparency` / `font` /
  `storage` / `backgroundImage` / `removeBackground` / `enabled` / `reset`），调用即生效。
  角色主题走 `character_theme`（应用/创建）与 `character_theme_manage`（list/switch/
  deactivate/remove）两个工具，见下一节。
- **HTTP**——完整接口：`GET|PUT|PATCH /personalization/config`、`POST /personalization/reset`、
  `PUT /personalization/assets`（原始图片字节，`Content-Type: image/jpeg|png|webp|gif`）。
  `PATCH` 深合并部分更新，agent/脚本只需发送改动字段：
  ```sh
  curl -X PATCH -H 'content-type: application/json' \
    -d '{"base":{"palette":{"accent":"#ff8800"}}}' \
    http://127.0.0.1:3080/personalization/config
  ```
- **命令**——对话输入框直接敲 `/personalization`（不经模型）：`show`、`set accent #hex`、
  `set preset ocean|violet|ember|rose`、`set glass 0-0.9`、`set font default|rounded|serif|mono`、
  `set storage host|browser`、`background set <本地图片路径>`、`background remove`、`reset`。
- **服务**——其他插件 `inject: ['personalization']` 即可调用 `read()` / `update(patch)` /
  `reset()` / `onUpdated(cb)`。

## 角色风格主题

给出一张动漫角色图 + 该角色的介绍，就能把 DSH Web GUI 调成这个角色的风格：

> 帮我用这张图做一个「芙莉莲」主题：图在 `C:\pics\frieren.png`。她是千年精灵魔法使，
> 温柔、悠长、淡雅。

agent 按**两阶段确认制（先提案、确认后才应用）**工作：

1. `read_image` 读角色图、`read` 读介绍（**需要当前模型支持图像输入**）；
2. **阶段一 · 提案（不应用）**：推导 **2-3 套候选方案**，每套切入点不同（发色 / 瞳色 / 服装…），
   并完整给出：**4 个色种**（accent 取该切入点标志色，保证面板对比度；secondary 第二声音色；
   surface 页面底色；text 文字色锚点）+ 明暗（appearance，激活时钉住界面明暗）、字体按性格
   （可爱/软萌→`rounded`、优雅/古典→`serif`、冷酷/科技→`mono`）、透明度与遮罩按氛围、滚动条
   与选中色是否随色板，以及一句气质总结；**默认不用角色图做背景**（整页角色图伤可读性，显式
   要求 `background` 才用）、标题设为角色名。然后**把候选方案交给用户挑选**，此时不动界面；
3. **阶段二 · 讨论与确认**：用户挑选一套或给出反馈（太暗/太粉/太圆润…），按反馈自动重推迭代，
   **用户明确确认前绝不调用 `character_theme`**，界面不被改动；只有用户明确说「直接做吧/你定」
   时才跳过提案、按单一推荐方案直接实施；
4. **阶段三 · 实施**：确认后才调 `character_theme`（**seeds 优先于单一 accent**——引擎从 4 色种
   保对比度推导整套色阶）应用并存入库；应用后仍可微调（主色/透明度/字体）或关闭还原，
   `character_theme_manage` 可 list / switch / deactivate / remove。设置页的本地提取向导遵循
   同一规则：先展示提取出的方案预览，用户确认后才应用。

**引擎按 skin 纪律工作**：4 色种经 `deriveSkin` 在 OKLab 空间推导整套 73 级 `--dsw-static-*`
色阶（中性阶复刻上游对比度、accent 阶钉住主阶），全部规则挂在 `html body[data-dsh-personal]`
属性作用域下，**不碰任何布局结构规则**；全局背景走独立 fixed 层，不再写 body 内联样式。
**可读性契约**（正文 4.5 / 描边 3 / 按钮文字 4.5 等）在推导时审计，不达标自动校正——「模型
给的 accent 看不清」类问题从机制上消除。

行为语义：

- **同一时刻至多一个主题生效**：切换 A→B 整体替换 A 的外观；关闭（deactivate）还原到
  启用前的官方外观，主题仍留在库里可再切换。
- **同名重复应用 = 替换**该主题（patch 更新并重新激活）。
- 主题图复用 sha256 资产存储（sourceImage）；删除主题后其图随 GC 清理。
- 激活会把外观叠加烤进 `base/panels/globalBackground/chrome`——浏览器引擎直接生效，设置页
  显示的就是生效后的值。
- **设置页「个性化 → 角色主题」小节**：列出全部已保存主题（含角色图缩略图与介绍），可
  直接「应用 / 关闭主题 / 删除」，与对话里的 `character_theme_manage` 完全等价（同一份
  `themes` 文档）。

## 与皮肤体系的关系

本插件与 `dsh-skins` 皮肤（如蓝色幻想）互不冲突：皮肤是整站换肤（含背景），本插件是可视化配置叠加层，二者都以 **body 属性作用域 CSS** 工作（本插件挂在 `html body[data-dsh-personal]` 下，spec 特异性高于皮肤的 `body[data-dsh-<skin>]`），不写 body 内联样式。同时启用时以后写入者/更高特异性者为准。关闭本插件的「启用个性化」开关即完整还原官方外观。

## 开发

```sh
pnpm install
pnpm build:stock -- --harness <deepseek-harness-root>  # 生成 stock.generated.ts（升级 DSH 后重跑）
pnpm build      # 产出 lib/index.js（宿主半区）与 lib/client.js（浏览器 bundle）
pnpm watch      # 增量构建
pnpm typecheck  # tsc --noEmit
pnpm test       # node:test + tsx（无需 vitest）
```

结构：

```
src/index.ts                    # 宿主半区：挂载 store + 资产存储 + 路由（webServer 服务）
src/host/store.ts               # ~/.dsh/dsh-web-personalization.json：原子写、损坏备份、revision
src/host/assets.ts              # ~/.dsh/personalization/ 图片文件：sha256 命名、白名单、GC
src/host/routes.ts              # /personalization/* 路由、SSE 版本通道、uninstall 清理
src/host/commands.ts            # /personalization 命令（经 ctx.inject 懒注册）
src/host/tool.ts                # personalization agent 工具（经 ctx.inject 懒注册）
src/host/character-tool.ts      # character_theme / character_theme_manage 工具 + 推导指引
src/host/patch.ts               # deepMerge 部分更新（re-export 共享实现，保历史路径）
src/host/types.ts               # webServer/commands/personalization 服务的最小类型桥
src/shared/config.ts            # 配置模型 + sanitize + storageMode + asset 引用 + 主题库/色种类型
src/shared/theme.ts             # 主题库纯逻辑：激活/切换/关闭/删除/快照还原/patch 构建
src/shared/patch.ts             # deepMerge（环境无关，两个 bundle 内联）
src/shared/color.ts             # OKLab/OKLCh 色彩数学（移植自 deepseek-harness-skin，MIT）
src/shared/derive.ts            # 4 色种 → 全套 --dsw-* 色阶推导 + 可读性契约审计
src/shared/extract.ts           # 像素取色（直方图 → 4 色种 + 明暗 + 极值）+ veil 自动调
src/shared/render.ts            # 推导结果 → 属性作用域 CSS 文本
src/shared/stock.ts             # 上游色板数据类型（StockStep/StockData）
src/shared/stock.generated.ts   # 生成数据：73 阶色阶 + 89 语义别名（scripts/build-stock.mjs 产出）
src/client/index.ts             # 浏览器半区：注册设置页、接线引擎与 host 同步（SSE）
src/client/engine.ts            # 生效引擎：属性作用域推导色板/背景 fixed 层/字体/滚动条/选中/chrome
src/client/settings.ts          # 共享模型之上的 localStorage 缓存（旧版迁移在 shared/config.ts）
src/client/host.ts              # 浏览器 → host 传输层（fetch 封装）
src/client/PersonalizationSection.tsx  # 设置页组件
src/client/image.ts             # 图片压缩（canvas → JPEG data URL）
src/client/locales.ts           # zh / en 文案
scripts/build-stock.mjs         # 从本地 harness design-platform.css 生成 stock.generated.ts
```

## 已知限制

- 「仅此浏览器」模式下，配置只存浏览器 localStorage：换浏览器/换电脑不跟随；且 localStorage 配额（约 5MB）限制可保存的大背景图数量。默认的「跟随本机」模式下图片落盘，不受配额限制。
- 背景图经短 `blob:` URL（data URL）或直接 host URL（`asset:` 引用）渲染：Chromium 的 CSS 解析器会静默丢弃超过 2MB 的 `url()` 值，因此引擎在 apply 时把存储的 data URL 解码为 Blob；host 资产是短同源 URL，天然不受此限制。
- 宿主侧改动需要**重启 `dsh web`** 生效；重启前浏览器侧透明降级为仅浏览器存储。
- 角色主题的对话路径**依赖模型图像能力**（`read_image`）：当前模型不支持图像输入时该工具
  会报错提示切换图像模型；**设置页「从角色图生成」向导是无需模型的能力保底**（浏览器本地
  提取 4 色种 + 保对比度推导，`src/client/character-wizard.ts`），同样**先展示方案预览、
  用户确认后才应用**。
- 主题激活期间的手动微调**不随主题保存**：关闭/切换主题会还原到该主题启用前的样子。
- 钉住明暗（appearance）的角色主题会改写 `data-ds-dark-theme` 属性：主题生效期间切系统
  明暗可能被主题覆盖，需重开主题或关闭后恢复。
- 插件无宿主首帧注入（`tapIndex`）能力：主题在插件加载后才生效，首帧可能有短暂闪烁。
- **诊断日志**：浏览器引擎每次应用配置都会把可疑参数（palette/glass/font/背景/明暗钉住）、
  生成的 CSS 与实时布局实测节流上报到 `~/.dsh/personalization-diagnostics.jsonl`
  （`POST /personalization/diagnostics`，保留最近 40 条）。复现布局问题时把该文件交给
  agent 即可诊断。
- `stock.generated.ts` 与 harness 的 `design-platform.css` 版本绑定：升级 DSH 后需重跑
  `pnpm build:stock -- --harness <deepseek-harness-root>`（`--check` 可校验漂移）。
- 「编辑目标」的面板列表在设置页挂载时检测一次：aionui 右侧面板在项目会话打开后才出现，需重开设置页才能选中它。
- 面板透明度在「背景图」模式下效果最明显；纯色背景下效果较微弱（页面会给出提示）。
- 皮肤与本插件同时启用时以后写入者为准；关闭「启用个性化」总开关可完整还原官方外观。

## 版权

代码部分 MIT。请勿打包你没有使用权的美术素材。
