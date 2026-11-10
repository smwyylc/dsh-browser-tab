/**
 * Which workspace holds a given session.
 *
 * A session row carries no workspace field, so the Workspaces controller's
 * snapshot — where every workspace lists its own `sessionIds` — is the only
 * mapping between the two. This resolver is total and silent: anything missing
 * or malformed yields `undefined`, which lets the caller fall back to the
 * shell's "inherit the current or most recent workspace" behaviour rather than
 * failing the surface.
 */
import type { WorkspaceViewLike } from './sessions-face.ts'

/**
 * Coerce a possibly-untrusted id into a non-empty string.
 * @param value - candidate id from a snapshot row.
 */
function asId(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Find the workspace whose `sessionIds` contains the session.
 *
 * Several workspaces claiming one session should not happen; the first match in
 * snapshot order wins so the answer is stable across calls.
 * @param snapshot - `ctx.workspaces.list.getSnapshot()`, or anything else.
 * @param sessionId - the session a tab stands for.
 * @returns its workspace id, or `undefined` when the snapshot cannot say.
 */
export function workspaceIdForSession(snapshot: unknown, sessionId: string): string | undefined {
  if (typeof snapshot !== 'object' || snapshot === null) return undefined
  const items = (snapshot as { items?: unknown }).items
  if (!Array.isArray(items)) return undefined
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as WorkspaceViewLike
    const workspaceId = asId(row.workspaceId)
    if (workspaceId === undefined) continue
    const sessionIds = row.sessionIds
    if (!Array.isArray(sessionIds)) continue
    if (sessionIds.some(id => id === sessionId)) return workspaceId
  }
  return undefined
}
