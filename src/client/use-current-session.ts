/**
 * The session list view every surface of this plugin renders.
 *
 * `currentSessionId` (the selection rule) and the live-title/presence view used
 * to live in the strip alone, but the favorites drawer needs the same answers:
 * which session is active, which ids are still listed, and which titles to
 * show. Both come from one place so the strip and the drawer cannot drift.
 *
 * `SessionListState.current` no longer exists (0.1.6 contract): the selection
 * is the row the main view retains — `retainedBy.mainView` — and a live
 * generation may sit outside the host list's `ids`, so `byId` is consulted as a
 * fallback.
 */
import { useCallback, useEffect, useState } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  SessionsLike,
  SessionStatusLike,
  SessionStatusSource,
  UiSessionLike,
} from './sessions-face.ts'
import { shortId } from './store.ts'

/** The subset of the list snapshot the selection rule reads. */
interface SelectionRow {
  byId?: Record<string, { retainedBy?: { mainView?: number } } | undefined> | undefined
  ids?: unknown
}

/** View of the live session list: presence, titles, running state, and the selection. */
export interface SessionView {
  current: string | undefined
  /** Ids still present in the live list, in list order. */
  liveIds: readonly string[]
  titles: Readonly<Record<string, string>>
  /** Ids whose agent turn is currently executing. */
  runningIds: ReadonlySet<string>
  /**
   * Ids holding an unacknowledged completion — a turn that stopped while the
   * user was not looking at that session. Mutually exclusive with `runningIds`:
   * a turn executing again is the fresher fact, so it drops the mark.
   */
  completedIds: ReadonlySet<string>
  /**
   * Ids with a request currently waiting on the user — a question or a plan
   * review, both published as `SessionStatus.pendingInteraction`. Recorded
   * independently of the two turn facts, because it does not describe the turn
   * but the fact that the turn cannot continue without an answer; the strip
   * gives it precedence over both.
   */
  waitingIds: ReadonlySet<string>
}

/** Empty view, used before the services answer. */
export const EMPTY_SESSION_VIEW: SessionView = {
  current: undefined,
  liveIds: [],
  titles: {},
  runningIds: new Set(),
  completedIds: new Set(),
  waitingIds: new Set(),
}

/**
 * Pick the session id the main view holds.
 * @param state - the Session Controller list snapshot (untyped on purpose:
 * the published SDK shapes differ between copies).
 * @returns the current session id, or undefined when nothing is selected.
 */
export function currentSessionId(state: unknown): string | undefined {
  const row = state as SelectionRow | undefined
  const ids = Array.isArray(row?.ids) ? (row?.ids as string[]) : []
  const byId = row?.byId ?? {}
  for (const id of ids) {
    if ((byId[id]?.retainedBy?.mainView ?? 0) > 0) return id
  }
  for (const id of Object.keys(byId)) {
    if ((byId[id]?.retainedBy?.mainView ?? 0) > 0) return id
  }
  return undefined
}

/**
 * Reduce the session-list and status snapshots to the fields the surfaces render.
 * @param state - the Session Controller list snapshot.
 * @param status - the ui-session status map snapshot.
 * @returns live ids, titles, running ids, completed ids, waiting ids, and the
 * current selection.
 */
export function reduceSessions(state: unknown, status: unknown): SessionView {
  const row = state as { ids?: unknown; byId?: Record<string, { title?: unknown; displayTitle?: unknown; running?: unknown }> | undefined } | undefined
  const ids = Array.isArray(row?.ids) ? (row?.ids as string[]) : []
  const byId = row?.byId ?? {}
  const statuses = status instanceof Map ? status as ReadonlyMap<string, SessionStatusLike> : undefined
  const titles: Record<string, string> = {}
  const runningIds = new Set<string>()
  const completedIds = new Set<string>()
  const waitingIds = new Set<string>()

  for (const id of ids) {
    const entry = byId[id]
    // `displayTitle` is the human-facing label; `title` is the raw durable one.
    const label = entry?.displayTitle ?? entry?.title
    titles[id] = typeof label === 'string' && label.trim() !== '' ? label : shortId(id)
    const fact = statuses?.get(id)
    // Status is the live authority; the row's own `running` is the fallback
    // until a baseline or event establishes the status entry.
    const running = fact !== undefined ? fact.running === true : entry?.running === true
    if (running) {
      runningIds.add(id)
    } else if (fact?.completionUnread === true) {
      // Not running and still unacknowledged: the turn finished while this
      // session was not the one in view, which is what the done mark reports.
      // Running wins over a stale flag, hence the `else`.
      completedIds.add(id)
    }
    // A pending question or plan review blocks the turn whatever `running`
    // says, so it is recorded on its own rather than inside the chain above;
    // the strip then lets it outrank both turn facts. Any kind counts.
    if (fact?.pendingInteraction !== undefined) {
      waitingIds.add(id)
    }
  }

  return {
    current: currentSessionId(state),
    liveIds: ids,
    titles,
    runningIds,
    completedIds,
    waitingIds,
  }
}

/**
 * Follow the session list and the per-session status map.
 *
 * A retained tab whose session left the list stays visible (dimmed) until the
 * user closes it, so the view keeps the titles it last saw.
 * @param ctx - the plugin's client context.
 * @returns the current view (empty until the services answer).
 */
export function useSessionView(ctx: ClientContext): SessionView {
  const sessions = useCallback(
    (): SessionsLike | undefined => ctx.get('sessions') as SessionsLike | undefined,
    [ctx],
  )
  const readView = useCallback((): SessionView => {
    const list = sessions()?.list
    const sessionStatus = (ctx.get('uiSession') as UiSessionLike | undefined)?.sessionStatus
    if (list === undefined) return EMPTY_SESSION_VIEW
    return reduceSessions(list.getSnapshot(), sessionStatus?.getSnapshot())
  }, [ctx, sessions])

  const [view, setView] = useState<SessionView>(() => readView())

  useEffect(() => {
    const sync = (): void => { setView(readView()) }
    // Status events (running → stopped) arrive on their own source; without it
    // the spinner would only clear on the next list change.
    const statuses: SessionStatusSource | undefined = (ctx.get('uiSession') as UiSessionLike | undefined)?.sessionStatus
    const offList = sessions()?.list.subscribe(sync)
    const offStatus = statuses?.subscribe(sync)
    sync()
    return () => {
      offList?.()
      offStatus?.()
    }
  }, [ctx, readView, sessions])

  return view
}
