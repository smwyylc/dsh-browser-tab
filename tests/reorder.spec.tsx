/**
 * Drag-to-reorder, tab context menu, and favorites drawer tests.
 *
 * jsdom ships neither `DragEvent` nor `DataTransfer`, so the drag path is
 * driven with plain bubbling Events plus a hand-rolled transfer stub; both
 * surfaces keep the source id in a ref precisely so they do not depend on that
 * stub. The fakes mirror `tests/rename.spec.tsx`: every surface reads its data
 * through `ctx.get`, so doubling the Client services is enough.
 *
 * Favorites have two surfaces: the trigger at the right end of the bar (rendered
 * by the strip) and the drawer. So every case mounts the two pieces the plugin
 * registers (strip + drawer) and drives them through their `data-dsh-part`
 * attributes; the trigger is reached inside the bar, which is the point.
 */
import { act, createElement, Fragment, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecentTabsController } from '../src/client/controller.ts'
import { RecentTabs } from '../src/client/RecentTabs.tsx'
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
  return { ctx, service, rename, openSession }
}

/** jsdom has no DragEvent/DataTransfer: hand-roll one with a stub transfer. */
function dragEvent(type: string, target: HTMLElement, dataTransfer?: unknown): void {
  const event = new Event(type, { bubbles: true, cancelable: true })
  if (dataTransfer !== undefined) (event as { dataTransfer?: unknown }).dataTransfer = dataTransfer
  act(() => { target.dispatchEvent(event) })
}

const transferStub = { setData() {}, getData() { return '' }, effectAllowed: 'move', dropEffect: 'move' }

/**
 * Dispatch a `wheel` on one element.
 *
 * jsdom's `WheelEvent` constructor is not something this suite can count on, so
 * the three delta fields are written onto a plain cancelable Event, the same way
 * the drag helper above supplies its own `dataTransfer`. Returns whether the
 * event was cancelled: the page must not scroll, so `true` is the pass.
 * @param target - element the wheel happens over.
 * @param init - deltas, plus the unit they are counted in and the modifier.
 */
function wheelEvent(
  target: HTMLElement,
  init: { deltaY: number; deltaX?: number; deltaMode?: number; ctrlKey?: boolean },
): boolean {
  const event = new Event('wheel', { bubbles: true, cancelable: true })
  const fields = event as unknown as {
    deltaX: number
    deltaY: number
    deltaMode: number
    ctrlKey: boolean
  }
  fields.deltaX = init.deltaX ?? 0
  fields.deltaY = init.deltaY
  fields.deltaMode = init.deltaMode ?? 0
  fields.ctrlKey = init.ctrlKey ?? false
  act(() => { target.dispatchEvent(event) })
  return event.defaultPrevented
}

/**
 * jsdom never lays anything out, so a real `scrollLeft` neither reads back nor
 * accumulates. Shadow it on the element with a plain number the handler can
 * write to, which is otherwise exactly the property a browser exposes.
 * @param node - element whose `scrollLeft` should become readable.
 */
function scrollCell(node: HTMLElement): () => number {
  let value = 0
  Object.defineProperty(node, 'scrollLeft', {
    configurable: true,
    get: () => value,
    set: (next: number) => { value = next },
  })
  return () => value
}

let host: HTMLDivElement
let root: Root

function render(element: ReactElement): void {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => { root.render(element) })
}

