import { describe, expect, it } from 'vitest'
import {
  BACKUP_KEY,
  MAX_TABS,
  STORAGE_KEY,
  dropOrder,
  loadLedger,
  moveFavorite,
  moveTab,
  nextActiveAfterClose,
  parseLedger,
  recordTab,
  removeTab,
  saveLedger,
  shortId,
  toggleFavorite,
  touchOrder,
  type FavoriteEntry,
  type RecentTab,
  type TabStorage,
} from '../src/client/store.ts'

/**
 * In-memory storage double keyed like `localStorage`, so the backup key and the
 * canonical key can be inspected separately. `value` mirrors the canonical key.
 */
class MemoryStorage implements TabStorage {
  readonly box = new Map<string, string>()
  writes = 0
  value: string | null = null

  constructor(initial?: string) {
    if (initial !== undefined) {
      this.box.set(STORAGE_KEY, initial)
      this.value = initial
    }
  }

  getItem(key: string): string | null {
    return this.box.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.writes += 1
    this.box.set(key, value)
    if (key === STORAGE_KEY) this.value = value
  }
}

function memoryStorage(initial?: string): MemoryStorage {
  return new MemoryStorage(initial)
}

describe('shortId', () => {
  it('truncates to eight characters', () => {
    expect(shortId('session-abcdef123456')).toBe('session-')
  })
})

