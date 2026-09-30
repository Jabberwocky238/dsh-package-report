import type { PackageKind } from './types.ts'

export const KIND_LABEL: Record<PackageKind, string> = { plugin: 'Cordis 插件', library: '普通库', client: 'Client 前端', unbuilt: '未构建', app: '应用' }
export const KINDS: PackageKind[] = ['plugin', 'library', 'client', 'unbuilt', 'app']
