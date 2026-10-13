#!/usr/bin/env node
// Scans every fork of deepseek-ai/deepseek-harness (and forks of forks) for branches that diverge from upstream
// master, and finds the workspace packages those branches add — most DSH extensions live in forks, not in their own
// repositories. Work is checkpointed under $DSH_FORKS_CACHE (default ~/.cache/dsh-forks) so it runs in resumable
// batches; rerunning picks up where it stopped and only re-checks branches whose head moved.
// Usage: node scripts/forks.mjs [SRC] [--stage list|compare|extract|report|all] [--batch N] [--fresh]
//   --fresh  start the fork listing over (to pick up new forks and pushes); compare results stay cached by sha.
//   SRC  a clone of upstream master (default ~/coding/dsh-report-src); only `git rev-list origin/master` is read.
// Output: public/data/forks.json (totals, added packages, one row per fork) and public/data/forks/<n>.json (branch details).
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
const SRC = argv.find((a, i) => !a.startsWith('--') && !['--stage', '--batch'].includes(argv[i - 1])) ?? path.join(os.homedir(), 'coding', 'dsh-report-src')
const STAGE = opt('stage', 'all')
const BATCH = Number(opt('batch', 500))
const FRESH = argv.includes('--fresh')
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
  const forks = FRESH ? {} : readJson(forksFile, {})
  // Each queue item is a repository whose forks are being paged; finished items keep their place so reruns skip them.
  const state = (!FRESH && readJson(listFile)) || { queue: [{ repo: UPSTREAM, cursor: null, done: false }] }
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
  const files = (res.files ?? []).map((f) => [f.status, f.filename, f.previous_filename ?? null, f.sha ?? null])
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
      out.treeAddedPkgs = tree.tree.filter((e) => e.type === 'blob' && e.path.endsWith('package.json') && !basePkgs.has(e.path)).map((e) => [e.path, e.sha])
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
/** @returns [path, blob sha] of every workspace package.json the branch adds. */
function addedPkgs(c) {
  const out = new Map(c.files.filter(([s, f]) => (s === 'added' || s === 'renamed' || s === 'copied') && isWorkspacePkg(f)).map(([, f, , blob]) => [f, blob]))
  for (const [p, blob] of c.treeAddedPkgs ?? []) if (isWorkspacePkg(p)) out.set(p, blob)
  return [...out]
}
// Manifests are keyed by blob sha, so identical package.json files across forks are fetched once.
const manFile = (blob) => path.join(CACHE, 'manifest', `${blob}.json`)
async function extractAll() {
  const todo = new Set()
  for (const sha of divergentHeads(readJson(forksFile, {})).keys()) {
    const c = readJson(cmpFile(sha))
    if (!c || c.error) continue
    for (const [, blob] of addedPkgs(c)) if (blob && !fs.existsSync(manFile(blob))) todo.add(blob)
  }
  const batch = [...todo].slice(0, BATCH)
  log(`extract: ${todo.size} manifests to fetch; this batch ${batch.length}`)
  await pool(batch, async (blob) => {
    writeJson(manFile(blob), await gh(['-H', 'Accept: application/vnd.github.raw+json', `repos/${UPSTREAM}/git/blobs/${blob}`]))
  })
  return todo.size <= BATCH
}

