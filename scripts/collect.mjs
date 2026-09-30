#!/usr/bin/env node
// Collects the DeepSeek Harness package report into src/data/report.json.
// Usage: node scripts/collect.mjs <path-to-deepseek-harness>
// The harness must be installed and built (`pnpm install && pnpm run build`),
// because plugin detection imports each package's built entry points.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(process.argv[2] ?? '..')
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'report.json')
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

const manifests = dirs.map(([group, dir]) => ({ group, dir, json: readJson(path.join(root, dir, 'package.json')) }))
const wsNames = new Set(manifests.map((m) => m.json.name))
// Packages whose default export is callable but is not a plugin.
const notPlugins = new Set(['@deepseek-ai/schemastery'])

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
        if (kind && !notPlugins.has(json.name)) entries.push({ entry, kind })
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
    externalDeps: Object.keys({ ...deps, ...peers }).filter((d) => !wsNames.has(d)).sort(),
    externalDevDeps: Object.keys(json.devDependencies ?? {}).filter((d) => !wsNames.has(d)).sort(),
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
  const list = [...rows.values()].map((r) => ({ ...r, package: r.entry.startsWith('cordis:') ? null : pkgOf(r.entry) }))
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
    workspace: wsSeen.size,
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
    if (j?.name) pkgs.set(j.name, { dir: path.posix.dirname(file), json: j })
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

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: { commit: git('rev-parse', 'HEAD'), branch: git('rev-parse', '--abbrev-ref', 'HEAD'), version: readJson(path.join(root, 'package.json')).version },
  packages,
  profiles,
  closures,
  history,
  lockfile: { snapshots: Object.keys(lock.snapshots).length, importers: Object.keys(lock.importers).length },
}, null, 1) + '\n')
console.log(`wrote ${out}: ${packages.length} packages, ${packages.filter((p) => p.kind === 'plugin').length} plugins`)
process.exit(0)
