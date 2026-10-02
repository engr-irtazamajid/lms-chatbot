import { useState } from 'react'
import { LoaderCircleIcon, MessageSquareIcon, MoreHorizontalIcon, PencilIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import type { Conversation } from '@/lib/store'
import { cn } from '@/lib/utils'

const DAY = 86_400_000

function groupOf(t: number): string {
  const startOfToday = new Date().setHours(0, 0, 0, 0)
  if (t >= startOfToday) return 'Today'
  if (t >= startOfToday - DAY) return 'Yesterday'
  if (t >= startOfToday - 7 * DAY) return 'Previous 7 days'
  if (t >= startOfToday - 30 * DAY) return 'Previous 30 days'
  return 'Older'
}

function Row({ c, active, pending, onSelect, onRename, onDelete }: {
  c: Conversation; active: boolean; pending: boolean
  onSelect: () => void; onRename: (title: string) => void; onDelete: () => void
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const save = () => { if (renaming?.trim()) onRename(renaming); setRenaming(null) }

  if (renaming !== null) {
    return (
      <li className="px-1 py-0.5">
        <Input autoFocus value={renaming} maxLength={80} className="h-7 text-xs" aria-label="Chat name"
          onChange={(e) => setRenaming(e.target.value)} onBlur={save}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setRenaming(null) }} />
      </li>
    )
  }
  if (confirming) {
    return (
      <li className="flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-1 text-xs" role="alertdialog" aria-label="Delete chat">
        <span className="flex-1 truncate">Delete “{c.title}”?</span>
        <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>No</Button>
        <Button size="xs" variant="destructive" onClick={onDelete}>Delete</Button>
      </li>
    )
  }
  return (
    <li className="group relative">
      <button onClick={onSelect} title={c.title}
        className={cn('flex w-full items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-left text-xs hover:bg-sidebar-accent',
          active && 'bg-sidebar-accent font-medium')}>
        {pending
          ? <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-primary" aria-label="Waiting for an answer" />
          : <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="flex-1 truncate">{c.title}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Options for ${c.title}`}
            className={cn('absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
              active && 'opacity-100')}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right">
          <DropdownMenuItem onSelect={() => setRenaming(c.title)}><PencilIcon /> Rename</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}><Trash2Icon /> Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

export function ConversationList({ conversations, pending, activeId, onSelect, onRename, onDelete }: {
  conversations: Conversation[]
  pending: Record<string, number>
  activeId: string | null
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = q
    ? conversations.filter((c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)))
    : conversations

  const groups: [string, Conversation[]][] = []
  for (const c of [...shown].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const g = groupOf(c.updatedAt)
    const last = groups[groups.length - 1]
    if (last && last[0] === g) last[1].push(c)
    else groups.push([g, [c]])
  }

  return (
    <div className="px-1.5">
      {conversations.length > 0 && (
        <div className="relative mb-2">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats"
            className="h-7 pl-7 text-xs" aria-label="Search chats" />
        </div>
      )}
      {conversations.length === 0 && (
        <p className="px-2 py-4 text-xs text-muted-foreground">
          No conversations yet. Your chats are saved in this browser until you delete them.
        </p>
      )}
      {conversations.length > 0 && shown.length === 0 && (
        <p className="px-2 py-4 text-xs text-muted-foreground">No chats match “{query}”.</p>
      )}
      {groups.map(([label, items]) => (
        <div key={label} className="mb-2">
          <p className="px-2 pb-0.5 text-[10px] font-medium text-muted-foreground">{label}</p>
          <ul className="space-y-0.5">
            {items.map((c) => (
              <Row key={c.id} c={c} active={c.id === activeId} pending={!!pending[c.id]}
                onSelect={() => onSelect(c.id)} onRename={(t) => onRename(c.id, t)} onDelete={() => onDelete(c.id)} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
