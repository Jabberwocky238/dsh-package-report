#!/usr/bin/env node
// Collects the DeepSeek Harness package report into lazily fetched shards under public/data/.
// Usage: node scripts/collect.mjs <path-to-deepseek-harness>
// The harness must be installed and built (`pnpm install && pnpm run build`),
// because plugin detection imports each package's built entry points.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(process.argv[2] ?? '..')
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data')
const HISTORY_PAGE = 10
const req = createRequire(path.join(root, 'package.json'))
const yaml = req('js-yaml')
const schema = yaml.DEFAULT_SCHEMA.extend([
  new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (s) => ({ js: s }) }),
])
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
const loadYaml = (f) => yaml.load(fs.readFileSync(f, 'utf8'), { schema }) ?? []
const pkgOf = (entry) => entry.replace(/^(@[^/]+\/[^/]+|[^@/][^/]*).*$/, '$1')

// ---- workspace packages --------------------------------------------------
const dirs = []
for (const g of fs.readdirSync(path.join(root, 'packages'))) {
  const gd = path.join(root, 'packages', g)
  if (!fs.statSync(gd).isDirectory()) continue
  for (const x of fs.readdirSync(gd)) if (fs.existsSync(path.join(gd, x, 'package.json'))) dirs.push([g, `packages/${g}/${x}`])
}
for (const x of fs.readdirSync(path.join(root, 'vendor')))
  if (fs.existsSync(path.join(root, 'vendor', x, 'package.json'))) dirs.push(['vendor', `vendor/${x}`])
for (const x of fs.readdirSync(path.join(root, 'apps')))
  if (fs.existsSync(path.join(root, 'apps', x, 'package.json'))) dirs.push(['apps', `apps/${x}`])

// vendor/ holds Cordis itself (cordis, cosmokit, schemastery, cordis-plugin-*). It is not a DSH package:
// it is left out of every count, and dependencies on it are dropped rather than reported as external.
const allManifests = dirs.map(([group, dir]) => ({ group, dir, json: readJson(path.join(root, dir, 'package.json')) }))
const cordisNames = new Set(allManifests.filter((m) => m.group === 'vendor').map((m) => m.json.name))
const manifests = allManifests.filter((m) => m.group !== 'vendor')
const wsNames = new Set(manifests.map((m) => m.json.name))
const isExternal = (d) => !wsNames.has(d) && !cordisNames.has(d)

function classify(value) {
  const e = value?.default ?? value
  if (typeof e === 'function') return /^class\s/.test(Function.prototype.toString.call(e)) ? 'class' : 'function'
  if (e && typeof e === 'object' && typeof e.apply === 'function') return 'object'
  return null
}

function exportTarget(v) {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') return exportTarget(v.node ?? v.import ?? v.default)
  return null
}

const packages = []
for (const { group, dir, json } of manifests) {
  const abs = path.join(root, dir)
  const client = Boolean(json.dsh?.client)
  const entries = []
  let built = true
  if (!client && group !== 'apps') {
    const exp = typeof json.exports === 'object' && json.exports ? json.exports : { '.': json.main }
    for (const [sub, target] of Object.entries(exp)) {
      if (sub.includes('*') || sub === './package.json') continue
      const t = exportTarget(target)
      if (!t || !/\.m?js$/.test(t)) continue
      const file = path.join(abs, t)
      if (!fs.existsSync(file)) {
        if (sub === '.') built = false
        continue
      }
      try {
        const kind = classify(await import(pathToFileURL(file).href))
        const entry = sub === '.' ? json.name : `${json.name}/${sub.slice(2)}`
        if (kind) entries.push({ entry, kind })
      } catch (err) {
        entries.push({ entry: sub, kind: 'error', error: String(err?.message ?? err).slice(0, 200) })
      }
    }
  }
  const deps = { ...json.dependencies, ...json.optionalDependencies }
  const peers = json.peerDependencies ?? {}
  packages.push({
    name: json.name,
    group,
    dir,
    description: json.description ?? '',
    kind: group === 'apps' ? 'app' : client ? 'client' : !built ? 'unbuilt' : entries.some((e) => e.kind !== 'error') ? 'plugin' : 'library',
    bundle: Boolean(json.dsh?.bundle),
    entries: entries.filter((e) => e.kind !== 'error'),
    errors: entries.filter((e) => e.kind === 'error'),
    workspaceDeps: Object.keys({ ...deps, ...peers }).filter((d) => wsNames.has(d)).sort(),
    externalDeps: Object.keys({ ...deps, ...peers }).filter(isExternal).sort(),
    externalDevDeps: Object.keys(json.devDependencies ?? {}).filter(isExternal).sort(),
  })
}
const byName = new Map(packages.map((p) => [p.name, p]))
for (const p of packages) p.dependents = []
for (const p of packages) for (const d of p.workspaceDeps) byName.get(d)?.dependents.push(p.name)

