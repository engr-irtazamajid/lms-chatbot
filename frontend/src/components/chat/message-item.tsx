import { useEffect, useState, type KeyboardEvent } from 'react'
import { motion } from 'motion/react'
import {
  BotIcon, CheckIcon, CopyIcon, FileTextIcon, PencilIcon, RotateCcwIcon, SquareIcon,
  TriangleAlertIcon, UserIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Source } from '@/lib/api'
import type { Message } from '@/lib/store'
import { cn } from '@/lib/utils'
import { RagDetails } from './rag-details'

const MAX_CHARS = 500

const INTENT_LABEL: Record<string, string> = {
  greeting: 'greeting', about: 'about the assistant', exercise_quiz: 'exercise guard', list_courses: 'catalog', list_modules: 'catalog',
  module_overview: 'catalog', topic_overview: 'catalog', duration: 'catalog', content: 'RAG + LLM',
  not_covered: 'not covered',
}

function uniqueSources(sources: Source[]) {
  const seen = new Set<string>()
  return sources.filter((s) => {
    const key = `${s.file}|${s.page}|${s.topic_code}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function Action({ label, icon: Icon, onClick }: { label: string; icon: typeof CopyIcon; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" onClick={onClick} aria-label={label} className="text-muted-foreground">
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }
  return <Action label={copied ? 'Copied' : 'Copy'} icon={copied ? CheckIcon : CopyIcon} onClick={copy} />
}

function EditBox({ initial, onSave, onCancel }: { initial: string; onSave: (t: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial)
  const save = () => { if (text.trim()) onSave(text.trim()) }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save() }
    if (e.key === 'Escape') onCancel()
  }
  return (
    <div className="w-full min-w-64 rounded-xl border bg-background p-2">
      <Textarea autoFocus value={text} rows={2} onKeyDown={onKey} aria-label="Edit your question"
        onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
        className="max-h-40 min-h-14 resize-none border-0 shadow-none focus-visible:ring-0" />
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-[10px] text-muted-foreground">The answer below will be replaced</span>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={!text.trim()}>Save & send</Button>
        </div>
      </div>
    </div>
  )
}

export function MessageItem({ message, showDetails, thresholds, canRetry, onEdit, onRetry }: {
  message: Message
  showDetails: boolean
  thresholds: { strong: number; floor: number }
  canRetry: boolean
  onEdit: (text: string) => void
  onRetry: () => void
}) {
  const [editing, setEditing] = useState(false)
  const isUser = message.role === 'user'
  const r = message.response
  const sources = r ? uniqueSources(r.sources) : []

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={cn('group flex gap-2.5', isUser && 'flex-row-reverse')}
    >
      <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border',
        isUser ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
        {isUser ? <UserIcon className="size-3.5" /> : <BotIcon className="size-3.5" />}
      </span>
      <div className={cn('min-w-0 max-w-[85%]', isUser && 'flex flex-col items-end', editing && 'w-full')}>
        {editing ? (
          <EditBox initial={message.content} onCancel={() => setEditing(false)}
            onSave={(t) => { setEditing(false); onEdit(t) }} />
        ) : (
          <div className={cn('rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-line',
            isUser ? 'rounded-tr-sm bg-primary text-primary-foreground' : 'rounded-tl-sm bg-muted',
            message.error && 'bg-destructive/10 text-destructive',
            message.stopped && 'bg-transparent px-0 text-xs text-muted-foreground italic')}>
            {message.stopped && <SquareIcon className="mr-1.5 inline size-3 fill-current align-[-1px]" />}
            {message.content}
          </div>
        )}

        {r && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <Badge variant="outline" className="h-5 text-[10px]">{INTENT_LABEL[r.intent] ?? r.intent}</Badge>
            {r.intent === 'content' && r.trace.fallback && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="h-5 gap-1 border-amber-500/50 text-[10px] text-amber-700 dark:text-amber-300">
                    <TriangleAlertIcon className="size-3" /> short catalog answer
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-60 text-xs">{r.trace.fallback}</TooltipContent>
              </Tooltip>
            )}
            {sources.slice(0, 4).map((s, i) => (
              <Tooltip key={i}>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="h-5 max-w-48 gap-1 text-[10px]">
                    <FileTextIcon className="size-3" />
                    <span className="truncate">{s.topic_code || s.module_title || s.course_title}</span>
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  {[s.course_title, s.module_title, s.topic_code].filter(Boolean).join(' → ')}
                  <br />{s.file}{s.page ? `, page ${s.page}` : ''}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}

        {!editing && (
          <div className={cn('mt-0.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
            (message.stopped || message.error) && 'opacity-100')}>
            {isUser && <Action label="Edit" icon={PencilIcon} onClick={() => setEditing(true)} />}
            {!message.stopped && <CopyAction text={message.content} />}
            {!isUser && canRetry && <Action label={message.stopped || message.error ? 'Try again' : 'Regenerate'} icon={RotateCcwIcon} onClick={onRetry} />}
            {message.editedAt && <span className="px-1 text-[10px] text-muted-foreground">edited</span>}
          </div>
        )}

        {r && showDetails && <div className="w-full"><RagDetails response={r} thresholds={thresholds} /></div>}
      </div>
    </motion.div>
  )
}

export function TypingIndicator({ startedAt, onStop }: { startedAt: number; onStop: () => void }) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-muted">
        <BotIcon className="size-3.5" />
      </span>
      <div className="flex items-center gap-2">
        <div className="rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5">
          <div className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <motion.span key={i} className="size-1.5 rounded-full bg-muted-foreground"
                animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }} />
            ))}
            <Elapsed since={startedAt} />
          </div>
        </div>
        <Button size="xs" variant="outline" onClick={onStop}>
          <SquareIcon className="fill-current" /> Stop
        </Button>
      </div>
    </div>
  )
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.floor((now - since) / 1000)
  return s >= 2 ? <span className="ml-2 font-mono text-[10px] text-muted-foreground">{s}s · searching and writing…</span> : null
}
