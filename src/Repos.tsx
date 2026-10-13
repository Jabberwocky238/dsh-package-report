import { memo, useDeferredValue, useMemo, useState } from 'react'
import { BASE_TOPICS, CATEGORY_IDS, CATEGORY_LABEL, categoryOf, type CategoryId, type Repo } from './categories.ts'
import { useShard, useShards } from './data.ts'
import { Loading } from './LazySection.tsx'
import type { Forks, RepoDay, Summary } from './types.ts'

const PAGE = 30
const QUICK_DAYS = 10
const TOP_TOPICS = 24
const STAR_STEPS = [0, 1, 5, 20, 100]
type Order = 'stars' | 'created' | 'pushed'
type Source = 'community' | 'official'
type Origin = 'all' | 'repo' | 'fork'
/** A community list entry: a topic repository, or a package added in a fork (`via` set) shaped like one. */
type Item = Repo & { via?: { fork: string; branch: string; dir: string; forks: number } }

const shanghaiDay = (iso: string) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 10)
const treeUrl = (fork: string, branch: string, dir: string) => `https://github.com/${fork}/tree/${branch.split('/').map(encodeURIComponent).join('/')}/${dir}`

/** Fork packages that upstream never had, keyed by the Asia/Shanghai day they first appeared. */
function forkItems(f: Forks): Map<string, Item[]> {
  const byDay = new Map<string, Item[]>()
  for (const p of f.packages) {
    if (p.upstream || !p.firstDate || !p.forks.length) continue
    const latest = p.forks[0]
    const item: Item = {
      name: p.name, official: false, description: p.description, stars: p.stars, forks: p.forks.length, language: null, topics: p.keywords,
      createdAt: p.firstDate, pushedAt: latest.date ?? p.firstDate, homepage: null, archived: false, fork: false, matched: [],
      via: { fork: latest.fork, branch: latest.branch, dir: p.dir, forks: p.forks.length },
    }
    const day = shanghaiDay(p.firstDate)
    byDay.set(day, [...(byDay.get(day) ?? []), item])
  }
  return byDay
}

const time = (iso: string) => new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

