/**
 * Personalization settings page: one full page inside the settings panel
 * (registered into the `settings.section` slot by this package's apply).
 * Every control writes straight into the config store; the engine applies
 * the change immediately and the store persists it to localStorage.
 *
 * A panel selector at the top picks the edit target:
 * - "all panels" edits the baseline appearance (`config.base`) that every
 *   follow knob inherits from;
 * - one detected panel edits that panel's own follow config — each knob has
 *   a "follow theme" switch; when on, the knob is not editable and shows the
 *   baseline value.
 *
 * Background image and page chrome are page-level groups. Background has a
 * global / per-panel mode; in per-panel mode each panel row also carries a
 * follow switch (follow = use the global-mode image).
 *
 * The page is a pure presentation component: all data and callbacks arrive
 * through the four props shares (runtime + locale + injected face). It never
 * touches the DOM document, localStorage, or the engine directly.
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PALETTE_PRESETS, FONT_PRESETS } from './engine.ts'
import type { PersonalizationKey } from './locales.ts'
import { compressImage } from './image.ts'
import { detectPanels, PANEL_SCOPE_SELECTOR, type PanelInfo } from './panels.ts'
import {
  PANEL_IDS, resolvePanelConfig, resolveImageSource, themeIdFromName,
  type BackgroundFit, type CharacterTheme, type PaletteSeeds, type PanelBackgroundSettings, type PanelConfig, type PanelFollowConfig, type PanelId, type PersonalizationConfig,
} from './settings.ts'
import { activateTheme, buildThemePatch, deactivateTheme, findTheme, removeTheme } from '../shared/theme.ts'
import { analyzeImagePixels, samplePixelsFromDataUrl } from './character-wizard.ts'
import css from './personalization.module.css'

/** Injected business face: config read/write plus image compression. */
export interface PersonalizationInjected {
  /** Subscribe to the current config (useSyncExternalStore binding). */
  useConfig: () => PersonalizationConfig
  /** Apply a config transformation and persist it. */
  update: (recipe: (prev: PersonalizationConfig) => PersonalizationConfig) => void
  /** Reset the whole config to defaults and persist. */
  reset: () => void
  /** Whether the host half answered at least once (host storage usable). */
  useHostAvailable: () => boolean
  /** Upload a compressed image to the host store; returns an `asset:` id or null. */
  uploadImage: (dataUrl: string) => Promise<string | null>
}

/** Full component props: runtime share + locale seat + injected face. */
export type PersonalizationSectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<'settings.personalization'> & PersonalizationInjected

/** A labeled range-row value handler. */
function RangeRow(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <div className={css.row}>
      <span className={css.rowLabel}>{props.label}</span>
      <input
        type="range"
        className={css.slider}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(Number(e.target.value))}
      />
      <span className={css.rowValue}>{Math.round(props.value * 100) / 100}</span>
    </div>
  )
}

/** A cropped thumbnail of a stored image plus its pixel size. `aspect`
 *  (width/height) shapes the thumbnail frame to the target panel's ratio, so
 *  the preview and the size label both show that panel's crop of the shared
 *  source image. The size is DERIVED from the loaded natural size and the
 *  current aspect, so switching panels recomputes it even though the src
 *  (and thus onLoad) never changes. */
function ImageThumb(props: { src: string | undefined; aspect?: number }) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const frameStyle = props.aspect !== undefined
    ? { width: 56, height: Math.max(18, Math.round(56 / props.aspect)) }
    : undefined
  const size = useMemo(() => {
    if (natural === null) return null
    const { w, h } = natural
    const aspect = props.aspect
    // Report the center-cropped size for the target panel's ratio (the same
    // crop the upload/render applies); without a ratio, the source size.
    let cw = w
    let ch = h
    if (aspect !== undefined && aspect > 0 && w > 0 && h > 0) {
      const srcAspect = w / h
      if (srcAspect > aspect) {
        cw = Math.round(h * aspect)
        ch = h
      } else {
        cw = w
        ch = Math.round(w / aspect)
      }
    }
    return { w: cw, h: ch }
  }, [natural, props.aspect])
  return (
    <span className={css.thumbWrap}>
      <img
        ref={imgRef}
        className={css.preview}
        style={frameStyle}
        src={props.src}
        alt=""
        onLoad={() => {
          const img = imgRef.current
          if (img !== null && img.naturalWidth > 0) {
            setNatural({ w: img.naturalWidth, h: img.naturalHeight })
          }
        }}
      />
      {size !== null && (
        <span className={css.thumbSize}>{size.w} × {size.h}</span>
      )}
    </span>
  )
}

/** One per-panel knob: title + follow switch + body. The follow switch is
 *  always shown: on a single-panel target it flips that panel's knob, on the
 *  "all panels" target it flips every panel's knob at once. */
