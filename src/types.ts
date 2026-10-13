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
    byGroupKind: { packages: number; apps: number }
    /** Cordis packages under vendor/, excluded from every count and dependency list. */
    cordisExcluded: string[]
    plugins: number
    entries: number
    referenced: number
    unusedPlugins: number
    cli?: { external: number; externalVersions: number; workspace: number }
  }
  latest: { day: string; version: string | null; total: number; weekAdded: number; weekRemoved: number }
  changedDays: number
  /** [day, new repository count, official count], newest first. */
  repoDays: [string, number, number][]
  /** Every official repository (owner deepseek-ai) across all fetched days, newest first. */
  officialRepos: { day: string; name: string; description: string; stars: number; language: string | null; createdAt: string }[]
  /** Totals of forks.json (written by scripts/forks.mjs); absent until a fork scan has run. */
  forks?: ForkTotals & { generatedAt: string }
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

/** repos/<day>.json: repositories created that Asia/Shanghai day with topic deepseek-harness or dsh. */
export interface RepoDay {
  day: string
  fetchedAt: string
  /** True when a topic had more than 1000 results that day and the search API cut the list. */
  truncated: boolean
  repos: {
    name: string
    /** Owner is deepseek-ai; every other owner is community. */
    official: boolean
    description: string
    stars: number
    forks: number
    language: string | null
    topics: string[]
    createdAt: string
    pushedAt: string
    homepage: string | null
    archived: boolean
    fork: boolean
    matched: string[]
  }[]
}

export interface ForkTotals {
  /** Forks of upstream and forks of forks that were listed. */
  forks: number
  /** Fork branches whose head is not an upstream master commit (bot branches excluded). */
  divergentBranches: number
  divergentForks: number
  distinctHeads: number
  /** Packages added in forks whose name upstream never had. */
  newPackages: number
}

/** A workspace package (package.json) that some fork branch adds relative to upstream master. */
export interface ForkPackage {
  name: string
  description: string
  dir: string
  /** Upstream has (or once had) a package with this name, so this is a move or re-add, not a new extension. */
  upstream: boolean
  /** package.json carries a `dsh` field. */
  dsh: boolean
  /** Dependencies that are DSH packages. */
  dshDeps: string[]
  /** All other dependencies. */
  deps: string[]
  forks: { fork: string; branch: string; sha: string; date: string | null }[]
}

/** A fork branch that diverges from upstream master. */
export interface ForkBranch {
  fork: string
  branch: string
  default: boolean
  sha: string
  /** Commits ahead of / behind upstream master. */
  ahead: number
  behind: number
  /** Files changed (the compare API lists at most 300; `capped` marks that). */
  files: number
  capped: boolean
  date: string | null
  message: string
  /** Names of packages this branch adds. */
  added: string[]
  /** Package directories with changed files, e.g. packages/llm/llm-deepseek. */
  touched: string[]
  stars: number
}

/** forks.json. */
export interface Forks {
  generatedAt: string
  upstreamHead: string
  totals: ForkTotals
  packages: ForkPackage[]
  branches: ForkBranch[]
}
