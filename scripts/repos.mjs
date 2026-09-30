#!/usr/bin/env node
// Fetches GitHub repositories created on given Asia/Shanghai days that carry the `deepseek-harness` or `dsh`
// topic, via the gh CLI, into public/data/repos/<day>.json (one file per day, replaced on each fetch).
// Usage: node scripts/repos.mjs              refresh yesterday and today
//        node scripts/repos.mjs --since 2026-08-13 [--until 2026-08-20]   backfill every day in that range (default through today)
// The search API allows 30 requests/min and 1000 results per query; queries are split per topic and day, and a
// window with more than 1000 results is halved until every piece fits.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const TOPICS = ['deepseek-harness', 'dsh']
// Repositories owned by these accounts are official; every other owner (including look-alike orgs) is community.
const OFFICIAL_OWNERS = new Set(['deepseek-ai'])
const PER_PAGE = 100
const PAUSE_MS = 2100
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'repos')

const shanghaiDay = (t) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10)
const today = shanghaiDay(Date.now())
const sinceArg = process.argv.indexOf('--since')
const since = sinceArg > 0 ? process.argv[sinceArg + 1] : shanghaiDay(Date.now() - 86400e3)
const untilArg = process.argv.indexOf('--until')
const until = untilArg > 0 ? process.argv[untilArg + 1] : today
const days = []
for (let d = since; d <= until; d = shanghaiDay(Date.parse(`${d}T12:00:00+08:00`) + 86400e3)) days.push(d)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function search(q, page) {
  for (let attempt = 0; ; attempt++) {
    try {
      const out = execFileSync('gh', ['api', '-X', 'GET', 'search/repositories', '-f', `q=${q}`, '-f', `per_page=${PER_PAGE}`, '-f', `page=${page}`, '-f', 'sort=stars'], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] })
      await sleep(PAUSE_MS)
      return JSON.parse(out)
    } catch (err) {
      if (attempt >= 4) throw err
      // Secondary rate limits answer 403/422; back off and retry.
      await sleep(30_000 * (attempt + 1))
    }
  }
}

const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z')

/** Collects every repository of `topic` created in [from, to] (epoch ms), halving windows that exceed 1000 results. */
async function collect(topic, from, to, add) {
  const q = `topic:${topic} created:${iso(from)}..${iso(to)}`
  const first = await search(q, 1)
  if (first.total_count > 1000 && to - from > 60e3) {
    const mid = from + Math.floor((to - from) / 2 / 1000) * 1000
    const a = await collect(topic, from, mid, add)
    const b = await collect(topic, mid + 1000, to, add)
    return a < 0 || b < 0 ? -1 : a + b
  }
  first.items.forEach(add)
  for (let page = 2; page * PER_PAGE - PER_PAGE < Math.min(first.total_count, 1000); page++) (await search(q, page)).items.forEach(add)
  return first.total_count > 1000 ? -1 : first.total_count
}

fs.mkdirSync(dir, { recursive: true })
for (const day of days) {
  const repos = new Map()
  let truncated = false
  for (const topic of TOPICS) {
    const add = (r) => {
      const prev = repos.get(r.full_name)
      if (prev) { if (!prev.matched.includes(topic)) prev.matched.push(topic); return }
      repos.set(r.full_name, {
        name: r.full_name,
        official: OFFICIAL_OWNERS.has(r.owner.login),
        description: r.description ?? '',
        stars: r.stargazers_count,
        forks: r.forks_count,
        language: r.language,
        topics: r.topics ?? [],
        createdAt: r.created_at,
        pushedAt: r.pushed_at,
        homepage: r.homepage || null,
        archived: r.archived,
        fork: r.fork,
        matched: [topic],
      })
    }
    const start = Date.parse(`${day}T00:00:00+08:00`)
    if ((await collect(topic, start, start + 86400e3 - 1000, add)) < 0) truncated = true
  }
  const list = [...repos.values()].sort((a, b) => Number(b.official) - Number(a.official) || b.stars - a.stars || b.createdAt.localeCompare(a.createdAt))
  fs.writeFileSync(path.join(dir, `${day}.json`), JSON.stringify({ day, fetchedAt: new Date().toISOString(), truncated, repos: list }) + '\n')
  console.log(`${day}: ${list.length} repos, ${list.filter((r) => r.official).length} official${truncated ? ' (truncated: a one-minute window exceeded 1000 results)' : ''}`)
}
