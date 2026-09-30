# HANDOFF：DSH 包报告

本文件是这个项目的完整使用手册。接手的人或 AI 读完即可独立维护、排障和继续开发，不需要再翻聊天记录。

## 1. 这是什么

一个静态网站，报告 DeepSeek Harness（下称 DSH，上游仓库 <https://github.com/deepseek-ai/deepseek-harness>）有哪些 workspace 包、其中哪些能被 Cordis 当插件启动、每天的版本号与新增包、每个包的作用与依赖链条。

| 项 | 值 |
|---|---|
| 线上地址 | <https://dsh-report.app238.com>（Cloudflare Workers 自定义域名，zone `app238.com`） |
| 本仓库 | `git@github.com:Jabberwocky238/dsh-package-report.git`，分支 `main` |
| 本地路径 | `/home/zq/coding/deepseek-harness/dsh-package-report`（放在 DSH 的 fork 工作区里，但它是独立 git 仓库，在外层 `jw238` 分支里显示为未跟踪目录） |
| 数据来源 | `/home/zq/coding/dsh-report-src`：上游仓库的独立 clone，只用于报告；每天被 `reset --hard origin/master`，**不要在里面改代码** |
| 用户的 DSH fork | `/home/zq/coding/deepseek-harness`（分支 `jw238`，remote `upstream` 指向上游）。报告**不**读这个工作区 |
| Cloudflare 账号 | wrangler OAuth 已登录（`npx wrangler whoami`），账号 `Jabberwocky238@gmail.com's Account` |
| 运行环境 | node v25.9（nvm）、bun、pnpm 11；DSH 要求 node `^22.19 \|\| >=24` |

## 2. 用户的要求（按提出顺序，全部已实现，改动时不要破坏）

1. 统计 DSH 的包，重点是“Cordis 可以启动的包”（插件），不是 npm 外部依赖。
2. 挂在 `dsh-report.app238.com`。
3. 范围包括：**每日的版本号（最新版本）、是否新增、新增多少、新增包的作用、依赖谁、依赖链条**。
4. 包名**写全称**（如 `@deepseek-ai/dsh-package-manifest`，不要缩写成 `package-manifest`）。
5. 首页要**直接展示足够多的内容**（不用点开就能看到作用、依赖、链条摘要），但**不能太多导致混乱**。依赖树等深层细节放在展开里。
6. 有这份 HANDOFF.md。
7. 前端尽可能懒加载，每一步按钮都懒（见 §7.1）。
8. **Cordis 不算包，依赖 Cordis 的不算**：`vendor/` 下的 Cordis 包（cordis、cosmokit、schemastery、cordis-plugin-*，历史上也叫过 `@cordisjs/*`、`cordis`、`cosmokit`、`schemastery`）不计入任何数量、列表、历史；对它们的依赖不算 DSH 依赖，也不算外部依赖，依赖链条到它们就断开。

用户用中文交流，页面文案也用中文。用户的全局规则：不允许使用 plan 模式和 subagent（除非用户明确要求）；使用 sudo 前要告知（本项目用不到 sudo）；默认不要连接远程主机。

## 3. 目录结构

