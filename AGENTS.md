# AGENTS.md — dsh-recent-tabs

DSH Web GUI 的「最近打开」会话 Tab 条（顶部悬浮、点击切换、手动关闭）与从条右端
下沉的收藏夹抽屉（条内最右端按钮开合、标签右键收藏、Chrome 式收藏文件夹）。包级规则：
只写本包特有约定，不重复根 AGENTS.md 与 packages/AGENTS.md 的全局/包级规则。

## 本包要点

- **纯浏览器插件**：host 半区（`src/index.ts`）是 no-op；功能全部在 `src/client`。
  持久化走浏览器 `localStorage`（键 `dsh-recent-tabs-v1`），因此 Host 侧无状态、
  无路由、无服务。
- **两个事实源要分清**：持久列表（`store.ts`）决定 tab **成员资格与顺序**；
  Session Controller 的 `ctx.sessions.list` 快照决定**标题与存在性**。改动时不要
  让其中一方覆盖另一方，否则失效会话的 tab 会丢名字或被误删。
- **幂等是硬约束**：`recordTab` / `touchOrder` 与 `RecentTabsController.record` 在内容
  不变时必须返回同一个快照引用且不通知订阅者。快速来回切 tab 的抖动就是从这里来的
  （issue 历史），修改 store/controller 时用 `tests/controller.spec.ts` 的不通知断言守住。
- **不要用 Slot props 的 `useSessions`**：Tab 条是全局的，Slot props 是会话作用域的；
  会话数据一律走 `ctx.sessions.list` + `ctx.uiWorkspace.openSession(id)`。
- **成员资格只认 controller 快照**：渲染时 tab 列表一律取 `snapshot.tabs`，绝不从
  会话列表或任何派生副本回填——否则会出现"关不掉"的 tab（旧副本把已删项 record 回来）。
  抽屉同理只取 `snapshot.favorites`，不要再从 `tabs` 里筛收藏（那正是关掉 tab 连带丢收藏
  的老 bug）。
- **关掉当前 tab 走 MRU 回退**：`controller.remove(id)` 返回下一个应激活的会话
  （`nextActiveAfterClose`：激活顺序优先，其次保留列表）。激活顺序是内存态、不持久化，
  构造时用存储列表播种。仅 `live.current === id` 时才跳转。
- **重命名改的是会话，不是 tab 显示名**：先走 `ctx.sessions.binding(id)?.session.rename(title)`；
  该行没有 bind（只有别人持有 generation 时才存在）时借一个：
  `ctx.sessions.using(id, { source: 'recentTabsRename' }, ref => ref.binding.session.rename(title))`，
  成功 Host 的 title projection 自动更新，下一次 list 快照带回新名字——所以不要再往
  store 里存一份独立标题（那会变成第三个事实源）。`source` 必须用条子自己的标记，别用
  `mainView`（否则会伪装成主视图的选中项）。失效 tab（不在实时列表）不可重命名。
- **tab 宽度固定 150px**（`recent-tabs.module.css` 的 `.tab`），标题用省略号截断；
  不要让宽度随标题回流。重命名编辑器也要 `width:100%` 且不撑宽。
- **拖拽只改显示顺序**：走 `moveTab` / `controller.move`，只动持久列表，`order`（激活顺序）
  原样透传——`touchOrder` / `dropOrder` / `nextActiveAfterClose` 的语义不变，所以拖完再关
  当前 tab 仍回退到上一次用过的那个。
- **收藏是独立集合，不是 tab 行上的字段**：`store.ts` 里 `favorites: FavoriteNode[]` 与
  `tabs: RecentTab[]` 平级，落盘形状是 `{ tabs, favorites }`（同键 `dsh-recent-tabs-v1`）。
  `favorites` 是收藏树的**根层**（根层可以同时有收藏项与文件夹），`FavoriteNode` =
  `FavoriteEntry | FavoriteFolder`，文件夹靠 `children` 区分（`isFolder`）。
  `removeTab` / `controller.remove` 只删 tab 行、**永远不碰 favorites**——「在顶部条关掉标签
  不丢收藏」就靠这条；`toggleFavorite` / `moveFavorite` 只动收藏树，不动 tab 行序与激活
  顺序，所以 tab 条里没有收藏分组、也没有 `data-favorite` 分组样式。
