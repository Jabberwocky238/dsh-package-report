// Shard formats written by scripts/collect.mjs into public/data/.

export type PackageKind = 'plugin' | 'library' | 'client' | 'unbuilt' | 'app'
export type EntryKind = 'class' | 'object' | 'function'
export type RowState = 'on' | 'conditional' | 'off'

export interface ProfileStat {
  id: string
  bundles: string[]
  rows: number
  on: number
  conditional: number
  off: number
  packages: number
}

/** summary.json: everything the first screen renders. */
export interface Summary {
  version: string
  generatedAt: string
  source: { commit: string; branch: string; version: string }
  totals: {
    packages: number
    byGroupKind: { packages: number; vendor: number; apps: number }
    plugins: number
    entries: number
    referenced: number
    unusedPlugins: number
    cli?: { external: number; externalVersions: number; workspace: number }
  }
  latest: { day: string; version: string | null; total: number; weekAdded: number; weekRemoved: number }
  changedDays: number
  historyPages: number
  /** [day, total, added count], newest first. */
  days: [string, number, number][]
  profiles: ProfileStat[]
  groups: Record<string, Record<PackageKind, number>>
}

/** graph.json: dependency graph by index; kinds[i] is null for packages that no longer exist. */
export interface Graph {
  names: string[]
  kinds: (PackageKind | null)[]
  deps: number[][]
}

/** packages.json row. */
export interface PackageRow {
  name: string
  group: string
  kind: PackageKind
  bundle: boolean
  description: string
  firstSeen: string | null
  entries: number
  profiles: string[]
  workspaceDeps: number
  dependents: number
  externalDeps: number
}

/** pkg/<graph index>.json. */
export interface PackageDetail {
  dir: string
  entries: { entry: string; kind: EntryKind }[]
  workspaceDeps: string[]
  dependents: string[]
  externalDeps: string[]
  rows: { profile: string; id: string; entry: string; parent: string | null; state: RowState; condition?: string }[]
}

export interface AddedPackage {
  name: string
  dir: string
  description: string
  workspaceDeps: string[]
}

/** history-<n>.json element: a day with added, removed, or version changes. */
export interface Day {
  day: string
  commit: string
  version: string | null
  prevVersion: string | null
  total: number
  added: AddedPackage[]
  removed: string[]
}

/** closures.json. */
export interface Closures {
  closures: { root: string; workspace: number; external: number; externalVersions: number; heaviest: { name: string; size: number }[] }[]
  lockfile: { snapshots: number; importers: number }
}