```
dsh-package-report/
  HANDOFF.md            本文件
  README.md             面向读者的简介
  scripts/
    collect.mjs         采集器：读 DSH 仓库，写 public/data/ 下的分片 JSON（唯一的数据来源）
    daily.sh            每日任务：更新上游 clone → 构建 → 采集 → 部署 → 提交推送数据
  public/data/          采集结果（已提交进 git），前端运行时按需 fetch，见 §7.1
  src/
    types.ts            各分片的 TypeScript 类型（改采集字段时同步改这里）
    data.ts             fetchShard（每个分片每次页面加载只请求一次）、useShard、useGraph
    graph.ts            DepGraph：按下标存的依赖图，deps/kind/shard/chain（BFS 统计传递数、深度、最长链，带缓存）
    LazySection.tsx     区块懒加载：进入视口 600px 内才加载模块并挂载；故意不用 Suspense
    labels.ts           类型标签常量
    App.tsx             首屏：标题、总览卡片、profile 表、分组；预取；挂载懒加载区块
    History.tsx         懒加载区块「每日版本与新增」（按页加载 history-N）
    Packages.tsx        懒加载区块「包列表」（每次 40 行；展开时才取 pkg/<i>.json）
    Closures.tsx        懒加载区块「外部依赖闭包」
    Chain.tsx           依赖链组件：ChainLine、DepTree（逐级点开才渲染）、TreeToggle、ChipList（长列表先显示 12 个）
    index.css           全部样式；颜色 token 在 :root，深色模式在 prefers-color-scheme
    main.tsx            React 入口
  worker/index.ts       Worker 本体：只返回 404，静态资源由 assets 绑定服务
  wrangler.jsonc        Worker 配置：routes 里的 custom_domain，workers_dev 关闭
  vite.config.ts        Vite + @cloudflare/vite-plugin
```

项目基于 Cloudflare 的 Vite + React 模板（React 19、Vite 8、TypeScript 6、ESLint 10）。没有测试。

## 4. 日常命令

```sh
cd /home/zq/coding/deepseek-harness/dsh-package-report
bun install                                   # 首次
node scripts/collect.mjs ../../dsh-report-src # 重新采集（上游 clone 必须已 install + build）
bun run dev                                   # 本地开发（HMR）
npx eslint src worker && npx tsc -b           # 检查
bun run build                                 # 构建到 dist/
bun run deploy                                # 构建并部署到 dsh-report.app238.com
./scripts/daily.sh                            # 手动跑一次完整的每日流程（约 4-5 分钟）
```

本地预览构建产物用 `npx vite preview --port 4789`。**注意**：preview 启动时会固定当时 dist 的资源清单，重新 build 之后必须重启 preview，否则新的 hash 文件返回 404、页面一片空白。

## 5. 每日自动更新

crontab（`crontab -l` 查看）：

```cron
30 6 * * * /home/zq/coding/deepseek-harness/dsh-package-report/scripts/daily.sh >> $HOME/.cache/dsh-report-daily.log 2>&1
```

`daily.sh` 依次执行：

1. 在 `~/coding/dsh-report-src` 里执行 `git fetch origin master` 和 `reset --hard origin/master`。可以用环境变量 `DSH_SRC` 换成别的路径。
2. 执行 `pnpm install --frozen-lockfile` 和 `pnpm run build`，约 3.5 分钟。
3. 执行 `node scripts/collect.mjs "$SRC"`。
4. 执行 `bun run deploy`。
5. 如果 `public/data/` 有变化，就提交（提交信息为 `data: <日期> <上游短 sha>`）并 `git push origin main`。`generatedAt` 字段每次都会变，所以基本上每天都会产生一个提交。

脚本开头把 node、bun、pnpm 所在目录写死进了 PATH，因为 cron 环境没有 nvm。换了 node 版本要改这一行。脚本已在 `env -i HOME=$HOME` 的最小环境下验证过，SSH 推送也能用。

排查步骤：看 `~/.cache/dsh-report-daily.log`。常见失败原因：
- 上游改了 lockfile，而 pnpm 版本不匹配。
- 上游构建失败。这种情况下站点保持前一天的数据，不会部署半成品，因为 `set -e` 会让脚本在第一个失败处退出。

## 6. 数据是怎么算的（`scripts/collect.mjs`）

输入是一个**已经 install 并 build 过**的 DSH 仓库。插件判定会 import 构建产物，没构建的包会被归为 `unbuilt`。

### 6.1 包清单
扫描 `packages/*/*`、`apps/*` 下的 `package.json`。`vendor/*` 也会读取，但只用来收集 Cordis 包名（`cordisNames`），用于从依赖中剔除，本身不算包。`python/sdk-runtime`、`benchmarks`、`website`、`native` 不算“DSH 包”。

