# DSH 包报告 API 使用说明

地址：`{{ORIGIN}}`。所有接口都只支持 `GET`，返回 UTF-8 JSON，允许跨域（`Access-Control-Allow-Origin: *`），不需要鉴权。数据每小时更新一次（新仓库），每天更新一次（包、profile、历史）。

- 包数据来自 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 `master` 分支。
- 新仓库来自 GitHub 搜索：带 `deepseek-harness` 或 `dsh` topic，且按北京时间当天创建的仓库。
- **Cordis 不算 DSH 包**：`vendor/` 下的 cordis、cosmokit、schemastery、cordis-plugin-* 不出现在任何结果里，对它们的依赖也不计入依赖和依赖链条。
- 日期一律为北京时间的 `YYYY-MM-DD`，时间戳为 ISO 8601（UTC）。

## 通用约定

**成功响应**

```json
{ "data": [...], "meta": { "total": 189, "limit": 50, "offset": 0, "generatedAt": "2026-09-30T10:45:43.000Z", "source": { "commit": "639ed015…", "branch": "master", "version": "0.2.0-rc.2" } } }
```

- `data`：结果，列表接口是数组，详情接口是对象。
- `meta.total`：筛选后的总数，不受分页影响。
- `meta.generatedAt` 和 `meta.source`：数据生成时间，以及对应的上游提交。

**失败响应**：HTTP 状态码为 400、404、405 或 500。

```json
{ "error": { "code": "bad_request", "message": "min_stars must be an integer in [0, 1000000000]" } }
```

**通用参数**

| 参数 | 说明 |
|---|---|
| `limit` | 每页条数，默认值和上限见各接口 |
| `offset` | 跳过的条数，默认 0 |
| `pretty` | 设为 `1` 时输出缩进格式的 JSON |

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
| `GET /api/categories` | 新仓库的作用分类，以及每类的判定关键词 |

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

## GET /api/repos/days

返回 `[{ day, total, official, community }]`，按日期从新到旧排列，列出所有有新仓库数据的日期。

## GET /api/categories

返回 `[{ id, label, keywords }]`。分类规则如下：
- 把仓库的 topic、名称和描述合在一起，转成小写。
- 按列表顺序逐类检查，第一个命中关键词的分类就是它的分类。
- 英文关键词按整词匹配，中文关键词按子串匹配。
- 都没有命中的归入 `other`。

## GET /api/summary 与 GET /api/profiles

`/api/summary` 返回首页用到的全部汇总数字：
- `totals`：包数、插件数和入口数、被 profile 引用的包数、CLI 外部依赖数，以及被排除的 Cordis 包名单。
- `latest`：最新版本与近 7 天的增删数。
- `profiles`、`groups`：各 profile、各分组的统计。
- `repoDays`：`[day, total, official]` 数组。
- `officialRepos`：全部官方仓库。

`/api/profiles` 返回 `[{ id, bundles, rows, on, conditional, off, packages }]`：
- `rows`：合并 bundle 补丁后得到的插件行数，其中 `on` 为启用、`conditional` 为条件启用、`off` 为禁用。
- `packages`：这些行涉及的 DSH 包数。
