/**
 * Recent-tab ledger: the ordered list of sessions the user has opened in this
 * browser, plus the set of sessions they bookmarked, persisted to localStorage.
 *
 * Tabs and favorites are two independent collections, exactly like a browser
 * keeping open tabs apart from bookmarks: a tab is "open in the strip right
 * now", a favorite is "kept for later". Closing a tab therefore never touches
 * the favorites collection, and pinning a session never reorders the strip.
 *
 * A third collection keeps the short history of hand-closed tabs, the way a
 * browser remembers "recently closed". It is a record of an EVENT rather than a
 * membership list: only a close button adds to it, a session that leaves the
 * live list on its own does not, and opening a session takes it back out so the
 * same id never sits in the strip and in the history at once.
 *
 * Favorites are a tree rather than a flat list, the way a bookmark manager has
 * folders: `favorites` is its top layer, and a folder is a node that holds
 * bookmark rows and other folders. Every operation here is a function of that
 * tree and returns its input reference when nothing changed.
 *
 * Pure and framework-free on purpose — every mutation is a plain function over
 * the two lists so the behaviour is locked by unit tests without React or a
 * live GUI. The React surface only reads this store through subscribe().
 */

/**
 * Storage key of the persisted ledger.
 *
 * Deliberately NOT renamed with the package (2026-10-29, `dsh-recent-tabs` ->
 * `dsh-browser-tab`): this key is the user's data. Renaming it would orphan every
 * tab, favorite and closed-history row already in the browser and start from an
 * empty ledger, so the old name is kept on purpose and must stay.
 */
export const STORAGE_KEY = 'dsh-recent-tabs-v1'

/**
 * Backup key of the pre-migration payload.
 *
 * Browsers in the wild still hold the legacy shape (a bare array of rows, each
 * carrying its own `favorite` flag). The first load copies that text here
 * verbatim before rewriting the canonical key, so a failed or unwanted
 * migration can never destroy a user's bookmarks.
 */
export const BACKUP_KEY = 'dsh-recent-tabs-v1-backup'

/** Hard cap on retained tabs (oldest beyond this are dropped). */
export const MAX_TABS = 40

/** Hard cap on the closed-tab history (the newest are kept). */
export const MAX_CLOSED = 10

/** One retained session tab. */
export interface RecentTab {
  /** Session identity. */
  id: string
  /** Last known title (used when the session is no longer in the live list). */
  title: string
}

/**
 * One bookmark.
 *
 * Deliberately its own row type rather than a flag on a tab: an entry outlives
 * the tab it points at, and a closed tab is not a closed bookmark.
 */
export interface FavoriteEntry {
  /** Session identity. */
  id: string
  /** Title captured when the user pinned it. */
  title: string
}

/**
 * A folder on the favorites tree, the way a browser's bookmark manager has
 * them: it holds bookmark rows and other folders, and it has no session of its
 * own. A folder is a container, never a second copy of a bookmark.
 */
export interface FavoriteFolder {
  /** Folder identity, generated here (`fav-folder-*`); never a session id. */
  id: string
  /** Name shown on the folder row. */
  title: string
  /** Nested nodes, in display order. */
  children: FavoriteNode[]
}

/** One node of the favorites tree: a bookmark row or a folder. */
export type FavoriteNode = FavoriteEntry | FavoriteFolder

/**
 * One tab the user dismissed from the strip.
 *
 * The title is captured at close time on purpose: the row is gone, so the only
 * remaining name is this one until the session is opened again and the live
 * list answers with a fresher one.
 */
export interface ClosedTab {
  /** Session identity. */
  readonly id: string
  /** Title the tab was showing when it was closed. */
  readonly title: string
  /** When it was closed (`Date.now()`); the list itself is newest-first. */
  readonly closedAt: number
}

/**
 * Whether a node is a folder.
 *
 * `children` is the one field a folder has that a bookmark row never does, and
 * every node this module produces comes from `readFavoriteRow`, so the check is
 * exact for stored and freshly built data alike.
 * @param node - one tree node.
 * @returns true when the node is a folder.
 */
export function isFolder(node: FavoriteNode): node is FavoriteFolder {
  return 'children' in node
}

/** All persisted collections, as one record. */
export interface Ledger {
  readonly tabs: readonly RecentTab[]
  /**
   * The root layer of the favorites tree: bookmark rows and folders side by
   * side. The field name predates folders and stays — every consumer reads the
   * tree from here.
   */
  readonly favorites: readonly FavoriteNode[]
  /**
   * Hand-closed tabs, newest first. Independent of both other collections:
   * closing a tab never removed its bookmark, and neither one is consulted to
   * build this list.
   */
  readonly closed: readonly ClosedTab[]
}

