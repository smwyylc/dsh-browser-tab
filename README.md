# dsh-recent-tabs

English | [中文](README.zh.md)

A recent-session tab strip for the DSH Web GUI, shaped like browser tabs: every
session you open adds a tab, clicking a tab switches to that session, and a tab
disappears only when you close it. Favorites are a drawer dropping from the right
end of that strip, the way a browser keeps its bookmarks — and like a browser,
open tabs and bookmarks are two separate lists: closing a tab never removes its
bookmark.

## Behaviour

- **Hover to reveal.** The strip is parked off-screen at the top edge. Move the
  pointer into the top 10px band and it slides down; move away and it retracts
  after 260ms. It never covers the conversation while you are reading.
- **Wide and centred.** The strip spans 80% of the viewport width, centred on
  the top edge, so a wide screen shows more tabs instead of the same narrow
  column; the tab row scrolls inside it when they still do not fit.
- **Wheel scrolls the tabs.** With the pointer over the tab row, the wheel moves
  the tabs sideways instead of the page — one notch of vertical wheel travels a
  stretch of horizontal row, with no Shift needed, like a browser's tab bar. The
  movement is not animated, and it only applies over the row itself: over the
  favorites button or outside the strip the wheel is left alone.
- **Automatic collection.** Opening a session (from the sidebar, a link, or a
  fresh session) adds its tab, in first-seen order.
- **Click to switch.** The current session's tab carries a green dot; clicking
  any other tab selects that session.
- **Three status markers.** One leading slot, one mark at a time. A tab whose
  agent turn is still executing turns a small soft-blue ring before its title.
  A tab whose turn finished while you were looking elsewhere keeps a small
  static blue check in that same slot instead: the "answer landed, not seen
  yet" reminder, which is what tells a tab that has answered apart from one that
  never ran. A tab whose session is waiting on you — a question or a plan review
  the agent asked for — shows a small static blue question mark there instead,
  because that turn cannot move until you reply. The question mark outranks both
  turn facts (it is the one thing you have to act on) and a running turn outranks
  the check. None of the three animates, and with none of the three facts the tab
  is plain. All three live on the tab strip only, never in the conversation.
- **Close by hand.** A tab is removed only through its close button, so the
  strip is exactly the set of sessions you have not dismissed.
- **Bookmarks are their own list.** A favorite is its own stored entry, not a
  flag on a tab. Closing a tab in the strip removes the tab and nothing else:
  the session stays in the favorites drawer, ready to open again.
- **Drag to reorder.** Drag a tab onto another one and the side the pointer is
  on decides where it lands; the target edge lights up while you drag. The new
  order is what the strip keeps, and a drag never switches sessions.
- **A compact favorites drawer, opened from the strip.** The right end of the
  tab strip carries the `Favorites` button (star plus label), one step outside
  the scrolling row so it never slides away with the tabs. Clicking it opens a
  compact panel, 200px wide, dropping from that end of the strip: its height
  follows its content up to 60vh or 520px, and a longer list scrolls inside it,
  so it never runs to the bottom of the screen. While the drawer is open the
  strip stays on screen even if the pointer leaves it, because the strip holds
  the button the drawer is anchored to; close the drawer and the ordinary
  260ms retract resumes. The drawer is anchored to the button's own rectangle,
  so a layout change that moves the button moves the drawer instead of leaving
  it behind. Escape, a click outside, or the button again closes it, and a
  closed drawer renders nothing at all.
- **A bookmark-bar look.** The strip reads as a thin shelf rather than a card:
  dense tabs with a rounded highlight on hover, a hairline bottom edge, 9px
  bottom corners and one soft shadow, never a frame on all four sides. Favorites
  keep a palette of their own inside that neutral bar: the star on the
  `Favorites` button holds the accent at rest, framed by a blue hairline that
  deepens on hover and fills with a blue wash while its drawer is open; the
  drawer is a paper popover with a blue-tinted edge, a blue title over a
  blue rule, flat rows that light up on hover and the current session on a
  blue bed. The accent is the shell's own interactive blue — the hue behind
  links and info buttons — held one step calmer: the raw blue at 85%, mixed with
  the surface it sits on, so the hue stays and the glare drops as it settles
  into both themes. It is the only hue this plugin adds — the shell's brand
  color resolves to plain black in this theme, so an accent taken from it would
  mark nothing at all. Only those accents are colored — the panel surface, the
  tabs and the bar stay neutral. It
  also stacks above the strip and above the tab context menu, so neither can cut
  through it while it is open. Everything is drawn from the shell's alias
  tokens, so both themes apply as they are.
- **Two ways to pin.** Inside the drawer, the star pins or unpins the session
  you are looking at. Anywhere else, right-click a tab in the strip and pick
  `Add to favorites` / `Remove from favorites` from the small menu, a row that
  carries the same favorites accent and sits one weight heavier once the tab is
  already pinned. Both entry points write the same favorites collection. The
  strip's own star only opens the drawer, and favoriting never reorders the
  strip.
- **Inside the drawer.** Favorites list in stored order, the current session
  highlighted: click an entry to open that session, click the cross that appears
  on hover to unpin it (the tab and its session stay), drag entries up and down
  to reorder. An entry whose session is gone stays listed, dimmed and struck
  through, until you unpin it. With nothing pinned, the drawer spells out both
  entry points.
