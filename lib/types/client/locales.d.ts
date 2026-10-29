/**
 * recent-tabs surface copy: zh is the key source, en mirrors every key.
 */
export declare const zh: {
    'bar.empty': string;
    'tab.close': string;
    'tab.switch': string;
    'tab.renameHint': string;
    'bar.stale': string;
    'tab.running': string;
    'tab.completed': string;
    'tab.waiting': string;
    'tab.dragHint': string;
    'star.favorite': string;
    'star.unfavorite': string;
    'fav.title': string;
    'fav.open': string;
    'fav.remove': string;
    'fav.button': string;
    'fav.empty': string;
    'fav.newFolder': string;
    'fav.folderDefault': string;
    'fav.folderExpand': string;
    'fav.folderCollapse': string;
    'fav.folderRemove': string;
    'fav.folderRename': string;
    'menu.favorite': string;
    'menu.unfavorite': string;
    'hist.button': string;
    'hist.panelTitle': string;
    'hist.empty': string;
    'hist.dead': string;
    'hist.reopen': string;
    'rename.label': string;
    'rename.failed': string;
};
export type RecentTabsKey = keyof typeof zh;
export declare const en: Record<RecentTabsKey, string>;
/** Bind the locale-bound translator (installed once by the client entry). */
export declare function setTranslator(fn: (key: RecentTabsKey) => string): void;
/** Translate one key through the active locale, falling back to zh. */
export declare function t(key: RecentTabsKey): string;