/** Result of reading the persisted text. */
export interface ParsedLedger {
  /** The three lists, normalized. */
  ledger: Ledger
  /** True when the stored payload used the legacy tab-array shape. */
  migrated: boolean
}

/** Minimal storage face, so tests can inject a fake. */
export interface TabStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Short id fallback for sessions without a durable title. */
export function shortId(id: string): string {
  return id.slice(0, 8)
}

/** A fresh empty ledger (never a shared constant: callers own their arrays). */
function emptyLedger(): Ledger {
  return { tabs: [], favorites: [], closed: [] }
}

/**
 * Validate one stored row.
 *
 * The id must be a non-empty string and must not have been seen yet; a missing
 * title is filled from the short id, because a real session with an unresolved
 * title still belongs in the list.
 * @param row - one raw row.
 * @param seen - ids already accepted in this bucket, mutated in place.
 * @returns the normalized row, or undefined when it must be dropped.
 */
function readRow(row: unknown, seen: Set<string>): RecentTab | undefined {
  if (typeof row !== 'object' || row === null) return undefined
  const id = (row as { id?: unknown }).id
  if (typeof id !== 'string' || id === '' || seen.has(id)) return undefined
  seen.add(id)
  const title = (row as { title?: unknown }).title
  return { id, title: typeof title === 'string' && title !== '' ? title : shortId(id) }
}

/**
 * Validate one stored favorites row, recursing into folders.
 *
 * A folder is recognised by a `children` array and validated depth-first; a row
 * without one is a bookmark. The `seen` set spans the whole tree, so the same id
 * cannot appear twice even across different folders. A malformed node is
 * dropped on its own — a bad child never takes its folder down with it.
 * @param row - one raw node.
 * @param seen - ids already accepted anywhere in the tree, mutated in place.
 * @returns the normalized node, or undefined when it must be dropped.
 */
function readFavoriteRow(row: unknown, seen: Set<string>): FavoriteNode | undefined {
  if (typeof row !== 'object' || row === null) return undefined
  const id = (row as { id?: unknown }).id
  if (typeof id !== 'string' || id === '' || seen.has(id)) return undefined
  seen.add(id)
  const title = (row as { title?: unknown }).title
  const label = typeof title === 'string' && title !== '' ? title : shortId(id)
  const children = (row as { children?: unknown }).children
  if (!Array.isArray(children)) return { id, title: label }
  const kept: FavoriteNode[] = []
  for (const child of children) {
    const node = readFavoriteRow(child, seen)
    if (node !== undefined) kept.push(node)
  }
  return { id, title: label, children: kept }
}

/**
 * Normalize the whole favorites layer (root, then every folder below it).
 * @param rows - raw favorite nodes.
 * @returns the validated tree.
 */
function readFavorites(rows: readonly unknown[]): FavoriteNode[] {
  const seen = new Set<string>()
  const kept: FavoriteNode[] = []
  for (const row of rows) {
    const node = readFavoriteRow(row, seen)
    if (node !== undefined) kept.push(node)
  }
  return kept
}

/**
 * Validate one stored closed row.
 *
 * A missing title falls back to the short id and a missing or non-numeric
 * timestamp to 0, exactly like the other buckets: an unreadable field must not
 * take the whole row down.
 * @param row - one raw row.
 * @param seen - ids already accepted, mutated in place.
 * @returns the normalized row, or undefined when it must be dropped.
 */
function readClosedRow(row: unknown, seen: Set<string>): ClosedTab | undefined {
  if (typeof row !== 'object' || row === null) return undefined
  const id = (row as { id?: unknown }).id
  if (typeof id !== 'string' || id === '' || seen.has(id)) return undefined
  seen.add(id)
  const title = (row as { title?: unknown }).title
  const closedAt = (row as { closedAt?: unknown }).closedAt
  return {
    id,
    title: typeof title === 'string' && title !== '' ? title : shortId(id),
    closedAt: typeof closedAt === 'number' && Number.isFinite(closedAt) ? closedAt : 0,
  }
}

/**
 * Normalize the closed-tab history, keeping the stored order and the cap.
 * @param rows - raw history rows, newest first as stored.
 * @returns the validated history.
 */
function readClosed(rows: readonly unknown[]): ClosedTab[] {
  const seen = new Set<string>()
  const kept: ClosedTab[] = []
  for (const row of rows) {
    if (kept.length >= MAX_CLOSED) break
    const entry = readClosedRow(row, seen)
    if (entry !== undefined) kept.push(entry)
  }
  return kept
}

