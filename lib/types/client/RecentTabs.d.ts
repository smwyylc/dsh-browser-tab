import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { RecentTabsController } from './controller.ts';
/**
 * Render the tab strip.
 * @param props - controller and the plugin's client context.
 */
export declare function RecentTabs({ controller, ctx }: {
    controller: RecentTabsController;
    ctx: ClientContext;
}): React.JSX.Element;
