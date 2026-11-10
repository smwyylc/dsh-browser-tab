/**
 * The `New session` item of the tab context menu.
 *
 * The menu used to carry one action (pin/unpin). It now leads with a
 * constructive one: start a session in the workspace the tab's session belongs
 * to, and switch to it. A session row carries no workspace, so the mapping is
 * read off the Workspaces snapshot, whose rows list their `sessionIds`; the
 * cases here pin that down, including every degraded shape — no service, no
 * match, malformed snapshot — because each of them must still go through with
 * no id rather than throw.
 *
 * Everything is read through `ctx.get`, so doubling the Client services is
 * enough — the same fakes `tests/closed-history.spec.tsx` uses.
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecentTabsController } from '../src/client/controller.ts'
import { RecentTabs } from '../src/client/RecentTabs.tsx'
import { setFavoritesOpen } from '../src/client/fav-drawer-state.ts'
import { setClosedHistoryOpen } from '../src/client/hist-drawer-state.ts'
import { workspaceIdForSession } from '../src/client/session-workspace.ts'
import { STORAGE_KEY, type TabStorage } from '../src/client/store.ts'
import type {
  SessionsLike,
  SessionReferenceLike,
  SessionRetainOptionsLike,
  SessionStatusLike,
  UiSessionLike,
  UiWorkspaceLike,
  WorkspacesLike,
} from '../src/client/sessions-face.ts'

/** One row of the fake session list. */
interface FakeRow {
  title?: string
  displayTitle?: string
  retainedBy?: { mainView?: number }
}

/** One workspace row of the fake Workspaces snapshot. */
interface WorkspaceSeed {
  workspaceId: string
  sessionIds: string[]
}

/** In-memory storage double that exposes the persisted text and write count. */
function memoryStorage(initial?: string): TabStorage & { value: string | null; writes: number } {
  const box = {
    value: initial ?? null,
    writes: 0,
    getItem(key: string): string | null { return key === STORAGE_KEY ? box.value : null },
    setItem(key: string, value: string): void {
      if (key === STORAGE_KEY) {
        box.value = value
        box.writes += 1
      }
    },
  }
  return box
}

/**
 * Build a fake `sessions` service over mutable rows.
 * @param rows - session rows keyed by id, in host-list order.
 */
