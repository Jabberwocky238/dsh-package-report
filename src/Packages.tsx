import { memo, useDeferredValue, useMemo, useState } from 'react'
import { ChipList, DepTree } from './Chain.tsx'
import { useGraph, useShard } from './data.ts'
import type { DepGraph } from './graph.ts'
import { Loading } from './LazySection.tsx'
import { KIND_LABEL, KINDS } from './labels.ts'
import type { PackageDetail, PackageKind, PackageRow, RowState } from './types.ts'

const STATE_LABEL: Record<RowState, string> = { on: '启用', conditional: '条件启用', off: '禁用' }
const PAGE = 40

type SortKey = 'name' | 'group' | 'firstSeen' | 'entries' | 'profiles' | 'workspaceDeps' | 'transitive' | 'depth' | 'dependents' | 'externalDeps'

function Detail({ p, graph }: { p: PackageRow; graph: DepGraph }) {
  const { data, error } = useShard<PackageDetail>(graph.shard(p.name))
  const [tree, setTree] = useState(false)
  if (!data) return <Loading error={error} />
  const s = graph.chain(p.name)
  return (
    <div className="detail">
      <p className="muted"><code>{data.dir}</code>{p.firstSeen && <> · 首次出现 {p.firstSeen}</>}</p>
      {data.entries.length > 0 && (
        <p className="chips"><span className="label">插件入口</span>{data.entries.map((e) => <code key={e.entry}>{e.entry} <span className="muted">{e.kind}</span></code>)}</p>
      )}
      {data.rows.length > 0 && (
        <>
          <h4>profile 行</h4>
          <ul>
            {data.rows.map((r) => (
              <li key={`${r.profile}/${r.id}`}>
                <code>{r.profile}</code> · <code>{r.id}</code>{r.parent && <span className="muted"> ⊂ {r.parent}</span>} ·{' '}
                <span className={`state ${r.state}`}>{STATE_LABEL[r.state]}</span>
                {r.condition && <code className="muted"> {r.condition}</code>}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="cols">
        <div><h4>依赖的 DSH 包（{data.workspaceDeps.length}）</h4><ChipList items={data.workspaceDeps} /></div>
        <div><h4>被依赖（{data.dependents.length}）</h4><ChipList items={data.dependents} /></div>
        <div><h4>外部运行时依赖（{data.externalDeps.length}）</h4><ChipList items={data.externalDeps} /></div>
      </div>
      <div className="chain">
        <h4>依赖链条</h4>
        <p className="path">
          传递 {s.transitive} · 深 {s.depth}{s.longest.length > 0 && ' · 最长链：'}
          {s.longest.map((n, i) => <span key={n}>{i > 0 && <span className="arrow"> → </span>}<code>{n}</code></span>)}
        </p>
        {data.workspaceDeps.length > 0 && <button className="link" onClick={() => setTree(!tree)}>{tree ? '收起依赖树' : '展开依赖树'}</button>}
        {tree && <div className="tree-wrap"><DepTree name={p.name} graph={graph} /></div>}
      </div>
    </div>
  )
}

const Row = memo(function Row({ p, graph, allProfiles, open, onToggle }: { p: PackageRow; graph: DepGraph; allProfiles: number; open: boolean; onToggle: (name: string) => void }) {
  const s = graph.chain(p.name)
  return (
    <>
      <tr className={open ? 'open' : ''} onClick={() => onToggle(p.name)}>
        <td className="name-cell"><code className="pkg">{p.name}</code><div className="desc">{p.description}</div></td>
        <td><span className={`kind ${p.kind}`}>{KIND_LABEL[p.kind]}</span>{p.bundle && <span className="tag">bundle</span>}<div className="desc">{p.group}</div></td>
        <td className="muted">{p.firstSeen ?? ''}</td>
        <td className="num">{p.entries || ''}</td>
        <td className="profiles-cell">{p.profiles.length === allProfiles ? <span className="ptag all">全部</span> : p.profiles.map((x) => <span key={x} className="ptag">{x}</span>)}</td>
        <td className="num">{p.workspaceDeps || ''}</td>
        <td className="num">{s.transitive || ''}</td>
        <td className="num">{s.depth || ''}</td>
        <td className="num">{p.dependents || ''}</td>
        <td className="num">{p.externalDeps || ''}</td>
      </tr>
      {open && <tr className="detail-row"><td colSpan={10}><Detail p={p} graph={graph} /></td></tr>}
    </>
  )
})

export default function Packages({ profile, group, allProfiles }: { profile: string | null; group: string | null; allProfiles: number }) {
  const { data: rows, error } = useShard<PackageRow[]>('packages')
  const { graph, error: gError } = useGraph()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<PackageKind | 'all'>('plugin')
  const [unused, setUnused] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'dependents', dir: -1 })
  const [open, setOpen] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const dq = useDeferredValue(q)
  const dKind = useDeferredValue(kind)
  const dUnused = useDeferredValue(unused)
  const dSort = useDeferredValue(sort)
  const dProfile = useDeferredValue(profile)
  const dGroup = useDeferredValue(group)
  const stale = dq !== q || dKind !== kind || dUnused !== unused || dSort !== sort || dProfile !== profile || dGroup !== group

  const list = useMemo(() => {
    if (!rows || !graph) return []
    const needle = dq.trim().toLowerCase()
    const { key, dir } = dSort
    const val = (p: PackageRow): string | number =>
      key === 'name' || key === 'group' ? p[key]
        : key === 'firstSeen' ? p.firstSeen ?? ''
          : key === 'transitive' || key === 'depth' ? graph.chain(p.name)[key]
            : key === 'profiles' ? p.profiles.length : p[key]
    return rows
      .filter((p) => (dKind === 'all' || p.kind === dKind)
        && (!dProfile || p.profiles.includes(dProfile))
        && (!dGroup || p.group === dGroup)
        && (!dUnused || !p.profiles.length)
        && (!needle || p.name.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle)))
      .sort((a, b) => {
        const x = val(a), y = val(b)
        return (x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name)) * dir
      })
  }, [rows, graph, dq, dKind, dUnused, dSort, dProfile, dGroup])

  const toggle = (name: string) => setOpen((o) => (o === name ? null : name))
  const th = (key: SortKey, label: string, num = false) => (
    <th className={num ? 'num sortable' : 'sortable'} onClick={() => { setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : num ? -1 : 1 })); setLimit(PAGE) }}>
      {label}{sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </th>
  )

  return (
    <section>
      <h2>包列表 <span className="muted">{rows && graph ? list.length : ''}</span></h2>
      <div className="filters">
        <input placeholder="搜索名称或描述" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE) }} />
        <select value={kind} onChange={(e) => { setKind(e.target.value as PackageKind | 'all'); setLimit(PAGE) }}>
          <option value="all">全部类型</option>
          {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <label><input type="checkbox" checked={unused} onChange={(e) => { setUnused(e.target.checked); setLimit(PAGE) }} /> 仅未被 profile 引用</label>
        {profile && <span className="pill">profile: {profile}</span>}
        {group && <span className="pill">group: {group}</span>}
      </div>
      {!rows || !graph ? <Loading error={error ?? gError} /> : (
        <>
          <div className={`table-wrap ${stale ? 'stale' : ''}`}>
            <table className="packages">
              <thead>
                <tr>{th('name', '包 / 作用')}{th('group', '类型 / 分组')}{th('firstSeen', '首次出现')}{th('entries', '入口', true)}{th('profiles', 'profile')}{th('workspaceDeps', '直接依赖', true)}{th('transitive', '传递', true)}{th('depth', '深', true)}{th('dependents', '被依赖', true)}{th('externalDeps', '外部', true)}</tr>
              </thead>
              <tbody>
                {list.slice(0, limit).map((p) => <Row key={p.name} p={p} graph={graph} allProfiles={allProfiles} open={open === p.name} onToggle={toggle} />)}
              </tbody>
            </table>
          </div>
          {limit < list.length && <button className="more" onClick={() => setLimit(limit + PAGE)}>再显示 {Math.min(PAGE, list.length - limit)} 个（剩 {list.length - limit} 个）</button>}
        </>
      )}
    </section>
  )
}