// --- report ----------------------------------------------------------------------------------------------------------
// Fork rows go into forks.json; their branch details are split into forks/<n>.json, CHUNK forks per file, by row index.
const CHUNK = 50
function report() {
  const forks = readJson(forksFile, {})
  const heads = divergentHeads(forks)
  const graphFile = process.env.DSH_FORKS_GRAPH ?? path.join(DATA, 'graph.json')
  const known = new Set(readJson(graphFile, { names: [] }).names)
  // Cordis packages are not DSH dependencies (HANDOFF §2.8); drop them, including their historical names.
  const cordis = new Set([...readJson(path.join(path.dirname(graphFile), 'summary.json'), { totals: { cordisExcluded: [] } }).totals.cordisExcluded, 'cordis', 'cosmokit', 'schemastery'])
  const isCordis = (n) => cordis.has(n) || n.startsWith('@cordisjs/')
  const pkgDir = (f) => f.match(/^(packages\/[^/]+\/[^/]+|apps\/[^/]+|vendor\/[^/]+|plugins?\/[^/]+)\//)?.[1] ?? null
  const packages = new Map() // name -> package entry
  const pkgForks = new Map() // name -> fork -> { fork, branches, branch, date }
  const branchesByFork = new Map() // fork -> branch rows
  for (const [sha, refs] of heads) {
    const c = readJson(cmpFile(sha))
    if (!c || c.error) continue
    const date = c.lastCommit?.date ?? null
    const added = []
    for (const [p, blob] of addedPkgs(c)) {
      const m = blob && readJson(manFile(blob))
      if (!m || m.error || typeof m.name !== 'string' || isCordis(m.name)) continue
      const deps = Object.keys({ ...m.dependencies, ...m.optionalDependencies, ...m.peerDependencies }).filter((n) => !isCordis(n))
      added.push(m.name)
      if (!packages.has(m.name)) {
        packages.set(m.name, { name: m.name, description: typeof m.description === 'string' ? m.description : '', dir: path.dirname(p), upstream: known.has(m.name), dsh: !!m.dsh, dshDeps: deps.filter((x) => known.has(x)), deps: deps.filter((x) => !known.has(x)) })
        pkgForks.set(m.name, new Map())
      }
      const byFork = pkgForks.get(m.name)
      for (const [fork, branch] of refs) {
        const e = byFork.get(fork) ?? { fork, branches: 0, branch, date }
        e.branches++
        if ((date ?? '') > (e.date ?? '')) Object.assign(e, { branch, date })
        byFork.set(fork, e)
      }
    }
    const touched = [...new Set(c.files.map(([, f]) => pkgDir(f)).filter(Boolean))]
    for (const [fork, branch] of refs) {
      if (!branchesByFork.has(fork)) branchesByFork.set(fork, [])
      branchesByFork.get(fork).push({ branch, default: forks[fork]?.defaultBranch === branch, sha, ahead: c.ahead, behind: c.behind, files: c.files.length, capped: c.filesCapped, date, message: c.lastCommit?.message ?? '', added, touched })
    }
  }
  const groupOf = (dir) => (dir.startsWith('packages/') ? dir.split('/')[1] : dir.split('/')[0])
  const rows = [...branchesByFork].map(([fork, branches]) => {
    branches.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    const added = new Set(branches.flatMap((b) => b.added))
    const f = forks[fork]
    return {
      fork, parent: f.parent, stars: f.stars, description: f.description ?? '', createdAt: f.createdAt,
      branches: branches.length, ahead: Math.max(...branches.map((b) => b.ahead)), date: branches[0].date, message: branches[0].message, branch: branches[0].branch,
      added: added.size, newAdded: [...added].filter((n) => !known.has(n)).length,
      groups: [...new Set(branches.flatMap((b) => b.touched.map(groupOf)))].sort(),
      detail: branches,
    }
  }).sort((a, b) => b.newAdded - a.newAdded || (b.date ?? '').localeCompare(a.date ?? ''))
  const index = new Map(rows.map((r, i) => [r.fork, i]))
  const out = {
    generatedAt: new Date().toISOString(), upstreamHead, chunk: CHUNK,
    totals: { forks: Object.keys(forks).length, divergentBranches: rows.reduce((n, r) => n + r.branches, 0), divergentForks: rows.length, distinctHeads: heads.size, newPackages: [...packages.values()].filter((p) => !p.upstream).length },
    packages: [...packages.values()].map((p) => ({ ...p, forks: [...pkgForks.get(p.name).values()].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).map((e) => ({ ...e, i: index.get(e.fork) })) }))
      .sort((a, b) => b.forks.length - a.forks.length || a.name.localeCompare(b.name)),
    forks: rows.map(({ detail: _, ...r }) => r),
  }
  const chunkDir = path.join(path.dirname(OUT), 'forks')
  fs.rmSync(chunkDir, { recursive: true, force: true })
  fs.mkdirSync(chunkDir, { recursive: true })
  for (let n = 0; n * CHUNK < rows.length; n++) writeJson(path.join(chunkDir, `${n}.json`), rows.slice(n * CHUNK, (n + 1) * CHUNK).map((r) => r.detail))
  writeJson(OUT, out)
  log(`report: ${out.totals.forks} forks, ${out.totals.divergentForks} divergent forks / ${out.totals.divergentBranches} branches, ${out.totals.newPackages} new packages -> ${path.relative(process.cwd(), OUT)} + ${Math.ceil(rows.length / CHUNK)} chunks`)
}

if (STAGE === 'list' || STAGE === 'all') await listForks()
if (STAGE === 'compare' || STAGE === 'all') await compareAll()
if (STAGE === 'extract' || STAGE === 'all') await extractAll()
if (STAGE === 'report' || STAGE === 'all') report()
