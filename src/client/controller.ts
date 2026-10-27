/**
 * Tab-strip state owner: holds the persisted ledger, exposes a snapshot for
 * useSyncExternalStore, and mutates through the pure store functions.
 *
 * Tabs and favorites are separate collections in the store; this class keeps
 * them separate too. The strip consumes `tabs`, the drawer consumes
 * `favorites`, and closing a tab only ever rewrites the tab list.
 *
 * Kept out of the React component so the rapid-switching path never re-enters
 * a render pass: a mutation that changes nothing returns the same snapshot
 * reference, and subscribers are notified only for real changes.
 */
import {
  createFolder as createFolderInTree,
  dropOrder,
  loadLedger,
  moveFavorite as moveFavoriteEntry,
  moveFavoriteInto as moveFavoriteIntoFolder,
  moveFolder as moveFolderBeside,
  moveFolderInto as moveFolderIntoFolder,
  moveTab,
  nextActiveAfterClose,
  recordTab,
  removeFolder as removeFolderEntry,
  removeTab,
  renameFolder as renameFolderEntry,
  saveLedger,
  toggleFavorite as toggleFavoriteEntry,
  touchOrder,
  type FavoriteNode,
  type RecentTab,
  type TabStorage,
} from './store.ts'
import { t } from './locales.ts'

/** Immutable snapshot consumed by the React surface. */
export interface TabsSnapshot {
  readonly tabs: readonly RecentTab[]
  /**
   * The favorites tree, independent of the tab list: closing a tab never drops
   * a bookmark, at the root or inside a folder.
   */
  readonly favorites: readonly FavoriteNode[]
  /** Activation order, most-recent-first (in-memory; not persisted). */
  readonly order: readonly string[]
}

const EMPTY: TabsSnapshot = { tabs: [], favorites: [], order: [] }

export class RecentTabsController {
  private snapshot: TabsSnapshot = EMPTY
  private readonly listeners = new Set<() => void>()

  constructor(private readonly storage: TabStorage | undefined) {
    const { tabs, favorites } = loadLedger(storage)
    // Restored tabs have no known activation history: seed the order with the
    // stored sequence so a close still has a deterministic fallback.
    this.snapshot = tabs.length === 0 && favorites.length === 0
      ? EMPTY
      : { tabs, favorites, order: tabs.map(tab => tab.id) }
  }

  /** Current snapshot (stable reference until a real change). */
  getSnapshot = (): TabsSnapshot => this.snapshot

  /** Subscribe to snapshot changes; returns the unsubscriber. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Record one session as opened and mark it active.
   * @param id - session identity.
   * @param title - resolved display title.
   */
  record(id: string, title: string): void {
    const tabs = recordTab(this.snapshot.tabs, id, title)
    const order = touchOrder(this.snapshot.order, id)
    if (tabs === this.snapshot.tabs && order === this.snapshot.order) return
    if (tabs !== this.snapshot.tabs) this.persist(tabs, this.snapshot.favorites)
    this.publish(tabs, this.snapshot.favorites, order)
  }

  /**
   * Remove one tab and return the id the caller should activate next.
   *
   * The MRU order decides: the tab the user was last on among the survivors.
   * Bookmarks are untouched — closing a tab is not closing a favorite.
   * @param id - session identity to close.
   * @returns the id to open, or undefined when no tab remains.
   */
  remove(id: string): string | undefined {
    const tabs = removeTab(this.snapshot.tabs, id)
    if (tabs === this.snapshot.tabs) return undefined
    const order = dropOrder(this.snapshot.order, id)
    this.persist(tabs, this.snapshot.favorites)
    this.publish(tabs, this.snapshot.favorites, order)
    return nextActiveAfterClose(order, tabs, id)
  }

  /**
   * Reorder the strip.
   *
   * Display order is the persisted list's business: the activation order is
   * passed through untouched, so closing a tab afterwards still falls back to
   * the tab the user was actually last on.
   * @param id - the tab being dragged.
   * @param targetId - the tab the drop landed on.
   * @param place - whether it lands before or after the target.
   */
  move(id: string, targetId: string, place: 'before' | 'after'): void {
    const tabs = moveTab(this.snapshot.tabs, id, targetId, place)
    if (tabs === this.snapshot.tabs) return
    this.persist(tabs, this.snapshot.favorites)
    this.publish(tabs, this.snapshot.favorites, this.snapshot.order)
  }

  /**
   * Pin or unpin one session.
   *
   * Only the favorites tree changes: the tab list keeps its order and the
   * activation order is passed through, so the strip and the close fallback are
   * unaffected by bookmarking. Unpinning removes the row wherever it sits, so a
   * bookmark filed in a folder is unpinned rather than duplicated at the root.
   * @param id - session identity.
   * @param title - title to store when pinning; defaults to the short id.
   */
  toggleFavorite(id: string, title?: string): void {
    this.commitFavorites(toggleFavoriteEntry(this.snapshot.favorites, id, title))
  }