function KnobGroup(props: {
  title: string
  followLabel: string
  follow: boolean
  onFollow: (follow: boolean) => void
  children: React.ReactNode
}) {
  return (
    <div className={css.subGroup}>
      <div className={css.subHead}>
        <span className={css.groupTitle}>{props.title}</span>
        <label className={css.followRow}>
          <span>{props.followLabel}</span>
          <input
            type="checkbox"
            checked={props.follow}
            onChange={(e) => props.onFollow(e.target.checked)}
          />
        </label>
      </div>
      {props.children}
    </div>
  )
}

/**
 * Render the personalization settings page.
 * @param props - composed slot props.
 * @returns the settings page element tree.
 */
export function PersonalizationSection({ t, useConfig, update, reset, useHostAvailable, uploadImage }: PersonalizationSectionProps) {
  const config = useConfig()
  const hostAvailable = useHostAvailable()
  const hostMode = config.storageMode === 'host' && hostAvailable
  const backgroundInput = useRef<HTMLInputElement>(null)
  const globalBgInput = useRef<HTMLInputElement>(null)
  const faviconInput = useRef<HTMLInputElement>(null)
  const [available] = useState<readonly PanelInfo[]>(() => detectPanels())
  const [selected, setSelected] = useState<'all' | PanelId>('all')
  const set = (patch: Partial<PersonalizationConfig>): void => {
    update(prev => ({ ...prev, ...patch }))
  }

  const isAll = selected === 'all'
  /** The edited panel's aspect ratio. It is fixed unless the user resizes the
   *  panel (window resize or dragging a panel handle), so we watch both and
   *  refresh the ratio — which in turn refreshes the thumbnail crop/size. */
  const [panelAspect, setPanelAspect] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (isAll) {
      setPanelAspect(undefined)
      return
    }
    const measure = (): void => {
      const el = document.querySelector(PANEL_SCOPE_SELECTOR[selected as PanelId])
      setPanelAspect(el instanceof HTMLElement && el.clientWidth > 0 && el.clientHeight > 0
        ? el.clientWidth / el.clientHeight
        : undefined)
    }
    measure()
    const el = document.querySelector(PANEL_SCOPE_SELECTOR[selected as PanelId])
    let observer: ResizeObserver | undefined
    if (el instanceof HTMLElement) {
      observer = new ResizeObserver(measure)
      observer.observe(el)
    }
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [selected, isAll])
  /** The panel's follow config when editing a single panel. */
  const followCfg = isAll ? null : config.panels[selected]
  /** The appearance values shown: baseline for "all", resolved for a panel. */
  const shown = isAll
    ? config.base
    : resolvePanelConfig(config.base, config.panels[selected])

  /** Write the baseline appearance ("all panels" values). Follow switches on
   *  the same view decide whether panels inherit these values. */
  const setBase = (patch: Partial<PanelConfig>): void => {
    update(prev => ({ ...prev, base: { ...prev.base, ...patch } }))
  }
  /** Write one panel's follow config (only valid for a single panel target). */
  const setPanel = (patch: Partial<PanelFollowConfig>): void => {
    if (isAll) return
    update(prev => {
      const panels: Record<PanelId, PanelFollowConfig> = { ...prev.panels }
      panels[selected] = { ...panels[selected], ...patch }
      return { ...prev, panels }
    })
  }
  /** Apply a palette preset to the current edit target. */
  const applyPreset = (id: string): void => {
    if (isAll) setBase({ palette: { preset: id, accent: null, seeds: null, appearance: null } })
    else setPanel({ palette: { follow: false, preset: id, accent: null, seeds: null, appearance: null } })
  }
  /** Flip one knob between follow-theme and independent editing. */
  const toggleFollow = (kind: 'glass' | 'palette' | 'font' | 'scrollbar' | 'selection' | 'background', follow: boolean): void => {
    if (isAll || followCfg === null) return
    // Breaking away from follow starts from the current baseline value.
    const base = config.base
    const patch: Partial<PanelFollowConfig> = {}
    if (kind === 'glass') {
      patch.glass = { follow, opacity: follow ? followCfg.glass.opacity : base.glass.opacity }
    } else if (kind === 'palette') {
      patch.palette = {
        follow,
        preset: follow ? followCfg.palette.preset : base.palette.preset,
        accent: follow ? followCfg.palette.accent : base.palette.accent,
        seeds: follow ? followCfg.palette.seeds : base.palette.seeds,
        appearance: follow ? followCfg.palette.appearance : base.palette.appearance,
      }
    } else if (kind === 'font') {
      patch.font = {
        follow,
        family: follow ? followCfg.font.family : base.font.family,
        custom: follow ? followCfg.font.custom : base.font.custom,
      }
    } else if (kind === 'scrollbar') {
      patch.scrollbar = { follow, value: follow ? followCfg.scrollbar.value : base.scrollbar }
    } else if (kind === 'selection') {
      patch.selection = { follow, value: follow ? followCfg.selection.value : base.selection }
    } else {
      patch.background = {
        follow,
        mode: follow ? followCfg.background.mode : base.background.mode,
        image: follow ? followCfg.background.image : base.background.image,
        scrim: follow ? followCfg.background.scrim : base.background.scrim,
        fit: follow ? followCfg.background.fit : base.background.fit,
      }
    }
    setPanel(patch)
  }
  /** Flip every knob of the current panel between follow-theme and independent. */
  const setAllFollow = (follow: boolean): void => {
    if (isAll || followCfg === null) return
    const base = config.base
    setPanel({
      glass: { follow, opacity: follow ? followCfg.glass.opacity : base.glass.opacity },
      palette: {
        follow,
        preset: follow ? followCfg.palette.preset : base.palette.preset,
        accent: follow ? followCfg.palette.accent : base.palette.accent,
        seeds: follow ? followCfg.palette.seeds : base.palette.seeds,
        appearance: follow ? followCfg.palette.appearance : base.palette.appearance,
      },
      font: {
        follow,
        family: follow ? followCfg.font.family : base.font.family,
        custom: follow ? followCfg.font.custom : base.font.custom,
      },
      scrollbar: { follow, value: follow ? followCfg.scrollbar.value : base.scrollbar },
      selection: { follow, value: follow ? followCfg.selection.value : base.selection },
      background: {
        follow,
        mode: follow ? followCfg.background.mode : base.background.mode,
        image: follow ? followCfg.background.image : base.background.image,
        scrim: follow ? followCfg.background.scrim : base.background.scrim,
        fit: follow ? followCfg.background.fit : base.background.fit,
      },
    })
  }
  /** Aggregated follow state across all panels (the "all panels" view). */
  const allFollowOf = (kind: 'glass' | 'palette' | 'font' | 'scrollbar' | 'selection' | 'background'): boolean =>
    PANEL_IDS.every(id => config.panels[id][kind].follow)
  const allFollowEverything = PANEL_IDS.every(id =>
    config.panels[id].glass.follow && config.panels[id].palette.follow && config.panels[id].font.follow
    && config.panels[id].scrollbar.follow && config.panels[id].selection.follow && config.panels[id].background.follow)
  /** Flip one knob of EVERY panel (the "all panels" view). */
  const setEveryFollow = (kind: 'glass' | 'palette' | 'font' | 'scrollbar' | 'selection' | 'background', follow: boolean): void => {
    if (!isAll) return
    update(prev => {
      const panels: Record<PanelId, PanelFollowConfig> = { ...prev.panels }
      for (const id of PANEL_IDS) {
        const p = panels[id]
        const target = { ...p }
        if (kind === 'glass') {
          target.glass = { ...p.glass, follow, opacity: follow ? p.glass.opacity : prev.base.glass.opacity }
        } else if (kind === 'palette') {
          target.palette = {
            ...p.palette, follow,
            preset: follow ? p.palette.preset : prev.base.palette.preset,
            accent: follow ? p.palette.accent : prev.base.palette.accent,
          }
        } else if (kind === 'font') {
          target.font = {
            ...p.font, follow,
            family: follow ? p.font.family : prev.base.font.family,
            custom: follow ? p.font.custom : prev.base.font.custom,
          }
        } else if (kind === 'scrollbar') {
          target.scrollbar = { ...p.scrollbar, follow, value: follow ? p.scrollbar.value : prev.base.scrollbar }
        } else if (kind === 'selection') {
          target.selection = { ...p.selection, follow, value: follow ? p.selection.value : prev.base.selection }
        } else {
          target.background = {
            ...p.background, follow,
            mode: follow ? p.background.mode : prev.base.background.mode,
            image: follow ? p.background.image : prev.base.background.image,
            scrim: follow ? p.background.scrim : prev.base.background.scrim,
          }
        }
        panels[id] = target
      }
      return { ...prev, panels }
    })
  }
  /** Flip EVERY knob of EVERY panel (the "all panels" view). */
  const setEverythingFollow = (follow: boolean): void => {
    if (!isAll) return
    update(prev => {
      const panels: Record<PanelId, PanelFollowConfig> = { ...prev.panels }
      for (const id of PANEL_IDS) {
        const p = panels[id]
        panels[id] = {
          glass: { ...p.glass, follow, opacity: follow ? p.glass.opacity : prev.base.glass.opacity },
          palette: {
            ...p.palette, follow,
            preset: follow ? p.palette.preset : prev.base.palette.preset,
            accent: follow ? p.palette.accent : prev.base.palette.accent,
          },
          font: {
            ...p.font, follow,
            family: follow ? p.font.family : prev.base.font.family,
            custom: follow ? p.font.custom : prev.base.font.custom,
          },
          scrollbar: { ...p.scrollbar, follow, value: follow ? p.scrollbar.value : prev.base.scrollbar },
          selection: { ...p.selection, follow, value: follow ? p.selection.value : prev.base.selection },
          background: {
            ...p.background, follow,
            mode: follow ? p.background.mode : prev.base.background.mode,
            image: follow ? p.background.image : prev.base.background.image,
            scrim: follow ? p.background.scrim : prev.base.background.scrim,
          },
        }
      }
      return { ...prev, panels }
    })
  }
  /** Reset a single panel to full follow-theme. */
  const resetPanel = (): void => {
    if (isAll) return
    const base = config.base
    setPanel({
      glass: { follow: true, opacity: base.glass.opacity },
      palette: {
        follow: true,
        preset: base.palette.preset,
        accent: base.palette.accent,
        seeds: base.palette.seeds,
        appearance: base.palette.appearance,
      },
      font: { follow: true, family: base.font.family, custom: base.font.custom },
      scrollbar: { follow: true, value: base.scrollbar },
      selection: { follow: true, value: base.selection },
      background: { follow: true, mode: base.background.mode, image: base.background.image, scrim: base.background.scrim, fit: base.background.fit },
    })
  }

  /** The current edit target's background settings (resolved for a panel). */
  const shownBg = shown.background
  const bgMode = shownBg.mode
  const bgHasImage = shownBg.image !== null && shownBg.image !== undefined
  /** The fit-mode options (shared by the panel and the page-wide backdrop). */
  const fitOptions: ReadonlyArray<readonly [BackgroundFit, string]> = [
    ['cover', t('background.fit.cover')],
    ['contain', t('background.fit.contain')],
    ['stretch', t('background.fit.stretch')],
    ['tile', t('background.fit.tile')],
  ]
  /** Panels whose background knob is independent (not following the baseline). */
  const independentBgPanels = PANEL_IDS.filter(id => !config.panels[id].background.follow).length
  /** Write background settings to the current edit target. The "all panels"
   *  target only updates the baseline; each panel shows the new image only if
   *  its background knob follows the baseline. */
  const writeBg = (patch: Partial<PanelBackgroundSettings>): void => {
    if (isAll) {
      setBase({ background: { ...config.base.background, ...patch } })
    } else {
      setPanel({ background: { ...(followCfg?.background ?? { follow: false, mode: 'solid' as const, image: null, scrim: 0.25, fit: 'cover' as const }), follow: false, ...patch } })
    }
  }
  /** Store a compressed image: upload to the host in host mode (returning an
   *  `asset:` id), otherwise keep the data URL. A failed upload falls back to
   *  the data URL so the image still works in the current session. */
  const storeImage = async (dataUrl: string): Promise<string> => {
    if (hostMode) {
      const id = await uploadImage(dataUrl)
      if (id !== null) return id
    }
    return dataUrl
  }
  /** Pick the target's backdrop image. The "all panels" upload is a source
   *  bridge: the image is stored as-is (compressed only) and each panel crops
   *  it to its own shape when rendering (cover). A single-panel upload crops
   *  to that panel's shape up front. */
  const pickBgImage = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file === undefined) return
    let aspect: number | undefined
    if (!isAll) {
      const el = document.querySelector(PANEL_SCOPE_SELECTOR[selected as PanelId])
      if (el instanceof HTMLElement && el.clientWidth > 0 && el.clientHeight > 0) {
        aspect = el.clientWidth / el.clientHeight
      }
    }
    const dataUrl = await compressImage(file, { aspect })
    if (dataUrl !== null) {
      writeBg({ mode: 'image', image: await storeImage(dataUrl) })
    }
  }
  const removeBgImage = (): void => writeBg({ image: null })
  const setBgScrim = (scrim: number): void => writeBg({ scrim })
  /** The effective accent shown by the swatches: a custom accent, else the
   *  seeds' accent (a character theme), else the preset's. */
  const paletteAccent = shown.palette.accent ?? shown.palette.seeds?.accent ?? null

  /** The extraction wizard: pick a character image → browser extracts the
   *  four seeds (contrast-preserving) → show a preview → the user confirms
   *  before anything is applied. Nothing changes while only a draft exists. */
  const themeNameRef = useRef<HTMLInputElement>(null)
  const themeImageInput = useRef<HTMLInputElement>(null)
  const [themeBusy, setThemeBusy] = useState(false)
  const [themeError, setThemeError] = useState<string | null>(null)
  const [themeDraft, setThemeDraft] = useState<{
    name: string
    sourceImage: string
    seeds: PaletteSeeds
    appearance: 'light' | 'dark'
    pass: boolean
  } | null>(null)
  const generateTheme = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file === undefined) return
    setThemeBusy(true)
    setThemeError(null)
    try {
      const dataUrl = await compressImage(file)
      if (dataUrl === null) throw new Error(t('theme.generateFailed') + 'image decode failed')
      const pixels = await samplePixelsFromDataUrl(dataUrl)
      if (pixels === null) throw new Error(t('theme.generateFailed') + 'canvas unavailable')
      const analysis = analyzeImagePixels(pixels)
      const name = (themeNameRef.current?.value ?? '').trim() || 'character'
      setThemeDraft({
        name,
        sourceImage: await storeImage(dataUrl),
        seeds: analysis.seeds,
        appearance: analysis.appearance,
        pass: analysis.pass,
      })
    } catch (error) {
      setThemeError(error instanceof Error ? error.message : String(error))
    } finally {
      setThemeBusy(false)
    }
  }
  /** Apply the confirmed draft: build the theme from the previewed seeds. */
  const applyThemeDraft = (): void => {
    const draft = themeDraft
    if (draft === null) return
    const theme: Omit<CharacterTheme, 'snapshot'> = {
      id: themeIdFromName(draft.name),
      name: draft.name,
      description: '',
      sourceImage: draft.sourceImage,
      seeds: draft.seeds,
      appearance: draft.appearance,
      createdAt: Date.now(),
      patch: buildThemePatch({
        seeds: draft.seeds,
        appearance: draft.appearance,
        title: draft.name,
      }, draft.sourceImage),
    }
    update(prev => activateTheme(prev, theme))
    setThemeDraft(null)
  }

  const pickFavicon = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file === undefined) return
    const dataUrl = await compressImage(file, { maxWidth: 128, quality: 0.9 })
    if (dataUrl !== null) {
      set({ chrome: { ...config.chrome, favicon: await storeImage(dataUrl) } })
    }
  }

  /** Pick the page-wide backdrop (bottom layer, rendered on body). */
  const pickGlobalBg = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file === undefined) return
    const dataUrl = await compressImage(file)
    if (dataUrl !== null) {
      set({ globalBackground: { ...config.globalBackground, image: await storeImage(dataUrl) } })
    }
  }

  return (
    <div className={css.section}>
      <div className={css.hint}>{t('hint')}</div>

      <div className={css.group}>
        <label className={css.switchRow}>
          <span>
            <span className={css.rowLabel}>{t('master.title')}</span>
            <span className={css.rowDesc}>{t('master.desc')}</span>
          </span>
          <input
            type="checkbox"
            className={css.switch}
            checked={config.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
        </label>
      </div>

      {/* Character theme library: themes created from character art +
          introduction (chat agent or the local extraction wizard below). At
          most one is active; switching replaces the current look, turning off
          restores the pre-theme appearance. */}
      <div className={css.group}>
        <div className={css.groupTitle}>{t('theme.title')}</div>
        <div className={css.rowDesc}>{t('theme.desc')}</div>
        <div className={css.rowDesc}>{t('theme.generateHint')}</div>
        <div className={css.row}>
          <input ref={themeImageInput} type="file" accept="image/*" hidden onChange={(e) => { void generateTheme(e) }} />
          <button type="button" className={css.button} disabled={themeBusy} onClick={() => themeImageInput.current?.click()}>
            {themeBusy ? t('theme.generateBusy') : t('theme.generate')}
          </button>
          <input
            ref={themeNameRef}
            type="text"
            className={css.textInput}
            placeholder={t('theme.generateName')}
            defaultValue="character"
          />
        </div>
        {themeError !== null && <div className={css.rowHint}>{themeError}</div>}
        {themeDraft !== null && (
          <div className={css.subGroup}>
            <div className={css.subHead}>
              <span className={css.rowLabel}>{t('theme.generatePreview')}</span>
              {themeDraft.pass
                ? <span className={css.themeBadge}>{t('theme.generatePass')}</span>
                : <span className={css.themeBadge}>{t('theme.generateFail')}</span>}
            </div>
            <div className={css.rowDesc}>{t('theme.draftHint')}</div>
            <div className={css.swatchRow}>
              {(['accent', 'secondary', 'surface', 'text'] as const).map(key => (
                <span key={key} className={css.swatch} title={`${key} ${themeDraft.seeds[key]}`}>
                  <span className={css.swatchColor} style={{ background: themeDraft.seeds[key] }} />
                </span>
              ))}
            </div>
            <div className={css.row}>
              <button type="button" className={css.button} onClick={applyThemeDraft}>{t('theme.apply')}</button>
              <button type="button" className={css.buttonGhost} onClick={() => setThemeDraft(null)}>{t('theme.generateCancel')}</button>
            </div>
          </div>
        )}
        {config.themes.list.length === 0 ? (
          <div className={css.rowHint}>{t('theme.empty')}</div>
        ) : (
          config.themes.list.map(theme => {
            const isActive = config.themes.active === theme.id
            return (
              <div key={theme.id} className={css.themeCard}>
                {theme.sourceImage !== null && (
                  <img className={css.preview} src={resolveImageSource(theme.sourceImage) ?? undefined} alt="" />
                )}
                <div className={css.themeMeta}>
                  <span className={css.themeName}>
                    {theme.name}
                    {isActive && <span className={css.themeBadge}>{t('theme.active')}</span>}
                  </span>
                  {theme.description !== '' && <span className={css.themeDesc}>{theme.description}</span>}
                </div>
                {isActive ? (
                  <button type="button" className={css.buttonGhost} onClick={() => update(prev => deactivateTheme(prev))}>
                    {t('theme.deactivate')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={css.button}
                    onClick={() => update(prev => {
                      const found = findTheme(prev, theme.name)
                      return found === undefined ? prev : activateTheme(prev, found)
                    })}
                  >
                    {t('theme.apply')}
                  </button>
                )}
                <button
                  type="button"
                  className={css.buttonDanger}
                  onClick={() => {
                    if (window.confirm(t('theme.removeConfirm', { name: theme.name }))) {
                      update(prev => removeTheme(prev, theme.id))
                    }
                  }}
                >
                  {t('theme.remove')}
                </button>
              </div>
            )
          })
        )}
      </div>

      <div className={css.group}>
        <div className={css.groupTitle}>{t('storage.title')}</div>
        <div className={css.rowDesc}>{t('storage.desc')}</div>
        <div className={css.segRow}>
          {([
            ['host', t('storage.host')],
            ['browser', t('storage.browser')],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={`${css.segButton} ${config.storageMode === mode ? css.segActive : ''}`}
              onClick={() => set({ storageMode: mode })}
            >
              {label}
            </button>
          ))}
        </div>
        {config.storageMode === 'host' && !hostAvailable && (
          <div className={css.rowHint}>{t('storage.hostUnavailable')}</div>
        )}
      </div>

      <div className={css.group}>
        <div className={css.groupTitle}>{t('scope.title')}</div>
        <div className={css.rowDesc}>{t('scope.desc')}</div>
        <div className={css.row}>
          <select
            className={css.select}
            value={selected}
            onChange={(e) => setSelected(e.target.value as 'all' | PanelId)}
          >
            <option value="all">{t('scope.all')}</option>
            {available.map(p => (
              <option key={p.id} value={p.id}>{t(p.labelKey)}</option>
            ))}
          </select>
          {!isAll && (
            <button type="button" className={css.buttonGhost} onClick={resetPanel}>
              {t('scope.resetPanel')}
            </button>
          )}
        </div>
        {(followCfg !== null || isAll) && (
          <label className={css.switchRow}>
            <span>
              <span className={css.rowLabel}>{t('scope.followAll')}</span>
              <span className={css.rowDesc}>{t('scope.followAll.desc')}</span>
            </span>
            <input
              type="checkbox"
              className={css.switch}
              checked={isAll
                ? allFollowEverything
                : (followCfg !== null && followCfg.glass.follow && followCfg.palette.follow && followCfg.font.follow
                  && followCfg.scrollbar.follow && followCfg.selection.follow && followCfg.background.follow)}
              onChange={(e) => {
                if (isAll) setEverythingFollow(e.target.checked)
                else setAllFollow(e.target.checked)
              }}
            />
          </label>
        )}

        <KnobGroup
          title={t('glass.title')}
          followLabel={t('follow.label')}
          follow={isAll ? allFollowOf('glass') : (followCfg?.glass.follow ?? true)}
          onFollow={(f) => { if (isAll) setEveryFollow('glass', f); else toggleFollow('glass', f) }}
        >
          <div className={css.rowDesc}>{t('glass.desc')}</div>
          <RangeRow
            label={t('glass.opacity')}
            value={shown.glass.opacity}
            min={0}
            max={0.9}
            step={0.05}
            disabled={!isAll && (followCfg?.glass.follow ?? false)}
            onChange={(opacity) => {
              if (isAll) setBase({ glass: { opacity } })
              else setPanel({ glass: { ...(followCfg?.glass ?? { follow: false, opacity }), follow: false, opacity } })
            }}
          />
          {bgMode === 'solid' && (
            <div className={css.rowHint}>{t('glass.solidHint')}</div>
          )}
        </KnobGroup>

        <KnobGroup
          title={t('palette.title')}
          followLabel={t('follow.label')}
          follow={isAll ? allFollowOf('palette') : (followCfg?.palette.follow ?? true)}
          onFollow={(f) => { if (isAll) setEveryFollow('palette', f); else toggleFollow('palette', f) }}
        >
          <div className={css.swatchRow}>
            <button
              type="button"
              className={`${css.swatch} ${shown.palette.preset === '' && paletteAccent === null ? css.swatchActive : ''}`}
              title={t('palette.none')}
              disabled={!isAll && (followCfg?.palette.follow ?? false)}
              onClick={() => {
                if (isAll) setBase({ palette: { preset: '', accent: null, seeds: null, appearance: null } })
                else setPanel({ palette: { follow: false, preset: '', accent: null, seeds: null, appearance: null } })
              }}
            >
              <span className={css.swatchNone} />
            </button>
            {PALETTE_PRESETS.map(p => (
              <button
                key={p.id}
                type="button"
                className={`${css.swatch} ${shown.palette.preset === p.id && paletteAccent === null ? css.swatchActive : ''}`}
                title={p.label}
                disabled={!isAll && (followCfg?.palette.follow ?? false)}
                onClick={() => applyPreset(p.id)}
              >
                <span className={css.swatchColor} style={{ background: p.accent }} />
              </button>
            ))}
            <label
              className={`${css.swatch} ${paletteAccent !== null ? css.swatchActive : ''} ${!isAll && (followCfg?.palette.follow ?? false) ? css.swatchDisabled : ''}`}
              title={t('palette.custom')}
            >
              <span className={css.swatchColor} style={{ background: paletteAccent ?? '#888888' }} />
              <input
                type="color"
                className={css.colorInput}
                value={paletteAccent ?? '#4d6bfe'}
                disabled={!isAll && (followCfg?.palette.follow ?? false)}
                onChange={(e) => {
                  if (isAll) setBase({ palette: { preset: '', accent: e.target.value, seeds: null, appearance: null } })
                  else setPanel({ palette: { follow: false, preset: '', accent: e.target.value, seeds: null, appearance: null } })
                }}
              />
            </label>
          </div>
        </KnobGroup>

        <KnobGroup
          title={t('font.title')}
          followLabel={t('follow.label')}
          follow={isAll ? allFollowOf('font') : (followCfg?.font.follow ?? true)}
          onFollow={(f) => { if (isAll) setEveryFollow('font', f); else toggleFollow('font', f) }}
        >
          <div className={css.row}>
            <select
              className={css.select}
              value={shown.font.family}
              disabled={!isAll && (followCfg?.font.follow ?? false)}
              onChange={(e) => {
                if (isAll) setBase({ font: { ...config.base.font, family: e.target.value } })
                else setPanel({ font: { ...(followCfg?.font ?? { follow: false, family: 'default', custom: '' }), follow: false, family: e.target.value } })
              }}
            >
              {FONT_PRESETS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          <div className={css.row}>
            <input
              type="text"
              className={css.textInput}
              placeholder={t('font.custom')}
              value={shown.font.custom}
              disabled={!isAll && (followCfg?.font.follow ?? false)}
              onChange={(e) => {
                if (isAll) setBase({ font: { ...config.base.font, custom: e.target.value } })
                else setPanel({ font: { ...(followCfg?.font ?? { follow: false, family: 'default', custom: '' }), follow: false, custom: e.target.value } })
              }}
            />
          </div>
        </KnobGroup>

        <KnobGroup
          title={t('scrollbar.title')}
          followLabel={t('follow.label')}
          follow={isAll ? allFollowOf('scrollbar') : (followCfg?.scrollbar.follow ?? true)}
          onFollow={(f) => { if (isAll) setEveryFollow('scrollbar', f); else toggleFollow('scrollbar', f) }}
        >
          <div className={css.rowDesc}>{t('scrollbar.desc')}</div>
          <div className={css.row}>
            <span className={css.rowLabel}>{t('scrollbar.enable')}</span>
            <input
              type="checkbox"
              className={css.switch}
              checked={shown.scrollbar}
              disabled={!isAll && (followCfg?.scrollbar.follow ?? false)}
              onChange={(e) => {
                if (isAll) setBase({ scrollbar: e.target.checked })
                else setPanel({ scrollbar: { follow: false, value: e.target.checked } })
              }}
            />
          </div>
          <div className={css.row}>
            <span className={css.rowLabel}>{t('selection.title')}</span>
            <input
              type="color"
              className={css.colorInput}
              value={shown.selection ?? '#4d6bfe'}
              disabled={!isAll && (followCfg?.selection.follow ?? false)}
              onChange={(e) => {
                if (isAll) setBase({ selection: e.target.value })
                else setPanel({ selection: { follow: false, value: e.target.value } })
              }}
            />
            {shown.selection !== null && (
              <button
                type="button"
                className={css.buttonGhost}
                disabled={!isAll && (followCfg?.selection.follow ?? false)}
                onClick={() => {
                  if (isAll) setBase({ selection: null })
                  else setPanel({ selection: { follow: false, value: null } })
                }}
              >
                {t('selection.clear')}
              </button>
            )}
          </div>
        </KnobGroup>

        <KnobGroup
          title={t('background.title')}
          followLabel={t('follow.label')}
          follow={isAll ? allFollowOf('background') : (followCfg?.background.follow ?? true)}
          onFollow={(f) => { if (isAll) setEveryFollow('background', f); else toggleFollow('background', f) }}
        >
          <div className={css.segRow}>
            {([
              ['solid', t('background.mode.solid')],
              ['image', t('background.mode.image')],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`${css.segButton} ${bgMode === mode ? css.segActive : ''}`}
                disabled={!isAll && (followCfg?.background.follow ?? false)}
                onClick={() => writeBg({ mode })}
              >
                {label}
              </button>
            ))}
          </div>
          {isAll && independentBgPanels > 0 && bgHasImage && (
            <div className={css.rowHint}>{t('background.independentHint', { n: String(independentBgPanels) })}</div>
          )}
          {bgMode === 'solid' && (
            <div className={css.rowDesc}>{t('background.solid')}</div>
          )}
          {bgMode === 'image' && (
            <>
              <div className={css.row}>
                <input
                  ref={backgroundInput}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => { void pickBgImage(e) }}
                />
                <button
                  type="button"
                  className={css.button}
                  disabled={!isAll && (followCfg?.background.follow ?? false)}
                  onClick={() => backgroundInput.current?.click()}
                >
                  {t('background.upload')}
                </button>
                {bgHasImage && (
                  <>
                    <ImageThumb src={resolveImageSource(shownBg.image) ?? undefined} aspect={isAll ? undefined : panelAspect} />
                    <button
                      type="button"
                      className={css.buttonGhost}
                      disabled={!isAll && (followCfg?.background.follow ?? false)}
                      onClick={removeBgImage}
                    >
                      {t('background.remove')}
                    </button>
                  </>
                )}
              </div>
              {bgHasImage && (
                <>
                  <RangeRow
                    label={t('background.scrim')}
                    value={shownBg.scrim}
                    min={0}
                    max={0.9}
                    step={0.05}
                    disabled={!isAll && (followCfg?.background.follow ?? false)}
                    onChange={setBgScrim}
                  />
                  <div className={css.row}>
                    <span className={css.rowLabel}>{t('background.fit')}</span>
                    <div className={css.segRow}>
                      {fitOptions.map(([fit, label]) => (
                        <button
                          key={fit}
                          type="button"
                          className={`${css.segButton} ${shownBg.fit === fit ? css.segActive : ''}`}
                          disabled={!isAll && (followCfg?.background.follow ?? false)}
                          onClick={() => writeBg({ fit })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </KnobGroup>
      </div>

      <div className={css.group}>
        <div className={css.groupTitle}>{t('globalBackground.title')}</div>
        <div className={css.rowDesc}>{t('globalBackground.desc')}</div>
        <div className={css.row}>
          <input ref={globalBgInput} type="file" accept="image/*" hidden onChange={pickGlobalBg} />
          <button type="button" className={css.button} onClick={() => globalBgInput.current?.click()}>
            {t('background.upload')}
          </button>
          {config.globalBackground.image !== null && (
            <>
              <button type="button" className={css.buttonGhost} onClick={() => set({ globalBackground: { ...config.globalBackground, image: null } })}>
                {t('background.remove')}
              </button>
              <ImageThumb src={resolveImageSource(config.globalBackground.image) ?? undefined} />
            </>
          )}
        </div>
        {config.globalBackground.image !== null && (
          <>
            <RangeRow
              label={t('background.scrim')}
              value={config.globalBackground.scrim}
              min={0}
              max={0.9}
              step={0.05}
              onChange={(scrim) => set({ globalBackground: { ...config.globalBackground, scrim } })}
            />
            <div className={css.row}>
              <span className={css.rowLabel}>{t('background.fit')}</span>
              <div className={css.segRow}>
                {fitOptions.map(([fit, label]) => (
                  <button
                    key={fit}
                    type="button"
                    className={`${css.segButton} ${config.globalBackground.fit === fit ? css.segActive : ''}`}
                    onClick={() => set({ globalBackground: { ...config.globalBackground, fit } })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <RangeRow
              label={t('background.blur')}
              value={config.globalBackground.blur}
              min={0}
              max={60}
              step={2}
              onChange={(blur) => set({ globalBackground: { ...config.globalBackground, blur } })}
            />
          </>
        )}
      </div>

      <div className={css.group}>
        <div className={css.groupTitle}>{t('chrome.title')}</div>
        <div className={css.row}>
          <span className={css.rowLabel}>{t('chrome.favicon')}</span>
          <input ref={faviconInput} type="file" accept="image/*" hidden onChange={pickFavicon} />
          <button type="button" className={css.button} onClick={() => faviconInput.current?.click()}>
            {t('chrome.faviconUpload')}
          </button>
          {config.chrome.favicon !== null && (
            <>
              <img className={css.faviconPreview} src={resolveImageSource(config.chrome.favicon) ?? undefined} alt="" />
              <button type="button" className={css.buttonGhost} onClick={() => set({ chrome: { ...config.chrome, favicon: null } })}>
                {t('chrome.faviconRemove')}
              </button>
            </>
          )}
        </div>
        <div className={css.row}>
          <span className={css.rowLabel}>{t('chrome.titleLabel')}</span>
          <input
            type="text"
            className={css.textInput}
            value={config.chrome.title ?? ''}
            onChange={(e) => set({ chrome: { ...config.chrome, title: e.target.value || null } })}
          />
          {config.chrome.title !== null && (
            <button type="button" className={css.buttonGhost} onClick={() => set({ chrome: { ...config.chrome, title: null } })}>
              {t('chrome.titleClear')}
            </button>
          )}
        </div>
        <div className={css.row}>
          <span className={css.rowLabel}>{t('chrome.statusLabel')}</span>
          <input
            type="text"
            className={css.textInput}
            placeholder={t('chrome.statusPlaceholder')}
            value={config.chrome.statusText}
            onChange={(e) => set({ chrome: { ...config.chrome, statusText: e.target.value.slice(0, 64) } })}
          />
          {config.chrome.statusText !== '' && (
            <button type="button" className={css.buttonGhost} onClick={() => set({ chrome: { ...config.chrome, statusText: '' } })}>
              {t('chrome.statusClear')}
            </button>
          )}
        </div>
      </div>

      <div className={css.footer}>
        <button
          type="button"
          className={css.buttonDanger}
          onClick={() => {
            if (window.confirm(t('reset.confirm'))) reset()
          }}
        >
          {t('reset')}
        </button>
      </div>
    </div>
  )
}
