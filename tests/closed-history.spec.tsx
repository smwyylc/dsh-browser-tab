/**
 * The recently-closed drawer: the second tail button, the list it shows, and
 * the mutual exclusion between the two drawers.
 *
 * Everything is read through `ctx.get`, so doubling the Client services is
 * enough — the same fakes `tests/favorites-folders.spec.tsx` uses. The history
 * is seeded through `localStorage` so the cases also cover the parser: a stored
 * history has to come back as rows, and a record written before the collection
 * existed has to load as empty rather than as an error.
 */
import { act, createElement, Fragment, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecentTabsController } from '../src/client/controller.ts'
import { RecentTabs } from '../src/client/RecentTabs.tsx'
import { ClosedHistoryPanel } from '../src/client/ClosedHistoryPanel.tsx'
import {
  isFavoritesOpen,
  setFavoritesOpen,
} from '../src/client/fav-drawer-state.ts'
import {
  isClosedHistoryOpen,
  setClosedHistoryOpen,
} from '../src/client/hist-drawer-state.ts'
import { resetFolderExpanded } from '../src/client/fav-folder-state.ts'
import { STORAGE_KEY, type TabStorage } from '../src/client/store.ts'
import type {
  SessionsLike,
  SessionReferenceLike,
  SessionRetainOptionsLike,
  SessionStatusLike,
  UiSessionLike,
  UiWorkspaceLike,
} from '../src/client/sessions-face.ts'

/** One row of the fake session list. */
interface FakeRow {
  title?: string
  displayTitle?: string
  retainedBy?: { mainView?: number }
}

/** One stored history row, written straight to storage. */
interface SeedClosed {
  id: string
  title: string
  closedAt: number
}

