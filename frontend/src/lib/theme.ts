// Light / dark / system theme. The choice is stored per browser; "system" follows the OS setting.
// index.html applies the stored theme before React loads, so the page never flashes the wrong one.
import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark' | 'system'
const KEY = 'lms-chat:theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

function stored(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

function apply(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && media().matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  return dark
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(stored)
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))

  // "system" follows OS changes while the page is open.
  useEffect(() => {
    if (theme !== 'system') return
    const mq = media()
    const onChange = () => setIsDark(apply('system'))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = useCallback((t: Theme) => {
    try { localStorage.setItem(KEY, t) } catch { /* private window: still applies for this visit */ }
    setThemeState(t)
    setIsDark(apply(t))
  }, [])

  return { theme, isDark, setTheme, toggle: () => setTheme(isDark ? 'light' : 'dark') }
}
