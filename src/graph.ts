import type { Graph, PackageKind } from './types.ts'

export interface ChainStats {
  transitive: number
  depth: number
  /** Longest dependency path, excluding the package itself. */
  longest: string[]
}

/** Dependency graph over graph.json with memoized chain statistics. */
export class DepGraph {
  private readonly g: Graph
  private readonly index: Map<string, number>
  private readonly stats = new Map<number, ChainStats>()

  constructor(g: Graph) {
    this.g = g
    this.index = new Map(g.names.map((n, i) => [n, i]))
  }

  /** @returns the direct DSH dependencies of `name`. */
  deps(name: string): string[] {
    const i = this.index.get(name)
    return i === undefined ? [] : this.g.deps[i].map((d) => this.g.names[d])
  }

  /** @returns the current kind of `name`, or null when the package no longer exists. */
  kind(name: string): PackageKind | null {
    const i = this.index.get(name)
    return i === undefined ? null : this.g.kinds[i]
  }

  /** @returns the detail shard name of `name`. */
  shard(name: string): string {
    return `pkg/${this.index.get(name)}`
  }

  /** Breadth-first walk of the DSH dependencies of `name`. */
  chain(name: string): ChainStats {
    const root = this.index.get(name)
    if (root === undefined) return { transitive: 0, depth: 0, longest: [] }
    const hit = this.stats.get(root)
    if (hit) return hit
    const depth = new Map<number, number>([[root, 0]])
    const via = new Map<number, number>()
    const queue = [root]
    for (let q = 0; q < queue.length; q++) {
      const n = queue[q]
      for (const d of this.g.deps[n]) {
        if (depth.has(d)) continue
        depth.set(d, depth.get(n)! + 1)
        via.set(d, n)
        queue.push(d)
      }
    }
    let deepest = root
    for (const [n, k] of depth) if (k > depth.get(deepest)!) deepest = n
    const path: number[] = []
    for (let n = deepest; n !== root; n = via.get(n)!) path.unshift(n)
    const res = { transitive: depth.size - 1, depth: depth.get(deepest)!, longest: path.map((n) => this.g.names[n]) }
    this.stats.set(root, res)
    return res
  }
}