describe('parseLedger', () => {
  const empty = { tabs: [], favorites: [] }

  it('returns an empty ledger for absent, blank, corrupt, or scalar payloads', () => {
    expect(parseLedger(null)).toEqual({ ledger: empty, migrated: false })
    expect(parseLedger('')).toEqual({ ledger: empty, migrated: false })
    expect(parseLedger('not json')).toEqual({ ledger: empty, migrated: false })
    expect(parseLedger('42')).toEqual({ ledger: empty, migrated: false })
    expect(parseLedger('null')).toEqual({ ledger: empty, migrated: false })
  })

  it('reads both collections of the current shape', () => {
    const parsed = parseLedger(JSON.stringify({
      tabs: [{ id: 'a', title: 'Alpha' }],
      favorites: [{ id: 'b', title: 'Beta' }],
    }))
    expect(parsed.migrated).toBe(false)
    expect(parsed.ledger).toEqual({
      tabs: [{ id: 'a', title: 'Alpha' }],
      favorites: [{ id: 'b', title: 'Beta' }],
    })
  })

  it('lets one id be an open tab and a bookmark at the same time', () => {
    const parsed = parseLedger(JSON.stringify({
      tabs: [{ id: 'a', title: 'Alpha' }],
      favorites: [{ id: 'a', title: 'Pinned Alpha' }],
    }))
    expect(parsed.ledger.tabs).toEqual([{ id: 'a', title: 'Alpha' }])
    expect(parsed.ledger.favorites).toEqual([{ id: 'a', title: 'Pinned Alpha' }])
  })

  it('drops malformed rows and fills a missing title from the id', () => {
    const parsed = parseLedger(JSON.stringify({
      tabs: [{ id: 'a', title: 'Alpha' }, null, { id: 7 }, { id: '' }, { id: 'b' }],
      favorites: [null, { id: 'f' }],
    }))
    expect(parsed.ledger.tabs).toEqual([
      { id: 'a', title: 'Alpha' },
      { id: 'b', title: 'b' },
    ])
    expect(parsed.ledger.favorites).toEqual([{ id: 'f', title: 'f' }])
  })

  it('drops duplicate ids inside one collection, keeping the first', () => {
    const parsed = parseLedger(JSON.stringify({
      tabs: [{ id: 'a', title: 'First' }, { id: 'a', title: 'Second' }],
      favorites: [{ id: 'f', title: 'One' }, { id: 'f', title: 'Two' }],
    }))
    expect(parsed.ledger.tabs).toEqual([{ id: 'a', title: 'First' }])
    expect(parsed.ledger.favorites).toEqual([{ id: 'f', title: 'One' }])
  })

  it('strips the legacy flag from a tab row of the current shape', () => {
    const parsed = parseLedger(JSON.stringify({
      tabs: [{ id: 'a', title: 'Alpha', favorite: true }],
      favorites: [],
    }))
    expect(parsed.ledger.tabs).toEqual([{ id: 'a', title: 'Alpha' }])
    // The flag is not part of a tab row any more, on any path.
    expect('favorite' in parsed.ledger.tabs[0]).toBe(false)
    expect(parsed.ledger.favorites).toEqual([])
    expect(parsed.migrated).toBe(false)
  })

  it('caps tabs at MAX_TABS', () => {
    const rows = Array.from({ length: MAX_TABS + 10 }, (_, i) => ({ id: `s${i}`, title: `T${i}` }))
    const parsed = parseLedger(JSON.stringify({ tabs: rows, favorites: [] }))
    expect(parsed.ledger.tabs).toHaveLength(MAX_TABS)
  })

  it('caps only the tab bucket of the migration, never the favorites', () => {
    const rows = Array.from(
      { length: MAX_TABS + 10 },
      (_, i) => ({ id: `s${i}`, title: `T${i}`, favorite: true }),
    )
    const parsed = parseLedger(JSON.stringify(rows))
    expect(parsed.migrated).toBe(true)
    expect(parsed.ledger.tabs).toHaveLength(MAX_TABS)
    expect(parsed.ledger.tabs[0].id).toBe('s0')
    // No cap on bookmarks: every flagged row is still pinned, in order.
    expect(parsed.ledger.favorites).toHaveLength(MAX_TABS + 10)
    expect(parsed.ledger.favorites[0].id).toBe('s0')
    expect(parsed.ledger.favorites[MAX_TABS + 9].id).toBe(`s${MAX_TABS + 9}`)
  })

  it('migrates the legacy array: flagged rows stay tabs and become favorites', () => {
    const parsed = parseLedger(JSON.stringify([
      { id: 'a', title: 'Alpha' },
      { id: 'b', title: 'Beta', favorite: true },
      { id: 'c', title: 'Gamma' },
      { id: 'd', title: 'Delta', favorite: true },
    ]))
    expect(parsed.migrated).toBe(true)
    // Bookmarking a tab never closed it: b and d are in both buckets, and each
    // bucket keeps the original relative order.
    expect(parsed.ledger.tabs).toEqual([
      { id: 'a', title: 'Alpha' },
      { id: 'b', title: 'Beta' },
      { id: 'c', title: 'Gamma' },
      { id: 'd', title: 'Delta' },
    ])
    expect(parsed.ledger.favorites).toEqual([
      { id: 'b', title: 'Beta' },
      { id: 'd', title: 'Delta' },
    ])
    // Neither side keeps the retired field.
    expect('favorite' in parsed.ledger.tabs[0]).toBe(false)
    expect('favorite' in parsed.ledger.favorites[0]).toBe(false)
  })

  it('treats a missing, false, or non-boolean legacy flag as an ordinary tab', () => {
    const parsed = parseLedger(JSON.stringify([
      { id: 'a', title: 'Alpha', favorite: 'yes' },
      { id: 'b', title: 'Beta', favorite: false },
      { id: 'c', title: 'Gamma' },
    ]))
    expect(parsed.ledger.favorites).toEqual([])
    expect(parsed.ledger.tabs.map(tab => tab.id)).toEqual(['a', 'b', 'c'])
  })

  it('discards malformed rows during the migration', () => {
    const parsed = parseLedger(JSON.stringify([
      { id: 'a', title: 'Alpha' },
      null,
      { title: 'No id' },
      { id: 7 },
      { id: '' },
      'no row',
    ]))
    expect(parsed.migrated).toBe(true)
    expect(parsed.ledger).toEqual({ tabs: [{ id: 'a', title: 'Alpha' }], favorites: [] })
  })

  it('dedupes the two legacy buckets one by one, keeping the first row of each', () => {
    const parsed = parseLedger(JSON.stringify([
      { id: 'a', title: 'Tab' },
      { id: 'a', title: 'Bookmark', favorite: true },
      { id: 'a', title: 'Later bookmark', favorite: true },
    ]))
    // One id may sit in both buckets, but each bucket holds it once.
    expect(parsed.ledger.tabs).toEqual([{ id: 'a', title: 'Tab' }])
    expect(parsed.ledger.favorites).toEqual([{ id: 'a', title: 'Bookmark' }])
  })
})

