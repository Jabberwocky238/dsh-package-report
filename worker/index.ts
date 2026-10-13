// JSON API over the static data shards in public/data (served through the ASSETS binding).
// Routes and parameters are documented in worker/API.md, which /README.md returns verbatim (site intro first, then the API).
import { DurableObject } from 'cloudflare:workers'
import apiDoc from './API.md?raw'
import { CATEGORIES, CATEGORY_LABEL, categoryOf, type CategoryId, type Repo } from '../src/categories.ts'
import { DepGraph } from '../src/graph.ts'
import type { Day, ForkBranch, ForkRow, Forks, Graph, PackageDetail, PackageKind, PackageRow, RepoDay, SearchItem, Summary } from '../src/types.ts'

class HttpError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=300',
}
const DAY = /^\d{4}-\d{2}-\d{2}$/
const RATE_LIMIT = 600
const RATE_PERIOD_MS = 3600_000

/**
 * Per-IP request counter, one instance per client IP, over fixed clock-hour windows. The count lives in memory:
 * an instance is only evicted after it has been idle for a while, and a client that idle cannot get near the limit.
 */
export class RateLimiter extends DurableObject<Env> {
  private start = 0
  private count = 0

  hit(): { allowed: boolean; remaining: number; reset: number } {
    const now = Date.now()
    const start = now - (now % RATE_PERIOD_MS)
    if (start !== this.start) { this.start = start; this.count = 0 }
    this.count++
    return { allowed: this.count <= RATE_LIMIT, remaining: Math.max(0, RATE_LIMIT - this.count), reset: start + RATE_PERIOD_MS }
  }
}

async function rateLimit(req: Request, env: Env): Promise<{ allowed: boolean; headers: Record<string, string> }> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
  const r = await env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(ip)).hit()
  const headers = { 'X-RateLimit-Limit': String(RATE_LIMIT), 'X-RateLimit-Remaining': String(r.remaining), 'X-RateLimit-Reset': String(Math.ceil(r.reset / 1000)) }
  if (r.allowed) return { allowed: true, headers }
  return { allowed: false, headers: { ...headers, 'Retry-After': String(Math.max(1, Math.ceil((r.reset - Date.now()) / 1000))) } }
}
const MAX_REPO_DAYS = 31

/** Per-request view of the data: shards are fetched from ASSETS once per isolate (assets and code deploy together). */
class Data {
  private static readonly cache = new Map<string, Promise<unknown>>()
  private readonly env: Env
  private readonly origin: string

  constructor(env: Env, origin: string) {
    this.env = env
    this.origin = origin
  }

  shard<T>(name: string): Promise<T> {
    let p = Data.cache.get(name)
    if (!p) {
      p = this.env.ASSETS.fetch(new URL(`/data/${name}.json`, this.origin)).then((r) => {
        if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, 'not_found', `shard ${name} unavailable`)
        return r.json()
      })
      p.catch(() => Data.cache.delete(name))
      Data.cache.set(name, p)
    }
    return p as Promise<T>
  }

  summary() { return this.shard<Summary>('summary') }

  async graph(): Promise<DepGraph> {
    const g = await this.shard<Graph>('graph')
    let dg = graphs.get(g)
    if (!dg) graphs.set(g, (dg = new DepGraph(g)))
    return dg
  }
}
const graphs = new WeakMap<Graph, DepGraph>()

/** Typed accessors over URLSearchParams that reject malformed values with 400. */
class Query {
  private readonly p: URLSearchParams
  constructor(p: URLSearchParams) { this.p = p }
  str(k: string): string | undefined { const v = this.p.get(k)?.trim(); return v ? v : undefined }
  list(k: string): string[] { return (this.str(k) ?? '').split(',').map((s) => s.trim()).filter(Boolean) }
  bool(k: string, dflt: boolean): boolean {
    const v = this.str(k)
    if (v === undefined) return dflt
    if (['1', 'true', 'yes'].includes(v)) return true
    if (['0', 'false', 'no'].includes(v)) return false
    throw new HttpError(400, 'bad_request', `${k} must be true or false`)
  }
  int(k: string, dflt: number, min: number, max: number): number {
    const v = this.str(k)
    if (v === undefined) return dflt
    const n = Number(v)
    if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, 'bad_request', `${k} must be an integer in [${min}, ${max}]`)
    return n
  }
  day(k: string): string | undefined {
    const v = this.str(k)
    if (v !== undefined && !DAY.test(v)) throw new HttpError(400, 'bad_request', `${k} must be YYYY-MM-DD`)
    return v
  }
  oneOf<T extends string>(k: string, allowed: readonly T[], dflt: T): T {
    const v = this.str(k) ?? dflt
    if (!allowed.includes(v as T)) throw new HttpError(400, 'bad_request', `${k} must be one of ${allowed.join(', ')}`)
    return v as T
  }
  someOf<T extends string>(k: string, allowed: readonly T[]): T[] {
    const vs = this.list(k)
    const bad = vs.filter((v) => !allowed.includes(v as T))
    if (bad.length) throw new HttpError(400, 'bad_request', `${k} accepts ${allowed.join(', ')}; got ${bad.join(', ')}`)
    return vs as T[]
  }
  page(dflt: number, max: number) { return { limit: this.int('limit', dflt, 1, max), offset: this.int('offset', 0, 0, 1e9) } }
}