// ---- profiles --------------------------------------------------------------
function rowState(d) {
  if (d === true) return 'off'
  if (d && typeof d === 'object' && 'js' in d) return 'conditional'
  return 'on'
}
function applyPatch(rows, ops) {
  const walk = (node, parent) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, parent))
    if (!node || typeof node !== 'object') return
    let here = parent
    if (typeof node.id === 'string' && typeof node.name === 'string') {
      if (!rows.has(node.id)) rows.set(node.id, { id: node.id, entry: node.name, parent, state: rowState(node.disabled), condition: node.disabled?.js })
      here = node.id
    }
    for (const v of Object.values(node)) walk(v, here)
  }
  for (const op of ops) {
    if (op.insert) walk(op.insert, null)
    else if (op.id && rows.has(op.id) && 'disabled' in op) {
      const r = rows.get(op.id)
      r.state = rowState(op.disabled)
      r.condition = op.disabled?.js
    }
  }
}
const bundlePatches = (name) => {
  const p = byName.get(name)
  return [].concat(readJson(path.join(root, p.dir, 'package.json')).dsh.bundle.patch).map((f) => path.join(root, p.dir, f))
}
const profileDefs = [
  { id: 'headless', bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] },
  { id: 'acp', bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'] },
  { id: 'sdk', bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app'] },
  { id: 'sdk-minimal', bundles: ['@deepseek-ai/dsh-sdk-minimal'] },
  { id: 'web', bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] },
]
const profiles = profileDefs.map(({ id, bundles }) => {
  const rows = new Map()
  for (const b of bundles) for (const f of bundlePatches(b)) applyPatch(rows, loadYaml(f))
  const list = [...rows.values()]
    .map((r) => ({ ...r, package: r.entry.startsWith('cordis:') ? null : pkgOf(r.entry) }))
    .filter((r) => !cordisNames.has(r.package))
  return { id, bundles, rows: list }
})
for (const p of packages) p.profiles = profiles.filter((pr) => pr.rows.some((r) => r.package === p.name)).map((pr) => pr.id)

