/**
 * The button that opens the recently-closed drawer, seated at the right end of
 * the tab strip, just left of the favorites trigger.
 *
 * Rendered by `RecentTabs` for the same reason as `FavoriteButton`: it belongs
 * to that one row — inside the bar, outside the scrolling `.stripRow` — so it
 * stays put while the tabs scroll under it. Its drawer is a separate slot
 * registration, so the open flag lives in `hist-drawer-state.ts`.
 *
 * Neutral on purpose: the blue accent belongs to the favorites family, and a
 * second decorated trigger beside it would make the two read as one group.
 */
import { useSyncExternalStore } from 'react'
import {
  isClosedHistoryOpen,
  subscribeClosedHistoryOpen,
  toggleClosedHistoryOpen,
} from './hist-drawer-state.ts'
import { t } from './locales.ts'
import css from './recent-tabs.module.css'

/**
 * Render the recently-closed trigger.
 * @returns the arrow-and-label button bound to the drawer state.
 */
export function ClosedHistoryButton(): React.JSX.Element {
  const open = useSyncExternalStore(subscribeClosedHistoryOpen, isClosedHistoryOpen)
  const label = t('hist.button')

  return (
    <button
      className={css.barButton}
      type="button"
      data-dsh-plugin="recent-tabs"
      data-dsh-part="closed-history-button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={label}
      title={label}
      onClick={() => { toggleClosedHistoryOpen() }}
    >
      <span className={css.histGlyph} aria-hidden="true" />
      <span className={css.barButtonLabel}>{label}</span>
    </button>
  )
}
