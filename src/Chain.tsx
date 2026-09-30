import { useState } from 'react'
import type { DepGraph } from './graph.ts'

function TreeNode({ name, graph, seen }: { name: string; graph: DepGraph; seen: ReadonlySet<string> }) {
  const [open, setOpen] = useState(false)
  const children = graph.deps(name)
  const repeated = seen.has(name)
  const expandable = children.length > 0 && !repeated
  return (
    <li>
      <span className={expandable ? 'tree-toggle' : 'tree-leaf'} onClick={() => expandable && setOpen(!open)}>
        {expandable ? (open ? '▾ ' : '▸ ') : '· '}
        <code>{name}</code>
        {children.length > 0 && <span className="muted"> ({children.length})</span>}
        {repeated && <span className="muted"> ↺</span>}
      </span>
      {open && <DepTree name={name} graph={graph} seen={new Set([...seen, name])} />}
    </li>
  )
}

/** Children of `name`; each level renders only when its parent is expanded. */
export function DepTree({ name, graph, seen = new Set([name]) }: { name: string; graph: DepGraph; seen?: ReadonlySet<string> }) {
  const deps = graph.deps(name)
  if (!deps.length) return null
  return <ul className="tree">{deps.map((d) => <TreeNode key={d} name={d} graph={graph} seen={seen} />)}</ul>
}

/** Transitive count, depth, and the longest path of `name`. */
export function ChainLine({ name, graph }: { name: string; graph: DepGraph }) {
  const s = graph.chain(name)
  if (!s.transitive) return <span className="muted">无 DSH 依赖</span>
  return (
    <span className="path">
      传递 {s.transitive} · 深 {s.depth} · 最长链：
      {s.longest.map((n, i) => <span key={n}>{i > 0 && <span className="arrow"> → </span>}<code>{n}</code></span>)}
    </span>
  )
}

/** A toggle that mounts the dependency tree on first click. */
export function TreeToggle({ name, graph }: { name: string; graph: DepGraph }) {
  const [open, setOpen] = useState(false)
  if (!graph.deps(name).length) return null
  return (
    <>
      <button className="link" onClick={() => setOpen(!open)}>{open ? '收起依赖树' : '依赖树'}</button>
      {open && <div className="tree-wrap"><DepTree name={name} graph={graph} /></div>}
    </>
  )
}

/** Shows the first `limit` names and renders the rest only on request. */
export function ChipList({ items, limit = 12 }: { items: string[]; limit?: number }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, limit)
  return (
    <p className="chips">
      {shown.map((d) => <code key={d}>{d}</code>)}
      {items.length > limit && <button className="link" onClick={() => setAll(!all)}>{all ? '收起' : `显示全部 ${items.length} 个`}</button>}
    </p>
  )
}