/**
 * Normalize the current shape's three arrays independently.
 *
 * They are deduped one by one, not against each other: the same session is
 * usually both an open tab and a bookmark, and that is not a duplicate.
 * @param tabs - raw tab rows.
 * @param favorites - raw favorite nodes (the root layer of the tree).
 * @param closed - raw closed-history rows, newest first.
 * @returns the normalized ledger.
 */
function readCurrent(
  tabs: readonly unknown[],
  favorites: readonly unknown[],
  closed: readonly unknown[],
): Ledger {
  const tabSeen = new Set<string>()
  const keptTabs: RecentTab[] = []
  for (const row of tabs) {
    if (keptTabs.length >= MAX_TABS) break
    const entry = readRow(row, tabSeen)
    if (entry !== undefined) keptTabs.push(entry)
  }
  return { tabs: keptTabs, favorites: readFavorites(favorites), closed: readClosed(closed) }
}

/**
 * Split the legacy tab array into the collections.
 *
 * One row in that shape was both things at once when it carried the flag, so a
 * flagged row becomes a bookmark AND stays a tab: bookmarking a tab never
 * closed it, and dropping the tab here is what made favorites disappear from
 * the strip on upgrade. The buckets are deduped and ordered one by one, exactly
 * like the current shape, so one id may appear in each; only the tab bucket is
 * capped. The legacy payload has no history, so that bucket starts empty — and
 * since nothing is written back for it, an old record is not rewritten.
 * @param rows - the legacy array.
 * @returns the migrated ledger.
 */
function readLegacy(rows: readonly unknown[]): Ledger {
  const tabSeen = new Set<string>()
  const favoriteSeen = new Set<string>()
  const tabs: RecentTab[] = []
  const favorites: FavoriteEntry[] = []
  for (const row of rows) {
    // Only a literal `true` was ever a favorite; a missing or non-boolean flag
    // meant an ordinary tab. The guard keeps a null row from being read here:
    // `readRow` owns shape validation, and this check runs before it.
    const flagged = typeof row === 'object' && row !== null
      && (row as { favorite?: unknown }).favorite === true
    if (flagged) {
      const entry = readRow(row, favoriteSeen)
      if (entry !== undefined) favorites.push(entry)
    }
    if (tabs.length >= MAX_TABS) continue
    const tab = readRow(row, tabSeen)
    if (tab !== undefined) tabs.push(tab)
  }
  return { tabs, favorites, closed: [] }
}

/**
 * Parse persisted text into a ledger, dropping malformed rows and reporting
 * whether the payload needs the one-time migration rewrite.
 * @param raw - the stored JSON text, or null when nothing was stored.
 * @returns the ledger plus the migration flag, never throwing on corrupt input.
 */
export function parseLedger(raw: string | null): ParsedLedger {
  if (raw === null || raw === '') return { ledger: emptyLedger(), migrated: false }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ledger: emptyLedger(), migrated: false }
  }
  // Legacy shape: the whole payload was the tab list, favorites included.
  if (Array.isArray(parsed)) return { ledger: readLegacy(parsed), migrated: true }
  if (typeof parsed === 'object' && parsed !== null) {
    const tabs = (parsed as { tabs?: unknown }).tabs
    const favorites = (parsed as { favorites?: unknown }).favorites
    const closed = (parsed as { closed?: unknown }).closed
    return {
      ledger: readCurrent(
        Array.isArray(tabs) ? tabs : [],
        Array.isArray(favorites) ? favorites : [],
        Array.isArray(closed) ? closed : [],
      ),
      migrated: false,
    }
  }
  return { ledger: emptyLedger(), migrated: false }
}

/**
 * Record one session as opened, preserving first-seen order.
 *
 * Idempotent when the tab is already present with the same title, which is
 * what keeps a rapid click train from re-entering the render loop.
 * @param tabs - current list.
 * @param id - session to record.
 * @param title - its resolved display title.
 * @returns the next list, the SAME reference when nothing changed.
 */
export function recordTab(tabs: readonly RecentTab[], id: string, title: string): RecentTab[] {
  const index = tabs.findIndex(tab => tab.id === id)
  const nextTitle = title === '' ? shortId(id) : title
  if (index < 0) {
    const next = tabs.concat([{ id, title: nextTitle }])
    return next.length > MAX_TABS ? next.slice(next.length - MAX_TABS) : next
  }
  if (tabs[index].title === nextTitle) return tabs as RecentTab[]
  const next = tabs.slice()
  next[index] = { id, title: nextTitle }
  return next
}

