import { useMemo, useState } from 'react'
import { chainStats, type DepsLookup } from './deps.ts'
import type { AddedPackage, Day, Package, PackageKind } from './types.ts'

const KIND_SHORT: Record<PackageKind, string> = { plugin: '插件', library: '库', client: 'client', unbuilt: '未构建', app: '应用' }
const PAGE = 10

function TreeNode({ name, deps, seen, level }: { name: string; deps: DepsLookup; seen: Set<string>; level: number }) {
  const children = deps(name)
  const [open, setOpen] = useState(level < 1)
  const repeated = seen.has(name)
  const nextSeen = useMemo(() => new Set([...seen, name]), [seen, name])
  return (
    <li>
      <span className={children.length && !repeated ? 'tree-toggle' : 'tree-leaf'} onClick={() => !repeated && setOpen(!open)}>
        {children.length && !repeated ? (open ? '▾ ' : '▸ ') : '· '}
        <code>{name}</code>
        {children.length > 0 && <span className="muted"> ({children.length})</span>}
        {repeated && <span className="muted"> ↺</span>}
      </span>
      {open && !repeated && children.length > 0 && (
        <ul className="tree">{children.map((c) => <TreeNode key={c} name={c} deps={deps} seen={nextSeen} level={level + 1} />)}</ul>
      )}
    </li>
  )
}

/** One-line chain summary with the longest path. */
export function ChainLine({ name, deps }: { name: string; deps: DepsLookup }) {
  const s = chainStats(name, deps)
  if (!s.transitive) return <span className="muted">无 DSH 依赖</span>
  return (
    <span className="path">
      传递 {s.transitive} · 深 {s.depth} · 最长链：
      {s.longest.slice(1).map((n, i) => <span key={n}>{i > 0 && <span className="arrow"> → </span>}<code>{n}</code></span>)}
    </span>
  )
}

export function DepChain({ name, deps }: { name: string; deps: DepsLookup }) {
  const direct = deps(name)
  return (
    <div className="chain">
      <h4>依赖链条</h4>
      <p><ChainLine name={name} deps={deps} /></p>
      {direct.length > 0 && <ul className="tree root">{direct.map((d) => <TreeNode key={d} name={d} deps={deps} seen={new Set([name])} level={0} />)}</ul>}
    </div>
  )
}

function Sparkline({ days }: { days: Day[] }) {
  const pts = [...days].reverse()
  const max = Math.max(...pts.map((d) => d.total), 1)
  const w = 800, h = 90
  const x = (i: number) => (i / Math.max(pts.length - 1, 1)) * w
  const y = (v: number) => h - (v / max) * (h - 6) - 3
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="每日包总数">
      <polyline points={pts.map((d, i) => `${x(i)},${y(d.total)}`).join(' ')} />
      {pts.map((d, i) => d.added.length > 0 && <circle key={d.day} cx={x(i)} cy={y(d.total)} r={2.5}><title>{`${d.day} ${d.total} 个包，+${d.added.length}`}</title></circle>)}
    </svg>
  )
}

function AddedItem({ a, deps, current }: { a: AddedPackage; deps: DepsLookup; current?: Package }) {
  const [open, setOpen] = useState(false)
  const direct = current?.workspaceDeps ?? a.workspaceDeps
  return (
    <li className="added">
      <div className="added-head">
        <code className="pkg">{a.name}</code>
        {current ? <span className={`kind ${current.kind}`}>{KIND_SHORT[current.kind]}</span> : <span className="tag">已移除</span>}
        <span className="muted mono-sm">{a.dir}</span>
      </div>
      <div className="added-desc">{a.description || <span className="muted">（无描述）</span>}</div>
      <div className="added-deps">
        <span className="label">依赖</span>
        {direct.length ? direct.map((d) => <code key={d}>{d}</code>) : <span className="muted">无</span>}
      </div>
      <div className="added-deps">
        <span className="label">链条</span>
        <ChainLine name={a.name} deps={deps} />
        {direct.length > 0 && <button className="link" onClick={() => setOpen(!open)}>{open ? '收起依赖树' : '依赖树'}</button>}
      </div>
      {open && <ul className="tree root">{direct.map((d) => <TreeNode key={d} name={d} deps={deps} seen={new Set([a.name])} level={0} />)}</ul>}
    </li>
  )
}

export function History({ history, packages, deps }: { history: Day[]; packages: Package[]; deps: DepsLookup }) {
  const byName = useMemo(() => new Map(packages.map((p) => [p.name, p])), [packages])
  const [shown, setShown] = useState(PAGE)
  const changed = history
    .map((d, i) => ({ d, prevVersion: history[i + 1]?.version }))
    .filter(({ d, prevVersion }) => d.added.length || d.removed.length || d.version !== prevVersion)
  const latest = history[0]
  const week = history.slice(0, 7)
  return (
    <section>
      <h2>每日版本与新增</h2>
      <div className="stats compact">
        <div className="stat"><div className="stat-value">{latest?.version}</div><div className="stat-label">最新版本 · {latest?.day}</div></div>
        <div className="stat"><div className="stat-value">{latest?.total}</div><div className="stat-label">当前包总数</div></div>
        <div className="stat"><div className="stat-value plus">+{week.reduce((n, d) => n + d.added.length, 0)}</div><div className="stat-label">近 7 天新增</div></div>
        <div className="stat"><div className="stat-value minus">{week.reduce((n, d) => n + d.removed.length, 0) ? `-${week.reduce((n, d) => n + d.removed.length, 0)}` : 0}</div><div className="stat-label">近 7 天删除</div></div>
      </div>
      <Sparkline days={history} />
      <p className="note">沿 upstream master 的 first-parent 提交，每天（北京时间）取最后一个提交比较 workspace 包清单。下面列出有新增、删除或版本变化的日子，共 {changed.length} 天。</p>
      <div className="days">
        {changed.slice(0, shown).map(({ d, prevVersion }) => (
          <article key={d.day} className="day">
            <header className="day-head">
              <b>{d.day}</b>
              <code className={d.version !== prevVersion ? 'bumped' : ''}>{d.version ?? '-'}</code>
              {d.version !== prevVersion && prevVersion && <span className="muted">← {prevVersion}</span>}
              <span className="muted">{d.total} 个包</span>
              {d.added.length > 0 && <span className="plus">+{d.added.length}</span>}
              {d.removed.length > 0 && <span className="minus">-{d.removed.length}</span>}
              <a className="commit" href={`https://github.com/deepseek-ai/deepseek-harness/commit/${d.commit}`} target="_blank" rel="noreferrer"><code>{d.commit.slice(0, 10)}</code></a>
            </header>
            {d.added.length > 0 && <ul className="added-list">{d.added.map((a) => <AddedItem key={a.name} a={a} deps={deps} current={byName.get(a.name)} />)}</ul>}
            {d.removed.length > 0 && <p className="chips removed"><span className="label">删除</span>{d.removed.map((n) => <code key={n}>{n}</code>)}</p>}
            {!d.added.length && !d.removed.length && <p className="muted small">仅版本变化，包清单不变。</p>}
          </article>
        ))}
      </div>
      {shown < changed.length && (
        <button className="more" onClick={() => setShown(shown + PAGE)}>再显示 {Math.min(PAGE, changed.length - shown)} 天（剩 {changed.length - shown} 天）</button>
      )}
    </section>
  )
}
