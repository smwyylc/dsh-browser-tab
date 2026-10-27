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
  dropOrder,
  loadLedger,
  moveFavorite as moveFavoriteEntry,
  moveTab,
  nextActiveAfterClose,
  recordTab,
  removeTab,
  saveLedger,
  toggleFavorite as toggleFavoriteEntry,
  touchOrder,
  type FavoriteEntry,
  type RecentTab,
  type TabStorage,
} from './store.ts'

/** Immutable snapshot consumed by the React surface. */
export interface TabsSnapshot {
  readonly tabs: readonly RecentTab[]
  /** Bookmarks, independent of the tab list: closing a tab never drops one. */
  readonly favorites: readonly FavoriteEntry[]
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
   * Only the favorites collection changes: the tab list keeps its order and the
   * activation order is passed through, so the strip and the close fallback are
   * unaffected by bookmarking.
   * @param id - session identity.
   * @param title - title to store when pinning; defaults to the short id.
   */
  toggleFavorite(id: string, title?: string): void {
    const favorites = toggleFavoriteEntry(this.snapshot.favorites, id, title)
    if (favorites === this.snapshot.favorites) return
    this.persist(this.snapshot.tabs, favorites)
    this.publish(this.snapshot.tabs, favorites, this.snapshot.order)
  }

  /**
   * Reorder the drawer.
   *
   * Vertical drag is bookmark-list business only: the strip's order and the
   * activation order both pass through untouched.
   * @param id - the entry being dragged.
   * @param targetId - the entry the drop landed on.
   * @param place - whether it lands before or after the target.
   */
  moveFavorite(id: string, targetId: string, place: 'before' | 'after'): void {
    const favorites = moveFavoriteEntry(this.snapshot.favorites, id, targetId, place)
    if (favorites === this.snapshot.favorites) return
    this.persist(this.snapshot.tabs, favorites)
    this.publish(this.snapshot.tabs, favorites, this.snapshot.order)
  }

  /** Drop every subscriber (plugin teardown). */
  dispose(): void {
    this.listeners.clear()
  }

  private persist(tabs: readonly RecentTab[], favorites: readonly FavoriteEntry[]): void {
    saveLedger(this.storage, { tabs, favorites })
  }

  private publish(
    tabs: readonly RecentTab[],
    favorites: readonly FavoriteEntry[],
    order: readonly string[],
  ): void {
    this.snapshot = { tabs, favorites, order }
    for (const listener of this.listeners) listener()
  }
}
