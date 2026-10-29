/**
 * The hover-revealed tab strip: one row of recent-session tabs.
 *
 * Data comes from the Client services directly (`ctx.get`), not from Slot
 * props: the strip is global, while Slot props are scoped to a session. The
 * store owns the retained list; this component only renders it.
 *
 * Renaming edits the SESSION, not just the tab: it settles the host 'title'
 * projection, and the next list snapshot carries the new name into every
 * consumer (this strip included). The tab list therefore stays free of a
 * second, divergent title source.
 *
 * Favorites are not a tab field: the star trigger sits at the far right of this
 * very bar (`FavoriteButton.tsx`), and the bookmark list is the drawer on the
 * right edge (`FavoritesPanel.tsx`). The strip only offers the per-tab context
 * menu that pins or unpins one tab, and that menu writes to the store's
 * favorites collection — never to the tab row, so closing the tab keeps the
 * bookmark.
 *
 * The bar carries TWO tail triggers and is the anchor of both popovers they
 * open: the favorites drawer (`FavoritesPanel.tsx`) and the recently-closed
 * drawer (`ClosedHistoryPanel.tsx`). The two are mutually exclusive at the
 * state-module level, so only one of them can hold the bar down at a time.
 *
 * The bar is also each drawer's anchor, so they are coupled in one direction:
 * while either drawer is open the bar is held on screen even with the pointer
 * far away, because a parked bar would put the buttons (and thus the anchors)
 * above the viewport.
 *
 * Migrated for dsh `0.1.6-alpha.2` (see `sessions-face.ts` for the contract
 * changes): the current session is now read off local retention
 * (`retainedBy.mainView`), switching goes through `uiWorkspace.openSession`,
 * and the running flag comes from the ui-session status map.
 *
 * A tab carries three status markers, never more than one at a time: the
 * spinner while its agent turn is executing ("waiting for the answer"), a small
 * static blue check while a turn has finished that the user has not
 * acknowledged ("the answer landed while you were elsewhere"), and a small
 * blue question mark while the session is blocked on an interaction the user
 * has not answered yet ("it asked you something"). Precedence is
 * waiting > running > completed: a question outranks the turn facts because the
 * turn cannot proceed until it is answered, and a turn that is executing again
 * outranks a stale unread flag. With none of the three the tab is plain. All
 * marks sit in the same leading slot before the title, and the active dot is a
 * separate, later slot — "you are here" is not a status of the turn.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RecentTabsController } from './controller.ts'
import { findFavorite, shortId } from './store.ts'
import type { SessionsLike, UiWorkspaceLike } from './sessions-face.ts'
import { useSessionView } from './use-current-session.ts'
import { placeFor } from './drag-place.ts'
import { isFavoritesOpen, subscribeFavoritesOpen } from './fav-drawer-state.ts'
import { isClosedHistoryOpen, subscribeClosedHistoryOpen } from './hist-drawer-state.ts'
import { FavoriteButton } from './FavoriteButton.tsx'
import { ClosedHistoryButton } from './ClosedHistoryButton.tsx'
import { t } from './locales.ts'
import css from './recent-tabs.module.css'

/**
 * Reference-source label for the strip's own transient holds. Retention counts
 * are keyed by free-form consumer labels; `mainView` is ui-session's marker for
 * the current selection, so this plugin must use a distinct key or it would
 * masquerade as the main view.
 */
const RETAIN_SOURCE = 'recentTabsRename'

/** Where a dragged tab would land: which tab, and on which side of it. */
interface DropTarget {
  id: string
  place: 'before' | 'after'
}

/** The tab context menu: which tab, and where the pointer opened it. */
interface TabMenu {
  id: string
  x: number
  y: number
}

/** Menu width/height budget used to keep the popup inside the viewport. */
const MENU_WIDTH = 150
const MENU_HEIGHT = 44

/** Pixels in one wheel "line"; the browser-typical row height for `deltaMode` 1. */
const WHEEL_LINE_PX = 16

