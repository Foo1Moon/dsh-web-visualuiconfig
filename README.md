# dsh-web-visualuiconfig — DSH Web GUI visual configuration plugin

English | [中文](README.zh.md)

A standalone, hot-pluggable DeepSeek Harness (DSH) Web GUI plugin that layers switchable visual configuration over the official look — backgrounds, scrim, translucent panels, accent palettes, fonts, scrollbars, selection color, favicon and page title. Styling runs browser-side; the configuration persists (by default) to a machine file under `~/.dsh` served back through the plugin's own `/personalization/*` routes, with a browser-only fallback. The plugin mounts only through `cordis.patch.yml` and the profile mechanism, without modifying DSH source.

![Personalization settings page](docs/screenshots/Config.png)

## Capabilities

| Capability | Description |
| --- | --- |
| Background settings | Every panel (unified between the "all panels" and single-panel targets) has its own background group: **solid color** (default — the panel shows its base color, transparency still applies) or **image** (rendered at the panel's layer, center-cropped to the panel's aspect ratio, scrim adjustable). The "all panels" upload is a **source bridge**: it only compresses, never crops — each panel crops via `background-size: cover` at render time and shows it only while its background knob follows the baseline (panels with an independent background get a hint) |
| Global background | A page-level group outside the edit target: a page-wide **bottom-layer** backdrop (rendered on body), independent of panel backgrounds — panels without their own image show it through, panels with their own image cover it |
| Panel transparency | 0–0.9 slider: 0 = official opaque (the backdrop is fully covered), right = more transparent and the backdrop shows through; floating layers (menu/dialog/input) stay more opaque for readability. No `backdrop-filter`: blur on the official frame columns traps fixed overlays (the settings modal etc.), a boundary the dsh-web-ui skin system documents |
| Accent palette | 4 presets (Ocean / Violet / Ember / Rose) plus a custom hex accent (`color-mix` derives the full ramp), overriding `--dsw-static-deepseek-*` and the aionui panel's `--aion-*` tokens; light/dark auto-adapt |
| Typography | Rounded / Serif / Mono presets, or a custom `font-family` stack |
| Scrollbar | Rounded scrollbar, light/dark palettes |
| Selection color | Custom `::selection` background |
| Page chrome | Favicon (≤128px) and page-title override |
| Panel-level personalization | Runtime detection of present panels; the "edit target" selector defaults to "all panels", editing the baseline appearance that every follow knob inherits from. Every module (transparency / palette / font / scrollbar / selection / background) carries a "follow theme" switch — a single-panel view flips that panel's knob, the "all panels" view flips every panel's knob at once — plus a "follow all" master switch in both views. Current panels: sidebar, conversation, details, right file/preview panel (aionui), task board, SSH panel |
| Config storage | A "Config storage" section chooses where settings live: **follow this machine** (default — persisted to `~/.dsh/dsh-web-personalization.json` through the host half, so they survive restarts *and* follow you to another browser) or **this browser only** (the original `localStorage` behavior). Images are stored as files under `~/.dsh/personalization/` and served as short same-origin URLs, so they escape the `localStorage` quota and the 2 MB CSS `url()` limit |

## Screenshots

Background-image effect (before / after):

| Before | After |
| --- | --- |
| ![Before](docs/screenshots/before.png) | ![After](docs/screenshots/after.png) |

Uploading a background in the settings page:

![Uploading a background](docs/screenshots/bgp.png)

## Install

Link the local source for development, then **restart `dsh web`** — the settings panel gains a "Personalization" page.

```sh
### 从本地源码安装（开发调试）
dsh plugin --profile web add link:C:/path/to/dsh-web-visualuiconfig
```

### Install via the DSH agent

No terminal needed: in a DSH conversation, just ask the agent to install the plugin for you — it clones the repository, mounts it into the web profile with a `link:` entry, and reminds you to restart `dsh web`:

> Please install the dsh-web-visualuiconfig plugin.

The agent runs the equivalent of:

```sh
git clone https://github.com/Foo1Moon/dsh-web-visualuiconfig.git
dsh plugin --profile web add link:<cloned repo path>
```

## Configuration storage

The config defaults to **follow this machine**: the host half persists it to `~/.dsh/dsh-web-personalization.json` (images as files under `~/.dsh/personalization/`) and serves it to every browser through the `/personalization/*` routes — the settings survive a `dsh web` restart and follow you to another browser or machine. The settings page's "Config storage" section can switch to **this browser only**, which keeps the original `localStorage` behavior (`dsh.personalization.v1` is still written as a cache either way). The browser half degrades gracefully to browser-only persistence while the host half is unavailable (e.g. before a restart after upgrading).

