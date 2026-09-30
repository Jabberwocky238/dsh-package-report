import type { Day, Package } from './types.ts'

/** Resolves a package's direct workspace dependencies: the current graph first, then the manifest recorded on the day it was added. */
export type DepsLookup = (name: string) => string[]

export function makeLookup(packages: Package[], history: Day[]): DepsLookup {
  const m = new Map<string, string[]>()
  for (const d of [...history].reverse()) for (const a of d.added) m.set(a.name, a.workspaceDeps)
  for (const p of packages) m.set(p.name, p.workspaceDeps)
  return (name) => m.get(name) ?? []
}

export interface ChainStats {
  transitive: number
  depth: number
  longest: string[]
}

const chainCache = new WeakMap<DepsLookup, Map<string, ChainStats>>()

/** Breadth-first walk of a package's DSH dependencies: transitive count, deepest level, and one longest path. Cached per lookup. */
export function chainStats(root: string, deps: DepsLookup): ChainStats {
  const cache = chainCache.get(deps) ?? new Map<string, ChainStats>()
  chainCache.set(deps, cache)
  const hit = cache.get(root)
  if (hit) return hit
  const depth = new Map<string, number>([[root, 0]])
  const via = new Map<string, string>()
  const queue = [root]
  while (queue.length) {
    const n = queue.shift()!
    for (const d of deps(n)) {
      if (depth.has(d)) continue
      depth.set(d, depth.get(n)! + 1)
      via.set(d, n)
      queue.push(d)
    }
  }
  depth.delete(root)
  let deepest = root
  for (const [n, k] of depth) if (k > (depth.get(deepest) ?? 0)) deepest = n
  const path = [deepest]
  while (via.has(path[0])) path.unshift(via.get(path[0])!)
  const res = { transitive: depth.size, depth: depth.get(deepest) ?? 0, longest: deepest === root ? [] : path }
  cache.set(root, res)
  return res
}
