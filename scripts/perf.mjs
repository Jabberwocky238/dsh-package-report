#!/usr/bin/env node
// Measures load and interaction latency under 4x CPU throttling.
// Usage: node scripts/perf.mjs [url]   (default http://localhost:4789/, i.e. `npx vite preview --port 4789`)
// Playwright is resolved from the upstream checkout; override with PLAYWRIGHT=<path to playwright/index.mjs>.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const store = path.join(process.env.DSH_SRC ?? path.join(os.homedir(), 'coding/dsh-report-src'), 'node_modules/.pnpm')
const pw = process.env.PLAYWRIGHT ?? path.join(store, fs.readdirSync(store).find((d) => d.startsWith('playwright@')), 'node_modules/playwright/index.mjs')
const { chromium } = await import(pathToFileURL(pw).href)
const url = process.argv[2] ?? 'http://localhost:4789/'

const b = await chromium.launch()
const p = await b.newPage()
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
const cdp = await p.context().newCDPSession(p)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
const t0 = Date.now()
await p.goto(url)
await p.waitForSelector('.stat-value')
const first = Date.now() - t0
await p.waitForSelector('.day')
console.log(`first screen ${first} ms, history cards ${Date.now() - t0} ms, DOM nodes ${await p.evaluate(() => document.getElementsByTagName('*').length)}`)
const time = async (label, fn) => {
  const s = Date.now()
  await fn()
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r))))
  console.log(`${label} ${Date.now() - s} ms`)
}
await time('scroll to package list', async () => { await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForSelector('table.packages tbody tr') })
await time('repos: switch day', async () => { await p.locator('.day-chip').nth(1).click(); await p.waitForSelector('.repo') })
await time('repos: show 30 more', () => p.locator('section:has(.repo-list) button.more').click())
await time('history: load 10 more days', () => p.locator('section:has(.days) button.more').click())
await time('history: dependency tree', () => p.locator('.days button.link').first().click())
const pkgs = 'section:has(table.packages)'
await time('type filter', () => p.selectOption(`${pkgs} .filters select`, 'all'))
await time('search', () => p.fill(`${pkgs} .filters input:not([type])`, 'session'))
await time('sort', () => p.locator('th.sortable').first().click())
await time('profile filter', () => p.locator('table.profiles tbody tr').first().click())
await time('expand package', async () => { await p.locator('table.packages tbody tr').first().click(); await p.waitForSelector('.detail .chain') })
console.log(errors.length ? `page errors: ${errors.join('; ')}` : 'no page errors')
await b.close()