describe('recordTab', () => {
  const empty: RecentTab[] = []

  it('appends a new tab and preserves first-seen order', () => {
    const one = recordTab(empty, 'a', 'Alpha')
    const two = recordTab(one, 'b', 'Beta')
    expect(two.map(tab => tab.id)).toEqual(['a', 'b'])
  })

  it('returns the SAME reference when the tab is unchanged', () => {
    const tabs = recordTab(empty, 'a', 'Alpha')
    expect(recordTab(tabs, 'a', 'Alpha')).toBe(tabs)
  })

  it('updates the title in place when only the title changed', () => {
    const tabs = recordTab(recordTab(empty, 'a', 'Alpha'), 'b', 'Beta')
    const next = recordTab(tabs, 'a', 'Renamed')
    expect(next).not.toBe(tabs)
    expect(next).toEqual([
      { id: 'a', title: 'Renamed' },
      { id: 'b', title: 'Beta' },
    ])
  })

  it('falls back to the short id for a blank title', () => {
    expect(recordTab(empty, 'session-abcdef', '')).toEqual([
      { id: 'session-abcdef', title: 'session-' },
    ])
  })

  it('keeps a title update free of any other field', () => {
    const tabs: RecentTab[] = [{ id: 'a', title: 'Alpha' }]
    expect(recordTab(tabs, 'a', 'Renamed')).toEqual([{ id: 'a', title: 'Renamed' }])
    expect(recordTab(tabs, 'a', 'Alpha')).toBe(tabs)
  })

  it('drops the oldest tabs beyond MAX_TABS', () => {
    let tabs: RecentTab[] = []
    for (let i = 0; i < MAX_TABS + 5; i += 1) tabs = recordTab(tabs, `s${i}`, `T${i}`)
    expect(tabs).toHaveLength(MAX_TABS)
    expect(tabs[0].id).toBe('s5')
  })
})

describe('removeTab', () => {
  it('removes the matching tab', () => {
    const tabs = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]
    expect(removeTab(tabs, 'a')).toEqual([{ id: 'b', title: 'B' }])
  })

  it('returns the SAME reference when the id is absent', () => {
    const tabs = [{ id: 'a', title: 'A' }]
    expect(removeTab(tabs, 'zzz')).toBe(tabs)
  })
})