- **收藏夹是 Chrome 式树，可以做文件夹**：`createFolder(parentId?, title?)` 建在根层或某个
  文件夹里（不传 parent 就是根层，空标题用本地化默认名）、`renameFolder`、`removeFolder`（连整棵
  子树一起删，绝不碰 `tabs`）、`moveFavoriteInto`（收藏项追加到目标文件夹末尾）、
  `moveFolderInto`（文件夹移进别的文件夹，`undefined` = 移回根层，**必须防环**：移到自己是
  子孙的文件夹里直接不动）、`moveFolder`（文件夹落在**收藏项行**上 → 成为那一行所在层的兄弟，
  同层就是重排、跨层就是换层，同样防环）。**幂等照旧**：空标题 / 同名 / 已在目标层末尾 /
  目标不存在都返回同一个引用、不通知、不落盘。`toggleFavorite` 是**深搜**的——已收藏（哪怕在
  文件夹里）就删那一行，不在根层复制第二份；`moveFavorite` 只做**同层**兄弟重排（收藏项跨层
  落点没有意义，所以拖拽时也不给高亮），换层只能靠 `moveFolderInto` / `moveFolder`。
- **收藏树渲染是扁平的**：`FavoritesPanel` 把树摊成一串行（`buildTree`），文件夹展开时它的子项
  紧跟在后面，深度只体现为左内边距（每级 12px，从行自身 8px 起算，`data-depth` 也带着），
  `.favList` 仍是**唯一**的 `overflow-y: auto` 容器——不要改成嵌套 DOM 树或给文件夹再加滚动区。
  文件夹行 = 展开三角（`.favChevron`，clip-path 画的，按钮可键盘操作）+ 标题（双击就地重命名，
  复用 `.editor`）+ 悬停才出现的 `×`（删整棵）。标题行右侧的 `+`（`.favNewFolder`，普通字符）
  在根层建一个默认名文件夹并**立刻进入重命名**。空态只在根层一个节点都没有时显示。
- **文件夹展开状态是纯 UI 状态**：`fav-folder-state.ts` 的模块级 observable（`folderExpansion` /
  `setFolderExpanded` / `toggleFolderExpanded` / `subscribeFolderExpanded`），**不落盘**、不进
  `store.ts`；抽屉关掉重开仍记得本次会话展开过哪些文件夹，刷新则全部收起。默认全收起。
- **旧数据迁移与备份**：读到裸数组（旧形状，`favorite` 挂在行上）时，**每一行都留在 `tabs`**，
  带 `favorite === true` 的行**同时**进 `favorites`——旧形状里一行既是一个 tab 又是一条收藏，
  收藏是独立集合，不等于从条里消失；两个桶各自去重、各自保序（同一 id 可同时在两边），
  `MAX_TABS` 只约束 `tabs`，`favorites` 无上限。逐行校验、坏行丢弃；迁移幂等（改写后是对象
  形状，再读不写回），改写前把原文照抄到 `dsh-recent-tabs-v1-backup`（已有备份则不覆盖，
  备份失败也要继续迁移）。改 store 时保留 `tests/store.spec.ts` 的迁移用例。
- **层级是一条链，抽屉在最上**：`.zone` 2147483000 < `.bar` 2147483001 < `.menu`
  2147483002 < `.favPanel` **2147483003**。抽屉紧贴条右端下沉、又是开着时用户正在看的表面，
  所以它必须压过条子和标签右键菜单（早期 2147482998 的「抽屉压在条子之下」假设已废弃）；
  除这四档之外不要引入别的隐式层级依赖。
