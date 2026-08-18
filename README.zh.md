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

## 与皮肤体系的关系

本插件与 `dsh-skins` 皮肤（如蓝色幻想）互不冲突：皮肤是整站换肤（含背景），本插件是可视化配置叠加层，二者都写入 body 属性作用域 CSS 与 body 内联样式；同时启用时以后写入者为准。关闭本插件的「启用个性化」开关即完整还原官方外观。

## 开发

```sh
pnpm install
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
src/host/patch.ts               # 部分更新的 deepMerge
src/host/types.ts               # webServer/commands/personalization 服务的最小类型桥
src/shared/config.ts            # 配置模型 + sanitize + storageMode + asset 引用（两个半区共用）
src/client/index.ts             # 浏览器半区：注册设置页、接线引擎与 host 同步（SSE）
src/client/engine.ts            # 生效引擎：背景/色板/字体/滚动条/选中/chrome，可整体还原
src/client/settings.ts          # 共享模型之上的 localStorage 缓存（旧版迁移在 shared/config.ts）
src/client/host.ts              # 浏览器 → host 传输层（fetch 封装）
src/client/PersonalizationSection.tsx  # 设置页组件
src/client/image.ts             # 图片压缩（canvas → JPEG data URL）
src/client/locales.ts           # zh / en 文案
```

## 已知限制

- 「仅此浏览器」模式下，配置只存浏览器 localStorage：换浏览器/换电脑不跟随；且 localStorage 配额（约 5MB）限制可保存的大背景图数量。默认的「跟随本机」模式下图片落盘，不受配额限制。
- 背景图经短 `blob:` URL（data URL）或直接 host URL（`asset:` 引用）渲染：Chromium 的 CSS 解析器会静默丢弃超过 2MB 的 `url()` 值，因此引擎在 apply 时把存储的 data URL 解码为 Blob；host 资产是短同源 URL，天然不受此限制。
- 宿主侧改动需要**重启 `dsh web`** 生效；重启前浏览器侧透明降级为仅浏览器存储。
- 「编辑目标」的面板列表在设置页挂载时检测一次：aionui 右侧面板在项目会话打开后才出现，需重开设置页才能选中它。
- 面板透明度在「背景图」模式下效果最明显；纯色背景下效果较微弱（页面会给出提示）。
- 皮肤与本插件同时启用时以后写入者为准；关闭「启用个性化」总开关可完整还原官方外观。

## 版权

代码部分 MIT。请勿打包你没有使用权的美术素材。
