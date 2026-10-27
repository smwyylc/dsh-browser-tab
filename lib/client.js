window.__ModuleLoader__.load({
	id: "dsh-recent-tabs",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/store.ts
		/**
		* Recent-tab ledger: the ordered list of sessions the user has opened in this
		* browser, plus the set of sessions they bookmarked, persisted to localStorage.
		*
		* Tabs and favorites are two independent collections, exactly like a browser
		* keeping open tabs apart from bookmarks: a tab is "open in the strip right
		* now", a favorite is "kept for later". Closing a tab therefore never touches
		* the favorites collection, and pinning a session never reorders the strip.
		*
		* Pure and framework-free on purpose — every mutation is a plain function over
		* the two lists so the behaviour is locked by unit tests without React or a
		* live GUI. The React surface only reads this store through subscribe().
		*/
		/** Storage key of the persisted ledger. */
		const STORAGE_KEY = "dsh-recent-tabs-v1";
		/**
		* Backup key of the pre-migration payload.
		*
		* Browsers in the wild still hold the legacy shape (a bare array of rows, each
		* carrying its own `favorite` flag). The first load copies that text here
		* verbatim before rewriting the canonical key, so a failed or unwanted
		* migration can never destroy a user's bookmarks.
		*/
		const BACKUP_KEY = "dsh-recent-tabs-v1-backup";
		/** Short id fallback for sessions without a durable title. */
		function shortId(id) {
			return id.slice(0, 8);
		}
		/** A fresh empty ledger (never a shared constant: callers own their arrays). */
		function emptyLedger() {
			return {
				tabs: [],
				favorites: []
			};
		}
		/**
		* Validate one stored row.
		*
		* The id must be a non-empty string and must not have been seen yet; a missing
		* title is filled from the short id, because a real session with an unresolved
		* title still belongs in the list.
		* @param row - one raw row.
		* @param seen - ids already accepted in this bucket, mutated in place.
		* @returns the normalized row, or undefined when it must be dropped.
		*/
		function readRow(row, seen) {
			if (typeof row !== "object" || row === null) return void 0;
			const id = row.id;
			if (typeof id !== "string" || id === "" || seen.has(id)) return void 0;
			seen.add(id);
			const title = row.title;
			return {
				id,
				title: typeof title === "string" && title !== "" ? title : shortId(id)
			};
		}
		/**
		* Normalize the current shape's two arrays independently.
		*
		* They are deduped one by one, not against each other: the same session is
		* usually both an open tab and a bookmark, and that is not a duplicate.
		* @param tabs - raw tab rows.
		* @param favorites - raw favorite rows.
		* @returns the normalized ledger.
		*/
		function readCurrent(tabs, favorites) {
			const tabSeen = /* @__PURE__ */ new Set();
			const keptTabs = [];
			for (const row of tabs) {
				if (keptTabs.length >= 40) break;
				const entry = readRow(row, tabSeen);
				if (entry !== void 0) keptTabs.push(entry);
			}
			const favoriteSeen = /* @__PURE__ */ new Set();
			const keptFavorites = [];
			for (const row of favorites) {
				const entry = readRow(row, favoriteSeen);
				if (entry !== void 0) keptFavorites.push(entry);
			}
			return {
				tabs: keptTabs,
				favorites: keptFavorites
			};
		}
		/**
		* Split the legacy tab array into the two collections.
		*
		* One row in that shape was both things at once when it carried the flag, so a
		* flagged row becomes a bookmark AND stays a tab: bookmarking a tab never
		* closed it, and dropping the tab here is what made favorites disappear from
		* the strip on upgrade. The buckets are deduped and ordered one by one, exactly
		* like the current shape, so one id may appear in each; only the tab bucket is
		* capped.
		* @param rows - the legacy array.
		* @returns the migrated ledger.
		*/
		function readLegacy(rows) {
			const tabSeen = /* @__PURE__ */ new Set();
			const favoriteSeen = /* @__PURE__ */ new Set();
			const tabs = [];
			const favorites = [];
			for (const row of rows) {
				if (typeof row === "object" && row !== null && row.favorite === true) {
					const entry = readRow(row, favoriteSeen);
					if (entry !== void 0) favorites.push(entry);
				}
				if (tabs.length >= 40) continue;
				const tab = readRow(row, tabSeen);
				if (tab !== void 0) tabs.push(tab);
			}
			return {
				tabs,
				favorites
			};
		}
		/**
		* Parse persisted text into a ledger, dropping malformed rows and reporting
		* whether the payload needs the one-time migration rewrite.
		* @param raw - the stored JSON text, or null when nothing was stored.
		* @returns the ledger plus the migration flag, never throwing on corrupt input.
		*/
		function parseLedger(raw) {
			if (raw === null || raw === "") return {
				ledger: emptyLedger(),
				migrated: false
			};
			let parsed;
			try {
				parsed = JSON.parse(raw);
			} catch {
				return {
					ledger: emptyLedger(),
					migrated: false
				};
			}
			if (Array.isArray(parsed)) return {
				ledger: readLegacy(parsed),
				migrated: true
			};
			if (typeof parsed === "object" && parsed !== null) {
				const tabs = parsed.tabs;
				const favorites = parsed.favorites;
				return {
					ledger: readCurrent(Array.isArray(tabs) ? tabs : [], Array.isArray(favorites) ? favorites : []),
					migrated: false
				};
			}
			return {
				ledger: emptyLedger(),
				migrated: false
			};
		}
		/**
		* Record one session as opened, preserving first-seen order.
		*
		* Idempotent when the tab is already present with the same title, which is
		* what keeps a rapid click train from re-entering the render loop.
		* @param tabs - current list.
		* @param id - session to record.
		* @param title - its resolved display title.
		* @returns the next list, the SAME reference when nothing changed.
		*/
		function recordTab(tabs, id, title) {
			const index = tabs.findIndex((tab) => tab.id === id);
			const nextTitle = title === "" ? shortId(id) : title;
			if (index < 0) {
				const next = tabs.concat([{
					id,
					title: nextTitle
				}]);
				return next.length > 40 ? next.slice(next.length - 40) : next;
			}
			if (tabs[index].title === nextTitle) return tabs;
			const next = tabs.slice();
			next[index] = {
				id,
				title: nextTitle
			};
			return next;
		}
		/**
		* Remove one tab.
		*
		* Bookmarks are a different collection and are not a parameter here on
		* purpose: closing a tab cannot delete its favorite.
		* @param tabs - current list.
		* @param id - session to drop.
		* @returns the next list, the SAME reference when the id was absent.
		*/
		function removeTab(tabs, id) {
			const next = tabs.filter((tab) => tab.id !== id);
			return next.length === tabs.length ? tabs : next;
		}
		/**
		* Move one tab before/after another.
		* @param tabs - current list.
		* @param id - the tab being dragged.
		* @param targetId - the tab the drop landed on.
		* @param place - whether the dragged tab lands before or after the target.
		* @returns the next list; the SAME reference when the move is a no-op (either
		* id absent, or the tab already sits there).
		*/
		function moveTab(tabs, id, targetId, place) {
			if (id === targetId) return tabs;
			const from = tabs.findIndex((tab) => tab.id === id);
			const to = tabs.findIndex((tab) => tab.id === targetId);
			if (from < 0 || to < 0) return tabs;
			const next = tabs.slice();
			const [moved] = next.splice(from, 1);
			const targetIndex = next.findIndex((tab) => tab.id === targetId);
			next.splice(place === "before" ? targetIndex : targetIndex + 1, 0, moved);
			if (next.every((tab, index) => tab.id === tabs[index].id)) return tabs;
			return next;
		}
		/**
		* Add or remove one bookmark.
		*
		* Appends when the id is not bookmarked yet (a bookmark list keeps the order it
		* was built in), removes it otherwise. Tabs are a separate collection and are
		* never touched here.
		* @param favorites - current bookmark list.
		* @param id - session to pin or unpin.
		* @param title - title to store when pinning; defaults to the short id.
		* @returns the next list, the SAME reference when the id is empty.
		*/
		function toggleFavorite(favorites, id, title) {
			if (id === "") return favorites;
			const index = favorites.findIndex((entry) => entry.id === id);
			if (index >= 0) {
				const next = favorites.slice();
				next.splice(index, 1);
				return next;
			}
			const nextTitle = title === void 0 || title === "" ? shortId(id) : title;
			return favorites.concat([{
				id,
				title: nextTitle
			}]);
		}
		/**
		* Move one bookmark before/after another.
		*
		* The drawer's vertical drag only ever reorders this list: the strip keeps its
		* own order and the activation order is not involved.
		* @param favorites - current bookmark list.
		* @param id - the entry being dragged.
		* @param targetId - the entry the drop landed on.
		* @param place - whether the dragged entry lands before or after the target.
		* @returns the next list; the SAME reference when the move is a no-op.
		*/
		function moveFavorite(favorites, id, targetId, place) {
			if (id === targetId) return favorites;
			const from = favorites.findIndex((entry) => entry.id === id);
			const to = favorites.findIndex((entry) => entry.id === targetId);
			if (from < 0 || to < 0) return favorites;
			const next = favorites.slice();
			const [moved] = next.splice(from, 1);
			const targetIndex = next.findIndex((entry) => entry.id === targetId);
			next.splice(place === "before" ? targetIndex : targetIndex + 1, 0, moved);
			if (next.every((entry, index) => entry.id === favorites[index].id)) return favorites;
			return next;
		}
		/**
		* Move one id to the front of an activation (MRU) order.
		*
		* The front is "most recently activated". Closing the active tab then hands
		* the selection to the next entry — the tab the user was last on.
		* @param order - current order, most-recent-first.
		* @param id - id that just became active.
		* @returns the next order; an unchanged head returns the SAME reference.
		*/
		function touchOrder(order, id) {
			if (order[0] === id) return order;
			return [id, ...order.filter((entry) => entry !== id)];
		}
		/**
		* Drop one id from an activation order.
		* @param order - current order.
		* @param id - id to forget.
		* @returns the next order, the SAME reference when the id was absent.
		*/
		function dropOrder(order, id) {
			const next = order.filter((entry) => entry !== id);
			return next.length === order.length ? order : next;
		}
		/**
		* Pick the tab to activate after closing `closed`.
		*
		* Candidates come from the activation order first, then the retained list as a
		* fallback for tabs never activated in this page (a restored session).
		* @param order - most-recent-first activation order.
		* @param tabs - retained tabs AFTER the removal.
		* @param closed - the id being closed.
		* @returns the id to activate, or undefined when nothing remains.
		*/
		function nextActiveAfterClose(order, tabs, closed) {
			for (const id of order) if (id !== closed && tabs.some((tab) => tab.id === id)) return id;
			for (const tab of tabs) if (tab.id !== closed) return tab.id;
		}
		/**
		* Read the persisted ledger, migrating a legacy payload in place.
		*
		* The migration is idempotent: it only runs for the legacy array shape, so a
		* second load of the rewritten record neither writes nor changes the backup.
		* @param storage - browser storage (or a fake in tests).
		* @returns the ledger; empty when storage is unavailable or corrupt.
		*/
		function loadLedger(storage) {
			if (storage === void 0) return emptyLedger();
			let raw;
			try {
				raw = storage.getItem(STORAGE_KEY);
			} catch {
				return emptyLedger();
			}
			const { ledger, migrated } = parseLedger(raw);
			if (!migrated) return ledger;
			try {
				const alreadyBackedUp = storage.getItem(BACKUP_KEY) !== null;
				if (raw !== null && !alreadyBackedUp) storage.setItem(BACKUP_KEY, raw);
			} catch {}
			saveLedger(storage, ledger);
			return ledger;
		}
		/**
		* Persist both collections, ignoring storage failures (private mode, quota).
		* @param storage - browser storage (or a fake in tests).
		* @param ledger - the record to persist.
		*/
		function saveLedger(storage, ledger) {
			if (storage === void 0) return;
			try {
				storage.setItem(STORAGE_KEY, JSON.stringify({
					tabs: ledger.tabs,
					favorites: ledger.favorites
				}));
			} catch {}
		}
		//#endregion
		//#region src/client/controller.ts
		/**
		* Tab-strip state owner: holds the persisted ledger, exposes a snapshot for
		* useSyncExternalStore, and mutates through the pure store functions.
		*
		* Tabs and favorites are separate collections in the store; this class keeps
		* them separate too. The strip consumes `tabs`, the drawer consumes
		* `favorites`, and closing a tab only ever rewrites the tab list.
		*
		* Kept out of the React component so the rapid-switching path never re-enters
		* a render pass: a mutation that changes nothing returns the same snapshot
		* reference, and subscribers are notified only for real changes.
		*/
		const EMPTY = {
			tabs: [],
			favorites: [],
			order: []
		};
		var RecentTabsController = class {
			storage;
			snapshot = EMPTY;
			listeners = /* @__PURE__ */ new Set();
			constructor(storage) {
				this.storage = storage;
				const { tabs, favorites } = loadLedger(storage);
				this.snapshot = tabs.length === 0 && favorites.length === 0 ? EMPTY : {
					tabs,
					favorites,
					order: tabs.map((tab) => tab.id)
				};
			}
			/** Current snapshot (stable reference until a real change). */
			getSnapshot = () => this.snapshot;
			/** Subscribe to snapshot changes; returns the unsubscriber. */
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			/**
			* Record one session as opened and mark it active.
			* @param id - session identity.
			* @param title - resolved display title.
			*/
			record(id, title) {
				const tabs = recordTab(this.snapshot.tabs, id, title);
				const order = touchOrder(this.snapshot.order, id);
				if (tabs === this.snapshot.tabs && order === this.snapshot.order) return;
				if (tabs !== this.snapshot.tabs) this.persist(tabs, this.snapshot.favorites);
				this.publish(tabs, this.snapshot.favorites, order);
			}
			/**
			* Remove one tab and return the id the caller should activate next.
			*
			* The MRU order decides: the tab the user was last on among the survivors.
			* Bookmarks are untouched — closing a tab is not closing a favorite.
			* @param id - session identity to close.
			* @returns the id to open, or undefined when no tab remains.
			*/
			remove(id) {
				const tabs = removeTab(this.snapshot.tabs, id);
				if (tabs === this.snapshot.tabs) return void 0;
				const order = dropOrder(this.snapshot.order, id);
				this.persist(tabs, this.snapshot.favorites);
				this.publish(tabs, this.snapshot.favorites, order);
				return nextActiveAfterClose(order, tabs, id);
			}
			/**
			* Reorder the strip.
			*
			* Display order is the persisted list's business: the activation order is
			* passed through untouched, so closing a tab afterwards still falls back to
			* the tab the user was actually last on.
			* @param id - the tab being dragged.
			* @param targetId - the tab the drop landed on.
			* @param place - whether it lands before or after the target.
			*/
			move(id, targetId, place) {
				const tabs = moveTab(this.snapshot.tabs, id, targetId, place);
				if (tabs === this.snapshot.tabs) return;
				this.persist(tabs, this.snapshot.favorites);
				this.publish(tabs, this.snapshot.favorites, this.snapshot.order);
			}
			/**
			* Pin or unpin one session.
			*
			* Only the favorites collection changes: the tab list keeps its order and the
			* activation order is passed through, so the strip and the close fallback are
			* unaffected by bookmarking.
			* @param id - session identity.
			* @param title - title to store when pinning; defaults to the short id.
			*/
			toggleFavorite(id, title) {
				const favorites = toggleFavorite(this.snapshot.favorites, id, title);
				if (favorites === this.snapshot.favorites) return;
				this.persist(this.snapshot.tabs, favorites);
				this.publish(this.snapshot.tabs, favorites, this.snapshot.order);
			}
			/**
			* Reorder the drawer.
			*
			* Vertical drag is bookmark-list business only: the strip's order and the
			* activation order both pass through untouched.
			* @param id - the entry being dragged.
			* @param targetId - the entry the drop landed on.
			* @param place - whether it lands before or after the target.
			*/
			moveFavorite(id, targetId, place) {
				const favorites = moveFavorite(this.snapshot.favorites, id, targetId, place);
				if (favorites === this.snapshot.favorites) return;
				this.persist(this.snapshot.tabs, favorites);
				this.publish(this.snapshot.tabs, favorites, this.snapshot.order);
			}
			/** Drop every subscriber (plugin teardown). */
			dispose() {
				this.listeners.clear();
			}
			persist(tabs, favorites) {
				saveLedger(this.storage, {
					tabs,
					favorites
				});
			}
			publish(tabs, favorites, order) {
				this.snapshot = {
					tabs,
					favorites,
					order
				};
				for (const listener of this.listeners) listener();
			}
		};
		//#endregion
		//#region src/client/use-current-session.ts
		/**
		* The session list view every surface of this plugin renders.
		*
		* `currentSessionId` (the selection rule) and the live-title/presence view used
		* to live in the strip alone, but the favorites drawer needs the same answers:
		* which session is active, which ids are still listed, and which titles to
		* show. Both come from one place so the strip and the drawer cannot drift.
		*
		* `SessionListState.current` no longer exists (0.1.6 contract): the selection
		* is the row the main view retains — `retainedBy.mainView` — and a live
		* generation may sit outside the host list's `ids`, so `byId` is consulted as a
		* fallback.
		*/
		/** Empty view, used before the services answer. */
		const EMPTY_SESSION_VIEW = {
			current: void 0,
			liveIds: [],
			titles: {},
			runningIds: /* @__PURE__ */ new Set(),
			completedIds: /* @__PURE__ */ new Set(),
			waitingIds: /* @__PURE__ */ new Set()
		};
		/**
		* Pick the session id the main view holds.
		* @param state - the Session Controller list snapshot (untyped on purpose:
		* the published SDK shapes differ between copies).
		* @returns the current session id, or undefined when nothing is selected.
		*/
		function currentSessionId(state) {
			const row = state;
			const ids = Array.isArray(row?.ids) ? row?.ids : [];
			const byId = row?.byId ?? {};
			for (const id of ids) if ((byId[id]?.retainedBy?.mainView ?? 0) > 0) return id;
			for (const id of Object.keys(byId)) if ((byId[id]?.retainedBy?.mainView ?? 0) > 0) return id;
		}
		/**
		* Reduce the session-list and status snapshots to the fields the surfaces render.
		* @param state - the Session Controller list snapshot.
		* @param status - the ui-session status map snapshot.
		* @returns live ids, titles, running ids, completed ids, waiting ids, and the
		* current selection.
		*/
		function reduceSessions(state, status) {
			const row = state;
			const ids = Array.isArray(row?.ids) ? row?.ids : [];
			const byId = row?.byId ?? {};
			const statuses = status instanceof Map ? status : void 0;
			const titles = {};
			const runningIds = /* @__PURE__ */ new Set();
			const completedIds = /* @__PURE__ */ new Set();
			const waitingIds = /* @__PURE__ */ new Set();
			for (const id of ids) {
				const entry = byId[id];
				const label = entry?.displayTitle ?? entry?.title;
				titles[id] = typeof label === "string" && label.trim() !== "" ? label : shortId(id);
				const fact = statuses?.get(id);
				if (fact !== void 0 ? fact.running === true : entry?.running === true) runningIds.add(id);
				else if (fact?.completionUnread === true) completedIds.add(id);
				if (fact?.pendingInteraction !== void 0) waitingIds.add(id);
			}
			return {
				current: currentSessionId(state),
				liveIds: ids,
				titles,
				runningIds,
				completedIds,
				waitingIds
			};
		}
		/**
		* Follow the session list and the per-session status map.
		*
		* A retained tab whose session left the list stays visible (dimmed) until the
		* user closes it, so the view keeps the titles it last saw.
		* @param ctx - the plugin's client context.
		* @returns the current view (empty until the services answer).
		*/
		function useSessionView(ctx) {
			const sessions = (0, react.useCallback)(() => ctx.get("sessions"), [ctx]);
			const readView = (0, react.useCallback)(() => {
				const list = sessions()?.list;
				const sessionStatus = ctx.get("uiSession")?.sessionStatus;
				if (list === void 0) return EMPTY_SESSION_VIEW;
				return reduceSessions(list.getSnapshot(), sessionStatus?.getSnapshot());
			}, [ctx, sessions]);
			const [view, setView] = (0, react.useState)(() => readView());
			(0, react.useEffect)(() => {
				const sync = () => {
					setView(readView());
				};
				const statuses = ctx.get("uiSession")?.sessionStatus;
				const offList = sessions()?.list.subscribe(sync);
				const offStatus = statuses?.subscribe(sync);
				sync();
				return () => {
					offList?.();
					offStatus?.();
				};
			}, [
				ctx,
				readView,
				sessions
			]);
			return view;
		}
		//#endregion
		//#region src/client/drag-place.ts
		/**
		* Drop-side geometry shared by both draggable surfaces: the horizontal strip
		* and the vertical favorites drawer inside the panel.
		*
		* Kept in its own module so the two cannot drift apart: the side the pointer
		* sits on is what decides whether the dragged item lands before or after the
		* hovered one — left/right for a row, top/bottom for a column.
		*/
		/**
		* Which half of the target the pointer sits in on a horizontal row.
		* @param event - the dragover/drop event, already targeting one item.
		* @returns 'before' for the left half, 'after' for the right half.
		*/
		function placeFor(event) {
			const rect = event.currentTarget.getBoundingClientRect();
			return event.clientX < rect.left + rect.width / 2 ? "before" : "after";
		}
		/**
		* Which half of the target the pointer sits in on a vertical column.
		* @param event - the dragover/drop event, already targeting one item.
		* @returns 'before' for the upper half, 'after' for the lower half.
		*/
		function placeForVertical(event) {
			const rect = event.currentTarget.getBoundingClientRect();
			return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
		}
		//#endregion
		//#region src/client/fav-drawer-state.ts
		/**
		* Open/closed state of the favorites drawer.
		*
		* The button is rendered by the tab strip and the drawer is its own frame-wide
		* overlay registration: two separate mounts, so neither component can own the
		* flag. A module-level observable bridges them, in the same subscribe shape as
		* `controller.ts`. The strip also subscribes, so an open drawer can hold the bar
		* (and the button it is anchored to) on screen.
		*
		* This is pure UI state: it is never persisted and never reaches the store.
		*/
		let open = false;
		const listeners = /* @__PURE__ */ new Set();
		/** Whether the drawer is currently open. */
		function isFavoritesOpen() {
			return open;
		}
		/**
		* Open or close the drawer.
		* @param next - desired state; a no-op returns without notifying.
		*/
		function setFavoritesOpen(next) {
			if (open === next) return;
			open = next;
			for (const listener of listeners) listener();
		}
		/** Flip the drawer. */
		function toggleFavoritesOpen() {
			setFavoritesOpen(!open);
		}
		/**
		* Subscribe to open/close changes.
		* @param listener - called after every real change.
		* @returns the unsubscriber.
		*/
		function subscribeFavoritesOpen(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* recent-tabs surface copy: zh is the key source, en mirrors every key.
		*/
		const zh = {
			"bar.empty": "还没有打开的会话",
			"tab.close": "关闭",
			"tab.switch": "切换到该会话",
			"tab.renameHint": "点击切换，双击重命名，拖动排序",
			"bar.stale": "该会话已不在列表中",
			"tab.running": "AI 执行中",
			"tab.completed": "AI 已回答，尚未查看",
			"tab.waiting": "等待你的回复",
			"tab.dragHint": "拖动调整顺序",
			"star.favorite": "收藏",
			"star.unfavorite": "取消收藏",
			"fav.title": "收藏夹",
			"fav.open": "打开该会话",
			"fav.remove": "取消收藏",
			"fav.button": "收藏夹",
			"fav.empty": "点上面的星标收藏当前会话，或右键顶部标签条里的标签选择收藏",
			"menu.favorite": "收藏",
			"menu.unfavorite": "取消收藏",
			"rename.label": "会话名称",
			"rename.failed": "重命名失败"
		};
		const en = {
			"bar.empty": "No session opened yet",
			"tab.close": "Close",
			"tab.switch": "Switch to this session",
			"tab.renameHint": "Click to switch, double-click to rename, drag to reorder",
			"bar.stale": "This session is no longer listed",
			"tab.running": "AI is running",
			"tab.completed": "AI answered, not viewed yet",
			"tab.waiting": "Waiting for your reply",
			"tab.dragHint": "Drag to reorder",
			"star.favorite": "Add to favorites",
			"star.unfavorite": "Remove from favorites",
			"fav.title": "Favorites",
			"fav.open": "Open this session",
			"fav.remove": "Remove from favorites",
			"fav.button": "Favorites",
			"fav.empty": "Star the session at the top, or right-click a tab in the top strip, to keep it here",
			"menu.favorite": "Add to favorites",
			"menu.unfavorite": "Remove from favorites",
			"rename.label": "Session name",
			"rename.failed": "Rename failed"
		};
		/** Active-locale translator, bound by the client entry after registration. */
		let translate = (key) => zh[key];
		/** Bind the locale-bound translator (installed once by the client entry). */
		function setTranslator(fn) {
			translate = fn;
		}
		/** Translate one key through the active locale, falling back to zh. */
		function t(key) {
			return translate(key);
		}
		//#endregion
		//#region \0dsh-css:my-plugins/dsh-recent-tabs/src/client/recent-tabs.module.css.mjs
		const css = ".e-wQdG_bar,.e-wQdG_menu,.e-wQdG_favPanel{--fav-accent:var(--dsw-alias-state-business-primary,#4176e6)}@supports (color:color-mix(in srgb, transparent, transparent)){.e-wQdG_bar,.e-wQdG_menu,.e-wQdG_favPanel{--fav-accent:color-mix(in srgb, var(--dsw-alias-state-business-primary,#4176e6) 85%, var(--dsw-alias-bg-overlay,#e9ecf2))}}.e-wQdG_zone{z-index:2147483000;pointer-events:auto;height:10px;position:fixed;top:0;left:0;right:0}.e-wQdG_bar{z-index:2147483001;pointer-events:auto;box-sizing:border-box;background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l2,#d8d8d8);width:80vw;box-shadow:0 2px 8px var(--dsw-alias-border-l1,#e5e5e5);border-top:none;border-radius:0 0 9px 9px;align-items:center;gap:6px;padding:6px 10px;font-size:13px;transition:transform .22s cubic-bezier(.22,.61,.36,1),box-shadow .22s;display:flex;position:fixed;top:0;left:50%;overflow:hidden;transform:translate(-50%)translateY(-100%)}@supports (color:color-mix(in srgb, transparent, transparent)){.e-wQdG_bar{box-shadow:0 4px 18px color-mix(in srgb, var(--dsw-alias-label-primary,#111) 8%, transparent)}.e-wQdG_bar[data-open=\"1\"]{box-shadow:0 6px 20px color-mix(in srgb, var(--dsw-alias-label-primary,#111) 10%, transparent)}}.e-wQdG_bar[data-open=\"1\"]{transform:translate(-50%)translateY(0)}.e-wQdG_stripRow{scrollbar-width:thin;flex:auto;align-items:center;gap:6px;min-width:0;display:flex;overflow:auto hidden}.e-wQdG_tab{box-sizing:border-box;cursor:pointer;width:150px;color:var(--dsw-alias-label-secondary,#666);background:var(--dsw-alias-bg-layer-2,#f5f5f5);user-select:none;border:1px solid #0000;border-radius:7px;flex:none;align-items:center;gap:6px;padding:5px 8px;transition:background-color .14s,border-color .14s,color .14s,box-shadow .14s,opacity .14s;display:flex}.e-wQdG_tab:hover{color:var(--dsw-alias-label-primary,#111);background:var(--dsw-alias-bg-layer-1,#fff);border-color:var(--dsw-alias-border-l1,#e5e5e5)}.e-wQdG_tab[data-active=\"1\"]{color:var(--dsw-alias-label-primary,#111);background:var(--dsw-alias-bg-layer-1,#fff);border-color:var(--fav-accent)}.e-wQdG_tab[data-stale=\"1\"] .e-wQdG_label{opacity:.65;text-decoration:line-through}.e-wQdG_tab[data-dragging=\"1\"]{opacity:.4}.e-wQdG_tab[data-drop=before]{box-shadow:inset 2px 0 0 0 var(--fav-accent)}.e-wQdG_tab[data-drop=after]{box-shadow:inset -2px 0 0 0 var(--fav-accent)}.e-wQdG_label{text-overflow:ellipsis;white-space:nowrap;flex:auto;order:2;min-width:0;overflow:hidden}.e-wQdG_dot{background:var(--dsw-alias-state-success-primary,#16a34a);border-radius:50%;flex:none;width:6px;height:6px}.e-wQdG_runSpinner{box-sizing:border-box;border:2px solid var(--fav-accent);border-top-color:#0000;border-radius:50%;flex:none;width:12px;height:12px;animation:.9s linear infinite e-wQdG_run-spin}@keyframes e-wQdG_run-spin{to{transform:rotate(360deg)}}.e-wQdG_doneMark{background:var(--fav-accent);clip-path:polygon(38% 72%,82% 20%,92% 30%,39% 90%,8% 56%,18% 46%);flex:none;width:9px;height:9px}.e-wQdG_waitMark{width:12px;height:12px;color:var(--fav-accent);flex:none;justify-content:center;align-items:center;font-size:12px;font-weight:700;line-height:1;display:inline-flex}.e-wQdG_waitMark:after{content:\"?\"}.e-wQdG_close{text-align:center;width:16px;height:16px;color:var(--dsw-alias-label-secondary,#888);cursor:pointer;background:0 0;border:none;border-radius:5px;flex:none;order:3;padding:0;font-size:14px;line-height:14px;transition:color .14s,background-color .14s}.e-wQdG_close:hover{color:var(--dsw-alias-state-error-primary,#dc2626);background:var(--dsw-alias-bg-layer-2,#eee)}.e-wQdG_empty{text-align:center;color:var(--dsw-alias-label-secondary,#888);letter-spacing:.02em;flex:auto;padding:8px 4px;font-size:12px}.e-wQdG_editor{box-sizing:border-box;width:100%;min-width:0;font:inherit;color:var(--dsw-alias-label-primary,#111);background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-brand-primary,#2563eb);border-radius:6px;outline:none;flex:auto;padding:2px 4px}.e-wQdG_error{color:var(--dsw-alias-state-error-primary,#dc2626);white-space:nowrap;padding:0 4px}.e-wQdG_menu{z-index:2147483002;box-sizing:border-box;background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l1,#e5e5e5);min-width:140px;box-shadow:0 6px 18px var(--dsw-alias-border-l1,#e5e5e5);border-radius:10px;padding:4px;font-size:12px;position:fixed}@supports (color:color-mix(in srgb, transparent, transparent)){.e-wQdG_menu{box-shadow:0 8px 22px color-mix(in srgb, var(--dsw-alias-label-primary,#111) 18%, transparent)}}.e-wQdG_menuItem{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-primary,#111);font:inherit;text-align:left;cursor:pointer;background:0 0;border:none;border-radius:6px;padding:6px 10px;transition:background-color .12s;display:block}.e-wQdG_menuItem:hover{background:var(--dsw-alias-bg-layer-2,#f5f5f5)}.e-wQdG_menuItem[data-dsh-part=tab-menu-favorite]{color:var(--fav-accent)}.e-wQdG_menuItem[data-dsh-part=tab-menu-favorite][data-favorite=\"1\"]{font-weight:600}@supports (color:color-mix(in srgb, transparent, transparent)){.e-wQdG_menuItem[data-dsh-part=tab-menu-favorite]:hover{background:color-mix(in srgb, var(--fav-accent) 10%, transparent)}}.e-wQdG_barButton{border:1px solid var(--dsw-alias-border-l1,#e5e5e5);color:var(--dsw-alias-label-secondary,#666);font:inherit;cursor:pointer;user-select:none;background:0 0;border-radius:7px;flex:none;justify-content:center;align-self:center;align-items:center;gap:5px;padding:4px 8px;font-size:12px;line-height:1.4;transition:color .14s,background-color .14s,border-color .14s;display:inline-flex}.e-wQdG_barButton:hover{color:var(--dsw-alias-label-primary,#111);background:var(--dsw-alias-bg-layer-2,#f5f5f5)}.e-wQdG_barButton[aria-expanded=true]{color:var(--fav-accent);background:var(--dsw-alias-bg-layer-2,#f5f5f5);border-color:var(--dsw-alias-border-l1,#e5e5e5)}@supports (color:color-mix(in srgb, transparent, transparent)){.e-wQdG_barButton{border-color:color-mix(in srgb, var(--fav-accent) 22%, transparent)}.e-wQdG_barButton:hover{border-color:color-mix(in srgb, var(--fav-accent) 32%, transparent)}.e-wQdG_barButton[aria-expanded=true]{background:color-mix(in srgb, var(--fav-accent) 12%, transparent);border-color:color-mix(in srgb, var(--fav-accent) 40%, transparent)}}.e-wQdG_barButtonLabel{white-space:nowrap}.e-wQdG_favPanel{z-index:2147483003;box-sizing:border-box;background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l1,#e5e5e5);width:200px;max-width:calc(100vw - 24px);max-height:min(60vh,520px);box-shadow:0 2px 8px var(--dsw-alias-border-l1,#e5e5e5);color:var(--dsw-alias-label-primary,#111);border-radius:10px;outline:none;flex-direction:column;gap:6px;padding:8px 6px 8px 8px;font-size:12px;animation:.18s cubic-bezier(.22,.61,.36,1) e-wQdG_favorites-in;display:flex;position:fixed;overflow:hidden}@supports (color:color-mix(in srgb, transparent, transparent)){.e-wQdG_favPanel{border-color:color-mix(in srgb, var(--fav-accent) 18%, transparent);box-shadow:0 3px 10px color-mix(in srgb, var(--dsw-alias-label-primary,#111) 10%, transparent)}}@keyframes e-wQdG_favorites-in{0%{opacity:0;transform:translate(16px)}to{opacity:1;transform:translate(0)}}.e-wQdG_favHead{border-bottom:1px solid var(--dsw-alias-border-l1,#e5e5e5);flex:none;justify-content:space-between;align-items:center;gap:8px;padding:2px 2px 6px;display:flex}@supports (color:color-mix(in srgb, transparent, transparent)){.e-wQdG_favHead{border-bottom-color:color-mix(in srgb, var(--fav-accent) 32%, transparent)}}.e-wQdG_favTitle{letter-spacing:.02em;color:var(--fav-accent);font-size:12px;font-weight:600}.e-wQdG_favEmpty{color:var(--dsw-alias-label-secondary,#888);margin:0;padding:2px;font-size:12px;line-height:1.6}.e-wQdG_favList{scrollbar-width:thin;flex-direction:column;flex:auto;gap:2px;min-height:0;display:flex;overflow:hidden auto}.e-wQdG_favItem{box-sizing:border-box;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;user-select:none;background:0 0;border:1px solid #0000;border-radius:6px;flex:none;align-items:center;gap:6px;padding:6px 8px;transition:background-color .14s,color .14s,opacity .14s;display:flex}.e-wQdG_favItem:hover,.e-wQdG_favItem[data-active=\"1\"]{background:var(--dsw-alias-bg-layer-2,#f5f5f5);color:var(--dsw-alias-label-primary,#111)}@supports (color:color-mix(in srgb, transparent, transparent)){.e-wQdG_favItem[data-active=\"1\"]{background:color-mix(in srgb, var(--fav-accent) 14%, transparent)}}.e-wQdG_favItem[data-stale=\"1\"] .e-wQdG_favItemLabel{opacity:.65;text-decoration:line-through}.e-wQdG_favItem[data-dragging=\"1\"]{opacity:.4}.e-wQdG_favItem[data-drop=before]{box-shadow:inset 0 2px 0 0 var(--fav-accent)}.e-wQdG_favItem[data-drop=after]{box-shadow:inset 0 -2px 0 0 var(--fav-accent)}.e-wQdG_favItemLabel{text-overflow:ellipsis;white-space:nowrap;flex:auto;min-width:0;overflow:hidden}.e-wQdG_starGlyph,.e-wQdG_favStar{clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%);background:currentColor;flex:none;display:block}.e-wQdG_starGlyph{width:1em;height:1em}.e-wQdG_barButton .e-wQdG_starGlyph{color:var(--fav-accent)}.e-wQdG_favStar{width:10px;height:10px;color:var(--fav-accent)}.e-wQdG_starButton{width:1.6em;height:1.6em;color:var(--dsw-alias-label-secondary,#888);cursor:pointer;background:0 0;border:none;border-radius:.4em;flex:none;justify-content:center;align-items:center;padding:0;transition:color .14s,background-color .14s;display:inline-flex}.e-wQdG_starButton:hover{color:var(--fav-accent);background:var(--dsw-alias-bg-layer-2,#f5f5f5)}.e-wQdG_starButton[data-favorite=\"1\"]{color:var(--fav-accent)}.e-wQdG_favRemove{text-align:center;width:16px;height:16px;color:var(--dsw-alias-label-secondary,#888);cursor:pointer;opacity:0;background:0 0;border:none;border-radius:4px;flex:none;padding:0;font-size:12px;line-height:14px;transition:color .14s,background-color .14s,opacity .14s}.e-wQdG_favItem:hover .e-wQdG_favRemove,.e-wQdG_favItem:focus-within .e-wQdG_favRemove{opacity:1}.e-wQdG_favRemove:hover{color:var(--dsw-alias-state-error-primary,#dc2626);background:var(--dsw-alias-bg-layer-2,#eee)}@media (prefers-reduced-motion:reduce){.e-wQdG_runSpinner,.e-wQdG_favPanel{animation:none}.e-wQdG_bar,.e-wQdG_tab,.e-wQdG_menuItem,.e-wQdG_barButton,.e-wQdG_favItem,.e-wQdG_starButton,.e-wQdG_favRemove{transition:none}}";
		const tagId = "dsh-recent-tabs/recent-tabs.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-recent-tabs";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var recent_tabs_module_css_default = {
			"bar": "e-wQdG_bar",
			"barButton": "e-wQdG_barButton",
			"barButtonLabel": "e-wQdG_barButtonLabel",
			"close": "e-wQdG_close",
			"doneMark": "e-wQdG_doneMark",
			"dot": "e-wQdG_dot",
			"editor": "e-wQdG_editor",
			"empty": "e-wQdG_empty",
			"error": "e-wQdG_error",
			"favEmpty": "e-wQdG_favEmpty",
			"favHead": "e-wQdG_favHead",
			"favItem": "e-wQdG_favItem",
			"favItemLabel": "e-wQdG_favItemLabel",
			"favList": "e-wQdG_favList",
			"favPanel": "e-wQdG_favPanel",
			"favRemove": "e-wQdG_favRemove",
			"favStar": "e-wQdG_favStar",
			"favTitle": "e-wQdG_favTitle",
			"favorites-in": "e-wQdG_favorites-in",
			"label": "e-wQdG_label",
			"menu": "e-wQdG_menu",
			"menuItem": "e-wQdG_menuItem",
			"run-spin": "e-wQdG_run-spin",
			"runSpinner": "e-wQdG_runSpinner",
			"starButton": "e-wQdG_starButton",
			"starGlyph": "e-wQdG_starGlyph",
			"stripRow": "e-wQdG_stripRow",
			"tab": "e-wQdG_tab",
			"waitMark": "e-wQdG_waitMark",
			"zone": "e-wQdG_zone"
		};
		//#endregion
		//#region src/client/FavoriteButton.tsx
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
		/**
		* Render the favorites trigger.
		* @returns the star-and-label button bound to the drawer state.
		*/
		function FavoriteButton() {
			const open = (0, react.useSyncExternalStore)(subscribeFavoritesOpen, isFavoritesOpen);
			const label = t("fav.button");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				className: recent_tabs_module_css_default.barButton,
				type: "button",
				"data-dsh-plugin": "recent-tabs",
				"data-dsh-part": "favorite-button",
				"aria-haspopup": "dialog",
				"aria-expanded": open,
				"aria-label": label,
				title: label,
				onClick: () => {
					toggleFavoritesOpen();
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: recent_tabs_module_css_default.starGlyph,
					"aria-hidden": "true"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: recent_tabs_module_css_default.barButtonLabel,
					children: label
				})]
			});
		}
		//#endregion
		//#region src/client/RecentTabs.tsx
		/**
		* The hover-revealed tab strip: one row of recent-session tabs.
		*
		* Data comes from the Client services directly (`ctx.get`), not from Slot
		* props: the strip is global, while Slot props are scoped to a session. The
		* store owns the retained list; this component only renders it.
		*
		* Renaming edits the SESSION, not just the tab: it settles the host 'title'
		* projection, and the next list snapshot carries the new name into every
		* consumer (this strip included). The tab list therefore stays free of a
		* second, divergent title source.
		*
		* Favorites are not a tab field: the star trigger sits at the far right of this
		* very bar (`FavoriteButton.tsx`), and the bookmark list is the drawer on the
		* right edge (`FavoritesPanel.tsx`). The strip only offers the per-tab context
		* menu that pins or unpins one tab, and that menu writes to the store's
		* favorites collection — never to the tab row, so closing the tab keeps the
		* bookmark.
		*
		* The bar is also the drawer's anchor, so the two are coupled in one direction:
		* while the drawer is open the bar is held on screen even with the pointer far
		* away, because a parked bar would put the button (and thus the anchor) above
		* the viewport.
		*
		* Migrated for dsh `0.1.6-alpha.2` (see `sessions-face.ts` for the contract
		* changes): the current session is now read off local retention
		* (`retainedBy.mainView`), switching goes through `uiWorkspace.openSession`,
		* and the running flag comes from the ui-session status map.
		*
		* A tab carries three status markers, never more than one at a time: the
		* spinner while its agent turn is executing ("waiting for the answer"), a small
		* static blue check while a turn has finished that the user has not
		* acknowledged ("the answer landed while you were elsewhere"), and a small
		* blue question mark while the session is blocked on an interaction the user
		* has not answered yet ("it asked you something"). Precedence is
		* waiting > running > completed: a question outranks the turn facts because the
		* turn cannot proceed until it is answered, and a turn that is executing again
		* outranks a stale unread flag. With none of the three the tab is plain. All
		* marks sit in the same leading slot before the title, and the active dot is a
		* separate, later slot — "you are here" is not a status of the turn.
		*/
		/**
		* Reference-source label for the strip's own transient holds. Retention counts
		* are keyed by free-form consumer labels; `mainView` is ui-session's marker for
		* the current selection, so this plugin must use a distinct key or it would
		* masquerade as the main view.
		*/
		const RETAIN_SOURCE = "recentTabsRename";
		/** Menu width/height budget used to keep the popup inside the viewport. */
		const MENU_WIDTH = 150;
		const MENU_HEIGHT = 44;
		/** Pixels in one wheel "line"; the browser-typical row height for `deltaMode` 1. */
		const WHEEL_LINE_PX = 16;
		/**
		* Convert one wheel delta axis into pixels.
		*
		* `deltaMode` names the UNIT the delta is counted in, not what it means: 0 is
		* already pixels, 1 counts lines, 2 counts pages. Anything else is a mode this
		* browser does not document, so the raw delta is used rather than guessing a
		* factor.
		* @param delta - the raw delta of one axis.
		* @param mode - the event's `deltaMode`.
		* @param page - one page in pixels, i.e. the scrolling row's own width.
		*/
		function wheelPixels(delta, mode, page) {
			if (mode === 1) return delta * WHEEL_LINE_PX;
			if (mode === 2) return delta * page;
			return delta;
		}
		/**
		* Render the tab strip.
		* @param props - controller and the plugin's client context.
		*/
		function RecentTabs({ controller, ctx }) {
			const snapshot = (0, react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot);
			const sessions = (0, react.useCallback)(() => ctx.get("sessions"), [ctx]);
			const live = useSessionView(ctx);
			const currentId = live.current;
			const currentTitle = currentId === void 0 ? void 0 : live.titles[currentId];
			(0, react.useEffect)(() => {
				if (currentId === void 0) return;
				controller.record(currentId, currentTitle ?? shortId(currentId));
			}, [
				controller,
				currentId,
				currentTitle
			]);
			const [open, setOpen] = (0, react.useState)(false);
			const hide = (0, react.useRef)(void 0);
			/** Drawer open state, mirrored from the module-level observable. */
			const favoritesOpen = (0, react.useSyncExternalStore)(subscribeFavoritesOpen, isFavoritesOpen);
			/** Read by the hide timer, which must not retract from under the drawer. */
			const drawerOpenRef = (0, react.useRef)(favoritesOpen);
			/** Whether the pointer is on the bar right now (closing the drawer by button). */
			const hoverRef = (0, react.useRef)(false);
			/** Tracks the open -> closed edge, so the 260ms timer only restarts once. */
			const drawerWasOpen = (0, react.useRef)(favoritesOpen);
			(0, react.useEffect)(() => {
				drawerOpenRef.current = favoritesOpen;
			}, [favoritesOpen]);
			const clearHide = (0, react.useCallback)(() => {
				if (hide.current !== void 0) {
					clearTimeout(hide.current);
					hide.current = void 0;
				}
			}, []);
			const show = (0, react.useCallback)(() => {
				clearHide();
				setOpen(true);
			}, [clearHide]);
			/** Menu open right now, or undefined. */
			const [menu, setMenu] = (0, react.useState)(void 0);
			const menuRef = (0, react.useRef)(null);
			/** Read by the hover timer so an open menu keeps the bar on screen. */
			const menuOpenRef = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				menuOpenRef.current = menu !== void 0;
			}, [menu]);
			const scheduleHide = (0, react.useCallback)(() => {
				clearHide();
				hide.current = setTimeout(() => {
					hide.current = void 0;
					if (menuOpenRef.current) return;
					if (drawerOpenRef.current) return;
					setOpen(false);
				}, 260);
			}, [clearHide]);
			(0, react.useEffect)(() => {
				if (favoritesOpen) {
					drawerWasOpen.current = true;
					show();
					return;
				}
				if (!drawerWasOpen.current) return;
				drawerWasOpen.current = false;
				if (!hoverRef.current) scheduleHide();
			}, [
				favoritesOpen,
				scheduleHide,
				show
			]);
			(0, react.useEffect)(() => clearHide, [clearHide]);
			(0, react.useEffect)(() => {
				if (menu === void 0) return;
				const close = () => {
					setMenu(void 0);
				};
				const onPointerDown = (event) => {
					const target = event.target;
					if (target instanceof Node && menuRef.current?.contains(target) === true) return;
					close();
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") close();
				};
				document.addEventListener("mousedown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				window.addEventListener("scroll", close, true);
				window.addEventListener("blur", close);
				return () => {
					document.removeEventListener("mousedown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
					window.removeEventListener("scroll", close, true);
					window.removeEventListener("blur", close);
				};
			}, [menu]);
			/**
			* The row scrolls on its own already, but only through its scrollbar or a
			* trackpad gesture; a plain mouse wheel over it has nothing vertical to
			* consume and does nothing. Turn that wheel into horizontal travel, the way a
			* browser's tab bar does it, so no Shift is needed.
			*
			* Bound to the row, never to the bar: the favorites trigger sits in the bar
			* but outside the row and must not move the tabs, and a wheel anywhere else
			* stays the page's. `passive: false` is what lets `preventDefault` bite here,
			* which is why this is a native listener rather than React's synthetic
			* `onWheel`.
			*/
			const stripRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const row = stripRef.current;
				if (row === null) return;
				const onWheel = (event) => {
					if (event.deltaY === 0) return;
					if (event.ctrlKey) return;
					event.preventDefault();
					const page = row.clientWidth;
					row.scrollLeft += wheelPixels(event.deltaY, event.deltaMode, page) + wheelPixels(event.deltaX, event.deltaMode, page);
				};
				row.addEventListener("wheel", onWheel, { passive: false });
				return () => {
					row.removeEventListener("wheel", onWheel);
				};
			}, []);
			/** Navigation lives with ui-workspace since 0.1.6; `sessions.open` is gone. */
			const openSession = (0, react.useCallback)((id) => {
				const uiWorkspace = ctx.get("uiWorkspace");
				if (uiWorkspace === void 0) {
					console.warn("[recent-tabs] ui-workspace is unavailable; cannot switch sessions");
					return;
				}
				uiWorkspace.openSession(id);
			}, [ctx]);
			const switchTo = (0, react.useCallback)((id) => {
				if (live.current === id) return;
				openSession(id);
			}, [live.current, openSession]);
			const closeTab = (0, react.useCallback)((id) => {
				const wasActive = live.current === id;
				const fallback = controller.remove(id);
				if (!wasActive || fallback === void 0) return;
				openSession(fallback);
			}, [
				controller,
				live.current,
				openSession
			]);
			/** Source tab of the current drag (state drives styling, ref the handlers). */
			const [draggingId, setDraggingId] = (0, react.useState)(void 0);
			/** Tab under the pointer with the side the dragged tab would land on. */
			const [dropTarget, setDropTarget] = (0, react.useState)(void 0);
			const draggingRef = (0, react.useRef)(void 0);
			const dropRef = (0, react.useRef)(void 0);
			const endDrag = (0, react.useCallback)(() => {
				draggingRef.current = void 0;
				dropRef.current = void 0;
				setDraggingId(void 0);
				setDropTarget(void 0);
			}, []);
			const startDrag = (0, react.useCallback)((event, id) => {
				draggingRef.current = id;
				dropRef.current = void 0;
				setDraggingId(id);
				setDropTarget(void 0);
				const transfer = event.dataTransfer;
				transfer?.setData("text/plain", id);
				if (transfer !== void 0) transfer.effectAllowed = "move";
			}, []);
			const dragOverTab = (0, react.useCallback)((event, id) => {
				const source = draggingRef.current;
				if (source === void 0 || source === id) return;
				event.preventDefault();
				const transfer = event.dataTransfer;
				if (transfer !== void 0) transfer.dropEffect = "move";
				const place = placeFor(event);
				const previous = dropRef.current;
				if (previous !== void 0 && previous.id === id && previous.place === place) return;
				dropRef.current = {
					id,
					place
				};
				setDropTarget({
					id,
					place
				});
			}, []);
			const dropOnTab = (0, react.useCallback)((event, id) => {
				event.preventDefault();
				event.stopPropagation();
				const source = draggingRef.current;
				if (source !== void 0 && source !== id) {
					const target = dropRef.current;
					const place = target !== void 0 && target.id === id ? target.place : placeFor(event);
					controller.move(source, id, place);
				}
				endDrag();
			}, [controller, endDrag]);
			/** Session id being renamed, or undefined when no editor is open. */
			const [editing, setEditing] = (0, react.useState)(void 0);
			const [draft, setDraft] = (0, react.useState)("");
			const [error, setError] = (0, react.useState)(void 0);
			const inputRef = (0, react.useRef)(null);
			/** Refs so the blur path sees live values without re-creating handlers. */
			const editingRef = (0, react.useRef)(void 0);
			const draftRef = (0, react.useRef)("");
			const beginRename = (0, react.useCallback)((id, title) => {
				editingRef.current = id;
				draftRef.current = title;
				setEditing(id);
				setDraft(title);
				setError(void 0);
			}, []);
			const cancelRename = (0, react.useCallback)(() => {
				editingRef.current = void 0;
				setEditing(void 0);
				setError(void 0);
			}, []);
			const commitRename = (0, react.useCallback)(async (id, raw) => {
				const title = raw.trim();
				if (title === "") {
					cancelRename();
					return;
				}
				if (title === (live.titles[id] ?? "")) {
					cancelRename();
					return;
				}
				const service = sessions();
				if (service === void 0) {
					cancelRename();
					return;
				}
				try {
					const held = service.binding(id);
					if ((held !== void 0 ? await held.session.rename(title) : await service.using(id, { source: RETAIN_SOURCE }, (reference) => reference.binding.session.rename(title))).ok) {
						cancelRename();
						return;
					}
				} catch (failure) {
					console.warn("[recent-tabs] rename failed:", failure);
				}
				setError(t("rename.failed"));
			}, [
				cancelRename,
				live.titles,
				sessions
			]);
			(0, react.useEffect)(() => {
				if (editing === void 0) return;
				const input = inputRef.current;
				if (input === null) return;
				input.focus();
				input.select();
			}, [editing]);
			const onEditorKeyDown = (0, react.useCallback)((event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					const id = editingRef.current;
					if (id !== void 0) commitRename(id, draftRef.current);
					return;
				}
				if (event.key === "Escape") {
					event.preventDefault();
					cancelRename();
				}
			}, [commitRename, cancelRename]);
			const rows = snapshot.tabs.map((tab) => {
				const active = live.current === tab.id;
				const isLive = live.liveIds.indexOf(tab.id) >= 0;
				const waiting = isLive && live.waitingIds.has(tab.id);
				const running = !waiting && isLive && live.runningIds.has(tab.id);
				const completed = !waiting && !running && isLive && live.completedIds.has(tab.id);
				const title = isLive ? live.titles[tab.id] : tab.title;
				const drop = dropTarget !== void 0 && dropTarget.id === tab.id ? dropTarget.place : void 0;
				if (editing === tab.id) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: recent_tabs_module_css_default.tab,
					draggable: false,
					"data-active": active ? "1" : "0",
					"data-editing": "1",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						ref: inputRef,
						className: recent_tabs_module_css_default.editor,
						value: draft,
						"aria-label": t("rename.label"),
						onChange: (event) => {
							draftRef.current = event.target.value;
							setDraft(event.target.value);
						},
						onKeyDown: onEditorKeyDown,
						onBlur: () => {
							const id = editingRef.current;
							if (id !== void 0) commitRename(id, draftRef.current);
						},
						onClick: (event) => event.stopPropagation(),
						onDoubleClick: (event) => event.stopPropagation()
					})
				}, tab.id);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: recent_tabs_module_css_default.tab,
					draggable: true,
					"data-active": active ? "1" : "0",
					"data-stale": isLive ? "0" : "1",
					"data-dragging": draggingId === tab.id ? "1" : "0",
					"data-drop": drop,
					title: isLive ? t("tab.renameHint") : t("bar.stale"),
					onClick: () => switchTo(tab.id),
					onDoubleClick: (event) => {
						event.stopPropagation();
						if (!isLive) return;
						beginRename(tab.id, title);
					},
					onContextMenu: (event) => {
						event.preventDefault();
						event.stopPropagation();
						setMenu({
							id: tab.id,
							x: event.clientX,
							y: event.clientY
						});
					},
					onDragStart: (event) => startDrag(event, tab.id),
					onDragOver: (event) => dragOverTab(event, tab.id),
					onDrop: (event) => dropOnTab(event, tab.id),
					onDragEnd: endDrag,
					children: [
						waiting ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: recent_tabs_module_css_default.waitMark,
							role: "img",
							"aria-label": t("tab.waiting")
						}) : null,
						running ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: recent_tabs_module_css_default.runSpinner,
							role: "img",
							"aria-label": t("tab.running")
						}) : null,
						completed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: recent_tabs_module_css_default.doneMark,
							role: "img",
							"aria-label": t("tab.completed")
						}) : null,
						active ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: recent_tabs_module_css_default.dot }) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: recent_tabs_module_css_default.label,
							children: title
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: recent_tabs_module_css_default.close,
							type: "button",
							title: t("tab.close"),
							onClick: (event) => {
								event.stopPropagation();
								closeTab(tab.id);
							},
							children: "×"
						})
					]
				}, tab.id);
			});
			/** The retained row the menu opened on, if it is still there. */
			const menuTab = menu === void 0 ? void 0 : snapshot.tabs.find((tab) => tab.id === menu.id);
			const menuFavorite = menu !== void 0 && snapshot.favorites.some((entry) => entry.id === menu.id);
			const menuTitle = menuTab === void 0 ? void 0 : (live.liveIds.indexOf(menuTab.id) >= 0 ? live.titles[menuTab.id] : void 0) ?? menuTab.title;
			const menuStyle = menu === void 0 ? void 0 : {
				left: Math.max(8, Math.min(menu.x, window.innerWidth - MENU_WIDTH - 8)),
				top: Math.max(8, Math.min(menu.y, window.innerHeight - MENU_HEIGHT - 8))
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: recent_tabs_module_css_default.zone,
					onMouseEnter: show,
					onMouseLeave: () => {
						if (!hoverRef.current) scheduleHide();
					}
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: recent_tabs_module_css_default.bar,
					"data-open": open || favoritesOpen ? "1" : "0",
					"data-dsh-plugin": "recent-tabs",
					"data-dsh-part": "bar",
					title: snapshot.tabs.length > 0 ? t("tab.dragHint") : void 0,
					onMouseEnter: () => {
						hoverRef.current = true;
						show();
					},
					onMouseLeave: () => {
						hoverRef.current = false;
						scheduleHide();
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: recent_tabs_module_css_default.stripRow,
							ref: stripRef,
							children: rows.length > 0 ? rows : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: recent_tabs_module_css_default.empty,
								children: t("bar.empty")
							})
						}),
						error !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: recent_tabs_module_css_default.error,
							role: "alert",
							children: error
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FavoriteButton, {})
					]
				}),
				menu === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					ref: menuRef,
					className: recent_tabs_module_css_default.menu,
					role: "menu",
					"data-dsh-plugin": "recent-tabs",
					"data-dsh-part": "tab-menu",
					style: menuStyle,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: recent_tabs_module_css_default.menuItem,
						type: "button",
						role: "menuitem",
						"data-dsh-part": "tab-menu-favorite",
						"data-favorite": menuFavorite ? "1" : "0",
						onClick: () => {
							controller.toggleFavorite(menu.id, menuTitle);
							setMenu(void 0);
						},
						children: menuFavorite ? t("menu.unfavorite") : t("menu.favorite")
					})
				})
			] });
		}
		//#endregion
		//#region src/client/FavoritesPanel.tsx
		/**
		* The favorites drawer: a browser-bookmark-like panel that slides in from the
		* right edge of the conversation area, under the button at the right end of the
		* tab strip.
		*
		* Registered in `shell.overlay` (additive, next to the tab strip). It is
		* `position: fixed` and anchored to that button's own rectangle rather than to
		* any shell class name: opening the official right dock narrows the main panel
		* and moves the button, and the drawer follows it instead of covering the dock.
		* The strip holds itself on screen while this drawer is open (see
		* `RecentTabs.tsx`), so the anchor is never parked above the viewport; the
		* clamp here is the belt to that braces.
		*
		* Closed means unmounted — there is no hidden DOM. Open state is shared with
		* the button through `fav-drawer-state.ts`; the entries come from the store's
		* own favorites collection (so a bookmark outlives the tab that opened it),
		* titles from the same `useSessionView` hook the strip uses, and navigation
		* goes through `uiWorkspace.openSession` (never a direct `sessions.open`).
		*
		* Sized as a compact panel rather than a full-height column: its height follows
		* the content (see the CSS `max-height`), so it stops well above the composer
		* instead of covering the conversation all the way down.
		*/
		/** Fallback when the favorites trigger is not on screen (another layout, a test). */
		const FALLBACK_ANCHOR = {
			right: 24,
			top: 64
		};
		/** Distance kept between the button and the drawer, and from the viewport edge. */
		const GAP = 6;
		const EDGE = 12;
		/** The drawer never hugs the very top, even when its anchor is off-screen. */
		const MIN_TOP = 8;
		/** The favorites trigger, located by its own semantic attribute — never a shell class. */
		function findFavoriteButton() {
			return document.querySelector("[data-dsh-part=\"favorite-button\"]");
		}
		/**
		* Render the favorites drawer.
		* @param props - controller and the plugin's client context.
		* @returns the drawer, or null while it is closed.
		*/
		function FavoritesPanel({ controller, ctx }) {
			const open = (0, react.useSyncExternalStore)(subscribeFavoritesOpen, isFavoritesOpen);
			const snapshot = (0, react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot);
			const live = useSessionView(ctx);
			const panelRef = (0, react.useRef)(null);
			const [anchor, setAnchor] = (0, react.useState)(FALLBACK_ANCHOR);
			/**
			* Re-read the button rectangle. The drawer hangs off the button's right and
			* bottom edges, so it tracks the official right dock as it opens or closes.
			*/
			const measure = (0, react.useCallback)(() => {
				const button = findFavoriteButton();
				if (button === null) {
					setAnchor(FALLBACK_ANCHOR);
					return;
				}
				const rect = button.getBoundingClientRect();
				const width = typeof window === "undefined" ? 0 : window.innerWidth;
				setAnchor({
					right: Math.max(EDGE, width - rect.right),
					top: Math.max(MIN_TOP, rect.bottom + GAP)
				});
			}, []);
			(0, react.useEffect)(() => {
				if (!open) return;
				measure();
				window.addEventListener("resize", measure);
				const watched = [];
				let node = findFavoriteButton()?.parentElement ?? null;
				while (node !== null && watched.length < 8) {
					watched.push(node);
					node = node.parentElement;
				}
				const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
					measure();
				}) : void 0;
				watched.forEach((element) => observer?.observe(element));
				return () => {
					window.removeEventListener("resize", measure);
					observer?.disconnect();
				};
			}, [measure, open]);
			(0, react.useEffect)(() => {
				if (!open) return;
				panelRef.current?.focus();
			}, [open]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					const target = event.target;
					if (!(target instanceof Node)) return;
					if (panelRef.current?.contains(target) === true) return;
					if (findFavoriteButton()?.contains(target) === true) return;
					setFavoritesOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") setFavoritesOpen(false);
				};
				document.addEventListener("mousedown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("mousedown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [open]);
			/** Navigation lives with ui-workspace since 0.1.6; `sessions.open` is gone. */
			const openSession = (0, react.useCallback)((id) => {
				const uiWorkspace = ctx.get("uiWorkspace");
				if (uiWorkspace === void 0) {
					console.warn("[recent-tabs] ui-workspace is unavailable; cannot switch sessions");
					return;
				}
				uiWorkspace.openSession(id);
			}, [ctx]);
			const switchTo = (0, react.useCallback)((id) => {
				if (live.current === id) return;
				openSession(id);
			}, [live.current, openSession]);
			const [draggingId, setDraggingId] = (0, react.useState)(void 0);
			const [dropTarget, setDropTarget] = (0, react.useState)(void 0);
			const draggingRef = (0, react.useRef)(void 0);
			const dropRef = (0, react.useRef)(void 0);
			const endDrag = (0, react.useCallback)(() => {
				draggingRef.current = void 0;
				dropRef.current = void 0;
				setDraggingId(void 0);
				setDropTarget(void 0);
			}, []);
			const startDrag = (0, react.useCallback)((event, id) => {
				draggingRef.current = id;
				dropRef.current = void 0;
				setDraggingId(id);
				setDropTarget(void 0);
				const transfer = event.dataTransfer;
				transfer?.setData("text/plain", id);
				if (transfer !== void 0) transfer.effectAllowed = "move";
			}, []);
			const dragOverItem = (0, react.useCallback)((event, id) => {
				const source = draggingRef.current;
				if (source === void 0 || source === id) return;
				event.preventDefault();
				const transfer = event.dataTransfer;
				if (transfer !== void 0) transfer.dropEffect = "move";
				const place = placeForVertical(event);
				const previous = dropRef.current;
				if (previous !== void 0 && previous.id === id && previous.place === place) return;
				dropRef.current = {
					id,
					place
				};
				setDropTarget({
					id,
					place
				});
			}, []);
			const dropOnItem = (0, react.useCallback)((event, id) => {
				event.preventDefault();
				event.stopPropagation();
				const source = draggingRef.current;
				if (source !== void 0 && source !== id) {
					const target = dropRef.current;
					const place = target !== void 0 && target.id === id ? target.place : placeForVertical(event);
					controller.moveFavorite(source, id, place);
				}
				endDrag();
			}, [controller, endDrag]);
			if (!open) return null;
			const current = live.current;
			const favorite = current !== void 0 && snapshot.favorites.some((entry) => entry.id === current);
			const starLabel = favorite ? t("star.unfavorite") : t("star.favorite");
			const items = snapshot.favorites;
			const rows = items.map((entry) => {
				const isLive = live.liveIds.indexOf(entry.id) >= 0;
				const title = isLive ? live.titles[entry.id] ?? entry.title : entry.title;
				const drop = dropTarget !== void 0 && dropTarget.id === entry.id ? dropTarget.place : void 0;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: recent_tabs_module_css_default.favItem,
					draggable: true,
					"data-dsh-plugin": "recent-tabs",
					"data-dsh-part": "favItem",
					"data-active": live.current === entry.id ? "1" : "0",
					"data-stale": isLive ? "0" : "1",
					"data-dragging": draggingId === entry.id ? "1" : "0",
					"data-drop": drop,
					title: isLive ? t("fav.open") : t("bar.stale"),
					onClick: () => switchTo(entry.id),
					onDragStart: (event) => startDrag(event, entry.id),
					onDragOver: (event) => dragOverItem(event, entry.id),
					onDrop: (event) => dropOnItem(event, entry.id),
					onDragEnd: endDrag,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: recent_tabs_module_css_default.favStar }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: recent_tabs_module_css_default.favItemLabel,
							children: title
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: recent_tabs_module_css_default.favRemove,
							type: "button",
							"data-dsh-part": "favRemove",
							title: t("fav.remove"),
							"aria-label": t("fav.remove"),
							onClick: (event) => {
								event.stopPropagation();
								controller.toggleFavorite(entry.id);
							},
							children: "×"
						})
					]
				}, entry.id);
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: panelRef,
				className: recent_tabs_module_css_default.favPanel,
				role: "dialog",
				"aria-label": t("fav.title"),
				"aria-modal": "false",
				tabIndex: -1,
				"data-dsh-plugin": "recent-tabs",
				"data-dsh-part": "favorites",
				style: {
					right: `${anchor.right}px`,
					top: `${anchor.top}px`
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: recent_tabs_module_css_default.favHead,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: recent_tabs_module_css_default.favTitle,
							children: t("fav.title")
						}), current === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: recent_tabs_module_css_default.starButton,
							type: "button",
							"data-dsh-plugin": "recent-tabs",
							"data-dsh-part": "favorite-star",
							"data-favorite": favorite ? "1" : "0",
							title: starLabel,
							"aria-label": starLabel,
							"aria-pressed": favorite,
							onClick: () => {
								const title = live.titles[current] ?? shortId(current);
								controller.record(current, title);
								controller.toggleFavorite(current, title);
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: recent_tabs_module_css_default.starGlyph })
						})]
					}),
					items.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: recent_tabs_module_css_default.favEmpty,
						children: t("fav.empty")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: recent_tabs_module_css_default.favList,
						children: rows
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* Browser-half entry for the recent-tabs plugin.
		*
		* Registers the locale dictionaries and mounts two surfaces:
		*   - the tab strip, in the frame-wide overlay slot (`shell.overlay`), where it
		*     sits above every column and outside their scroll containers. The
		*     favorites button is rendered by the strip itself, at the right end of the
		*     same row, so it is not a registration of its own;
		*   - the favorites drawer, in the same overlay slot as the strip.
		*
		* Both seats are additive list entries: nothing here replaces shipped UI.
		*
		* Failure policy: mounting problems are logged, never thrown — the web shell
		* fails the whole boot when a plugin apply throws, and an external plugin must
		* not take the GUI down.
		*/
		/** Locale namespace this plugin owns. */
		const NS = "dsh-recent-tabs";
		/**
		* Required services: slots for the two overlay seats, locale for the copy.
		*
		* Every surface also *reads* `sessions` (list + retention), `uiSession`
		* (per-session status) and `uiWorkspace` (session switching), but resolves them
		* with `ctx.get` at the point of use instead of gating activation on them: a
		* missing one degrades a surface, while a failed apply takes the whole shell
		* down.
		*/
		const inject = ["slots", "locale"];
		/**
		* Mount the recent-tabs surfaces.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "recent-tabs: dictionaries");
			const translate = ctx.locale.bind(NS);
			setTranslator((key) => translate(key));
			const controller = new RecentTabsController(typeof localStorage === "undefined" ? void 0 : localStorage);
			ctx.effect(() => () => {
				controller.dispose();
			}, "recent-tabs: controller");
			try {
				ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: "recent-tabs",
					order: 100,
					label: () => translate("bar.empty")
				}, () => (0, react.createElement)(RecentTabs, {
					controller,
					ctx
				})));
			} catch (error) {
				console.warn("[recent-tabs] mount failed:", error);
			}
			try {
				ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: "recent-tabs-favorites",
					order: 101,
					label: () => translate("fav.title")
				}, () => (0, react.createElement)(FavoritesPanel, {
					controller,
					ctx
				})));
			} catch (error) {
				console.warn("[recent-tabs] favorites mount failed:", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map