function paginate<T>(items: T[], { limit, offset }: { limit: number; offset: number }) {
  return { data: items.slice(offset, offset + limit), meta: { total: items.length, limit, offset } }
}

function sortBy<T>(items: T[], key: (x: T) => string | number, order: 'asc' | 'desc'): T[] {
  const dir = order === 'asc' ? 1 : -1
  return [...items].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * dir })
}

const KINDS: readonly PackageKind[] = ['plugin', 'library', 'client', 'unbuilt', 'app']
const PACKAGE_SORTS = ['name', 'group', 'firstSeen', 'entries', 'workspaceDeps', 'transitive', 'depth', 'dependents', 'externalDeps'] as const
const REPO_SORTS = ['stars', 'created', 'pushed', 'name'] as const
const CATEGORY_IDS = [...CATEGORIES.map((c) => c.id), 'other'] as readonly CategoryId[]

async function packages(d: Data, q: Query) {
  const [rows, graph, summary] = await Promise.all([d.shard<PackageRow[]>('packages'), d.graph(), d.summary()])
  const needle = q.str('q')?.toLowerCase()
  const kinds = q.someOf('kind', KINDS)
  const groups = q.list('group')
  const profile = q.str('profile')
  if (profile && !summary.profiles.some((p) => p.id === profile)) throw new HttpError(400, 'bad_request', `profile must be one of ${summary.profiles.map((p) => p.id).join(', ')}`)
  const unused = q.bool('unused', false)
  const since = q.day('since'), until = q.day('until')
  const minDependents = q.int('min_dependents', 0, 0, 1e6)
  const sort = q.oneOf('sort', PACKAGE_SORTS, 'dependents')
  const order = q.oneOf('order', ['asc', 'desc'] as const, sort === 'name' || sort === 'group' ? 'asc' : 'desc')
  const items = rows
    .filter((p) => (!kinds.length || kinds.includes(p.kind))
      && (!groups.length || groups.includes(p.group))
      && (!profile || p.profiles.includes(profile))
      && (!unused || !p.profiles.length)
      && (!since || (p.firstSeen ?? '') >= since) && (!until || (p.firstSeen ?? '9999') <= until)
      && p.dependents >= minDependents
      && (!needle || p.name.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle)))
    .map((p) => { const c = graph.chain(p.name); return { ...p, transitive: c.transitive, depth: c.depth } })
  return paginate(sortBy(items, (p) => p[sort] ?? '', order), q.page(50, 500))
}

async function packageDetail(d: Data, name: string) {
  const [rows, graph] = await Promise.all([d.shard<PackageRow[]>('packages'), d.graph()])
  const row = rows.find((p) => p.name === name)
  if (!row) throw new HttpError(404, 'not_found', `package ${name} not found (Cordis packages under vendor/ are not DSH packages)`)
  const detail = await d.shard<PackageDetail>(graph.shard(name))
  const chain = graph.chain(name)
  return { data: { ...row, ...detail, chain: { transitive: chain.transitive, depth: chain.depth, longest: chain.longest, all: graph.transitive(name) } } }
}

async function historyDays(d: Data): Promise<Day[]> {
  const s = await d.summary()
  return (await Promise.all(Array.from({ length: s.historyPages }, (_, i) => d.shard<Day[]>(`history-${i}`)))).flat()
}

