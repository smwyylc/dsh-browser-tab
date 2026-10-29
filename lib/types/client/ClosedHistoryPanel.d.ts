import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { RecentTabsController } from './controller.ts';
/**
 * Render the recently-closed drawer.
 * @param props - controller and the plugin's client context.
 * @returns the drawer, or null while it is closed.
 */
export declare function ClosedHistoryPanel({ controller, ctx }: {
    controller: RecentTabsController;
    ctx: ClientContext;
}): React.JSX.Element | null;
