export type PackageKind = 'plugin' | 'library' | 'client' | 'unbuilt' | 'app'
export type EntryKind = 'class' | 'object' | 'function'
export type RowState = 'on' | 'conditional' | 'off'

export interface PluginEntry {
  entry: string
  kind: EntryKind
}

export interface Package {
  name: string
  group: string
  dir: string
  description: string
  kind: PackageKind
  bundle: boolean
  entries: PluginEntry[]
  errors: { entry: string; error: string }[]
  workspaceDeps: string[]
  externalDeps: string[]
  externalDevDeps: string[]
  dependents: string[]
  profiles: string[]
  firstSeen: string | null
}

export interface ProfileRow {
  id: string
  entry: string
  parent: string | null
  state: RowState
  condition?: string
  package: string | null
}

export interface Profile {
  id: string
  bundles: string[]
  rows: ProfileRow[]
}

export interface Closure {
  root: string
  workspace: number
  external: number
  externalVersions: number
  heaviest: { name: string; size: number }[]
}

export interface AddedPackage {
  name: string
  dir: string
  description: string
  workspaceDeps: string[]
}

export interface Day {
  day: string
  commit: string
  version: string | null
  total: number
  added: AddedPackage[]
  removed: string[]
}

export interface Report {
  generatedAt: string
  source: { commit: string; branch: string; version: string }
  packages: Package[]
  profiles: Profile[]
  closures: Closure[]
  history: Day[]
  lockfile: { snapshots: number; importers: number }
}