async function history(d: Data, q: Query) {
  const from = q.day('from'), to = q.day('to')
  const has = q.someOf('has', ['added', 'removed', 'version'] as const)
  const pkg = q.str('package')?.toLowerCase()
  const days = (await historyDays(d)).filter((x) => (!from || x.day >= from) && (!to || x.day <= to)
    && (!has.length || has.some((h) => (h === 'added' ? x.added.length : h === 'removed' ? x.removed.length : x.version !== x.prevVersion)))
    && (!pkg || x.added.some((a) => a.name.toLowerCase().includes(pkg)) || x.removed.some((n) => n.toLowerCase().includes(pkg))))
  return paginate(days, q.page(30, 200))
}

type ApiRepo = Repo & { day: string; category: CategoryId; categoryLabel: string }

async function repos(d: Data, q: Query) {
  const s = await d.summary()
  const known = new Set(s.repoDays.map(([day]) => day))
  const one = q.day('day'), from = q.day('from'), to = q.day('to')
  if (one && (from || to)) throw new HttpError(400, 'bad_request', 'use either day or from/to')
  let days: string[]
  if (one) days = [one]
  else if (from || to) days = s.repoDays.map(([day]) => day).filter((day) => (!from || day >= from) && (!to || day <= to))
  else days = s.repoDays.slice(0, 1).map(([day]) => day)
  if (days.length > MAX_REPO_DAYS) throw new HttpError(400, 'bad_request', `at most ${MAX_REPO_DAYS} days per request; narrow from/to`)
  const missing = days.filter((day) => !known.has(day))
  if (missing.length) throw new HttpError(404, 'not_found', `no repository data for ${missing.join(', ')}; see /api/repos/days`)

  const source = q.oneOf('source', ['all', 'official', 'community'] as const, 'all')
  const categories = q.someOf('category', CATEGORY_IDS)
  const topics = q.list('topic').map((t) => t.toLowerCase())
  const anyTopics = q.list('any_topic').map((t) => t.toLowerCase())
  const languages = q.list('language').map((l) => l.toLowerCase())
  const minStars = q.int('min_stars', 0, 0, 1e9)
  const includeForks = q.bool('forks', true)
  const includeArchived = q.bool('archived', true)
  const needle = q.str('q')?.toLowerCase()
  const sort = q.oneOf('sort', REPO_SORTS, 'stars')
  const order = q.oneOf('order', ['asc', 'desc'] as const, sort === 'name' ? 'asc' : 'desc')
  const facets = q.bool('facets', false)

  const loaded = await Promise.all(days.map((day) => d.shard<RepoDay>(`repos/${day}`)))
  const all: ApiRepo[] = loaded.flatMap((f) => f.repos.map((r) => { const c = categoryOf(r); return { ...r, day: f.day, category: c, categoryLabel: CATEGORY_LABEL[c] } }))
  const items = all.filter((r) => (source === 'all' || (source === 'official') === r.official)
    && (!categories.length || categories.includes(r.category))
    && topics.every((t) => r.topics.includes(t))
    && (!anyTopics.length || anyTopics.some((t) => r.topics.includes(t)))
    && (!languages.length || languages.includes((r.language ?? '').toLowerCase()))
    && r.stars >= minStars && (includeForks || !r.fork) && (includeArchived || !r.archived)
    && (!needle || r.name.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle)))
  const key = { stars: (r: ApiRepo) => r.stars, created: (r: ApiRepo) => r.createdAt, pushed: (r: ApiRepo) => r.pushedAt, name: (r: ApiRepo) => r.name.toLowerCase() }[sort]
  const res = paginate(sortBy(items, key, order), q.page(100, 1000))
  const meta: Record<string, unknown> = { ...res.meta, days, truncated: loaded.some((f) => f.truncated), fetchedAt: loaded.map((f) => f.fetchedAt).sort().at(-1) }
  if (facets) {
    const count = (f: (r: ApiRepo) => string[]) => { const m: Record<string, number> = {}; for (const r of items) for (const k of f(r)) m[k] = (m[k] ?? 0) + 1; return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1])) }
    meta.facets = {
      source: count((r) => [r.official ? 'official' : 'community']),
      category: count((r) => [r.category]),
      language: count((r) => (r.language ? [r.language] : [])),
      topic: Object.fromEntries(Object.entries(count((r) => r.topics.filter((t) => t !== 'deepseek-harness' && t !== 'dsh'))).slice(0, 100)),
    }
  }
  return { data: res.data, meta }
}

