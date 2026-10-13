# DSH 包报告

<{{ORIGIN}}> 跟踪 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）生态，回答三个问题：上游有哪些包，社区做了哪些扩展，每天有什么变化。

## 本站做什么

- **上游包**：读取 `deepseek-ai/deepseek-harness` 的 `master` 分支，列出全部 workspace 包，给出类型（Cordis 能启动的插件、库、client、app）、依赖、被依赖和依赖链条，以及每个内置 profile 装载了哪些插件。
- **每日版本与新增**：按北京时间，记录每天的版本号、包总数、新增和删除的包，以及新增包的作用和依赖。
- **社区扩展，来源一：独立仓库**。GitHub 上带 `deepseek-harness` 或 `dsh` topic 的仓库，分官方（owner 为 deepseek-ai）和社区两类，再按作用自动分类。
- **社区扩展，来源二：fork 里的包**。大部分扩展没有独立仓库，直接写在 fork 里。本站扫描上游的全部 fork（含 fork 的 fork）和它们的**所有分支**，找出和上游 master 分歧的分支，以及这些分支新增的 workspace 包。
- **Cordis 不算 DSH 包**：`vendor/` 下的 cordis、cosmokit、schemastery、cordis-plugin-* 不出现在任何结果里，对它们的依赖也不计入依赖和依赖链条。

## 使用方法

- **看网页**：打开 <{{ORIGIN}}>。顶部的搜索框可以一次搜遍仓库、fork 里的包和 DSH 包；下面各区块都有筛选和排序。
- **调接口**：下文是全部 JSON 接口。最常用的是搜索，按关键词直接拿列表，每页最多 200 条，跟着 `meta.nextCursor` 翻页：

  ```sh
  curl '{{ORIGIN}}/api/search?q=memory&limit=200'
  ```

- 所有接口只支持 `GET`，返回 UTF-8 JSON，允许跨域（`Access-Control-Allow-Origin: *`），不需要鉴权。同一个 IP 每小时最多 600 次请求，超过返回 429（见下文「通用约定」）。
- 日期一律为北京时间的 `YYYY-MM-DD`，时间戳为 ISO 8601（UTC）。

## 更新频率

| 数据 | 频率 |
|---|---|
| 新仓库（topic 搜索） | 每小时，刷新昨天和今天 |
| 上游包、profile、每日历史 | 每天一次（北京时间 06:30 拉取上游 master 并构建） |
| fork 扫描 | 每天一次（北京时间 03:00，重新列出全部 fork 和分支，只比较新出现的提交） |

每个响应的 `meta.generatedAt` 是数据生成时间，`meta.source` 是对应的上游提交；fork 接口另有 `meta.scannedAt`。

## 参与贡献

- 源码：<https://github.com/Jabberwocky238/dsh-package-report>（分支 `main`），数据快照也提交在仓库的 `public/data/` 里。
- 发现分类不准、漏了扩展、接口不好用，欢迎提 issue 或 PR。维护手册见仓库里的 `HANDOFF.md`。
- 作用分类规则在 `src/categories.ts`，调整关键词不需要重新抓数据。
- 想让自己的扩展被收录：给独立仓库加上 `deepseek-harness` 或 `dsh` topic；写在 fork 里的包，在 `package.json` 里写好 `name`、`description` 和 `keywords`，下一次 fork 扫描就会收录。

# 接口说明

## 通用约定

**成功响应**

```json
{ "data": [...], "meta": { "total": 189, "limit": 50, "offset": 0, "generatedAt": "2026-09-30T10:45:43.000Z", "source": { "commit": "639ed015…", "branch": "master", "version": "0.2.0-rc.2" } } }
```

- `data`：结果，列表接口是数组，详情接口是对象。
- `meta.total`：筛选后的总数，不受分页影响。
- `meta.generatedAt` 和 `meta.source`：数据生成时间，以及对应的上游提交。

**失败响应**：HTTP 状态码为 400、404、405、429 或 500。

