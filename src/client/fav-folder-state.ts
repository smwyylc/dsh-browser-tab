/**
 * Which favorites folders are expanded in the drawer.
 *
 * Same shape as `fav-drawer-state.ts` and for the same reason: the drawer is
 * unmounted while it is closed, so the set has to live outside React or every
 * reopen would fold the tree back up. Pure UI state — it is never persisted and
 * never reaches the store, so a reload starts with every folder collapsed, the
 * way a browser's bookmark panel does.
 */

/** Expanded folder ids; replaced (never mutated) on every change. */
let expanded: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

/**
 * The current expansion set.
 *
 * The reference only changes on a real change, which is what `useSyncExternalStore`
 * needs to stop re-rendering on every drawer render.
 * @returns the expanded folder ids.
 */
export function folderExpansion(): ReadonlySet<string> {
  return expanded
}

/**
 * Whether one folder is expanded.
 * @param id - folder id.
 * @returns true when its children are shown.
 */
function isFolderExpanded(id: string): boolean {
  return expanded.has(id)
}

/**
 * Expand or collapse one folder.
 * @param id - folder id.
 * @param next - desired state; a no-op returns without notifying.
 */
export function setFolderExpanded(id: string, next: boolean): void {
  if (expanded.has(id) === next) return
  const copy = new Set(expanded)
  if (next) {
    copy.add(id)
  } else {
    copy.delete(id)
  }
  expanded = copy
  for (const listener of listeners) listener()
}

/**
 * Flip one folder.
 * @param id - folder id.
 */
export function toggleFolderExpanded(id: string): void {
  setFolderExpanded(id, !isFolderExpanded(id))
}

/**
 * Subscribe to expansion changes.
 * @param listener - called after every real change.
 * @returns the unsubscriber.
 */
export function subscribeFolderExpanded(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Collapse every folder.
 *
 * No surface offers this — it exists so a test can start from the same state a
 * page load would, since the set deliberately outlives a drawer mount.
 */
export function resetFolderExpanded(): void {
  if (expanded.size === 0) return
  expanded = new Set()
  for (const listener of listeners) listener()
}
