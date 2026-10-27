/**
 * Open/closed state of the favorites drawer.
 *
 * The button is rendered by the tab strip and the drawer is its own frame-wide
 * overlay registration: two separate mounts, so neither component can own the
 * flag. A module-level observable bridges them, in the same subscribe shape as
 * `controller.ts`. The strip also subscribes, so an open drawer can hold the bar
 * (and the button it is anchored to) on screen.
 *
 * This is pure UI state: it is never persisted and never reaches the store.
 */

let open = false
const listeners = new Set<() => void>()

/** Whether the drawer is currently open. */
export function isFavoritesOpen(): boolean {
  return open
}

/**
 * Open or close the drawer.
 * @param next - desired state; a no-op returns without notifying.
 */
export function setFavoritesOpen(next: boolean): void {
  if (open === next) return
  open = next
  for (const listener of listeners) listener()
}

/** Flip the drawer. */
export function toggleFavoritesOpen(): void {
  setFavoritesOpen(!open)
}

/**
 * Subscribe to open/close changes.
 * @param listener - called after every real change.
 * @returns the unsubscriber.
 */
export function subscribeFavoritesOpen(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