/**
 * Convert one wheel delta axis into pixels.
 *
 * `deltaMode` names the UNIT the delta is counted in, not what it means: 0 is
 * already pixels, 1 counts lines, 2 counts pages. Anything else is a mode this
 * browser does not document, so the raw delta is used rather than guessing a
 * factor.
 * @param delta - the raw delta of one axis.
 * @param mode - the event's `deltaMode`.
 * @param page - one page in pixels, i.e. the scrolling row's own width.
 */
function wheelPixels(delta: number, mode: number, page: number): number {
  if (mode === 1) return delta * WHEEL_LINE_PX
  if (mode === 2) return delta * page
  return delta
}

/**
 * Render the tab strip.
 * @param props - controller and the plugin's client context.
 */
export function RecentTabs({ controller, ctx }: { controller: RecentTabsController; ctx: ClientContext }): React.JSX.Element {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)

  const sessions = useCallback(
    (): SessionsLike | undefined => ctx.get('sessions') as SessionsLike | undefined,
    [ctx],
  )
  const live = useSessionView(ctx)

  // Record the session the user is actually looking at, and only that one.
  // Deliberately keyed on the current session (plus its title) rather than on
  // the whole snapshot: re-recording every retained tab here would resurrect a
  // tab the user just closed, because this effect still holds the previous
  // render's view.
  const currentId = live.current
  const currentTitle = currentId === undefined ? undefined : live.titles[currentId]
  useEffect(() => {
    if (currentId === undefined) return
    controller.record(currentId, currentTitle ?? shortId(currentId))
  }, [controller, currentId, currentTitle])

  const [open, setOpen] = useState(false)
  const hide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // --- A drawer holds the bar up -------------------------------------------
  /** Favorites drawer open state, mirrored from the module-level observable. */
  const favoritesOpen = useSyncExternalStore(subscribeFavoritesOpen, isFavoritesOpen)
  /** Recently-closed drawer open state, its own observable. */
  const historyOpen = useSyncExternalStore(subscribeClosedHistoryOpen, isClosedHistoryOpen)
  /** Either drawer open: both hang off this bar, and both need its button. */
  const drawerOpen = favoritesOpen || historyOpen
  /** Read by the hide timer, which must not retract from under a drawer. */
  const drawerOpenRef = useRef(drawerOpen)
  /** Whether the pointer is on the bar right now (closing a drawer by button). */
  const hoverRef = useRef(false)
  /** Tracks the open -> closed edge, so the 260ms timer only restarts once. */
  const drawerWasOpen = useRef(drawerOpen)

  useEffect(() => {
    drawerOpenRef.current = drawerOpen
  }, [drawerOpen])

  const clearHide = useCallback((): void => {
    if (hide.current !== undefined) {
      clearTimeout(hide.current)
      hide.current = undefined
    }
  }, [])

  const show = useCallback((): void => {
    clearHide()
    setOpen(true)
  }, [clearHide])

  // --- Tab context menu ----------------------------------------------------
  /** Menu open right now, or undefined. */
  const [menu, setMenu] = useState<TabMenu | undefined>(undefined)
  const menuRef = useRef<HTMLDivElement | null>(null)
  /** Read by the hover timer so an open menu keeps the bar on screen. */
  const menuOpenRef = useRef(false)

  useEffect(() => {
    menuOpenRef.current = menu !== undefined
  }, [menu])

  const scheduleHide = useCallback((): void => {
    clearHide()
    hide.current = setTimeout(() => {
      hide.current = undefined
      if (menuOpenRef.current) return
      // A drawer hangs off this bar: retracting would take its anchor with it.
      if (drawerOpenRef.current) return
      setOpen(false)
    }, 260)
  }, [clearHide])

  // The bar carries both drawers' anchors, and a parked bar puts those anchors
  // above the viewport. So opening either drawer pulls the bar down and keeps
  // it there; closing it hands the bar back to the ordinary 260ms timer.
  useEffect(() => {
    if (drawerOpen) {
      drawerWasOpen.current = true
      show()
      return
    }
    if (!drawerWasOpen.current) return
    drawerWasOpen.current = false
    // Closed through a button: the pointer is still on the bar, so leave it
    // up until it leaves on its own.
    if (!hoverRef.current) scheduleHide()
  }, [drawerOpen, scheduleHide, show])

  useEffect(() => clearHide, [clearHide])

  // Close the menu on any of the four dismiss gestures the shell does not own:
  // a click elsewhere, Escape, any scroll, or the window losing focus.
  useEffect(() => {
    if (menu === undefined) return
    const close = (): void => { setMenu(undefined) }
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target) === true) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    // Capture: a strip that scrolls sideways scrolls an inner element.
    window.addEventListener('scroll', close, true)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  // --- Wheel scrolls the tabs sideways -------------------------------------
  /**
   * The row scrolls on its own already, but only through its scrollbar or a
   * trackpad gesture; a plain mouse wheel over it has nothing vertical to
   * consume and does nothing. Turn that wheel into horizontal travel, the way a
   * browser's tab bar does it, so no Shift is needed.
   *
   * Bound to the row, never to the bar: the favorites trigger sits in the bar
   * but outside the row and must not move the tabs, and a wheel anywhere else
   * stays the page's. `passive: false` is what lets `preventDefault` bite here,
   * which is why this is a native listener rather than React's synthetic
   * `onWheel`.
   */
  const stripRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const row = stripRef.current
    if (row === null) return
    const onWheel = (event: WheelEvent): void => {
      // Zero `deltaY` is either a pure horizontal gesture (the row already
      // scrolls on that natively) or no motion at all: nothing to convert.
      if (event.deltaY === 0) return
      // A pinch zoom arrives as a ctrl-held wheel on every desktop browser;
      // it zooms the page instead of scrolling anything, so leave it alone.
      if (event.ctrlKey) return
      event.preventDefault()
      const page = row.clientWidth
      row.scrollLeft += wheelPixels(event.deltaY, event.deltaMode, page)
        + wheelPixels(event.deltaX, event.deltaMode, page)
    }
    row.addEventListener('wheel', onWheel, { passive: false })
    return () => { row.removeEventListener('wheel', onWheel) }
  }, [])

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

  // Closing the tab you are looking at hands the view to the tab you were on
  // before it (MRU). Closing any other tab leaves the view alone.
  const closeTab = useCallback((id: string): void => {
    const wasActive = live.current === id
    const fallback = controller.remove(id)
    if (!wasActive || fallback === undefined) return
    openSession(fallback)
  }, [controller, live.current, openSession])

  // --- Drag to reorder -----------------------------------------------------
  /** Source tab of the current drag (state drives styling, ref the handlers). */
  const [draggingId, setDraggingId] = useState<string | undefined>(undefined)
  /** Tab under the pointer with the side the dragged tab would land on. */
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

  const dragOverTab = useCallback((event: React.DragEvent<HTMLElement>, id: string): void => {
    const source = draggingRef.current
    if (source === undefined || source === id) return
    event.preventDefault()
    const transfer = event.dataTransfer as DataTransfer | undefined
    if (transfer !== undefined) transfer.dropEffect = 'move'
    const place = placeFor(event)
    const previous = dropRef.current
    if (previous !== undefined && previous.id === id && previous.place === place) return
    dropRef.current = { id, place }
    setDropTarget({ id, place })
  }, [])

  const dropOnTab = useCallback((event: React.DragEvent<HTMLElement>, id: string): void => {
    event.preventDefault()
    event.stopPropagation()
    const source = draggingRef.current
    if (source !== undefined && source !== id) {
      const target = dropRef.current
      // Fall back to the pointer position when no dragover preceded the drop.
      const place = target !== undefined && target.id === id ? target.place : placeFor(event)
      // Reordering never navigates: the drop belongs to the strip, not the view.
      controller.move(source, id, place)
    }
    endDrag()
  }, [controller, endDrag])

  // --- Inline rename -------------------------------------------------------
  /** Session id being renamed, or undefined when no editor is open. */
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement | null>(null)
  /** Refs so the blur path sees live values without re-creating handlers. */
  const editingRef = useRef<string | undefined>(undefined)
  const draftRef = useRef('')

  const beginRename = useCallback((id: string, title: string): void => {
    editingRef.current = id
    draftRef.current = title
    setEditing(id)
    setDraft(title)
    setError(undefined)
  }, [])

  const cancelRename = useCallback((): void => {
    editingRef.current = undefined
    setEditing(undefined)
    setError(undefined)
  }, [])

  const commitRename = useCallback(async (id: string, raw: string): Promise<void> => {
    const title = raw.trim()
    if (title === '') {
      cancelRename()
      return
    }
    const previous = live.titles[id] ?? ''
    if (title === previous) {
      cancelRename()
      return
    }
    const service = sessions()
    if (service === undefined) {
      cancelRename()
      return
    }
    try {
      // A binding only exists while someone holds that generation, so borrow one
      // for the call whenever the row being renamed is not already held.
      const held = service.binding(id)
      const result = held !== undefined
        ? await held.session.rename(title)
        : await service.using(id, { source: RETAIN_SOURCE }, reference => reference.binding.session.rename(title))
      if (result.ok) {
        cancelRename()
        return
      }
    } catch (failure) {
      // Keep the editor open so the user can retry or escape.
      console.warn('[recent-tabs] rename failed:', failure)
    }
    setError(t('rename.failed'))
  }, [cancelRename, live.titles, sessions])

  // Focus the editor as soon as it appears, and select the whole title so a
  // rename is one gesture.
  useEffect(() => {
    if (editing === undefined) return
    const input = inputRef.current
    if (input === null) return
    input.focus()
    input.select()
  }, [editing])

  const onEditorKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      const id = editingRef.current
      if (id !== undefined) void commitRename(id, draftRef.current)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelRename()
    }
  }, [commitRename, cancelRename])

  const rows = snapshot.tabs.map(tab => {
    const active = live.current === tab.id
    const isLive = live.liveIds.indexOf(tab.id) >= 0
    // One leading slot, one mark: the question outranks the turn facts because
    // the turn cannot move until it is answered, and a running turn outranks a
    // stale unread flag. Two leading marks on one 150px tab would read as
    // clutter, so each step drops the ones below it.
    const waiting = isLive && live.waitingIds.has(tab.id)
    const running = !waiting && isLive && live.runningIds.has(tab.id)
    const completed = !waiting && !running && isLive && live.completedIds.has(tab.id)
    const title = isLive ? live.titles[tab.id] : tab.title
    const drop = dropTarget !== undefined && dropTarget.id === tab.id ? dropTarget.place : undefined
    if (editing === tab.id) {
      return (
        <div
          key={tab.id}
          className={css.tab}
          draggable={false}
          data-active={active ? '1' : '0'}
          data-editing="1"
        >
          <input
            ref={inputRef}
            className={css.editor}
            value={draft}
            aria-label={t('rename.label')}
            onChange={(event) => {
              draftRef.current = event.target.value
              setDraft(event.target.value)
            }}
            onKeyDown={onEditorKeyDown}
            onBlur={(event) => {
              // The shell fires a spurious blur on the focused element a few frames after
              // focus lands; the caret never left, so this is not a real dismissal.
              if (document.activeElement === event.target) return
              const id = editingRef.current
              if (id !== undefined) void commitRename(id, draftRef.current)
            }}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          />
        </div>
      )
    }
    return (
      <div
        key={tab.id}
        className={css.tab}
        draggable
        data-active={active ? '1' : '0'}
        data-stale={isLive ? '0' : '1'}
        data-dragging={draggingId === tab.id ? '1' : '0'}
        data-drop={drop}
        title={isLive ? t('tab.renameHint') : t('bar.stale')}
        onClick={() => switchTo(tab.id)}
        onDoubleClick={(event) => {
          event.stopPropagation()
          if (!isLive) return
          beginRename(tab.id, title)
        }}
        onContextMenu={(event) => {
          // The shell's own context menu is not what this surface is for.
          event.preventDefault()
          event.stopPropagation()
          setMenu({ id: tab.id, x: event.clientX, y: event.clientY })
        }}
        onDragStart={(event) => startDrag(event, tab.id)}
        onDragOver={(event) => dragOverTab(event, tab.id)}
        onDrop={(event) => dropOnTab(event, tab.id)}
        onDragEnd={endDrag}
      >
        {waiting ? <span className={css.waitMark} role="img" aria-label={t('tab.waiting')} /> : null}
        {running ? <span className={css.runSpinner} role="img" aria-label={t('tab.running')} /> : null}
        {completed ? <span className={css.doneMark} role="img" aria-label={t('tab.completed')} /> : null}
        {active ? <span className={css.dot} /> : null}
        <span className={css.label}>{title}</span>
        <button
          className={css.close}
          type="button"
          title={t('tab.close')}
          onClick={(event) => {
            event.stopPropagation()
            closeTab(tab.id)
          }}
        >
          {'\u00d7'}
        </button>
      </div>
    )
  })

  // --- Menu body -----------------------------------------------------------
  /** The retained row the menu opened on, if it is still there. */
  const menuTab = menu === undefined ? undefined : snapshot.tabs.find(tab => tab.id === menu.id)
  // Bookmark state is a lookup in the favorites tree, not a field on the tab
  // row: the menu must offer "remove" for a bookmark whose tab was closed and
  // reopened, and for one filed inside a folder. The flag lives on the menu item
  // alone (`data-favorite`, the weight step below) — a tab row carries no
  // favorite field and the strip has no favorite grouping, so nothing about the
  // row has to be re-derived here.
  const menuFavorite = menu !== undefined && findFavorite(snapshot.favorites, menu.id) !== undefined
  // Pinning stores a title: the live one first, then the retained row's.
  const menuTitle = menuTab === undefined
    ? undefined
    : (live.liveIds.indexOf(menuTab.id) >= 0 ? live.titles[menuTab.id] : undefined) ?? menuTab.title
  // Clamp to the viewport: a tab at the far right must not push the menu out.
  const menuStyle: React.CSSProperties | undefined = menu === undefined ? undefined : {
    left: Math.max(8, Math.min(menu.x, window.innerWidth - MENU_WIDTH - 8)),
    top: Math.max(8, Math.min(menu.y, window.innerHeight - MENU_HEIGHT - 8)),
  }

  return (
    <>
      {/* The band spans the full width while the bar is only 90vw, so the
          pointer can open the bar from a spot the bar does not cover. Nothing
          would then fire the bar's own mouseleave and it would stay parked
          open; leaving the band schedules the ordinary retract instead. Moving
          on into the bar fires this first and its `show` clears the timer. */}
      <div
        className={css.zone}
        onMouseEnter={show}
        onMouseLeave={() => {
          if (!hoverRef.current) scheduleHide()
        }}
      />
      <div
        className={css.bar}
        data-open={open || drawerOpen ? '1' : '0'}
        data-dsh-plugin="recent-tabs"
        data-dsh-part="bar"
        title={snapshot.tabs.length > 0 ? t('tab.dragHint') : undefined}
        onMouseEnter={() => {
          hoverRef.current = true
          show()
        }}
        onMouseLeave={() => {
          hoverRef.current = false
          scheduleHide()
        }}
      >
        <div className={css.stripRow} ref={stripRef}>
          {rows.length > 0 ? rows : <span className={css.empty}>{t('bar.empty')}</span>}
        </div>
        {error !== undefined ? <span className={css.error} role="alert">{error}</span> : null}
        {/* Both last children, outside the scrolling row: the two triggers stay
            at the right end of the bar while the tabs scroll under them, the
            history one just left of the favorites one. */}
        <ClosedHistoryButton />
        <FavoriteButton />
      </div>
      {/* Outside the bar on purpose: the bar is transformed, which would make it
          the containing block (and the clipping box) of a fixed popup. */}
      {menu === undefined ? null : (
        <div
          ref={menuRef}
          className={css.menu}
          role="menu"
          data-dsh-plugin="recent-tabs"
          data-dsh-part="tab-menu"
          style={menuStyle}
        >
          <button
            className={css.menuItem}
            type="button"
            role="menuitem"
            data-dsh-part="tab-menu-favorite"
            data-favorite={menuFavorite ? '1' : '0'}
            onClick={() => {
              controller.toggleFavorite(menu.id, menuTitle)
              setMenu(undefined)
            }}
          >
            {menuFavorite ? t('menu.unfavorite') : t('menu.favorite')}
          </button>
        </div>
      )}
    </>
  )
}
