import { LoaderCircleIcon } from "lucide-react"
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { LocalBackupDialog } from "@/components/dialogs/local-backup-dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { usePlatform } from "@/context/platform-context"
import { startFirstLaunchInstructions, startInstructions } from "@/lib/instructions-tour"
import "@/components/dashboard-actions.css"
import yougoriLogo from "../../logo.svg"
import { WindowControls } from "@/components/shared/window-controls"
import "@/components/workspace-design.css"

const HostTerminalDock = lazy(() => import("@/components/host-terminal-dock"))
const CloudEnvironmentDialog = lazy(async () => ({ default: (await import("@/components/dialogs/cloud-environment-dialog")).CloudEnvironmentDialog }))

function Brand() {
  return (
    <div data-tauri-drag-region aria-label="Yougori" className="flex select-none items-center gap-3 [&>*]:pointer-events-none">
      <img src={yougoriLogo} alt="" aria-hidden="true" width={58} height={36} className="h-9 w-auto shrink-0 object-contain" />
      <span className="text-[15px] font-semibold tracking-[-0.025em]">Yougori</span>
    </div>
  )
}

export function AppShell({ onCreate, children }: {
  onCreate(): void
  children: ReactNode
}) {
  const { state, updateSettings } = usePlatform()
  useEffect(() => { startFirstLaunchInstructions() }, [])
  const [cloudOpen, setCloudOpen] = useState(false)
  const [cloudMounted, setCloudMounted] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalMounted, setTerminalMounted] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(390)
  const toggleTerminal = useCallback(() => { setTerminalMounted(true); setTerminalOpen(open => !open) }, [])
  const hideTerminal = useCallback(() => { setTerminalOpen(false); document.getElementById("host-terminal-toggle")?.focus() }, [])
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.code === "Backquote" && !event.repeat) { event.preventDefault(); toggleTerminal() }
    }
    window.addEventListener("keydown", shortcut)
    return () => window.removeEventListener("keydown", shortcut)
  }, [toggleTerminal])
  const settings = state?.settings
  const systemDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
  const darkMode = settings?.theme === "dark" || (settings?.theme === "system" && systemDark)

  const update = (changes: Partial<NonNullable<typeof settings>>) => {
    if (!settings) return
    void updateSettings({ ...settings, ...changes }).catch(() => undefined)
  }

  return (
    <div className="workspace-app isolate min-h-screen bg-background text-foreground">
      <header data-tauri-drag-region className="workspace-header sticky top-0 z-20 border-b bg-background">
        <div data-tauri-drag-region className="mx-auto flex min-h-16 w-full flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3">
          <Brand />
          <div data-tauri-drag-region className="min-w-0 flex-1 self-stretch" aria-hidden="true" />
          <div className="dashboard-actions ml-auto flex flex-wrap items-center justify-end gap-2" role="group" aria-label="Dashboard actions">
            <Label className="dashboard-action dashboard-theme" htmlFor="topbar-theme">
              <span>Dark mode</span>
              <Switch
                checked={darkMode}
                id="topbar-theme"
                onCheckedChange={(checked) => update({ theme: checked ? "dark" : "light" })}
              />
            </Label>
            <Button data-tour="instructions" className="dashboard-action" variant="outline" size="sm" onClick={startInstructions} type="button">Instructions</Button>
            <LocalBackupDialog triggerClassName="dashboard-action dashboard-backup" />
            <Button id="host-terminal-toggle" className="dashboard-action" variant="outline" size="sm" aria-label="Toggle CLI" aria-expanded={terminalOpen} aria-controls="host-terminal-panel" title="CLI (Ctrl+`)" onClick={toggleTerminal}>
              <span>CLI</span>
            </Button>
            <Button data-tour="cloud-environment" aria-label="Cloud environment" title="Connect an existing cloud server" className="dashboard-action" onClick={() => { setCloudMounted(true); setCloudOpen(true) }} size="sm" variant="outline" type="button">Cloud environment</Button>
            <Button data-tour="new-environment" aria-label="New environment" title="New environment" className="dashboard-action dashboard-action-primary" onClick={onCreate} size="sm" type="button">
              <span>New environment</span>
            </Button>
            <WindowControls />
          </div>
        </div>
      </header>
      <main className="workspace-main mx-auto w-full px-5 py-8 sm:px-6 sm:py-10">
        {children}
      </main>
      {cloudMounted ? <Suspense fallback={null}><CloudEnvironmentDialog open={cloudOpen} onOpenChange={setCloudOpen} /></Suspense> : null}
      {terminalMounted ? <Suspense fallback={terminalOpen ? <div role="status" className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-center gap-2 border-t bg-background text-sm text-muted-foreground shadow-xl" style={{ height: terminalHeight }}><LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />Loading terminal…</div> : null}><HostTerminalDock visible={terminalOpen} height={terminalHeight} onHeightChange={setTerminalHeight} onHide={hideTerminal} /></Suspense> : null}
    </div>
  )
}