```json
{ "error": { "code": "bad_request", "message": "min_stars must be an integer in [0, 1000000000]" } }
```

**通用参数**

| 参数 | 说明 |
|---|---|
| `limit` | 每页条数，默认值和上限见各接口 |
| `offset` | 跳过的条数，默认 0 |
| `pretty` | 设为 `1` 时输出缩进格式的 JSON |

**限流**：同一个 IP 每小时（按整点计）最多请求 600 次，`/README.md` 也算在内。超过后返回 HTTP 429 和 `{ "error": { "code": "rate_limited", … } }`，`Retry-After` 头给出还要等多少秒。每个响应都带 `X-RateLimit-Limit`、`X-RateLimit-Remaining` 和 `X-RateLimit-Reset`（重置时刻的 Unix 秒）。要批量取数据，请用 `limit=200` 加 cursor 少翻几页，不要逐条请求。

多个值用英文逗号分隔，例如 `kind=plugin,library`。布尔参数接受 `true`/`false`、`1`/`0`、`yes`/`no`。参数值不合法时返回 400，不会被悄悄忽略。

## 接口一览

| 接口 | 用途 |
|---|---|
| `GET /api` | 列出所有接口 |
| `GET /api/summary` | 总览数字：包数、插件数、最新版本、profile 统计、分组统计、每天的新仓库数量、官方仓库 |
| `GET /api/packages` | DSH 包列表（可筛选、排序、分页） |
| `GET /api/packages/{name}` | 单个包的详情：插件入口、依赖、被依赖、外部依赖、profile 行、完整依赖链 |
| `GET /api/profiles` | 各 profile 的插件行统计 |
| `GET /api/history` | 每日版本号与新增、删除的包 |
| `GET /api/repos` | 新仓库（可按来源、作用、topic、语言、star 等筛选） |
| `GET /api/repos/days` | 有新仓库数据的日期，以及每天的数量 |
| `GET /api/search` | 按关键词搜索仓库、fork 里的包、DSH 包，每页最多 200 条，用 cursor 翻页 |
| `GET /api/categories` | 新仓库的作用分类，以及每类的判定关键词 |
| `GET /api/forks` | 有自己提交的 DSH fork：分支数、领先多少提交、改了哪些分组、新增了多少包 |
| `GET /api/forks/{owner}/{repo}` | 单个 fork 的全部分歧分支和它新增的包 |
| `GET /api/forks/packages` | fork 分支里新增的 workspace 包（大部分 DSH 扩展没有独立仓库，写在 fork 里） |

## GET /api/packages

| 参数 | 说明 |
|---|---|
| `q` | 名称或描述包含该文本，不区分大小写 |
| `kind` | `plugin`（Cordis 插件）、`library`、`client`、`unbuilt`、`app`，可多选 |
| `group` | `packages/<group>` 的分组名，如 `core,llm`，可多选 |
| `profile` | 只返回出现在该 profile 里的包：`headless`、`acp`、`sdk`、`sdk-minimal`、`web` |
| `unused` | `true` 时只返回不在任何 profile 里的包 |
| `since` / `until` | 首次出现日期的范围（含两端） |
| `min_dependents` | 被依赖数不少于该值 |
| `sort` | `name`、`group`、`firstSeen`、`entries`、`workspaceDeps`、`transitive`、`depth`、`dependents`（默认）、`externalDeps` |
| `order` | `asc` 或 `desc`；按 name 和 group 排序时默认 `asc`，其余默认 `desc` |
| `limit` | 默认 50，最大 500 |

每一项的字段：

