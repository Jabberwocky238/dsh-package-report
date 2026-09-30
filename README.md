# DSH 包报告

接手维护请先读 [HANDOFF.md](HANDOFF.md)。

DeepSeek Harness（[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)）的 workspace 包报告，部署在 <https://dsh-report.app238.com>。

## 内容

- **总览**：DSH 包总数、Cordis 可加载插件包数、被内置 profile 引用的包数、`dsh` CLI 的外部依赖闭包大小。
- **每日版本与新增**：沿 upstream `master` 的 first-parent 提交，每天（北京时间）取最后一个提交，给出根 `package.json` 版本、workspace 包总数、新增与删除的包；每个新增包直接列出全称、作用、直接依赖和依赖链条摘要，依赖树可展开。
- **各 profile 装载的插件**：把 `packages/bundle/*` 的补丁（base + 模式层；web 另加 4 个 preset）按行 id 合并，统计启用、条件启用（`!!js`）和禁用的行。
- **按分组**：每个 `packages/<group>` 下插件、普通库、Client 包的数量。
- **包列表**：可按名称、类型、分组、profile 过滤。展开一行可以看插件入口、所在 profile 行、直接依赖、被依赖、外部依赖和依赖链条（传递依赖数、最深层数、最长链、可展开的依赖树）。
- **外部依赖闭包**：由 `pnpm-lock.yaml` 计算的各应用生产依赖闭包，以及带入包最多的直接依赖。

## 判定规则

- **Cordis 插件**：对包 `exports` 里的每个 JS 入口执行 import，按 Cordis loader 的规则取 `default ?? module`，结果是类、函数或带 `apply` 的对象就算插件。带 `dsh.client` 的包是浏览器代码，不参与判定。
- **依赖**：DSH 依赖取 `dependencies`、`optionalDependencies`、`peerDependencies` 里的 workspace 包；依赖链条按这个关系做广度优先遍历。
- **profile 合并**只处理 `insert` 和带 `disabled` 的按 id 补丁，是近似结果，不等于实际启动时的插件树。

## 数据生成

```sh
# deepseek-harness 需要先 install + build：插件判定会 import 构建产物
node scripts/collect.mjs <path-to-deepseek-harness>   # 写入 src/data/report.json
bun run dev                                           # 本地预览
bun run deploy                                        # 构建并部署到 Cloudflare Workers
```

## 每日更新

`scripts/daily.sh` 会依次执行：把 `~/coding/dsh-report-src`（upstream 的独立 clone，可用 `DSH_SRC` 覆盖）更新到 `origin/master`、`pnpm install` 和 `pnpm run build`、采集数据、部署，并在数据有变化时提交 `src/data/report.json` 推到本仓库的 `main`。本机 crontab 每天运行一次：

```cron
30 6 * * * /home/zq/coding/deepseek-harness/dsh-package-report/scripts/daily.sh >> $HOME/.cache/dsh-report-daily.log 2>&1
```
