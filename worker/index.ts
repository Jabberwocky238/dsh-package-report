// JSON API over the static data shards in public/data (served through the ASSETS binding).
// Routes and parameters are documented in worker/API.md, which /README.md returns verbatim.
import apiDoc from './API.md?raw'
import { CATEGORIES, CATEGORY_LABEL, categoryOf, type CategoryId, type Repo } from '../src/categories.ts'
import { DepGraph } from '../src/graph.ts'
import type { Day, Graph, PackageDetail, PackageKind, PackageRow, RepoDay, Summary } from '../src/types.ts'

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

async function route(req: Request, env: Env): Promise<{ data: unknown; meta?: Record<string, unknown> }> {
  const url = new URL(req.url)
  const d = new Data(env, url.origin)
  const q = new Query(url.searchParams)
  const path = decodeURIComponent(url.pathname).replace(/\/+$/, '')
  if (path === '/api' || path === '/api/') {
    return { data: {
      readme: `${url.origin}/README.md`,
      endpoints: ['/api/summary', '/api/packages', '/api/packages/{name}', '/api/profiles', '/api/history', '/api/repos', '/api/repos/days', '/api/categories'],
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
    if (url.pathname === '/README.md') {
      return new Response(apiDoc.replaceAll('{{ORIGIN}}', url.origin), { headers: { ...HEADERS, 'Content-Type': 'text/markdown; charset=utf-8' } })
    }
    if (!url.pathname.startsWith('/api')) return env.ASSETS.fetch(req)
    try {
      const body = await route(req, env)
      const s = await new Data(env, url.origin).summary()
      const out = { ...body, meta: { ...body.meta, generatedAt: s.generatedAt, source: s.source } }
      const pretty = url.searchParams.get('pretty')
      return new Response(JSON.stringify(out, null, pretty && pretty !== '0' && pretty !== 'false' ? 2 : undefined), { headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' } })
    } catch (err) {
      const e = err instanceof HttpError ? err : new HttpError(500, 'internal', err instanceof Error ? err.message : String(err))
      return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers: HEADERS })
    }
  },
} satisfies ExportedHandler<Env>