const FORK_PACKAGE_SORTS = ['forks', 'date', 'name'] as const
const FORK_SORTS = ['added', 'date', 'ahead', 'branches', 'stars', 'name'] as const

async function forksShard(d: Data): Promise<Forks> {
  if (!(await d.summary()).forks) throw new HttpError(404, 'not_found', 'no fork scan has been published yet')
  return d.shard<Forks>('forks')
}
const forksMeta = (f: Forks) => ({ scannedAt: f.generatedAt, upstreamHead: f.upstreamHead, totals: f.totals })
const underDir = (dir: string, prefix: string) => dir === prefix || dir.startsWith(`${prefix.replace(/\/+$/, '')}/`)

async function forkPackages(d: Data, q: Query) {
  const f = await forksShard(d)
  const needle = q.str('q')?.toLowerCase()
  const dirs = q.list('dir')
  const fork = q.str('fork')?.toLowerCase()
  const upstream = q.bool('upstream', false)
  const dshOnly = q.bool('dsh', false)
  const dependsOn = q.list('depends_on')
  const since = q.day('since')
  const minForks = q.int('min_forks', 0, 0, 1e6)
  const sort = q.oneOf('sort', FORK_PACKAGE_SORTS, 'forks')
  const order = q.oneOf('order', ['asc', 'desc'] as const, sort === 'name' ? 'asc' : 'desc')
  const items = f.packages.filter((p) => (upstream || !p.upstream) && (!dshOnly || p.dsh || p.dshDeps.length > 0)
    && (!dirs.length || dirs.some((x) => underDir(p.dir, x)))
    && (!fork || p.forks.some((x) => x.fork.toLowerCase() === fork))
    && dependsOn.every((n) => p.dshDeps.includes(n) || p.deps.includes(n))
    && (!since || (p.forks[0]?.date ?? '') >= since) && p.forks.length >= minForks
    && (!needle || p.name.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle)))
    .map(({ forks, ...p }) => ({ ...p, forks: forks.map((x) => ({ fork: x.fork, branches: x.branches, branch: x.branch, date: x.date })) }))
  const key = { forks: (p: (typeof items)[number]) => p.forks.length, date: (p: (typeof items)[number]) => p.forks[0]?.date ?? '', name: (p: (typeof items)[number]) => p.name }[sort]
  const res = paginate(sortBy(items, key, order), q.page(50, 500))
  return { data: res.data, meta: { ...res.meta, ...forksMeta(f) } }
}

async function forkList(d: Data, q: Query) {
  const f = await forksShard(d)
  const needle = q.str('q')?.toLowerCase()
  const parent = q.str('parent')?.toLowerCase()
  const hasPackages = q.bool('has_packages', false)
  const groups = q.list('touches')
  const minAhead = q.int('min_ahead', 0, 0, 1e9)
  const minStars = q.int('min_stars', 0, 0, 1e9)
  const since = q.day('since')
  const sort = q.oneOf('sort', FORK_SORTS, 'added')
  const order = q.oneOf('order', ['asc', 'desc'] as const, sort === 'name' ? 'asc' : 'desc')
  const items = f.forks.filter((r) => (!parent || r.parent.toLowerCase() === parent) && (!hasPackages || r.newAdded > 0)
    && groups.every((g) => r.groups.includes(g)) && r.ahead >= minAhead && r.stars >= minStars && (!since || (r.date ?? '') >= since)
    && (!needle || r.fork.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle) || r.message.toLowerCase().includes(needle)))
  const key = { added: (r: ForkRow) => r.newAdded, date: (r: ForkRow) => r.date ?? '', ahead: (r: ForkRow) => r.ahead, branches: (r: ForkRow) => r.branches, stars: (r: ForkRow) => r.stars, name: (r: ForkRow) => r.fork.toLowerCase() }[sort]
  const res = paginate(sortBy(items, key, order), q.page(50, 500))
  return { data: res.data, meta: { ...res.meta, ...forksMeta(f) } }
}

async function forkDetail(d: Data, name: string) {
  const f = await forksShard(d)
  const i = f.forks.findIndex((r) => r.fork.toLowerCase() === name.toLowerCase())
  if (i < 0) throw new HttpError(404, 'not_found', `fork ${name} has no branches that diverge from upstream master (or was not scanned)`)
  const chunk = await d.shard<ForkBranch[][]>(`forks/${Math.floor(i / f.chunk)}`)
  const row = f.forks[i]
  const packages = f.packages.filter((p) => p.forks.some((x) => x.i === i)).map((p) => ({ name: p.name, description: p.description, dir: p.dir, upstream: p.upstream }))
  return { data: { ...row, packages, branchList: chunk[i % f.chunk] ?? [] }, meta: forksMeta(f) }
}

