#!/usr/bin/env node
// Scans every fork of deepseek-ai/deepseek-harness (and forks of forks) for branches that diverge from upstream
// master, and finds the workspace packages those branches add — most DSH extensions live in forks, not in their own
// repositories. Work is checkpointed under $DSH_FORKS_CACHE (default ~/.cache/dsh-forks) so it runs in resumable
// batches; rerunning picks up where it stopped and only re-checks branches whose head moved.
// Usage: node scripts/forks.mjs [SRC] [--stage list|compare|extract|all] [--batch N]
//   SRC  a clone of upstream master (default ~/coding/dsh-report-src); only `git rev-list origin/master` is read.
// Output: public/data/forks.json
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const UPSTREAM = 'deepseek-ai/deepseek-harness'
const argv = process.argv.slice(2)
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def }
const SRC = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--')) ?? path.join(os.homedir(), 'coding', 'dsh-report-src')
const STAGE = opt('stage', 'all')
const BATCH = Number(opt('batch', 500))
const CONCURRENCY = 4
const CACHE = process.env.DSH_FORKS_CACHE ?? path.join(os.homedir(), '.cache', 'dsh-forks')
const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data')
const OUT = process.env.DSH_FORKS_OUT ?? path.join(DATA, 'forks.json')
fs.mkdirSync(path.join(CACHE, 'compare'), { recursive: true })
fs.mkdirSync(path.join(CACHE, 'manifest'), { recursive: true })

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return def } }
const writeJson = (f, v) => { fs.writeFileSync(`${f}.tmp`, JSON.stringify(v)); fs.renameSync(`${f}.tmp`, f) }

// --- gh with rate-limit pacing ---------------------------------------------------------------------------------
let calls = 0
async function pace() {
  if (++calls % 100) return
  const { stdout } = await run('gh', ['api', 'rate_limit'])
  const r = JSON.parse(stdout).resources
  for (const k of ['core', 'graphql']) {
    if (r[k].remaining < 150) {
      const wait = r[k].reset * 1000 - Date.now() + 5000
      log(`rate limit ${k} ${r[k].remaining} left; sleeping ${Math.round(wait / 1000)}s`)
      await sleep(wait)
    }
  }
}
async function gh(args) {
  await pace()
  for (let attempt = 0; ; attempt++) {
    try {
      const { stdout } = await run('gh', ['api', ...args], { maxBuffer: 1 << 28 })
      try { return JSON.parse(stdout) } catch { return { error: `unparsable: ${stdout.slice(0, 200)}` } }
    } catch (err) {
      const msg = `${err.stderr ?? ''}${err.stdout ?? ''}`
      if (/HTTP 404|HTTP 422|Not Found|No common ancestor/.test(msg)) return { error: msg.slice(0, 300) }
      if (attempt >= 5) throw err
      await sleep(20_000 * (attempt + 1))
    }
  }
}

// --- stage 1: list forks via GraphQL (100 per page, cost 1) ------------------------------------------------------
const FORKS_QUERY = `query($owner:String!,$name:String!,$after:String){ repository(owner:$owner,name:$name){
  forks(first:100,after:$after,orderBy:{field:CREATED_AT,direction:ASC}){ totalCount pageInfo{endCursor hasNextPage}
    nodes{ nameWithOwner createdAt pushedAt forkCount stargazerCount description isArchived
      defaultBranchRef{name} refs(refPrefix:"refs/heads/",first:30){totalCount pageInfo{endCursor hasNextPage} nodes{name target{oid ... on Commit{committedDate}}}} } } } }`
const REFS_QUERY = `query($owner:String!,$name:String!,$after:String){ repository(owner:$owner,name:$name){
  refs(refPrefix:"refs/heads/",first:100,after:$after){pageInfo{endCursor hasNextPage} nodes{name target{oid ... on Commit{committedDate}}}} } }`

