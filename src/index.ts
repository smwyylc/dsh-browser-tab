/**
 * Host-half entry for the recent-tabs plugin.
 *
 * This plugin is browser-only: the retained tab list lives in the browser's
 * own storage, so there is no Host state to own and no route to serve. The
 * entry exists so the bundle row resolves on the Host plane exactly like the
 * family's other browser-only packages (see dsh-chat-recovery).
 */
import type { Context } from '@deepseek-ai/cordis'

/**
 * No-op apply: the Host plane contributes nothing here.
 * @param _ctx - host root context (unused).
 */
export function apply(_ctx: Context): void {
  // Intentionally empty: the feature is entirely client-side.
}