const RepoItem = memo(function RepoItem({ r, onTopic, active }: { r: Item; onTopic: (t: string) => void; active: ReadonlySet<string> }) {
  const extra = r.topics.filter((t) => !BASE_TOPICS.has(t))
  return (
    <li className={`repo ${r.official ? 'official' : ''}`}>
      <div className="repo-head">
        <a className="pkg" href={r.via ? treeUrl(r.via.fork, r.via.branch, r.via.dir) : `https://github.com/${r.name}`} target="_blank" rel="noreferrer">{r.name}</a>
        {r.via && <span className="tag">fork 包</span>}
        <span className="repo-stars">★ {r.stars}</span>
        <span className="tag">{CATEGORY_LABEL[categoryOf(r)]}</span>
        {r.language && <span className="muted small-inline">{r.language}</span>}
        <span className="muted small-inline">{time(r.createdAt)}</span>
        {r.fork && <span className="tag">fork</span>}
        {r.archived && <span className="tag">archived</span>}
      </div>
      {r.description && <div className="added-desc">{r.description}</div>}
      {r.via && <div className="muted small-inline">来自 <a href={`https://github.com/${r.via.fork}`} target="_blank" rel="noreferrer">{r.via.fork}</a>@{r.via.branch}{r.via.forks > 1 ? `，共 ${r.via.forks} 个 fork` : ''}</div>}
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
function tally<K extends string>(repos: Item[], key: (r: Item) => K | K[]): [K, number][] {
  const m = new Map<K, number>()
  for (const r of repos) for (const k of ([] as K[]).concat(key(r))) m.set(k, (m.get(k) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1])
}

function Filtered({ repos, fetchedAt, truncated }: { repos: Item[]; fetchedAt?: string; truncated: boolean }) {
  const [q, setQ] = useState('')
  const [origin, setOrigin] = useState<Origin>('all')
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
  const originCounts = useMemo(() => ({ all: repos.length, repo: repos.filter((r) => !r.via).length, fork: repos.filter((r) => r.via).length }), [repos])
  const base = useMemo(() => {
    const needle = dq.trim().toLowerCase()
    return repos.filter((r) => (origin === 'all' || (origin === 'fork') === Boolean(r.via)) && r.stars >= minStars && (!hideForks || (!r.fork && !r.archived)) && (!lang || r.language === lang)
      && (!needle || r.name.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle) || (r.via?.fork.toLowerCase().includes(needle) ?? false)))
  }, [repos, origin, dq, minStars, hideForks, lang])
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
      {originCounts.fork > 0 && (
        <div className="facet">
          <span className="label">来源</span>
          {([['all', '全部'], ['repo', '独立仓库'], ['fork', 'fork 里的包']] as const).map(([k, label]) => (
            <button key={k} className={`facet-chip ${origin === k ? 'on' : ''}`} onClick={() => { setOrigin(k); reset() }}>{label} <b>{originCounts[k]}</b></button>
          ))}
        </div>
      )}
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

function Community({ days, withForks }: { days: string[]; withForks: boolean }) {
  const { data, error } = useShards<RepoDay>(days.map((d) => `repos/${d}`))
  const { data: forks, error: forkError } = useShard<Forks>(withForks ? 'forks' : null)
  const fork = useMemo(() => forks && forkItems(forks), [forks])
  const merged = useMemo(() => data && (!withForks || fork) && {
    repos: [...data.flatMap((d) => d.repos.filter((r) => !r.official) as Item[]), ...days.flatMap((d) => fork?.get(d) ?? [])].sort((a, b) => b.stars - a.stars),
    fetchedAt: data.map((d) => d.fetchedAt).sort().at(-1),
    truncated: data.some((d) => d.truncated),
  }, [data, fork, days, withForks])
  if (!merged) return <Loading error={error ?? forkError} />
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

const communityCount = (days: Summary['repoDays'], forkDays: Map<string, number>) => days.reduce((n, [day, total, official]) => n + total - official + (forkDays.get(day) ?? 0), 0)

export default function Repos({ summary }: { summary: Summary }) {
  const days = summary.repoDays
  const forkDays = useMemo(() => new Map(summary.forks?.days ?? []), [summary])
  const count = (ds: Summary['repoDays']) => communityCount(ds, forkDays)
  const [source, setSource] = useState<Source>('community')
  const [range, setRange] = useState<string>(days[0]?.[0] ?? '')
  const selected = useMemo(() => (range === 'week' ? days.slice(0, 7).map(([d]) => d) : [range]), [range, days])
  if (!days.length) return null
  const quick = days.slice(0, QUICK_DAYS)
  return (
    <section>
      <h2>新仓库 <span className="muted">topic: deepseek-harness / dsh</span></h2>
      <div className="tabs">
        <button className={source === 'community' ? 'on' : ''} onClick={() => setSource('community')}>社区 <b>{count(days)}</b></button>
        <button className={source === 'official' ? 'on' : ''} onClick={() => setSource('official')}>官方 <b>{summary.officialRepos.length}</b></button>
      </div>
      {source === 'official' ? <Official repos={summary.officialRepos} /> : (
        <>
          <div className="day-chips">
            <button className={`day-chip ${range === 'week' ? 'active' : ''}`} onClick={() => setRange('week')}>近 7 天 <b>{count(days.slice(0, 7))}</b></button>
            {quick.map((d) => (
              <button key={d[0]} className={`day-chip ${d[0] === range ? 'active' : ''}`} onClick={() => setRange(d[0])}>{d[0].slice(5)} <b>{count([d])}</b></button>
            ))}
            {days.length > QUICK_DAYS && (
              <select value={quick.some(([d]) => d === range) || range === 'week' ? '' : range} onChange={(e) => e.target.value && setRange(e.target.value)}>
                <option value="">更早…</option>
                {days.slice(QUICK_DAYS).map((d) => <option key={d[0]} value={d[0]}>{d[0]}（{count([d])}）</option>)}
              </select>
            )}
          </div>
          <Community key={range} days={selected} withForks={Boolean(summary.forks)} />
        </>
      )}
    </section>
  )
}
