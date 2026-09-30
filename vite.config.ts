import fs from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite'

import { cloudflare } from "@cloudflare/vite-plugin";

/**
 * Inlines public/data/summary.json into index.html and, in builds, preloads what the first lazy section needs
 * (the History chunk and its data shards), so they download in parallel with the main bundle.
 */
function inlineSummary(): Plugin {
  return {
    name: 'inline-summary',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const raw = fs.readFileSync(new URL('./public/data/summary.json', import.meta.url), 'utf8').trim()
        const { version } = JSON.parse(raw) as { version: string }
        const tags: HtmlTagDescriptor[] = [{ tag: 'script', attrs: { id: 'summary', type: 'application/json' }, children: raw.replace(/</g, '\\u003c'), injectTo: 'head' }]
        for (const shard of ['graph', 'history-0'])
          tags.push({ tag: 'link', attrs: { rel: 'preload', as: 'fetch', crossorigin: 'anonymous', href: `/data/${shard}.json?v=${version}` }, injectTo: 'head' })
        for (const chunk of Object.values(ctx.bundle ?? {}))
          if (chunk.type === 'chunk' && chunk.isDynamicEntry && chunk.name === 'History')
            for (const file of [chunk.fileName, ...chunk.imports.filter((f) => !f.includes('/index-'))]) tags.push({ tag: 'link', attrs: { rel: 'modulepreload', href: `/${file}` }, injectTo: 'head' })
        return { html, tags }
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cloudflare(), inlineSummary()],
})
