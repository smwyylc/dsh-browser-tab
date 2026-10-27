/**
 * Rename and navigation path tests. The editor is driven through the component,
 * so fakes stand in for the Client services and record their calls.
 *
 * The fakes model the dsh `0.1.6-alpha.2` contract: the session list carries no
 * `current` field (selection is `retainedBy.mainView`), navigation is
 * `uiWorkspace.openSession`, and all three turn facts arrive on the ui-session
 * status map — `running` for the spinner, `completionUnread` for the done mark,
 * `pendingInteraction` for the waiting question mark — see
 * `src/client/sessions-face.ts`.
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecentTabsController } from '../src/client/controller.ts'
import { RecentTabs } from '../src/client/RecentTabs.tsx'
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
  running?: boolean
  retainedBy?: { mainView?: number }
}

/** In-memory storage double. */
function memoryStorage(initial?: string): TabStorage {
  const box = { value: initial ?? null }
  return {
    getItem: (key: string) => (key === STORAGE_KEY ? box.value : null),
    setItem: (key: string, value: string) => { if (key === STORAGE_KEY) box.value = value },
  }
}

/**
 * Build a fake `sessions` service over mutable rows.
 * @param rows - session rows keyed by id, in host-list order.
 * @param status - optional per-session status map, seeded into `uiSession`.
 */
function fakeSessions(rows: Record<string, FakeRow>, status?: Map<string, SessionStatusLike>) {
  const ids = Object.keys(rows)
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of listeners) listener() }
  const rename = vi.fn(async (title: string) => {
    const first = rows[ids[0]]
    if (first !== undefined) first.title = title
    notify()
    return { ok: true as const, value: { title } }
  })
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
    // A plain (non-generic) double is enough for the strip's single call shape.
    using: using as unknown as SessionsLike['using'],
  }
  const statusListeners = new Set<() => void>()
  const uiSession: UiSessionLike = {
    sessionStatus: {
      getSnapshot: () => status ?? new Map<string, SessionStatusLike>(),
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
  return { ctx, service, rename, binding, using, openSession, notify, rows }
}

let host: HTMLDivElement
let root: Root

function render(element: ReactElement): void {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => { root.render(element) })
}

function tabs(): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('div[class*="tab"]')).filter(
    node => node.getAttribute('data-editing') !== '1',
  )
}

/** The rendered tab whose label text matches. */
function tabByText(text: string): HTMLElement {
  const found = tabs().find(node => (node.textContent ?? '').startsWith(text))
  if (found === undefined) throw new Error(`no tab containing ${JSON.stringify(text)}`)
  return found
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
})

