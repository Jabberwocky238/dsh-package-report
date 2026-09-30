import { useEffect, useState } from 'react'
import { fetchShard, useShard } from './data.ts'
import { KIND_LABEL, KINDS } from './labels.ts'
import { LazySection, Loading } from './LazySection.tsx'
import type { Summary } from './types.ts'

const loadHistory = () => import('./History.tsx')
const loadPackages = () => import('./Packages.tsx')
const loadClosures = () => import('./Closures.tsx')

/** Starts the history requests in parallel right after summary, and warms the package list when the browser is idle. Nothing renders until scrolled to. */
function usePrefetch(ready: boolean) {
  useEffect(() => {
    if (!ready) return
    const swallow = (e: Error) => console.warn('prefetch failed', e)
    loadHistory().catch(swallow)
    fetchShard('graph').catch(swallow)
    fetchShard('history-0').catch(swallow)
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500))
    idle(() => {
      loadPackages().catch(swallow)
      fetchShard('packages').catch(swallow)
    })
  }, [ready])
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
      {parts.map((p) => (p.value ? <span key={p.cls} className={p.cls} style={{ width: `${(p.value / max) * 100}%` }} title={`${p.title} ${p.value}`} /> : null))}
    </div>
  )
}

function Overview({ s }: { s: Summary }) {
  const t = s.totals
  return (
    <section className="stats">
      <Stat label="DSH 包总数" value={t.packages} sub={`packages ${t.byGroupKind.packages} · vendor ${t.byGroupKind.vendor} · apps ${t.byGroupKind.apps}`} />
      <Stat label="Cordis 可加载插件包" value={t.plugins} sub={`${t.entries} 个插件入口（含子路径导出）`} />
      <Stat label="被内置 profile 引用" value={t.referenced} sub={`${t.unusedPlugins} 个插件包未被任何 profile 引用`} />
      <Stat label="dsh CLI 外部依赖闭包" value={t.cli?.external ?? '-'} sub={t.cli ? `${t.cli.externalVersions} 个版本 · 带入 ${t.cli.workspace} 个 workspace 包` : undefined} />
    </section>
  )
}

function Profiles({ s, active, onSelect }: { s: Summary; active: string | null; onSelect: (id: string | null) => void }) {
  const max = Math.max(...s.profiles.map((p) => p.rows))
  return (
    <section>
      <h2>各 profile 装载的插件</h2>
      <p className="note">合并 bundle 补丁（base + 模式层；web 另加 4 个 preset）按行 id 计算，只处理 insert 与 disabled。点击一行按该 profile 过滤下方包列表。</p>
      <table className="profiles">
        <thead>
          <tr><th>profile</th><th>bundle 链</th><th className="num">行</th><th className="num">启用</th><th className="num">条件</th><th className="num">禁用</th><th className="num">包</th><th className="wide" /></tr>
        </thead>
        <tbody>
          {s.profiles.map((p) => (
            <tr key={p.id} className={active === p.id ? 'active' : ''} onClick={() => onSelect(active === p.id ? null : p.id)}>
              <td><code>{p.id}</code></td>
              <td className="muted">{p.bundles.join(' + ')}</td>
              <td className="num">{p.rows}</td>
              <td className="num">{p.on}</td>
              <td className="num">{p.conditional}</td>
              <td className="num">{p.off}</td>
              <td className="num strong">{p.packages}</td>
              <td className="wide">
                <Bar max={max} parts={[{ cls: 'on', value: p.on, title: '启用' }, { cls: 'conditional', value: p.conditional, title: '条件启用' }, { cls: 'off', value: p.off, title: '禁用' }]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function Groups({ s, active, onSelect }: { s: Summary; active: string | null; onSelect: (g: string | null) => void }) {
  const groups = Object.entries(s.groups).sort((a, b) => b[1].plugin - a[1].plugin || a[0].localeCompare(b[0]))
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

export default function App() {
  const { data: s, error } = useShard<Summary>('summary')
  const [profile, setProfile] = useState<string | null>(null)
  const [group, setGroup] = useState<string | null>(null)
  usePrefetch(Boolean(s))
  if (!s) return <main><h1>DeepSeek Harness 包报告</h1><Loading error={error} /></main>
  return (
    <main>
      <header>
        <h1>DeepSeek Harness 包报告</h1>
        <p className="muted">
          v{s.source.version} · <code>{s.source.branch}</code>@<code>{s.source.commit.slice(0, 10)}</code> · 生成于 {new Date(s.generatedAt).toLocaleString('zh-CN')}
        </p>
        <p className="note">“Cordis 插件”按 Cordis loader 的规则判定：import 包的每个导出入口，<code>default ?? module</code> 为类、函数或带 <code>apply</code> 的对象即算。</p>
      </header>
      <Overview s={s} />
      <LazySection title="每日版本与新增" minHeight={1200} load={loadHistory} props={{ summary: s }} />
      <Profiles s={s} active={profile} onSelect={setProfile} />
      <Groups s={s} active={group} onSelect={setGroup} />
      <LazySection title="包列表" minHeight={1600} load={loadPackages} props={{ profile, group, allProfiles: s.profiles.length }} />
      <LazySection title="外部依赖闭包（pnpm-lock.yaml）" minHeight={400} load={loadClosures} props={{}} />
    </main>
  )
}