/** Render the strip over a fake service and hand back the pieces under test. */
function setup(rows: Record<string, FakeRow>) {
  const fake = fakeSessions(rows)
  const storage = memoryStorage()
  const controller = new RecentTabsController(storage)
  const ctx = fake.ctx as never
  // The two registrations the plugin makes, side by side as in the shell. The
  // favorites trigger is not one of them: the strip renders it itself.
  render(createElement(
    Fragment,
    null,
    createElement(RecentTabs, { controller, ctx }),
    createElement(FavoritesPanel, { controller, ctx }),
  ))
  return { ...fake, storage, controller }
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

/** The strip's own bar container. */
function bar(): HTMLElement {
  const found = host.querySelector<HTMLElement>('[data-dsh-part="bar"]')
  if (found === null) throw new Error('no tab bar')
  return found
}

/** The favorites trigger at the right end of the bar. */
function button(): HTMLElement {
  const found = host.querySelector<HTMLElement>('[data-dsh-part="favorite-button"]')
  if (found === null) throw new Error('no favorite button')
  return found
}

/** The scrolling tab row inside the bar. */
function stripRow(): HTMLElement {
  const found = bar().querySelector<HTMLElement>('[class*="stripRow"]')
  if (found === null) throw new Error('no strip row')
  return found
}

/** The drawer, or null while it is closed. */
function panel(): HTMLElement | null {
  return host.querySelector<HTMLElement>('[data-dsh-part="favorites"]')
}

/** The drawer's pin-the-current-session star, or null when it declines to render. */
function star(): HTMLElement | null {
  return host.querySelector<HTMLElement>('[data-dsh-part="favorite-star"]')
}

/** The open tab context menu, or null. */
function menu(): HTMLElement | null {
  return host.querySelector<HTMLElement>('[data-dsh-part="tab-menu"]')
}

/** The single item of that menu. */
function menuItem(): HTMLElement | null {
  return host.querySelector<HTMLElement>('[data-dsh-part="tab-menu-favorite"]')
}

/** The favorite entries rendered in the drawer, in stored order. */
function favoriteItems(): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('[data-dsh-part="favItem"]'))
}

/** The visible label of one favorite entry. */
function favoriteLabel(node: HTMLElement): string {
  return node.querySelector('[class*="favItemLabel"]')?.textContent ?? ''
}

/** Open the drawer through the shared state the button also drives. */
function openDrawer(): void {
  act(() => { setFavoritesOpen(true) })
}

/** Open the tab context menu on one tab. */
function openMenuOn(text: string): void {
  act(() => {
    tabByText(text).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // The drawer flag is module-level state: start every case closed.
  setFavoritesOpen(false)
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  // A case may have installed fake timers for the hide delay.
  vi.useRealTimers()
})

describe('drag to reorder', () => {
  it('reorders the strip and persists it without switching sessions', () => {
    const { controller, storage, openSession } = setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
      s3: { title: 'Gamma' },
    })
    act(() => {
      controller.record('s2', 'Beta')
      controller.record('s3', 'Gamma')
    })
    // Strip order: Alpha, Beta, Gamma.
    const source = tabByText('Alpha')
    const target = tabByText('Beta')

    dragEvent('dragstart', source, transferStub)
    expect(source.getAttribute('data-dragging')).toBe('1')

    dragEvent('dragover', target)
    // jsdom returns a zero-size rect, so the pointer sits in the right half.
    expect(target.getAttribute('data-drop')).toBe('after')

    dragEvent('drop', target)

    expect(controller.getSnapshot().tabs.map(tab => tab.id)).toEqual(['s2', 's1', 's3'])
    const saved = JSON.parse(storage.value ?? 'null')
    expect(saved.tabs.map((tab: { id: string }) => tab.id)).toEqual(['s2', 's1', 's3'])
    // A tab drag never creates or drops a bookmark.
    expect(saved.favorites).toEqual([])
    expect(openSession).not.toHaveBeenCalled()
  })

  it('clears the drag state on dragend and never reorders on a self drop', () => {
    const { controller } = setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
    })
    act(() => { controller.record('s2', 'Beta') })
    const before = controller.getSnapshot()
    const source = tabByText('Alpha')

    dragEvent('dragstart', source, transferStub)
    dragEvent('dragover', source)
    dragEvent('drop', source)
    dragEvent('dragend', source)

    expect(source.getAttribute('data-dragging')).toBe('0')
    expect(source.getAttribute('data-drop')).toBeNull()
    expect(controller.getSnapshot()).toBe(before)
  })
})

