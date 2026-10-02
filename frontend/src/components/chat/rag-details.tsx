import { useState } from 'react'
import {
  BookOpenIcon, ChevronDownIcon, CpuIcon, DatabaseIcon, FileTextIcon, FilterIcon,
  RouteIcon, SearchIcon, ShieldCheckIcon, ShieldXIcon, TriangleAlertIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ChatResponse, TraceChunk, TraceStep } from '@/lib/api'
import { cn } from '@/lib/utils'

const TOOLS: Record<string, { label: string; icon: typeof RouteIcon; hint: string }> = {
  'catalog.find': { label: 'Catalog lookup', icon: DatabaseIcon, hint: 'Finds courses, modules and topic codes named in the question (SQLite).' },
  router: { label: 'Router', icon: RouteIcon, hint: 'Picks the answer source. Catalog answers never use the LLM.' },
  hybrid_search: { label: 'Hybrid search', icon: SearchIcon, hint: 'BM25 keywords + embedding similarity, merged by rank, then the relevance gate.' },
  'llm.generate': { label: 'LLM generation', icon: CpuIcon, hint: 'Writes a 2–4 sentence answer from the retrieved chunks only.' },
  exercise_guard: { label: 'Exercise guard', icon: ShieldCheckIcon, hint: 'Checks the reply against hashed exercise wording.' },
}