| 字段 | 说明 |
|---|---|
| `name` | 包名 |
| `group` | 分组 |
| `kind` | 类型 |
| `bundle` | 是否为 profile bundle |
| `description` | 包的作用（取自 package.json） |
| `firstSeen` | 首次出现的日期 |
| `entries` | Cordis 插件入口数 |
| `profiles` | 出现在哪些 profile 里 |
| `workspaceDeps` | 直接依赖的 DSH 包数 |
| `transitive` | 传递依赖的 DSH 包数 |
| `depth` | 依赖链最深层数 |
| `dependents` | 被多少个 DSH 包依赖 |
| `externalDeps` | 外部 npm 运行时依赖数 |

```sh
# 被依赖最多的 10 个插件
curl '{{ORIGIN}}/api/packages?kind=plugin&limit=10'
# web profile 里、2026-09-20 之后新增的包
curl '{{ORIGIN}}/api/packages?profile=web&since=2026-09-20&sort=firstSeen'
# 没被任何 profile 引用的插件
curl '{{ORIGIN}}/api/packages?kind=plugin&unused=true&limit=500'
```

## GET /api/packages/{name}

`{name}` 直接写完整包名，斜杠不需要转义，例如 `/api/packages/@deepseek-ai/dsh-llm`。

返回列表项里的全部字段，另外还有：
- `dir`：包所在目录。
- `entries`：插件入口列表 `[{ entry, kind }]`，kind 为 `class`、`object` 或 `function`。
- `workspaceDeps`、`dependents`、`externalDeps`：完整名单。注意在详情接口里这三个字段是列表，在列表接口里是数量。
- `rows`：出现在哪些 profile 的哪一行 `[{ profile, id, entry, parent, state, condition }]`，state 为 `on`、`conditional` 或 `off`。
- `chain`：依赖链 `{ transitive, depth, longest, all }`。`longest` 是一条最长依赖路径，`all` 是按广度优先顺序列出的全部传递依赖。

```sh
curl '{{ORIGIN}}/api/packages/@deepseek-ai/dsh-llm?pretty=1'
```

## GET /api/history

只包含有新增包、删除包或版本变化的日子，按日期从新到旧排列。

| 参数 | 说明 |
|---|---|
| `from` / `to` | 日期范围（含两端） |
| `has` | `added`、`removed`、`version`，满足任意一个即返回 |
| `package` | 当天新增或删除的包名包含该文本 |
| `limit` | 默认 30，最大 200 |

每一项的字段：
- `day`、`commit`：日期，以及当天最后一个上游提交。
- `version`、`prevVersion`：当天的根 package.json 版本，以及前一天的版本。
- `total`：当天的 DSH 包总数。
- `added`：新增的包 `[{ name, dir, description, workspaceDeps }]`。
- `removed`：删除的包名。

```sh
# 最近有新增包的 5 天
curl '{{ORIGIN}}/api/history?has=added&limit=5'
# 所有版本号变化
curl '{{ORIGIN}}/api/history?has=version&limit=200'
```

## GET /api/repos

默认返回最近一天的全部新仓库，按 star 从高到低排列。

| 参数 | 说明 |
|---|---|
| `day` | 指定某一天 |
| `from` / `to` | 日期范围，不能和 `day` 同时使用；一次最多 31 天 |
| `source` | `all`（默认）、`official`（owner 为 deepseek-ai）、`community` |
| `category` | 作用分类 id，可多选，id 列表见 `/api/categories` |
| `topic` | 必须同时带有这些 topic（全部满足） |
| `any_topic` | 带有其中任意一个 topic 即可 |
| `language` | 主要编程语言，如 `TypeScript,JavaScript`，不区分大小写 |
| `min_stars` | star 数不少于该值 |
| `forks` | `false` 时排除 fork 仓库，默认包含 |
| `archived` | `false` 时排除已归档仓库，默认包含 |
| `q` | 名称或描述包含该文本 |
| `sort` | `stars`（默认）、`created`、`pushed`、`name` |
| `order` | `asc` 或 `desc`；按 name 排序时默认 `asc`，其余默认 `desc` |
| `facets` | `true` 时在 `meta.facets` 里返回筛选后结果按来源、作用、语言、topic 分别计数（topic 取前 100 个） |
| `limit` | 默认 100，最大 1000 |