describe('strip tabs', () => {
  it('closes the tab through the first button, not the star', () => {
    const { controller, openSession } = setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
    })
    act(() => { controller.record('s2', 'Beta') })

    act(() => {
      tabByText('Alpha').querySelector('button')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(controller.getSnapshot().tabs.map(tab => tab.id)).toEqual(['s2'])
    // Alpha was the active tab, so the view falls back to Beta.
    expect(openSession).toHaveBeenCalledWith('s2')
  })

  it('carries no favorite control of its own', () => {
    setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })

    expect(tabByText('Alpha').querySelectorAll('button')).toHaveLength(1)
    expect(tabByText('Alpha').hasAttribute('data-favorite')).toBe(false)
  })

  it('keeps the bookmark when the tab is closed from the strip', () => {
    const { controller, storage } = setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
    })
    act(() => { controller.record('s2', 'Beta') })
    act(() => { controller.toggleFavorite('s1', 'Alpha') })
    openDrawer()
    expect(favoriteItems().map(favoriteLabel)).toEqual(['Alpha'])

    act(() => {
      tabByText('Alpha').querySelector('button')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // The tab is gone; the bookmark is not, and the drawer still lists it.
    expect(controller.getSnapshot().tabs.map(tab => tab.id)).toEqual(['s2'])
    expect(controller.getSnapshot().favorites).toEqual([{ id: 's1', title: 'Alpha' }])
    expect(favoriteItems().map(favoriteLabel)).toEqual(['Alpha'])
    const saved = JSON.parse(storage.value ?? 'null')
    expect(saved.tabs.map((tab: { id: string }) => tab.id)).toEqual(['s2'])
    expect(saved.favorites).toEqual([{ id: 's1', title: 'Alpha' }])
  })

  it('seats the favorite trigger at the right end of the bar, outside the scrolling row', () => {
    setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })

    // The bar is the tab row plus the trigger, and the trigger comes last.
    expect(bar().children).toHaveLength(2)
    expect(bar().lastElementChild).toBe(button())
    // It must not scroll away with the tabs, so it is not inside the row.
    expect(stripRow().contains(button())).toBe(false)
    expect(stripRow().nextElementSibling).toBe(button())
    // Placement moved; the contract did not.
    expect(button().getAttribute('data-dsh-part')).toBe('favorite-button')
    expect(button().getAttribute('aria-haspopup')).toBe('dialog')
    expect(button().getAttribute('aria-expanded')).toBe('false')
    // The drawer stays a sibling of the strip, never a child of the bar.
    expect(bar().querySelectorAll('[data-dsh-part="favorites"]')).toHaveLength(0)
    expect(bar().querySelector('[data-dsh-part="favorite-star"]')).toBeNull()
    // No tab row is mistaken for the trigger or the other way round.
    expect(tabByText('Alpha').querySelectorAll('[data-dsh-part="favorite-button"]')).toHaveLength(0)
  })

  it('pins the bar on screen while the drawer is open, then resumes the 260ms hide', () => {
    setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })
    // Only the plugin's own timer: React's scheduling stays real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    // Parked: the trigger rectangle is above the viewport, so the drawer would
    // otherwise be anchored off-screen.
    expect(bar().getAttribute('data-open')).toBe('0')

    openDrawer()
    expect(bar().getAttribute('data-open')).toBe('1')

    // A hide scheduled while the drawer is open must not retract the bar.
    act(() => {
      bar().dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    })
    act(() => { vi.advanceTimersByTime(400) })
    expect(bar().getAttribute('data-open')).toBe('1')

    // Closing the drawer hands the bar back to the ordinary timer: still up
    // right after the close, gone once the 260ms have run.
    act(() => { setFavoritesOpen(false) })
    expect(bar().getAttribute('data-open')).toBe('1')
    act(() => { vi.advanceTimersByTime(260) })
    expect(bar().getAttribute('data-open')).toBe('0')
  })
})