const SEARCH_TYPES = ['repo', 'fork', 'fork-package', 'package'] as const
const SEARCH_SORTS = ['relevance', 'stars', 'day', 'name'] as const
const SEARCH_MAX = 200

/** Opaque cursor: the next offset, bound to the query and the data version so a stale cursor is rejected. */
const cursorKey = (params: URLSearchParams, version: string) => {
  const p = new URLSearchParams(params)
  for (const k of ['cursor', 'limit', 'pretty']) p.delete(k)
  p.sort()
  let h = 0
  for (const ch of `${version}|${p}`) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0
  return (h >>> 0).toString(36)
}
const encodeCursor = (o: number, k: string) => btoa(JSON.stringify({ o, k })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
function decodeCursor(c: string, k: string): number {
  let v: { o?: unknown; k?: unknown }
  try { v = JSON.parse(atob(c.replace(/-/g, '+').replace(/_/g, '/'))) } catch { throw new HttpError(400, 'bad_request', 'cursor is malformed') }
  if (v.k !== k) throw new HttpError(400, 'bad_request', 'cursor does not belong to this query or the data has been refreshed; start again without cursor')
  if (typeof v.o !== 'number' || !Number.isInteger(v.o) || v.o < 0) throw new HttpError(400, 'bad_request', 'cursor is malformed')
  return v.o
}

async function search(d: Data, q: Query, params: URLSearchParams) {
  const raw = q.str('q')
  if (!raw) throw new HttpError(400, 'bad_request', 'q is required')
  const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean)
  const types = q.someOf('type', SEARCH_TYPES)
  const source = q.oneOf('source', ['all', 'official', 'community'] as const, 'all')
  const categories = q.someOf('category', CATEGORY_IDS)
  const since = q.day('since'), until = q.day('until')
  const minStars = q.int('min_stars', 0, 0, 1e9)
  const sort = q.oneOf('sort', SEARCH_SORTS, 'relevance')
  // Larger pages are cut to SEARCH_MAX rather than rejected; follow nextCursor for the rest.
  const asked = q.int('limit', 50, 1, 1e9)
  const limit = Math.min(asked, SEARCH_MAX)
  const [items, summary] = await Promise.all([d.shard<SearchItem[]>('search'), d.summary()])
  const key = cursorKey(params, summary.version)
  const cursor = q.str('cursor')
  const offset = cursor ? decodeCursor(cursor, key) : 0

  const whole = raw.toLowerCase()
  const scored: { item: SearchItem; score: number; category: CategoryId }[] = []
  for (const item of items) {
    if (types.length && !types.includes(item.type)) continue
    if (source !== 'all' && (source === 'official') !== item.official) continue
    if (item.stars < minStars || (since && (item.day ?? '') < since) || (until && (item.day ?? '9999') > until)) continue
    const name = item.name.toLowerCase()
    const via = item.via?.join(' ').toLowerCase() ?? ''
    const hay = `${name} ${item.description.toLowerCase()} ${item.topics.join(' ')} ${via}`
    if (!tokens.every((t) => hay.includes(t))) continue
    const category = categoryOf(item)
    if (categories.length && !categories.includes(category)) continue
    const base = name.split('/').at(-1) ?? name
    let score = name === whole || base === whole ? 100 : name.includes(whole) ? 50 : via.includes(whole) ? 30 : 0
    for (const t of tokens) score += (name.includes(t) ? 10 : 0) + (item.topics.includes(t) ? 5 : 0)
    scored.push({ item, score, category })
  }
  const by = {
    relevance: (a: (typeof scored)[number], b: (typeof scored)[number]) => b.score - a.score || b.item.stars - a.item.stars || a.item.name.localeCompare(b.item.name),
    stars: (a: (typeof scored)[number], b: (typeof scored)[number]) => b.item.stars - a.item.stars || a.item.name.localeCompare(b.item.name),
    day: (a: (typeof scored)[number], b: (typeof scored)[number]) => (b.item.day ?? '').localeCompare(a.item.day ?? '') || b.item.stars - a.item.stars,
    name: (a: (typeof scored)[number], b: (typeof scored)[number]) => a.item.name.localeCompare(b.item.name),
  }[sort]
  scored.sort(by)
  const page = scored.slice(offset, offset + limit)
  const next = offset + limit < scored.length ? encodeCursor(offset + limit, key) : null
  return {
    data: page.map(({ item, category }) => ({ ...item, category, categoryLabel: CATEGORY_LABEL[category] })),
    meta: { total: scored.length, offset, limit, returned: page.length, limitCapped: asked > SEARCH_MAX, nextCursor: next, truncated: next !== null },
  }
}