- **抽屉是紧凑面板，不许撑满**：`.favPanel` 宽 192–208px（现 200px），
  `max-height: min(60vh, 520px)`，高度随内容、列表区自己 `overflow-y: auto`；不要写
  `bottom: 0`（fixed 同时给 `top`/`bottom` 会被拉满屏），投影只取最轻一档。星标在顶部、
  竖排、`×` 悬显删除、点击只走 `switchTo`、拖拽调序、Esc/点外关闭这些形态语义不要动。
  **当前项标一个绿点**（`.favDot`，6px 实心圆，`--dsw-alias-state-success-primary`，与条上
  `.dot` 同尺寸同 token）：绿点 = 当前会话，跨表面语义一致，**不要改成收藏家族的蓝**；它落在
  行首（星标左侧），和原有的蓝色淡化底并存，失效行若恰好是当前项两个标记一起出，并带
  `aria-current="true"`。圆点只在抽屉里加，tab 条的 `.dot` 不要动。
- **顶部条只有一行 tab**：tabs 在滚动区 `.stripRow` 内，收藏按钮在条内**最右端、
  `.stripRow` 之外**（`.bar` 的最后一个子元素，`flex: 0 0 auto`），条与按钮之间只用
  条自身的 6px `gap`（与 tab 之间的间距同节奏），不再加分隔线。按钮**不能**跟着
  `.stripRow` 滚，也不能挪回会话标题栏。收藏面仍是按钮 + 抽屉（`shell.overlay`，
  `FavoritesPanel.tsx`）；条内只留 tab 的右键菜单
  （`data-dsh-part="tab-menu"`，单项 `tab-menu-favorite`），点击 = `controller.toggleFavorite(id, title)`
  （标题取该 tab 当前显示名，收藏夹里才有一份可读的落盘标题），不改变 tab 的 click/关闭/拖拽语义。
- **滚轮在 `.stripRow` 上是横向滚动，不是页面滚动**：`RecentTabs.tsx` 用原生
  `addEventListener('wheel', ..., { passive: false })` 绑在 `.stripRow` 上（React 的 `onWheel`
  不保证非 passive，别改回去），`deltaY` 非零时 `preventDefault()` 并把 `scrollLeft` 加上
  换算后的像素（`deltaMode` 1 按 16px/行、2 按条宽、其他按原值，`deltaX` 一并计入）。
  **只绑 `.stripRow`，不绑 `.bar`**（否则收藏按钮上的滚轮也会滚标签），条外滚轮一律不拦；
  `deltaY === 0`（纯横向手势）与 `ctrlKey`（触控板捏合缩放）直接放行，不加动画/惯性。
- **两处注册，按钮不单独占槽位**：`index.ts` 只注册 `shell.overlay` 的 Tab 条与收藏夹抽屉，
  收藏按钮由 `RecentTabs` 自己渲染。不再挂 `conversation.session.header.utilities`，也不碰
  `conversation.session.header.corner`（single 槽位、`replaceRisk: shadows-shipped-ui`）。
  两处注册各自 `try`/`catch`，挂载失败只 warn。
- **抽屉开着时条子钉住**：条子关闭态是 `translateY(-100%)`，按钮矩形跑到视口上方，抽屉会被
  锚到屏幕外。`RecentTabs` 订阅 `fav-drawer-state`，抽屉开着就 `data-open='1'` 且 hide 计时器
  直接 return；抽屉关闭后才恢复原来的 260ms 计时。`FavoritesPanel.measure()` 再把 `top`
  夹到不小于 8px 兜底。改这条链路时三处一起改，否则抽屉会飞。
- **抽屉贴按钮矩形定位**：`FavoritesPanel` 用 `[data-dsh-part="favorite-button"]` 找到条内那颗按钮，
  按 `getBoundingClientRect()` 算 `right = innerWidth - rect.right`、`top = rect.bottom + 6`
  （`top` 再夹到不小于 8px，防止锚点在屏外时抽屉飞走），
  并在打开、`window.resize`、按钮**整条祖先链**（最多 8 层）的 `ResizeObserver` 回调里重算。
  只观察 `parentElement` 跟不上（实测抽屉会压在右栏上）；主面板让出宽度时祖先里必有一个 resize，
  抽屉这才跟着走而不遮官方界面；找不到按钮兜底 `right: 24`。
  **不要**为了对齐右栏宽度去读官方哈希类名（`O_Ebla_*`、`wSkVaW_*` 这类）。