const HIDDEN_KEYS = new Set(['tool', 'ms', 'terms', 'min_vector', 'strong_vector'])

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`)

function StepRow({ step, last }: { step: TraceStep; last: boolean }) {
  const meta = TOOLS[step.tool] ?? { label: step.tool, icon: FilterIcon, hint: '' }
  const blocked = step.tool === 'exercise_guard' && step.result === 'blocked'
  const Icon = blocked ? ShieldXIcon : meta.icon
  const details = Object.entries(step).filter(([k]) => !HIDDEN_KEYS.has(k))
  const terms = Array.isArray(step.terms) ? (step.terms as string[]) : null

  return (
    <li className="relative flex gap-3 pb-3">
      {!last && <span className="absolute top-7 left-3.5 h-[calc(100%-1.5rem)] w-px bg-border" />}
      <span className={cn('z-10 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background',
        blocked && 'border-destructive text-destructive')}>
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium" title={meta.hint}>{meta.label}</span>
          <span className="font-mono text-[10px] text-muted-foreground">{ms(step.ms)}</span>
        </div>
        <p className="text-[11px] text-muted-foreground">{meta.hint}</p>
        {terms && (
          <div className="mt-1 flex flex-wrap gap-1">
            {terms.map((t) => <Badge key={t} variant="outline" className="h-4 px-1 font-mono text-[10px]">{t}</Badge>)}
          </div>
        )}
        {details.length > 0 && (
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
            {details.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k.replace(/_/g, ' ')}</dt>
                <dd className="truncate font-mono" title={formatValue(v)}>{formatValue(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </li>
  )
}

function highlight(text: string, terms: string[]) {
  if (!terms.length) return text
  // Terms are stems ("privileg"), so match whole words that start with them. The capture group
  // covers the whole word, which makes split() keep it at the odd indexes.
  const re = new RegExp(`\\b((?:${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\w*)`, 'gi')
  return text.split(re).map((part, i) =>
    i % 2 === 1 ? <mark key={i} className="rounded bg-amber-200/70 px-0.5 dark:bg-amber-500/30">{part}</mark> : part)
}

function ChunkCard({ chunk, rank, strong, floor }: { chunk: TraceChunk; rank: number; strong: number; floor: number }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-card p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">#{rank}</Badge>
            <Badge variant="outline" className="h-4 px-1 text-[10px] capitalize">{chunk.kind}</Badge>
            {chunk.topic_code && <Badge className="h-4 px-1 text-[10px]">{chunk.topic_code}</Badge>}
          </div>
          <p className="mt-1 truncate text-xs font-medium">{chunk.module_title || chunk.course_title}</p>
          <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            <FileTextIcon className="size-3 shrink-0" />
            {chunk.file}{chunk.page ? ` · page ${chunk.page}` : ''}
          </p>
        </div>
        <CollapsibleTrigger className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Show chunk text">
          <ChevronDownIcon className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
        </CollapsibleTrigger>
      </div>

      <div className="mt-2 grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="text-muted-foreground">vector</span>
        <Progress value={Math.max(0, chunk.vector) * 100} className="h-1.5" />
        <span className={cn('text-right font-mono', chunk.vector >= strong ? 'text-emerald-600' : chunk.vector >= floor ? '' : 'text-muted-foreground')}>
          {chunk.vector.toFixed(2)}
        </span>
        <span className="text-muted-foreground">BM25</span>
        <Progress value={Math.min(100, chunk.bm25 * 12)} className="h-1.5" />
        <span className="text-right font-mono">{chunk.bm25.toFixed(1)}</span>
      </div>
      {chunk.matched.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
          matched
          {chunk.matched.map((t) => <Badge key={t} variant="outline" className="h-4 px-1 font-mono text-[10px]">{t}</Badge>)}
        </div>
      )}
      <CollapsibleContent>
        <p className="mt-2 max-h-48 overflow-y-auto rounded bg-muted/60 p-2 text-[11px] leading-relaxed whitespace-pre-line">
          {highlight(chunk.text, chunk.matched)}
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function RagDetails({ response, thresholds }: {
  response: ChatResponse
  thresholds: { strong: number; floor: number }
}) {
  const [open, setOpen] = useState(false)
  const { trace } = response
  const llmStep = trace.steps.find((s) => s.tool === 'llm.generate')
  const tps = trace.tokens && llmStep && llmStep.ms > 0 ? trace.tokens.completion / (llmStep.ms / 1000) : null

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
        <BookOpenIcon className="size-3" />
        <span>RAG details</span>
        <span className="font-mono">· {trace.steps.length} steps · {trace.chunks.length} chunks{trace.tokens ? ` · ${trace.tokens.total} tokens` : ''} · {ms(trace.total_ms)}</span>
        <ChevronDownIcon className={cn('ml-auto size-3 transition-transform', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 rounded-lg border bg-background/60 p-2.5">
          {trace.fallback && (
            <p className="mb-2 flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-[11px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              <TriangleAlertIcon className="mt-px size-3 shrink-0" /> {trace.fallback}
            </p>
          )}
          <Tabs defaultValue="pipeline">
            <TabsList className="h-7">
              <TabsTrigger value="pipeline" className="text-[11px]">Pipeline</TabsTrigger>
              <TabsTrigger value="chunks" className="text-[11px]">Chunks ({trace.chunks.length})</TabsTrigger>
              <TabsTrigger value="usage" className="text-[11px]">Usage</TabsTrigger>
            </TabsList>

            <TabsContent value="pipeline" className="pt-2">
              <ol>{trace.steps.map((s, i) => <StepRow key={i} step={s} last={i === trace.steps.length - 1} />)}</ol>
            </TabsContent>

            <TabsContent value="chunks" className="space-y-2 pt-2">
              {trace.chunks.length === 0
                ? <p className="text-[11px] text-muted-foreground">No search was needed: this answer came straight from the catalog.</p>
                : trace.chunks.map((c, i) => <ChunkCard key={i} chunk={c} rank={i + 1} strong={thresholds.strong} floor={thresholds.floor} />)}
            </TabsContent>

            <TabsContent value="usage" className="pt-2">
              <dl className="grid grid-cols-2 gap-2 text-[11px]">
                {[
                  ['Prompt tokens', trace.tokens?.prompt ?? '—'],
                  ['Completion tokens', trace.tokens?.completion ?? '—'],
                  ['Total tokens', trace.tokens?.total ?? '—'],
                  ['Speed', tps ? `${tps.toFixed(1)} tok/s` : '—'],
                  ['LLM', trace.models.llm],
                  ['Embeddings', trace.models.embedding],
                  ['Intent', response.intent],
                  ['Total time', ms(trace.total_ms)],
                ].map(([k, v]) => (
                  <div key={k as string} className="rounded-md border p-2">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="truncate font-mono text-xs">{v}</dd>
                  </div>
                ))}
              </dl>
              {!trace.tokens && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  No tokens used: {response.intent === 'content' ? 'the LLM was not reached' : 'catalog answers come from SQLite, not the LLM'}.
                </p>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
