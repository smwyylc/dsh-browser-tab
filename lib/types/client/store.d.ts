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
export declare const STORAGE_KEY = "dsh-recent-tabs-v1";
/**
 * Backup key of the pre-migration payload.
 *
 * Browsers in the wild still hold the legacy shape (a bare array of rows, each
 * carrying its own `favorite` flag). The first load copies that text here
 * verbatim before rewriting the canonical key, so a failed or unwanted
 * migration can never destroy a user's bookmarks.
 */
export declare const BACKUP_KEY = "dsh-recent-tabs-v1-backup";
/** Hard cap on retained tabs (oldest beyond this are dropped). */
export declare const MAX_TABS = 40;
/** One retained session tab. */
export interface RecentTab {
    /** Session identity. */
    id: string;
    /** Last known title (used when the session is no longer in the live list). */
    title: string;
}
/**
 * One bookmark.
 *
 * Deliberately its own row type rather than a flag on a tab: an entry outlives
 * the tab it points at, and a closed tab is not a closed bookmark.
 */
export interface FavoriteEntry {
    /** Session identity. */
    id: string;
    /** Title captured when the user pinned it. */
    title: string;
}
/** Both persisted collections, as one record. */
export interface Ledger {
    readonly tabs: readonly RecentTab[];
    readonly favorites: readonly FavoriteEntry[];
}
/** Result of reading the persisted text. */
export interface ParsedLedger {
    /** The two lists, normalized. */
    ledger: Ledger;
    /** True when the stored payload used the legacy tab-array shape. */
    migrated: boolean;
}
/** Minimal storage face, so tests can inject a fake. */
export interface TabStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}
/** Short id fallback for sessions without a durable title. */
export declare function shortId(id: string): string;
/**
 * Parse persisted text into a ledger, dropping malformed rows and reporting
 * whether the payload needs the one-time migration rewrite.
 * @param raw - the stored JSON text, or null when nothing was stored.
 * @returns the ledger plus the migration flag, never throwing on corrupt input.
 */
export declare function parseLedger(raw: string | null): ParsedLedger;
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
export declare function recordTab(tabs: readonly RecentTab[], id: string, title: string): RecentTab[];
/**
 * Remove one tab.
 *
 * Bookmarks are a different collection and are not a parameter here on
 * purpose: closing a tab cannot delete its favorite.
 * @param tabs - current list.
 * @param id - session to drop.
 * @returns the next list, the SAME reference when the id was absent.
 */
export declare function removeTab(tabs: readonly RecentTab[], id: string): RecentTab[];
/**
 * Move one tab before/after another.
 * @param tabs - current list.
 * @param id - the tab being dragged.
 * @param targetId - the tab the drop landed on.
 * @param place - whether the dragged tab lands before or after the target.
 * @returns the next list; the SAME reference when the move is a no-op (either
 * id absent, or the tab already sits there).
 */
export declare function moveTab(tabs: readonly RecentTab[], id: string, targetId: string, place: 'before' | 'after'): RecentTab[];
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
export declare function toggleFavorite(favorites: readonly FavoriteEntry[], id: string, title?: string): FavoriteEntry[];
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
export declare function moveFavorite(favorites: readonly FavoriteEntry[], id: string, targetId: string, place: 'before' | 'after'): FavoriteEntry[];
/**
 * Move one id to the front of an activation (MRU) order.
 *
 * The front is "most recently activated". Closing the active tab then hands
 * the selection to the next entry — the tab the user was last on.
 * @param order - current order, most-recent-first.
 * @param id - id that just became active.
 * @returns the next order; an unchanged head returns the SAME reference.
 */
export declare function touchOrder(order: readonly string[], id: string): string[];
/**
 * Drop one id from an activation order.
 * @param order - current order.
 * @param id - id to forget.
 * @returns the next order, the SAME reference when the id was absent.
 */
export declare function dropOrder(order: readonly string[], id: string): string[];
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
export declare function nextActiveAfterClose(order: readonly string[], tabs: readonly RecentTab[], closed: string): string | undefined;
/**
 * Read the persisted ledger, migrating a legacy payload in place.
 *
 * The migration is idempotent: it only runs for the legacy array shape, so a
 * second load of the rewritten record neither writes nor changes the backup.
 * @param storage - browser storage (or a fake in tests).
 * @returns the ledger; empty when storage is unavailable or corrupt.
 */
export declare function loadLedger(storage: TabStorage | undefined): Ledger;
/**
 * Persist both collections, ignoring storage failures (private mode, quota).
 * @param storage - browser storage (or a fake in tests).
 * @param ledger - the record to persist.
 */
export declare function saveLedger(storage: TabStorage | undefined, ledger: Ledger): void;
