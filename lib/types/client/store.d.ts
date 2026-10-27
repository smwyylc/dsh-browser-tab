/**
 * Recent-tab ledger: the ordered list of sessions the user has opened in this
 * browser, plus the set of sessions they bookmarked, persisted to localStorage.
 *
 * Tabs and favorites are two independent collections, exactly like a browser
 * keeping open tabs apart from bookmarks: a tab is "open in the strip right
 * now", a favorite is "kept for later". Closing a tab therefore never touches
 * the favorites collection, and pinning a session never reorders the strip.
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
/**
 * A folder on the favorites tree, the way a browser's bookmark manager has
 * them: it holds bookmark rows and other folders, and it has no session of its
 * own. A folder is a container, never a second copy of a bookmark.
 */
export interface FavoriteFolder {
    /** Folder identity, generated here (`fav-folder-*`); never a session id. */
    id: string;
    /** Name shown on the folder row. */
    title: string;
    /** Nested nodes, in display order. */
    children: FavoriteNode[];
}
/** One node of the favorites tree: a bookmark row or a folder. */
export type FavoriteNode = FavoriteEntry | FavoriteFolder;
/**
 * Whether a node is a folder.
 *
 * `children` is the one field a folder has that a bookmark row never does, and
 * every node this module produces comes from `readFavoriteRow`, so the check is
 * exact for stored and freshly built data alike.
 * @param node - one tree node.
 * @returns true when the node is a folder.
 */
export declare function isFolder(node: FavoriteNode): node is FavoriteFolder;
/** Both persisted collections, as one record. */
export interface Ledger {
    readonly tabs: readonly RecentTab[];
    /**
     * The root layer of the favorites tree: bookmark rows and folders side by
     * side. The field name predates folders and stays — every consumer reads the
     * tree from here.
     */
    readonly favorites: readonly FavoriteNode[];
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
 * Find a bookmark by session id anywhere in the tree.
 *
 * The drawer and the strip both need "is this session pinned?" without caring
 * which folder holds it, so this walks folders as well as the root layer.
 * @param nodes - the favorites layer to search.
 * @param id - the session id.
 * @returns the bookmark row, or undefined when the session is not pinned.
 */
export declare function findFavorite(nodes: readonly FavoriteNode[], id: string): FavoriteEntry | undefined;
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
export declare function toggleFavorite(favorites: readonly FavoriteNode[], id: string, title?: string): FavoriteNode[];
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
export declare function moveFavorite(favorites: readonly FavoriteNode[], id: string, targetId: string, place: 'before' | 'after'): FavoriteNode[];
/**
 * Result of creating a folder: the new tree and the folder itself.
 *
 * The folder is undefined only when the requested parent does not exist, in
 * which case the tree comes back untouched.
 */
export interface CreatedFolder {
    /** The next favorites tree (the input reference when nothing was created). */
    readonly next: readonly FavoriteNode[];
    /** The new folder, or undefined when its parent was missing. */
    readonly folder: FavoriteFolder | undefined;
}
/**
 * Create an empty folder at the root or inside another folder.
 * @param favorites - current favorites tree.
 * @param parentId - the containing folder, or undefined for the root layer.
 * @param title - the name to give it; a blank one falls back to the short id.
 * @returns the new tree and the folder.
 */
export declare function createFolder(favorites: readonly FavoriteNode[], parentId: string | undefined, title: string): CreatedFolder;
/**
 * Rename one folder.
 * @param favorites - current favorites tree.
 * @param folderId - the folder to rename.
 * @param title - the new name; blank means "leave it alone".
 * @returns the next tree, the SAME reference when nothing changed.
 */
export declare function renameFolder(favorites: readonly FavoriteNode[], folderId: string, title: string): FavoriteNode[];
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
export declare function removeFolder(favorites: readonly FavoriteNode[], folderId: string): FavoriteNode[];
/**
 * Move one bookmark into a folder, appended last.
 * @param favorites - current favorites tree.
 * @param id - the session id being moved.
 * @param folderId - the destination folder.
 * @returns the next tree; the SAME reference when the folder is missing, the
 * id is not a bookmark, or the row already sits last in that folder.
 */
export declare function moveFavoriteInto(favorites: readonly FavoriteNode[], id: string, folderId: string): FavoriteNode[];
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
export declare function moveFolderInto(favorites: readonly FavoriteNode[], folderId: string, parentFolderId: string | undefined): FavoriteNode[];
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
export declare function moveFolder(favorites: readonly FavoriteNode[], folderId: string, targetId: string, place: 'before' | 'after'): FavoriteNode[];
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
