/**
 * Browser-half entry for the recent-tabs plugin.
 *
 * Registers the locale dictionaries and mounts three surfaces:
 *   - the tab strip, in the frame-wide overlay slot (`shell.overlay`), where it
 *     sits above every column and outside their scroll containers. The
 *     recently-closed and favorites buttons are rendered by the strip itself,
 *     at the right end of the same row, so they are not registrations of their
 *     own;
 *   - the favorites drawer, in the same overlay slot as the strip;
 *   - the recently-closed drawer, also in that slot, a sibling of both.
 *
 * All three seats are additive list entries: nothing here replaces shipped UI.
 *
 * Failure policy: mounting problems are logged, never thrown — the web shell
 * fails the whole boot when a plugin apply throws, and an external plugin must
 * not take the GUI down.
 */
import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotMap merge (shell.overlay).
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Local augmentation: declares the shell.overlay seat the shell runtime owns.
import './shell-overlay-slot.ts'
import { RecentTabsController } from './controller.ts'
import { RecentTabs } from './RecentTabs.tsx'
import { FavoritesPanel } from './FavoritesPanel.tsx'
import { ClosedHistoryPanel } from './ClosedHistoryPanel.tsx'
import { en, setTranslator, zh, type RecentTabsKey } from './locales.ts'

/** Locale namespace this plugin owns. */
const NS = 'dsh-browser-tab'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** recent-tabs surface copy. */
    'dsh-browser-tab': RecentTabsKey
  }
}

/**
 * Required services: slots for the two overlay seats, locale for the copy.
 *
 * Every surface also *reads* `sessions` (list + retention), `uiSession`
 * (per-session status) and `uiWorkspace` (session switching), but resolves them
 * with `ctx.get` at the point of use instead of gating activation on them: a
 * missing one degrades a surface, while a failed apply takes the whole shell
 * down.
 */
export const inject = ['slots', 'locale']

/** Type-only surface (export discipline: no value exports beyond the plugin contract). */
export type { RecentTabsKey } from './locales.ts'
export type { RecentTab } from './store.ts'

/**
 * Mount the recent-tabs surfaces.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'recent-tabs: dictionaries')
  const translate = ctx.locale.bind(NS)
  setTranslator(key => translate(key))

  const storage = typeof localStorage === 'undefined' ? undefined : localStorage
  const controller = new RecentTabsController(storage)
  ctx.effect(() => () => { controller.dispose() }, 'recent-tabs: controller')

  try {
    // No JSX in this file: the shared build preset only auto-detects
    // src/client/index.ts (not .tsx), so the entry stays plain TS and React
    // elements are built call-style.
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'recent-tabs',
      order: 100,
      label: () => translate('bar.empty'),
    }, () => createElement(RecentTabs, { controller, ctx })))
  } catch (error) {
    // DOM/registration failures degrade the strip, never the GUI.
    console.warn('[recent-tabs] mount failed:', error)
  }

  try {
    // Second seat in the same list slot: the drawer is a sibling of the strip,
    // not a child, so neither registration can hide the other.
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'recent-tabs-favorites',
      order: 101,
      label: () => translate('fav.title'),
    }, () => createElement(FavoritesPanel, { controller, ctx })))
  } catch (error) {
    console.warn('[recent-tabs] favorites mount failed:', error)
  }

  try {
    // Third seat, same list slot: the recently-closed drawer is a sibling of
    // the strip and the favorites drawer, so no registration can hide another.
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'recent-tabs-history',
      order: 102,
      label: () => translate('hist.panelTitle'),
    }, () => createElement(ClosedHistoryPanel, { controller, ctx })))
  } catch (error) {
    console.warn('[recent-tabs] closed-history mount failed:', error)
  }
}