const forksFile = path.join(CACHE, 'forks.json')
const listFile = path.join(CACHE, 'list-state.json')

async function listForks() {
  const forks = readJson(forksFile, {})
  // Each queue item is a repository whose forks are being paged; finished items keep their place so reruns skip them.
  const state = readJson(listFile, { queue: [{ repo: UPSTREAM, cursor: null, done: false }] })
  let pages = 0
  for (const item of state.queue) {
    if (item.done) continue
    const [owner, name] = item.repo.split('/')
    while (pages < BATCH) {
      const args = ['graphql', '-f', `query=${FORKS_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`]
      if (item.cursor) args.push('-f', `after=${item.cursor}`)
      const res = await gh(args)
      const conn = res.data?.repository?.forks
      if (!conn) { log('list error', item.repo, JSON.stringify(res).slice(0, 200)); item.done = true; break }
      for (const n of conn.nodes) {
        let refs = n.refs.nodes
        if (n.refs.pageInfo.hasNextPage) refs = refs.concat(await moreRefs(n.nameWithOwner, n.refs.pageInfo.endCursor))
        forks[n.nameWithOwner] = {
          parent: item.repo, createdAt: n.createdAt, pushedAt: n.pushedAt, stars: n.stargazerCount, forkCount: n.forkCount,
          description: n.description, archived: n.isArchived, defaultBranch: n.defaultBranchRef?.name ?? null,
          refs: refs.map((r) => [r.name, r.target.oid, r.target.committedDate ?? null]),
        }
        if (n.forkCount > 0 && !state.queue.some((q) => q.repo === n.nameWithOwner)) state.queue.push({ repo: n.nameWithOwner, cursor: null, done: false })
      }
      pages++
      item.cursor = conn.pageInfo.endCursor ?? item.cursor
      if (!conn.pageInfo.hasNextPage) item.done = true
      writeJson(forksFile, forks)
      writeJson(listFile, state)
      if (pages % 10 === 0 || item.done) log(`list ${item.repo}: ${Object.keys(forks).length} forks known (total ${conn.totalCount} here)`)
      if (item.done) break
    }
    if (pages >= BATCH) break
  }
  const left = state.queue.filter((q) => !q.done).length
  log(`list: ${Object.keys(forks).length} forks, ${left} repositories still to page`)
  return left === 0
}
async function moreRefs(repo, after) {
  const [owner, name] = repo.split('/')
  const out = []
  for (;;) {
    const res = await gh(['graphql', '-f', `query=${REFS_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `after=${after}`])
    const conn = res.data?.repository?.refs
    if (!conn) return out
    out.push(...conn.nodes)
    if (!conn.pageInfo.hasNextPage) return out
    after = conn.pageInfo.endCursor
  }
}

// --- which branch heads need a compare ---------------------------------------------------------------------------
const upstreamShas = new Set(execFileSync('git', ['-C', SRC, 'rev-list', 'origin/master'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(Boolean))
const upstreamHead = execFileSync('git', ['-C', SRC, 'rev-parse', 'origin/master'], { encoding: 'utf8' }).trim()
// Bot branches copied from upstream at fork time carry no extension work.
const ignoredBranch = (b) => /^(dependabot|renovate)\//.test(b)
// Commits older than the public repository are upstream's private pre-release history, copied along with branches
// that upstream had (and later deleted) when early forks were made.
const UPSTREAM_PUBLIC = '2026-08-13T11:56:32Z'
// A head shared by this many direct forks of upstream was copied from an upstream branch, not written in a fork.
const INHERITED_MIN_FORKS = 3
function inheritedHeads(forks) {
  const count = new Map()
  for (const f of Object.values(forks)) if (f.parent === UPSTREAM) for (const [, sha] of f.refs) count.set(sha, (count.get(sha) ?? 0) + 1)
  return new Set([...count].filter(([, n]) => n >= INHERITED_MIN_FORKS).map(([sha]) => sha))
}
function divergentHeads(forks) {
  const inherited = inheritedHeads(forks)
  const heads = new Map() // sha -> [[fork, branch], ...]
  for (const [fork, f] of Object.entries(forks)) {
    for (const [branch, sha, date] of f.refs) {
      if (ignoredBranch(branch) || upstreamShas.has(sha) || inherited.has(sha) || (date && date < UPSTREAM_PUBLIC)) continue
      if (!heads.has(sha)) heads.set(sha, [])
      heads.get(sha).push([fork, branch])
    }
  }
  return heads
}

// --- stage 2: compare each divergent head against upstream master -------------------------------------------------
const cmpFile = (sha) => path.join(CACHE, 'compare', `${sha}.json`)
async function compareOne(sha) {
  const res = await gh([`repos/${UPSTREAM}/compare/master...${sha}?per_page=100`])
  if (res.error) return { sha, error: res.error }
  const files = (res.files ?? []).map((f) => [f.status, f.filename, f.previous_filename ?? null])
  const out = {
    sha, status: res.status, ahead: res.ahead_by, behind: res.behind_by, base: res.merge_base_commit?.sha ?? null,
    files, filesCapped: files.length >= 300,
    lastCommit: res.commits?.at(-1) ? { date: res.commits.at(-1).commit.committer?.date, message: res.commits.at(-1).commit.message.split('\n')[0].slice(0, 200) } : null,
  }
  // The compare API lists at most 300 files; past that, diff the package.json paths of the two trees instead.
  if (out.filesCapped && out.base) {
    const tree = await gh([`repos/${UPSTREAM}/git/trees/${sha}?recursive=1`])
    if (tree.tree) {
      const basePkgs = new Set(execFileSync('git', ['-C', SRC, 'ls-tree', '-r', '--name-only', out.base], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter((p) => p.endsWith('package.json')))
      out.treeAddedPkgs = tree.tree.filter((e) => e.type === 'blob' && e.path.endsWith('package.json') && !basePkgs.has(e.path)).map((e) => e.path)
      out.treeTruncated = !!tree.truncated
    }
  }
  return out
}
async function pool(items, fn) {
  let i = 0
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (i < items.length) await fn(items[i++]) }))
}
async function compareAll() {
  const heads = divergentHeads(readJson(forksFile, {}))
  const todo = [...heads.keys()].filter((sha) => !fs.existsSync(cmpFile(sha)))
  log(`compare: ${heads.size} distinct divergent heads, ${todo.length} not yet compared; this batch ${Math.min(todo.length, BATCH)}`)
  let done = 0
  await pool(todo.slice(0, BATCH), async (sha) => {
    writeJson(cmpFile(sha), await compareOne(sha))
    if (++done % 50 === 0) log(`compare ${done}/${Math.min(todo.length, BATCH)}`)
  })
  return todo.length <= BATCH
}

// --- stage 3: read the manifests of added packages -----------------------------------------------------------------
const isWorkspacePkg = (p) => p.endsWith('package.json') && !/(^|\/)(node_modules|fixtures?|__fixtures__|test|tests|examples?|templates?)\//.test(p)
function addedPkgPaths(c) {
  const paths = new Set(c.files.filter(([s, f]) => (s === 'added' || s === 'renamed' || s === 'copied') && isWorkspacePkg(f)).map(([, f]) => f))
  for (const p of c.treeAddedPkgs ?? []) if (isWorkspacePkg(p)) paths.add(p)
  return [...paths]
}
const manFile = (sha, p) => path.join(CACHE, 'manifest', `${sha}-${p.replaceAll('/', '~')}`)
async function extractAll() {
  const todo = []
  for (const f of fs.readdirSync(path.join(CACHE, 'compare'))) {
    const c = readJson(path.join(CACHE, 'compare', f))
    if (!c || c.error) continue
    for (const p of addedPkgPaths(c)) if (!fs.existsSync(manFile(c.sha, p))) todo.push([c.sha, p])
  }
  log(`extract: ${todo.length} manifests to fetch; this batch ${Math.min(todo.length, BATCH)}`)
  await pool(todo.slice(0, BATCH), async ([sha, p]) => {
    const res = await gh(['-H', 'Accept: application/vnd.github.raw+json', `repos/${UPSTREAM}/contents/${p}?ref=${sha}`])
    writeJson(manFile(sha, p), res)
  })
  return todo.length <= BATCH
}

// --- report ----------------------------------------------------------------------------------------------------------
function report() {
  const forks = readJson(forksFile, {})
  const heads = divergentHeads(forks)
  const known = new Set(readJson(path.join(process.env.DSH_FORKS_GRAPH ?? path.join(DATA, 'graph.json')), { names: [] }).names)
  const pkgDir = (f) => f.match(/^(packages\/[^/]+\/[^/]+|apps\/[^/]+|vendor\/[^/]+|plugins?\/[^/]+)\//)?.[1] ?? null
  const packages = new Map() // name -> package entry
  const forkRows = []
  for (const [sha, refs] of heads) {
    const c = readJson(cmpFile(sha))
    if (!c || c.error) continue
    const added = []
    for (const p of addedPkgPaths(c)) {
      const m = readJson(manFile(sha, p))
      if (!m || m.error || !m.name) continue
      const deps = Object.keys({ ...m.dependencies, ...m.optionalDependencies, ...m.peerDependencies })
      added.push(m.name)
      const entry = packages.get(m.name) ?? { name: m.name, description: m.description ?? '', dir: path.dirname(p), upstream: known.has(m.name), dsh: !!m.dsh, dshDeps: deps.filter((x) => known.has(x)), deps: deps.filter((x) => !known.has(x)), forks: [] }
      for (const [fork, branch] of refs) if (!entry.forks.some((x) => x.fork === fork && x.branch === branch)) entry.forks.push({ fork, branch, sha, date: c.lastCommit?.date ?? null })
      packages.set(m.name, entry)
    }
    const touched = [...new Set(c.files.map(([, f]) => pkgDir(f)).filter(Boolean))]
    for (const [fork, branch] of refs) forkRows.push({ fork, branch, default: forks[fork]?.defaultBranch === branch, sha, ahead: c.ahead, behind: c.behind, files: c.files.length, capped: c.filesCapped, date: c.lastCommit?.date ?? null, message: c.lastCommit?.message ?? '', added, touched })
  }
  const byFork = Object.fromEntries(Object.entries(forks).map(([k, f]) => [k, { stars: f.stars, pushedAt: f.pushedAt, parent: f.parent, defaultBranch: f.defaultBranch }]))
  const out = {
    generatedAt: new Date().toISOString(), upstreamHead,
    totals: { forks: Object.keys(forks).length, divergentBranches: forkRows.length, divergentForks: new Set(forkRows.map((r) => r.fork)).size, distinctHeads: heads.size, newPackages: [...packages.values()].filter((p) => !p.upstream).length },
    packages: [...packages.values()].sort((a, b) => b.forks.length - a.forks.length || a.name.localeCompare(b.name)),
    branches: forkRows.map((r) => ({ ...r, stars: byFork[r.fork]?.stars ?? 0 })).sort((a, b) => b.added.length - a.added.length || b.ahead - a.ahead),
  }
  writeJson(OUT, out)
  log(`report: ${out.totals.forks} forks, ${out.totals.divergentForks} divergent forks / ${out.totals.divergentBranches} branches, ${out.totals.newPackages} new packages -> ${path.relative(process.cwd(), OUT)}`)
}

if (STAGE === 'list' || STAGE === 'all') await listForks()
if (STAGE === 'compare' || STAGE === 'all') await compareAll()
if (STAGE === 'extract' || STAGE === 'all') await extractAll()
if (STAGE === 'report' || STAGE === 'all') report()
