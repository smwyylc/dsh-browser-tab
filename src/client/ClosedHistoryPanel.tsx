/**
 * The recently-closed drawer: a compact popover under the second button of the
 * tab strip, listing the tabs the user closed by hand and reopening them.
 *
 * Registered in `shell.overlay` next to the strip and the favorites drawer, so
 * it is a sibling of both rather than a child of either. It is `position: fixed`
 * and anchored to its own button's rectangle (never to a shell class name):
 * opening the official right dock narrows the main panel and moves that button,
 * and the drawer follows it instead of covering the dock. The strip holds itself
 * on screen while either drawer is open (see `RecentTabs.tsx`), so the anchor is
 * never parked above the viewport; the clamp here is the belt to that braces.
 *
 * Closed means unmounted — no hidden DOM. Rows come from the store's `closed`
 * collection (newest first), titles from the same `useSessionView` hook the
 * strip uses, and opening one goes through `uiWorkspace.openSession`. A row
 * whose session is gone stays listed, dimmed and disabled: it is a record of
 * something that happened, and a dead entry must not navigate anywhere.
 *
 * Sized like the favorites drawer: 192-208px wide, height following its content
 * up to 60vh / 520px, with the list itself scrolling. It sits one layer above
 * that drawer (2147483004) because the two can never be open at once and this
 * one is newer in the stack; no other layer depends on the step.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RecentTabsController } from './controller.ts'
import type { UiWorkspaceLike } from './sessions-face.ts'
import { useSessionView } from './use-current-session.ts'
import {
  isClosedHistoryOpen,
  setClosedHistoryOpen,
  subscribeClosedHistoryOpen,
} from './hist-drawer-state.ts'
import { t } from './locales.ts'
import css from './recent-tabs.module.css'

/** Anchored corner of the drawer, in viewport pixels. */
interface Anchor {
  right: number
  top: number
}

/** Fallback when the history trigger is not on screen (another layout, a test). */
const FALLBACK_ANCHOR: Anchor = { right: 24, top: 64 }

/** Distance kept between the button and the drawer, and from the viewport edge. */
const GAP = 6
const EDGE = 12
/** The drawer never hugs the very top, even when its anchor is off-screen. */
const MIN_TOP = 8

/** The history trigger, located by its own semantic attribute — never a shell class. */
function findHistoryButton(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-dsh-part="closed-history-button"]')
}

/**
 * Render the recently-closed drawer.
 * @param props - controller and the plugin's client context.
 * @returns the drawer, or null while it is closed.
 */
export function ClosedHistoryPanel({ controller, ctx }: { controller: RecentTabsController; ctx: ClientContext }): React.JSX.Element | null {
  const open = useSyncExternalStore(subscribeClosedHistoryOpen, isClosedHistoryOpen)
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const live = useSessionView(ctx)

  const panelRef = useRef<HTMLDivElement | null>(null)
  const [anchor, setAnchor] = useState<Anchor>(FALLBACK_ANCHOR)

  /**
   * Re-read the button rectangle. The drawer hangs off the button's right and
   * bottom edges, so it tracks the official right dock as it opens or closes.
   */
  const measure = useCallback((): void => {
    const button = findHistoryButton()
    if (button === null) {
      setAnchor(FALLBACK_ANCHOR)
      return
    }
    const rect = button.getBoundingClientRect()
    const width = typeof window === 'undefined' ? 0 : window.innerWidth
    setAnchor({
      right: Math.max(EDGE, width - rect.right),
      // Clamped: the trigger lives on a hover surface, so its rectangle can be
      // above the viewport. A raw `rect.bottom + GAP` would open the drawer
      // off-screen; the top edge is as far up as it may go.
      top: Math.max(MIN_TOP, rect.bottom + GAP),
    })
  }, [])

  // Anchor on open, on resize, and whenever any ancestor of the button changes
  // box: a layout change around the strip moves the button without resizing the
  // button itself, so the whole ancestor chain is watched.
  useEffect(() => {
    if (!open) return
    measure()
    window.addEventListener('resize', measure)
    const watched: HTMLElement[] = []
    let node = findHistoryButton()?.parentElement ?? null
    while (node !== null && watched.length < 8) {
      watched.push(node)
      node = node.parentElement
    }
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => { measure() })
      : undefined
    watched.forEach(element => observer?.observe(element))
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [measure, open])

  // Move focus into the drawer so Escape and the scroll keys land here.
  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
  }, [open])

  // Escape and a click anywhere outside (the toggle button excluded, so its own
  // click closes rather than closing and reopening) both dismiss the drawer.
  // Escape is stopped here so it cannot also close whatever sits underneath.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target) === true) return
      if (findHistoryButton()?.contains(target) === true) return
      setClosedHistoryOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setClosedHistoryOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  /** Navigation lives with ui-workspace since 0.1.6; `sessions.open` is gone. */
  const reopen = useCallback((id: string): void => {
    // Same rule as the favorites drawer: never re-open what is already in view.
    if (live.current === id) return
    const uiWorkspace = ctx.get('uiWorkspace') as UiWorkspaceLike | undefined
    if (uiWorkspace === undefined) {
      console.warn('[recent-tabs] ui-workspace is unavailable; cannot switch sessions')
      return
    }
    uiWorkspace.openSession(id)
  }, [ctx, live.current])

  if (!open) return null

  const rows = snapshot.closed.map(row => {
    const isLive = live.liveIds.indexOf(row.id) >= 0
    const title = isLive ? live.titles[row.id] ?? row.title : row.title
    const label = `${isLive ? t('hist.reopen') : t('hist.dead')}: ${title}`
    return (
      <button
        key={row.id}
        className={css.histRow}
        type="button"
        data-dsh-plugin="recent-tabs"
        data-dsh-part="closed-history-row"
        data-stale={isLive ? '0' : '1'}
        title={isLive ? t('hist.reopen') : t('hist.dead')}
        aria-label={label}
        // A session that no longer exists cannot be reopened; the row still
        // lists, so the history does not quietly rewrite itself.
        disabled={!isLive}
        onClick={() => { reopen(row.id) }}
      >
        <span className={css.histRowLabel}>{title}</span>
      </button>
    )
  })

  return (
    <div
      ref={panelRef}
      className={css.histPanel}
      role="dialog"
      aria-label={t('hist.panelTitle')}
      aria-modal="false"
      tabIndex={-1}
      data-dsh-plugin="recent-tabs"
      data-dsh-part="closed-history"
      style={{ right: `${anchor.right}px`, top: `${anchor.top}px` }}
    >
      <div className={css.histHead}>
        <span className={css.histTitle}>{t('hist.panelTitle')}</span>
      </div>
      {snapshot.closed.length === 0 ? <p className={css.histEmpty}>{t('hist.empty')}</p> : null}
      <div className={css.histList}>{rows}</div>
    </div>
  )
}