- **Closing the active tab falls back to MRU.** Closing the tab you are looking
  at switches the view to the tab you were on before it (most-recently-used
  order); closing any other tab leaves the view alone. If no tab is left, the
  view stays where it is.
- **Rename in place.** Double-click a tab to edit its name; Enter or clicking
  away commits, Escape cancels. This renames the SESSION, not just the tab — the
  new name propagates to every list that reads the session title. Stale tabs
  (sessions no longer listed) cannot be renamed.
- **Fixed width.** Every tab is 150px wide, so titles of different length never
  reflow the row; long titles ellipsize.
- **Survives restart.** Both collections are stored in the browser's
  `localStorage` under `dsh-recent-tabs-v1`, as one record of `{ tabs,
  favorites }`, so they are still there after a page reload or a GUI restart.
  Closing the browser does not clear them. The order and the bookmarks are part
  of that record; whether the drawer is open is not. A record written by an
  older version (a bare tab array, with a `favorite` flag on each row) is
  migrated on the first load: every row stays a tab, and the flagged rows also
  join `favorites` — one row was both, and pinning a tab never closed it — with
  each list keeping its original order; the original text is copied to
  `dsh-recent-tabs-v1-backup` before the rewrite.
- **Stale tabs stay visible.** A retained session that has left the live list
  stays in the strip, dimmed and struck through, until you close it.

## Placement

Two additive registrations, none of them replacing a shipped entry:

| Slot | Surface |
| --- | --- |
| `shell.overlay` | The tab strip, above every column and outside their scroll containers. It also renders the `Favorites` button at its own right end. |
| `shell.overlay` | The favorites drawer, a sibling of the strip in the same list slot. |

The button is part of the strip rather than a registration of its own: it
belongs to that one row, at its right end and outside the scrolling tab row, and
keeping it there means the drawer hangs off the strip's corner. Nothing is added
to the session header, so no shipped header seat is shadowed. Each registration
is wrapped in its own `try`/`catch` — a failed mount degrades one surface, it
never takes the shell down.

The drawer and the button are separate mounts, so the open flag lives in
`fav-drawer-state.ts`, a module-level observable that is never persisted. The
strip subscribes to it too: an open drawer pins the strip on screen, since a
parked strip would put the drawer's anchor above the viewport.

## Architecture

| Half | File | Role |
| --- | --- | --- |
| Host | `src/index.ts` | No-op. The feature is entirely client-side. |
| Client | `src/client/index.ts` | Registers the dictionaries and mounts the two surfaces (strip, drawer), each in its own `try`/`catch`. |
| Client | `src/client/RecentTabs.tsx` | The React strip: one row of tabs, the favorites trigger at its right end, hover and drag state, inline rename, and the per-tab context menu. It also holds the strip on screen while the drawer is open. |
| Client | `src/client/FavoriteButton.tsx` | The trigger at the strip's right end: star glyph plus label, `aria-haspopup="dialog"` and `aria-expanded` bound to the drawer. |
| Client | `src/client/FavoritesPanel.tsx` | The drawer: anchors itself to the trigger rectangle, pins the current session, lists favorites, drags them vertically. |
| Client | `src/client/fav-drawer-state.ts` | Module-level open/closed flag shared by the trigger, the strip and the drawer; pure UI state, never persisted. |
| Client | `src/client/use-current-session.ts` | The session view (selection, live ids, titles, run facts) shared by the strip and the drawer. |
| Client | `src/client/drag-place.ts` | Drop-side geometry: left/right for the strip row, top/bottom for the drawer column. |
| Client | `src/client/controller.ts` | Snapshot owner over both stored collections; notifies only on real changes. |
| Client | `src/client/store.ts` | Pure, framework-free ledger logic: parse and migrate, tabs, favorites, reorder, load, save. |

Session data comes from the Session Controller's `ctx.sessions.list` snapshot
source plus `ctx.uiWorkspace.openSession(id)`. The surfaces are global while
Slot props are session-scoped, so they deliberately do not read `useSessions`
from props.

The stored list is authoritative for *membership*; the live session list is
authoritative for *titles and presence*. That split is what lets a retained tab
outlive its session without losing its last known name.

Favorites are a collection of their own, not a flag on a stored row:
`toggleFavorite` appends to or removes from `favorites`, and `moveFavorite`
reorders only that list. Neither touches the tab list or the activation order,
which is what lets closing a tab leave its bookmark in place.

The context menu is drawn by this plugin, not by a shell menu component: it is
a `position: fixed` popup at the click point, clamped into the viewport, and it
carries no shell class names.

## Rapid switching

Recording a session is idempotent: `recordTab` and the controller both return
the same snapshot reference when an observation changes nothing, and they notify
subscribers only for a real change. Clicking back and forth between two tabs
therefore cannot re-enter the render loop, which is what produced the earlier
flicker when the strip was a dynamic plugin.

## Install

```sh
dsh plugin --profile web add link:<repo>/packages/dsh-recent-tabs
```

Then restart the profile so the Host half registers.

## Local checks

```sh
pnpm --filter dsh-recent-tabs typecheck
pnpm --filter dsh-recent-tabs test
pnpm --filter dsh-recent-tabs build
```

## Limits

- The strip lists sessions opened **in this browser**. Another browser, another
  profile, or a private window has its own list.
- Storage is best-effort: if the browser blocks `localStorage` (private mode in
  some configurations, or a quota fault), the strip still works for the current
  page lifetime but does not persist.
- The list is capped at 40 tabs; older entries are dropped as new ones arrive.
