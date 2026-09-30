import { useShard } from './data.ts'
import { Loading } from './LazySection.tsx'
import type { Closures as ClosuresData } from './types.ts'

export default function Closures() {
  const { data, error } = useShard<ClosuresData>('closures')
  return (
    <section>
      <h2>外部依赖闭包</h2>
      {!data ? <Loading error={error} /> : (
        <>
          <div className="closures">
            {data.closures.map((c) => (
              <div key={c.root} className="closure">
                <h3><code>{c.root}</code></h3>
                <p><b>{c.external}</b> 个外部包 · {c.externalVersions} 个版本 · {c.workspace} 个 workspace 包</p>
                {c.heaviest.length > 0 && (
                  <ol>{c.heaviest.slice(0, 8).map((h) => <li key={h.name}><span>{h.name}</span><span className="muted">{h.size}</span></li>)}</ol>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