  /**
   * Reorder the drawer.
   *
   * Vertical drag is favorites-tree business only: the strip's order and the
   * activation order both pass through untouched. The drop has to land on a
   * sibling — an entry or a folder in the same layer — which is what keeps a
   * reorder from silently changing a node's folder.
   * @param id - the node being dragged.
   * @param targetId - the sibling the drop landed on.
   * @param place - whether it lands before or after the target.
   */
  moveFavorite(id: string, targetId: string, place: 'before' | 'after'): void {
    this.commitFavorites(moveFavoriteEntry(this.snapshot.favorites, id, targetId, place))
  }

  /**
   * Create a folder, at the root or inside another folder.
   *
   * The title falls back to the localized default so every caller (the drawer's
   * own button included) gets a named, immediately renamable folder.
   * @param parentId - the containing folder; omitted means the root layer.
   * @param title - the name; blank means the localized default.
   * @returns the new folder id, or '' when the parent folder does not exist.
   */
  createFolder(parentId?: string, title?: string): string {
    const label = title === undefined || title.trim() === '' ? t('fav.folderDefault') : title
    const created = createFolderInTree(this.snapshot.favorites, parentId, label)
    if (created.folder === undefined) return ''
    this.persist(this.snapshot.tabs, created.next)
    this.publish(this.snapshot.tabs, created.next, this.snapshot.order)
    return created.folder.id
  }

  /**
   * Rename one folder.
   *
   * A blank name, or the name it already has, is a no-op: no write, no notify.
   * @param folderId - the folder to rename.
   * @param title - the new name.
   */
  renameFolder(folderId: string, title: string): void {
    this.commitFavorites(renameFolderEntry(this.snapshot.favorites, folderId, title))
  }

  /**
   * Delete one folder and everything inside it.
   *
   * Favorites only: the tabs of the deleted sessions stay exactly where they
   * are, exactly like unpinning one row does.
   * @param folderId - the folder to drop.
   */
  removeFolder(folderId: string): void {
    this.commitFavorites(removeFolderEntry(this.snapshot.favorites, folderId))
  }

  /**
   * Move one bookmark into a folder, appended last.
   * @param id - session identity being moved.
   * @param folderId - the destination folder.
   */
  moveFavoriteInto(id: string, folderId: string): void {
    this.commitFavorites(moveFavoriteIntoFolder(this.snapshot.favorites, id, folderId))
  }

  /**
   * Move one folder next to a row, in that row's layer.
   *
   * A folder dropped on a bookmark becomes that bookmark's sibling — same layer
   * is a reorder, another layer makes the folder join it. A folder can never
   * land inside its own subtree, so a mis-aimed drop cannot flatten the tree.
   * @param folderId - the folder being dragged.
   * @param targetId - the row the drop landed on.
   * @param place - whether it lands before or after the target.
   */
  moveFolder(folderId: string, targetId: string, place: 'before' | 'after'): void {
    this.commitFavorites(moveFolderBeside(this.snapshot.favorites, folderId, targetId, place))
  }

  /**
   * Move one folder into another folder, or back to the root layer.
   *
   * The store refuses a move into itself or into its own descendants, so a
   * mis-aimed drop cannot flatten the tree into a loop.
   * @param folderId - the folder being moved.
   * @param parentFolderId - the destination folder; undefined means the root.
   */
  moveFolderInto(folderId: string, parentFolderId: string | undefined): void {
    this.commitFavorites(moveFolderIntoFolder(this.snapshot.favorites, folderId, parentFolderId))
  }

  /** Drop every subscriber (plugin teardown). */
  dispose(): void {
    this.listeners.clear()
  }

  /**
   * Adopt a favorites tree produced by the store, or stay put.
   *
   * The store hands back its input reference for every no-op, which is what
   * keeps a drag that lands nowhere, a rename to the same name, and a removal
   * of an absent folder from writing storage or waking a subscriber.
   * @param favorites - the candidate tree.
   */
  private commitFavorites(favorites: readonly FavoriteNode[]): void {
    if (favorites === this.snapshot.favorites) return
    this.persist(this.snapshot.tabs, favorites)
    this.publish(this.snapshot.tabs, favorites, this.snapshot.order)
  }

  private persist(tabs: readonly RecentTab[], favorites: readonly FavoriteNode[]): void {
    saveLedger(this.storage, { tabs, favorites })
  }

  private publish(
    tabs: readonly RecentTab[],
    favorites: readonly FavoriteNode[],
    order: readonly string[],
  ): void {
    this.snapshot = { tabs, favorites, order }
    for (const listener of this.listeners) listener()
  }
}