function fakeSessions(rows: Record<string, FakeRow>): SessionsLike {
  const ids = Object.keys(rows)
  const listeners = new Set<() => void>()
  const rename = vi.fn(async (title: string) => ({ ok: true as const, value: { title } }))
  const using = vi.fn(async (
    _target: string,
    _options: SessionRetainOptionsLike,
    operation: (reference: SessionReferenceLike) => unknown,
  ) => operation({ binding: { session: { rename } }, release: () => {} }))
  return {
    list: {
      getSnapshot: () => ({ ids: ids.slice(), byId: rows }),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    binding: () => ({ session: { rename } }),
    using: using as unknown as SessionsLike['using'],
  }
}

/** A fake Workspaces service whose list snapshot holds the given rows. */
function fakeWorkspaces(items: WorkspaceSeed[]): WorkspacesLike {
  const listeners = new Set<() => void>()
  return {
    list: {
      getSnapshot: () => ({
        items,
        archivedSessionIds: [],
        pinnedSessionIds: [],
        state: 'ready',
        phase: undefined,
        error: undefined,
      }),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
  }
}

/**
 * A fake context over the services the strip reads.
 * @param rows - session rows.
 * @param workspaces - the Workspaces snapshot rows, or null for "not installed".
 * @param withUiWorkspace - whether `uiWorkspace` resolves at all.
 */
function fakeContext(
  rows: Record<string, FakeRow>,
  workspaces: WorkspaceSeed[] | null,
  withUiWorkspace: boolean,
) {
  const service = fakeSessions(rows)
  const statusListeners = new Set<() => void>()
  const uiSession: UiSessionLike = {
    sessionStatus: {
      getSnapshot: () => new Map<string, SessionStatusLike>(),
      subscribe: (listener: () => void) => {
        statusListeners.add(listener)
        return () => { statusListeners.delete(listener) }
      },
    },
  }
  const openSession = vi.fn()
  const startSession = vi.fn()
  const uiWorkspace: UiWorkspaceLike = { openSession, startSession }
  const ctx = {
    get: (name: string) => {
      if (name === 'sessions') return service
      if (name === 'uiSession') return uiSession
      if (name === 'uiWorkspace') return withUiWorkspace ? uiWorkspace : undefined
      if (name === 'workspaces') return workspaces === null ? undefined : fakeWorkspaces(workspaces)
      return undefined
    },
  }
  return { ctx, openSession, startSession }
}

let host: HTMLDivElement
let root: Root

function render(element: ReactElement): void {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => { root.render(element) })
}

/**
 * Render the strip over a seeded tab list and the given services.
 * @param rows - session rows; every row is also seeded as a tab.
 * @param workspaces - Workspaces snapshot rows, or null when the service is absent.
 * @param withUiWorkspace - defaults to true; false models a shell without it.
 */
function setup(
  rows: Record<string, FakeRow>,
  workspaces: WorkspaceSeed[] | null = null,
  withUiWorkspace = true,
) {
  const ids = Object.keys(rows)
  const storage = memoryStorage(JSON.stringify({
    tabs: ids.map(id => ({ id, title: rows[id]?.title ?? id })),
    favorites: [],
    closed: [],
  }))
  const fake = fakeContext(rows, workspaces, withUiWorkspace)
  const controller = new RecentTabsController(storage)
  render(createElement(RecentTabs, { controller, ctx: fake.ctx as never }))
  return { ...fake, storage, controller }
}

/** One tab row by its label. */
function tabByText(text: string): HTMLElement {
  const found = Array.from(host.querySelectorAll<HTMLElement>('div[class*="tab"]'))
    .find(node => node.getAttribute('data-editing') !== '1'
      && (node.textContent ?? '').startsWith(text))
  if (found === undefined) throw new Error(`no tab containing ${JSON.stringify(text)}`)
  return found
}

/** Open the tab context menu on one tab. */
function openMenuOn(text: string): void {
  act(() => {
    tabByText(text).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  })
}

/** The open tab context menu, or null. */
function menu(): HTMLElement | null {
  return host.querySelector<HTMLElement>('[data-dsh-part="tab-menu"]')
}

/** Every item of the open menu, in display order. */
function menuItems(): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('[data-dsh-part="tab-menu"] [role="menuitem"]'))
}

/** The `New session` item. */
function newSessionItem(): HTMLElement {
  const found = host.querySelector<HTMLElement>('[data-dsh-part="tab-menu-new-session"]')
  if (found === null) throw new Error('the new-session item is not rendered')
  return found
}

/** Click one element the way a pointer would. */
function click(node: HTMLElement): void {
  act(() => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // Both drawer flags are module-level state: start every case closed.
  setFavoritesOpen(false)
  setClosedHistoryOpen(false)
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
})

