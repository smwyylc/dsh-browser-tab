/**
 * The favorites drawer: a browser-bookmark-like panel that slides in from the
 * right edge of the conversation area, under the button at the right end of the
 * tab strip.
 *
 * Registered in `shell.overlay` (additive, next to the tab strip). It is
 * `position: fixed` and anchored to that button's own rectangle rather than to
 * any shell class name: opening the official right dock narrows the main panel
 * and moves the button, and the drawer follows it instead of covering the dock.
 * The strip holds itself on screen while this drawer is open (see
 * `RecentTabs.tsx`), so the anchor is never parked above the viewport; the
 * clamp here is the belt to that braces.
 *
 * Closed means unmounted — there is no hidden DOM. Open state is shared with
 * the button through `fav-drawer-state.ts`; the entries come from the store's
 * own favorites collection (so a bookmark outlives the tab that opened it),
 * titles from the same `useSessionView` hook the strip uses, and navigation
 * goes through `uiWorkspace.openSession` (never a direct `sessions.open`).
 *
 * Sized as a compact panel rather than a full-height column: its height follows
 * the content (see the CSS `max-height`), so it stops well above the composer
 * instead of covering the conversation all the way down.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RecentTabsController } from './controller.ts'
import { shortId } from './store.ts'
import type { UiWorkspaceLike } from './sessions-face.ts'
import { useSessionView } from './use-current-session.ts'
import { placeForVertical } from './drag-place.ts'
import { isFavoritesOpen, setFavoritesOpen, subscribeFavoritesOpen } from './fav-drawer-state.ts'
import { t } from './locales.ts'
import css from './recent-tabs.module.css'

/** Where a dragged bookmark would land: which item, and on which side of it. */
interface DropTarget {
  id: string
  place: 'before' | 'after'
}

/** Anchored corner of the drawer, in viewport pixels. */
interface Anchor {
  right: number
  top: number
}

/** Fallback when the favorites trigger is not on screen (another layout, a test). */
const FALLBACK_ANCHOR: Anchor = { right: 24, top: 64 }

/** Distance kept between the button and the drawer, and from the viewport edge. */
const GAP = 6
const EDGE = 12
/** The drawer never hugs the very top, even when its anchor is off-screen. */
const MIN_TOP = 8

/** The favorites trigger, located by its own semantic attribute — never a shell class. */
function findFavoriteButton(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-dsh-part="favorite-button"]')
}

/**
 * Render the favorites drawer.
 * @param props - controller and the plugin's client context.
 * @returns the drawer, or null while it is closed.
 */
