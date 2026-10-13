import { memo, useDeferredValue, useMemo, useState } from 'react'
import { ChipList } from './Chain.tsx'
import { useShard } from './data.ts'
import { Loading } from './LazySection.tsx'
import type { ForkBranch, ForkPackage, ForkRow, Forks as ForksData, Summary } from './types.ts'

const PAGE = 30
const BRANCH_PAGE = 20
const UPSTREAM = 'deepseek-ai/deepseek-harness'
const AHEAD_STEPS = [0, 2, 5, 20, 100]
type Tab = 'packages' | 'forks'
type PkgOrder = 'forks' | 'date' | 'name'
type ForkOrder = 'added' | 'date' | 'ahead' | 'branches' | 'stars'

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '-')
const treeUrl = (fork: string, branch: string) => `https://github.com/${fork}/tree/${branch.split('/').map(encodeURIComponent).join('/')}`
const compareUrl = (fork: string, branch: string) => `https://github.com/${UPSTREAM}/compare/master...${fork.replace('/', ':')}:${encodeURIComponent(branch)}`
/** packages/<group>/<name> → <group>; anything else → its top directory. */
const groupOf = (dir: string) => (dir.startsWith('packages/') ? dir.split('/')[1] ?? 'packages' : dir.split('/')[0])

function tally(keys: string[]): [string, number][] {
  const m = new Map<string, number>()
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function Facet({ label, counts, total, active, onSelect }: { label: string; counts: [string, number][]; total: number; active: string | null; onSelect: (g: string | null) => void }) {
  return (
    <div className="facet">
      <span className="label">{label}</span>
      <button className={`facet-chip ${active === null ? 'on' : ''}`} onClick={() => onSelect(null)}>全部 <b>{total}</b></button>
      {counts.map(([g, n]) => <button key={g} className={`facet-chip ${active === g ? 'on' : ''}`} onClick={() => onSelect(active === g ? null : g)}>{g} <b>{n}</b></button>)}
    </div>
  )
}

function More({ shown, total, step, onMore }: { shown: number; total: number; step: number; onMore: () => void }) {
  return shown < total ? <button className="more" onClick={onMore}>再显示 {Math.min(step, total - shown)} 个（剩 {total - shown} 个）</button> : null
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
        <span className="muted small-inline">{p.forks.length} 个 fork · 最近 {time(p.forks[0]?.date ?? null)}</span>
      </div>
      {p.description && <div className="added-desc">{p.description}</div>}
      {p.dshDeps.length > 0 && <div className="added-deps"><span className="label">DSH 依赖</span><ChipList items={p.dshDeps} limit={6} /></div>}
      {p.deps.length > 0 && <div className="added-deps"><span className="label">其他依赖</span><ChipList items={p.deps} limit={6} /></div>}
      <div className="chips">
        {shown.map((f) => (
          <a key={f.fork} className="topic" href={treeUrl(f.fork, f.branch)} target="_blank" rel="noreferrer" title={f.branches > 1 ? `${f.branches} 个分支带有它，链接到最新的一个` : undefined}>
            {f.fork}@{f.branch}{f.branches > 1 ? ` +${f.branches - 1}` : ''}
          </a>
        ))}
        {p.forks.length > 3 && <button className="link" onClick={() => setAll(!all)}>{all ? '收起' : `其余 ${p.forks.length - 3} 个 fork`}</button>}
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
  const groups = useMemo(() => tally(base.map((p) => groupOf(p.dir))).slice(0, 30), [base])
  const list = useMemo(() => {
    const l = group ? base.filter((p) => groupOf(p.dir) === group) : base
    if (order === 'name') return [...l].sort((a, b) => a.name.localeCompare(b.name))
    if (order === 'date') return [...l].sort((a, b) => (b.forks[0]?.date ?? '').localeCompare(a.forks[0]?.date ?? ''))
    return l
  }, [base, group, order])
  return (
    <>
      <Facet label="目录" counts={groups} total={base.length} active={group} onSelect={(g) => { setGroup(g); reset() }} />
      <div className="filters">
        <input placeholder="搜索包名、描述或 fork" value={q} onChange={(e) => { setQ(e.target.value); reset() }} />
        <select value={order} onChange={(e) => { setOrder(e.target.value as PkgOrder); reset() }}>
          <option value="forks">按 fork 数</option>
          <option value="date">按最近提交</option>
          <option value="name">按名称</option>
        </select>
        <label><input type="checkbox" checked={dshOnly} onChange={(e) => { setDshOnly(e.target.checked); reset() }} /> 只看依赖 DSH 的</label>
        <label><input type="checkbox" checked={withUpstream} onChange={(e) => { setWithUpstream(e.target.checked); reset() }} /> 含上游同名包</label>
        <span className="muted small-inline">{list.length} 个</span>
      </div>
      <ul className={`repo-list ${dq !== q ? 'stale' : ''}`}>{list.slice(0, limit).map((p) => <PackageItem key={p.name} p={p} />)}</ul>
      {!list.length && <p className="loading">没有符合条件的包</p>}
      <More shown={limit} total={list.length} step={PAGE} onMore={() => setLimit(limit + PAGE)} />
    </>
  )
}

function Branches({ fork, index, chunk }: { fork: string; index: number; chunk: number }) {
  const { data, error } = useShard<ForkBranch[][]>(`forks/${Math.floor(index / chunk)}`)
  const [limit, setLimit] = useState(BRANCH_PAGE)
  if (!data) return <Loading error={error} />
  const branches = data[index % chunk] ?? []
  return (
    <>
      <ul className="branch-list">
        {branches.slice(0, limit).map((b) => (
          <li key={b.branch}>
            <div className="repo-head">
              <a className="pkg" href={treeUrl(fork, b.branch)} target="_blank" rel="noreferrer">{b.branch}</a>
              {b.default && <span className="tag">默认分支</span>}
              <a className="muted small-inline" href={compareUrl(fork, b.branch)} target="_blank" rel="noreferrer">领先 {b.ahead} · 落后 {b.behind} · {b.files}{b.capped ? '+' : ''} 个文件</a>
              <span className="muted small-inline">{time(b.date)}</span>
            </div>
            {b.message && <div className="added-desc">{b.message}</div>}
            {b.added.length > 0 && <div className="added-deps"><span className="label">新增包</span><ChipList items={b.added} /></div>}
            {b.touched.length > 0 && <div className="added-deps"><span className="label">改动</span><ChipList items={b.touched} limit={8} /></div>}
          </li>
        ))}
      </ul>
      <More shown={limit} total={branches.length} step={BRANCH_PAGE} onMore={() => setLimit(limit + BRANCH_PAGE)} />
    </>
  )
}

const ForkItem = memo(function ForkItem({ r, index, chunk }: { r: ForkRow; index: number; chunk: number }) {
  const [open, setOpen] = useState(false)
  return (
    <li className={`repo ${open ? 'wide' : ''}`}>
      <div className="repo-head">
        <a className="pkg" href={`https://github.com/${r.fork}`} target="_blank" rel="noreferrer">{r.fork}</a>
        {r.stars > 0 && <span className="repo-stars">★ {r.stars}</span>}
        {r.newAdded > 0 && <span className="tag">新增 {r.newAdded} 个包</span>}
        {r.parent !== UPSTREAM && <span className="muted small-inline">fork 自 {r.parent}</span>}
        <span className="muted small-inline">{r.branches} 个分支 · 最多领先 {r.ahead} · 最近 {time(r.date)}</span>
      </div>
      {r.description && <div className="added-desc">{r.description}</div>}
      <div className="added-deps muted">
        <span className="label">最新</span><code>{r.branch}</code><span>{r.message}</span>
      </div>
      {r.groups.length > 0 && <div className="added-deps"><span className="label">改动</span><ChipList items={r.groups} limit={10} /></div>}
      <button className="link" onClick={() => setOpen(!open)}>{open ? '收起分支' : `查看 ${r.branches} 个分支`}</button>
      {open && <Branches fork={r.fork} index={index} chunk={chunk} />}
    </li>
  )
})

function ForkList({ data }: { data: ForksData }) {
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<string | null>(null)
  const [addedOnly, setAddedOnly] = useState(false)
  const [minAhead, setMinAhead] = useState(0)
  const [order, setOrder] = useState<ForkOrder>('added')
  const [limit, setLimit] = useState(PAGE)
  const dq = useDeferredValue(q)
  const reset = () => setLimit(PAGE)
  // Rows keep their index into data.forks, which locates their detail shard.
  const indexed = useMemo(() => data.forks.map((r, i) => [r, i] as const), [data])
  const base = useMemo(() => {
    const needle = dq.trim().toLowerCase()
    return indexed.filter(([r]) => (!addedOnly || r.newAdded > 0) && r.ahead >= minAhead
      && (!needle || r.fork.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle) || r.message.toLowerCase().includes(needle)))
  }, [indexed, dq, addedOnly, minAhead])
  const groups = useMemo(() => tally(base.flatMap(([r]) => r.groups)).slice(0, 30), [base])
  const list = useMemo(() => {
    const l = group ? base.filter(([r]) => r.groups.includes(group)) : base
    if (order === 'added') return l
    const key = { date: (r: ForkRow) => r.date ?? '', ahead: (r: ForkRow) => r.ahead, branches: (r: ForkRow) => r.branches, stars: (r: ForkRow) => r.stars }[order]
    return [...l].sort(([a], [b]) => { const x = key(a), y = key(b); return x < y ? 1 : x > y ? -1 : 0 })
  }, [base, group, order])
  return (
    <>
      <Facet label="改动" counts={groups} total={base.length} active={group} onSelect={(g) => { setGroup(g); reset() }} />
      <div className="filters">
        <input placeholder="搜索 fork、描述或提交信息" value={q} onChange={(e) => { setQ(e.target.value); reset() }} />
        <select value={minAhead} onChange={(e) => { setMinAhead(Number(e.target.value)); reset() }}>
          {AHEAD_STEPS.map((n) => <option key={n} value={n}>{n ? `领先 ≥ ${n}` : '任意领先'}</option>)}
        </select>
        <select value={order} onChange={(e) => { setOrder(e.target.value as ForkOrder); reset() }}>
          <option value="added">按新增包数</option>
          <option value="date">按最近提交</option>
          <option value="ahead">按领先提交数</option>
          <option value="branches">按分支数</option>
          <option value="stars">按 star</option>
        </select>
        <label><input type="checkbox" checked={addedOnly} onChange={(e) => { setAddedOnly(e.target.checked); reset() }} /> 只看新增包的</label>
        <span className="muted small-inline">{list.length} 个</span>
      </div>
      <ul className={`repo-list ${dq !== q ? 'stale' : ''}`}>{list.slice(0, limit).map(([r, i]) => <ForkItem key={r.fork} r={r} index={i} chunk={data.chunk} />)}</ul>
      {!list.length && <p className="loading">没有符合条件的 fork</p>}
      <More shown={limit} total={list.length} step={PAGE} onMore={() => setLimit(limit + PAGE)} />
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
      <h2>fork 里的扩展 <span className="muted">扫描 {t.forks} 个 fork · {t.divergentBranches} 个分歧分支 · {time(t.generatedAt)}</span></h2>
      <div className="tabs">
        <button className={tab === 'packages' ? 'on' : ''} onClick={() => setTab('packages')}>新增包 <b>{t.newPackages}</b></button>
        <button className={tab === 'forks' ? 'on' : ''} onClick={() => setTab('forks')}>有改动的 fork <b>{t.divergentForks}</b></button>
      </div>
      {!data ? <Loading error={error} /> : tab === 'packages' ? <Packages data={data} /> : <ForkList data={data} />}
    </section>
  )
}
