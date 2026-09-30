import type { Day, Package } from './types.ts'

/** Resolves a package's direct workspace dependencies: the current graph first, then the manifest recorded on the day it was added. */
export type DepsLookup = (name: string) => string[]

export function makeLookup(packages: Package[], history: Day[]): DepsLookup {
  const m = new Map<string, string[]>()
  for (const d of [...history].reverse()) for (const a of d.added) m.set(a.name, a.workspaceDeps)
  for (const p of packages) m.set(p.name, p.workspaceDeps)
  return (name) => m.get(name) ?? []
}
