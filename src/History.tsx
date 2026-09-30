import { memo, useState } from 'react'
import { ChainLine, TreeToggle } from './Chain.tsx'
import { useGraph, useShard } from './data.ts'
import type { DepGraph } from './graph.ts'
import { Loading } from './LazySection.tsx'
import type { AddedPackage, Day, PackageKind, Summary } from './types.ts'

const KIND_SHORT: Record<PackageKind, string> = { plugin: '插件', library: '库', client: 'client', unbuilt: '未构建', app: '应用' }

function Sparkline({ days }: { days: Summary['days'] }) {
  const pts = [...days].reverse()
  const max = Math.max(...pts.map((d) => d[1]), 1)
  const w = 800, h = 90
  const x = (i: number) => (i / Math.max(pts.length - 1, 1)) * w
  const y = (v: number) => h - (v / max) * (h - 6) - 3
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="每日包总数">
      <polyline points={pts.map((d, i) => `${x(i)},${y(d[1])}`).join(' ')} />
      {pts.map((d, i) => d[2] > 0 && <circle key={d[0]} cx={x(i)} cy={y(d[1])} r={2.5}><title>{`${d[0]} ${d[1]} 个包，+${d[2]}`}</title></circle>)}
    </svg>
  )
}

function AddedItem({ a, graph }: { a: AddedPackage; graph: DepGraph }) {
  const kind = graph.kind(a.name)
  const direct = kind ? graph.deps(a.name) : a.workspaceDeps
  return (
    <li className="added">
      <div className="added-head">
        <code className="pkg">{a.name}</code>
        {kind ? <span className={`kind ${kind}`}>{KIND_SHORT[kind]}</span> : <span className="tag">已移除</span>}
        <span className="muted mono-sm">{a.dir}</span>
      </div>
      <div className="added-desc">{a.description || <span className="muted">（无描述）</span>}</div>
      <div className="added-deps">
        <span className="label">依赖</span>
        {direct.length ? direct.map((d) => <code key={d}>{d}</code>) : <span className="muted">无</span>}
      </div>
      <div className="added-deps">
        <span className="label">链条</span>
        <ChainLine name={a.name} graph={graph} />
        <TreeToggle name={a.name} graph={graph} />
      </div>
    </li>
  )
}

const DayCard = memo(function DayCard({ d, graph }: { d: Day; graph: DepGraph }) {
  const bumped = d.version !== d.prevVersion
  return (
    <article className="day">
      <header className="day-head">
        <b>{d.day}</b>
        <code className={bumped ? 'bumped' : ''}>{d.version ?? '-'}</code>
        {bumped && d.prevVersion && <span className="muted">← {d.prevVersion}</span>}
        <span className="muted">{d.total} 个包</span>
        {d.added.length > 0 && <span className="plus">+{d.added.length}</span>}
        {d.removed.length > 0 && <span className="minus">-{d.removed.length}</span>}
        <a className="commit" href={`https://github.com/deepseek-ai/deepseek-harness/commit/${d.commit}`} target="_blank" rel="noreferrer"><code>{d.commit.slice(0, 10)}</code></a>
      </header>
      {d.added.length > 0 && <ul className="added-list">{d.added.map((a) => <AddedItem key={a.name} a={a} graph={graph} />)}</ul>}
      {d.removed.length > 0 && <p className="chips removed"><span className="label">删除</span>{d.removed.map((n) => <code key={n}>{n}</code>)}</p>}
      {!d.added.length && !d.removed.length && <p className="muted small">仅版本变化，包清单不变。</p>}
    </article>
  )
})

function HistoryPage({ page, graph }: { page: number; graph: DepGraph }) {
  const { data, error } = useShard<Day[]>(`history-${page}`)
  if (!data) return <Loading error={error} />
  return <>{data.map((d) => <DayCard key={d.day} d={d} graph={graph} />)}</>
}

export default function History({ summary }: { summary: Summary }) {
  const { graph, error } = useGraph()
  const [pages, setPages] = useState(1)
  const { latest } = summary
  return (
    <section>
      <h2>每日版本与新增</h2>
      <div className="stats compact">
        <div className="stat"><div className="stat-value">{latest.version}</div><div className="stat-label">最新版本 · {latest.day}</div></div>
        <div className="stat"><div className="stat-value">{latest.total}</div><div className="stat-label">当前包总数</div></div>
        <div className="stat"><div className="stat-value plus">+{latest.weekAdded}</div><div className="stat-label">近 7 天新增</div></div>
        <div className="stat"><div className="stat-value minus">{latest.weekRemoved ? `-${latest.weekRemoved}` : 0}</div><div className="stat-label">近 7 天删除</div></div>
      </div>
      <Sparkline days={summary.days} />
      <p className="note">沿 upstream master 的 first-parent 提交，每天（北京时间）取最后一个提交比较 workspace 包清单。下面列出有新增、删除或版本变化的日子，共 {summary.changedDays} 天，每次加载 10 天。</p>
      <div className="days">
        {graph ? Array.from({ length: pages }, (_, i) => <HistoryPage key={i} page={i} graph={graph} />) : <Loading error={error} />}
      </div>
      {graph && pages < summary.historyPages && (
        <button className="more" onClick={() => setPages(pages + 1)}>再加载 10 天（剩 {summary.historyPages - pages} 页）</button>
      )}
    </section>
  )
}
