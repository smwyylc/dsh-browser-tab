/** Whether the recently-closed drawer is currently open. */
export declare function isClosedHistoryOpen(): boolean;
/**
 * Open or close the drawer.
 * @param next - desired state; a no-op returns without notifying.
 */
export declare function setClosedHistoryOpen(next: boolean): void;
/** Flip the drawer. */
export declare function toggleClosedHistoryOpen(): void;
/**
 * Subscribe to open/close changes.
 * @param listener - called after every real change.
 * @returns the unsubscriber.
 */
export declare function subscribeClosedHistoryOpen(listener: () => void): () => void;