describe('selection and navigation (0.1.6 contract)', () => {
  it('records the session the main view holds, read off retainedBy.mainView', () => {
    const { ctx } = fakeSessions({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
    })
    const controller = new RecentTabsController(memoryStorage())
    render(createElement(RecentTabs, { controller, ctx: ctx as never }))

    // No seeding: the strip itself must discover the current session.
    expect(controller.getSnapshot().tabs.map(tab => tab.id)).toEqual(['s1'])
    expect(tabByText('Alpha').getAttribute('data-active')).toBe('1')
  })

  it('records nothing while no session is selected', () => {
    const { ctx } = fakeSessions({ s1: { title: 'Alpha' } })
    const controller = new RecentTabsController(memoryStorage())
    render(createElement(RecentTabs, { controller, ctx: ctx as never }))

    expect(controller.getSnapshot().tabs).toEqual([])
  })

  it('switches through uiWorkspace.openSession, never sessions.open', () => {
    const { ctx, openSession } = fakeSessions({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
    })
    const controller = new RecentTabsController(memoryStorage())
    render(createElement(RecentTabs, { controller, ctx: ctx as never }))

    act(() => {
      controller.record('s1', 'Alpha')
      controller.record('s2', 'Beta')
    })
    act(() => { tabByText('Beta').dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(openSession).toHaveBeenCalledWith('s2')
  })

  it('hands the view to the MRU survivor when the active tab closes', () => {
    const { ctx, openSession } = fakeSessions({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
    })
    const controller = new RecentTabsController(memoryStorage())
    render(createElement(RecentTabs, { controller, ctx: ctx as never }))

    act(() => {
      controller.record('s1', 'Alpha')
      controller.record('s2', 'Beta')
    })
    const activeRow = tabByText('Alpha')
    act(() => {
      activeRow.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(openSession).toHaveBeenCalledWith('s2')
  })

  it('prefers displayTitle over the raw durable title', () => {
    const { ctx } = fakeSessions({
      s1: { title: 'fix the bug', displayTitle: 'recent-tabs', retainedBy: { mainView: 1 } },
    })
    const controller = new RecentTabsController(memoryStorage())
    render(createElement(RecentTabs, { controller, ctx: ctx as never }))

    expect(tabByText('recent-tabs')).not.toBeUndefined()
  })
})

describe('status indicators', () => {
  it('shows a running spinner on tabs whose agent is executing', () => {
    const { ctx } = fakeSessions({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta', running: true },
    })
    const controller = new RecentTabsController(memoryStorage())
    render(createElement(RecentTabs, { controller, ctx: ctx as never }))

    act(() => {
      controller.record('s1', 'Alpha')
      controller.record('s2', 'Beta')
    })

    expect(tabByText('Beta').querySelector('[class*="runSpinner"]')).not.toBeNull()
    expect(tabByText('Alpha').querySelector('[class*="runSpinner"]')).toBeNull()
  })

  it('leaves a settled turn with no marker when nothing is unread', () => {
    const status = new Map<string, SessionStatusLike>([
      ['s1', { running: false, completionUnread: false }],
      ['s2', { running: false, completionUnread: false }],
    ])
    const { ctx } = fakeSessions({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
    }, status)
    const controller = new RecentTabsController(memoryStorage())
    render(createElement(RecentTabs, { controller, ctx: ctx as never }))

    act(() => {
      controller.record('s1', 'Alpha')
      controller.record('s2', 'Beta')
    })

    // Both facts absent: the tab is plain apart from the active dot.
    expect(tabByText('Beta').querySelector('[class*="runSpinner"]')).toBeNull()
    expect(tabByText('Alpha').querySelector('[class*="runSpinner"]')).toBeNull()
    expect(tabByText('Beta').querySelector('[class*="doneMark"]')).toBeNull()
    expect(tabByText('Alpha').querySelector('[class*="doneMark"]')).toBeNull()
    // The third status is absent too: a settled turn asks nothing.
    expect(tabByText('Beta').querySelector('[class*="waitMark"]')).toBeNull()
    expect(tabByText('Alpha').querySelector('[class*="waitMark"]')).toBeNull()
  })

  it('marks a turn that finished unviewed with the static done mark', () => {
    const status = new Map<string, SessionStatusLike>([
      ['s1', { running: false }],
      ['s2', { running: false, completionUnread: true }],
    ])
    const { ctx } = fakeSessions({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
    }, status)
    const controller = new RecentTabsController(memoryStorage())
    render(createElement(RecentTabs, { controller, ctx: ctx as never }))

    act(() => {
      controller.record('s1', 'Alpha')
      controller.record('s2', 'Beta')
    })

    // Only the unread one carries it, and it is not a second spinner.
    expect(tabByText('Beta').querySelector('[class*="doneMark"]')).not.toBeNull()
    expect(tabByText('Beta').querySelector('[class*="runSpinner"]')).toBeNull()
    expect(tabByText('Alpha').querySelector('[class*="doneMark"]')).toBeNull()
  })

  it('gives the spinner precedence over the done mark while running again', () => {
    const status = new Map<string, SessionStatusLike>([
      ['s1', { running: false }],
      // A stale unread flag left over from the previous turn.
      ['s2', { running: true, completionUnread: true }],
    ])
    const { ctx } = fakeSessions({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
    }, status)
    const controller = new RecentTabsController(memoryStorage())
    render(createElement(RecentTabs, { controller, ctx: ctx as never }))

    act(() => {
      controller.record('s1', 'Alpha')
      controller.record('s2', 'Beta')
    })

    expect(tabByText('Beta').querySelector('[class*="runSpinner"]')).not.toBeNull()
    expect(tabByText('Beta').querySelector('[class*="doneMark"]')).toBeNull()
  })

  it('marks a session blocked on the user with the waiting mark, and only that session', () => {
    const status = new Map<string, SessionStatusLike>([
      ['s1', { running: false }],
      // Any kind parks on the same field: a question and a plan review both
      // mean "this turn cannot move until the user answers".
      ['s2', { running: false, pendingInteraction: { key: 'q1', kind: 'question', sessionId: 's2' } }],
    ])
    const { ctx } = fakeSessions({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
    }, status)
    const controller = new RecentTabsController(memoryStorage())
    render(createElement(RecentTabs, { controller, ctx: ctx as never }))

    act(() => {
      controller.record('s1', 'Alpha')
      controller.record('s2', 'Beta')
    })

    const mark = tabByText('Beta').querySelector('[class*="waitMark"]')
    expect(mark).not.toBeNull()
    // A third shape, not a second spinner or a second check.
    expect(tabByText('Beta').querySelector('[class*="runSpinner"]')).toBeNull()
    expect(tabByText('Beta').querySelector('[class*="doneMark"]')).toBeNull()
    // Its meaning reaches assistive tech, like the other two marks.
    expect(mark?.getAttribute('role')).toBe('img')
    expect(mark?.getAttribute('aria-label')).toBe('等待你的回复')
    expect(tabByText('Alpha').querySelector('[class*="waitMark"]')).toBeNull()
  })

  it('gives the waiting mark precedence over both turn facts', () => {
    const status = new Map<string, SessionStatusLike>([
      ['s1', { running: false }],
      // The shell may still call the turn running while it sits on a question,
      // and the unread flag from the previous turn can survive: the question is
      // the one fact the user has to act on, so it takes the single slot.
      ['s2', {
        running: true,
        completionUnread: true,
        pendingInteraction: { key: 'p1', kind: 'plan-review', sessionId: 's2' },
      }],
    ])
    const { ctx } = fakeSessions({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
    }, status)
    const controller = new RecentTabsController(memoryStorage())
    render(createElement(RecentTabs, { controller, ctx: ctx as never }))

    act(() => {
      controller.record('s1', 'Alpha')
      controller.record('s2', 'Beta')
    })

    expect(tabByText('Beta').querySelector('[class*="waitMark"]')).not.toBeNull()
    expect(tabByText('Beta').querySelector('[class*="runSpinner"]')).toBeNull()
    expect(tabByText('Beta').querySelector('[class*="doneMark"]')).toBeNull()
  })

  it('lets the live status override a stale row running flag', () => {
    const status = new Map<string, SessionStatusLike>([['s2', { running: false }]])
    const { ctx } = fakeSessions({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      // The row still says running, but the status source has already settled.
      s2: { title: 'Beta', running: true },
    }, status)
    const controller = new RecentTabsController(memoryStorage())
    render(createElement(RecentTabs, { controller, ctx: ctx as never }))

    act(() => {
      controller.record('s1', 'Alpha')
      controller.record('s2', 'Beta')
    })

    expect(tabByText('Beta').querySelector('[class*="runSpinner"]')).toBeNull()
  })
})

describe('tab rename', () => {
  it('opens an editor on double-click and renames the session on Enter', async () => {
    const { ctx, rename } = fakeSessions({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
    })
    const controller = new RecentTabsController(memoryStorage())
    render(createElement(RecentTabs, { controller, ctx: ctx as never }))

    act(() => { controller.record('s1', 'Alpha') })

    const first = tabs()[0]
    act(() => {
      first.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })

    const input = host.querySelector<HTMLInputElement>('input')
    expect(input).not.toBeNull()

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'Renamed')
      input!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await Promise.resolve()
    })

    expect(rename).toHaveBeenCalledWith('Renamed')
    expect(host.querySelector('input')).toBeNull()
  })

  it('borrows a generation through using() when nothing holds the binding', async () => {
    const { ctx, using, rename } = fakeSessions({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })
    // Model the 0.1.6 rule: binding() is undefined unless a generation is held.
    const ctxNoBinding = {
      get: (name: string) => {
        const value = (ctx as { get: (n: string) => unknown }).get(name)
        if (name === 'sessions' && value !== undefined) {
          return { ...(value as SessionsLike), binding: () => undefined }
        }
        return value
      },
    }
    const controller = new RecentTabsController(memoryStorage())
    render(createElement(RecentTabs, { controller, ctx: ctxNoBinding as never }))

    act(() => { controller.record('s1', 'Alpha') })
    act(() => { tabs()[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })

    const input = host.querySelector<HTMLInputElement>('input')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'Borrowed')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await Promise.resolve()
    })

    expect(using).toHaveBeenCalled()
    expect(rename).toHaveBeenCalledWith('Borrowed')
    // The transient hold must not masquerade as the main view's selection.
    expect(using.mock.calls[0][1]).toEqual({ source: 'recentTabsRename' })
  })

  it('cancels on Escape without calling rename', async () => {
    const { ctx, rename } = fakeSessions({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })
    const controller = new RecentTabsController(memoryStorage())
    render(createElement(RecentTabs, { controller, ctx: ctx as never }))

    act(() => { controller.record('s1', 'Alpha') })
    act(() => { tabs()[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })

    const input = host.querySelector<HTMLInputElement>('input')!
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await Promise.resolve()
    })

    expect(rename).not.toHaveBeenCalled()
    expect(host.querySelector('input')).toBeNull()
  })

  it('does not rename when the draft is unchanged', async () => {
    const { ctx, rename } = fakeSessions({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })
    const controller = new RecentTabsController(memoryStorage())
    render(createElement(RecentTabs, { controller, ctx: ctx as never }))

    act(() => { controller.record('s1', 'Alpha') })
    act(() => { tabs()[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })

    const input = host.querySelector<HTMLInputElement>('input')!
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await Promise.resolve()
    })

    expect(rename).not.toHaveBeenCalled()
  })

  it('commits on blur (clicking away)', async () => {
    const { ctx, rename } = fakeSessions({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })
    const controller = new RecentTabsController(memoryStorage())
    render(createElement(RecentTabs, { controller, ctx: ctx as never }))

    act(() => { controller.record('s1', 'Alpha') })
    act(() => { tabByText('Alpha').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })

    const input = host.querySelector<HTMLInputElement>('input')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'Blurred')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      // A real dismissal: blur() hands focus to <body> and jsdom raises the
      // native blur/focusout pair from there, which is the one route React's
      // onBlur listens to. Do not also dispatch a hand-made focusout - that
      // would commit the same draft twice.
      input.blur()
      await Promise.resolve()
    })

    expect(document.activeElement).not.toBe(input)
    expect(rename).toHaveBeenCalledTimes(1)
    expect(rename).toHaveBeenCalledWith('Blurred')
  })

  it('ignores a blur whose focus never left the editor', async () => {
    const { ctx, rename } = fakeSessions({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })
    const controller = new RecentTabsController(memoryStorage())
    render(createElement(RecentTabs, { controller, ctx: ctx as never }))

    act(() => { controller.record('s1', 'Alpha') })
    act(() => { tabByText('Alpha').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })

    const input = host.querySelector<HTMLInputElement>('input')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'Ghost')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      // The shell re-fires blur a few frames after focus lands, without moving
      // the caret: activeElement is still the editor, so this is the spurious
      // shape, not a dismissal. The editor must stay open and keep the name.
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      await Promise.resolve()
    })

    expect(document.activeElement).toBe(input)
    expect(rename).not.toHaveBeenCalled()
    expect(host.querySelector('input')).toBe(input)
  })

  it('ignores double-click on a session that is no longer listed', () => {
    const { ctx } = fakeSessions({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })
    const controller = new RecentTabsController(memoryStorage())
    render(createElement(RecentTabs, { controller, ctx: ctx as never }))

    // Retained but absent from the live list -> stale, not renamable.
    act(() => { controller.record('gone', 'Gone') })
    const stale = tabByText('Gone')
    expect(stale.getAttribute('data-stale')).toBe('1')

    act(() => { stale.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })

    expect(host.querySelector('input')).toBeNull()
  })
})
