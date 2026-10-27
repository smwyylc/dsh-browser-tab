import { describe, expect, it, vi } from 'vitest'
import { RecentTabsController } from '../src/client/controller.ts'
import { STORAGE_KEY, type TabStorage } from '../src/client/store.ts'

/** Minimal in-memory storage double that counts canonical-key writes. */
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

/** The persisted record, parsed, for shape assertions. */
function persisted(storage: { value: string | null }): {
  tabs: { id: string }[]
  favorites: { id: string; title: string }[]
} {
  return JSON.parse(storage.value ?? 'null')
}

describe('RecentTabsController', () => {
  it('starts empty when nothing is stored', () => {
    const controller = new RecentTabsController(memoryStorage())
    expect(controller.getSnapshot().tabs).toEqual([])
    expect(controller.getSnapshot().favorites).toEqual([])
    expect(controller.getSnapshot().order).toEqual([])
  })

  it('adopts the stored ledger on construction without rewriting it', () => {
    const storage = memoryStorage(JSON.stringify({
      tabs: [{ id: 'a', title: 'Alpha' }],
      favorites: [{ id: 'b', title: 'Beta' }],
    }))
    const controller = new RecentTabsController(storage)
    expect(controller.getSnapshot().tabs).toEqual([{ id: 'a', title: 'Alpha' }])
    expect(controller.getSnapshot().favorites).toEqual([{ id: 'b', title: 'Beta' }])
    expect(storage.writes).toBe(0)
  })

  it('adopts a legacy payload through the migration', () => {
    const storage = memoryStorage(JSON.stringify([
      { id: 'a', title: 'Alpha' },
      { id: 'b', title: 'Beta', favorite: true },
    ]))
    const controller = new RecentTabsController(storage)

    // The flagged row is a bookmark AND still a tab: it must not vanish from
    // the strip just because it was pinned in the legacy shape.
    expect(controller.getSnapshot().tabs).toEqual([
      { id: 'a', title: 'Alpha' },
      { id: 'b', title: 'Beta' },
    ])
    expect(controller.getSnapshot().favorites).toEqual([{ id: 'b', title: 'Beta' }])
    // The rewrite landed in the record shape, not the legacy array.
    expect(persisted(storage)).toEqual({
      tabs: [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }],
      favorites: [{ id: 'b', title: 'Beta' }],
    })
  })

  it('notifies subscribers and persists on a real change', () => {
    const storage = memoryStorage()
    const controller = new RecentTabsController(storage)
    const listener = vi.fn()
    controller.subscribe(listener)

    controller.record('a', 'Alpha')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(storage.writes).toBe(1)
    expect(persisted(storage)).toEqual({ tabs: [{ id: 'a', title: 'Alpha' }], favorites: [] })
  })

  it('does NOT notify or persist when the observation changes nothing', () => {
    const storage = memoryStorage()
    const controller = new RecentTabsController(storage)
    controller.record('a', 'Alpha')

    const listener = vi.fn()
    controller.subscribe(listener)
    const before = controller.getSnapshot()
    const writesBefore = storage.writes

    // The rapid-switch path: the same session recorded again must be inert.
    controller.record('a', 'Alpha')

    expect(listener).not.toHaveBeenCalled()
    expect(storage.writes).toBe(writesBefore)
    expect(controller.getSnapshot()).toBe(before)
  })

  it('keeps a stable snapshot reference until a change lands', () => {
    const controller = new RecentTabsController(memoryStorage())
    const first = controller.getSnapshot()
    expect(controller.getSnapshot()).toBe(first)
    controller.record('a', 'Alpha')
    expect(controller.getSnapshot()).not.toBe(first)
  })

  it('removes a tab, persists it, and returns the MRU survivor', () => {
    const storage = memoryStorage()
    const controller = new RecentTabsController(storage)
    controller.record('a', 'Alpha')
    controller.record('b', 'Beta')
    controller.record('c', 'Gamma')

    // Activation history: c, b, a. Closing c must hand the view to b.
    const next = controller.remove('c')

    expect(next).toBe('b')
    expect(controller.getSnapshot().tabs.map(tab => tab.id)).toEqual(['a', 'b'])
    expect(persisted(storage).tabs.map(tab => tab.id)).toEqual(['a', 'b'])
  })

  it('keeps the bookmark when its tab is closed', () => {
    const storage = memoryStorage()
    const controller = new RecentTabsController(storage)
    controller.record('a', 'Alpha')
    controller.record('b', 'Beta')
    controller.toggleFavorite('a', 'Alpha')

    const next = controller.remove('a')

    expect(next).toBe('b')
    expect(controller.getSnapshot().tabs.map(tab => tab.id)).toEqual(['b'])
    // Closing a tab is not closing a bookmark.
    expect(controller.getSnapshot().favorites).toEqual([{ id: 'a', title: 'Alpha' }])
    expect(persisted(storage)).toEqual({
      tabs: [{ id: 'b', title: 'Beta' }],
      favorites: [{ id: 'a', title: 'Alpha' }],
    })
    // The bookmark survives a reload of the same storage.
    expect(new RecentTabsController(storage).getSnapshot().favorites).toEqual([
      { id: 'a', title: 'Alpha' },
    ])
  })

  it('returns undefined when closing an unretained id', () => {
    const controller = new RecentTabsController(memoryStorage())
    controller.record('a', 'Alpha')
    expect(controller.remove('zzz')).toBeUndefined()
  })

  it('returns undefined when the last tab is closed', () => {
    const controller = new RecentTabsController(memoryStorage())
    controller.record('a', 'Alpha')
    expect(controller.remove('a')).toBeUndefined()
    expect(controller.getSnapshot().tabs).toEqual([])
  })

  it('tracks activation order most-recent-first', () => {
    const controller = new RecentTabsController(memoryStorage())
    controller.record('a', 'Alpha')
    controller.record('b', 'Beta')
    controller.record('a', 'Alpha')
    expect(controller.getSnapshot().order).toEqual(['a', 'b'])
  })

  it('seeds the activation order from the restored list', () => {
    const stored = JSON.stringify({
      tabs: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
      favorites: [],
    })
    const controller = new RecentTabsController(memoryStorage(stored))
    expect(controller.getSnapshot().order).toEqual(['a', 'b'])
  })

  it('ignores a removal of an absent id', () => {
    const controller = new RecentTabsController(memoryStorage())
    controller.record('a', 'Alpha')
    const listener = vi.fn()
    controller.subscribe(listener)

    controller.remove('zzz')

    expect(listener).not.toHaveBeenCalled()
  })

  it('stops notifying after unsubscribe and dispose', () => {
    const controller = new RecentTabsController(memoryStorage())
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)
    unsubscribe()
    controller.record('a', 'Alpha')
    expect(listener).not.toHaveBeenCalled()

    const second = vi.fn()
    controller.subscribe(second)
    controller.dispose()
    controller.record('b', 'Beta')
    expect(second).not.toHaveBeenCalled()
  })
})