// ---- external dependency closure from the lockfile ---------------------------
const lock = yaml.load(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8'))
const norm = (from, rel) => path.posix.normalize(path.posix.join(from, rel)).replace(/\/$/, '')
function closure(start) {
  const wsSeen = new Set(), extSeen = new Set(), direct = new Map()
  const q = [['imp', start]]
  while (q.length) {
    const [kind, id] = q.pop()
    if (kind === 'imp') {
      if (wsSeen.has(id)) continue
      wsSeen.add(id)
      const e = lock.importers[id]
      if (!e) continue
      for (const k of ['dependencies', 'optionalDependencies'])
        for (const [n, v] of Object.entries(e[k] ?? {})) {
          if (v.version.startsWith('link:')) q.push(['imp', norm(id, v.version.slice(5))])
          else { direct.set(n, `${n}@${v.version}`); q.push(['snap', `${n}@${v.version}`]) }
        }
    } else {
      if (extSeen.has(id)) continue
      extSeen.add(id)
      const s = lock.snapshots[id]
      for (const k of ['dependencies', 'optionalDependencies'])
        for (const [n, v] of Object.entries(s?.[k] ?? {})) if (!String(v).startsWith('link:')) q.push(['snap', `${n}@${v}`])
    }
  }
  const subtree = (id) => {
    const seen = new Set(), st = [id]
    while (st.length) {
      const x = st.pop()
      if (seen.has(x)) continue
      seen.add(x)
      const s = lock.snapshots[x]
      for (const k of ['dependencies', 'optionalDependencies'])
        for (const [n, v] of Object.entries(s?.[k] ?? {})) if (!String(v).startsWith('link:')) st.push(`${n}@${v}`)
    }
    return seen.size
  }
  const names = new Set([...extSeen].map((x) => x.replace(/^(@?[^@]+)@.*$/, '$1')))
  return {
    workspace: [...wsSeen].filter((id) => !id.startsWith('vendor/')).length,
    external: names.size,
    externalVersions: extSeen.size,
    heaviest: [...direct].map(([name, id]) => ({ name, size: subtree(id) })).sort((a, b) => b.size - a.size).slice(0, 15),
  }
}
const closures = ['apps/cli', 'apps/desktop-host', 'apps/desktop', 'python/sdk-runtime'].map((r) => ({ root: r, ...closure(r) }))

const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()

// ---- daily history along the first-parent chain of HEAD ----------------------
// One snapshot per Asia/Shanghai calendar day: the last first-parent commit of that day.
const WORKSPACE_MANIFEST = /^(packages\/[^/]+\/[^/]+|packages\/[^/]+|vendor\/[^/]+|apps\/[^/]+)\/package\.json$/
function catBatch(specs) {
  if (!specs.length) return []
  const buf = execFileSync('git', ['-C', root, 'cat-file', '--batch'], { input: specs.join('\n') + '\n', maxBuffer: 1 << 30 })
  const res = []
  let i = 0
  while (i < buf.length) {
    const nl = buf.indexOf(10, i)
    const header = buf.subarray(i, nl).toString()
    if (header.endsWith(' missing')) { res.push(null); i = nl + 1; continue }
    const size = Number(header.split(' ')[2])
    res.push(buf.subarray(nl + 1, nl + 1 + size).toString())
    i = nl + 1 + size + 1
  }
  return res
}
const dayCommits = new Map()
for (const line of execFileSync('git', ['-C', root, 'log', '--first-parent', '--date=format-local:%Y-%m-%d', '--format=%H %cd', 'HEAD'], { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, TZ: 'Asia/Shanghai' } }).trim().split('\n')) {
  const [sha, day] = line.split(' ')
  if (!dayCommits.has(day)) dayCommits.set(day, sha)
}
const blobCache = new Map()
const snapshots = []
for (const [day, sha] of [...dayCommits].reverse()) {
  const tree = git('ls-tree', '-r', sha).split('\n').map((l) => l.match(/^\S+ blob (\S+)\t(.+)$/)).filter((m) => m && WORKSPACE_MANIFEST.test(m[2]))
  const need = tree.filter(([, blob]) => !blobCache.has(blob))
  catBatch(need.map(([, blob]) => blob)).forEach((txt, k) => {
    let j = null
    try { j = JSON.parse(txt) } catch { /* malformed historical manifest: skipped */ }
    blobCache.set(need[k][1], j)
  })
  const pkgs = new Map()
  for (const [, blob, file] of tree) {
    const j = blobCache.get(blob)
    if (!j?.name) continue
    if (file.startsWith('vendor/')) cordisNames.add(j.name)
    else pkgs.set(j.name, { dir: path.posix.dirname(file), json: j })
  }
  let version = null
  try { version = JSON.parse(catBatch([`${sha}:package.json`])[0] ?? 'null')?.version ?? null } catch { /* root manifest absent on the first commits */ }
  snapshots.push({ day, sha, version, pkgs })
}
const wsDepsOf = (json, names) => Object.keys({ ...json.dependencies, ...json.optionalDependencies, ...json.peerDependencies }).filter((d) => names.has(d)).sort()
const history = []
const firstSeen = {}
let prev = new Map()
for (const s of snapshots) {
  const names = new Set(s.pkgs.keys())
  const added = [...s.pkgs].filter(([n]) => !prev.has(n)).map(([n, { dir, json }]) => ({ name: n, dir, description: json.description ?? '', workspaceDeps: wsDepsOf(json, names) }))
  const removed = [...prev.keys()].filter((n) => !names.has(n)).sort()
  for (const a of added) firstSeen[a.name] ??= s.day
  history.push({ day: s.day, commit: s.sha, version: s.version, total: names.size, added: added.sort((a, b) => a.name.localeCompare(b.name)), removed })
  prev = s.pkgs
}
history.reverse()
for (const p of packages) p.firstSeen = firstSeen[p.name] ?? null

// ---- shards ------------------------------------------------------------------
// summary.json is fetched first (no-cache); every other shard is fetched on demand with ?v=<summary.version>.
const generatedAt = new Date().toISOString()
const commit = git('rev-parse', 'HEAD')
const version = `${commit.slice(0, 12)}-${Date.parse(generatedAt)}`
const count = (xs, f) => xs.reduce((n, x) => n + (f(x) ? 1 : 0), 0)
const plugins = packages.filter((p) => p.kind === 'plugin')
const referenced = new Set(profiles.flatMap((p) => p.rows.map((r) => r.package)).filter(Boolean))
const kinds = ['plugin', 'library', 'client', 'unbuilt', 'app']
const groups = {}
for (const p of packages) (groups[p.group] ??= Object.fromEntries(kinds.map((k) => [k, 0])))[p.kind]++
const changed = history
  .map((d, i) => ({ ...d, prevVersion: history[i + 1]?.version ?? null }))
  .filter((d) => d.added.length || d.removed.length || d.version !== d.prevVersion)