每一项的字段：

| 字段 | 说明 |
|---|---|
| `name` | `owner/repo` |
| `official` | 是否为官方仓库 |
| `description` | 仓库描述 |
| `stars`、`forks` | star 数和 fork 数 |
| `language` | 主要编程语言 |
| `topics` | 仓库的全部 topic |
| `createdAt`、`pushedAt` | 创建时间和最近推送时间 |
| `homepage` | 主页地址 |
| `archived`、`fork` | 是否已归档、是否为 fork |
| `matched` | 命中了 deepseek-harness 和 dsh 中的哪些 topic |
| `day` | 按北京时间算的创建日期 |
| `category`、`categoryLabel` | 作用分类的 id 和中文名 |

`meta` 里还有这些字段：
- `days`：本次查询覆盖的日期。
- `fetchedAt`：这些数据最近一次从 GitHub 拉取的时间。
- `truncated`：为 `true` 时，表示某天某个 topic 在一分钟内就超过了 1000 个结果，GitHub 搜索没有返回全部仓库。

```sh
# 今天的社区皮肤类仓库
curl '{{ORIGIN}}/api/repos?source=community&category=skin'
# 近 7 天 star ≥ 5、TypeScript 写的 MCP 或 IM 渠道类仓库，按创建时间排序
curl '{{ORIGIN}}/api/repos?from=2026-09-24&to=2026-09-30&category=mcp,channel&language=TypeScript&min_stars=5&sort=created'
# 某一天同时带 dsh-plugin 和 memory 两个 topic 的仓库
curl '{{ORIGIN}}/api/repos?day=2026-09-28&topic=dsh-plugin,memory'
# 只要各项计数，不要列表
curl '{{ORIGIN}}/api/repos?from=2026-09-01&to=2026-09-30&facets=true&limit=1'
```

## GET /api/search

在一个列表里搜索四类东西：topic 仓库（`repo`，全部日期）、有自己提交的 fork（`fork`）、fork 里新增的包（`fork-package`）、上游 DSH 包（`package`）。按 GitHub 用户名搜，能同时找到这个人的仓库、fork 和 fork 里的包。

| 参数 | 说明 |
|---|---|
| `q` | 关键词，和 `topic`、`any_topic` 至少给一个。多个词用空格分开，全部出现在名称、描述或 topic 里才算命中，不区分大小写。fork 包的 topic 取 `package.json` 的 keywords，还会匹配带着它的 fork 名；fork 的描述包含最新提交标题，topic 是改动过的分组 |
| `topic` | 必须同时带有这些 topic（精确匹配，不区分大小写，全部满足），如 `topic=dsh-tool` |
| `any_topic` | 带有其中任意一个 topic 即可 |
| `type` | `repo`、`fork`、`fork-package`、`package`，可多选 |
| `source` | `all`（默认）、`official`、`community`；fork 包都算社区，DSH 包都算官方 |
| `category` | 作用分类 id，可多选，见 `/api/categories` |
| `min_stars` | star 数不少于该值（fork 包取带着它的 fork 里 star 最多的） |
| `since` / `until` | 日期范围：仓库按创建日，fork 包和 DSH 包按首次出现的日子 |
| `sort` | `relevance`（默认：名称完全相同、名称包含、来源 fork 名包含、topic 命中依次靠前，再按 star）、`stars`、`day`、`name` |
| `limit` | 每页条数，默认 50，**最多 200**，超过按 200 截断 |
| `cursor` | 上一页 `meta.nextCursor` 的值，原样传回即得下一页 |

每一项带 `type`、`name`、`description`、`url`、`topics`、`stars`、`day`、`official`、`language`、`category`、`categoryLabel`；fork 包另有 `fork`、`branch`（链接指向的 fork 和分支）、`forks`（几个 fork 带着它）、`via`（带着它的 fork，最多 50 个）；fork 另有 `branch`（最新的分支）、`branches`（分歧分支数）、`added`（新增的上游没有的包数）；DSH 包另有 `kind`。

