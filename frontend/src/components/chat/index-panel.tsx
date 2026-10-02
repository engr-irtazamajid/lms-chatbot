import { useEffect, useState } from 'react'
import { DatabaseIcon, FileTextIcon, RefreshCwIcon, ShieldCheckIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getIndex, type IndexInfo } from '@/lib/api'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border bg-background/60 px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="truncate font-mono text-xs" title={String(value)}>{value}</div>
    </div>
  )
}

export function IndexPanel() {
  const [info, setInfo] = useState<IndexInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)     // bumped by the refresh button

  useEffect(() => {
    getIndex()
      .then((i) => { setInfo(i); setError(null) })
      .catch((e: Error) => setError(e.message))
  }, [version])
  const load = () => setVersion((v) => v + 1)

  if (error) return <p className="px-2 text-xs text-destructive">{error}</p>
  if (!info) return <p className="px-2 text-xs text-muted-foreground">Loading index…</p>

  const built = info.built_at ? new Date(info.built_at).toLocaleString() : 'unknown'
  return (
    <div className="space-y-3 px-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-medium"><DatabaseIcon className="size-3.5" /> Search index</span>
        <Button variant="ghost" size="icon-xs" onClick={load} aria-label="Refresh index details">
          <RefreshCwIcon />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Stat label="Chunks" value={info.chunks} />
        <Stat label="PDFs" value={info.pdfs} />
        <Stat label="Topics" value={info.topics} />
        <Stat label="Vector dims" value={info.embedding_dim ?? '—'} />
        <Stat label="Embeddings" value={info.embedding_backend.replace(/^api:/, '')} />
        <Stat label="LLM" value={info.llm_model} />
        <Stat label="Top-k" value={info.top_k} />
        <Stat label="Gate (min / strong)" value={`${info.min_vector_score} / ${info.strong_vector_score}`} />
      </div>
      <div className="flex flex-wrap gap-1">
        {Object.entries(info.chunks_by_kind).map(([kind, n]) => (
          <Badge key={kind} variant="secondary" className="h-5 text-[10px] capitalize">{kind} · {n}</Badge>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Built {built} · parser {info.parser ?? '—'}
      </p>
      <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <ShieldCheckIcon className="size-3" /> Exercise guard: {info.guard_hashes} hashed phrases, no exercise text stored
      </p>

      {info.courses.map((c) => (
        <div key={c.slug} className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="font-medium">{c.title}</span>
            {c.level && <Badge variant="outline" className="h-4 px-1 text-[9px]">{c.level}</Badge>}
          </div>
          {c.modules.length === 0 && <p className="text-[11px] text-muted-foreground">No modules listed yet.</p>}
          <ul className="space-y-1">
            {c.modules.map((m) => (
              <li key={m.title} className="rounded-md border bg-background/60 px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-medium">{m.title}</span>
                  {m.topic_range && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{m.topic_range}</span>}
                </div>
                {m.has_material ? (
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <FileTextIcon className="size-3" />
                    <span className="truncate">{m.file}</span>
                    <span className="ml-auto shrink-0">{m.topics} topics · {m.minutes} min · {m.chunks} chunks</span>
                  </div>
                ) : (
                  <div className="text-[10px] text-muted-foreground">No PDF yet: catalog only</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