describe('wheel scrolls the strip', () => {
  it('turns a plain vertical wheel into horizontal travel and swallows the page scroll', () => {
    setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })
    const scrolled = scrollCell(stripRow())

    expect(wheelEvent(stripRow(), { deltaY: 100 })).toBe(true)
    expect(scrolled()).toBe(100)

    // Two more notches accumulate rather than replace: 100 + 100 + 40.
    wheelEvent(stripRow(), { deltaY: 100 })
    wheelEvent(stripRow(), { deltaY: 40 })
    expect(scrolled()).toBe(240)
  })

  it('folds deltaX in and converts line and page deltas to pixels', () => {
    setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })
    const row = stripRow()
    const scrolled = scrollCell(row)
    // jsdom reports a zero width, so give the row one: page mode needs it.
    Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => 320 })

    wheelEvent(row, { deltaY: 100, deltaX: 20 })
    expect(scrolled()).toBe(120)

    // deltaMode 1 counts lines at 16px: 3 lines = 48px.
    wheelEvent(row, { deltaY: 3, deltaMode: 1 })
    expect(scrolled()).toBe(168)

    // deltaMode 2 counts pages: one page is the row's own width.
    wheelEvent(row, { deltaY: 1, deltaMode: 2 })
    expect(scrolled()).toBe(488)
  })

  it('binds the row only, leaving the trigger and the rest of the bar alone', () => {
    setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })
    const scrolled = scrollCell(stripRow())

    // The trigger is in the bar but outside the scrolling row.
    expect(wheelEvent(button(), { deltaY: 100 })).toBe(false)
    // Nor does the bar itself carry the handler.
    expect(wheelEvent(bar(), { deltaY: 100 })).toBe(false)
    expect(scrolled()).toBe(0)
  })

  it('leaves a pure horizontal wheel and a ctrl-held pinch to the browser', () => {
    setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })
    const scrolled = scrollCell(stripRow())

    // A trackpad sideways gesture already scrolls the row natively.
    expect(wheelEvent(stripRow(), { deltaY: 0, deltaX: 40 })).toBe(false)
    expect(scrolled()).toBe(0)

    // Pinch zoom arrives as a ctrl-held wheel: it must not become scrolling.
    expect(wheelEvent(stripRow(), { deltaY: 100, ctrlKey: true })).toBe(false)
    expect(scrolled()).toBe(0)
  })
})

describe('tab context menu', () => {
  it('opens on right-click and closes on a click outside', () => {
    setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })

    expect(menu()).toBeNull()
    openMenuOn('Alpha')

    const opened = menu()
    expect(opened).not.toBeNull()
    expect(opened?.getAttribute('role')).toBe('menu')
    expect(menuItem()?.getAttribute('role')).toBe('menuitem')
    expect(menuItem()?.textContent).toBe('收藏')

    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(menu()).toBeNull()
  })

  it('closes on Escape and on any scroll', () => {
    setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })

    openMenuOn('Alpha')
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(menu()).toBeNull()

    openMenuOn('Alpha')
    act(() => { window.dispatchEvent(new Event('scroll')) })
    expect(menu()).toBeNull()
  })

  it('pins the tab from the menu and flips the item to unpin', () => {
    const { controller, storage, openSession } = setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
    })
    act(() => { controller.record('s2', 'Beta') })

    openMenuOn('Beta')
    act(() => { menuItem()!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    // Beta is bookmarked, the tab list is untouched, and the menu closed itself.
    expect(controller.getSnapshot().tabs).toEqual([
      { id: 's1', title: 'Alpha' },
      { id: 's2', title: 'Beta' },
    ])
    expect(controller.getSnapshot().favorites).toEqual([{ id: 's2', title: 'Beta' }])
    expect(JSON.parse(storage.value ?? 'null')).toEqual({
      tabs: [
        { id: 's1', title: 'Alpha' },
        { id: 's2', title: 'Beta' },
      ],
      favorites: [{ id: 's2', title: 'Beta' }],
    })
    expect(menu()).toBeNull()
    // Favoriting a tab never switches sessions.
    expect(openSession).not.toHaveBeenCalled()

    // Re-opened on the same tab, the item now offers the opposite action.
    openMenuOn('Beta')
    expect(menuItem()?.textContent).toBe('取消收藏')
    act(() => { menuItem()!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(controller.getSnapshot().tabs).toEqual([
      { id: 's1', title: 'Alpha' },
      { id: 's2', title: 'Beta' },
    ])
    expect(controller.getSnapshot().favorites).toEqual([])
    expect(JSON.parse(storage.value ?? 'null')).toEqual({
      tabs: [
        { id: 's1', title: 'Alpha' },
        { id: 's2', title: 'Beta' },
      ],
      favorites: [],
    })
  })
})