### 6.2 包类型 `kind`
- `app`：`apps/*`。
- `client`：`package.json` 里有 `dsh.client` 的包。它们是浏览器端代码，不 import。
- `plugin`：对 `exports` 里的每个 `.js` 入口（跳过通配符和 `./package.json`）执行 import，按 Cordis loader 的规则（`vendor/loader/src/index.ts`：`exports.default ?? exports`）取出结果。结果是 class、function 或带 `apply` 方法的对象，就算一个插件入口。至少有一个入口就是 `plugin`。
- `library`：其余已构建的包。
- `unbuilt`：主入口文件不存在。
- 以后如果发现某个包的默认导出是可调用对象、但其实不是插件，就在 collect 里加一个排除集合。之前唯一的这种情况是 schemastery，它现在属于被排除的 Cordis 包。
- 有些入口 import 时会抛错（worker 入口、需要父进程的子进程入口等），会记在 `errors` 里，不参与判定。import 时还会有少量子进程入口往 stderr 打印东西，属正常现象。

### 6.3 依赖
- `workspaceDeps`：`dependencies`、`optionalDependencies`、`peerDependencies` 中属于 workspace 的包。
- `dependents`：`workspaceDeps` 的反向关系。
- `externalDeps`：同样三类依赖中，既不是 DSH 包、也不是 Cordis 包的那些。
- 依赖链条在前端算（`deps.ts` 的 `chainStats`）：对 `workspaceDeps` 做 BFS，得到传递依赖数、最深层数和一条最长路径。
- 已删除的包在当前依赖图里查不到，就用它被新增那天记录的依赖。

### 6.4 profile
把 bundle 包 `package.json` 里 `dsh.bundle.patch` 列出的补丁 YAML 按行 id 合并。profile 与 bundle 链的对应关系写死在 `profileDefs` 里：

| profile | bundle 链 |
|---|---|
| headless | dsh-base + dsh-headless |
| acp | dsh-base + dsh-acp-app |
| sdk | dsh-base + dsh-sdk-app |
| sdk-minimal | dsh-sdk-minimal |
| web | dsh-base + dsh-web-app（含 4 个 preset 文件） |

- 合并时只处理两种操作：`insert`（递归收集所有带 `id` 和 `name` 的行，包括 group 和 preset 里嵌套的子插件，`parent` 记录上一级行 id），以及 `{id, disabled}` 补丁。
- `disabled: true` 算禁用，`disabled: !!js ...` 算条件启用，其余算启用。`cordis:group` 这类内置名称不算包；指向 Cordis 包的行（如 `@deepseek-ai/cordis-plugin-timer`）会被整行去掉。
- **这是近似结果**，不是真实启动时的插件树。上游新增了 profile 或 bundle 时，要手动更新 `profileDefs`。

### 6.5 外部依赖闭包
解析 `pnpm-lock.yaml` 的 importers 和 snapshots，从 `apps/cli`、`apps/desktop-host`、`apps/desktop`、`python/sdk-runtime` 出发，沿生产依赖和可选依赖求闭包，并列出带入包最多的直接依赖。

### 6.6 每日历史
- 沿 `git log --first-parent HEAD`，按北京时间（`TZ=Asia/Shanghai`）给每天取最后一个提交。
- 每天用 `git ls-tree -r` 找出 workspace 的 `package.json`（`vendor/` 下的只记入 Cordis 名单，不算当天的包），再用 `git cat-file --batch` 批量读取（按 blob 缓存），得到当天的包集合，以及根 `package.json` 里的 `version`。
- 和前一天比较，得出 `added`（带当天的 description、dir、workspaceDeps）和 `removed`（只有名字）。
- 每个包的 `firstSeen` 取自这里。
- 只读 git 对象，不需要构建，107 天约 3 秒。
- 必须在上游 master 的 clone 上跑。在 fork 的 `jw238` 分支上跑，first-parent 链会因为 fork 合并而出现跳跃。
- 2026-08-13 那天是 +56/-53，因为上游做了一次包改名（rescope），不是真的新增了 56 个包。

