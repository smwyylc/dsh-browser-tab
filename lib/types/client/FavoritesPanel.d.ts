import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { RecentTabsController } from './controller.ts';
/**
 * Render the favorites drawer.
 * @param props - controller and the plugin's client context.
 * @returns the drawer, or null while it is closed.
 */
export declare function FavoritesPanel({ controller, ctx }: {
    controller: RecentTabsController;
    ctx: ClientContext;
}): React.JSX.Element | null;
