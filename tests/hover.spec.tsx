/**
 * The reveal / retract edge: what keeps the bar under the pointer.
 *
 * The bar sits ABOVE the hot zone (`recent-tabs.module.css`: `.bar` z-index
 * 2147483001, `.zone` 2147483000), so revealing it slides the bar down under a
 * stationary pointer. That fires the zone's `mouseleave` — the bar now covers
 * the pointer — while the bar's own `mouseenter` never fires, because the
 * pointer did not move. Without the DOM hit-test the bar retracted from under
 * the user's cursor shortly after appearing, every time.
 *
 * jsdom's `elementFromPoint` returns null, so every case stubs it: the DOM
 * question is the whole point of the fix and cannot be left to chance.
 *
 * React synthesizes `onMouseEnter` / `onMouseLeave` from `mouseover` /
 * `mouseout` at the root, so those are the events dispatched here; `onMouseMove`
 * is a plain native listener and takes `mousemove` directly.
 */
import { act, createElement, Fragment, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecentTabsController } from '../src/client/controller.ts'
import { RETRACT_MS, RecentTabs } from '../src/client/RecentTabs.tsx'
import { FavoritesPanel } from '../src/client/FavoritesPanel.tsx'
import { setFavoritesOpen } from '../src/client/fav-drawer-state.ts'
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

/** In-memory storage double that exposes the persisted text. */
function memoryStorage(initial?: string): TabStorage & { value: string | null } {
  const box = {
    value: initial ?? null,
    getItem(key: string) { return key === STORAGE_KEY ? box.value : null },
    setItem(key: string, value: string) { if (key === STORAGE_KEY) box.value = value },
  }
  return box
}

/**
 * Build a fake `sessions` service over mutable rows.
 * @param rows - session rows keyed by id, in host-list order.
 */
function fakeSessions(rows: Record<string, FakeRow>) {
  const ids = Object.keys(rows)
  const listeners = new Set<() => void>()
  const rename = vi.fn(async (title: string) => {
    const first = rows[ids[0]]
    if (first !== undefined) first.title = title
    return { ok: true as const, value: { title } }
  })
  const service: SessionsLike = {
    list: {
      getSnapshot: () => ({
        ids,
        byId: Object.fromEntries(ids.map(id => [id, rows[id] ?? {}])),
      }),
      subscribe(listener: () => void) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    binding: () => undefined,
    using: async <T,>(_target: string, _options: SessionRetainOptionsLike, operation: (reference: SessionReferenceLike) => T | Promise<T>): Promise<T> => {
      const reference: SessionReferenceLike = {
        binding: { session: { rename } },
        release: () => {},
      }
      return await operation(reference)
    },
  }
  const uiSession: UiSessionLike = {
    sessionStatus: {
      getSnapshot: () => ({}),
      subscribe: () => () => {},
    },
  }
  const uiWorkspace: UiWorkspaceLike = {
    openSession: vi.fn(),
    startSession: vi.fn(),
  }
  const ctx = {
    get(name: string) {
      if (name === 'sessions') return service
      if (name === 'uiSession') return uiSession
      if (name === 'uiWorkspace') return uiWorkspace
      return undefined
    },
  }
  return { ctx, service, uiWorkspace, rename, ids }
}

let host: HTMLDivElement
let root: Root | undefined

function render(element: ReactElement): void {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => { root!.render(element) })
}

/** Render the strip over a fake service and hand back the pieces under test. */
function setup(rows: Record<string, FakeRow>) {
  const fake = fakeSessions(rows)
  const storage = memoryStorage()
  const controller = new RecentTabsController(storage)
  const ctx = fake.ctx as never
  render(createElement(
    Fragment,
    null,
    createElement(RecentTabs, { controller, ctx }),
    createElement(FavoritesPanel, { controller, ctx }),
  ))
  return { ...fake, storage, controller }
}

beforeEach(() => {
  setFavoritesOpen(false)
})

afterEach(() => {
  act(() => { root?.unmount() })
  root = undefined
  host?.remove()
  vi.useRealTimers()
  const doc = document as unknown as { elementFromPoint?: unknown }
  delete doc.elementFromPoint
})

