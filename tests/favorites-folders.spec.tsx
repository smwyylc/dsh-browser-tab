/**
 * Favorites folders, the drawer's current-item dot, and the flat row rendering.
 *
 * The drawer reads everything through `ctx.get`, so doubling the Client services
 * is enough — the same fakes `tests/reorder.spec.tsx` uses. The tree is seeded
 * through `localStorage` rather than through the controller so the cases also
 * cover the parser: a folder payload has to come back as folders, not as rows.
 *
 * Rows are laid out flat (a folder's children follow it in the same list with a
 * deeper `data-depth`), so every assertion here works on row order and depth
 * instead of on a nested DOM tree.
 */
import { act, createElement, Fragment, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecentTabsController } from '../src/client/controller.ts'
import { RecentTabs } from '../src/client/RecentTabs.tsx'
import { FavoritesPanel } from '../src/client/FavoritesPanel.tsx'
import { setFavoritesOpen } from '../src/client/fav-drawer-state.ts'
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

/** jsdom has no DragEvent/DataTransfer: hand-roll one with a stub transfer. */
function dragEvent(type: string, target: HTMLElement, dataTransfer?: unknown): void {
  const event = new Event(type, { bubbles: true, cancelable: true })
  if (dataTransfer !== undefined) (event as { dataTransfer?: unknown }).dataTransfer = dataTransfer
  act(() => { target.dispatchEvent(event) })
}

const transferStub = { setData() {}, getData() { return '' }, effectAllowed: 'move', dropEffect: 'move' }

let host: HTMLDivElement
let root: Root

function render(element: ReactElement): void {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => { root.render(element) })
}

/**
 * Render the strip and the drawer over a seeded favorites tree.
 * @param rows - fake session rows.
 * @param favorites - the stored root layer, written straight to storage.
 * @param listed - ids the host list publishes; defaults to every row.
 */
function setup(rows: Record<string, FakeRow>, favorites: unknown[], listed?: string[]) {
  const visible = listed ?? Object.keys(rows)
  const storage = memoryStorage(JSON.stringify({
    tabs: visible.map(id => ({ id, title: rows[id].title ?? id })),
    favorites,
  }))
  const fake = fakeSessions(rows, listed)
  const controller = new RecentTabsController(storage)
  const ctx = fake.ctx as never
  render(createElement(
    Fragment,
    null,
    createElement(RecentTabs, { controller, ctx }),
    createElement(FavoritesPanel, { controller, ctx }),
  ))
  act(() => { setFavoritesOpen(true) })
  return { ...fake, storage, controller }
}

/** The drawer's own text, so assertions never read the strip by accident. */
function panelText(): string {
  return host.querySelector<HTMLElement>('[data-dsh-part="favorites"]')?.textContent ?? ''
}

/** Every bookmark row currently rendered, in display order. */
function favoriteItems(): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('[data-dsh-part="favItem"]'))
}

/** Every folder row currently rendered, in display order. */
function folderRows(): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('[data-dsh-part="favFolder"]'))
}

/** The visible label of one bookmark row. */
function favoriteLabel(node: HTMLElement): string {
  return node.querySelector('[class*="favItemLabel"]')?.textContent ?? ''
}

/** The visible name of one folder row (its cross is a button, not the label). */
function folderLabel(node: HTMLElement): string {
  return node.querySelector('[class*="favItemLabel"]')?.textContent ?? ''
}

/** A folder row by its name. */
function folderRow(title: string): HTMLElement {
  const found = folderRows().find(node => folderLabel(node) === title)
  if (found === undefined) throw new Error(`no folder named ${JSON.stringify(title)}`)
  return found
}

/** A bookmark row by its label text. */
function itemByText(title: string): HTMLElement {
  const found = favoriteItems().find(node => favoriteLabel(node) === title)
  if (found === undefined) throw new Error(`no favorite named ${JSON.stringify(title)}`)
  return found
}