This needs no `~/.dsh/settings.yaml` change and is not affected by the `dsh-host-apiproxy` `WEB_SETTINGS_NAMESPACES` whitelist — the plugin owns its file and its routes.

Uninstalling the plugin leaves the config file and asset directory behind (deleting them on plugin dispose would also wipe them on every `dsh web` restart). To clean up, either delete `~/.dsh/dsh-web-personalization.json` and `~/.dsh/personalization/` manually, or call `POST /personalization/uninstall`.

## Programmatic control

Four ways to drive the settings without the GUI (every change is broadcast to all open tabs over SSE):

- **Agent tool** — the model can change the theme from natural language ("make the accent warm orange", "set this background image"): it sees a `personalization` tool with structured arguments (`accent`, `preset`, `transparency`, `font`, `storage`, `backgroundImage`, `removeBackground`, `enabled`, `reset`) and applies the change immediately.
- **HTTP** — the full surface: `GET|PUT|PATCH /personalization/config`, `POST /personalization/reset`, `PUT /personalization/assets` (raw image bytes, `Content-Type: image/jpeg|png|webp|gif`). `PATCH` deep-merges a partial update, so an agent or script only sends what changed:
  ```sh
  curl -X PATCH -H 'content-type: application/json' \
    -d '{"base":{"palette":{"accent":"#ff8800"}}}' \
    http://127.0.0.1:3080/personalization/config
  ```
- **Command** — `/personalization` in the chat input (no model round-trip): `show`, `set accent #hex`, `set preset ocean|violet|ember|rose`, `set glass 0-0.9`, `set font default|rounded|serif|mono`, `set storage host|browser`, `background set <local image path>`, `background remove`, `reset`.
- **Service** — other plugins `inject: ['personalization']` to call `read()`, `update(patch)`, `reset()`, `onUpdated(cb)`.

## Relationship with the skin system

This plugin coexists with `dsh-skins` skins (e.g. Blue Fantasy): a skin restyles the whole site (background included), this plugin is a visual-configuration overlay — both write attribute-scoped CSS under a body attribute and body inline styles; when both are enabled, the later writer wins. Turning off the plugin's "Enable personalization" master switch restores the official look completely.

## Development

```sh
pnpm install
pnpm build      # produces lib/index.js (host half) and lib/client.js (browser bundle)
pnpm watch      # incremental build
pnpm typecheck  # tsc --noEmit
pnpm test       # node:test + tsx (no vitest dependency)
```

Structure:

```
src/index.ts                    # host half: mounts store + asset store + routes (webServer service)
src/host/store.ts               # ~/.dsh/dsh-web-personalization.json: atomic writes, corrupt backup, revision
src/host/assets.ts              # image files under ~/.dsh/personalization/: sha256 naming, whitelist, GC
src/host/routes.ts              # /personalization/* routes, SSE revision channel, uninstall cleanup
src/host/commands.ts            # /personalization command (registered lazily via ctx.inject)
src/host/tool.ts                # personalization agent tool (registered lazily via ctx.inject)
src/host/patch.ts               # deepMerge for partial config updates
src/host/types.ts               # minimal type bridges for webServer/commands/personalization services
src/shared/config.ts            # config model + sanitize + storageMode + asset refs (shared by both halves)
src/client/index.ts             # browser half: registers the settings page, wires engine + host sync (SSE)
src/client/engine.ts            # effect engine: background/palette/font/scrollbar/selection/chrome, fully revertible
src/client/settings.ts          # localStorage cache over the shared model (legacy migration in shared/config.ts)
src/client/host.ts              # browser → host transport (fetch wrappers)
src/client/PersonalizationSection.tsx  # settings page component
src/client/image.ts             # image compression (canvas → JPEG data URL)
src/client/locales.ts           # zh / en copy
```

## Known limitations

- In "this browser only" mode, persistence is browser-local and the `localStorage` quota (≈5 MB) bounds how many large backdrop images can be kept. In the default host mode, images live on disk and the quota does not apply.
- Backdrop images render through short `blob:` URLs (data URLs) or direct host URLs (`asset:` refs): Chromium's CSS parser silently drops `url()` values longer than 2 MB, so the engine decodes stored data URLs into Blobs at apply time. Host-stored assets are short same-origin URLs and are exempt from this limit.
- The host half needs a `dsh web` restart after install/upgrade; until then the browser half transparently falls back to browser-only storage.
- The "edit target" panel list is detected once when the settings page mounts: the aionui right panel appears only after a project session opens, so reopen the settings page to select it.
- Panel transparency is most visible with an image background; on a solid panel the effect is subtle (the page hints at this).
- When a skin and this plugin are both enabled, the later writer wins; turn off the master switch to fully restore the official look.

## License

MIT. Do not package art assets you do not have the rights to.