describe('new session item', () => {
  it('puts New session above the favorite toggle', () => {
    setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })

    openMenuOn('Alpha')

    const items = menuItems()
    expect(items).toHaveLength(2)
    expect(items.map(item => item.textContent)).toEqual(['新会话', '收藏'])
    expect(items[0].getAttribute('data-dsh-part')).toBe('tab-menu-new-session')
    expect(items[1].getAttribute('data-dsh-part')).toBe('tab-menu-favorite')
    // Both are plain buttons, so Tab and Enter reach them without extra wiring.
    expect(items.map(item => item.tagName)).toEqual(['BUTTON', 'BUTTON'])
    expect(items.map(item => item.getAttribute('role'))).toEqual(['menuitem', 'menuitem'])
  })

  it('starts the session in the workspace that lists that tab', () => {
    const { startSession } = setup(
      { s1: { title: 'Alpha', retainedBy: { mainView: 1 } }, s2: { title: 'Beta' } },
      [
        { workspaceId: 'w1', sessionIds: ['s2'] },
        { workspaceId: 'w2', sessionIds: ['s1'] },
      ],
    )

    openMenuOn('Alpha')
    click(newSessionItem())

    expect(startSession).toHaveBeenCalledTimes(1)
    expect(startSession).toHaveBeenCalledWith('w2')
  })

  it('inherits the current workspace when no workspace lists the session', () => {
    const { startSession } = setup(
      { s1: { title: 'Alpha', retainedBy: { mainView: 1 } } },
      [{ workspaceId: 'w1', sessionIds: ['somebody-else'] }],
    )

    openMenuOn('Alpha')
    click(newSessionItem())

    expect(startSession).toHaveBeenCalledTimes(1)
    expect(startSession).toHaveBeenCalledWith(undefined)
  })

  it('still starts a session when the Workspaces service is not installed', () => {
    const { startSession } = setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } }, null)

    openMenuOn('Alpha')
    expect(() => click(newSessionItem())).not.toThrow()

    expect(startSession).toHaveBeenCalledTimes(1)
    expect(startSession).toHaveBeenCalledWith(undefined)
  })

  it('does nothing when ui-workspace is missing', () => {
    setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } }, null, false)

    openMenuOn('Alpha')
    expect(() => click(newSessionItem())).not.toThrow()
    // The click still belongs to the menu, which closes as on any other item.
    expect(menu()).toBeNull()
  })

  it('closes the menu and writes none of the stored collections', () => {
    const { controller, storage, openSession, startSession } = setup(
      { s1: { title: 'Alpha', retainedBy: { mainView: 1 } } },
      [{ workspaceId: 'w1', sessionIds: ['s1'] }],
    )
    const before = controller.getSnapshot()
    const writes = storage.writes
    const persisted = storage.value

    openMenuOn('Alpha')
    click(newSessionItem())

    expect(menu()).toBeNull()
    expect(startSession).toHaveBeenCalledTimes(1)
    // Starting a session is navigation, not storage: all three collections keep
    // their identity and nothing is written back.
    expect(controller.getSnapshot()).toBe(before)
    expect(controller.getSnapshot().tabs).toBe(before.tabs)
    expect(controller.getSnapshot().favorites).toBe(before.favorites)
    expect(controller.getSnapshot().closed).toBe(before.closed)
    expect(storage.writes).toBe(writes)
    expect(storage.value).toBe(persisted)
    expect(openSession).not.toHaveBeenCalled()
  })
})

describe('workspaceIdForSession', () => {
  it('finds the workspace that lists the session', () => {
    const snapshot = {
      items: [
        { workspaceId: 'w1', sessionIds: ['a'] },
        { workspaceId: 'w2', sessionIds: ['b', 'c'] },
      ],
    }

    expect(workspaceIdForSession(snapshot, 'c')).toBe('w2')
    expect(workspaceIdForSession(snapshot, 'a')).toBe('w1')
  })

  it('takes the first match when several workspaces claim one session', () => {
    const snapshot = {
      items: [
        { workspaceId: 'w1', sessionIds: ['a'] },
        { workspaceId: 'w2', sessionIds: ['a'] },
      ],
    }

    expect(workspaceIdForSession(snapshot, 'a')).toBe('w1')
  })

  it('returns undefined for every malformed snapshot instead of throwing', () => {
    for (const snapshot of [undefined, null, 42, 'items', {}, { items: 'nope' }, { items: null }]) {
      expect(workspaceIdForSession(snapshot, 'a')).toBeUndefined()
    }
  })

  it('skips rows that are not shaped like a workspace', () => {
    const snapshot = {
      items: [
        null,
        42,
        { workspaceId: 'w1' },
        { workspaceId: 'w1', sessionIds: 'a' },
        { workspaceId: 7, sessionIds: ['a'] },
        { workspaceId: '', sessionIds: ['a'] },
        { sessionIds: ['a'] },
        { workspaceId: 'w2', sessionIds: ['a'] },
      ],
    }

    expect(workspaceIdForSession(snapshot, 'a')).toBe('w2')
  })

  it('returns undefined when the session is in no workspace', () => {
    expect(workspaceIdForSession({ items: [{ workspaceId: 'w1', sessionIds: ['b'] }] }, 'a'))
      .toBeUndefined()
  })
})