describe('RecentTabsController ordering and favorites', () => {
  it('reorders the strip, persists the new order, and notifies once', () => {
    const storage = memoryStorage()
    const controller = new RecentTabsController(storage)
    controller.record('a', 'Alpha')
    controller.record('b', 'Beta')
    controller.record('c', 'Gamma')

    const listener = vi.fn()
    controller.subscribe(listener)
    const writesBefore = storage.writes

    controller.move('c', 'a', 'before')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(storage.writes).toBe(writesBefore + 1)
    expect(controller.getSnapshot().tabs.map(tab => tab.id)).toEqual(['c', 'a', 'b'])
    expect(persisted(storage).tabs.map(tab => tab.id)).toEqual(['c', 'a', 'b'])
  })

  it('leaves the activation order untouched when reordering', () => {
    const controller = new RecentTabsController(memoryStorage())
    controller.record('a', 'Alpha')
    controller.record('b', 'Beta')
    controller.record('c', 'Gamma')
    // Activation history: c, b, a.
    const orderBefore = controller.getSnapshot().order

    controller.move('a', 'c', 'after')

    expect(controller.getSnapshot().order).toEqual(orderBefore)
    // Closing c still falls back to b, not to the visually adjacent tab.
    expect(controller.remove('c')).toBe('b')
  })

  it('does NOT notify or persist on a no-op move', () => {
    const storage = memoryStorage()
    const controller = new RecentTabsController(storage)
    controller.record('a', 'Alpha')
    controller.record('b', 'Beta')

    const listener = vi.fn()
    controller.subscribe(listener)
    const before = controller.getSnapshot()
    const writesBefore = storage.writes

    controller.move('a', 'b', 'before')

    expect(listener).not.toHaveBeenCalled()
    expect(storage.writes).toBe(writesBefore)
    expect(controller.getSnapshot()).toBe(before)
  })

  it('persists a favorite in its own collection, then removes it on the second toggle', () => {
    const storage = memoryStorage()
    const controller = new RecentTabsController(storage)
    controller.record('a', 'Alpha')

    const listener = vi.fn()
    controller.subscribe(listener)

    controller.toggleFavorite('a', 'Alpha')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(persisted(storage)).toEqual({
      tabs: [{ id: 'a', title: 'Alpha' }],
      favorites: [{ id: 'a', title: 'Alpha' }],
    })
    // The tab row keeps no favorite field, and the strip order is untouched.
    expect(controller.getSnapshot().tabs).toEqual([{ id: 'a', title: 'Alpha' }])

    controller.toggleFavorite('a')

    expect(listener).toHaveBeenCalledTimes(2)
    expect(persisted(storage)).toEqual({ tabs: [{ id: 'a', title: 'Alpha' }], favorites: [] })
    expect(controller.getSnapshot().tabs).toEqual([{ id: 'a', title: 'Alpha' }])
  })

  it('bookmarks an id the strip never recorded, titled from the short id', () => {
    const storage = memoryStorage()
    const controller = new RecentTabsController(storage)

    const listener = vi.fn()
    controller.subscribe(listener)

    controller.toggleFavorite('session-abcdef')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().tabs).toEqual([])
    expect(controller.getSnapshot().favorites).toEqual([
      { id: 'session-abcdef', title: 'session-' },
    ])
    expect(persisted(storage)).toEqual({
      tabs: [],
      favorites: [{ id: 'session-abcdef', title: 'session-' }],
    })
  })

  it('does NOT notify or persist for an empty id', () => {
    const storage = memoryStorage()
    const controller = new RecentTabsController(storage)
    controller.record('a', 'Alpha')

    const listener = vi.fn()
    controller.subscribe(listener)
    const writesBefore = storage.writes

    controller.toggleFavorite('')

    expect(listener).not.toHaveBeenCalled()
    expect(storage.writes).toBe(writesBefore)
  })

  it('reorders favorites only, leaving the strip and the activation order alone', () => {
    const storage = memoryStorage()
    const controller = new RecentTabsController(storage)
    controller.record('a', 'Alpha')
    controller.record('b', 'Beta')
    controller.record('c', 'Gamma')
    controller.toggleFavorite('a', 'Alpha')
    controller.toggleFavorite('b', 'Beta')
    controller.toggleFavorite('c', 'Gamma')

    const tabsBefore = controller.getSnapshot().tabs
    const orderBefore = controller.getSnapshot().order
    const listener = vi.fn()
    controller.subscribe(listener)
    const writesBefore = storage.writes

    controller.moveFavorite('c', 'a', 'before')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(storage.writes).toBe(writesBefore + 1)
    expect(controller.getSnapshot().favorites.map(entry => entry.id)).toEqual(['c', 'a', 'b'])
    // Same references: the drawer drag cannot rescue or reshuffle the strip.
    expect(controller.getSnapshot().tabs).toBe(tabsBefore)
    expect(controller.getSnapshot().order).toBe(orderBefore)
    expect(persisted(storage).tabs.map(tab => tab.id)).toEqual(['a', 'b', 'c'])
    expect(persisted(storage).favorites.map(entry => entry.id)).toEqual(['c', 'a', 'b'])
  })

  it('does NOT notify or persist on a no-op favorite move', () => {
    const storage = memoryStorage()
    const controller = new RecentTabsController(storage)
    controller.toggleFavorite('a', 'Alpha')
    controller.toggleFavorite('b', 'Beta')

    const listener = vi.fn()
    controller.subscribe(listener)
    const before = controller.getSnapshot()
    const writesBefore = storage.writes

    controller.moveFavorite('a', 'b', 'before')

    expect(listener).not.toHaveBeenCalled()
    expect(storage.writes).toBe(writesBefore)
    expect(controller.getSnapshot()).toBe(before)
  })
})