/**
 * Remove one tab.
 *
 * Bookmarks are a different collection and are not a parameter here on
 * purpose: closing a tab cannot delete its favorite.
 * @param tabs - current list.
 * @param id - session to drop.
 * @returns the next list, the SAME reference when the id was absent.
 */
export function removeTab(tabs: readonly RecentTab[], id: string): RecentTab[] {
  const next = tabs.filter(tab => tab.id !== id)
  return next.length === tabs.length ? tabs as RecentTab[] : next
}

/**
 * Move one tab that was just closed to the front of the history.
 *
 * Re-closing a session that is already in the history rewrites its one row in
 * place at the front — a history is a set of sessions, not a log, so the same
 * session never appears twice. Only the close button reaches this function;
 * a session that leaves the live list on its own is not a hand close.
 *
 * Idempotent for the case the caller can hit twice: the row is already the head
 * with the same title, so nothing — not even the timestamp — has to change. The
 * returned array is then the very same reference, which keeps the controller
 * from notifying subscribers for an observation that changed nothing.
 * @param closed - current history, newest first.
 * @param id - session that was closed.
 * @param title - the display name the tab had when it was closed.
 * @returns the next history, the SAME reference when nothing changed.
 */
export function recordClosed(closed: readonly ClosedTab[], id: string, title: string): ClosedTab[] {
  if (id === '') return closed as ClosedTab[]
  const nextTitle = title === '' ? shortId(id) : title
  const head = closed[0]
  if (head !== undefined && head.id === id && head.title === nextTitle) return closed as ClosedTab[]
  const rest = closed.filter(row => row.id !== id)
  const next = [{ id, title: nextTitle, closedAt: Date.now() }, ...rest]
  return next.length > MAX_CLOSED ? next.slice(0, MAX_CLOSED) : next
}

/**
 * Drop one session from the closed-tab history.
 *
 * Called when a session is opened again: the strip and the history describe the
 * same set of tabs, so a session cannot be in both at once.
 * @param closed - current history, newest first.
 * @param id - session to forget.
 * @returns the next history, the SAME reference when the id was absent.
 */
export function dropClosed(closed: readonly ClosedTab[], id: string): ClosedTab[] {
  const next = closed.filter(row => row.id !== id)
  return next.length === closed.length ? closed as ClosedTab[] : next
}

/**
 * Move one tab before/after another.
 * @param tabs - current list.
 * @param id - the tab being dragged.
 * @param targetId - the tab the drop landed on.
 * @param place - whether the dragged tab lands before or after the target.
 * @returns the next list; the SAME reference when the move is a no-op (either
 * id absent, or the tab already sits there).
 */
export function moveTab(
  tabs: readonly RecentTab[],
  id: string,
  targetId: string,
  place: 'before' | 'after',
): RecentTab[] {
  if (id === targetId) return tabs as RecentTab[]
  const from = tabs.findIndex(tab => tab.id === id)
  const to = tabs.findIndex(tab => tab.id === targetId)
  if (from < 0 || to < 0) return tabs as RecentTab[]
  const next = tabs.slice()
  const [moved] = next.splice(from, 1)
  const targetIndex = next.findIndex(tab => tab.id === targetId)
  next.splice(place === 'before' ? targetIndex : targetIndex + 1, 0, moved)
  if (next.every((tab, index) => tab.id === tabs[index].id)) return tabs as RecentTab[]
  return next
}

/**
 * Find a bookmark by session id anywhere in the tree.
 *
 * The drawer and the strip both need "is this session pinned?" without caring
 * which folder holds it, so this walks folders as well as the root layer.
 * @param nodes - the favorites layer to search.
 * @param id - the session id.
 * @returns the bookmark row, or undefined when the session is not pinned.
 */
export function findFavorite(
  nodes: readonly FavoriteNode[],
  id: string,
): FavoriteEntry | undefined {
  for (const node of nodes) {
    if (isFolder(node)) {
      const nested = findFavorite(node.children, id)
      if (nested !== undefined) return nested
      continue
    }
    if (node.id === id) return node
  }
  return undefined
}

/**
 * Find a folder by id anywhere in the tree.
 * @param nodes - the favorites layer to search.
 * @param id - the folder id.
 * @returns the folder, or undefined when no folder carries that id.
 */
function findFolder(nodes: readonly FavoriteNode[], id: string): FavoriteFolder | undefined {
  for (const node of nodes) {
    if (!isFolder(node)) continue
    if (node.id === id) return node
    const nested = findFolder(node.children, id)
    if (nested !== undefined) return nested
  }
  return undefined
}