### 6.7 输出分片（`public/data/`，字段以 `src/types.ts` 为准）

| 文件 | 内容 | 大小量级 |
|---|---|---|
| `summary.json` | `version`（缓存键）、来源、总览数字、最新版本与近 7 天增删、每天 `[day,total,added数]`、profile 统计、分组统计 | 7 KB |
| `graph.json` | `names[]`、`kinds[]`（已删除包为 null）、`deps[][]`（下标）；当前包在前，只在历史里出现的包在后 | 30 KB |
| `packages.json` | 包列表每行需要的字段（计数，不含列表） | 100 KB |
| `pkg/<i>.json` | 第 i 个包（graph 下标）的详情：dir、插件入口、依赖/被依赖/外部依赖列表、profile 行 | 每个 1-10 KB |
| `history-<n>.json` | 有变化的日子按 10 天一页，带 `prevVersion`、`added[]`、`removed[]` | 每页 10-20 KB |
| `closures.json` | 外部依赖闭包与锁文件统计 | 2 KB |

采集时会先清空 `public/data/` 再全部重写。

## 7. 页面结构（从上到下）

### 7.1 加载策略（用户要求“尽可能懒加载，每一步按钮都懒”）

- **首屏**只需要 HTML 和 JS 主包（React，约 72 KB gzip）。`vite.config.ts` 里的 `inlineSummary` 插件在构建时把 `summary.json` 嵌进 HTML（`<script id="summary" type="application/json">`），所以首屏不用再发请求。这意味着**数据变了必须重新 build**，`daily.sh` 走的是 `bun run deploy`，已经包含 build。
- 同一个插件还会往 HTML 里加 `<link rel="modulepreload">`（History 模块和 Chain 模块）和 `<link rel="preload" as="fetch">`（`graph.json`、`history-0.json`），让它们和主 JS 并行下载。已验证 fetch 会复用这些预加载，不会重复下载。
- 浏览器空闲时再预取 Packages 模块和 `packages.json`。预取只下载，不渲染。
- 历史区、包列表、闭包区都用 `LazySection`，进入视口 600px 内才挂载。
- **不要换回 `React.lazy` 加 Suspense**：React 会把每个 Suspense 的显示延后约 300 ms，实测会让历史卡片晚出现约 700 ms。
- 懒加载的按钮：
  - 历史「再加载 10 天」：请求下一页 `history-N`。
  - 包列表「再显示 40 个」。
  - 展开一行：请求 `pkg/<i>.json`。
  - 「依赖树」：逐级点开，点开一级才渲染一级。
  - 长依赖列表「显示全部」。
- 搜索、过滤、排序用 `useDeferredValue`，计算期间表格半透明（`.stale`）。
- 缓存：`public/_headers` 给 `/assets/*` 和带版本号的数据分片设置了 `max-age=31536000, immutable`。分片 URL 带 `?v=<summary.version>`，重新采集后 version 会变。HTML 保持 Cloudflare 默认的 `max-age=0, must-revalidate`。新增分片文件时，要在 `_headers` 里补上对应规则；`summary.json` 不能设成 immutable。
- 性能基准（`node scripts/perf.mjs [url]`，4 倍 CPU 降速）：，首屏约 320 ms，历史卡片约 450 ms，滚动到包列表约 110 ms，各种点击 45 到 150 ms（改造前首屏约 1.8 s）。线上（从这台机器访问，经过 Cloudflare DFW 节点，单次往返 200-600 ms）第一次打开首屏约 1.2-1.7 s，基本都花在网络往返上；第二次打开 0 个网络请求，首屏约 0.2-0.4 s。改动之后要重新测一遍，别让数字倒退。

### 7.2 区块

