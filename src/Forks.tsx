import { memo, useDeferredValue, useMemo, useState } from 'react'
import { ChipList } from './Chain.tsx'
import { useShard } from './data.ts'
import { Loading } from './LazySection.tsx'
import type { ForkBranch, ForkPackage, Forks as ForksData, Summary } from './types.ts'

const PAGE = 30
const UPSTREAM = 'deepseek-ai/deepseek-harness'
const AHEAD_STEPS = [0, 2, 5, 20, 100]
type Tab = 'packages' | 'branches'
type PkgOrder = 'forks' | 'date' | 'name'
type BranchOrder = 'date' | 'ahead' | 'added' | 'stars'

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '-')
const treeUrl = (fork: string, branch: string) => `https://github.com/${fork}/tree/${branch.split('/').map(encodeURIComponent).join('/')}`
const compareUrl = (fork: string, branch: string) => `https://github.com/${UPSTREAM}/compare/master...${fork.replace('/', ':')}:${encodeURIComponent(branch)}`
/** packages/<group>/<name> → <group>; anything else → its top directory. */
const groupOf = (dir: string) => (dir.startsWith('packages/') ? dir.split('/')[1] ?? 'packages' : dir.split('/')[0])
const latest = (p: ForkPackage) => p.forks.reduce((m, f) => (f.date && f.date > m ? f.date : m), '')

function tally(keys: string[]): [string, number][] {
  const m = new Map<string, number>()
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

const PackageItem = memo(function PackageItem({ p }: { p: ForkPackage }) {
  const [all, setAll] = useState(false)
  const shown = all ? p.forks : p.forks.slice(0, 3)
  return (
    <li className="repo">
      <div className="repo-head">
        <span className="pkg">{p.name}</span>
        {p.dsh && <span className="tag">dsh</span>}
        {p.upstream && <span className="tag">上游同名</span>}
        <code className="muted small-inline">{p.dir}</code>
        <span className="muted small-inline">{p.forks.length} 个分支 · 最近 {time(latest(p) || null)}</span>
      </div>
      {p.description && <div className="added-desc">{p.description}</div>}
      {p.dshDeps.length > 0 && <div className="added-deps"><span className="label">DSH 依赖</span><ChipList items={p.dshDeps} /></div>}
      {p.deps.length > 0 && <div className="added-deps"><span className="label">其他依赖</span><ChipList items={p.deps} /></div>}
      <div className="chips">
        {shown.map((f) => <a key={`${f.fork}:${f.branch}`} className="topic" href={treeUrl(f.fork, f.branch)} target="_blank" rel="noreferrer">{f.fork}@{f.branch}</a>)}
        {p.forks.length > 3 && <button className="link" onClick={() => setAll(!all)}>{all ? '收起' : `+${p.forks.length - 3}`}</button>}
      </div>
    </li>
  )
})

function Packages({ data }: { data: ForksData }) {
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<string | null>(null)
  const [withUpstream, setWithUpstream] = useState(false)
  const [dshOnly, setDshOnly] = useState(false)
  const [order, setOrder] = useState<PkgOrder>('forks')
  const [limit, setLimit] = useState(PAGE)
  const dq = useDeferredValue(q)
  const reset = () => setLimit(PAGE)
  const base = useMemo(() => {
    const needle = dq.trim().toLowerCase()
    return data.packages.filter((p) => (withUpstream || !p.upstream) && (!dshOnly || p.dsh || p.dshDeps.length > 0)
      && (!needle || p.name.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle) || p.forks.some((f) => f.fork.toLowerCase().includes(needle))))
  }, [data, dq, withUpstream, dshOnly])
  const groups = useMemo(() => tally(base.map((p) => groupOf(p.dir))), [base])
  const list = useMemo(() => {
    const l = group ? base.filter((p) => groupOf(p.dir) === group) : base
    if (order === 'name') return [...l].sort((a, b) => a.name.localeCompare(b.name))
    if (order === 'date') return [...l].sort((a, b) => latest(b).localeCompare(latest(a)))
    return l
  }, [base, group, order])
  return (
    <>
      <div className="facet">
        <span className="label">目录</span>
        <button className={`facet-chip ${group === null ? 'on' : ''}`} onClick={() => { setGroup(null); reset() }}>全部 <b>{base.length}</b></button>
        {groups.map(([g, n]) => <button key={g} className={`facet-chip ${group === g ? 'on' : ''}`} onClick={() => { setGroup(group === g ? null : g); reset() }}>{g} <b>{n}</b></button>)}
      </div>
      <div className="filters">
        <input placeholder="搜索包名、描述或 fork" value={q} onChange={(e) => { setQ(e.target.value); reset() }} />
        <select value={order} onChange={(e) => { setOrder(e.target.value as PkgOrder); reset() }}>
          <option value="forks">按分支数</option>
          <option value="date">按最近提交</option>
          <option value="name">按名称</option>
        </select>
        <label><input type="checkbox" checked={dshOnly} onChange={(e) => { setDshOnly(e.target.checked); reset() }} /> 只看依赖 DSH 的</label>
        <label><input type="checkbox" checked={withUpstream} onChange={(e) => { setWithUpstream(e.target.checked); reset() }} /> 含上游同名包</label>
        <span className="muted small-inline">{list.length} 个</span>
      </div>
      <ul className={`repo-list ${dq !== q ? 'stale' : ''}`}>{list.slice(0, limit).map((p) => <PackageItem key={p.name} p={p} />)}</ul>
      {!list.length && <p className="loading">没有符合条件的包</p>}
      {limit < list.length && <button className="more" onClick={() => setLimit(limit + PAGE)}>再显示 {Math.min(PAGE, list.length - limit)} 个（剩 {list.length - limit} 个）</button>}
    </>
  )
}