/** In-memory storage double that exposes the persisted text and write count. */
function memoryStorage(initial?: string): TabStorage & { value: string | null; writes: number } {
  const box = {
    value: initial ?? null,
    writes: 0,
    getItem(key: string) { return key === STORAGE_KEY ? box.value : null },
    setItem(key: string, value: string) {
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
 * @param listed - ids the host list publishes; defaults to every row, so a
 * shortened list models a session that is retained but no longer listed.
 */
function fakeSessions(rows: Record<string, FakeRow>, listed?: string[]) {
  const ids = listed ?? Object.keys(rows)
  const listeners = new Set<() => void>()
  const rename = vi.fn(async (title: string) => ({ ok: true as const, value: { title } }))
  const binding = vi.fn(() => ({ session: { rename } }))
  const using = vi.fn(async (
    _target: string,
    _options: SessionRetainOptionsLike,
    operation: (reference: SessionReferenceLike) => unknown,
  ) => operation({ binding: { session: { rename } }, release: () => {} }))
  const service: SessionsLike = {
    list: {
      getSnapshot: () => ({ ids: ids.slice(), byId: rows }),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    binding,
    using: using as unknown as SessionsLike['using'],
  }
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
  const uiWorkspace: UiWorkspaceLike = { openSession }
  const ctx = {
    get: (name: string) => {
      if (name === 'sessions') return service
      if (name === 'uiSession') return uiSession
      if (name === 'uiWorkspace') return uiWorkspace
      return undefined
    },
  }
  return { ctx, service, openSession }
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
 * Render the strip and the history drawer over a seeded history.
 * @param rows - fake session rows (membership of the live list).
 * @param closed - the stored history, newest first.
 * @param tabs - ids the strip should hold; defaults to every row.
 * @param listed - ids the host list publishes; defaults to every row.
 */
function setup(
  rows: Record<string, FakeRow>,
  closed: SeedClosed[],
  tabs?: string[],
  listed?: string[],
) {
  const kept = tabs ?? Object.keys(rows)
  const storage = memoryStorage(JSON.stringify({
    tabs: kept.map(id => ({ id, title: rows[id]?.title ?? id })),
    favorites: [],
    closed,
  }))
  const fake = fakeSessions(rows, listed)
  const controller = new RecentTabsController(storage)
  const ctx = fake.ctx as never
  render(createElement(
    Fragment,
    null,
    createElement(RecentTabs, { controller, ctx }),
    createElement(ClosedHistoryPanel, { controller, ctx }),
  ))
  return { ...fake, storage, controller }
}

/** Open the drawer the way a click on its trigger does. */
function openDrawer(): void {
  act(() => { setClosedHistoryOpen(true) })
}

/** The drawer itself, or null while it is closed. */
function panel(): HTMLElement | null {
  return host.querySelector<HTMLElement>('[data-dsh-part="closed-history"]')
}

/** Every rendered history row, in display order. */
function historyRows(): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('[data-dsh-part="closed-history-row"]'))
}

/** The visible label of one history row. */
function rowLabel(node: HTMLElement): string {
  return node.querySelector('[class*="histRowLabel"]')?.textContent ?? ''
}

/** The two tail triggers. */
function historyButton(): HTMLElement {
  const found = host.querySelector<HTMLElement>('[data-dsh-part="closed-history-button"]')
  if (found === null) throw new Error('the history trigger is not rendered')
  return found
}

function favoriteButton(): HTMLElement {
  const found = host.querySelector<HTMLElement>('[data-dsh-part="favorite-button"]')
  if (found === null) throw new Error('the favorites trigger is not rendered')
  return found
}

/** Every tab row of the strip, in display order (`data-active` is tab-only here). */
function stripTabs(): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('[data-dsh-part="bar"] div[data-active]'))
}

/** One tab row by its title. */
function stripTab(title: string): HTMLElement {
  const found = stripTabs().find(node => node.querySelector('[class*="label"]')?.textContent === title)
  if (found === undefined) throw new Error(`no tab titled ${JSON.stringify(title)}`)
  return found
}

/** Click one element the way a pointer would. */
function click(node: HTMLElement): void {
  act(() => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // All three flags are module-level state: start every case closed.
  setFavoritesOpen(false)
  setClosedHistoryOpen(false)
  resetFolderExpanded()
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  vi.useRealTimers()
})

describe('closed history drawer', () => {
  it('lists the closed tabs newest first, with the title they were closed under', () => {
    setup(
      { a: { title: 'Alpha' }, b: { title: 'Beta' }, c: { title: 'Gamma' } },
      [
        { id: 'c', title: 'Gamma', closedAt: 30 },
        { id: 'a', title: 'Alpha', closedAt: 10 },
      ],
      ['b'],
    )
    openDrawer()

    expect(panel()?.getAttribute('role')).toBe('dialog')
    expect(historyRows().map(rowLabel)).toEqual(['Gamma', 'Alpha'])
    expect(historyRows()[0].disabled).toBe(false)
    // A live session gets its current title from the session list.
    expect(panel()?.textContent).not.toContain('No closed tabs yet')
  })

  it('reopens a session with one openSession call and no other side effect', () => {
    const { controller, storage, openSession } = setup(
      { a: { title: 'Alpha' } },
      [{ id: 'a', title: 'Alpha', closedAt: 10 }],
      [],
    )
    openDrawer()
    const writes = storage.writes
    const tabsBefore = controller.getSnapshot().tabs
    const closedBefore = controller.getSnapshot().closed

    click(historyRows()[0])

    expect(openSession).toHaveBeenCalledTimes(1)
    expect(openSession).toHaveBeenCalledWith('a')
    // Clicking is navigation only: neither collection is rewritten here. The
    // entry leaves the history when the strip records the opened session.
    expect(storage.writes).toBe(writes)
    expect(controller.getSnapshot().tabs).toBe(tabsBefore)
    expect(controller.getSnapshot().closed).toBe(closedBefore)
  })

  it('leaves a row whose session is gone listed, dimmed and disabled', () => {
    const { openSession } = setup({}, [{ id: 'gone', title: 'Deleted', closedAt: 10 }])
    openDrawer()

    const row = historyRows()[0]
    expect(rowLabel(row)).toBe('Deleted')
    expect(row.getAttribute('data-stale')).toBe('1')
    expect(row.disabled).toBe(true)
    click(row)
    expect(openSession).not.toHaveBeenCalled()
  })

  it('spells out the empty state', () => {
    setup({}, [])
    openDrawer()

    expect(historyRows()).toEqual([])
    expect(panel()?.textContent).toContain('还没有关过标签')
  })

  it('records a tab closed from the strip, and that row reopens it', () => {
    const { controller, openSession } = setup(
      { a: { title: 'Alpha' }, b: { title: 'Beta' } },
      [],
    )

    click(stripTab('Alpha').querySelector<HTMLElement>('button')!)

    expect(controller.getSnapshot().closed.map(row => row.id)).toEqual(['a'])
    openDrawer()
    expect(historyRows().map(rowLabel)).toEqual(['Alpha'])
    expect(stripTabs().map(node => node.querySelector('[class*="label"]')?.textContent))
      .toEqual(['Beta'])

    click(historyRows()[0])
    expect(openSession).toHaveBeenCalledWith('a')
  })

  it('closes on Escape and on a click outside', () => {
    setup({}, [{ id: 'a', title: 'Alpha', closedAt: 10 }])
    openDrawer()

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(isClosedHistoryOpen()).toBe(false)
    expect(panel()).toBeNull()

    openDrawer()
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(isClosedHistoryOpen()).toBe(false)
  })

  it('lets only one of the two drawers be open at a time', () => {
    setup({}, [{ id: 'a', title: 'Alpha', closedAt: 10 }])

    // Favorites first, then the history trigger: the first one gives way.
    act(() => { setFavoritesOpen(true) })
    expect(favoriteButton().getAttribute('aria-expanded')).toBe('true')

    click(historyButton())

    expect(isClosedHistoryOpen()).toBe(true)
    expect(isFavoritesOpen()).toBe(false)
    expect(historyButton().getAttribute('aria-expanded')).toBe('true')
    expect(favoriteButton().getAttribute('aria-expanded')).toBe('false')

    // And the other direction: the favorites trigger closes the drawer.
    click(favoriteButton())

    expect(isFavoritesOpen()).toBe(true)
    expect(isClosedHistoryOpen()).toBe(false)
    expect(panel()).toBeNull()
  })

  it('keeps the strip on screen while the drawer is open', () => {
    setup({}, [{ id: 'a', title: 'Alpha', closedAt: 10 }])
    // Only the plugin's own timer: React's scheduling stays real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const bar = (): HTMLElement | null => host.querySelector<HTMLElement>('[data-dsh-part="bar"]')

    openDrawer()
    expect(bar()?.getAttribute('data-open')).toBe('1')

    act(() => { setClosedHistoryOpen(false) })
    // Still up immediately after the close: the retract is the 260ms timer.
    expect(bar()?.getAttribute('data-open')).toBe('1')

    act(() => { vi.advanceTimersByTime(300) })
    expect(bar()?.getAttribute('data-open')).toBe('0')
  })
})