- **右键菜单自绘**：`position: fixed` 定在点击处并夹进视口（`.bar` 有 `transform`，固定定位后代
  会被它当包含块裁掉，所以菜单必须渲染成 `.bar` 的兄弟节点），`role="menu"` / `role="menuitem"`，
  点菜单外、Esc、滚动、窗口失焦任一即关。不引官方菜单组件、不抄官方哈希类名。
- **开合状态是纯 UI 状态**：按钮在条内、抽屉在另一处 slot 注册，共享 `fav-drawer-state.ts` 的模块级
  observable（`isFavoritesOpen` / `setFavoritesOpen` / `toggleFavoritesOpen` / `subscribeFavoritesOpen`），
  **不落盘**、不进 `store.ts`。抽屉关着时 `return null`，不留隐藏 DOM。
- **条子的边框与投影只取轻一档**：`.bar` 保持「从屏幕顶缘挂下来」——`border-top: none`、只有底部
  `9px` 圆角、`padding: 6px 10px`（整条约 41px），不要改成四边带框的卡片。边线
  `1px solid var(--dsw-alias-border-l2, ...)`（l1 在浅色下死灰、深色下几乎消失），投影 blur ≤ 20px、
  混色 ≤ 10%，关态与开态只差 2 个百分点和 2px，开合时不能像换了一层；投影的普通声明先给 token
  兜底，`color-mix` 版本放进 `@supports`。条内 tab 与收藏按钮之间只用 `gap`（现 6px），不要再叠一条分隔线。
- **视觉语言参照浏览器书签栏**：三块表面（条、收藏按钮、抽屉）统一走「扁平紧凑、popover 纸片、
  hover 高亮」——不叠渐变、不描四边框、不要抬升阴影；hover / 激活态一律用背景 token 换档
  （`bg-layer-2` 做 hover 底、强调色淡化做激活底），不要用字面色（收藏家族的强调色例外，见下一条）。
  `.zone` 是纯热区，永远不加视觉。tab 与列表项都是「平底 + 圆角高亮」，不要退回成每行一张卡片。
- **顶部条宽 90%**：`.bar` 的 `width: 90vw`，仍靠 `left: 50%` + `translateX(-50%)` 居中；**不加**
  `min(90vw, …)` 上限（用户要的是占屏比例，封顶会在超大屏上悄悄失守）。`.stripRow`、`.zone` 与抽屉
  锚定都随条宽自动跟随——抽屉按按钮矩形算 `right`，不要为条宽引入像素依赖或媒体查询。
- **收藏配色独立于导航栏**：条与 tab 本体保持中性（`bg-layer-*` / `border-l*` / `label-*`）；收藏家族
  ——条右端按钮、抽屉、右键菜单收藏项——统一用一抹**主题自带的交互蓝（`state-business-primary`，
  与 `link` / `button-info-fill` 同色系，掺淡一档）**作强调色，且只落在装饰上：按钮星形常驻蓝并带一圈蓝细边
  （悬停加深、抽屉开着时再加一层淡化底）、抽屉标题蓝文字 + 标题下蓝细线 + 面板蓝细边、
  当前项蓝淡化底、菜单收藏项蓝文字（已收藏时加重字重）。运行中的转圈、完成的对勾、等待回复的
  问号、tab 激活描边、两处拖拽插入边共用同一抹蓝，让「收藏 / 运行 / 完成 / 等待 / 激活」是一个色族
  而不是五种颜色。
  **这一抹蓝只从 `--fav-accent` 出**（定义在 `.bar` / `.menu` / `.favPanel` 三个表面根上，子元素继承）：
  普通声明是 `state-business-primary`（`#4176e6`）兜底，`@supports` 里换成
  `color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 85%, var(--dsw-alias-bg-overlay, #e9ecf2))`
  ——原色 85% 掺 15% 所在表面：色相不变、明度略降；因为掺的是主题自己的纸片色，深色主题下同一档
  混色会向深纸片靠拢而不是发光。**用户已明确不喜欢琥珀色，不要改回暖色/警告色系**（也不要自造 HEX），
  要调浓淡只改这一个百分比，不要逐个属性改色值。半透明档一律写成
  `color-mix(in srgb, var(--fav-accent) X%, transparent)`，档位不变：按钮细边 22/32/40%、淡化底
  10/12/14%、标题线 32%、面板边 18%——相对层级不许拧到一起。
  面板底色永远是 `bg-overlay` 纸片，不许整块染色；`color-mix` 必须先写 token 兜底再进 `@supports`。
  **`--dsw-alias-brand-primary` 在当前主题解析为黑（#0f1115，与 `label-primary` 相同），不能用作
  强调色**——上一轮收藏家族用了它，整族强调色实际全是黑的，等于没设颜色；也不要为差异化自造 HEX。
