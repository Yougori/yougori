import { useEffect, useState } from "react"
import { WindowControls } from "./window-controls"

export function LoadingScreen({ error, onRetry, message = "Starting your workspace…" }: { error?: string | null; onRetry?: () => void; message?: string }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (error) return
    const timer = window.setTimeout(() => setSlow(true), 15_000)
    return () => window.clearTimeout(timer)
  }, [error])
  return (
    <main className="startup-screen" aria-label={error ? "Yougori startup error" : "Loading Yougori"} aria-busy={!error}>
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-50 flex h-14 items-center justify-end px-4"><WindowControls /></div>
      <div className="startup-content">
        <p className="startup-brand">Yougori</p>
        {error ? (
          <>
            <div role="alert">
              <p className="startup-title">Yougori couldn’t start</p>
              <p className="startup-message">{error}</p>
            </div>
            {onRetry ? <button className="startup-retry" onClick={onRetry} type="button">Try again</button> : null}
          </>
        ) : (
          <>
            <div className="startup-track" aria-hidden="true"><span /></div>
            <p className="startup-message" role="status">{slow ? "This is taking longer than usual. You can reload this window and try again." : message}</p>
            {slow && onRetry ? <button className="startup-retry" onClick={onRetry} type="button">Reload window</button> : null}
          </>
        )}
      </div>
    </main>
  )
}
