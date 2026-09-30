import { useMemo, useState } from 'react'
import data from './data/report.json'
import { makeLookup } from './deps.ts'
import { DepChain, History } from './History.tsx'
import type { Package, PackageKind, Profile, Report, RowState } from './types.ts'

const report = data as Report
const deps = makeLookup(report.packages, report.history)

const KIND_LABEL: Record<PackageKind, string> = {
  plugin: 'Cordis 插件',
  library: '普通库',
  client: 'Client 前端',
  unbuilt: '未构建',
  app: '应用',
}
const STATE_LABEL: Record<RowState, string> = { on: '启用', conditional: '条件启用', off: '禁用' }
const KINDS: PackageKind[] = ['plugin', 'library', 'client', 'unbuilt', 'app']

const short = (name: string) => name.replace(/^@deepseek-ai\/(dsh-)?/, '')
const count = <T,>(xs: T[], f: (x: T) => boolean) => xs.reduce((n, x) => n + (f(x) ? 1 : 0), 0)

function profileStats(p: Profile) {
  const pkgs = new Set(p.rows.map((r) => r.package).filter(Boolean))
  return {
    rows: p.rows.length,
    on: count(p.rows, (r) => r.state === 'on'),
    conditional: count(p.rows, (r) => r.state === 'conditional'),
    off: count(p.rows, (r) => r.state === 'off'),
    packages: pkgs.size,
  }
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

function Bar({ parts, max }: { parts: { cls: string; value: number; title: string }[]; max: number }) {
  return (
    <div className="bar">
      {parts.map((p) =>
        p.value ? <span key={p.cls} className={p.cls} style={{ width: `${(p.value / max) * 100}%` }} title={`${p.title} ${p.value}`} /> : null,
      )}
    </div>
  )
}

function Summary() {
  const pk = report.packages
  const plugins = pk.filter((p) => p.kind === 'plugin')
  const entries = plugins.reduce((n, p) => n + p.entries.length, 0)
  const referenced = new Set(report.profiles.flatMap((p) => p.rows.map((r) => r.package)).filter(Boolean))
  const cli = report.closures.find((c) => c.root === 'apps/cli')
  return (
    <section className="stats">
      <Stat label="DSH 包总数" value={pk.length} sub={`packages ${count(pk, (p) => p.group !== 'vendor' && p.group !== 'apps')} · vendor ${count(pk, (p) => p.group === 'vendor')} · apps ${count(pk, (p) => p.group === 'apps')}`} />
      <Stat label="Cordis 可加载插件包" value={plugins.length} sub={`${entries} 个插件入口（含子路径导出）`} />
      <Stat label="被内置 profile 引用" value={referenced.size} sub={`${count(plugins, (p) => !p.profiles.length)} 个插件包未被任何 profile 引用`} />
      <Stat label="dsh CLI 外部依赖闭包" value={cli?.external ?? '-'} sub={cli ? `${cli.externalVersions} 个版本 · 带入 ${cli.workspace} 个 workspace 包` : undefined} />
    </section>
  )
}

function Profiles({ active, onSelect }: { active: string | null; onSelect: (id: string | null) => void }) {
  const stats = report.profiles.map((p) => ({ p, s: profileStats(p) }))
  const max = Math.max(...stats.map((x) => x.s.rows))
  return (
    <section>
      <h2>各 profile 装载的插件</h2>
      <p className="note">合并 bundle 补丁（base + 模式层；web 另加 4 个 preset）按行 id 计算，只处理 insert 与 disabled。点击一行按该 profile 过滤下方表格。</p>
      <table className="profiles">
        <thead>
          <tr><th>profile</th><th>bundle 链</th><th className="num">行</th><th className="num">启用</th><th className="num">条件</th><th className="num">禁用</th><th className="num">包</th><th className="wide" /></tr>
        </thead>
        <tbody>
          {stats.map(({ p, s }) => (
            <tr key={p.id} className={active === p.id ? 'active' : ''} onClick={() => onSelect(active === p.id ? null : p.id)}>
              <td><code>{p.id}</code></td>
              <td className="muted">{p.bundles.map(short).join(' + ')}</td>
              <td className="num">{s.rows}</td>
              <td className="num">{s.on}</td>
              <td className="num">{s.conditional}</td>
              <td className="num">{s.off}</td>
              <td className="num strong">{s.packages}</td>
              <td className="wide">
                <Bar max={max} parts={[
                  { cls: 'on', value: s.on, title: '启用' },
                  { cls: 'conditional', value: s.conditional, title: '条件启用' },
                  { cls: 'off', value: s.off, title: '禁用' },
                ]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function Groups({ active, onSelect }: { active: string | null; onSelect: (g: string | null) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, Record<PackageKind, number>>()
    for (const p of report.packages) {
      const g = m.get(p.group) ?? { plugin: 0, library: 0, client: 0, unbuilt: 0, app: 0 }
      g[p.kind]++
      m.set(p.group, g)
    }
    return [...m].sort((a, b) => b[1].plugin - a[1].plugin || a[0].localeCompare(b[0]))
  }, [])
  const max = Math.max(...groups.map(([, g]) => KINDS.reduce((n, k) => n + g[k], 0)))
  return (
    <section>
      <h2>按分组</h2>
      <div className="legend">{KINDS.map((k) => <span key={k}><i className={k} />{KIND_LABEL[k]}</span>)}</div>
      <div className="groups">
        {groups.map(([name, g]) => (
          <button key={name} className={`group ${active === name ? 'active' : ''}`} onClick={() => onSelect(active === name ? null : name)}>
            <span className="group-name">{name}</span>
            <span className="group-count">{g.plugin}</span>
            <Bar max={max} parts={KINDS.map((k) => ({ cls: k, value: g[k], title: KIND_LABEL[k] }))} />
          </button>
        ))}
      </div>
    </section>
  )
}

function Closures() {
  return (
    <section>
      <h2>外部依赖闭包（pnpm-lock.yaml）</h2>
      <div className="closures">
        {report.closures.map((c) => (
          <div key={c.root} className="closure">
            <h3><code>{c.root}</code></h3>
            <p><b>{c.external}</b> 个外部包 · {c.externalVersions} 个版本 · {c.workspace} 个 workspace 包</p>
            {c.heaviest.length > 0 && (
              <ol>
                {c.heaviest.slice(0, 8).map((h) => (
                  <li key={h.name}><span>{h.name}</span><span className="muted">{h.size}</span></li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>
      <p className="note">锁文件共 {report.lockfile.snapshots} 个 snapshot、{report.lockfile.importers} 个 importer。右列为该直接依赖自身带入的包数（含平台可选二进制）。</p>
    </section>
  )
}

function PackageDetail({ p }: { p: Package }) {
  const rows = report.profiles.flatMap((pr) => pr.rows.filter((r) => r.package === p.name).map((r) => ({ profile: pr.id, ...r })))
  return (
    <div className="detail">
      {p.description && <p>{p.description}</p>}
      <p className="muted"><code>{p.dir}</code>{p.firstSeen && <> · 首次出现 {p.firstSeen}</>}</p>
      {p.entries.length > 0 && (
        <>
          <h4>插件入口</h4>
          <ul>{p.entries.map((e) => <li key={e.entry}><code>{e.entry}</code> <span className="tag">{e.kind}</span></li>)}</ul>
        </>
      )}
      {rows.length > 0 && (
        <>
          <h4>profile 行</h4>
          <ul>
            {rows.map((r) => (
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
        <div><h4>依赖的 DSH 包（{p.workspaceDeps.length}）</h4><p className="chips">{p.workspaceDeps.map((d) => <span key={d}>{short(d)}</span>)}</p></div>
        <div><h4>被依赖（{p.dependents.length}）</h4><p className="chips">{p.dependents.map((d) => <span key={d}>{short(d)}</span>)}</p></div>
        <div><h4>外部运行时依赖（{p.externalDeps.length}）</h4><p className="chips">{p.externalDeps.map((d) => <span key={d}>{d}</span>)}</p></div>
      </div>
      <DepChain name={p.name} deps={deps} />
    </div>
  )
}

type SortKey = 'name' | 'group' | 'firstSeen' | 'entries' | 'profiles' | 'externalDeps' | 'dependents'

function Packages({ profile, group }: { profile: string | null; group: string | null }) {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<PackageKind | 'all'>('plugin')
  const [unused, setUnused] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'dependents', dir: -1 })
  const [open, setOpen] = useState<string | null>(null)

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const val = (p: Package, k: SortKey) => (k === 'name' || k === 'group' ? p[k] : k === 'firstSeen' ? p.firstSeen ?? '' : p[k].length)
    return report.packages
      .filter((p) => (kind === 'all' || p.kind === kind)
        && (!profile || p.profiles.includes(profile))
        && (!group || p.group === group)
        && (!unused || !p.profiles.length)
        && (!needle || p.name.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle)))
      .sort((a, b) => {
        const x = val(a, sort.key), y = val(b, sort.key)
        return (x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name)) * sort.dir
      })
  }, [q, kind, profile, group, unused, sort])

  const th = (key: SortKey, label: string, num = false) => (
    <th className={num ? 'num sortable' : 'sortable'} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : num ? -1 : 1 }))}>
      {label}{sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </th>
  )

  return (
    <section>
      <h2>包列表 <span className="muted">{list.length}</span></h2>
      <div className="filters">
        <input placeholder="搜索名称或描述" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value as PackageKind | 'all')}>
          <option value="all">全部类型</option>
          {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <label><input type="checkbox" checked={unused} onChange={(e) => setUnused(e.target.checked)} /> 仅未被 profile 引用</label>
        {profile && <span className="pill">profile: {profile}</span>}
        {group && <span className="pill">group: {group}</span>}
      </div>
      <div className="table-wrap">
        <table className="packages">
          <thead>
            <tr>{th('name', '包')}{th('group', '分组')}<th>类型</th>{th('firstSeen', '首次出现')}{th('entries', '入口', true)}{th('profiles', 'profile', true)}{th('externalDeps', '外部依赖', true)}{th('dependents', '被依赖', true)}</tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <PackageRow key={p.name} p={p} open={open === p.name} onToggle={() => setOpen(open === p.name ? null : p.name)} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function PackageRow({ p, open, onToggle }: { p: Package; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className={open ? 'open' : ''} onClick={onToggle}>
        <td><code>{short(p.name)}</code></td>
        <td className="muted">{p.group}</td>
        <td><span className={`kind ${p.kind}`}>{KIND_LABEL[p.kind]}</span>{p.bundle && <span className="tag">bundle</span>}</td>
        <td className="muted">{p.firstSeen ?? ''}</td>
        <td className="num">{p.entries.length || ''}</td>
        <td className="num" title={p.profiles.join(', ')}>{p.profiles.length || ''}</td>
        <td className="num">{p.externalDeps.length || ''}</td>
        <td className="num">{p.dependents.length || ''}</td>
      </tr>
      {open && <tr className="detail-row"><td colSpan={8}><PackageDetail p={p} /></td></tr>}
    </>
  )
}

export default function App() {
  const [profile, setProfile] = useState<string | null>(null)
  const [group, setGroup] = useState<string | null>(null)
  return (
    <main>
      <header>
        <h1>DeepSeek Harness 包报告</h1>
        <p className="muted">
          v{report.source.version} · <code>{report.source.branch}</code>@<code>{report.source.commit.slice(0, 10)}</code> · 生成于 {new Date(report.generatedAt).toLocaleString('zh-CN')}
        </p>
        <p className="note">“Cordis 插件”按 Cordis loader 的规则判定：import 包的每个导出入口，<code>default ?? module</code> 为类、函数或带 <code>apply</code> 的对象即算。</p>
      </header>
      <Summary />
      <History history={report.history} packages={report.packages} deps={deps} />
      <Profiles active={profile} onSelect={setProfile} />
      <Groups active={group} onSelect={setGroup} />
      <Packages profile={profile} group={group} />
      <Closures />
    </main>
  )
}
