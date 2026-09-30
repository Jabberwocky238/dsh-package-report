import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'

type Loader<P> = () => Promise<{ default: ComponentType<P> }>

/**
 * Loads a section's module and mounts it once its placeholder comes within 600px of the viewport.
 * Suspense is avoided on purpose: React throttles Suspense reveals by ~300ms per boundary.
 */
export function LazySection<P extends object>({ title, minHeight, load, props }: { title: string; minHeight: number; load: Loader<P>; props: P }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [mod, setMod] = useState<{ C: ComponentType<P> } | { error: string } | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [visible])
  useEffect(() => {
    if (!visible) return
    let live = true
    load().then((m) => live && setMod({ C: m.default }), (e: Error) => live && setMod({ error: e.message }))
    return () => { live = false }
  }, [visible, load])
  const C = mod && 'C' in mod ? mod.C : null
  return (
    <div ref={ref}>
      {C ? <C {...props} /> : <section style={{ minHeight }}><h2>{title}</h2><Loading error={mod && 'error' in mod ? mod.error : undefined} /></section>}
    </div>
  )
}

export function Loading({ error }: { error?: string }): ReactNode {
  return <p className="loading">{error ? `加载失败：${error}` : '加载中…'}</p>
}