- **条内行容器与弹出的类名都不能含 `tab`**：tab 行容器用 `.stripRow`；`tests/rename.spec.tsx` 与
  `tests/reorder.spec.tsx` 的 `tabs()` helper 取 `div[class*="tab"]`，容器或菜单壳一旦带 `tab`
  就会被当成 tab 行本身，`tabByText()` 与 `data-active` 断言会直接红。抽屉里新增的类名一律用
  `fav` 前缀（`.favFolder` / `.favChevron` / `.favNewFolder` / `.favDot` / `.favHeadActions`）。
- **两个表面共用会话视图**：`use-current-session.ts` 导出 `useSessionView(ctx)`（选中项、liveIds、
  标题、runningIds、completedIds、waitingIds）与 `currentSessionId`，Tab 条与抽屉都用它，不要再各写一份 `reduce`，
  否则标题与失效判定会漂移。
- **tab 有三个状态标记**（只出现在 tab 条上，对话流里什么都不画）：回答中在标题前转一个柔和
  蓝色的小圈（`.runSpinner`，`role="img"` + `tab.running`，动画 `run-spin` 在
  `prefers-reduced-motion` 下关闭）；回合在你没看这个会话时结束的，同一槽位改显示一个小而静的
  蓝色对勾（`.doneMark`，`role="img"` + `tab.completed`，`clip-path` 画的对勾、无动画）；
  会话有一个正在等你回答的提问或计划评审时，同一槽位再换成一个小而静的蓝色问号
  （`.waitMark`，`role="img"` + `tab.waiting`，`::after` 输出普通字符 `?`、无动画）。
  三种标记视觉同族（同一抹 `--fav-accent`）但形态区分——圈 != 对勾 != 问号，也都不是表示
  「你在这」的绿点（`.dot`）。**优先级 waiting > running > completed，同一个槽位只出一个**：
  有等待交互时哪怕 running 仍为真也只显示问号，其次是执行中压过未确认完成，都没有则无标记。
  等待链路是 `SessionStatus.pendingInteraction`（`kind` 为 `question` / `plan-review`，不区分，
  只要非 undefined 就算等待）→ `reduceSessions` 的 `waitingIds` → `RecentTabs` 的 `waiting`
  → `tab.waiting` 文案；完成链路是 `SessionStatus.completionUnread` → `completedIds` →
  `completed` → `tab.completed` 文案。`pendingInteraction` 与 `completionUnread` 都是 shell
  的事实：本包只读，绝不自写清除逻辑（回答问题、标记已读都是 shell 的职责）。
- 颜色只用 shell 的 alias token（`--dsw-alias-*`），不覆盖全局主题；`color-mix` 先写一条普通
  token 声明兜底，再放进 `@supports (color: color-mix(...))`。

## 提交前检查

```sh
pnpm --filter dsh-recent-tabs typecheck
pnpm --filter dsh-recent-tabs test
pnpm --filter dsh-recent-tabs build
```
