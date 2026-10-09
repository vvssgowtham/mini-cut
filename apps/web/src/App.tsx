import { healthResponseSchema } from '@mini-cut/shared'
import { useEffect, useState } from 'react'

type ApiStatus = 'checking' | 'ok' | 'down'

export default function App() {
  const [api, setApi] = useState<ApiStatus>('checking')

  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/health', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Health check failed: ${res.status}`)
        return res.json()
      })
      .then((body) => {
        healthResponseSchema.parse(body)
        setApi('ok')
      })
      .catch(() => {
        if (!controller.signal.aborted) setApi('down')
      })

    return () => controller.abort()
  }, [])

  return (
    <main>
      <h1>Mini Cut</h1>
      <p>Browser video editor. Start with the command bus (see docs/ARCHITECTURE.md).</p>
      <p>API: {api}</p>
    </main>
  )
}
