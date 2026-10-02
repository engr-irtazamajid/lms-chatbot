import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  ArrowUpIcon, GraduationCapIcon, Maximize2Icon, Minimize2Icon, MoonIcon, MoreHorizontalIcon,
  PanelLeftOpenIcon, PanelRightIcon, PencilIcon, PictureInPicture2Icon, SquareIcon, SunIcon,
  Trash2Icon, TriangleAlertIcon, XIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PROMPTS } from '@/lib/prompts'
import type { Conversation, DisplayMode } from '@/lib/store'
import { cn } from '@/lib/utils'
import { ChatSidebar, type ChatSidebarProps } from './chat-sidebar'
import { MessageItem, TypingIndicator } from './message-item'

export const MAX_CHARS = 500

function IconButton({ label, icon: Icon, onClick, active }: {
  label: string; icon: typeof XIcon; onClick: () => void; active?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant={active ? 'secondary' : 'ghost'} size="icon-sm" onClick={onClick} aria-label={label}>
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export interface ChatWindowProps {
  mode: DisplayMode
  botName: string
  compact?: boolean                    // phone-sized screen: no push sidebar, no mode buttons
  isDark: boolean
  onToggleTheme: () => void
  onMode: (mode: DisplayMode) => void
  conversation: Conversation | null     // null = a new chat that has no messages yet
  pendingSince: number | null           // this conversation is waiting for an answer
  onSend: (text: string) => void
  onStop: () => void
  onEdit: (messageId: string, text: string) => void
  onRetry: (assistantMessageId: string) => void
  onRename: (title: string) => void
  onDelete: () => void
  storageFull: boolean
  showDetails: boolean
  thresholds: { strong: number; floor: number }
  sidebar: Omit<ChatSidebarProps, 'overlay' | 'onPrompt'>
}

export function ChatWindow(p: ChatWindowProps) {
  const [draft, setDraft] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const wide = p.mode === 'fullscreen' && !p.compact
  const messages = p.conversation?.messages ?? []
  const busy = p.pendingSince !== null
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')?.id

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) },
    [messages.length, p.pendingSince, p.conversation?.id])
  useEffect(() => { inputRef.current?.focus() }, [p.mode, p.conversation?.id])

  const send = (text: string) => {
    const t = text.trim()
    if (!t || busy) return
    p.onSend(t.slice(0, MAX_CHARS))
    setDraft('')
    if (!wide) p.sidebar.onOpenChange(false)
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft) }
  }
  const saveRename = () => {
    if (renaming !== null && renaming.trim()) p.onRename(renaming)
    setRenaming(null)
  }

  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden bg-background">
      <ChatSidebar {...p.sidebar} overlay={!wide} onPrompt={send} />

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          {!wide && !p.sidebar.open && (
            <Button variant="ghost" size="icon-sm" onClick={() => p.sidebar.onOpenChange(true)} aria-label="Open sidebar">
              <PanelLeftOpenIcon />
            </Button>
          )}
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCapIcon className="size-4" />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            {renaming !== null ? (
              <Input autoFocus value={renaming} maxLength={80} className="h-7 text-sm" aria-label="Chat name"
                onChange={(e) => setRenaming(e.target.value)} onBlur={saveRename}
                onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(null) }} />
            ) : (
              <>
                <p className="truncate text-sm font-semibold">{p.conversation?.title ?? 'New chat'}</p>
                <p className="truncate text-[11px] text-muted-foreground">{p.botName} · answers from course material</p>
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {p.conversation && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Chat options"><MoreHorizontalIcon /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setRenaming(p.conversation?.title ?? '')}>
                    <PencilIcon /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                    <Trash2Icon /> Delete chat
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <IconButton label={p.isDark ? 'Light theme' : 'Dark theme'} icon={p.isDark ? SunIcon : MoonIcon} onClick={p.onToggleTheme} />
            {!p.compact && (
              <>
                <IconButton label="Floating window" icon={PictureInPicture2Icon} active={p.mode === 'floating'} onClick={() => p.onMode('floating')} />
                <IconButton label="Dock to the side" icon={PanelRightIcon} active={p.mode === 'docked'} onClick={() => p.onMode('docked')} />
                {wide
                  ? <IconButton label="Exit full screen (Esc)" icon={Minimize2Icon} onClick={() => p.onMode('docked')} />
                  : <IconButton label="Full screen" icon={Maximize2Icon} onClick={() => p.onMode('fullscreen')} />}
              </>
            )}
            <IconButton label="Close" icon={XIcon} onClick={() => p.onMode('closed')} />
          </div>
        </header>

        {confirmDelete && (
          <div className="flex items-center gap-2 border-b bg-destructive/5 px-3 py-2 text-xs" role="alertdialog" aria-label="Delete chat">
            <span className="flex-1">Delete this chat? This can't be undone.</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button size="sm" variant="destructive" onClick={() => { setConfirmDelete(false); p.onDelete() }}>Delete</Button>
          </div>
        )}
        {p.storageFull && (
          <div className="flex items-center gap-2 border-b bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <TriangleAlertIcon className="size-3 shrink-0" />
            Browser storage is full, so new messages may not be saved. Delete some old chats to free space.
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn('mx-auto flex flex-col gap-4 p-4', wide && 'max-w-3xl py-8')}>
            {messages.length === 0 && !busy && (
              <div className="py-6 text-center">
                <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-muted">
                  <GraduationCapIcon className="size-5" />
                </span>
                <h2 className="mt-3 text-base font-semibold">What would you like to learn?</h2>
                <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                  I can tell you what our courses cover, which modules and topics they contain, and where to find a subject.
                  I don't share exercise or quiz answers.
                </p>
                <div className={cn('mt-4 grid gap-2 text-left', wide ? 'sm:grid-cols-3' : 'grid-cols-1')}>
                  {PROMPTS.map((g) => (
                    <button key={g.group} onClick={() => send(g.items[0])}
                      className="rounded-lg border p-3 text-xs transition-colors hover:bg-muted">
                      <span className="block text-[11px] text-muted-foreground">{g.group}</span>
                      {g.items[0]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <MessageItem key={m.id} message={m} showDetails={p.showDetails} thresholds={p.thresholds}
                canRetry={!busy && m.role === 'assistant' && (m.id === lastAssistant || !!m.stopped || !!m.error)}
                onEdit={(text) => p.onEdit(m.id, text)} onRetry={() => p.onRetry(m.id)} />
            ))}
            {busy && <TypingIndicator startedAt={p.pendingSince!} onStop={p.onStop} />}
            <div ref={bottomRef} />
          </div>
        </div>

        <footer className={cn('shrink-0 border-t p-3', wide && 'pb-5')}>
          <div className={cn('mx-auto rounded-xl border bg-background focus-within:ring-2 focus-within:ring-ring/30', wide && 'max-w-3xl')}>
            <Textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX_CHARS))}
              onKeyDown={onKey}
              rows={1}
              placeholder={busy ? 'Waiting for the answer… you can stop it' : 'Ask about a course, module or topic…'}
              className="max-h-40 min-h-11 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
            <div className="flex items-center justify-between px-2 pb-2">
              <span className="text-[10px] text-muted-foreground">Enter to send · Shift+Enter for a new line</span>
              <div className="flex items-center gap-2">
                <span className={cn('font-mono text-[10px] text-muted-foreground', draft.length > MAX_CHARS * 0.9 && 'text-destructive')}>
                  {draft.length}/{MAX_CHARS}
                </span>
                {busy ? (
                  <Button size="icon-sm" variant="secondary" onClick={p.onStop} aria-label="Stop answering">
                    <SquareIcon className="fill-current" />
                  </Button>
                ) : (
                  <Button size="icon-sm" onClick={() => send(draft)} disabled={!draft.trim()} aria-label="Send">
                    <ArrowUpIcon />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </footer>
      </section>
    </div>
  )
}
