# 交接说明 · 价格跳动网（JYE）

> **给另一台电脑的 WorkBuddy 的一句话**：切到 Agent 模式，先 `git pull`，然后读本文件，按「协作纪律」接着改，不要重新问一遍背景。
>
> 本文件是**两台电脑之间唯一的权威上下文**，跟代码一起走 git，不会丢。`B:\W工作区\.workbuddy\memory\` 里的日志只在本机，换电脑不会自动带过去，所以别只依赖它。

---

## 1. 项目速览

| 项 | 值 |
|---|---|
| 站点 | https://bbroot01.bbroot.com （GitHub Pages + 自定义域名，push main 后约 1~2 分钟自动部署） |
| 仓库 | https://github.com/taojin1174-cyber/JYE ，分支 `main` |
| 本机路径 | `B:\W工作区\JYE`（另一台电脑路径可不同，但工作区统一放 `<工作区>\JYE`） |
| 技术栈 | 原生 ES modules 前端，无框架、无 CDN 依赖；Node 22 采集脚本；GitHub Actions；可选 Supabase(RLS) |
| 当前 HEAD | `4e86892` 之后的「界面精简 / 线索管理 / 品类管理」提交；**一律以 `git log -1` 为准** |
| 当前数据 | `data/discovery.json` = **183 条**，只有 `roujiaosuo_cats` 一个来源，含苗 0 条 |
| 测试基线 | `npm ci && npm test` → **57/57 通过**；`npm run build` 通过（含 `scanLeak` 发布自检） |

## 2. 已完成的事（别重复做）

1. **肉交所四品类冻品线索表**：清远鸡 / 白条鹅 / 清远麻鸡 / 鸽子，共 183 条，独立页 `leads.html`，顶栏入口「冻品线索表 ↗」。
2. **清空旧数据**：鹅苗等禽网苗价行情已清（快照 214→183），本机录入数据键升到 `hqt-trial-data-v2`，表格「已核」键 `rjs-checked-v2`。清空方式与备份见 `B:\W工作区\_JYE备份\20261110_2330\`。
3. **正式版 / 简洁版**：删掉 `MARKET OVERVIEW` 等全部英文小标、副标题、试运行横幅、「如何接入共享库」；顶栏显示「正式版」。**后续所有新页面按简洁标准做，不加 eyebrow / 副标题 / 长说明**。
4. **一键确认入库**：点「核实入库」弹 6 行确认卡 →「确认入库」直接写库并标记线索 converted；「修改后再录」才开长表单；重复入库被拦。逻辑在 `src/lead-quick.js`。
5. **出处保密（2026-11-11）**：前台所有页面、报价详情、导出 CSV 都不显示来源 / 网址 / 渠道名；只有「数据设置」输入密码解锁后才可见。发布产物全部脱敏，见下方「出处保密」小节。**不要再把这些字段加回前台**。
6. **页面内重复大标题已删（2026-11-11）**：导航已有「行情总览 / 采购比价 / 报价审核 / 数据设置」，正文不再重复 h1；`pageActions()` 只保留右对齐的「导出数据 / 录入报价」。`.page-heading` / `.eyebrow` 样式与失效的行情板块 CSS 一并清掉。**后续新页面按简洁版做**。
7. **已处理线索自动隐藏**：来源中心待审列表只显示 `pending`；`converted / dismissed / deleted` 由面板上的「已处理 N」按钮打开管理弹窗，可「修改报价 / 撤销入库 / 删除 / 恢复待审」。每次操作后 `render()` 整页重算（均价、比价、审核、顶栏计数同步）。`deleted` 状态存本机数据，`mergeDiscovery` 重新合并快照时会保留，不会被采集带回。
8. **核价品类可管理**：基础设置 →「管理品类」弹窗支持改名 / 停用 / 删除 / 恢复。停用或删除的品类从总览卡片、比价筛选、产品下拉、导出、走势图一并移除（`visibleProducts()` / `categories()` / `quoteVisible()`），**报价数据不删**；有报价的品类拒绝删除，只能停用。偏好存在 `hqt-prefs-v1`，随完整备份导出导入。
9. **手机端数据说明**：设置页（解锁后）显示「数据保存位置：此设备（未上传）」，新增「导入备份」。完整备份升级为 v3（含 `prefs`）。手机看不到电脑录入的报价是**本机试运行的必然结果，不是上传失败**；自动同步必须接 Supabase。

## 3. 文件地图

| 文件 | 作用 |
|---|---|
| `src/app.js` | 4 个 hash 页面（overview / compare / review / settings，settings/sources = 来源中心）、顶栏、确认卡 |
| `src/store.js` | 本机/云端数据读写；本机键 `hqt-trial-data-v2`、偏好 `hqt-prefs-v1`；线索状态 / 品类管理 / 备份导入导出（v3） |
| `src/lead-quick.js` | 一键确认入库的字段组装（纯逻辑，有测试） |
| `src/core.js` | 价格折算、品类匹配、报价校验 |
| `config.js` | `localTrial: true`、Supabase URL/anon key（**目前为空**） |
| `data/discovery.json` | 采集线索快照，**每次采集会整体重写**，手工塞数据会被冲掉 |
| `data/roujiaosuo-leads.{json,csv}` | 183 条原始数据与可下载 CSV |
| `scripts/roujiaosuo-scrape.mjs` | 抓取肉交所列表+详情 → `data/roujiaosuo-leads.json` |
| `scripts/roujiaosuo-build.mjs` | 生成 `leads.html` + CSV |
| `scripts/import-roujiaosuo-leads.mjs` | 转标准线索并合并进快照；`--only-frozen` 保证苗价不被带回来；`--cloud` 单独 POST 写库 |
| `scripts/discovery.mjs` | 原有 7 个网页适配器（禽网 / 畜牧总站等），**目前不参与冻品数据** |
| `scripts/build.mjs` | 发布时复制前端文件；把 `dist/data/discovery.json` 的出处编码进 `ref`（`src/store.js` 运行时还原）；排除 `roujiaosuo-leads.{json,csv}`；**发布前自检** dist 不得含明文渠道名 / 网址，命中就构建失败 |
| `tests/privacy.test.mjs` | 9 个用例守住「前台零出处 / 解锁才可见 / 编码可还原」，改前台前先看它 |
| `tests/management.test.mjs` | 4 个用例：已处理线索状态、撤销入库、品类增删改、备份跨设备导入 |
| `tests/render-smoke.test.mjs` | 5 个用例：最小 DOM 桩启动 `src/app.js`，验证 4 个 hash 页面不白屏、无重复大标题、前台零出处 |
| `.github/workflows/discover.yml` | 定时采集 → 带 `--cloud --only-frozen` 合并 |
| `tests/` | `node --test tests/*.test.mjs`，新增逻辑必须补测试 |

## 4. 业务口径（改代码时别破坏）

| 口径 | 说明 |
|---|---|
| 价格折算 | 元/公斤 ÷2、元/吨 ÷2000 → 元/斤；按只/羽计价不折算，标注「不折算」 |
| 电话 | 平台脱敏 `131****3066`，**不绕过登录、不猜测补全** |
| 单个重量 | 原文没有该字段；「货量」是发布量，**≠ 单重 ≠ 起订量**；无规格片段一律显示「待核实」，不推算 |
| 审核纪律 | 线索必须人工核实后才进报价库；行情价/官方监测不参与供货均价 |
| 已处理线索 | 入库 / 忽略 / 删除只改线索状态，**不自动删除报价**；只有明确点「撤销入库」才删关联报价并放回待审 |
| 品类停用 | 只影响显示与筛选，绝不删除报价；删除品类前必须确认该品类无报价 |
| 系统补全项 | 产品归类、计价口径（出厂·含税·不含运）、报价日（核实当天）、有效期（+7 天）、供应商（原文联系人）——**必须写进 `notes` 并在确认卡标注**，不能偷偷编造 |
| 一句话 | 采集只抓公开字段，遵守站点条款与频率限制 |

### 出处保密（必须守住，2026-11-11 定）

**规则**：同事打开网站时，不能看出报价来自哪里；来源名称、原文网址、采集痕迹只在「数据设置」输入密码解锁后出现。

| 层 | 做法 |
|---|---|
| 前台渲染 | `src/app.js` 的 `unlocked()` 门控：顶栏线索表入口、报价详情「来源 / 原始来源」、录入表单三个来源字段、前台导出 CSV 的来源 / 链接列、备注 `safeNotes()` 脱敏。总览的「外部行情参考」板块已删除 |
| 报价数据 | `src/lead-quick.js` 供应商只写联系人（不写渠道名），备注只保留核价事实与系统补全说明；`src/lead-prefill.js` 同步中性化 |
| 独立线索表 | `leads.html` 加 PBKDF2 密码门（与设置页同一密码 / verifier），payload 与详情链接双重编码，页面文案中性化 |
| 发布快照 | `scripts/build.mjs` 把 `url / source_name / details / source_id` 编码进 `ref`；`src/store.js` 加载时还原，来源中心（解锁后）功能不变 |
| 静态 JS | `src/sources.js` 的来源目录整体编码，运行时解码；`src/app.js` 里不出现明文渠道名 |
| 原始数据 | `data/roujiaosuo-leads.{json,csv}` **不发布**（只在仓库 / 本地），`dist/data/` 只剩脱敏后的 `discovery.json` |
| 防回归 | `npm run build` 结尾 `scanLeak()` 自检，dist 里若出现明文渠道名 / 网址直接构建失败 |

**边界（别误以为绝对保密）**：静态站的密码门是界面级，懂技术的人若刻意查看源码或解码 `ref` 仍能追溯；**GitHub 仓库本身是 public**，仓库里的 `data/discovery.json`、采集脚本、HANDOFF.md 仍含完整出处。要真正隔离：① 把仓库设为 private；② 按待办 #1 接 Supabase，线索与报价按 RLS 权限下发。

## 5. 两台电脑协作纪律（重要）

1. **改前先拉**：`git pull origin main`（有未提交改动先 `git stash`，拉完 `git stash pop`）。
2. **改完即推**：`npm test` → `npm run build` → `git add -A && git commit && git push`。不要留一堆未提交改动过夜，否则另一台一定冲突。
3. **同一时间只在一台电脑改**，尤其不要两边同时跑 `npm run leads` / `scripts/local-frozen-leads.cmd`（会重写 `data/discovery.json` 和 `leads.html`，必冲突）。
4. **发布前备份**（老规矩）：`git bundle create <备份目录>/pre-xxx.bundle HEAD`，并另存 `data/discovery.json`。
5. **验线上用无痕窗口 + 强刷**，Pages 有 1~2 分钟延迟和顽固缓存；改前端要升版本戳。
6. **回滚**：`git revert <commit>`；历史备份在 `B:\W工作区\_JYE备份\20261110_2330\`（清空前 397 条快照）与 `20261110_2355\`（正式版前）。

## 6. 常用命令

```bash
npm ci                  # 首次或换电脑后装依赖
npm test                # 57/57 基线，发布前必跑
npm run build           # 生成 dist/
npm run dev             # 本地预览 http://127.0.0.1:5173
npm run leads           # 抓取 → 生成表格 → 合并待审线索（--only-frozen），每天最多 1 次
npm run leads:build     # 只重生成 leads.html + CSV
npm run leads:import    # 只合并线索
```

## 7. 另一台电脑首次开工

```bash
git clone https://github.com/taojin1174-cyber/JYE.git <工作区>/JYE
cd <工作区>/JYE && npm ci && npm test
```

然后打开 WorkBuddy，把工作区指到该目录，发一句：**「读 JYE/HANDOFF.md，按协作纪律接着改」**。

**这句话够用，但有 4 个前提**（少一个就可能接不上）：

| 前提 | 说明 |
|---|---|
| 同一 WorkBuddy 账号登录 | 云端画像 / 偏好自动带过去；会话与任务**不会**跨电脑传 |
| 工作区指向含 `JYE` 的目录 | 路径可以不同（本机是 `B:\W工作区`），但 WorkBuddy 必须能读到 `JYE/HANDOFF.md` |
| 代码是最新的 | 另一台先 `git pull origin main`；否则读到的是旧版 HANDOFF |
| 处于 Agent 模式 | Ask 模式只读、不能改文件；要改代码需切到 Agent |

更稳的开场白（推荐直接复制）：

> 先 `git pull origin main`，读 `JYE/HANDOFF.md` 与 `git log -3`，按协作纪律接着改；改完跑 `npm test && npm run build`，提交推送，并把本次结论同步回 HANDOFF.md。

**为什么必须点名 HANDOFF.md**：新会话不会自动知道这台电脑做过什么，`.workbuddy/memory/` 日志也不会跨电脑同步；HANDOFF.md 随 git 走，是唯一权威上下文。改完一定要 commit + push，另一台下次 pull 才看得到。

WorkBuddy 账号级会自动同步长期画像与偏好（登同一账号即可），但**任务、会话、工作区文件不会自动跨电脑传**；想从另一设备看这台电脑的任务，可在「设置 → 设备连接」开启「允许同账号设备远程连接」（需两端同账号、电脑开机在线、PC ≥ 5.3.8）。那只是查看/授权，不是文件同步。

## 8. 已知待办 / 坑（按优先级）

| # | 问题 | 备注 |
|---|---|---|
| 1 | **仍是本机试运行**：`config.js` 的 `localTrial:true` 未改，审核确认的报价只存当前浏览器，换设备 / 手机看不到 | 临时办法：设置页「导出完整备份」→ 另一台「导入备份」（v3 含品类偏好），每次改动要搬一次。彻底解决需填 Supabase **项目 URL + publishable/anon 公钥**（都是公开值）；`service_role` 只放 GitHub Secrets，绝不进前端。改后手动触发一次 `Discover public price leads` 把 183 条写库 |
| 1b | 云端模式下「删除线索」退化为 `dismissed`（`collection_items.status` check 只允许 pending/converted/dismissed）；品类偏好仍是 per-device 的 `hqt-prefs-v1` | 接 Supabase 后若要多设备一致，把线索状态与品类偏好搬到数据库表，别依赖 localStorage |
| 2 | `scripts/discovery.mjs --cloud` 把含 `market` 的 items 整批 POST 到 `collection_items`，而 `supabase/schema.sql` 无该列 → 400 且被 `discover.yml` 的 `continue-on-error` 静默吞掉 | 修法：`alter table public.collection_items add column if not exists market jsonb;` 并拆开「抓取 / 写库」两步，写库失败要标红。目前冻品数据单独 POST 绕开了 |
| 3 | 「外部行情参考」板块空白 | 清空苗价时把禽网行情/官方监测线索一起清了。恢复：去掉三处 `--only-frozen`，放回备份的 397 条快照 |
| 4 | 建库顺序 | README 只写了 `schema.sql`，必须再跑 `supabase/migrations/20261109_team_permissions.sql` 再建 admin，否则登录后 404、管理员 `active` 判定失败 |
| 5 | 仓库体积 | 约 860KB 静态数据每次抓取都提交，长期要瘦身（只留必要字段） |
| 6 | 冗余 | `src/team-ui.js` 无引用可清；`supabase/functions/account-admin/` 的 `index.ts` 是入口、`handler.js` 是实现，**不是重复代码** |
| 7 | **仓库是 public** | `git clone` 无需认证即可拉到完整源码、明文采集快照与脚本。网站发布产物已脱敏，但仓库本身仍可看到出处；建议设为 private |

---

*最后更新：2026-11-11 00:40（界面精简 / 已处理线索管理 / 核价品类管理 / 手机端数据说明；当前 HEAD 以 `git log -1` 为准）*