describe('loadLedger / saveLedger', () => {
  it('round-trips both collections through storage in the record shape', () => {
    const storage = memoryStorage()
    const ledger = {
      tabs: [{ id: 'a', title: 'Alpha' }],
      favorites: [{ id: 'b', title: 'Beta' }],
    }
    saveLedger(storage, ledger)
    expect(storage.writes).toBe(1)
    expect(JSON.parse(storage.value ?? 'null')).toEqual({
      tabs: [{ id: 'a', title: 'Alpha' }],
      favorites: [{ id: 'b', title: 'Beta' }],
    })
    // Reading a current-shape payload is a no-op: no rewrite, no backup.
    expect(loadLedger(storage)).toEqual(ledger)
    expect(storage.writes).toBe(1)
  })

  it('migrates a legacy payload and backs it up verbatim first', () => {
    const legacy = JSON.stringify([
      { id: 'a', title: 'Alpha' },
      { id: 'b', title: 'Beta', favorite: true },
    ])
    const storage = memoryStorage(legacy)

    const ledger = loadLedger(storage)

    expect(ledger).toEqual({
      tabs: [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }],
      favorites: [{ id: 'b', title: 'Beta' }],
    })
    expect(JSON.parse(storage.value ?? 'null')).toEqual(ledger)
    // The backup is the old text byte for byte, not a re-serialized copy.
    expect(storage.getItem(BACKUP_KEY)).toBe(legacy)
    // One write for the backup, one for the canonical key.
    expect(storage.writes).toBe(2)
  })

  it('is idempotent: a second load neither rewrites nor re-migrates', () => {
    const legacy = JSON.stringify([{ id: 'a', title: 'Alpha', favorite: true }])
    const storage = memoryStorage(legacy)

    const first = loadLedger(storage)
    const backup = storage.getItem(BACKUP_KEY)
    const writes = storage.writes

    expect(loadLedger(storage)).toEqual(first)
    expect(storage.writes).toBe(writes)
    expect(storage.getItem(BACKUP_KEY)).toBe(backup)
    expect(JSON.parse(storage.value ?? 'null')).toEqual({
      tabs: [{ id: 'a', title: 'Alpha' }],
      favorites: [{ id: 'a', title: 'Alpha' }],
    })
  })

  it('does not touch storage when the payload is already current', () => {
    const raw = JSON.stringify({ tabs: [{ id: 'a', title: 'Alpha' }], favorites: [] })
    const storage = memoryStorage(raw)

    expect(loadLedger(storage)).toEqual({ tabs: [{ id: 'a', title: 'Alpha' }], favorites: [] })
    expect(storage.writes).toBe(0)
    expect(storage.getItem(BACKUP_KEY)).toBeNull()
  })

  it('still migrates when the backup write is refused', () => {
    const legacy = JSON.stringify([{ id: 'a', title: 'Alpha', favorite: true }])
    const box = new Map<string, string>([[STORAGE_KEY, legacy]])
    const storage: TabStorage = {
      getItem: (key: string) => box.get(key) ?? null,
      setItem(key: string, value: string) {
        if (key === BACKUP_KEY) throw new Error('quota')
        box.set(key, value)
      },
    }

    expect(loadLedger(storage)).toEqual({
      tabs: [{ id: 'a', title: 'Alpha' }],
      favorites: [{ id: 'a', title: 'Alpha' }],
    })
    expect(JSON.parse(box.get(STORAGE_KEY) ?? 'null')).toEqual({
      tabs: [{ id: 'a', title: 'Alpha' }],
      favorites: [{ id: 'a', title: 'Alpha' }],
    })
  })

  it('reads nothing from absent storage or a failing storage', () => {
    expect(loadLedger(undefined)).toEqual({ tabs: [], favorites: [] })
    expect(loadLedger({ getItem() { throw new Error('blocked') }, setItem() {} })).toEqual({
      tabs: [],
      favorites: [],
    })
  })

  it('swallows a write failure (private mode, quota)', () => {
    const failing: TabStorage = { getItem: () => null, setItem() { throw new Error('quota') } }
    expect(() => saveLedger(failing, { tabs: [{ id: 'a', title: 'A' }], favorites: [] })).not.toThrow()
  })
})

describe('touchOrder', () => {
  it('moves the id to the front', () => {
    expect(touchOrder(['b', 'a'], 'a')).toEqual(['a', 'b'])
  })

  it('prepends an id not yet tracked', () => {
    expect(touchOrder(['b'], 'c')).toEqual(['c', 'b'])
  })

  it('returns the SAME reference when already at the front', () => {
    const order = ['a', 'b']
    expect(touchOrder(order, 'a')).toBe(order)
  })
})

describe('dropOrder', () => {
  it('forgets the id', () => {
    expect(dropOrder(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })

  it('returns the SAME reference when the id is absent', () => {
    const order = ['a']
    expect(dropOrder(order, 'zzz')).toBe(order)
  })
})

describe('nextActiveAfterClose', () => {
  const tabs: RecentTab[] = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
    { id: 'c', title: 'C' },
  ]

  it('picks the most recently activated survivor (MRU)', () => {
    // Activation history: c, then a, then b (b is current and being closed).
    const order = ['b', 'a', 'c']
    expect(nextActiveAfterClose(order, tabs.filter(t => t.id !== 'b'), 'b')).toBe('a')
  })

  it('skips ids that are no longer retained', () => {
    const survivors = tabs.filter(t => t.id !== 'b' && t.id !== 'a')
    expect(nextActiveAfterClose(['b', 'a', 'c'], survivors, 'b')).toBe('c')
  })

  it('falls back to the retained order for a never-activated tab', () => {
    const survivors = tabs.filter(t => t.id !== 'c')
    expect(nextActiveAfterClose([], survivors, 'c')).toBe('a')
  })

  it('returns undefined when nothing remains', () => {
    expect(nextActiveAfterClose(['a'], [], 'a')).toBeUndefined()
  })
})

describe('moveTab', () => {
  const tabs: RecentTab[] = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
    { id: 'c', title: 'C' },
  ]

  it('moves a tab before the target', () => {
    expect(moveTab(tabs, 'c', 'a', 'before').map(tab => tab.id)).toEqual(['c', 'a', 'b'])
  })

  it('moves a tab after the target', () => {
    expect(moveTab(tabs, 'a', 'b', 'after').map(tab => tab.id)).toEqual(['b', 'a', 'c'])
  })

  it('returns the SAME reference when the tab already sits there', () => {
    expect(moveTab(tabs, 'a', 'b', 'before')).toBe(tabs)
    expect(moveTab(tabs, 'b', 'a', 'after')).toBe(tabs)
  })

  it('returns the SAME reference for an unknown id or target', () => {
    expect(moveTab(tabs, 'zzz', 'a', 'before')).toBe(tabs)
    expect(moveTab(tabs, 'a', 'zzz', 'before')).toBe(tabs)
  })

  it('returns the SAME reference when the id is its own target', () => {
    expect(moveTab(tabs, 'b', 'b', 'after')).toBe(tabs)
  })
})

