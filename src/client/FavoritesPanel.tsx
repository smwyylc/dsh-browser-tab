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
 * the button through `fav-drawer-state.ts`; the nodes come from the store's own
 * favorites tree (so a bookmark outlives the tab that opened it), titles from
 * the same `useSessionView` hook the strip uses, and navigation goes through
 * `uiWorkspace.openSession` (never a direct `sessions.open`).
 *
 * The tree is rendered flat: `buildTree` walks the folders and emits one row
 * per visible node, in order, and the row's depth only becomes extra left
 * padding. There is still exactly one scrolling container (`.favList`), so the
 * panel's 60vh budget does not change with nesting, and no row can be clipped
 * by a nested scroll box of its own.
 *
 * Sized as a compact panel rather than a full-height column: its height follows
 * the content (see the CSS `max-height`), so it stops well above the composer
 * instead of covering the conversation all the way down.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RecentTabsController } from './controller.ts'
import { findFavorite, isFolder, shortId, type FavoriteNode } from './store.ts'
import type { UiWorkspaceLike } from './sessions-face.ts'
import { useSessionView } from './use-current-session.ts'
import { placeForVertical } from './drag-place.ts'
import { isFavoritesOpen, setFavoritesOpen, subscribeFavoritesOpen } from './fav-drawer-state.ts'
import {
  folderExpansion,
  setFolderExpanded,
  subscribeFolderExpanded,
  toggleFolderExpanded,
} from './fav-folder-state.ts'
import { t } from './locales.ts'
import css from './recent-tabs.module.css'

/** Where a dragged node would land: which row, and on which side of it. */
interface DropTarget {
  id: string
  place: 'before' | 'after'
}

/** Anchored corner of the drawer, in viewport pixels. */
interface Anchor {
  right: number
  top: number
}

/** One rendered row, after the tree has been flattened for the single scroller. */
interface DrawerRow {
  node: FavoriteNode
  /** Nesting level, 0 for the root layer. */
  depth: number
}

/** The flattened rows plus the lookups the drag guards need. */
interface DrawerTree {
  rows: DrawerRow[]
  /** Parent of every visible node; the root layer maps to undefined. */
  parents: Map<string, string | undefined>
  /** Every visible folder id, so a drop knows whether the source is a folder. */
  folders: Set<string>
}

/** Extra left padding per nesting level, on top of the row's own 8px inset. */
const FOLDER_INDENT = 12

/** Fallback when the favorites trigger is not on screen (another layout, a test). */
const FALLBACK_ANCHOR: Anchor = { right: 24, top: 64 }

/** Distance kept between the button and the drawer, and from the viewport edge. */
const GAP = 6
const EDGE = 12
/** The drawer never hugs the very top, even when its anchor is off-screen. */
const MIN_TOP = 8

/**
 * Flatten the favorites tree into the rows the drawer draws.
 *
 * A folder's children are emitted right after the folder itself while it is
 * expanded, so indentation is a padding value on a flat list rather than a
 * nested DOM tree with its own scroll boxes.
 * @param nodes - the root layer.
 * @param expanded - folder ids currently open.
 * @returns rows in display order, plus the parent/folder lookups.
 */
function buildTree(nodes: readonly FavoriteNode[], expanded: ReadonlySet<string>): DrawerTree {
  const rows: DrawerRow[] = []
  const parents = new Map<string, string | undefined>()
  const folders = new Set<string>()
  const walk = (layer: readonly FavoriteNode[], depth: number, parentId: string | undefined): void => {
    for (const node of layer) {
      parents.set(node.id, parentId)
      rows.push({ node, depth })
      // A bookmark row ends here; only a folder has anything below it.
      if (!isFolder(node)) continue
      folders.add(node.id)
      if (expanded.has(node.id)) walk(node.children, depth + 1, node.id)
    }
  }
  walk(nodes, 0, undefined)
  return { rows, parents, folders }
}

