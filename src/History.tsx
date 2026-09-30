import { useMemo, useState, type ReactNode } from 'react'
import type { DepsLookup } from './deps.ts'
import type { AddedPackage, Day, Package } from './types.ts'

const short = (name: string) => name.replace(/^@deepseek-ai\/(dsh-)?/, '')

function chainStats(root: string, deps: DepsLookup) {
  const depth = new Map<string, number>([[root, 0]])
  const via = new Map<string, string>()
  const queue = [root]
  while (queue.length) {
    const n = queue.shift()!
    for (const d of deps(n)) {
      if (depth.has(d)) continue
      depth.set(d, depth.get(n)! + 1)
      via.set(d, n)
      queue.push(d)
    }
  }
  depth.delete(root)
  let deepest = root
  for (const [n, k] of depth) if (k > (depth.get(deepest) ?? 0)) deepest = n
  const path = [deepest]
  while (via.has(path[0])) path.unshift(via.get(path[0])!)
  return { transitive: depth.size, depth: depth.get(deepest) ?? 0, longest: deepest === root ? [] : path }
}

function TreeNode({ name, deps, seen, level }: { name: string; deps: DepsLookup; seen: Set<string>; level: number }) {
  const children = deps(name)
  const [open, setOpen] = useState(level < 1)
  const repeated = seen.has(name)
  const nextSeen = useMemo(() => new Set([...seen, name]), [seen, name])
  return (
    <li>
      <span className={children.length && !repeated ? 'tree-toggle' : 'tree-leaf'} onClick={() => !repeated && setOpen(!open)}>
        {children.length && !repeated ? (open ? '▾ ' : '▸ ') : '· '}
        <code>{short(name)}</code>
        {children.length > 0 && <span className="muted"> ({children.length})</span>}
        {repeated && <span className="muted"> ↺</span>}
      </span>
      {open && !repeated && children.length > 0 && (
        <ul className="tree">{children.map((c) => <TreeNode key={c} name={c} deps={deps} seen={nextSeen} level={level + 1} />)}</ul>
      )}
    </li>
  )
}

export function DepChain({ name, deps }: { name: string; deps: DepsLookup }) {
  const s = useMemo(() => chainStats(name, deps), [name, deps])
  const direct = deps(name)
  return (
    <div className="chain">
      <h4>依赖链条</h4>
      <p className="muted">直接依赖 {direct.length} 个 DSH 包 · 传递依赖 {s.transitive} 个 · 最深 {s.depth} 层</p>
      {s.longest.length > 1 && (
        <p className="path">最长链：{s.longest.map((n, i) => <span key={n}>{i > 0 && ' → '}<code>{short(n)}</code></span>)}</p>
      )}
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
  return (
    <li className="added">
      <div className="added-head" onClick={() => setOpen(!open)}>
        <span>{open ? '▾' : '▸'} <code>{short(a.name)}</code></span>
        {current ? <span className={`kind ${current.kind}`}>{current.kind}</span> : <span className="tag">已移除</span>}
        <span className="muted added-desc">{a.description || '（无描述）'}</span>
      </div>
      {open && (
        <div className="detail">
          <p className="muted"><code>{a.name}</code> · <code>{a.dir}</code></p>
          <p className="chips">依赖：{a.workspaceDeps.length ? a.workspaceDeps.map((d) => <span key={d}>{short(d)}</span>) : '无 DSH 依赖'}</p>
          <DepChain name={a.name} deps={deps} />
        </div>
      )}
    </li>
  )
}

export function History({ history, packages, deps }: { history: Day[]; packages: Package[]; deps: DepsLookup }) {
  const byName = useMemo(() => new Map(packages.map((p) => [p.name, p])), [packages])
  const [onlyChanges, setOnlyChanges] = useState(true)
  const [open, setOpen] = useState<string | null>(history.find((d) => d.added.length)?.day ?? null)
  const days = onlyChanges ? history.filter((d, i) => d.added.length || d.removed.length || d.version !== history[i + 1]?.version) : history
  const latest = history[0]
  return (
    <section>
      <h2>每日版本与新增</h2>
      <p className="note">
        沿 upstream master 的 first-parent 提交，每天（北京时间）取最后一个提交比较 workspace 包清单。最新：<b>{latest?.day}</b> · 版本 <code>{latest?.version}</code> · {latest?.total} 个包。
      </p>
      <Sparkline days={history} />
      <label className="toggle"><input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} /> 只看有新增/删除/版本变化的日子</label>
      <div className="table-wrap history-wrap">
        <table className="history">
          <thead><tr><th>日期</th><th>版本</th><th className="num">包总数</th><th className="num">新增</th><th className="num">删除</th><th>提交</th></tr></thead>
          <tbody>
            {days.map((d) => {
              const i = history.indexOf(d)
              const bumped = d.version !== history[i + 1]?.version
              return (
                <HistoryRow key={d.day} d={d} bumped={bumped} open={open === d.day} onToggle={() => setOpen(open === d.day ? null : d.day)}>
                  {d.added.length > 0 && <ul className="added-list">{d.added.map((a) => <AddedItem key={a.name} a={a} deps={deps} current={byName.get(a.name)} />)}</ul>}
                  {d.removed.length > 0 && <p className="chips removed">删除：{d.removed.map((n) => <span key={n}>{short(n)}</span>)}</p>}
                </HistoryRow>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function HistoryRow({ d, bumped, open, onToggle, children }: { d: Day; bumped: boolean; open: boolean; onToggle: () => void; children: ReactNode }) {
  const expandable = d.added.length > 0 || d.removed.length > 0
  return (
    <>
      <tr className={`${open ? 'open' : ''} ${expandable ? '' : 'static'}`} onClick={expandable ? onToggle : undefined}>
        <td>{expandable ? (open ? '▾ ' : '▸ ') : ''}{d.day}</td>
        <td>{d.version ? <code className={bumped ? 'bumped' : ''}>{d.version}</code> : '-'}</td>
        <td className="num">{d.total}</td>
        <td className="num plus">{d.added.length ? `+${d.added.length}` : ''}</td>
        <td className="num minus">{d.removed.length ? `-${d.removed.length}` : ''}</td>
        <td><a href={`https://github.com/deepseek-ai/deepseek-harness/commit/${d.commit}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><code>{d.commit.slice(0, 10)}</code></a></td>
      </tr>
      {open && <tr className="detail-row"><td colSpan={6}>{children}</td></tr>}
    </>
  )
}