`meta` 里有 `total`（命中总数）、`offset`、`limit`、`returned`、`limitCapped`（`limit` 是否被截到 200）、`truncated`（后面是否还有）和 `nextCursor`（没有下一页时为 `null`）。cursor 和查询参数、数据版本绑定：换了参数或数据刷新后再用旧 cursor 会返回 400，从第一页重新请求即可。

```sh
# 搜 memory，一次 200 条
curl '{{ORIGIN}}/api/search?q=memory&limit=200'
# 下一页
curl '{{ORIGIN}}/api/search?q=memory&limit=200&cursor=<meta.nextCursor>'
# 按 topic 精确筛选，不带关键词
curl '{{ORIGIN}}/api/search?topic=dsh-tool'
# 只搜社区里的皮肤类仓库和 fork 包，按 star 排
curl '{{ORIGIN}}/api/search?q=skin&type=repo,fork-package&category=skin&sort=stars'
```

## GET /api/repos/days

返回 `[{ day, total, official, community }]`，按日期从新到旧排列，列出所有有新仓库数据的日期。

## GET /api/categories

返回 `[{ id, label, keywords }]`。分类规则如下：
- 把仓库的 topic、名称和描述合在一起，转成小写。
- 按列表顺序逐类检查，第一个命中关键词的分类就是它的分类。
- 英文关键词按整词匹配，中文关键词按子串匹配。
- 都没有命中的归入 `other`。

## fork 扫描：GET /api/forks…

数据来自对 `deepseek-ai/deepseek-harness` 全部 fork（含 fork 的 fork）的扫描：
- 每个 fork 的**所有分支**都检查，`dependabot/`、`renovate/` 开头的机器人分支除外。
- 分支头本身就是上游 master 上的某个提交时，这个分支没有自己的改动，不收录。
- 剩下的分支和上游 master 比较，得到领先和落后的提交数、改动的文件，以及新增的 `package.json`。`node_modules`、`test`、`fixtures`、`examples`、`templates` 下的不算。

这几个接口的 `meta` 里都带 `scannedAt`（扫描时间）、`upstreamHead`（比较时上游 master 的提交）和 `totals`（fork 数、分歧的 fork 和分支数、新增包数）。还没有扫描数据时返回 404。

### GET /api/forks

每个 fork 一项，只列至少有一个分歧分支的 fork。默认先按新增包数，再按最近提交排列。

| 参数 | 说明 |
|---|---|
| `has_packages` | `true` 时只看新增了上游没有的包的 fork |
| `touches` | 改动过这些分组（全部满足）。分组是 `packages/<分组>/…` 里的那一级，其他目录取顶层目录名，如 `llm,channel` |
| `parent` | 只看从某个仓库 fork 出来的，`owner/repo` |
| `min_ahead` | 至少有一个分支领先上游的提交数不少于该值 |
| `min_stars` | star 数不少于该值 |
| `since` | 最近一次提交不早于该日期 |
| `q` | fork 名、描述或最新提交标题包含该文本 |
| `sort` | `added`（默认）、`date`、`ahead`、`branches`、`stars`、`name` |
| `order` | `asc` 或 `desc`；按 name 排序时默认 `asc`，其余默认 `desc` |
| `limit` | 默认 50，最大 500 |

每一项的字段：

| 字段 | 说明 |
|---|---|
| `fork`、`parent` | fork 仓库，以及它是从哪个仓库 fork 的（上游或另一个 fork） |
| `stars`、`description`、`createdAt` | star 数、描述、创建时间 |
| `branches` | 分歧分支数 |
| `ahead` | 各分支里领先上游最多的提交数 |
| `branch`、`date`、`message` | 最新的分支、它最后一次提交的时间和标题 |
| `added`、`newAdded` | 各分支新增的包数（去重），以及其中上游从没有过的 |
| `groups` | 改动过的分组 |