/**
 * Whether one node is the given ancestor or sits inside it.
 *
 * Used to refuse a folder dropped into its own subtree: the store refuses it
 * too, but the drag should not light up a landing spot it will ignore.
 * @param tree - the flattened tree.
 * @param ancestorId - the folder being dragged.
 * @param id - the candidate destination.
 * @returns true when the destination is inside the dragged folder.
 */
function within(tree: DrawerTree, ancestorId: string, id: string): boolean {
  let cursor: string | undefined = id
  while (cursor !== undefined) {
    if (cursor === ancestorId) return true
    cursor = tree.parents.get(cursor)
  }
  return false
}

/** The favorites trigger, located by its own semantic attribute — never a shell class. */
function findFavoriteButton(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-dsh-part="favorite-button"]')
}

/** Indentation for one row: the row's own inset plus one step per level. */
function indent(depth: number): React.CSSProperties {
  return { paddingLeft: `${8 + depth * FOLDER_INDENT}px` }
}

/**
 * Render the favorites drawer.
 * @param props - controller and the plugin's client context.
 * @returns the drawer, or null while it is closed.
 */
export function FavoritesPanel({ controller, ctx }: { controller: RecentTabsController; ctx: ClientContext }): React.JSX.Element | null {
  const open = useSyncExternalStore(subscribeFavoritesOpen, isFavoritesOpen)
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const expanded = useSyncExternalStore(subscribeFolderExpanded, folderExpansion)
  const live = useSessionView(ctx)

  const tree = buildTree(snapshot.favorites, expanded)

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

  // --- Drag to reorder, and to file a bookmark into a folder ----------------
  const [draggingId, setDraggingId] = useState<string | undefined>(undefined)
  const [dropTarget, setDropTarget] = useState<DropTarget | undefined>(undefined)
  /** Folder row currently highlighted as "drop here to file it inside". */
  const [folderDropId, setFolderDropId] = useState<string | undefined>(undefined)
  const draggingRef = useRef<string | undefined>(undefined)
  const dropRef = useRef<DropTarget | undefined>(undefined)

  const endDrag = (): void => {
    draggingRef.current = undefined
    dropRef.current = undefined
    setDraggingId(undefined)
    setDropTarget(undefined)
    setFolderDropId(undefined)
  }

  const startDrag = (event: React.DragEvent<HTMLElement>, id: string): void => {
    draggingRef.current = id
    dropRef.current = undefined
    setDraggingId(id)
    setDropTarget(undefined)
    setFolderDropId(undefined)
    // Some browsers refuse a drop without payload; the ref stays authoritative.
    const transfer = event.dataTransfer as DataTransfer | undefined
    transfer?.setData('text/plain', id)
    if (transfer !== undefined) transfer.effectAllowed = 'move'
  }

  /**
   * Hovering a row: the dragged node would land before or after it.
   *
   * A bookmark only reorders inside its own layer — a cross-layer drop has no
   * meaningful landing spot, so it gets no highlight. A folder may also land in
   * another layer, except inside its own subtree.
   */
  const dragOverRow = (event: React.DragEvent<HTMLElement>, id: string): void => {
    const source = draggingRef.current
    if (source === undefined || source === id) return
    const isFolderSource = tree.folders.has(source)
    if (isFolderSource && within(tree, source, id)) return
    if (!isFolderSource && tree.parents.get(source) !== tree.parents.get(id)) return
    event.preventDefault()
    const transfer = event.dataTransfer as DataTransfer | undefined
    if (transfer !== undefined) transfer.dropEffect = 'move'
    const place = placeForVertical(event)
    const previous = dropRef.current
    if (previous !== undefined && previous.id === id && previous.place === place) return
    dropRef.current = { id, place }
    setDropTarget({ id, place })
    setFolderDropId(undefined)
  }

  /**
   * Hovering a folder: the dragged node would be filed inside it.
   *
   * A folder cannot be filed into its own subtree, so that drop never lights up.
   */
  const dragOverFolder = (event: React.DragEvent<HTMLElement>, id: string): void => {
    const source = draggingRef.current
    if (source === undefined || source === id) return
    if (tree.folders.has(source) && within(tree, source, id)) return
    event.preventDefault()
    const transfer = event.dataTransfer as DataTransfer | undefined
    if (transfer !== undefined) transfer.dropEffect = 'move'
    if (folderDropId === id) return
    dropRef.current = undefined
    setDropTarget(undefined)
    setFolderDropId(id)
  }

  /** Dropping on a row: become its sibling before/after, in its own layer. */
  const dropOnRow = (event: React.DragEvent<HTMLElement>, id: string): void => {
    event.preventDefault()
    event.stopPropagation()
    const source = draggingRef.current
    if (source !== undefined && source !== id) {
      const target = dropRef.current
      // Fall back to the pointer position when no dragover preceded the drop.
      const place = target !== undefined && target.id === id ? target.place : placeForVertical(event)
      // Reordering never navigates, and it never touches the tab list.
      if (tree.folders.has(source)) {
        // A folder can land in another layer this way; a bookmark cannot.
        controller.moveFolder(source, id, place)
      } else {
        controller.moveFavorite(source, id, place)
      }
    }
    endDrag()
  }

  /** Dropping on a folder: file it inside, and open the folder so it is visible. */
  const dropOnFolder = (event: React.DragEvent<HTMLElement>, id: string): void => {
    event.preventDefault()
    event.stopPropagation()
    const source = draggingRef.current
    if (source !== undefined && source !== id) {
      if (tree.folders.has(source)) {
        controller.moveFolderInto(source, id)
      } else {
        controller.moveFavoriteInto(source, id)
      }
      setFolderExpanded(id, true)
    }
    endDrag()
  }

  // --- Inline folder rename ------------------------------------------------
  /** Folder id being renamed, or undefined when no editor is open. */
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  /** Refs so the blur path sees live values without re-creating handlers. */
  const editingRef = useRef<string | undefined>(undefined)
  const draftRef = useRef('')

  const beginRename = (id: string, title: string): void => {
    editingRef.current = id
    draftRef.current = title
    setEditing(id)
    setDraft(title)
  }

  const cancelRename = (): void => {
    editingRef.current = undefined
    setEditing(undefined)
  }

  const commitRename = (id: string, raw: string): void => {
    const title = raw.trim()
    // An empty draft is a cancel: the folder keeps the name it had.
    if (title !== '') controller.renameFolder(id, title)
    cancelRename()
  }

  // Focus the editor as soon as it appears, and select the whole name so a
  // rename is one gesture.
  useEffect(() => {
    if (editing === undefined) return
    const input = inputRef.current
    if (input === null) return
    input.focus()
    input.select()
  }, [editing])

  const onEditorKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      const id = editingRef.current
      if (id !== undefined) commitRename(id, draftRef.current)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      // The drawer closes on Escape via a document-level listener; while the
      // editor is open the key belongs to the editor only.
      event.stopPropagation()
      cancelRename()
    }
  }

  /** The header's new-folder action: create at the root, then edit the name. */
  const createRootFolder = (): void => {
    const id = controller.createFolder()
    if (id === '') return
    beginRename(id, t('fav.folderDefault'))
  }

  if (!open) return null

  const current = live.current
  const favorite = current !== undefined && findFavorite(snapshot.favorites, current) !== undefined
  const starLabel = favorite ? t('star.unfavorite') : t('star.favorite')

  const rows = tree.rows.map(row => {
    const { node, depth } = row

    if (isFolder(node)) {
      const openFolder = expanded.has(node.id)
      return (
        <div
          key={node.id}
          className={css.favFolder}
          role="treeitem"
          aria-expanded={openFolder}
          draggable
          data-dsh-plugin="recent-tabs"
          data-dsh-part="favFolder"
          data-depth={depth}
          data-dragging={draggingId === node.id ? '1' : '0'}
          data-drop-folder={folderDropId === node.id ? '1' : '0'}
          style={indent(depth)}
          onClick={() => { toggleFolderExpanded(node.id) }}
          onDragStart={(event) => startDrag(event, node.id)}
          onDragOver={(event) => dragOverFolder(event, node.id)}
          onDrop={(event) => dropOnFolder(event, node.id)}
          onDragEnd={endDrag}
        >
          <button
            className={css.favChevron}
            type="button"
            data-dsh-part="favChevron"
            data-expanded={openFolder ? '1' : '0'}
            title={openFolder ? t('fav.folderCollapse') : t('fav.folderExpand')}
            aria-label={openFolder ? t('fav.folderCollapse') : t('fav.folderExpand')}
            onClick={(event) => {
              event.stopPropagation()
              toggleFolderExpanded(node.id)
            }}
          />
          {editing === node.id ? (
            <input
              ref={inputRef}
              className={css.editor}
              value={draft}
              aria-label={t('fav.folderRename')}
              onChange={(event) => {
                draftRef.current = event.target.value
                setDraft(event.target.value)
              }}
              onKeyDown={onEditorKeyDown}
              onBlur={() => {
                const id = editingRef.current
                if (id !== undefined) commitRename(id, draftRef.current)
              }}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            />
          ) : (
            <span
              className={css.favItemLabel}
              onDoubleClick={(event) => {
                event.stopPropagation()
                beginRename(node.id, node.title)
              }}
            >
              {node.title}
            </span>
          )}
          <button
            className={css.favRemove}
            type="button"
            data-dsh-part="favFolderRemove"
            title={t('fav.folderRemove')}
            aria-label={t('fav.folderRemove')}
            onClick={(event) => {
              event.stopPropagation()
              // The folder and everything filed in it: the tabs stay put.
              controller.removeFolder(node.id)
            }}
          >
            {'\u00d7'}
          </button>
        </div>
      )
    }

    const isLive = live.liveIds.indexOf(node.id) >= 0
    const title = isLive ? live.titles[node.id] ?? node.title : node.title
    const drop = dropTarget !== undefined && dropTarget.id === node.id ? dropTarget.place : undefined
    const here = live.current === node.id
    return (
      <div
        key={node.id}
        className={css.favItem}
        role="treeitem"
        aria-current={here ? 'true' : undefined}
        draggable
        data-dsh-plugin="recent-tabs"
        data-dsh-part="favItem"
        data-depth={depth}
        data-active={here ? '1' : '0'}
        data-stale={isLive ? '0' : '1'}
        data-dragging={draggingId === node.id ? '1' : '0'}
        data-drop={drop}
        title={isLive ? t('fav.open') : t('bar.stale')}
        style={indent(depth)}
        onClick={() => switchTo(node.id)}
        onDragStart={(event) => startDrag(event, node.id)}
        onDragOver={(event) => dragOverRow(event, node.id)}
        onDrop={(event) => dropOnRow(event, node.id)}
        onDragEnd={endDrag}
      >
        {/* "You are here", the same green dot the strip puts on the active tab:
            the same fact should not change colour between the two surfaces. */}
        {here ? <span className={css.favDot} data-dsh-part="favCurrent" /> : null}
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
            controller.toggleFavorite(node.id)
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
        <span className={css.favHeadActions}>
          <button
            className={css.favNewFolder}
            type="button"
            data-dsh-plugin="recent-tabs"
            data-dsh-part="favNewFolder"
            title={t('fav.newFolder')}
            aria-label={t('fav.newFolder')}
            onClick={createRootFolder}
          >
            {'+'}
          </button>
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
        </span>
      </div>
      {snapshot.favorites.length === 0 ? <p className={css.favEmpty}>{t('fav.empty')}</p> : null}
      <div className={css.favList} role="tree">
        {rows}
      </div>
    </div>
  )
}
