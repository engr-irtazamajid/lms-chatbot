// Browser-only state. Conversations are kept on this device (localStorage) until deleted; the
// server keeps no chat history, because learners are anonymous.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatResponse, Role } from './api'

export interface Message {
  id: string
  role: Role
  content: string
  createdAt: number
  response?: ChatResponse      // assistant messages: full reply incl. RAG trace
  error?: boolean
  stopped?: boolean            // the learner pressed Stop before the answer arrived
  editedAt?: number
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

export type DisplayMode = 'closed' | 'floating' | 'docked' | 'fullscreen'

export interface Layout {
  mode: DisplayMode
  dockWidth: number                            // px, docked sidebar
  floatSize: { width: number; height: number } // px, floating panel
  showDetails: boolean                         // RAG details under answers
  sidebarOpen: boolean
}

const KEYS = { conversations: 'lms-chat:conversations:v2', legacy: 'lms-chat:conversations',
  layout: 'lms-chat:layout', active: 'lms-chat:active' }

const DEFAULT_LAYOUT: Layout = {
  mode: 'closed',
  dockWidth: 440,
  floatSize: { width: 420, height: 640 },
  showDetails: true,
  sidebarOpen: true,
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false   // storage full or blocked (private window)
  }
}

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

/** Drops the chunk texts of RAG traces (the largest part) from all but the newest answers.
 *  Messages, sources, scores and timings are kept, so every chat stays readable. */
function compact(list: Conversation[], keepFull: number): Conversation[] {
  let seen = 0
  return list.map((c) => ({
    ...c,
    messages: c.messages.map((m) => {
      if (!m.response) return m
      if (seen++ < keepFull) return m
      const trace = { ...m.response.trace, chunks: m.response.trace.chunks.map((ch) => ({ ...ch, text: '' })) }
      return { ...m, response: { ...m.response, trace } }
    }),
  }))
}

/** Saves every conversation. If the browser's storage is full, older RAG chunk texts are
 *  dropped (never whole chats) and the save is retried. Returns false if it still fails. */
function saveConversations(list: Conversation[]): boolean {
  if (write(KEYS.conversations, list)) return true
  for (const keep of [20, 5, 0]) {
    if (write(KEYS.conversations, compact(list, keep))) return true
  }
  return false
}

function loadConversations(): Conversation[] {
  const list = read<Conversation[] | null>(KEYS.conversations, null)
  if (list) return list
  // Chats saved by the first version of the UI.
  const legacy = read<Omit<Conversation, 'createdAt'>[]>(KEYS.legacy, [])
  return legacy.map((c) => ({ ...c, createdAt: c.messages[0]?.createdAt ?? c.updatedAt }))
}

export function useLayout() {
  const [layout, setLayout] = useState<Layout>(() => ({ ...DEFAULT_LAYOUT, ...read(KEYS.layout, {}) }))
  useEffect(() => { write(KEYS.layout, layout) }, [layout])
  const update = useCallback((patch: Partial<Layout>) => setLayout((l) => ({ ...l, ...patch })), [])
  return [layout, update] as const
}

const titleFrom = (text: string) => {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 60 ? t.slice(0, 57) + '…' : t
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations)
  const [activeId, setActiveId] = useState<string | null>(() => read(KEYS.active, null))
  const [storageFull, setStorageFull] = useState(false)
  const fromOtherTab = useRef(false)

  useEffect(() => {
    if (fromOtherTab.current) { fromOtherTab.current = false; return }
    setStorageFull(!saveConversations(conversations))
  }, [conversations])
  useEffect(() => { write(KEYS.active, activeId) }, [activeId])

  // Another tab changed the chats: show its version instead of overwriting it later.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEYS.conversations || !e.newValue) return
      try {
        fromOtherTab.current = true
        setConversations(JSON.parse(e.newValue))
      } catch { /* ignore a malformed value */ }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const active = conversations.find((c) => c.id === activeId) ?? null

  /** Adds a message to a conversation (creating it if it doesn't exist yet). */
  const appendTo = useCallback((conversationId: string, message: Message) => {
    setConversations((list) => {
      const existing = list.find((c) => c.id === conversationId)
      const updated: Conversation = existing
        ? { ...existing, messages: [...existing.messages, message], updatedAt: Date.now() }
        : { id: conversationId, title: titleFrom(message.content), messages: [message],
            createdAt: Date.now(), updatedAt: Date.now() }
      return [updated, ...list.filter((c) => c.id !== conversationId)]
    })
  }, [])

  /** Removes a message and everything after it (used when a prompt is edited or retried). */
  const truncateFrom = useCallback((conversationId: string, messageId: string) => {
    setConversations((list) => list.map((c) => {
      if (c.id !== conversationId) return c
      const i = c.messages.findIndex((m) => m.id === messageId)
      return i < 0 ? c : { ...c, messages: c.messages.slice(0, i), updatedAt: Date.now() }
    }))
  }, [])

  const rename = useCallback((id: string, title: string) => {
    const t = titleFrom(title)
    if (t) setConversations((list) => list.map((c) => (c.id === id ? { ...c, title: t } : c)))
  }, [])

  const remove = useCallback((id: string) => {
    setConversations((list) => list.filter((c) => c.id !== id))
    setActiveId((current) => (current === id ? null : current))
  }, [])

  const clearAll = useCallback(() => {
    setConversations([])
    setActiveId(null)
  }, [])

  return { conversations, active, activeId, setActiveId, appendTo, truncateFrom, rename, remove, clearAll, storageFull }
}
