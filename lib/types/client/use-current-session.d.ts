import type { Context as ClientContext } from '@deepseek-ai/cordis';
/** View of the live session list: presence, titles, running state, and the selection. */
export interface SessionView {
    current: string | undefined;
    /** Ids still present in the live list, in list order. */
    liveIds: readonly string[];
    titles: Readonly<Record<string, string>>;
    /** Ids whose agent turn is currently executing. */
    runningIds: ReadonlySet<string>;
    /**
     * Ids holding an unacknowledged completion — a turn that stopped while the
     * user was not looking at that session. Mutually exclusive with `runningIds`:
     * a turn executing again is the fresher fact, so it drops the mark.
     */
    completedIds: ReadonlySet<string>;
    /**
     * Ids with a request currently waiting on the user — a question or a plan
     * review, both published as `SessionStatus.pendingInteraction`. Recorded
     * independently of the two turn facts, because it does not describe the turn
     * but the fact that the turn cannot continue without an answer; the strip
     * gives it precedence over both.
     */
    waitingIds: ReadonlySet<string>;
}
/** Empty view, used before the services answer. */
export declare const EMPTY_SESSION_VIEW: SessionView;
/**
 * Pick the session id the main view holds.
 * @param state - the Session Controller list snapshot (untyped on purpose:
 * the published SDK shapes differ between copies).
 * @returns the current session id, or undefined when nothing is selected.
 */
export declare function currentSessionId(state: unknown): string | undefined;
/**
 * Reduce the session-list and status snapshots to the fields the surfaces render.
 * @param state - the Session Controller list snapshot.
 * @param status - the ui-session status map snapshot.
 * @returns live ids, titles, running ids, completed ids, waiting ids, and the
 * current selection.
 */
export declare function reduceSessions(state: unknown, status: unknown): SessionView;
/**
 * Follow the session list and the per-session status map.
 *
 * A retained tab whose session left the list stays visible (dimmed) until the
 * user closes it, so the view keeps the titles it last saw.
 * @param ctx - the plugin's client context.
 * @returns the current view (empty until the services answer).
 */
export declare function useSessionView(ctx: ClientContext): SessionView;