/** Click one element the way a pointer would. */
function click(node: HTMLElement): void {
  act(() => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

/** Type into the inline editor and press one key. */
function typeInto(input: HTMLInputElement, value: string, key?: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  if (key === undefined) return
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // Both flags are module-level state: start every case closed and collapsed.
  setFavoritesOpen(false)
  resetFolderExpanded()
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
})

/** A root bookmark, a folder holding one bookmark and one sub-folder. */
const SEEDED_TREE = [
  { id: 's1', title: 'Alpha' },
  {
    id: 'f1',
    title: 'Work',
    children: [
      { id: 's2', title: 'Beta' },
      { id: 'f2', title: 'Nested', children: [{ id: 's3', title: 'Gamma' }] },
    ],
  },
]

describe('favorites folders', () => {
  it('renders the root layer flat and keeps a collapsed folder closed', () => {
    setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
      s3: { title: 'Gamma' },
    }, SEEDED_TREE)

    expect(favoriteItems().map(favoriteLabel)).toEqual(['Alpha'])
    expect(folderRows().map(folderLabel)).toEqual(['Work'])
    expect(folderRow('Work').getAttribute('aria-expanded')).toBe('false')
    // Nothing inside the folder is rendered while it is closed.
    expect(panelText()).not.toContain('Beta')
    expect(panelText()).not.toContain('Nested')
    // The panel is a tree, and each row is one of its items.
    expect(host.querySelector('[data-dsh-part="favorites"] [role="tree"]')).not.toBeNull()
    expect(folderRow('Work').getAttribute('role')).toBe('treeitem')
  })

  it('expands a folder in place, one level at a time, and collapses it again', () => {
    setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
      s3: { title: 'Gamma' },
    }, SEEDED_TREE)

    click(folderRow('Work'))

    expect(folderRow('Work').getAttribute('aria-expanded')).toBe('true')
    // The child bookmark and the nested folder follow the parent row.
    expect(favoriteItems().map(favoriteLabel)).toEqual(['Alpha', 'Beta'])
    expect(itemByText('Beta').getAttribute('data-depth')).toBe('1')
    expect(folderRow('Nested').getAttribute('data-depth')).toBe('1')
    // The second level stays closed until it is opened itself.
    expect(panelText()).not.toContain('Gamma')

    click(folderRow('Nested'))
    expect(itemByText('Gamma').getAttribute('data-depth')).toBe('2')

    click(folderRow('Work'))
    expect(favoriteItems().map(favoriteLabel)).toEqual(['Alpha'])
    expect(folderRows().map(folderLabel)).toEqual(['Work'])
  })

  it('files a bookmark into a folder by dropping it on the folder row', () => {
    const { controller, storage } = setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
      s3: { title: 'Gamma' },
    }, [
      { id: 's1', title: 'Alpha' },
      { id: 'f1', title: 'Work', children: [{ id: 's2', title: 'Beta' }] },
    ])

    const source = itemByText('Alpha')
    dragEvent('dragstart', source, transferStub)
    expect(source.getAttribute('data-dragging')).toBe('1')

    const target = folderRow('Work')
    dragEvent('dragover', target)
    // A folder is a destination, not an insertion edge.
    expect(target.getAttribute('data-drop-folder')).toBe('1')
    expect(target.getAttribute('data-drop')).toBeNull()

    dragEvent('drop', target)

    // Root layer keeps only the folder; the bookmark moved inside it.
    expect(controller.getSnapshot().favorites).toEqual([
      { id: 'f1', title: 'Work', children: [{ id: 's2', title: 'Beta' }, { id: 's1', title: 'Alpha' }] },
    ])
    const saved = JSON.parse(storage.value ?? 'null')
    expect(saved.favorites).toEqual([
      { id: 'f1', title: 'Work', children: [{ id: 's2', title: 'Beta' }, { id: 's1', title: 'Alpha' }] },
    ])
    // The folder opened itself so the move is visible, at the child's depth.
    expect(itemByText('Alpha').getAttribute('data-depth')).toBe('1')
    expect(favoriteItems().map(favoriteLabel)).toEqual(['Beta', 'Alpha'])
    // Filing a bookmark never switches sessions.
    expect(controller.getSnapshot().tabs.map(tab => tab.id)).toEqual(['s1', 's2', 's3'])
  })

  it('moves a folder into another layer by dropping it on a bookmark row', () => {
    const { controller } = setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
      s3: { title: 'Gamma' },
    }, [
      {
        id: 'f1',
        title: 'Work',
        children: [
          { id: 's2', title: 'Beta' },
          { id: 'f2', title: 'Nested', children: [{ id: 's3', title: 'Gamma' }] },
        ],
      },
      { id: 's1', title: 'Alpha' },
    ])

    click(folderRow('Work'))
    const source = folderRow('Nested')
    dragEvent('dragstart', source, transferStub)

    const target = itemByText('Alpha')
    dragEvent('dragover', target)
    expect(target.getAttribute('data-drop')).toBe('after')
    dragEvent('drop', target)

    // The nested folder left Work and became a sibling of the root bookmark.
    expect(controller.getSnapshot().favorites).toEqual([
      { id: 'f1', title: 'Work', children: [{ id: 's2', title: 'Beta' }] },
      { id: 's1', title: 'Alpha' },
      { id: 'f2', title: 'Nested', children: [{ id: 's3', title: 'Gamma' }] },
    ])
    expect(folderRow('Nested').getAttribute('data-depth')).toBe('0')
  })

  it('offers no landing spot for a bookmark dragged into another layer', () => {
    setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
      s3: { title: 'Gamma' },
    }, SEEDED_TREE)

    click(folderRow('Work'))
    const source = itemByText('Beta')
    dragEvent('dragstart', source, transferStub)

    // Alpha is a root row, Beta lives inside Work: an entry only reorders inside
    // its own layer, so the target must not light up.
    const target = itemByText('Alpha')
    dragEvent('dragover', target)
    expect(target.getAttribute('data-drop')).toBeNull()

    dragEvent('drop', target)
    expect(favoriteItems().map(favoriteLabel)).toEqual(['Alpha', 'Beta'])
  })

  it('renames a folder in place on double-click', () => {
    const { controller } = setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
      s3: { title: 'Gamma' },
    }, SEEDED_TREE)

    act(() => {
      folderRow('Work').querySelector('[class*="favItemLabel"]')!
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })

    const input = host.querySelector<HTMLInputElement>('input')
    expect(input).not.toBeNull()
    typeInto(input!, 'Docs', 'Enter')

    expect(host.querySelector('input')).toBeNull()
    expect(folderRows().map(folderLabel)).toEqual(['Docs'])
    expect(controller.getSnapshot().favorites[1]).toEqual({
      id: 'f1',
      title: 'Docs',
      children: [
        { id: 's2', title: 'Beta' },
        { id: 'f2', title: 'Nested', children: [{ id: 's3', title: 'Gamma' }] },
      ],
    })
  })

  it('cancels a folder rename on Escape', () => {
    const { controller } = setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
      s3: { title: 'Gamma' },
    }, SEEDED_TREE)

    act(() => {
      folderRow('Work').querySelector('[class*="favItemLabel"]')!
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    const input = host.querySelector<HTMLInputElement>('input')!
    typeInto(input, 'Discarded', 'Escape')

    expect(host.querySelector('input')).toBeNull()
    expect(folderRows().map(folderLabel)).toEqual(['Work'])
    expect(controller.getSnapshot().favorites[1]).toMatchObject({ title: 'Work' })
  })

  it('adds a root folder from the header button and opens the editor on it', () => {
    const { controller } = setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
      s3: { title: 'Gamma' },
    }, [{ id: 's1', title: 'Alpha' }])

    const button = host.querySelector<HTMLElement>('[data-dsh-part="favNewFolder"]')
    expect(button).not.toBeNull()
    click(button!)

    // A fresh, empty folder row with its name already selected for typing.
    const input = host.querySelector<HTMLInputElement>('input')
    expect(input).not.toBeNull()
    expect(input?.value).toBe('新文件夹')
    expect(folderRows()).toHaveLength(1)
    // It lands in the root layer, not inside a folder.
    expect(folderRows()[0].getAttribute('data-depth')).toBe('0')
    expect(folderRows()[0].getAttribute('aria-expanded')).toBe('false')

    typeInto(input!, 'Later', 'Enter')

    expect(host.querySelector('input')).toBeNull()
    expect(folderRows().map(folderLabel)).toEqual(['Later'])
    expect(controller.getSnapshot().favorites).toEqual([
      { id: 's1', title: 'Alpha' },
      { id: expect.any(String), title: 'Later', children: [] },
    ])
  })

  it('deletes a folder and everything inside it from the row cross', () => {
    const { controller } = setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
      s3: { title: 'Gamma' },
    }, SEEDED_TREE)

    const remove = folderRow('Work').querySelector<HTMLElement>('[data-dsh-part="favFolderRemove"]')
    expect(remove).not.toBeNull()
    click(remove!)

    expect(controller.getSnapshot().favorites).toEqual([{ id: 's1', title: 'Alpha' }])
    expect(folderRows()).toHaveLength(0)
    // The tab strip is a different collection: all three sessions stay.
    expect(controller.getSnapshot().tabs.map(tab => tab.id)).toEqual(['s1', 's2', 's3'])
  })
})

