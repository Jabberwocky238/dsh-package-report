import { memo, useDeferredValue, useMemo, useState } from 'react'
import { BASE_TOPICS, CATEGORY_IDS, CATEGORY_LABEL, categoryOf, type CategoryId, type Repo } from './categories.ts'
import { useShards } from './data.ts'
import { Loading } from './LazySection.tsx'
import type { RepoDay, Summary } from './types.ts'

const PAGE = 30
const QUICK_DAYS = 10
const TOP_TOPICS = 24
const STAR_STEPS = [0, 1, 5, 20, 100]
type Order = 'stars' | 'created' | 'pushed'
type Source = 'community' | 'official'

const time = (iso: string) => new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

const RepoItem = memo(function RepoItem({ r, onTopic, active }: { r: Repo; onTopic: (t: string) => void; active: ReadonlySet<string> }) {
  const extra = r.topics.filter((t) => !BASE_TOPICS.has(t))
  return (
    <li className={`repo ${r.official ? 'official' : ''}`}>
      <div className="repo-head">
        <a className="pkg" href={`https://github.com/${r.name}`} target="_blank" rel="noreferrer">{r.name}</a>
        <span className="repo-stars">★ {r.stars}</span>
        <span className="tag">{CATEGORY_LABEL[categoryOf(r)]}</span>
        {r.language && <span className="muted small-inline">{r.language}</span>}
        <span className="muted small-inline">{time(r.createdAt)}</span>
        {r.fork && <span className="tag">fork</span>}
        {r.archived && <span className="tag">archived</span>}
      </div>
      {r.description && <div className="added-desc">{r.description}</div>}
      {extra.length > 0 && (
        <div className="chips">
          {extra.slice(0, 8).map((t) => <button key={t} className={`topic ${active.has(t) ? 'on' : ''}`} onClick={() => onTopic(t)}>{t}</button>)}
          {extra.length > 8 && <span className="muted">+{extra.length - 8}</span>}
        </div>
      )}
    </li>
  )
})

/** Counts of `key(r)` over `repos`, most frequent first. */
function tally<K extends string>(repos: Repo[], key: (r: Repo) => K | K[]): [K, number][] {
  const m = new Map<K, number>()
  for (const r of repos) for (const k of ([] as K[]).concat(key(r))) m.set(k, (m.get(k) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1])
}

function Filtered({ repos, fetchedAt, truncated }: { repos: Repo[]; fetchedAt?: string; truncated: boolean }) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<CategoryId | null>(null)
  const [topics, setTopics] = useState<ReadonlySet<string>>(new Set())
  const [topicQ, setTopicQ] = useState('')
  const [lang, setLang] = useState('')
  const [minStars, setMinStars] = useState(0)
  const [hideForks, setHideForks] = useState(true)
  const [order, setOrder] = useState<Order>('stars')
  const [limit, setLimit] = useState(PAGE)
  const dq = useDeferredValue(q)
  const reset = () => setLimit(PAGE)
  const toggleTopic = (t: string) => { setTopics((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n }); reset() }

  // Facet counts apply every filter except their own, so each chip shows what selecting it would yield.
  const base = useMemo(() => {
    const needle = dq.trim().toLowerCase()
    return repos.filter((r) => r.stars >= minStars && (!hideForks || (!r.fork && !r.archived)) && (!lang || r.language === lang)
      && (!needle || r.name.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle)))
  }, [repos, dq, minStars, hideForks, lang])
  const byTopics = useMemo(() => (topics.size ? base.filter((r) => [...topics].every((t) => r.topics.includes(t))) : base), [base, topics])
  const catCounts = useMemo(() => new Map(tally(byTopics, categoryOf)), [byTopics])
  const byCat = useMemo(() => (cat ? byTopics.filter((r) => categoryOf(r) === cat) : byTopics), [byTopics, cat])
  const topicCounts = useMemo(() => tally(cat ? base.filter((r) => categoryOf(r) === cat) : base, (r) => r.topics.filter((t) => !BASE_TOPICS.has(t))), [base, cat])
  const langs = useMemo(() => tally(repos, (r) => r.language ?? '').filter(([l]) => l), [repos])
  const list = useMemo(() => {
    if (order === 'stars') return byCat
    const k = order === 'created' ? 'createdAt' : 'pushedAt'
    return [...byCat].sort((a, b) => b[k].localeCompare(a[k]))
  }, [byCat, order])

  const tq = topicQ.trim().toLowerCase()
  const shownTopics = (tq ? topicCounts.filter(([t]) => t.includes(tq)) : topicCounts).slice(0, TOP_TOPICS)
  const selectedMissing = [...topics].filter((t) => !shownTopics.some(([x]) => x === t))

  return (
    <>
      <div className="facet">
        <span className="label">作用</span>
        <button className={`facet-chip ${cat === null ? 'on' : ''}`} onClick={() => { setCat(null); reset() }}>全部 <b>{byTopics.length}</b></button>
        {CATEGORY_IDS.filter((c) => catCounts.get(c)).map((c) => (
          <button key={c} className={`facet-chip ${cat === c ? 'on' : ''}`} onClick={() => { setCat(cat === c ? null : c); reset() }}>{CATEGORY_LABEL[c]} <b>{catCounts.get(c)}</b></button>
        ))}
      </div>
      <div className="facet">
        <span className="label">topic</span>
        <input className="topic-search" placeholder="找 topic" value={topicQ} onChange={(e) => setTopicQ(e.target.value)} />
        {selectedMissing.map((t) => <button key={t} className="facet-chip on" onClick={() => toggleTopic(t)}>{t} ×</button>)}
        {shownTopics.map(([t, n]) => <button key={t} className={`facet-chip ${topics.has(t) ? 'on' : ''}`} onClick={() => toggleTopic(t)}>{t} <b>{n}</b></button>)}
        {topics.size > 0 && <button className="link" onClick={() => { setTopics(new Set()); reset() }}>清除 topic</button>}
      </div>
      <div className="filters">
        <input placeholder="搜索名称或描述" value={q} onChange={(e) => { setQ(e.target.value); reset() }} />
        <select value={lang} onChange={(e) => { setLang(e.target.value); reset() }}>
          <option value="">全部语言</option>
          {langs.map(([l, n]) => <option key={l} value={l}>{l}（{n}）</option>)}
        </select>
        <select value={minStars} onChange={(e) => { setMinStars(Number(e.target.value)); reset() }}>
          {STAR_STEPS.map((n) => <option key={n} value={n}>{n ? `★ ≥ ${n}` : '任意 star'}</option>)}
        </select>
        <select value={order} onChange={(e) => { setOrder(e.target.value as Order); reset() }}>
          <option value="stars">按 star</option>
          <option value="created">按创建时间</option>
          <option value="pushed">按最近推送</option>
        </select>
        <label><input type="checkbox" checked={hideForks} onChange={(e) => { setHideForks(e.target.checked); reset() }} /> 隐藏 fork / 归档</label>
        <span className="muted small-inline">{list.length} 个{fetchedAt && ` · 更新于 ${time(fetchedAt)}`}{truncated && ' · 部分日期超过搜索上限，结果不全'}</span>
      </div>
      <ul className={`repo-list ${dq !== q ? 'stale' : ''}`}>{list.slice(0, limit).map((r) => <RepoItem key={r.name} r={r} onTopic={toggleTopic} active={topics} />)}</ul>
      {!list.length && <p className="loading">没有符合条件的仓库</p>}
      {limit < list.length && <button className="more" onClick={() => setLimit(limit + PAGE)}>再显示 {Math.min(PAGE, list.length - limit)} 个（剩 {list.length - limit} 个）</button>}
    </>
  )
}

