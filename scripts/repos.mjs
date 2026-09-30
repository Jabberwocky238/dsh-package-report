#!/usr/bin/env node
// Fetches GitHub repositories created on given Asia/Shanghai days that carry the `deepseek-harness` or `dsh`
// topic, via the gh CLI, into public/data/repos/<day>.json (one file per day, replaced on each fetch).
// Usage: node scripts/repos.mjs              refresh yesterday and today
//        node scripts/repos.mjs --since 2026-08-13   backfill every day from that date through today
// The search API allows 30 requests/min and 1000 results per query; queries are split per topic and day.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const TOPICS = ['deepseek-harness', 'dsh']
const PER_PAGE = 100
const PAUSE_MS = 2100
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'repos')

const shanghaiDay = (t) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10)
const today = shanghaiDay(Date.now())
const sinceArg = process.argv.indexOf('--since')
const since = sinceArg > 0 ? process.argv[sinceArg + 1] : shanghaiDay(Date.now() - 86400e3)
const days = []
for (let d = since; d <= today; d = shanghaiDay(Date.parse(`${d}T12:00:00+08:00`) + 86400e3)) days.push(d)

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

fs.mkdirSync(dir, { recursive: true })
for (const day of days) {
  const repos = new Map()
  let truncated = false
  for (const topic of TOPICS) {
    const q = `topic:${topic} created:${day}T00:00:00+08:00..${day}T23:59:59+08:00`
    for (let page = 1; ; page++) {
      const res = await search(q, page)
      for (const r of res.items) {
        const prev = repos.get(r.full_name)
        if (prev) { prev.matched.push(topic); continue }
        repos.set(r.full_name, {
          name: r.full_name,
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
      if (res.total_count > 1000) truncated = true
      if (page * PER_PAGE >= Math.min(res.total_count, 1000) || !res.items.length) break
    }
  }
  const list = [...repos.values()].sort((a, b) => b.stars - a.stars || b.createdAt.localeCompare(a.createdAt))
  fs.writeFileSync(path.join(dir, `${day}.json`), JSON.stringify({ day, fetchedAt: new Date().toISOString(), truncated, repos: list }) + '\n')
  console.log(`${day}: ${list.length} repos${truncated ? ' (truncated at 1000 per topic)' : ''}`)
}
