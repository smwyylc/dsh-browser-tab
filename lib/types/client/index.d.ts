import type { Context as ClientContext } from '@deepseek-ai/cordis';
import './shell-overlay-slot.ts';
import { type RecentTabsKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** recent-tabs surface copy. */
        'dsh-recent-tabs': RecentTabsKey;
    }
}
/**
 * Required services: slots for the two overlay seats, locale for the copy.
 *
 * Every surface also *reads* `sessions` (list + retention), `uiSession`
 * (per-session status) and `uiWorkspace` (session switching), but resolves them
 * with `ctx.get` at the point of use instead of gating activation on them: a
 * missing one degrades a surface, while a failed apply takes the whole shell
 * down.
 */
export declare const inject: string[];
/** Type-only surface (export discipline: no value exports beyond the plugin contract). */
export type { RecentTabsKey } from './locales.ts';
export type { RecentTab } from './store.ts';
/**
 * Mount the recent-tabs surfaces.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
