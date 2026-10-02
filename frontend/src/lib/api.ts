// Types mirror app/main.py, app/chat.py and app/trace.py.

export type Role = 'user' | 'assistant'

export interface Source {
  course_title: string
  module_title: string
  topic_code: string
  page: number
  file: string
}

export interface TraceStep {
  tool: string
  ms: number
  [detail: string]: unknown
}

export interface TraceChunk extends Source {
  kind: 'course' | 'module' | 'topic' | 'extra'
  vector: number
  bm25: number
  fused: number
  matched: string[]
  text: string
}

export interface Trace {
  steps: TraceStep[]
  chunks: TraceChunk[]
  tokens: { prompt: number; completion: number; total: number } | null
  models: { llm: string; embedding: string }
  fallback: string | null
  total_ms: number
}

export interface ChatResponse {
  reply: string
  intent: string
  sources: Source[]
  trace: Trace
}

export interface IndexModule {
  title: string
  slide_label: string | null
  file: string | null
  topics: number
  minutes: number
  topic_range: string | null
  chunks: number
  has_material: boolean
}

export interface IndexInfo {
  built_at: string | null
  embedding_backend: string
  embedding_dim: number | null
  parser: string | null
  chunks: number
  chunks_by_kind: Record<string, number>
  courses: { title: string; slug: string; level: string | null; modules: IndexModule[] }[]
  topics: number
  pdfs: number
  guard_hashes: number
  bot_name: string
  llm_model: string
  top_k: number
  min_vector_score: number
  strong_vector_score: number
}

export class ApiError extends Error {}
export class StoppedError extends Error {}

/** Aborting `signal` (the Stop button) closes the request; the server then stops the LLM. */
export async function sendChat(message: string, history: { role: Role; content: string }[],
                               signal?: AbortSignal): Promise<ChatResponse> {
  let res: Response
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: history.slice(-20) }),
      signal,
    })
  } catch {
    if (signal?.aborted) throw new StoppedError('Stopped')
    throw new ApiError("I can't reach the server right now. Please try again in a moment.")
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new ApiError(typeof err.detail === 'string' ? err.detail : 'Sorry, something went wrong. Please try again.')
  }
  try {
    return await res.json()
  } catch {
    if (signal?.aborted) throw new StoppedError('Stopped')
    throw new ApiError('Sorry, something went wrong. Please try again.')
  }
}

export async function getIndex(): Promise<IndexInfo> {
  const res = await fetch('/api/index')
  if (!res.ok) throw new ApiError('Could not load index details.')
  return res.json()
}