describe('current bookmark marker', () => {
  it('marks the open session with a green dot and leaves the others plain', () => {
    setup({
      s1: { title: 'Alpha', retainedBy: { mainView: 1 } },
      s2: { title: 'Beta' },
      s3: { title: 'Gamma' },
    }, SEEDED_TREE)

    const current = itemByText('Alpha')
    expect(current.getAttribute('aria-current')).toBe('true')
    expect(current.getAttribute('data-active')).toBe('1')
    // The dot is its own element, first in the row, before the star.
    const dot = current.querySelector('[data-dsh-part="favCurrent"]')
    expect(dot).not.toBeNull()
    expect(current.firstElementChild).toBe(dot)

    click(folderRow('Work'))
    const other = itemByText('Beta')
    expect(other.getAttribute('aria-current')).toBeNull()
    expect(other.getAttribute('data-active')).toBe('0')
    expect(other.querySelector('[data-dsh-part="favCurrent"]')).toBeNull()
  })

  it('keeps both markers when the current bookmark is stale', () => {
    // Retained and still selected, but no longer published by the host list:
    // the stale styling and the "you are here" dot have to coexist.
    setup(
      { s1: { title: 'Alpha', retainedBy: { mainView: 1 } } },
      [{ id: 's1', title: 'Alpha' }],
      [],
    )

    const row = itemByText('Alpha')
    expect(row.getAttribute('data-stale')).toBe('1')
    expect(row.getAttribute('aria-current')).toBe('true')
    expect(row.getAttribute('data-active')).toBe('1')
    expect(row.querySelector('[data-dsh-part="favCurrent"]')).not.toBeNull()
  })
})
