/**
 * recent-tabs surface copy: zh is the key source, en mirrors every key.
 */

export const zh = {
  'bar.empty': '还没有打开的会话',
  'tab.close': '关闭',
  'tab.switch': '切换到该会话',
  'tab.renameHint': '点击切换，双击重命名，拖动排序',
  'bar.stale': '该会话已不在列表中',
  'tab.running': 'AI 执行中',
  'tab.completed': 'AI 已回答，尚未查看',
  'tab.waiting': '等待你的回复',
  'tab.dragHint': '拖动调整顺序',
  'star.favorite': '收藏',
  'star.unfavorite': '取消收藏',
  'fav.title': '收藏夹',
  'fav.open': '打开该会话',
  'fav.remove': '取消收藏',
  'fav.button': '收藏夹',
  'fav.empty': '点上面的星标收藏当前会话，或右键顶部标签条里的标签选择收藏',
  'menu.favorite': '收藏',
  'menu.unfavorite': '取消收藏',
  'rename.label': '会话名称',
  'rename.failed': '重命名失败',
}

export type RecentTabsKey = keyof typeof zh

export const en: Record<RecentTabsKey, string> = {
  'bar.empty': 'No session opened yet',
  'tab.close': 'Close',
  'tab.switch': 'Switch to this session',
  'tab.renameHint': 'Click to switch, double-click to rename, drag to reorder',
  'bar.stale': 'This session is no longer listed',
  'tab.running': 'AI is running',
  'tab.completed': 'AI answered, not viewed yet',
  'tab.waiting': 'Waiting for your reply',
  'tab.dragHint': 'Drag to reorder',
  'star.favorite': 'Add to favorites',
  'star.unfavorite': 'Remove from favorites',
  'fav.title': 'Favorites',
  'fav.open': 'Open this session',
  'fav.remove': 'Remove from favorites',
  'fav.button': 'Favorites',
  'fav.empty': 'Star the session at the top, or right-click a tab in the top strip, to keep it here',
  'menu.favorite': 'Add to favorites',
  'menu.unfavorite': 'Remove from favorites',
  'rename.label': 'Session name',
  'rename.failed': 'Rename failed',
}

/** Active-locale translator, bound by the client entry after registration. */
let translate: (key: RecentTabsKey) => string = key => zh[key]

/** Bind the locale-bound translator (installed once by the client entry). */
export function setTranslator(fn: (key: RecentTabsKey) => string): void {
  translate = fn
}

/** Translate one key through the active locale, falling back to zh. */
export function t(key: RecentTabsKey): string {
  return translate(key)
}
