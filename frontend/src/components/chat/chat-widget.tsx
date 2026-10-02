import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { MessageCircleIcon } from 'lucide-react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ApiError, getIndex, sendChat, StoppedError } from '@/lib/api'
import { newId, useConversations, useLayout, type DisplayMode, type Layout, type Message } from '@/lib/store'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { ChatWindow } from './chat-window'

const GAP = 16
const DOCK = { min: 340, max: 960 }
const FLOAT = { minW: 340, minH: 420 }

function useIsNarrow() {
  const query = '(max-width: 640px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Drag handle: reports pointer positions while held, and blocks text selection meanwhile. */
function useDrag(onMove: (x: number, y: number) => void) {
  const [dragging, setDragging] = useState(false)
  const move = useRef(onMove)
  useEffect(() => { move.current = onMove })
  const start = useCallback((e: ReactPointerEvent) => {
    e.preventDefault()
    setDragging(true)
    const handle = (ev: PointerEvent) => move.current(ev.clientX, ev.clientY)
    const stop = () => {
      setDragging(false)
      window.removeEventListener('pointermove', handle)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', handle)
    window.addEventListener('pointerup', stop)
  }, [])
  return { dragging, start }
}

export function ChatWidget({ onLayout }: { onLayout?: (layout: Layout, effectiveMode: DisplayMode) => void }) {
  const [layout, update] = useLayout()
  const convos = useConversations()
  const theme = useTheme()
  const narrow = useIsNarrow()
  const [pending, setPending] = useState<Record<string, number>>({})   // conversation id → asked at
  const controllers = useRef(new Map<string, AbortController>())
  const superseded = useRef(new WeakSet<AbortController>())
  const [thresholds, setThresholds] = useState({ strong: 0.7, floor: 0.55 })
  const lastOpenMode = useRef<DisplayMode>(layout.mode === 'closed' ? 'floating' : layout.mode)

  // Phones get the whole screen whatever mode was chosen.
  const mode: DisplayMode = layout.mode !== 'closed' && narrow ? 'fullscreen' : layout.mode
  useEffect(() => { onLayout?.(layout, mode) }, [layout, mode, onLayout])
  const [botName, setBotName] = useState('Course Guide')
  useEffect(() => {
    getIndex().then((i) => {
      setThresholds({ strong: i.strong_vector_score, floor: i.min_vector_score })
      if (i.bot_name) setBotName(i.bot_name)
    }).catch(() => {})
  }, [])

  const setMode = useCallback((m: DisplayMode) => {
    if (m !== 'closed' && m !== 'fullscreen') lastOpenMode.current = m
    // The sidebar pushes the chat aside in full screen, but would cover it in the smaller modes.
    update({ mode: m, sidebarOpen: m === 'fullscreen' })
  }, [update])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && layout.mode === 'fullscreen') setMode(lastOpenMode.current)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [layout.mode, setMode])

  const dockDrag = useDrag((x) => update({ dockWidth: clamp(window.innerWidth - x, DOCK.min, Math.min(DOCK.max, window.innerWidth * 0.8)) }))
  const floatDrag = useDrag((x, y) => update({
    floatSize: {
      width: clamp(window.innerWidth - GAP - x, FLOAT.minW, window.innerWidth - GAP * 2),
      height: clamp(window.innerHeight - GAP - y, FLOAT.minH, window.innerHeight - GAP * 2),
    },
  }))

  // ---------------------------------------------------------------- asking, per conversation
  // Each conversation has its own request, so an answer (and its "thinking" indicator) only ever
  // shows in the chat it was asked in, and chats can be used while another one is waiting.
  const { appendTo, truncateFrom } = convos
  const ask = useCallback(async (convoId: string, text: string, before: Message[]) => {
    const ctrl = new AbortController()
    controllers.current.set(convoId, ctrl)
    setPending((p) => ({ ...p, [convoId]: Date.now() }))
    const history = before.filter((m) => !m.error && !m.stopped)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
    try {
      const response = await sendChat(text, history, ctrl.signal)
      appendTo(convoId, { id: newId(), role: 'assistant', content: response.reply, createdAt: Date.now(), response })
    } catch (e) {
      if (superseded.current.has(ctrl)) return          // replaced by an edit or retry: say nothing
      if (e instanceof StoppedError) {
        appendTo(convoId, { id: newId(), role: 'assistant', content: 'You stopped this answer.', createdAt: Date.now(), stopped: true })
      } else {
        const msg = e instanceof ApiError ? e.message : 'Sorry, something went wrong. Please try again.'
        appendTo(convoId, { id: newId(), role: 'assistant', content: msg, createdAt: Date.now(), error: true })
      }
    } finally {
      if (controllers.current.get(convoId) === ctrl) {
        controllers.current.delete(convoId)
        setPending(({ [convoId]: _done, ...rest }) => rest)
      }
    }
  }, [appendTo])

  /** Cancels a conversation's request without adding a "stopped" note (it's being replaced). */
  const supersede = (convoId: string) => {
    const ctrl = controllers.current.get(convoId)
    if (!ctrl) return
    superseded.current.add(ctrl)
    ctrl.abort()
    controllers.current.delete(convoId)
    setPending(({ [convoId]: _done, ...rest }) => rest)
  }

  const send = (text: string) => {
    const id = convos.activeId ?? newId()
    if (pending[id]) return
    const before = convos.active?.messages ?? []
    appendTo(id, { id: newId(), role: 'user', content: text, createdAt: Date.now() })
    convos.setActiveId(id)
    void ask(id, text, before)
  }

  const stop = () => {
    if (convos.activeId) controllers.current.get(convos.activeId)?.abort()
  }

  /** Edit a prompt: everything from it onwards is replaced, then it's asked again. */
  const edit = (messageId: string, text: string) => {
    const c = convos.active
    const i = c?.messages.findIndex((m) => m.id === messageId) ?? -1
    if (!c || i < 0 || !text.trim()) return
    supersede(c.id)
    truncateFrom(c.id, messageId)
    appendTo(c.id, { id: newId(), role: 'user', content: text.trim(), createdAt: Date.now(), editedAt: Date.now() })
    void ask(c.id, text.trim(), c.messages.slice(0, i))
  }

  /** Ask the prompt before this answer again (after a stop, an error, or to get a new answer). */
  const retry = (assistantId: string) => {
    const c = convos.active
    const i = c?.messages.findIndex((m) => m.id === assistantId) ?? -1
    if (!c || i < 1) return
    const userIndex = c.messages.slice(0, i).map((m) => m.role).lastIndexOf('user')
    if (userIndex < 0) return
    edit(c.messages[userIndex].id, c.messages[userIndex].content)
  }

  const removeConversation = (id: string) => {
    supersede(id)
    convos.remove(id)
  }

  const dragging = dockDrag.dragging || floatDrag.dragging
  const frame =
    mode === 'fullscreen' ? { top: 0, right: 0, width: '100vw', height: '100dvh', borderRadius: 0 }
      : mode === 'docked' ? { top: 0, right: 0, width: layout.dockWidth, height: '100dvh', borderRadius: 0 }
        : { bottom: GAP, right: GAP, width: layout.floatSize.width, height: layout.floatSize.height, borderRadius: 16 }

  return (
    <TooltipProvider delayDuration={300}>
      <AnimatePresence>
        {mode === 'closed' && (
          <motion.button
            key="launcher"
            initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }}
            onClick={() => setMode(lastOpenMode.current)}
            className="fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-full bg-primary py-3 pr-5 pl-4 text-sm font-medium text-primary-foreground shadow-lg hover:bg-primary/90"
            aria-label={`Open ${botName}`}
          >
            <MessageCircleIcon className="size-5" /> Ask {botName}
          </motion.button>
        )}

        {mode !== 'closed' && (
          <motion.div
            key="window"
            layout
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={dragging ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 36 }}
            style={{ position: 'fixed', zIndex: 50, ...frame }}
            className={cn('overflow-hidden border bg-background shadow-2xl', mode === 'docked' && 'border-y-0 border-r-0',
              mode === 'fullscreen' && 'border-0', dragging && 'select-none')}
            role="dialog"
            aria-label="Course guide chat"
          >
            {mode === 'docked' && (
              <div onPointerDown={dockDrag.start} title="Drag to resize"
                className="group absolute inset-y-0 left-0 z-40 w-1.5 cursor-col-resize hover:bg-primary/20">
                <span className="absolute top-1/2 left-0.5 h-10 w-0.5 -translate-y-1/2 rounded bg-border group-hover:bg-primary" />
              </div>
            )}
            {mode === 'floating' && (
              <div onPointerDown={floatDrag.start} title="Drag to resize"
                className="absolute top-0 left-0 z-40 size-4 cursor-nwse-resize rounded-tl-2xl hover:bg-primary/20" />
            )}
            <ChatWindow
              mode={mode}
              botName={botName}
              compact={narrow}
              isDark={theme.isDark}
              onToggleTheme={theme.toggle}
              onMode={setMode}
              conversation={convos.active}
              pendingSince={convos.activeId ? pending[convos.activeId] ?? null : null}
              onSend={send}
              onStop={stop}
              onEdit={edit}
              onRetry={retry}
              onRename={(title) => convos.activeId && convos.rename(convos.activeId, title)}
              onDelete={() => convos.activeId && removeConversation(convos.activeId)}
              storageFull={convos.storageFull}
              showDetails={layout.showDetails}
              thresholds={thresholds}
              sidebar={{
                open: layout.sidebarOpen,
                onOpenChange: (open) => update({ sidebarOpen: open }),
                conversations: convos.conversations,
                pending,
                activeId: convos.activeId,
                onSelect: convos.setActiveId,
                onNew: () => convos.setActiveId(null),
                onRename: convos.rename,
                onDelete: removeConversation,
                onClearAll: () => { convos.conversations.forEach((c) => supersede(c.id)); convos.clearAll() },
                showDetails: layout.showDetails,
                onShowDetails: (v) => update({ showDetails: v }),
                theme: theme.theme,
                onTheme: theme.setTheme,
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </TooltipProvider>
  )
}
