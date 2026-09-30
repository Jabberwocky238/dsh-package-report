import { memo, useState } from 'react'
import { useShard } from './data.ts'
import { Loading } from './LazySection.tsx'
import type { RepoDay, Summary } from './types.ts'

const PAGE = 30
const QUICK_DAYS = 10
const TOPICS = new Set(['deepseek-harness', 'dsh'])

const time = (iso: string) => new Date(iso).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })

const RepoItem = memo(function RepoItem({ r }: { r: RepoDay['repos'][number] }) {
  const extra = r.topics.filter((t) => !TOPICS.has(t))
  return (
    <li className="repo">
      <div className="repo-head">
        <a className="pkg" href={`https://github.com/${r.name}`} target="_blank" rel="noreferrer">{r.name}</a>
        <span className="repo-stars">★ {r.stars}</span>
        {r.language && <span className="muted small-inline">{r.language}</span>}
        <span className="muted small-inline">{time(r.createdAt)}</span>
        {r.fork && <span className="tag">fork</span>}
        {r.archived && <span className="tag">archived</span>}
      </div>
      {r.description && <div className="added-desc">{r.description}</div>}
      {extra.length > 0 && <div className="chips">{extra.slice(0, 8).map((t) => <span key={t}>{t}</span>)}{extra.length > 8 && <span className="muted">+{extra.length - 8}</span>}</div>}
    </li>
  )
})

function DayList({ day }: { day: string }) {
  const { data, error } = useShard<RepoDay>(`repos/${day}`)
  const [limit, setLimit] = useState(PAGE)
  const [order, setOrder] = useState<'stars' | 'new'>('stars')
  if (!data) return <Loading error={error} />
  const list = order === 'stars' ? data.repos : [...data.repos].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return (
    <>
      <div className="filters">
        <select value={order} onChange={(e) => { setOrder(e.target.value as 'stars' | 'new'); setLimit(PAGE) }}>
          <option value="stars">按 star</option>
          <option value="new">按创建时间</option>
        </select>
        <span className="muted small-inline">更新于 {new Date(data.fetchedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}{data.truncated && ' · 超过搜索上限，结果不全'}</span>
      </div>
      <ul className="repo-list">{list.slice(0, limit).map((r) => <RepoItem key={r.name} r={r} />)}</ul>
      {limit < list.length && <button className="more" onClick={() => setLimit(limit + PAGE)}>再显示 {Math.min(PAGE, list.length - limit)} 个（剩 {list.length - limit} 个）</button>}
    </>
  )
}

export default function Repos({ summary }: { summary: Summary }) {
  const days = summary.repoDays
  const [day, setDay] = useState(days[0]?.[0] ?? '')
  if (!days.length) return null
  const quick = days.slice(0, QUICK_DAYS)
  return (
    <section>
      <h2>新仓库 <span className="muted">topic: deepseek-harness / dsh</span></h2>
      <div className="day-chips">
        {quick.map(([d, n]) => (
          <button key={d} className={`day-chip ${d === day ? 'active' : ''}`} onClick={() => setDay(d)}>{d.slice(5)} <b>{n}</b></button>
        ))}
        {days.length > QUICK_DAYS && (
          <select value={quick.some(([d]) => d === day) ? '' : day} onChange={(e) => e.target.value && setDay(e.target.value)}>
            <option value="">更早…</option>
            {days.slice(QUICK_DAYS).map(([d, n]) => <option key={d} value={d}>{d}（{n}）</option>)}
          </select>
        )}
      </div>
      <DayList key={day} day={day} />
    </section>
  )
}
