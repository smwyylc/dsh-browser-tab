/**
 * The button that opens the favorites drawer, seated at the right end of the
 * tab strip.
 *
 * It is rendered by `RecentTabs` instead of being registered on its own: the
 * strip owns the row, and this button belongs to that row's right edge — inside
 * the bar, outside the scrolling `.stripRow`, so it stays put while the tabs
 * scroll under it. That is also why the drawer opens from the bar's right end
 * rather than from the session header.
 *
 * The drawer itself is a separate slot registration, so the open flag lives in
 * `fav-drawer-state.ts` rather than in either component.
 */
import { useSyncExternalStore } from 'react'
import {
  isFavoritesOpen,
  subscribeFavoritesOpen,
  toggleFavoritesOpen,
} from './fav-drawer-state.ts'
import { t } from './locales.ts'
import css from './recent-tabs.module.css'

/**
 * Render the favorites trigger.
 * @returns the star-and-label button bound to the drawer state.
 */
export function FavoriteButton(): React.JSX.Element {
  const open = useSyncExternalStore(subscribeFavoritesOpen, isFavoritesOpen)
  const label = t('fav.button')

  return (
    <button
      className={css.barButton}
      type="button"
      data-dsh-plugin="recent-tabs"
      data-dsh-part="favorite-button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={label}
      title={label}
      onClick={() => { toggleFavoritesOpen() }}
    >
      <span className={css.starGlyph} aria-hidden="true" />
      <span className={css.barButtonLabel}>{label}</span>
    </button>
  )
}