describe('toggleFavorite', () => {
  const favorites: FavoriteEntry[] = [{ id: 'a', title: 'Alpha' }]

  it('appends a new bookmark with the title it was given', () => {
    const next = toggleFavorite(favorites, 'b', 'Beta')
    expect(next).toEqual([
      { id: 'a', title: 'Alpha' },
      { id: 'b', title: 'Beta' },
    ])
    expect(next).not.toBe(favorites)
    // Pure: the input list is never mutated.
    expect(favorites).toEqual([{ id: 'a', title: 'Alpha' }])
  })

  it('falls back to the short id when no title is known or the title is blank', () => {
    expect(toggleFavorite([], 'session-abcdef')).toEqual([
      { id: 'session-abcdef', title: 'session-' },
    ])
    expect(toggleFavorite([], 'session-abcdef', '')).toEqual([
      { id: 'session-abcdef', title: 'session-' },
    ])
  })

  it('removes an existing bookmark and keeps the rest in order', () => {
    const list: FavoriteEntry[] = [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C' },
    ]
    expect(toggleFavorite(list, 'b')).toEqual([
      { id: 'a', title: 'A' },
      { id: 'c', title: 'C' },
    ])
  })

  it('returns the SAME reference for an empty id', () => {
    expect(toggleFavorite(favorites, '')).toBe(favorites)
  })

  it('leaves the tab list out of every favorites operation', () => {
    const tabs: RecentTab[] = [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }]
    const list: FavoriteEntry[] = [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }]

    // Neither helper receives the tab list, and the value that went in is
    // still exactly what a strip render would read afterwards.
    expect(toggleFavorite(list, 'a')).toEqual([{ id: 'b', title: 'Beta' }])
    expect(moveFavorite(list, 'b', 'a', 'before').map(entry => entry.id)).toEqual(['b', 'a'])
    expect(tabs).toEqual([{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }])
  })
})

describe('moveFavorite', () => {
  const favorites: FavoriteEntry[] = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
    { id: 'c', title: 'C' },
  ]

  it('moves an entry before the target and keeps every title', () => {
    expect(moveFavorite(favorites, 'c', 'a', 'before')).toEqual([
      { id: 'c', title: 'C' },
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ])
  })

  it('moves an entry after the target', () => {
    expect(moveFavorite(favorites, 'a', 'b', 'after').map(entry => entry.id)).toEqual(['b', 'a', 'c'])
  })

  it('returns the SAME reference when the entry already sits there', () => {
    expect(moveFavorite(favorites, 'a', 'b', 'before')).toBe(favorites)
    expect(moveFavorite(favorites, 'b', 'a', 'after')).toBe(favorites)
  })

  it('returns the SAME reference for an unknown id, unknown target, or self drop', () => {
    expect(moveFavorite(favorites, 'zzz', 'a', 'before')).toBe(favorites)
    expect(moveFavorite(favorites, 'a', 'zzz', 'before')).toBe(favorites)
    expect(moveFavorite(favorites, 'b', 'b', 'after')).toBe(favorites)
  })

  it('does not mutate the list it was given', () => {
    moveFavorite(favorites, 'c', 'a', 'before')
    expect(favorites.map(entry => entry.id)).toEqual(['a', 'b', 'c'])
  })
})
