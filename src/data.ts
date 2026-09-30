import { useEffect, useState } from 'react'
import { DepGraph } from './graph.ts'
import type { Graph } from './types.ts'

// The build inlines summary.json into index.html (#summary); its `version` keys every other shard,
// so shard URLs change whenever the data is re-collected and can be cached forever.
const cache = new Map<string, Promise<unknown>>()
const inlined = document.getElementById('summary')?.textContent
let version = inlined ? (JSON.parse(inlined) as { version: string }).version : ''
if (inlined) cache.set('summary', Promise.resolve(JSON.parse(inlined)))

/**
 * Fetches one shard from /data once per page load.
 * @param name - shard path without extension, e.g. `graph` or `pkg/12`.
 * @returns the parsed JSON.
 */
export function fetchShard<T>(name: string): Promise<T> {
  let p = cache.get(name)
  if (!p) {
    const url = name === 'summary' ? '/data/summary.json' : `/data/${name}.json?v=${version}`
    p = fetch(url, name === 'summary' ? { cache: 'no-cache' } : undefined).then((r) => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
      return r.json()
    }).then((j) => {
      if (name === 'summary') version = (j as { version: string }).version
      return j
    })
    p.catch(() => cache.delete(name))
    cache.set(name, p)
  }
  return p as Promise<T>
}

/**
 * Loads a shard when `name` is non-null.
 * @param name - shard to load, or null to wait.
 * @returns the shard, or undefined while loading.
 */
export function useShard<T>(name: string | null): { data?: T; error?: string } {
  const [state, setState] = useState<{ name: string | null; data?: T; error?: string }>({ name: null })
  useEffect(() => {
    if (!name) return
    let live = true
    fetchShard<T>(name).then((data) => live && setState({ name, data }), (e: Error) => live && setState({ name, error: e.message }))
    return () => { live = false }
  }, [name])
  return state.name === name ? state : {}
}

const graphs = new WeakMap<Graph, DepGraph>()

/** @returns the dependency graph once graph.json has loaded. */
export function useGraph(): { graph?: DepGraph; error?: string } {
  const { data, error } = useShard<Graph>('graph')
  if (!data) return { error }
  let g = graphs.get(data)
  if (!g) graphs.set(data, (g = new DepGraph(data)))
  return { graph: g }
}
