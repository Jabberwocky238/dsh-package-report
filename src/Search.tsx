import { useEffect, useState } from 'react'
import type { SearchResponse } from './types.ts'

const PAGE = 50
const TYPE_LABEL = { repo: '仓库', fork: 'fork', 'fork-package': 'fork 包', package: 'DSH 包' } as const
type Type = '' | keyof typeof TYPE_LABEL

interface Result { query: string; items: SearchResponse['data']; total: number; next: string | null }

function params(q: string, type: Type, source: string, sort: string, cursor?: string) {
  const p = new URLSearchParams({ q, limit: String(PAGE) })
  if (type) p.set('type', type)
  if (source !== 'all') p.set('source', source)
  if (sort !== 'relevance') p.set('sort', sort)
  if (cursor) p.set('cursor', cursor)
  return p
}

async function fetchSearch(p: URLSearchParams): Promise<SearchResponse> {
  const r = await fetch(`/api/search?${p}`)
  const j = await r.json()
  if (!r.ok) throw new Error(j.error?.message ?? `HTTP ${r.status}`)
  return j as SearchResponse
}

function Tutorial() {
  const origin = window.location.origin
  return (
    <details className="tutorial">
      <summary>接口使用教程</summary>
      <ol>
        <li>
          按关键词搜索：多个词用空格分开，必须全部出现在名称、描述或 topic 里。
          <pre>{`curl '${origin}/api/search?q=memory%20mcp'`}</pre>
        </li>
        <li>
          返回 <code>{'{ data, meta }'}</code>。每页默认 50 条，<code>limit</code> 最多 200，再大也只返回 200 条。
          <code>meta.nextCursor</code> 不为 <code>null</code> 时，原样带上它再请求一次就是下一页：
          <pre>{`curl '${origin}/api/search?q=memory&limit=200'
curl '${origin}/api/search?q=memory&limit=200&cursor=<上一页的 meta.nextCursor>'`}</pre>
        </li>
        <li>
          常用筛选：<code>type=repo,fork-package,package</code>、<code>source=community</code>、<code>category=skin</code>、
          <code>min_stars=5</code>、<code>since=2026-10-01</code>、<code>sort=stars</code>。数据刷新后旧 cursor 会返回 400，从第一页重新开始即可。
        </li>
        <li>
          一次取完全部结果：
          <pre>{`let cursor = '', all = []
do {
  const r = await fetch('${origin}/api/search?q=skin&limit=200' + (cursor && '&cursor=' + cursor)).then((r) => r.json())
  all.push(...r.data)
  cursor = r.meta.nextCursor
} while (cursor)`}</pre>
        </li>
      </ol>
      <p>其他接口（包、历史、新仓库、fork）和全部字段见 <a href="/README.md" target="_blank" rel="noreferrer">/README.md</a>。</p>
    </details>
  )
}

export default function Search() {
  const [q, setQ] = useState('')
  const [type, setType] = useState<Type>('')
  const [source, setSource] = useState('all')
  const [sort, setSort] = useState('relevance')
  const [result, setResult] = useState<Result | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const query = q.trim()
  const key = query && params(query, type, source, sort).toString()

  // Typing settles for 300ms before a request goes out; a newer query discards older responses.
  useEffect(() => {
    if (!key) return
    let live = true
    const t = window.setTimeout(() => {
      setLoading(true)
      fetchSearch(new URLSearchParams(key)).then(
        (r) => { if (live) { setResult({ query: key, items: r.data, total: r.meta.total, next: r.meta.nextCursor }); setError('') } },
        (e: Error) => { if (live) setError(e.message) },
      ).finally(() => { if (live) setLoading(false) })
    }, 300)
    return () => { live = false; window.clearTimeout(t) }
  }, [key])

  const more = () => {
    if (!result?.next) return
    const p = new URLSearchParams(result.query)
    p.set('cursor', result.next)
    setLoading(true)
    fetchSearch(p).then(
      (r) => setResult((cur) => (cur && cur.query === result.query ? { ...cur, items: [...cur.items, ...r.data], next: r.meta.nextCursor } : cur)),
      (e: Error) => setError(e.message),
    ).finally(() => setLoading(false))
  }

  const shown = key && result?.query === key ? result : null
  return (
    <section>
      <h2>搜索 <span className="muted">仓库 · fork · fork 里的包 · DSH 包</span></h2>
      <div className="filters">
        <input className="search-box" placeholder="关键词，空格分隔" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value as Type)}>
          <option value="">全部类型</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="all">官方和社区</option>
          <option value="community">社区</option>
          <option value="official">官方</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="relevance">按相关度</option>
          <option value="stars">按 star</option>
          <option value="day">按日期</option>
          <option value="name">按名称</option>
        </select>
        {shown && <span className="muted small-inline">{shown.total} 个结果</span>}
      </div>
      {error && <p className="loading">搜索失败：{error}</p>}
      {shown && (
        <>
          <ul className={`repo-list ${loading ? 'stale' : ''}`}>
            {shown.items.map((r) => (
              <li key={`${r.type}:${r.name}`} className={`repo ${r.official ? 'official' : ''}`}>
                <div className="repo-head">
                  <a className="pkg" href={r.url} target="_blank" rel="noreferrer">{r.name}</a>
                  <span className="tag">{TYPE_LABEL[r.type]}</span>
                  {(r.type === 'repo' || r.type === 'fork-package') && <span className="tag">{r.categoryLabel}</span>}
                  {r.type === 'fork' && <span className="muted small-inline">{r.branches} 个分支{r.added ? ` · 新增 ${r.added} 个包` : ''}</span>}
                  {r.stars > 0 && <span className="repo-stars">★ {r.stars}</span>}
                  {r.day && <span className="muted small-inline">{r.day}</span>}
                </div>
                {r.description && <div className="added-desc">{r.description}</div>}
                {r.fork && <div className="muted small-inline">来自 {r.fork}@{r.branch}{r.forks && r.forks > 1 ? `，共 ${r.forks} 个 fork` : ''}</div>}
              </li>
            ))}
          </ul>
          {!shown.items.length && <p className="loading">没有结果</p>}
          {shown.next && <button className="more" disabled={loading} onClick={more}>再加载 {PAGE} 个（已显示 {shown.items.length} / {shown.total}）</button>}
        </>
      )}
      <Tutorial />
    </section>
  )
}