/**
 * The layer (sibling list) that holds one node.
 *
 * Returned by reference: the root layer comes back as the very array that was
 * passed in, which is how callers tell a root move from a nested one.
 * @param nodes - the favorites layer to search.
 * @param id - the node id.
 * @returns the containing layer, or undefined when the id is not in the tree.
 */
function layerOf(nodes: readonly FavoriteNode[], id: string): readonly FavoriteNode[] | undefined {
  if (nodes.some(node => node.id === id)) return nodes
  for (const node of nodes) {
    if (!isFolder(node)) continue
    const found = layerOf(node.children, id)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Replace one children array with a new one, rebuilding only the path to it.
 * @param nodes - the layer being rebuilt.
 * @param layer - the children array to swap.
 * @param next - its replacement.
 * @returns the rebuilt layer, the SAME reference when the array is not here.
 */
function replaceChildren(
  nodes: readonly FavoriteNode[],
  layer: readonly FavoriteNode[],
  next: FavoriteNode[],
): FavoriteNode[] {
  const kept: FavoriteNode[] = []
  let changed = false
  for (const node of nodes) {
    if (!isFolder(node)) {
      kept.push(node)
      continue
    }
    if (node.children === layer) {
      changed = true
      kept.push({ ...node, children: next })
      continue
    }
    const nested = replaceChildren(node.children, layer, next)
    if (nested === node.children) {
      kept.push(node)
      continue
    }
    changed = true
    kept.push({ ...node, children: nested })
  }
  return changed ? kept : nodes as FavoriteNode[]
}

/**
 * Rebuild one folder, keeping every other node by reference.
 *
 * The patch returns the same folder to mean "nothing to change", which is what
 * lets the callers hand back their input reference for a no-op.
 * @param nodes - the layer being searched.
 * @param id - the folder to patch.
 * @param patch - produces the replacement folder, or undefined for no change.
 * @returns the rebuilt layer plus whether anything changed.
 */
function updateFolder(
  nodes: readonly FavoriteNode[],
  id: string,
  patch: (folder: FavoriteFolder) => FavoriteFolder | undefined,
): { next: FavoriteNode[]; changed: boolean } {
  let changed = false
  const kept: FavoriteNode[] = []
  for (const node of nodes) {
    if (!isFolder(node)) {
      kept.push(node)
      continue
    }
    if (node.id === id) {
      const patched = patch(node)
      if (patched === undefined) {
        kept.push(node)
        continue
      }
      changed = true
      kept.push(patched)
      continue
    }
    const nested = updateFolder(node.children, id, patch)
    if (!nested.changed) {
      kept.push(node)
      continue
    }
    changed = true
    kept.push({ ...node, children: nested.next })
  }
  return changed
    ? { next: kept, changed: true }
    : { next: nodes as FavoriteNode[], changed: false }
}

/**
 * Remove a bookmark row from wherever it sits.
 * @param nodes - the layer being searched.
 * @param id - the session id to drop.
 * @returns the rebuilt tree, plus the removed row when it was found.
 */
function removeFavoriteRow(
  nodes: readonly FavoriteNode[],
  id: string,
): { next: FavoriteNode[]; removed: FavoriteEntry | undefined } {
  let removed: FavoriteEntry | undefined
  const kept: FavoriteNode[] = []
  for (const node of nodes) {
    if (!isFolder(node)) {
      if (node.id === id && removed === undefined) {
        removed = node
        continue
      }
      kept.push(node)
      continue
    }
    const nested = removeFavoriteRow(node.children, id)
    if (nested.removed === undefined) {
      kept.push(node)
      continue
    }
    removed = nested.removed
    kept.push({ ...node, children: nested.next })
  }
  return removed === undefined
    ? { next: nodes as FavoriteNode[], removed }
    : { next: kept, removed }
}

/**
 * Remove a folder and everything inside it.
 * @param nodes - the layer being searched.
 * @param id - the folder id.
 * @returns the rebuilt tree, plus the removed folder when it was found.
 */
function removeFolderRow(
  nodes: readonly FavoriteNode[],
  id: string,
): { next: FavoriteNode[]; removed: FavoriteFolder | undefined } {
  let removed: FavoriteFolder | undefined
  const kept: FavoriteNode[] = []
  for (const node of nodes) {
    if (!isFolder(node)) {
      kept.push(node)
      continue
    }
    if (node.id === id && removed === undefined) {
      removed = node
      continue
    }
    const nested = removeFolderRow(node.children, id)
    if (nested.removed === undefined) {
      kept.push(node)
      continue
    }
    removed = nested.removed
    kept.push({ ...node, children: nested.next })
  }
  return removed === undefined
    ? { next: nodes as FavoriteNode[], removed }
    : { next: kept, removed }
}

/** Monotonic suffix for folder ids; the tree is checked before it is used. */
let folderSeq = 0

/**
 * A folder id nothing in the tree uses yet.
 *
 * The counter restarts on every page load, so the id is only provisional until
 * the tree says otherwise — a saved `fav-folder-1` pushes the next new folder
 * past it instead of colliding.
 * @param nodes - the whole favorites tree.
 * @returns an unused id.
 */
function nextFolderId(nodes: readonly FavoriteNode[]): string {
  const taken = new Set<string>()
  const collect = (layer: readonly FavoriteNode[]): void => {
    for (const node of layer) {
      taken.add(node.id)
      if (isFolder(node)) collect(node.children)
    }
  }
  collect(nodes)
  let id = ''
  do {
    folderSeq += 1
    id = `fav-folder-${folderSeq}`
  } while (taken.has(id))
  return id
}

/**
 * Add or remove one bookmark.
 *
 * Appends to the root layer when the session is not bookmarked yet (a bookmark
 * list keeps the order it was built in). When it IS bookmarked — at the root or
 * inside a folder — that one row is removed, wherever it sits: "unpin" means
 * "this bookmark is gone", and leaving a nested copy behind while adding a
 * second root copy would list the same session twice. Tabs are a separate
 * collection and are never touched here.
 * @param favorites - current favorites tree.
 * @param id - session to pin or unpin.
 * @param title - title to store when pinning; defaults to the short id.
 * @returns the next tree, the SAME reference when the id is empty.
 */
export function toggleFavorite(
  favorites: readonly FavoriteNode[],
  id: string,
  title?: string,
): FavoriteNode[] {
  if (id === '') return favorites as FavoriteNode[]
  const pinned = findFavorite(favorites, id)
  if (pinned !== undefined) return removeFavoriteRow(favorites, id).next
  const nextTitle = title === undefined || title === '' ? shortId(id) : title
  return favorites.concat([{ id, title: nextTitle }])
}

/**
 * Move one bookmark or folder before/after a sibling.
 *
 * Dragging inside the drawer only ever reorders the layer the source lives in:
 * the target has to be a sibling, and a cross-layer drop is a no-op (the way to
 * change layers is a drop on a folder). The strip keeps its own order and the
 * activation order is not involved.
 * @param favorites - current favorites tree.
 * @param id - the node being dragged.
 * @param targetId - the sibling the drop landed on.
 * @param place - whether the dragged node lands before or after the target.
 * @returns the next tree; the SAME reference when the move is a no-op.
 */
export function moveFavorite(
  favorites: readonly FavoriteNode[],
  id: string,
  targetId: string,
  place: 'before' | 'after',
): FavoriteNode[] {
  if (id === targetId) return favorites as FavoriteNode[]
  const layer = layerOf(favorites, id)
  if (layer === undefined) return favorites as FavoriteNode[]
  const from = layer.findIndex(node => node.id === id)
  const targetIndex = layer.findIndex(node => node.id === targetId)
  if (from < 0 || targetIndex < 0) return favorites as FavoriteNode[]
  const next = layer.slice()
  const [moved] = next.splice(from, 1)
  const landing = next.findIndex(node => node.id === targetId)
  next.splice(place === 'before' ? landing : landing + 1, 0, moved)
  if (next.every((node, index) => node.id === layer[index].id)) {
    return favorites as FavoriteNode[]
  }
  return layer === favorites ? next : replaceChildren(favorites, layer, next)
}

/**
 * Result of creating a folder: the new tree and the folder itself.
 *
 * The folder is undefined only when the requested parent does not exist, in
 * which case the tree comes back untouched.
 */
export interface CreatedFolder {
  /** The next favorites tree (the input reference when nothing was created). */
  readonly next: readonly FavoriteNode[]
  /** The new folder, or undefined when its parent was missing. */
  readonly folder: FavoriteFolder | undefined
}

/**
 * Create an empty folder at the root or inside another folder.
 * @param favorites - current favorites tree.
 * @param parentId - the containing folder, or undefined for the root layer.
 * @param title - the name to give it; a blank one falls back to the short id.
 * @returns the new tree and the folder.
 */
export function createFolder(
  favorites: readonly FavoriteNode[],
  parentId: string | undefined,
  title: string,
): CreatedFolder {
  if (parentId !== undefined && findFolder(favorites, parentId) === undefined) {
    return { next: favorites, folder: undefined }
  }
  const id = nextFolderId(favorites)
  const folder: FavoriteFolder = {
    id,
    title: title.trim() === '' ? shortId(id) : title.trim(),
    children: [],
  }
  if (parentId === undefined) return { next: favorites.concat([folder]), folder }
  const appended = updateFolder(favorites, parentId, parent => ({
    ...parent,
    children: parent.children.concat([folder]),
  }))
  return { next: appended.next, folder }
}

/**
 * Rename one folder.
 * @param favorites - current favorites tree.
 * @param folderId - the folder to rename.
 * @param title - the new name; blank means "leave it alone".
 * @returns the next tree, the SAME reference when nothing changed.
 */
export function renameFolder(
  favorites: readonly FavoriteNode[],
  folderId: string,
  title: string,
): FavoriteNode[] {
  const label = title.trim()
  if (label === '') return favorites as FavoriteNode[]
  return updateFolder(favorites, folderId, folder => (
    folder.title === label ? undefined : { ...folder, title: label }
  )).next
}

/**
 * Delete one folder and everything inside it.
 *
 * Only a folder can be removed here: an id that names a bookmark row is left
 * alone, because unpinning is `toggleFavorite`'s job. Tabs are a separate
 * collection and are never touched.
 * @param favorites - current favorites tree.
 * @param folderId - the folder to drop.
 * @returns the next tree, the SAME reference when no such folder exists.
 */
export function removeFolder(
  favorites: readonly FavoriteNode[],
  folderId: string,
): FavoriteNode[] {
  return removeFolderRow(favorites, folderId).next
}

/**
 * Move one bookmark into a folder, appended last.
 * @param favorites - current favorites tree.
 * @param id - the session id being moved.
 * @param folderId - the destination folder.
 * @returns the next tree; the SAME reference when the folder is missing, the
 * id is not a bookmark, or the row already sits last in that folder.
 */
export function moveFavoriteInto(
  favorites: readonly FavoriteNode[],
  id: string,
  folderId: string,
): FavoriteNode[] {
  const target = findFolder(favorites, folderId)
  if (target === undefined) return favorites as FavoriteNode[]
  const entry = findFavorite(favorites, id)
  if (entry === undefined) return favorites as FavoriteNode[]
  const last = target.children[target.children.length - 1]
  if (last !== undefined && last.id === id) return favorites as FavoriteNode[]
  const detached = removeFavoriteRow(favorites, id)
  const appended = updateFolder(detached.next, folderId, folder => ({
    ...folder,
    children: folder.children.concat([entry]),
  }))
  return appended.next
}

/**
 * Move one folder into another folder, or back to the root layer.
 *
 * Cycle-safe: a folder cannot be moved into itself or into one of its own
 * descendants, so the tree can never acquire a loop.
 * @param favorites - current favorites tree.
 * @param folderId - the folder being moved.
 * @param parentFolderId - the destination folder, or undefined for the root.
 * @returns the next tree; the SAME reference when the move is a no-op
 * (missing folder, a cycle, or the folder already last in that layer).
 */
export function moveFolderInto(
  favorites: readonly FavoriteNode[],
  folderId: string,
  parentFolderId: string | undefined,
): FavoriteNode[] {
  const source = findFolder(favorites, folderId)
  if (source === undefined) return favorites as FavoriteNode[]
  if (parentFolderId === undefined) {
    const last = favorites[favorites.length - 1]
    if (last !== undefined && last.id === folderId) return favorites as FavoriteNode[]
  } else {
    if (parentFolderId === folderId) return favorites as FavoriteNode[]
    const target = findFolder(favorites, parentFolderId)
    if (target === undefined) return favorites as FavoriteNode[]
    // A descendant of the source would close a loop.
    if (findFolder(source.children, parentFolderId) !== undefined) {
      return favorites as FavoriteNode[]
    }
    const last = target.children[target.children.length - 1]
    if (last !== undefined && last.id === folderId) return favorites as FavoriteNode[]
  }
  const detached = removeFolderRow(favorites, folderId)
  const { removed } = detached
  if (removed === undefined) return favorites as FavoriteNode[]
  if (parentFolderId === undefined) return detached.next.concat([removed])
  return updateFolder(detached.next, parentFolderId, folder => ({
    ...folder,
    children: folder.children.concat([removed]),
  })).next
}

/**
 * Move one folder next to an existing node, in that node's layer.
 *
 * A folder dropped on a row lands as a sibling of that row: inside the same
 * layer that is an ordinary reorder, in another layer it makes the folder join
 * that layer at that spot. A folder can never land inside its own subtree.
 * @param favorites - current favorites tree.
 * @param folderId - the folder being dragged.
 * @param targetId - the node the drop landed on.
 * @param place - whether the folder lands before or after the target.
 * @returns the next tree; the SAME reference when the move is a no-op.
 */
export function moveFolder(
  favorites: readonly FavoriteNode[],
  folderId: string,
  targetId: string,
  place: 'before' | 'after',
): FavoriteNode[] {
  if (folderId === targetId) return favorites as FavoriteNode[]
  const source = findFolder(favorites, folderId)
  if (source === undefined) return favorites as FavoriteNode[]
  const sourceLayer = layerOf(favorites, folderId)
  const targetLayer = layerOf(favorites, targetId)
  if (sourceLayer === undefined || targetLayer === undefined) return favorites as FavoriteNode[]
  // The target sits inside the folder being moved: that would close a loop.
  if (layerOf(source.children, targetId) !== undefined) return favorites as FavoriteNode[]
  // Same layer is a plain sibling reorder, which is idempotent in place.
  if (sourceLayer === targetLayer) return moveFavorite(favorites, folderId, targetId, place)
  const detached = removeFolderRow(favorites, folderId)
  const moved = detached.removed
  if (moved === undefined) return favorites as FavoriteNode[]
  const landing = layerOf(detached.next, targetId)
  if (landing === undefined) return favorites as FavoriteNode[]
  const index = landing.findIndex(node => node.id === targetId)
  const next = landing.slice()
  next.splice(place === 'before' ? index : index + 1, 0, moved)
  return landing === detached.next ? next : replaceChildren(detached.next, landing, next)
}

/**
 * Move one id to the front of an activation (MRU) order.
 *
 * The front is "most recently activated". Closing the active tab then hands
 * the selection to the next entry — the tab the user was last on.
 * @param order - current order, most-recent-first.
 * @param id - id that just became active.
 * @returns the next order; an unchanged head returns the SAME reference.
 */
export function touchOrder(order: readonly string[], id: string): string[] {
  if (order[0] === id) return order as string[]
  const rest = order.filter(entry => entry !== id)
  return [id, ...rest]
}

/**
 * Drop one id from an activation order.
 * @param order - current order.
 * @param id - id to forget.
 * @returns the next order, the SAME reference when the id was absent.
 */
export function dropOrder(order: readonly string[], id: string): string[] {
  const next = order.filter(entry => entry !== id)
  return next.length === order.length ? order as string[] : next
}

/**
 * Pick the tab to activate after closing `closed`.
 *
 * Candidates come from the activation order first, then the retained list as a
 * fallback for tabs never activated in this page (a restored session).
 * @param order - most-recent-first activation order.
 * @param tabs - retained tabs AFTER the removal.
 * @param closed - the id being closed.
 * @returns the id to activate, or undefined when nothing remains.
 */
export function nextActiveAfterClose(
  order: readonly string[],
  tabs: readonly RecentTab[],
  closed: string,
): string | undefined {
  for (const id of order) {
    if (id !== closed && tabs.some(tab => tab.id === id)) return id
  }
  for (const tab of tabs) {
    if (tab.id !== closed) return tab.id
  }
  return undefined
}

/**
 * Read the persisted ledger, migrating a legacy payload in place.
 *
 * The migration is idempotent: it only runs for the legacy array shape, so a
 * second load of the rewritten record neither writes nor changes the backup.
 * @param storage - browser storage (or a fake in tests).
 * @returns the ledger; empty when storage is unavailable or corrupt.
 */
export function loadLedger(storage: TabStorage | undefined): Ledger {
  if (storage === undefined) return emptyLedger()
  let raw: string | null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return emptyLedger()
  }
  const { ledger, migrated } = parseLedger(raw)
  if (!migrated) return ledger
  // Copy the legacy text before the rewrite. Both steps are best-effort: a
  // refused backup must not abort the migration, or new favorites would keep
  // landing in a shape this version cannot read back.
  try {
    const alreadyBackedUp = storage.getItem(BACKUP_KEY) !== null
    if (raw !== null && !alreadyBackedUp) storage.setItem(BACKUP_KEY, raw)
  } catch {
    // Storage refused the copy: migrate anyway.
  }
  saveLedger(storage, ledger)
  return ledger
}

/**
 * Persist all three collections, ignoring storage failures (private mode, quota).
 * @param storage - browser storage (or a fake in tests).
 * @param ledger - the record to persist.
 */
export function saveLedger(storage: TabStorage | undefined, ledger: Ledger): void {
  if (storage === undefined) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      tabs: ledger.tabs,
      favorites: ledger.favorites,
      closed: ledger.closed,
    }))
  } catch {
    // Persistence is best-effort: the live lists stay authoritative.
  }
}