async function route(req: Request, env: Env): Promise<{ data: unknown; meta?: Record<string, unknown> }> {
  const url = new URL(req.url)
  const d = new Data(env, url.origin)
  const q = new Query(url.searchParams)
  const path = decodeURIComponent(url.pathname).replace(/\/+$/, '')
  if (path === '/api' || path === '/api/') {
    return { data: {
      readme: `${url.origin}/README.md`,
      endpoints: ['/api/summary', '/api/packages', '/api/packages/{name}', '/api/profiles', '/api/history', '/api/repos', '/api/repos/days', '/api/search', '/api/categories', '/api/forks', '/api/forks/{owner}/{repo}', '/api/forks/packages'],
    } }
  }
  if (path === '/api/summary') {
    // `days` backs the sparkline and `version` is the shard cache key; neither is useful to API clients.
    const rest: Partial<Summary> = { ...(await d.summary()) }
    delete rest.days
    delete rest.version
    return { data: rest }
  }
  if (path === '/api/profiles') return { data: (await d.summary()).profiles }
  if (path === '/api/packages') return packages(d, q)
  if (path.startsWith('/api/packages/')) return packageDetail(d, path.slice('/api/packages/'.length))
  if (path === '/api/history') return history(d, q)
  if (path === '/api/repos/days') return { data: (await d.summary()).repoDays.map(([day, total, official]) => ({ day, total, official, community: total - official })) }
  if (path === '/api/repos') return repos(d, q)
  if (path === '/api/search') return search(d, q, url.searchParams)
  if (path === '/api/forks') return forkList(d, q)
  if (path === '/api/forks/packages') return forkPackages(d, q)
  if (/^\/api\/forks\/[^/]+\/[^/]+$/.test(path)) return forkDetail(d, path.slice('/api/forks/'.length))
  if (path === '/api/categories') {
    return { data: [...CATEGORIES.map((c) => ({ id: c.id, label: c.label, keywords: c.keywords })), { id: 'other', label: CATEGORY_LABEL.other, keywords: [] }] }
  }
  throw new HttpError(404, 'not_found', `unknown endpoint ${url.pathname}; see /README.md`)
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
    if (req.method !== 'GET' && req.method !== 'HEAD') return Response.json({ error: { code: 'method_not_allowed', message: 'only GET is supported' } }, { status: 405, headers: HEADERS })
    if (url.pathname !== '/README.md' && !url.pathname.startsWith('/api')) return env.ASSETS.fetch(req)
    // Every request that reaches the Worker (the API and /README.md) counts toward the per-IP hourly limit.
    const limit = await rateLimit(req, env)
    if (!limit.allowed) {
      return Response.json({ error: { code: 'rate_limited', message: `at most ${RATE_LIMIT} requests per hour per IP; retry after ${limit.headers['Retry-After']}s` } }, { status: 429, headers: { ...HEADERS, ...limit.headers } })
    }
    const headers = { ...HEADERS, ...limit.headers }
    if (url.pathname === '/README.md') {
      return new Response(apiDoc.replaceAll('{{ORIGIN}}', url.origin), { headers: { ...headers, 'Content-Type': 'text/markdown; charset=utf-8' } })
    }
    try {
      const body = await route(req, env)
      const s = await new Data(env, url.origin).summary()
      const out = { ...body, meta: { ...body.meta, generatedAt: s.generatedAt, source: s.source } }
      const pretty = url.searchParams.get('pretty')
      return new Response(JSON.stringify(out, null, pretty && pretty !== '0' && pretty !== 'false' ? 2 : undefined), { headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } })
    } catch (err) {
      const e = err instanceof HttpError ? err : new HttpError(500, 'internal', err instanceof Error ? err.message : String(err))
      return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers })
    }
  },
} satisfies ExportedHandler<Env>