const BranchItem = memo(function BranchItem({ b }: { b: ForkBranch }) {
  return (
    <li className="repo">
      <div className="repo-head">
        <a className="pkg" href={treeUrl(b.fork, b.branch)} target="_blank" rel="noreferrer">{b.fork}<span className="muted">@{b.branch}</span></a>
        {b.stars > 0 && <span className="repo-stars">★ {b.stars}</span>}
        {b.default && <span className="tag">默认分支</span>}
        <a className="muted small-inline" href={compareUrl(b.fork, b.branch)} target="_blank" rel="noreferrer">领先 {b.ahead} · 落后 {b.behind} · {b.files}{b.capped ? '+' : ''} 个文件</a>
        <span className="muted small-inline">{time(b.date)}</span>
      </div>
      {b.message && <div className="added-desc">{b.message}</div>}
      {b.added.length > 0 && <div className="added-deps"><span className="label">新增包</span><ChipList items={b.added} /></div>}
      {b.touched.length > 0 && <div className="added-deps"><span className="label">改动目录</span><ChipList items={b.touched} /></div>}
    </li>
  )
})

function Branches({ data }: { data: ForksData }) {
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<string | null>(null)
  const [addedOnly, setAddedOnly] = useState(false)
  const [defaultOnly, setDefaultOnly] = useState(false)
  const [minAhead, setMinAhead] = useState(0)
  const [order, setOrder] = useState<BranchOrder>('date')
  const [limit, setLimit] = useState(PAGE)
  const dq = useDeferredValue(q)
  const reset = () => setLimit(PAGE)
  const base = useMemo(() => {
    const needle = dq.trim().toLowerCase()
    return data.branches.filter((b) => (!addedOnly || b.added.length > 0) && (!defaultOnly || b.default) && b.ahead >= minAhead
      && (!needle || `${b.fork}@${b.branch}`.toLowerCase().includes(needle) || b.message.toLowerCase().includes(needle)
        || b.added.some((n) => n.toLowerCase().includes(needle)) || b.touched.some((t) => t.includes(needle))))
  }, [data, dq, addedOnly, defaultOnly, minAhead])
  // A branch counts once per group it touches.
  const groups = useMemo(() => tally(base.flatMap((b) => [...new Set(b.touched.map(groupOf))])).slice(0, 30), [base])
  const list = useMemo(() => {
    const l = group ? base.filter((b) => b.touched.some((t) => groupOf(t) === group)) : base
    const key = { date: (b: ForkBranch) => b.date ?? '', ahead: (b: ForkBranch) => b.ahead, added: (b: ForkBranch) => b.added.length, stars: (b: ForkBranch) => b.stars }[order]
    return [...l].sort((a, b) => { const x = key(a), y = key(b); return x < y ? 1 : x > y ? -1 : 0 })
  }, [base, group, order])
  return (
    <>
      <div className="facet">
        <span className="label">改动</span>
        <button className={`facet-chip ${group === null ? 'on' : ''}`} onClick={() => { setGroup(null); reset() }}>全部 <b>{base.length}</b></button>
        {groups.map(([g, n]) => <button key={g} className={`facet-chip ${group === g ? 'on' : ''}`} onClick={() => { setGroup(group === g ? null : g); reset() }}>{g} <b>{n}</b></button>)}
      </div>
      <div className="filters">
        <input placeholder="搜索 fork、分支、提交信息、包或目录" value={q} onChange={(e) => { setQ(e.target.value); reset() }} />
        <select value={minAhead} onChange={(e) => { setMinAhead(Number(e.target.value)); reset() }}>
          {AHEAD_STEPS.map((n) => <option key={n} value={n}>{n ? `领先 ≥ ${n}` : '任意领先'}</option>)}
        </select>
        <select value={order} onChange={(e) => { setOrder(e.target.value as BranchOrder); reset() }}>
          <option value="date">按最近提交</option>
          <option value="ahead">按领先提交数</option>
          <option value="added">按新增包数</option>
          <option value="stars">按 star</option>
        </select>
        <label><input type="checkbox" checked={addedOnly} onChange={(e) => { setAddedOnly(e.target.checked); reset() }} /> 只看新增包的</label>
        <label><input type="checkbox" checked={defaultOnly} onChange={(e) => { setDefaultOnly(e.target.checked); reset() }} /> 只看默认分支</label>
        <span className="muted small-inline">{list.length} 个</span>
      </div>
      <ul className={`repo-list ${dq !== q ? 'stale' : ''}`}>{list.slice(0, limit).map((b) => <BranchItem key={`${b.fork}@${b.branch}`} b={b} />)}</ul>
      {!list.length && <p className="loading">没有符合条件的分支</p>}
      {limit < list.length && <button className="more" onClick={() => setLimit(limit + PAGE)}>再显示 {Math.min(PAGE, list.length - limit)} 个（剩 {list.length - limit} 个）</button>}
    </>
  )
}

export default function Forks({ summary }: { summary: Summary }) {
  const t = summary.forks
  const [tab, setTab] = useState<Tab>('packages')
  const { data, error } = useShard<ForksData>(t ? 'forks' : null)
  if (!t) return null
  return (
    <section>
      <h2>fork 里的扩展 <span className="muted">{t.forks} 个 fork · {t.divergentForks} 个有自己的提交 · 扫描于 {time(t.generatedAt)}</span></h2>
      <div className="tabs">
        <button className={tab === 'packages' ? 'on' : ''} onClick={() => setTab('packages')}>新增包 <b>{t.newPackages}</b></button>
        <button className={tab === 'branches' ? 'on' : ''} onClick={() => setTab('branches')}>分歧分支 <b>{t.divergentBranches}</b></button>
      </div>
      {!data ? <Loading error={error} /> : tab === 'packages' ? <Packages data={data} /> : <Branches data={data} />}
    </section>
  )
}