describe('favorites drawer', () => {
  it('stays closed until the bar button opens it, and the button closes it again', () => {
    setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })

    expect(panel()).toBeNull()
    expect(button().getAttribute('aria-haspopup')).toBe('dialog')
    expect(button().getAttribute('aria-expanded')).toBe('false')

    act(() => { button().dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    const opened = panel()
    expect(opened).not.toBeNull()
    expect(button().getAttribute('aria-expanded')).toBe('true')
    expect(opened?.getAttribute('role')).toBe('dialog')
    expect(opened?.getAttribute('aria-label')).toBe('收藏夹')
    expect(opened?.getAttribute('aria-modal')).toBe('false')

    act(() => { button().dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(panel()).toBeNull()
    expect(button().getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on Escape and on a click outside the drawer', () => {
    setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })

    openDrawer()
    expect(panel()).not.toBeNull()
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(panel()).toBeNull()

    openDrawer()
    expect(panel()).not.toBeNull()
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(panel()).toBeNull()
  })

  it('clamps the drawer top into the viewport when the trigger is not on screen', () => {
    setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })

    openDrawer()

    // jsdom boxes are all zero, which is exactly the off-screen case: the raw
    // `rect.bottom + 6` would be 6px, so the drawer would sit above the edge.
    expect(panel()?.style.top).toBe('8px')
  })

  it('names both entry points in the empty state', () => {
    setup({ s1: { title: 'Alpha', retainedBy: { mainView: 1 } } })

    openDrawer()
    const text = panel()?.textContent ?? ''

    expect(text).toContain('星标')
    expect(text).toContain('右键')
    expect(favoriteItems()).toHaveLength(0)
  })

  it('pins the current session from the drawer star and persists it', () => {
    const { controller, storage, openSession } = setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
    })
    openDrawer()

    expect(star()?.getAttribute('aria-pressed')).toBe('false')

    act(() => { star()?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(star()?.getAttribute('aria-pressed')).toBe('true')
    // The bookmark carries the title shown at pin time; the tab row keeps none.
    expect(controller.getSnapshot().tabs).toEqual([{ id: 's1', title: 'Alpha' }])
    expect(controller.getSnapshot().favorites).toEqual([{ id: 's1', title: 'Alpha' }])
    expect(JSON.parse(storage.value ?? 'null')).toEqual({
      tabs: [{ id: 's1', title: 'Alpha' }],
      favorites: [{ id: 's1', title: 'Alpha' }],
    })
    expect(favoriteItems().map(favoriteLabel)).toEqual(['Alpha'])
    expect(openSession).not.toHaveBeenCalled()

    act(() => { star()?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(star()?.getAttribute('aria-pressed')).toBe('false')
    expect(controller.getSnapshot().tabs).toEqual([{ id: 's1', title: 'Alpha' }])
    expect(controller.getSnapshot().favorites).toEqual([])
    expect(JSON.parse(storage.value ?? 'null')).toEqual({
      tabs: [{ id: 's1', title: 'Alpha' }],
      favorites: [],
    })
    expect(favoriteItems()).toHaveLength(0)
  })

  it('renders no star without a current session, but keeps the drawer and its empty state', () => {
    setup({ s1: { title: 'Alpha' } })

    openDrawer()

    expect(panel()).not.toBeNull()
    expect(star()).toBeNull()
    expect(panel()?.textContent).toContain('星标')
    expect(favoriteItems()).toHaveLength(0)
  })

  it('lists favorites in stored order with live titles', () => {
    const { controller } = setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'fix the bug', displayTitle: 'Project Beta' },
    })
    act(() => {
      controller.record('s1', 'Alpha')
      controller.record('s2', 'Beta')
      // Retained but no longer listed: the pin outlives the session.
      controller.record('gone', 'Gone')
      controller.toggleFavorite('s1', 'Alpha')
      controller.toggleFavorite('s2', 'Beta')
      controller.toggleFavorite('gone', 'Gone')
    })
    openDrawer()

    const items = favoriteItems()
    expect(items).toHaveLength(3)
    // displayTitle wins over the raw title; the stale row keeps its stored name.
    expect(items.map(favoriteLabel)).toEqual(['Alpha', 'Project Beta', 'Gone'])
    expect(items[0].getAttribute('data-active')).toBe('1')
    expect(items[1].getAttribute('data-active')).toBe('0')
    expect(items[0].getAttribute('data-stale')).toBe('0')
    expect(items[2].getAttribute('data-stale')).toBe('1')
  })

  it('switches to a favorite that is not in view', () => {
    const { controller, openSession } = setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
    })
    act(() => {
      controller.record('s2', 'Beta')
      controller.toggleFavorite('s1', 'Alpha')
      controller.toggleFavorite('s2', 'Beta')
    })
    openDrawer()

    act(() => { favoriteItems()[1].dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    // switchTo, not a direct openSession: only the non-current row navigates.
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(openSession).toHaveBeenCalledWith('s2')
  })

  it('does not re-open the session already in view', () => {
    const { controller, openSession } = setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
    })
    act(() => { controller.toggleFavorite('s1', 'Alpha') })
    openDrawer()

    act(() => { favoriteItems()[0].dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(openSession).not.toHaveBeenCalled()
  })

  it('reorders favorites by vertical drag without opening a session', () => {
    const { controller, storage, openSession } = setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
    })
    act(() => {
      controller.record('s1', 'Alpha')
      controller.record('s2', 'Beta')
      controller.toggleFavorite('s1', 'Alpha')
      controller.toggleFavorite('s2', 'Beta')
    })
    openDrawer()

    const [source, target] = favoriteItems()
    dragEvent('dragstart', source, transferStub)
    expect(source.getAttribute('data-dragging')).toBe('1')

    dragEvent('dragover', target)
    // jsdom returns a zero-size rect, so the pointer sits below the midpoint.
    expect(target.getAttribute('data-drop')).toBe('after')

    dragEvent('drop', target)

    // Only the favorites collection moves; the strip keeps its own order.
    expect(controller.getSnapshot().favorites.map(entry => entry.id)).toEqual(['s2', 's1'])
    expect(controller.getSnapshot().tabs.map(tab => tab.id)).toEqual(['s1', 's2'])
    const saved = JSON.parse(storage.value ?? 'null')
    expect(saved.favorites.map((entry: { id: string }) => entry.id)).toEqual(['s2', 's1'])
    expect(saved.tabs.map((tab: { id: string }) => tab.id)).toEqual(['s1', 's2'])
    expect(openSession).not.toHaveBeenCalled()
  })

  it('removes only the bookmark through the inline remove button', () => {
    const { controller, storage, openSession } = setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
    })
    act(() => {
      controller.record('s2', 'Beta')
      controller.toggleFavorite('s1', 'Alpha')
      controller.toggleFavorite('s2', 'Beta')
    })
    openDrawer()

    act(() => {
      favoriteItems()[0].querySelector<HTMLElement>('[data-dsh-part="favRemove"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(controller.getSnapshot().favorites).toEqual([{ id: 's2', title: 'Beta' }])
    // Unpinning is not closing: both tabs are still in the strip.
    expect(controller.getSnapshot().tabs).toEqual([
      { id: 's1', title: 'Alpha' },
      { id: 's2', title: 'Beta' },
    ])
    expect(favoriteItems().map(favoriteLabel)).toEqual(['Beta'])
    expect(tabByText('Alpha')).not.toBeUndefined()
    const saved = JSON.parse(storage.value ?? 'null')
    expect(saved.favorites).toEqual([{ id: 's2', title: 'Beta' }])
    expect(saved.tabs.map((tab: { id: string }) => tab.id)).toEqual(['s1', 's2'])
    // The remove button must not bubble into the entry's open handler.
    expect(openSession).not.toHaveBeenCalled()
  })
})
