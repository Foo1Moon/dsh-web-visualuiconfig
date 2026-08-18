# dsh-web-visualuiconfig — DSH Web GUI visual configuration plugin

English | [中文](README.zh.md)

A standalone, hot-pluggable DeepSeek Harness (DSH) Web GUI plugin that layers switchable visual configuration over the official look — backgrounds, scrim, translucent panels, accent palettes, fonts, scrollbars, selection color, favicon and page title. Everything runs browser-side and persists in `localStorage`; the plugin mounts only through `cordis.patch.yml` and the profile mechanism, without modifying DSH source.

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

The config lives in browser `localStorage` under the single versioned key `dsh.personalization.v1`: it survives a `dsh web` restart on the same machine/browser, but does **not** follow you to another browser or machine. This needs no `~/.dsh/settings.yaml` change and is not affected by the `dsh-host-apiproxy` `WEB_SETTINGS_NAMESPACES` whitelist.

## Relationship with the skin system

This plugin coexists with `dsh-skins` skins (e.g. Blue Fantasy): a skin restyles the whole site (background included), this plugin is a visual-configuration overlay — both write attribute-scoped CSS under a body attribute and body inline styles; when both are enabled, the later writer wins. Turning off the plugin's "Enable personalization" master switch restores the official look completely.

## Development

```sh
pnpm install
pnpm build      # produces lib/index.js (host half) and lib/client.js (browser bundle)
pnpm watch      # incremental build
pnpm typecheck  # tsc --noEmit
```

Structure:

```
src/index.ts                    # host half (empty apply)
src/client/index.ts             # browser half: registers the settings page + wires the engine
src/client/engine.ts            # effect engine: background/palette/font/scrollbar/selection/chrome, fully revertible
src/client/settings.ts          # config model + localStorage persistence (with legacy migration)
src/client/PersonalizationSection.tsx  # settings page component
src/client/image.ts             # image compression (canvas → JPEG data URL)
src/client/locales.ts           # zh / en copy
```

## Known limitations

- Persistence is browser-local: settings do not follow to another browser/machine, and the `localStorage` quota (≈5 MB) bounds how many large backdrop images can be kept. The background upload compresses to a ≤1920px JPEG, but several large images can still approach the quota — when the quota is exceeded, persistence silently degrades to page-lifetime-only (the in-memory config still applies).
- Backdrop images render through short `blob:` URLs: Chromium's CSS parser silently drops `url()` values longer than 2 MB, so the engine decodes the stored data URL into a Blob at apply time. The config still stores the data URL; the blob URL is recreated per page session.
- The "edit target" panel list is detected once when the settings page mounts: the aionui right panel appears only after a project session opens, so reopen the settings page to select it.
- Panel transparency is most visible with an image background; on a solid panel the effect is subtle (the page hints at this).
- When a skin and this plugin are both enabled, the later writer wins; turn off the master switch to fully restore the official look.

## License

MIT. Do not package art assets you do not have the rights to.
