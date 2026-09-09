import { lazy, Suspense, useCallback, useEffect, useState } from "react"
import { AppShell } from "@/components/app-shell"
import { LoadingScreen } from "@/components/shared/loading-screen"
import { AnchoredToastProvider, toastManager, ToastProvider } from "@/components/ui/toast"
import { PlatformProvider, usePlatform } from "@/context/platform-context"
import { platformApi } from "@/api/platform-api"
import { environmentIdFromSearch } from "@/lib/environment-window"
import type { EnvironmentKind } from "@/types/platform"
import { prepareTourWindow, tourWindowFailed, useInstructionsTour } from "@/lib/instructions-tour"

const loadCreateEnvironmentDialog = () => import("@/components/dialogs/create-environment-dialog")
const loadEnvironmentDetailSheet = () => import("@/components/environment-detail-sheet")
const loadGuestDesktop = () => import("@/components/guest-desktop")
const loadOverviewPage = () => import("@/pages/overview-page")

const CreateEnvironmentDialog = lazy(async () => ({ default: (await loadCreateEnvironmentDialog()).CreateEnvironmentDialog }))
const EnvironmentDetailSheet = lazy(async () => ({ default: (await loadEnvironmentDetailSheet()).EnvironmentDetailSheet }))
const GuestDesktop = lazy(async () => ({ default: (await loadGuestDesktop()).GuestDesktop }))
const GuestWorkspace = lazy(async () => ({ default: (await import("@/components/guest-workspace")).GuestWorkspace }))
const OverviewPage = lazy(async () => ({ default: (await loadOverviewPage()).OverviewPage }))
const InstructionsTour = lazy(() => import("@/components/instructions-tour"))

function ThemeSync() {
  const { state } = usePlatform()
  const preference = state?.settings.theme ?? "system"

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => {
      const dark = preference === "dark" || (preference === "system" && media.matches)
      document.documentElement.classList.toggle("dark", dark)
      document.documentElement.dataset.yougoriTheme = dark ? "dark" : "light"
      document.documentElement.style.colorScheme = dark ? "dark" : "light"
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0e0f10" : "#f7f7f6")
    }
    apply()
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [preference])
  return null
}

function Workspace() {
  const tour = useInstructionsTour()
  const { state, loading, error, openEnvironmentWindow } = usePlatform()
  const [createOpen, setCreateOpen] = useState(false)
  const [createMounted, setCreateMounted] = useState(false)
  const [createKind, setCreateKind] = useState<EnvironmentKind | undefined>()
  const [detailMounted, setDetailMounted] = useState(false)
  const [detailEnvironmentId, setDetailEnvironmentId] = useState<string | null>(null)
  const [guestEnvironmentId, setGuestEnvironmentId] = useState<string | null>(null)

  const openEnvironment = useCallback((environmentId: string) => {
    const selected = state?.environments.find((item) => item.id === environmentId)
    if (!selected || selected.provider === "nativeSandbox" || selected.kind === "computerBranch") return
    prepareTourWindow(environmentId)
    void (async () => {
      try {
        const openedNativeWindow = await openEnvironmentWindow(environmentId)
        setDetailEnvironmentId(null)
        if (!openedNativeWindow && !("__TAURI_INTERNALS__" in window)) {
          void loadGuestDesktop()
          setGuestEnvironmentId(environmentId)
        }
      } catch (reason) {
        tourWindowFailed(environmentId)
        toastManager.add({
          title: "Couldn’t open environment window",
          description: reason instanceof Error ? reason.message : String(reason),
          type: "error",
        })
      }
    })()
  }, [openEnvironmentWindow, state?.environments])
  const environment = guestEnvironmentId ? state?.environments.find((item) => item.id === guestEnvironmentId) : undefined
  const openCreate = useCallback((kind?: EnvironmentKind) => {
    void loadCreateEnvironmentDialog()
    setCreateMounted(true)
    setCreateKind(kind)
    setCreateOpen(true)
  }, [])
  const selectEnvironment = useCallback((environmentId: string) => {
    void loadEnvironmentDetailSheet()
    setDetailMounted(true)
    setDetailEnvironmentId(environmentId)
  }, [])
  const changeDetailOpen = useCallback((open: boolean) => {
    if (!open) setDetailEnvironmentId(null)
  }, [])

  if (loading || !state) return <LoadingScreen error={error} onRetry={() => window.location.reload()} />

  return (
    <>
      <ThemeSync />
      <Suspense fallback={<LoadingScreen message="Loading your environments…" onRetry={() => window.location.reload()} />}>
        <AppShell onCreate={() => openCreate()}>
          <OverviewPage
            onOpenEnvironment={openEnvironment}
            onSelectEnvironment={selectEnvironment}
          />
        </AppShell>
      </Suspense>
      {createMounted ? (
        <Suspense fallback={null}>
          <CreateEnvironmentDialog initialKind={createKind} onOpenChange={setCreateOpen} open={createOpen} />
        </Suspense>
      ) : null}
      {detailMounted ? (
        <Suspense fallback={null}>
          <EnvironmentDetailSheet environmentId={detailEnvironmentId} onOpenEnvironment={openEnvironment} onOpenChange={changeDetailOpen} />
        </Suspense>
      ) : null}
      {environment ? (
        <Suspense fallback={null}>
          <GuestDesktop environment={environment} onClose={() => setGuestEnvironmentId(null)} />
        </Suspense>
      ) : null}
      {tour?.active ? <Suspense fallback={null}><InstructionsTour onCreate={() => openCreate("container")} /></Suspense> : null}
    </>
  )
}

function EnvironmentWindow({ environmentId }: { environmentId: string }) {
  const tour = useInstructionsTour()
  const { state, loading, error } = usePlatform()
  const environment = state?.environments.find((item) => item.id === environmentId)

  useEffect(() => {
    document.title = environment ? `${environment.name} — Yougori` : "Environment — Yougori"
  }, [environment])

  if (loading || !state) return <LoadingScreen error={error} onRetry={() => window.location.reload()} />

  return (
    <Suspense fallback={<LoadingScreen message="Opening your environment…" onRetry={() => window.location.reload()} />}>
      <GuestWorkspace initialEnvironmentId={environmentId} initialAppSessionId={new URLSearchParams(window.location.search).get("guestApp")?.match(/^app-[a-zA-Z0-9-]{1,76}$/)?.[0]} onClose={() => { void platformApi.closeEnvironmentWindow().catch(() => undefined) }} />
      {tour?.active ? <InstructionsTour environmentId={environmentId} /> : null}
    </Suspense>
  )
}

export function App() {
  const environmentId = environmentIdFromSearch(window.location.search)
  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <PlatformProvider pollHostMetrics={!environmentId}>
          {environmentId ? <><ThemeSync /><EnvironmentWindow environmentId={environmentId} /></> : <Workspace />}
        </PlatformProvider>
      </AnchoredToastProvider>
    </ToastProvider>
  )
}
