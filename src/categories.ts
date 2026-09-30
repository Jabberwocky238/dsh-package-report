import type { RepoDay } from './types.ts'

export type Repo = RepoDay['repos'][number]

/**
 * Purpose categories for topic repositories. A repository gets the first category whose keywords appear in
 * its topics, name, or description (lowercased); rules are ordered from specific to generic.
 */
export const CATEGORIES = [
  { id: 'skin', label: '皮肤主题', keywords: ['skin', 'theme', 'wallpaper', '皮肤', '主题', '壁纸', '美化', 'live2d', '鲸鱼娘', 'css'] },
  { id: 'persona', label: '人格预设', keywords: ['persona', 'preset', 'roleplay', 'character', 'prompt', '人格', '预设', '角色', '猫娘', '提示词', '雌小鬼'] },
  { id: 'i18n', label: '语言包', keywords: ['i18n', 'locale', 'localization', 'translation', '语言包', '翻译', '本地化', '汉化'] },
  { id: 'memory', label: '记忆知识', keywords: ['memory', 'rag', 'knowledge', 'retrieval', 'embedding', '记忆', '知识库', '检索'] },
  { id: 'channel', label: 'IM 渠道', keywords: ['wechat', 'weixin', 'telegram', 'discord', 'feishu', 'lark', 'slack', 'dingtalk', 'wecom', 'qq', 'ilink', 'bot', 'channel', '微信', '飞书', '钉钉', '企业微信', '机器人'] },
  { id: 'mcp', label: 'MCP', keywords: ['mcp', 'model-context-protocol'] },
  { id: 'launcher', label: '启动器与部署', keywords: ['launcher', 'installer', 'install', 'deploy', 'deployment', 'docker', 'nix', 'nixpkgs', 'homebrew', 'service-manager', 'tray', 'hotkey', 'launchd', 'systemd', '启动器', '安装', '部署', '一键启动', '卸载'] },
  { id: 'learning', label: '教程与解读', keywords: ['tutorial', 'getting-started', 'learn', 'guide', 'course', 'code-reading', 'deep-read', 'analysis', 'analyze', 'notes', '教程', '解读', '源码分析', '学习', '入门', '笔记'] },
  { id: 'reimpl', label: '重写与移植', keywords: ['implementation', 'rewrite', 'port', 'from-scratch', 'clone', 'reimplementation', '复刻', '重写', '移植'] },
  { id: 'desktop', label: '桌面与客户端', keywords: ['desktop', 'electron', 'tauri', 'tui', 'vscode', 'extension', 'mobile', 'android', 'ios', '桌面', '客户端', '挂件', '桌宠'] },
  { id: 'model', label: '模型接入', keywords: ['provider', 'llm', 'openai', 'claude', 'gemini', 'ollama', 'qwen', 'kimi', 'glm', 'balance', '模型', '余额', 'api-key'] },
  { id: 'office', label: '办公与 Skill', keywords: ['skill', 'office', 'docx', 'xlsx', 'pptx', 'pdf', 'excel', 'word', 'ocr', '办公', '文档'] },
  { id: 'security', label: '安全权限', keywords: ['sandbox', 'security', 'guard', 'permission', 'audit', 'safety', '安全', '权限', '审计', '沙箱'] },
  { id: 'devtool', label: '开发工具与市场', keywords: ['sdk', 'cli', 'template', 'starter', 'boilerplate', 'awesome', 'marketplace', 'market', 'registry', 'devtools', '市场', '模板', '脚手架'] },
  { id: 'plugin', label: '通用插件', keywords: ['plugin', 'dsh-plugin', '插件'] },
] as const

export type CategoryId = (typeof CATEGORIES)[number]['id'] | 'other'
export const CATEGORY_LABEL: Record<CategoryId, string> = { ...Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])), other: '其他' } as Record<CategoryId, string>
export const CATEGORY_IDS: CategoryId[] = [...CATEGORIES.map((c) => c.id), 'other']

const cache = new WeakMap<Repo, CategoryId>()
const escape = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// ASCII keywords match whole words (so `cli` does not match `client`); CJK keywords match as substrings.
const matchers = CATEGORIES.map((cat) => {
  const ascii = cat.keywords.filter((k) => /^[ -~]+$/.test(k))
  const cjk = cat.keywords.filter((k) => !/^[ -~]+$/.test(k))
  const re = ascii.length ? new RegExp(`(?<![a-z0-9])(?:${ascii.map(escape).join('|')})(?![a-z0-9])`) : null
  return { id: cat.id, test: (text: string) => (re?.test(text) ?? false) || cjk.some((k) => text.includes(k)) }
})

/** @returns the purpose category of `r`. */
export function categoryOf(r: Repo): CategoryId {
  let c = cache.get(r)
  if (!c) {
    const text = `${r.topics.join(' ')} ${r.name} ${r.description}`.toLowerCase()
    c = matchers.find((m) => m.test(text))?.id ?? 'other'
    cache.set(r, c)
  }
  return c
}

/** Topics every repository here matches by construction; they carry no filtering information. */
export const BASE_TOPICS = new Set(['deepseek-harness', 'dsh'])
