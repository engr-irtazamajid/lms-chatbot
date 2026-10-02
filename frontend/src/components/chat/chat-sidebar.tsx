import { useState } from 'react'
import { motion } from 'motion/react'
import {
  DatabaseIcon, MessageSquareIcon, MonitorIcon, MoonIcon, PanelLeftCloseIcon, PanelLeftOpenIcon,
  PlusIcon, SettingsIcon, SparklesIcon, SunIcon, Trash2Icon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PROMPTS } from '@/lib/prompts'
import type { Conversation } from '@/lib/store'
import type { Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { ConversationList } from './conversation-list'
import { IndexPanel } from './index-panel'

type Section = 'chats' | 'prompts' | 'index' | 'settings'
const SECTIONS: { id: Section; label: string; icon: typeof MessageSquareIcon }[] = [
  { id: 'chats', label: 'Conversations', icon: MessageSquareIcon },
  { id: 'prompts', label: 'Prompt library', icon: SparklesIcon },
  { id: 'index', label: 'Index', icon: DatabaseIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
]

export interface ChatSidebarProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  overlay?: boolean                       // narrow layouts: slide over the chat instead of pushing it
  conversations: Conversation[]
  pending: Record<string, number>         // conversations waiting for an answer
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onClearAll: () => void
  onPrompt: (text: string) => void
  showDetails: boolean
  onShowDetails: (v: boolean) => void
  theme: Theme
  onTheme: (t: Theme) => void
}

const THEMES: { id: Theme; label: string; icon: typeof SunIcon }[] = [
  { id: 'light', label: 'Light', icon: SunIcon },
  { id: 'dark', label: 'Dark', icon: MoonIcon },
  { id: 'system', label: 'System', icon: MonitorIcon },
]

export function ChatSidebar(p: ChatSidebarProps) {
  const [section, setSection] = useState<Section>('chats')
  const [confirmClear, setConfirmClear] = useState(false)
  const width = p.open ? 272 : 52

  const rail = (
    <div className="flex flex-col items-center gap-1 py-2">
      {SECTIONS.map((s) => (
        <Tooltip key={s.id}>
          <TooltipTrigger asChild>
            <Button variant={section === s.id && p.open ? 'secondary' : 'ghost'} size="icon-sm"
              onClick={() => { setSection(s.id); p.onOpenChange(true) }} aria-label={s.label}>
              <s.icon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{s.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )

  return (
    <>
      {p.overlay && p.open && (
        <button className="absolute inset-0 z-20 bg-black/20" aria-label="Close sidebar" onClick={() => p.onOpenChange(false)} />
      )}
      <motion.aside
        animate={{ width: p.overlay && !p.open ? 0 : width }}
        initial={false}
        transition={{ type: 'spring', stiffness: 400, damping: 40 }}
        className={cn('flex h-full shrink-0 flex-col overflow-hidden border-r bg-sidebar text-sidebar-foreground',
          p.overlay && 'absolute inset-y-0 left-0 z-30 shadow-xl', p.overlay && !p.open && 'border-r-0')}
      >
        <div className={cn('flex h-12 items-center gap-1 px-2', p.open ? 'justify-between' : 'justify-center')}>
          {p.open && (
            <Button variant="outline" size="sm" className="flex-1 justify-start" onClick={p.onNew}>
              <PlusIcon /> New chat
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={() => p.onOpenChange(!p.open)}
            aria-label={p.open ? 'Collapse sidebar' : 'Expand sidebar'}>
            {p.open ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
          </Button>
        </div>
        <Separator />

        {!p.open ? rail : (
          <>
            <div className="grid grid-cols-4 gap-0.5 p-1.5">
              {SECTIONS.map((s) => (
                <Tooltip key={s.id}>
                  <TooltipTrigger asChild>
                    <Button variant={section === s.id ? 'secondary' : 'ghost'} size="sm" onClick={() => setSection(s.id)} aria-label={s.label}>
                      <s.icon />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{s.label}</TooltipContent>
                </Tooltip>
              ))}
            </div>
            <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {SECTIONS.find((s) => s.id === section)?.label}
            </p>
            <ScrollArea className="min-h-0 flex-1">
              <div className="pb-4">
                {section === 'chats' && (
                  <ConversationList conversations={p.conversations} pending={p.pending} activeId={p.activeId}
                    onSelect={(id) => { p.onSelect(id); if (p.overlay) p.onOpenChange(false) }}
                    onRename={p.onRename} onDelete={p.onDelete} />
                )}

                {section === 'prompts' && (
                  <div className="space-y-3 px-1.5">
                    {PROMPTS.map((g) => (
                      <div key={g.group}>
                        <p className="px-2 pb-1 text-[11px] text-muted-foreground">{g.group}</p>
                        {g.items.map((q) => (
                          <button key={q} onClick={() => p.onPrompt(q)}
                            className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-sidebar-accent">
                            {q}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {section === 'index' && <IndexPanel />}

                {section === 'settings' && (
                  <div className="space-y-3 px-3 text-xs">
                    <div>
                      <span>Theme</span>
                      <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg border p-0.5" role="radiogroup" aria-label="Theme">
                        {THEMES.map((t) => (
                          <Button key={t.id} size="sm" variant={p.theme === t.id ? 'secondary' : 'ghost'}
                            role="radio" aria-checked={p.theme === t.id} onClick={() => p.onTheme(t.id)}>
                            <t.icon /> {t.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <Separator />
                    <label className="flex items-center justify-between gap-3">
                      <span>
                        Show RAG details
                        <span className="block text-[11px] text-muted-foreground">Pipeline, chunks, scores and tokens under each answer.</span>
                      </span>
                      <Switch checked={p.showDetails} onCheckedChange={p.onShowDetails} />
                    </label>
                    <Separator />
                    {confirmClear ? (
                      <div className="space-y-1.5 rounded-md bg-destructive/10 p-2" role="alertdialog" aria-label="Delete all chats">
                        <p>Delete all {p.conversations.length} chats? This can't be undone.</p>
                        <div className="flex justify-end gap-1">
                          <Button size="xs" variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
                          <Button size="xs" variant="destructive" onClick={() => { setConfirmClear(false); p.onClearAll() }}>Delete all</Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" className="w-full" disabled={p.conversations.length === 0}
                        onClick={() => setConfirmClear(true)}>
                        <Trash2Icon /> Clear all conversations
                      </Button>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      Conversations are stored only in this browser. The server keeps no chat history.
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </>
        )}
      </motion.aside>
    </>
  )
}
