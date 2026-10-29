/**
 * Open/closed state of the recently-closed drawer.
 *
 * The same two-mount problem as the favorites drawer: the trigger is rendered
 * by the tab strip, the drawer is its own frame-wide overlay registration, so
 * neither component can own the flag. A module-level observable in the same
 * subscribe shape bridges them, and the strip subscribes too so an open drawer
 * can hold the bar (and the button it is anchored to) on screen.
 *
 * The two drawers hang off the same end of the bar, so they are mutually
 * exclusive: opening this one closes the favorites one. The reverse direction
 * lives in `FavoriteButton.tsx`, the only place that opens the favorites
 * drawer — importing this module from `fav-drawer-state.ts` would make the pair
 * circular, and one direction plus one call site is enough.
 *
 * This is pure UI state: it is never persisted and never reaches the store.
 */
import { setFavoritesOpen } from './fav-drawer-state.ts'

let open = false
const listeners = new Set<() => void>()

/** Whether the recently-closed drawer is currently open. */
export function isClosedHistoryOpen(): boolean {
  return open
}

/**
 * Open or close the drawer.
 * @param next - desired state; a no-op returns without notifying.
 */
export function setClosedHistoryOpen(next: boolean): void {
  if (open === next) return
  open = next
  // One popover at a time: the favorites drawer closes when this one opens.
  if (next) setFavoritesOpen(false)
  for (const listener of listeners) listener()
}

/** Flip the drawer. */
export function toggleClosedHistoryOpen(): void {
  setClosedHistoryOpen(!open)
}

/**
 * Subscribe to open/close changes.
 * @param listener - called after every real change.
 * @returns the unsubscriber.
 */
export function subscribeClosedHistoryOpen(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
