import { useCallback, useEffect, useState } from 'react'
import { BookOpenIcon, ClockIcon, LayersIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChatWidget } from '@/components/chat/chat-widget'
import { getIndex, type IndexInfo } from '@/lib/api'
import type { DisplayMode, Layout } from '@/lib/store'

// A stand-in for the LMS page the widget will be embedded in. Only the widget ships to the site.
export default function App() {
  const [info, setInfo] = useState<IndexInfo | null>(null)
  const [push, setPush] = useState(0)

  useEffect(() => { getIndex().then(setInfo).catch(() => setInfo(null)) }, [])
  // Docked mode behaves like a browser side panel: the page shrinks instead of being covered.
  const onLayout = useCallback((layout: Layout, mode: DisplayMode) => {
    setPush(mode === 'docked' ? layout.dockWidth : 0)
  }, [])

  return (
    <div className="min-h-dvh bg-muted/40 transition-[padding] duration-200" style={{ paddingRight: push }}>
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
          <BookOpenIcon className="size-5" />
          <span className="font-semibold">Training platform</span>
          <span className="ml-auto text-xs text-muted-foreground">Local preview of the course guide widget</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-semibold">Courses</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Open the course guide (bottom right) and try the floating, docked and full-screen modes.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {info?.courses.map((c) => {
            const minutes = c.modules.reduce((n, m) => n + m.minutes, 0)
            return (
              <Card key={c.slug}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {c.title} {c.level && <Badge variant="outline">{c.level}</Badge>}
                  </CardTitle>
                  <CardDescription className="flex gap-4">
                    <span className="flex items-center gap-1"><LayersIcon className="size-3.5" /> {c.modules.length} modules</span>
                    {minutes > 0 && <span className="flex items-center gap-1"><ClockIcon className="size-3.5" /> {minutes} min</span>}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1 text-sm">
                    {c.modules.map((m) => (
                      <li key={m.title} className="flex justify-between gap-2">
                        <span className="truncate">{m.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{m.has_material ? `${m.topics} topics` : 'coming soon'}</span>
                      </li>
                    ))}
                    {c.modules.length === 0 && <li className="text-muted-foreground">Modules coming soon</li>}
                  </ul>
                </CardContent>
              </Card>
            )
          })}
          {!info && <p className="text-sm text-muted-foreground">Start the API (uvicorn app.main:app --port 8000) to load courses.</p>}
        </div>
      </main>

      <ChatWidget onLayout={onLayout} />
    </div>
  )
}