1. **标题行**：版本号、分支和提交、生成时间，以及插件判定规则的一句说明。
2. **总览卡片**：DSH 包总数、Cordis 可加载插件包（含插件入口数）、被内置 profile 引用的包数、dsh CLI 外部依赖闭包。
3. **每日版本与新增**：
   - 4 张卡片：最新版本、当前包总数、近 7 天新增、近 7 天删除。
   - 包总数折线图。
   - 按天的卡片，只列有新增、删除或版本变化的日子，默认显示 10 天，底部按钮每次再加载一页（10 天）。
   - 每个新增包直接显示：全称、类型、目录、作用（description）、直接依赖（全称）、链条摘要（传递依赖数、深度、最长链）。“依赖树”按钮展开可逐级展开的树，出现环或重复时显示 ↺。
4. **各 profile 装载的插件**：每个 profile 的行数、启用、条件启用、禁用、涉及的包数，以及对应的条形图。点击一行可以过滤下方的包列表。
5. **按分组**：每组的插件、库、client 数量。点击可以过滤包列表。
6. **包列表**：
   - 默认只显示插件，按被依赖数倒序，每次显示 40 行。
   - 每行显示：全称和作用、类型和分组、首次出现日期、入口数、所在 profile（5 个都有时显示“全部”）、直接依赖数、传递依赖数、深度、被依赖数、外部依赖数。
   - 可以搜索，可以按类型、分组、profile 过滤，也可以只看未被 profile 引用的包。点列头排序。
   - 点击一行展开：插件入口、profile 行（状态和条件）、依赖、被依赖、外部依赖和依赖树。
7. **外部依赖闭包**。

设计约束：信息密度要高但要有层次；桌面宽 1180px，手机宽 390px 时不能横向溢出（宽表格在自己的容器里横向滚动）；浅色和深色都要能看清。改完 UI 要用 Playwright 截图检查桌面和手机两种宽度。Playwright 在 `~/coding/dsh-report-src/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs`，headless Chromium 已下载到 `~/.cache/ms-playwright`。

## 8. 部署细节

- `wrangler.jsonc` 中配置了 `routes: [{ pattern: "dsh-report.app238.com", custom_domain: true }]` 和 `workers_dev: false`。首次部署时 wrangler 自动创建了 DNS 和证书。
- 前端产物在 `dist/client`，由 assets 绑定服务，开启了 `not_found_handling: single-page-application`。
- 数据是 `public/data/` 下的静态 JSON，由 assets 绑定服务，没有 API。
- 部署会有一条关于 preview URLs 的 WARNING，可以忽略。

## 9. 已知限制和可做的下一步

- 历史数据只看 `package.json`：插件、库这类分类只有当前版本有；已删除包的作用和依赖停留在它被新增那天。想要历史分类，得对每天的 commit 做构建（成本高），或者改成静态分析源码的默认导出。
- 改名在历史里显示为“删除 + 新增”。可以按目录或描述相似度做改名识别。
- profile 合并是近似结果。想要精确结果，可以在上游 clone 里真实启动一个 profile，从 Cordis loader 导出实际加载的插件树。
- 版本号只取根 `package.json`，各包自己的版本没有展示。
- 可以加每个包的变更历史，比如描述或依赖在哪天变过。这需要在 collect 里对每天的 manifest 做字段 diff。
- 没有自动化测试；验证方式是 `eslint`、`tsc -b`、`build` 和截图。

## 10. 改动流程

1. 改 `collect.mjs`，同步改 `types.ts`，再运行 `node scripts/collect.mjs ../../dsh-report-src`。
2. 改前端，然后运行 `npx eslint src worker && npx tsc -b && bun run build`。
3. 重启 preview，用 Playwright 截图检查桌面和手机两种宽度。
4. `git commit`（提交信息末尾加 `Co-Authored-By` 署名行），`bun run deploy`，`git push origin main`。
5. 确认线上页面：`curl -s https://dsh-report.app238.com/ | grep title`；或者用 Playwright 打开线上页面，确认 `.stat-value` 能渲染、没有 pageerror。
