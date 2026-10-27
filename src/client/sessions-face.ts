/**
 * Minimal structural view of the Client services this plugin consumes.
 *
 * Declared locally instead of imported from the SDK packages: the package
 * deliberately keeps its runtime dependency surface to the platform modules,
 * and it only needs a handful of members. Keep the shapes in step with those
 * services when they change.
 *
 * Migrated for dsh `0.1.6-alpha.2` — that release reshaped the Session
 * Controller's client contract in three places this plugin depended on:
 *   - `SessionListState.current` was REMOVED; the current selection is now
 *     expressed by local retention, i.e. a row whose `retainedBy.mainView`
 *     count is non-zero (ui-session retains the main view's generation).
 *   - `ISessions.open(id)` was REMOVED; navigation is `ctx.uiWorkspace
 *     .openSession(target)` (ui-workspace owns "select a Session and show its
 *     Conversation").
 *   - `SessionSummary.completed` was REMOVED; an unacknowledged completion is
 *     now `SessionStatus.completionUnread` on the ui-session status map. Both
 *     facts are read here: `running` draws the spinner, `completionUnread`
 *     draws the static done mark, and the two are mutually exclusive because a
 *     turn that is executing again is the fresher fact.
 * `SessionSummary.title` also became optional and gained a sibling
 * `displayTitle` (durable title → project basename → session id), which is the
 * label a surface should prefer.
 */

/** Local ownership counts, keyed by the consuming subsystem's source label. */
export interface RetainedByLike {
  /** References held by the main conversation view — the selection marker. */
  mainView?: number
}

/** One session row as this surface reads it. */
export interface SessionListRow {
  /** Latest durable log-backed title; absent until the host projects one. */
  title?: unknown
  /** Human-facing label: durable title, project basename, then session id. */
  displayTitle?: unknown
  /** Whether the session's agent turn is currently executing. */
  running?: unknown
  /** Local ownership counts, including the `mainView` selection marker. */
  retainedBy?: RetainedByLike
}

/** The slice of the session-list snapshot this surface renders. */
export interface SessionListSnapshotLike {
  /** Host-list order; addressed breadcrumb-only rows are excluded. */
  ids?: unknown
  /** Host/catalog rows plus local fallback rows for live client generations. */
  byId?: Record<string, SessionListRow> | undefined
}

/** Observable snapshot source over the session list. */
export interface SessionListSource {
  getSnapshot(): unknown
  subscribe(listener: () => void): () => void
}

/** Result envelope of a session rename. */
export type RenameResult =
  | { ok: true; value: { title: string } }
  | { ok: false; error: { message?: string } }

/** The session face the strip needs (rename only). */
export interface SessionFaceLike {
  rename(title: string): Promise<RenameResult>
}

/** The session binding carrying the session face. */
export interface SessionBindingLike {
  session: SessionFaceLike
}

/** Independent UI status facts for one session identity. */
export interface SessionStatusLike {
  /** Latest known running state; absent until a baseline or event establishes it. */
  running?: unknown
  /**
   * A completion the user has not acknowledged yet: the turn stopped while this
   * session was not the one in view. The shell owns the fact and clears it when
   * that session is opened/seen; this surface only reads it, so it must never
   * clear the flag itself.
   */
  completionUnread?: unknown
  /**
   * The highest-priority request in this session that is waiting on the user
   * right now — `{ key, kind, sessionId }`, where `kind` is `'question'` or
   * `'plan-review'` as published by the shell's user-questions service. Its
   * presence means the turn is blocked until the user answers, so it outranks
   * both turn facts above. Read only: answering (and thus clearing it) is the
   * shell's job, never this surface's.
   */
  pendingInteraction?: unknown
}

/** Observable map of per-session UI status. */
export interface SessionStatusSource {
  getSnapshot(): unknown
  subscribe(listener: () => void): () => void
}

/** A caller-owned use of an exact client generation. */
export interface SessionReferenceLike {
  readonly binding: SessionBindingLike
  release(): void
}

/** Consumer identity of one acquisition; the source label is a free-form key. */
export interface SessionRetainOptionsLike {
  readonly source: string
}

/**
 * The Session Controller surface this plugin consumes.
 *
 * `using` is the supported way to reach a binding that is not retained yet:
 * it acquires a generation, awaits its shared open, runs the callback, and
 * releases. Reading `binding(id)` directly only works while somebody else
 * (the main view, a sidebar row) already holds the generation.
 */
export interface SessionsLike {
  readonly list: SessionListSource
  binding(id: string): SessionBindingLike | undefined
  using<T>(
    target: string,
    options: SessionRetainOptionsLike,
    operation: (reference: SessionReferenceLike) => T | Promise<T>,
  ): Promise<T>
}

/** Session selection and navigation (ui-workspace). */
export interface UiWorkspaceLike {
  /** Select a session and show its conversation as one navigation action. */
  openSession(target: string): void
}

/** The ui-session adapter exposing the per-session UI status source. */
export interface UiSessionLike {
  readonly sessionStatus: SessionStatusSource
}
