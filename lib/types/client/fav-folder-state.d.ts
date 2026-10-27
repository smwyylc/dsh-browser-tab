/**
 * Which favorites folders are expanded in the drawer.
 *
 * Same shape as `fav-drawer-state.ts` and for the same reason: the drawer is
 * unmounted while it is closed, so the set has to live outside React or every
 * reopen would fold the tree back up. Pure UI state — it is never persisted and
 * never reaches the store, so a reload starts with every folder collapsed, the
 * way a browser's bookmark panel does.
 */
/**
 * The current expansion set.
 *
 * The reference only changes on a real change, which is what `useSyncExternalStore`
 * needs to stop re-rendering on every drawer render.
 * @returns the expanded folder ids.
 */
export declare function folderExpansion(): ReadonlySet<string>;
/**
 * Expand or collapse one folder.
 * @param id - folder id.
 * @param next - desired state; a no-op returns without notifying.
 */
export declare function setFolderExpanded(id: string, next: boolean): void;
/**
 * Flip one folder.
 * @param id - folder id.
 */
export declare function toggleFolderExpanded(id: string): void;
/**
 * Subscribe to expansion changes.
 * @param listener - called after every real change.
 * @returns the unsubscriber.
 */
export declare function subscribeFolderExpanded(listener: () => void): () => void;
/**
 * Collapse every folder.
 *
 * No surface offers this — it exists so a test can start from the same state a
 * page load would, since the set deliberately outlives a drawer mount.
 */
export declare function resetFolderExpanded(): void;