export function FavoritesPanel({ controller, ctx }: { controller: RecentTabsController; ctx: ClientContext }): React.JSX.Element | null {
  const open = useSyncExternalStore(subscribeFavoritesOpen, isFavoritesOpen)
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const live = useSessionView(ctx)

  const panelRef = useRef<HTMLDivElement | null>(null)
  const [anchor, setAnchor] = useState<Anchor>(FALLBACK_ANCHOR)

  /**
   * Re-read the button rectangle. The drawer hangs off the button's right and
   * bottom edges, so it tracks the official right dock as it opens or closes.
   */
  const measure = useCallback((): void => {
    const button = findFavoriteButton()
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
  // button itself, so the whole ancestor chain is watched — the element that
  // gives way is somewhere up there.
  useEffect(() => {
    if (!open) return
    measure()
    window.addEventListener('resize', measure)
    const watched: HTMLElement[] = []
    let node = findFavoriteButton()?.parentElement ?? null
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
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target) === true) return
      if (findFavoriteButton()?.contains(target) === true) return
      setFavoritesOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFavoritesOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  /** Navigation lives with ui-workspace since 0.1.6; `sessions.open` is gone. */
  const openSession = useCallback((id: string): void => {
    const uiWorkspace = ctx.get('uiWorkspace') as UiWorkspaceLike | undefined
    if (uiWorkspace === undefined) {
      console.warn('[recent-tabs] ui-workspace is unavailable; cannot switch sessions')
      return
    }
    uiWorkspace.openSession(id)
  }, [ctx])

  const switchTo = useCallback((id: string): void => {
    if (live.current === id) return
    openSession(id)
  }, [live.current, openSession])

  // --- Vertical drag to reorder -------------------------------------------
  const [draggingId, setDraggingId] = useState<string | undefined>(undefined)
  const [dropTarget, setDropTarget] = useState<DropTarget | undefined>(undefined)
  const draggingRef = useRef<string | undefined>(undefined)
  const dropRef = useRef<DropTarget | undefined>(undefined)

  const endDrag = useCallback((): void => {
    draggingRef.current = undefined
    dropRef.current = undefined
    setDraggingId(undefined)
    setDropTarget(undefined)
  }, [])

  const startDrag = useCallback((event: React.DragEvent<HTMLElement>, id: string): void => {
    draggingRef.current = id
    dropRef.current = undefined
    setDraggingId(id)
    setDropTarget(undefined)
    // Some browsers refuse a drop without payload; the ref stays authoritative.
    const transfer = event.dataTransfer as DataTransfer | undefined
    transfer?.setData('text/plain', id)
    if (transfer !== undefined) transfer.effectAllowed = 'move'
  }, [])

  const dragOverItem = useCallback((event: React.DragEvent<HTMLElement>, id: string): void => {
    const source = draggingRef.current
    if (source === undefined || source === id) return
    event.preventDefault()
    const transfer = event.dataTransfer as DataTransfer | undefined
    if (transfer !== undefined) transfer.dropEffect = 'move'
    const place = placeForVertical(event)
    const previous = dropRef.current
    if (previous !== undefined && previous.id === id && previous.place === place) return
    dropRef.current = { id, place }
    setDropTarget({ id, place })
  }, [])

  const dropOnItem = useCallback((event: React.DragEvent<HTMLElement>, id: string): void => {
    event.preventDefault()
    event.stopPropagation()
    const source = draggingRef.current
    if (source !== undefined && source !== id) {
      const target = dropRef.current
      // Fall back to the pointer position when no dragover preceded the drop.
      const place = target !== undefined && target.id === id ? target.place : placeForVertical(event)
      // Reordering never navigates, and it never touches the tab list.
      controller.moveFavorite(source, id, place)
    }
    endDrag()
  }, [controller, endDrag])

  if (!open) return null

  const current = live.current
  const favorite = current !== undefined
    && snapshot.favorites.some(entry => entry.id === current)
  const starLabel = favorite ? t('star.unfavorite') : t('star.favorite')

  // The drawer lists the favorites collection, not a filtered tab list: a
  // bookmark survives the tab being closed.
  const items = snapshot.favorites
  const rows = items.map(entry => {
    const isLive = live.liveIds.indexOf(entry.id) >= 0
    const title = isLive ? live.titles[entry.id] ?? entry.title : entry.title
    const drop = dropTarget !== undefined && dropTarget.id === entry.id ? dropTarget.place : undefined
    return (
      <div
        key={entry.id}
        className={css.favItem}
        draggable
        data-dsh-plugin="recent-tabs"
        data-dsh-part="favItem"
        data-active={live.current === entry.id ? '1' : '0'}
        data-stale={isLive ? '0' : '1'}
        data-dragging={draggingId === entry.id ? '1' : '0'}
        data-drop={drop}
        title={isLive ? t('fav.open') : t('bar.stale')}
        onClick={() => switchTo(entry.id)}
        onDragStart={(event) => startDrag(event, entry.id)}
        onDragOver={(event) => dragOverItem(event, entry.id)}
        onDrop={(event) => dropOnItem(event, entry.id)}
        onDragEnd={endDrag}
      >
        <span className={css.favStar} />
        <span className={css.favItemLabel}>{title}</span>
        <button
          className={css.favRemove}
          type="button"
          data-dsh-part="favRemove"
          title={t('fav.remove')}
          aria-label={t('fav.remove')}
          onClick={(event) => {
            event.stopPropagation()
            // Unpin only: the tab and its session stay exactly where they are.
            controller.toggleFavorite(entry.id)
          }}
        >
          {'\u00d7'}
        </button>
      </div>
    )
  })

  return (
    <div
      ref={panelRef}
      className={css.favPanel}
      role="dialog"
      aria-label={t('fav.title')}
      aria-modal="false"
      tabIndex={-1}
      data-dsh-plugin="recent-tabs"
      data-dsh-part="favorites"
      style={{ right: `${anchor.right}px`, top: `${anchor.top}px` }}
    >
      <div className={css.favHead}>
        <span className={css.favTitle}>{t('fav.title')}</span>
        {current === undefined ? null : (
          <button
            className={css.starButton}
            type="button"
            data-dsh-plugin="recent-tabs"
            data-dsh-part="favorite-star"
            data-favorite={favorite ? '1' : '0'}
            title={starLabel}
            aria-label={starLabel}
            aria-pressed={favorite}
            onClick={() => {
              const title = live.titles[current] ?? shortId(current)
              // Record first so the strip also knows the session was opened;
              // the bookmark itself is stored with the title shown right now.
              controller.record(current, title)
              controller.toggleFavorite(current, title)
            }}
          >
            <span className={css.starGlyph} />
          </button>
        )}
      </div>
      {items.length === 0 ? <p className={css.favEmpty}>{t('fav.empty')}</p> : null}
      <div className={css.favList}>{rows}</div>
    </div>
  )
}
