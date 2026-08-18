/**
 * Minimal type surface for the `webServer` service the host half consumes.
 *
 * The real service lives in @deepseek-ai/dsh-host-webserver, provided by the
 * web composition (web-app itself injects it). This package deliberately does
 * not depend on that package — it is a standalone plugin and the profile's
 * node_modules does not carry it — so we declare the one member we use here
 * and rely on the runtime service. The augmentation is type-only; nothing is
 * imported at runtime.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { PersonalizationConfig } from '../shared/config.ts'

/** Route match kind: 'exact' matches the pathname verbatim; 'prefix' matches p and p/<anything>. */
export type PersonalWebRouteKind = 'exact' | 'prefix'

/** One named route registration (subset of the host webserver contract). */
export interface PersonalWebRoute {
  kind: PersonalWebRouteKind
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns the full response lifecycle (may hold the response open, e.g. SSE). */
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** One invocation handed to a registered command handler. */
export interface PersonalCommandInvocation {
  readonly commandId: string
  readonly agent: string
  /** Exact text following the command name, including separator whitespace. */
  readonly rawInput: string
  readonly signal: AbortSignal
}

/** Result a command handler returns. */
export type PersonalCommandResult =
  | { kind: 'success'; text?: string }
  | { kind: 'error'; text: string }

/** The command registry surface (subset of @deepseek-ai/dsh-commands). */
export interface PersonalCommandRuntime {
  register(definition: {
    name: string
    description: string
    input?: { hint: string }
    recordInput?: boolean
    handler: (invocation: PersonalCommandInvocation) => PersonalCommandResult | Promise<PersonalCommandResult>
  }): () => void
}

/** One committed store read (as exposed by the personalization service). */
export interface PersonalServiceSnapshot {
  revision: number
  config: PersonalizationConfig
  written: boolean
}

/** The `ctx.personalization` service this plugin provides to other plugins. */
export interface PersonalizationService {
  /** Current revision + config. */
  read(): Promise<PersonalServiceSnapshot>
  /** Deep-merge a partial patch into the config and persist it. */
  update(patch: unknown): Promise<PersonalServiceSnapshot>
  /** Restore the default configuration. */
  reset(): Promise<PersonalServiceSnapshot>
  /** Observe committed writes (new revision). */
  onUpdated(listener: (revision: number) => void): () => void
}

/** One model-facing tool execution context (subset of dsh-tools' ToolRunContext). */
export interface PersonalToolRunContext {
  /** Cancellation signal owned by the calling request. */
  readonly signal: AbortSignal
}

/** A minimal tool definition the tools registry accepts (subset of dsh-tools' ToolDefinition). */
export interface PersonalToolDefinition {
  /** Unique tool name. */
  name: string
  /** Human-readable description sent to the model. */
  description: string
  /** JSON Schema object for the arguments (already compiled). */
  parameters: Record<string, unknown>
  /** Canonical output declaration. */
  output: {
    /** JSON Schema enforced against every successful canonical value. */
    schema: Record<string, unknown>
    /** Pure projection from validated arguments + value to model-facing content. */
    render(args: unknown, value: unknown): { type: 'text'; text: string }[]
  }
  /** Cooperative timeout budget; omit for none. */
  timeoutMs?: number
  /** Whether one call may join a parallel group (only exact true opts in). */
  isConcurrencySafe?(args: unknown): boolean
  /** Run one accepted call and return its canonical JSON value. */
  execute(args: unknown, exec: PersonalToolRunContext): Promise<unknown>
}

/** The tool registry surface (subset of @deepseek-ai/dsh-tools). */
export interface PersonalToolRuntime {
  register(definition: PersonalToolDefinition): () => void
}

/** The system prompt section registry (subset of @deepseek-ai/dsh-system-prompt). */
export interface PersonalSystemPrompt {
  section(options: {
    name: string
    order: number
    text: string | (() => string)
  }): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * The web HTTP carrier service (provided by the web composition). A
     * duplicate (kind, path) registration throws; the disposer removes it.
     */
    webServer: {
      register(route: PersonalWebRoute): () => void
    }
    /**
     * The human-command registry (provided by the base bundle's dsh-commands
     * row). Registered lazily via ctx.inject so the plugin applies even where
     * the service is absent.
     */
    commands: PersonalCommandRuntime
    /**
     * The personalization service this plugin provides: read/update/reset the
     * machine-level config, observe revisions. Other plugins inject
     * ['personalization'] to use it.
     */
    personalization: PersonalizationService
    /**
     * The model-facing tool registry (provided by the base bundle's dsh-tools
     * row). Registered lazily via ctx.inject so the plugin applies even where
     * the service is absent.
     */
    tools: PersonalToolRuntime
    /**
     * The system prompt section registry (provided by the base bundle).
     */
    systemPrompt: PersonalSystemPrompt
  }
}

/** Type-only import keeps the augmentation's module graph intact. */
export type { Context, IncomingMessage, ServerResponse }