function Community({ days }: { days: string[] }) {
  const { data, error } = useShards<RepoDay>(days.map((d) => `repos/${d}`))
  const merged = useMemo(() => data && {
    repos: data.flatMap((d) => d.repos.filter((r) => !r.official)).sort((a, b) => b.stars - a.stars),
    fetchedAt: data.map((d) => d.fetchedAt).sort().at(-1),
    truncated: data.some((d) => d.truncated),
  }, [data])
  if (!merged) return <Loading error={error} />
  return <Filtered repos={merged.repos} fetchedAt={merged.fetchedAt} truncated={merged.truncated} />
}

function Official({ repos }: { repos: Summary['officialRepos'] }) {
  if (!repos.length) return <p className="loading">暂无官方仓库</p>
  return (
    <ul className="repo-list">
      {repos.map((r) => (
        <li key={r.name} className="repo official">
          <div className="repo-head">
            <a className="pkg" href={`https://github.com/${r.name}`} target="_blank" rel="noreferrer">{r.name}</a>
            <span className="repo-stars">★ {r.stars}</span>
            {r.language && <span className="muted small-inline">{r.language}</span>}
            <span className="muted small-inline">{time(r.createdAt)}</span>
          </div>
          {r.description && <div className="added-desc">{r.description}</div>}
        </li>
      ))}
    </ul>
  )
}

const communityCount = (days: Summary['repoDays']) => days.reduce((n, [, total, official]) => n + total - official, 0)

export default function Repos({ summary }: { summary: Summary }) {
  const days = summary.repoDays
  const [source, setSource] = useState<Source>('community')
  const [range, setRange] = useState<string>(days[0]?.[0] ?? '')
  const selected = useMemo(() => (range === 'week' ? days.slice(0, 7).map(([d]) => d) : [range]), [range, days])
  if (!days.length) return null
  const quick = days.slice(0, QUICK_DAYS)
  return (
    <section>
      <h2>新仓库 <span className="muted">topic: deepseek-harness / dsh</span></h2>
      <div className="tabs">
        <button className={source === 'community' ? 'on' : ''} onClick={() => setSource('community')}>社区 <b>{communityCount(days)}</b></button>
        <button className={source === 'official' ? 'on' : ''} onClick={() => setSource('official')}>官方 <b>{summary.officialRepos.length}</b></button>
      </div>
      {source === 'official' ? <Official repos={summary.officialRepos} /> : (
        <>
          <div className="day-chips">
            <button className={`day-chip ${range === 'week' ? 'active' : ''}`} onClick={() => setRange('week')}>近 7 天 <b>{communityCount(days.slice(0, 7))}</b></button>
            {quick.map((d) => (
              <button key={d[0]} className={`day-chip ${d[0] === range ? 'active' : ''}`} onClick={() => setRange(d[0])}>{d[0].slice(5)} <b>{communityCount([d])}</b></button>
            ))}
            {days.length > QUICK_DAYS && (
              <select value={quick.some(([d]) => d === range) || range === 'week' ? '' : range} onChange={(e) => e.target.value && setRange(e.target.value)}>
                <option value="">更早…</option>
                {days.slice(QUICK_DAYS).map((d) => <option key={d[0]} value={d[0]}>{d[0]}（{communityCount([d])}）</option>)}
              </select>
            )}
          </div>
          <Community key={range} days={selected} />
        </>
      )}
    </section>
  )
}
