/**
 * Recent-tab ledger: the ordered list of sessions the user has opened in this
 * browser, plus the set of sessions they bookmarked, persisted to localStorage.
 *
 * Tabs and favorites are two independent collections, exactly like a browser
 * keeping open tabs apart from bookmarks: a tab is "open in the strip right
 * now", a favorite is "kept for later". Closing a tab therefore never touches
 * the favorites collection, and pinning a session never reorders the strip.
 *
 * Pure and framework-free on purpose — every mutation is a plain function over
 * the two lists so the behaviour is locked by unit tests without React or a
 * live GUI. The React surface only reads this store through subscribe().
 */

/** Storage key of the persisted ledger. */
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

/** Both persisted collections, as one record. */
export interface Ledger {
  readonly tabs: readonly RecentTab[]
  readonly favorites: readonly FavoriteEntry[]
}

/** Result of reading the persisted text. */
export interface ParsedLedger {
  /** The two lists, normalized. */
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
  return { tabs: [], favorites: [] }
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
 * Normalize the current shape's two arrays independently.
 *
 * They are deduped one by one, not against each other: the same session is
 * usually both an open tab and a bookmark, and that is not a duplicate.
 * @param tabs - raw tab rows.
 * @param favorites - raw favorite rows.
 * @returns the normalized ledger.
 */
function readCurrent(tabs: readonly unknown[], favorites: readonly unknown[]): Ledger {
  const tabSeen = new Set<string>()
  const keptTabs: RecentTab[] = []
  for (const row of tabs) {
    if (keptTabs.length >= MAX_TABS) break
    const entry = readRow(row, tabSeen)
    if (entry !== undefined) keptTabs.push(entry)
  }
  const favoriteSeen = new Set<string>()
  const keptFavorites: FavoriteEntry[] = []
  for (const row of favorites) {
    const entry = readRow(row, favoriteSeen)
    if (entry !== undefined) keptFavorites.push(entry)
  }
  return { tabs: keptTabs, favorites: keptFavorites }
}

/**
 * Split the legacy tab array into the two collections.
 *
 * One row in that shape was both things at once when it carried the flag, so a
 * flagged row becomes a bookmark AND stays a tab: bookmarking a tab never
 * closed it, and dropping the tab here is what made favorites disappear from
 * the strip on upgrade. The buckets are deduped and ordered one by one, exactly
 * like the current shape, so one id may appear in each; only the tab bucket is
 * capped.
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
  return { tabs, favorites }
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
    return {
      ledger: readCurrent(Array.isArray(tabs) ? tabs : [], Array.isArray(favorites) ? favorites : []),
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
 * Add or remove one bookmark.
 *
 * Appends when the id is not bookmarked yet (a bookmark list keeps the order it
 * was built in), removes it otherwise. Tabs are a separate collection and are
 * never touched here.
 * @param favorites - current bookmark list.
 * @param id - session to pin or unpin.
 * @param title - title to store when pinning; defaults to the short id.
 * @returns the next list, the SAME reference when the id is empty.
 */
export function toggleFavorite(
  favorites: readonly FavoriteEntry[],
  id: string,
  title?: string,
): FavoriteEntry[] {
  if (id === '') return favorites as FavoriteEntry[]
  const index = favorites.findIndex(entry => entry.id === id)
  if (index >= 0) {
    const next = favorites.slice()
    next.splice(index, 1)
    return next
  }
  const nextTitle = title === undefined || title === '' ? shortId(id) : title
  return favorites.concat([{ id, title: nextTitle }])
}

/**
 * Move one bookmark before/after another.
 *
 * The drawer's vertical drag only ever reorders this list: the strip keeps its
 * own order and the activation order is not involved.
 * @param favorites - current bookmark list.
 * @param id - the entry being dragged.
 * @param targetId - the entry the drop landed on.
 * @param place - whether the dragged entry lands before or after the target.
 * @returns the next list; the SAME reference when the move is a no-op.
 */
export function moveFavorite(
  favorites: readonly FavoriteEntry[],
  id: string,
  targetId: string,
  place: 'before' | 'after',
): FavoriteEntry[] {
  if (id === targetId) return favorites as FavoriteEntry[]
  const from = favorites.findIndex(entry => entry.id === id)
  const to = favorites.findIndex(entry => entry.id === targetId)
  if (from < 0 || to < 0) return favorites as FavoriteEntry[]
  const next = favorites.slice()
  const [moved] = next.splice(from, 1)
  const targetIndex = next.findIndex(entry => entry.id === targetId)
  next.splice(place === 'before' ? targetIndex : targetIndex + 1, 0, moved)
  if (next.every((entry, index) => entry.id === favorites[index].id)) {
    return favorites as FavoriteEntry[]
  }
  return next
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
 * Persist both collections, ignoring storage failures (private mode, quota).
 * @param storage - browser storage (or a fake in tests).
 * @param ledger - the record to persist.
 */
export function saveLedger(storage: TabStorage | undefined, ledger: Ledger): void {
  if (storage === undefined) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ tabs: ledger.tabs, favorites: ledger.favorites }))
  } catch {
    // Persistence is best-effort: the live lists stay authoritative.
  }
}
