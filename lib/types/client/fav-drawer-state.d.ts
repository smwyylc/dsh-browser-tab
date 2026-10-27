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
/** Whether the drawer is currently open. */
export declare function isFavoritesOpen(): boolean;
/**
 * Open or close the drawer.
 * @param next - desired state; a no-op returns without notifying.
 */
export declare function setFavoritesOpen(next: boolean): void;
/** Flip the drawer. */
export declare function toggleFavoritesOpen(): void;
/**
 * Subscribe to open/close changes.
 * @param listener - called after every real change.
 * @returns the unsubscriber.
 */
export declare function subscribeFavoritesOpen(listener: () => void): () => void;