### GET /api/forks/{owner}/{repo}

单个 fork 的详情：上面的字段，加上 `packages`（它新增的包，`[{ name, description, dir, upstream }]`）和 `branchList`（全部分歧分支，最新的在前）。`branchList` 每一项：

| 字段 | 说明 |
|---|---|
| `branch`、`default` | 分支名，是否为默认分支 |
| `sha` | 分支头提交 |
| `ahead`、`behind` | 领先和落后上游 master 的提交数 |
| `files`、`capped` | 改动的文件数；GitHub 最多列出 300 个，`capped` 为 `true` 时实际更多 |
| `date`、`message` | 最后一次提交的时间和标题 |
| `added` | 这个分支新增的包名 |
| `touched` | 有改动的包目录，如 `packages/llm/llm-deepseek` |

不存在或没有分歧分支的 fork 返回 404。

### GET /api/forks/packages

列出 fork 里新增的包，同名包合并为一项，默认按出现在多少个 fork 里从多到少排列。

| 参数 | 说明 |
|---|---|
| `upstream` | `true` 时也包含上游有过同名包的项（多半是移动目录或改回旧名），默认排除 |
| `dsh` | `true` 时只看带 `dsh` 字段或依赖 DSH 包的 |
| `dir` | 目录前缀，可多选，如 `packages/llm,packages/channel` |
| `depends_on` | 依赖这些包（全部满足），如 `@deepseek-ai/dsh-core` |
| `fork` | 出现在某个 fork 里 |
| `min_forks` | 至少出现在这么多个 fork 里 |
| `since` | 最近一次相关提交不早于该日期 |
| `q` | 包名或描述包含该文本 |
| `sort` | `forks`（默认）、`date`、`name` |
| `order` | `asc` 或 `desc`；按 name 排序时默认 `asc`，其余默认 `desc` |
| `limit` | 默认 50，最大 500 |

每一项的字段：

| 字段 | 说明 |
|---|---|
| `name`、`description`、`dir` | 包名、描述、所在目录（取第一次见到它的分支） |
| `upstream` | 上游是否有过同名包 |
| `dsh` | `package.json` 是否带 `dsh` 字段 |
| `dshDeps` | 依赖的 DSH 包 |
| `deps` | 其他依赖 |
| `forks` | `[{ fork, branches, branch, date }]`，每个 fork 一项，最新的在前：有几个分支带着这个包，以及其中最新的分支 |

```sh
# 新增包最多的 fork
curl '{{ORIGIN}}/api/forks?has_packages=true'
# 改过 LLM 适配器、领先至少 5 个提交的 fork，按最近提交排序
curl '{{ORIGIN}}/api/forks?touches=llm&min_ahead=5&sort=date'
# 某个 fork 的全部分支
curl '{{ORIGIN}}/api/forks/lisihao/deepseek-solar-harness'
# 依赖 DSH 的新增包，按最近提交排序
curl '{{ORIGIN}}/api/forks/packages?dsh=true&sort=date'
```

## GET /api/summary 与 GET /api/profiles

`/api/summary` 返回首页用到的全部汇总数字：
- `totals`：包数、插件数和入口数、被 profile 引用的包数、CLI 外部依赖数，以及被排除的 Cordis 包名单。
- `latest`：最新版本与近 7 天的增删数。
- `profiles`、`groups`：各 profile、各分组的统计。
- `repoDays`：`[day, total, official]` 数组。
- `officialRepos`：全部官方仓库。
- `forks`：fork 扫描的总数和扫描时间，字段同 `/api/forks` 的 `meta.totals`。

`/api/profiles` 返回 `[{ id, bundles, rows, on, conditional, off, packages }]`：
- `rows`：合并 bundle 补丁后得到的插件行数，其中 `on` 为启用、`conditional` 为条件启用、`off` 为禁用。
- `packages`：这些行涉及的 DSH 包数。