const pages = []
for (let i = 0; i < changed.length; i += HISTORY_PAGE) pages.push(changed.slice(i, i + HISTORY_PAGE))
const cli = closures.find((c) => c.root === 'apps/cli')
const week = history.slice(0, 7)

// Dependency graph indexed by position: current packages first, then packages known only from history.
const graphNames = packages.map((p) => p.name)
const graphDeps = new Map(packages.map((p) => [p.name, p.workspaceDeps]))
for (const d of [...history].reverse()) for (const a of d.added) if (!graphDeps.has(a.name)) { graphNames.push(a.name); graphDeps.set(a.name, a.workspaceDeps) }
const index = new Map(graphNames.map((n, i) => [n, i]))

// public/data/repos/<day>.json is written by scripts/repos.mjs; only its per-day counts go into the summary.
const reposDir = path.join(outDir, 'repos')
const repoDays = (fs.existsSync(reposDir) ? fs.readdirSync(reposDir) : [])
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .map((f) => [f.slice(0, 10), readJson(path.join(reposDir, f)).repos.length])
  .sort((a, b) => b[0].localeCompare(a[0]))

const shards = {
  summary: {
    version,
    generatedAt,
    source: { commit, branch: git('rev-parse', '--abbrev-ref', 'HEAD'), version: readJson(path.join(root, 'package.json')).version },
    totals: {
      packages: packages.length,
      byGroupKind: { packages: count(packages, (p) => p.group !== 'apps'), apps: count(packages, (p) => p.group === 'apps') },
      cordisExcluded: [...new Set(allManifests.filter((m) => m.group === 'vendor').map((m) => m.json.name))].sort(),
      plugins: plugins.length,
      entries: plugins.reduce((n, p) => n + p.entries.length, 0),
      referenced: referenced.size,
      unusedPlugins: count(plugins, (p) => !p.profiles.length),
      cli: cli && { external: cli.external, externalVersions: cli.externalVersions, workspace: cli.workspace },
    },
    latest: { day: history[0]?.day, version: history[0]?.version, total: history[0]?.total, weekAdded: week.reduce((n, d) => n + d.added.length, 0), weekRemoved: week.reduce((n, d) => n + d.removed.length, 0) },
    changedDays: changed.length,
    /** [day, new repository count], newest first. */
    repoDays,
    historyPages: pages.length,
    days: history.map((d) => [d.day, d.total, d.added.length]),
    profiles: profiles.map((p) => ({
      id: p.id,
      bundles: p.bundles,
      rows: p.rows.length,
      on: count(p.rows, (r) => r.state === 'on'),
      conditional: count(p.rows, (r) => r.state === 'conditional'),
      off: count(p.rows, (r) => r.state === 'off'),
      packages: new Set(p.rows.map((r) => r.package).filter(Boolean)).size,
    })),
    groups,
  },
  graph: {
    names: graphNames,
    kinds: graphNames.map((n) => byName.get(n)?.kind ?? null),
    deps: graphNames.map((n) => graphDeps.get(n).filter((d) => index.has(d)).map((d) => index.get(d))),
  },
  packages: packages.map((p) => ({
    name: p.name, group: p.group, kind: p.kind, bundle: p.bundle, description: p.description, firstSeen: p.firstSeen,
    entries: p.entries.length, profiles: p.profiles, workspaceDeps: p.workspaceDeps.length, dependents: p.dependents.length, externalDeps: p.externalDeps.length,
  })),
  closures: { closures, lockfile: { snapshots: Object.keys(lock.snapshots).length, importers: Object.keys(lock.importers).length } },
}
// One detail shard per package, named by its graph index, fetched when that row is expanded.
for (const p of packages) {
  shards[`pkg/${index.get(p.name)}`] = {
    dir: p.dir,
    entries: p.entries,
    workspaceDeps: p.workspaceDeps,
    dependents: p.dependents,
    externalDeps: p.externalDeps,
    rows: profiles.flatMap((pr) => pr.rows.filter((r) => r.package === p.name).map(({ package: _, ...r }) => ({ profile: pr.id, ...r }))),
  }
}
pages.forEach((page, i) => { shards[`history-${i}`] = page })

// Everything under public/data except repos/ is regenerated here.
if (fs.existsSync(outDir)) for (const f of fs.readdirSync(outDir)) if (f !== 'repos') fs.rmSync(path.join(outDir, f), { recursive: true, force: true })
fs.mkdirSync(path.join(outDir, 'pkg'), { recursive: true })
for (const [name, value] of Object.entries(shards)) fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(value) + '\n')
console.log(`wrote ${Object.keys(shards).length} shards to ${outDir}: ${packages.length} packages, ${plugins.length} plugins, ${changed.length} changed days`)
process.exit(0)