/** The strip's own bar container. */
function bar(): HTMLElement {
  const found = host.querySelector<HTMLElement>('[data-dsh-part="bar"]')
  if (found === null) throw new Error('no tab bar')
  return found
}

/** The full-width hot strip above the bar. */
function zone(): HTMLElement {
  const found = host.querySelector<HTMLElement>('[class*="zone"]')
  if (found === null) throw new Error('no hot zone')
  return found
}

/**
 * Make the DOM answer "who is at this point" with a fixed element.
 *
 * `elementFromPoint` is the seam the fix depends on: it is the only thing that
 * reports an element having moved under a still pointer. jsdom implements no
 * hit test at all — the property is absent, not null-returning — so it is
 * installed here rather than spied on, and removed again afterwards.
 */
function stubHitTest(hit: Element | null): void {
  const doc = document as unknown as { elementFromPoint?: (x: number, y: number) => Element | null }
  doc.elementFromPoint = () => hit
}

/** Whether the bar is held on screen right now. */
function isOpen(): boolean {
  return bar().getAttribute('data-open') === '1'
}

/** Reveal the bar the way a pointer entering the hot strip does. */
function enterZone(x = 400, y = 4): void {
  act(() => {
    zone().dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null, clientX: x, clientY: y }))
  })
}

/** Leave the hot strip, which is what the bar covering the pointer really is. */
function leaveZone(x = 400, y = 4): void {
  act(() => {
    zone().dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body, clientX: x, clientY: y }))
  })
}

/** Only the plugin's own timer runs on the clock; React scheduling stays real. */
function usePluginTimers(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
}

describe('the bar stays under the pointer', () => {
  it('does not retract when the bar has slid down over a still pointer', () => {
    setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })
    usePluginTimers()
    // The bar is parked: the pointer is on the zone, the bar is above the viewport.
    expect(isOpen()).toBe(false)

    // Reveal it. The bar slides down and now covers the pointer, which is what
    // the zone's mouseout below reports.
    stubHitTest(bar())
    enterZone()
    expect(isOpen()).toBe(true)

    act(() => { leaveZone() })
    // Well past the retract delay: the pointer is on the bar, so nothing may
    // retract.
    act(() => { vi.advanceTimersByTime(1000) })
    expect(isOpen()).toBe(true)
  })

  it('retracts as before when the pointer really left for elsewhere', () => {
    setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })
    usePluginTimers()
    stubHitTest(null)
    enterZone()
    expect(isOpen()).toBe(true)

    act(() => { leaveZone() })
    act(() => { vi.advanceTimersByTime(RETRACT_MS) })
    expect(isOpen()).toBe(false)
  })

  it('still retracts once the pointer has genuinely left the bar', () => {
    setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })
    usePluginTimers()
    // The bar first slides down over a still pointer, which is the case the
    // hit test exists for.
    stubHitTest(bar())
    enterZone()
    expect(isOpen()).toBe(true)
    act(() => { leaveZone() })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(isOpen()).toBe(true)

    // Now the pointer really leaves. The last hit test said "on the bar", and
    // a remembered coordinate asked again would say so too — the bar is still
    // on screen at that point — which is exactly why the retract must be
    // driven by the leave event and not re-tested against a stale position.
    stubHitTest(null)
    act(() => {
      bar().dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    })
    act(() => { vi.advanceTimersByTime(RETRACT_MS) })
    expect(isOpen()).toBe(false)
  })

  it('retracts as before when the hit test cannot say (elementFromPoint null)', () => {
    setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })
    usePluginTimers()
    // Reveal through the bar's own mouseenter rather than the zone, so the
    // zone's mouseleave path is not what is under test here.
    stubHitTest(null)
    enterZone()
    act(() => {
      bar().dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    })
    act(() => { vi.advanceTimersByTime(RETRACT_MS) })
    expect(isOpen()).toBe(false)
  })

  it('leaves a drawer holding the bar up untouched', () => {
    setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })
    usePluginTimers()
    stubHitTest(null)
    act(() => { setFavoritesOpen(true) })
    expect(isOpen()).toBe(true)

    act(() => { leaveZone() })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(isOpen()).toBe(true)
  })
})
