# 交接说明 · 价格跳动网（JYE）

> **给另一台电脑的 WorkBuddy 的一句话**：先 `git pull`，然后读本文件，按「协作纪律」接着改，不要重新问一遍背景。
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
| 当前 HEAD | `7a9e3f6` — 转为正式版简洁界面；核实入库改为一键确认入库（2026-11-10 23:56） |
| 当前数据 | `data/discovery.json` = **183 条**，只有 `roujiaosuo_cats` 一个来源，含苗 0 条 |
| 测试基线 | `npm ci && npm test` → **39/39 通过**；`npm run build` 通过 |

## 2. 已完成的事（别重复做）

1. **肉交所四品类冻品线索表**：清远鸡 / 白条鹅 / 清远麻鸡 / 鸽子，共 183 条，独立页 `leads.html`，顶栏入口「冻品线索表 ↗」。
2. **清空旧数据**：鹅苗等禽网苗价行情已清（快照 214→183），本机录入数据键升到 `hqt-trial-data-v2`，表格「已核」键 `rjs-checked-v2`。清空方式与备份见 `B:\W工作区\_JYE备份\20261110_2330\`。
3. **正式版 / 简洁版**：删掉 `MARKET OVERVIEW` 等全部英文小标、副标题、试运行横幅、「如何接入共享库」；顶栏显示「正式版」。**后续所有新页面按简洁标准做，不加 eyebrow / 副标题 / 长说明**。
4. **一键确认入库**：点「核实入库」弹 6 行确认卡 →「确认入库」直接写库并标记线索 converted；「修改后再录」才开长表单；重复入库被拦。逻辑在 `src/lead-quick.js`。

## 3. 文件地图

| 文件 | 作用 |
|---|---|
| `src/app.js` | 4 个 hash 页面（overview / compare / review / settings，settings/sources = 来源中心）、顶栏、确认卡 |
| `src/store.js` | 本机/云端数据读写，本机键 `hqt-trial-data-v2` |
| `src/lead-quick.js` | 一键确认入库的字段组装（纯逻辑，有测试） |
| `src/core.js` | 价格折算、品类匹配、报价校验 |
| `config.js` | `localTrial: true`、Supabase URL/anon key（**目前为空**） |
| `data/discovery.json` | 采集线索快照，**每次采集会整体重写**，手工塞数据会被冲掉 |
| `data/roujiaosuo-leads.{json,csv}` | 183 条原始数据与可下载 CSV |
| `scripts/roujiaosuo-scrape.mjs` | 抓取肉交所列表+详情 → `data/roujiaosuo-leads.json` |
| `scripts/roujiaosuo-build.mjs` | 生成 `leads.html` + CSV |
| `scripts/import-roujiaosuo-leads.mjs` | 转标准线索并合并进快照；`--only-frozen` 保证苗价不被带回来；`--cloud` 单独 POST 写库 |
| `scripts/discovery.mjs` | 原有 7 个网页适配器（禽网 / 畜牧总站等），**目前不参与冻品数据** |
| `scripts/build.mjs` | 发布时复制 `index.html` / `config.js` / `leads.html` / `src/` / `data/` |
| `.github/workflows/discover.yml` | 定时采集 → 带 `--cloud --only-frozen` 合并 |
| `tests/` | `node --test tests/*.test.mjs`，新增逻辑必须补测试 |

## 4. 业务口径（改代码时别破坏）

| 口径 | 说明 |
|---|---|
| 价格折算 | 元/公斤 ÷2、元/吨 ÷2000 → 元/斤；按只/羽计价不折算，标注「不折算」 |
| 电话 | 平台脱敏 `131****3066`，**不绕过登录、不猜测补全** |
| 单个重量 | 原文没有该字段；「货量」是发布量，**≠ 单重 ≠ 起订量**；无规格片段一律显示「待核实」，不推算 |
| 审核纪律 | 线索必须人工核实后才进报价库；行情价/官方监测不参与供货均价 |
| 系统补全项 | 产品归类、计价口径（出厂·含税·不含运）、报价日（核实当天）、有效期（+7 天）、供应商（原文联系人）——**必须写进 `notes` 并在确认卡标注**，不能偷偷编造 |
| 一句话 | 采集只抓公开字段，遵守站点条款与频率限制 |

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
npm test                # 39/39 基线，发布前必跑
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

WorkBuddy 账号级会自动同步长期画像与偏好（登同一账号即可），但**任务、会话、工作区文件不会自动跨电脑传**；想从另一设备看这台电脑的任务，可在「设置 → 设备连接」开启「允许同账号设备远程连接」（需两端同账号、电脑开机在线、PC ≥ 5.3.8）。那只是查看/授权，不是文件同步。

## 8. 已知待办 / 坑（按优先级）

| # | 问题 | 备注 |
|---|---|---|
| 1 | **仍是本机试运行**：`config.js` 的 `localTrial:true` 未改，审核确认的报价只存当前浏览器，换设备看不到 | 要真正团队正式版，需填 Supabase **项目 URL + publishable/anon 公钥**（都是公开值）；`service_role` 只放 GitHub Secrets，绝不进前端。改后手动触发一次 `Discover public price leads` 把 183 条写库 |
| 2 | `scripts/discovery.mjs --cloud` 把含 `market` 的 items 整批 POST 到 `collection_items`，而 `supabase/schema.sql` 无该列 → 400 且被 `discover.yml` 的 `continue-on-error` 静默吞掉 | 修法：`alter table public.collection_items add column if not exists market jsonb;` 并拆开「抓取 / 写库」两步，写库失败要标红。目前冻品数据单独 POST 绕开了 |
| 3 | 「外部行情参考」板块空白 | 清空苗价时把禽网行情/官方监测线索一起清了。恢复：去掉三处 `--only-frozen`，放回备份的 397 条快照 |
| 4 | 建库顺序 | README 只写了 `schema.sql`，必须再跑 `supabase/migrations/20261109_team_permissions.sql` 再建 admin，否则登录后 404、管理员 `active` 判定失败 |
| 5 | 仓库体积 | 约 860KB 静态数据每次抓取都提交，长期要瘦身（只留必要字段） |
| 6 | 冗余 | `src/team-ui.js` 无引用可清；`supabase/functions/account-admin/` 的 `index.ts` 是入口、`handler.js` 是实现，**不是重复代码** |

---

*最后更新：2026-11-10 23:58（HEAD `7a9e3f6`，线上已验证）*
