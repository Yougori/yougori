import { lazy, Suspense, useCallback, useMemo, useState } from "react"
import { EnvironmentGraph } from "@/components/environment-graph"
import { Sparkline } from "@/components/shared/sparkline"
import { usePlatform } from "@/context/platform-context"
import { formatBytesFromGb } from "@/lib/domain"
import { Button } from "@/components/ui/button"
import { toastManager } from "@/components/ui/toast"
import "@/components/shared/host-resource-charts.css"

const loadConnectionDialog = () => import("@/components/dialogs/connection-dialog")
const ConnectionDialog = lazy(async () => ({ default: (await loadConnectionDialog()).ConnectionDialog }))

export function OverviewPage({ onOpenEnvironment, onSelectEnvironment }: {
  onOpenEnvironment(environmentId: string): void
  onSelectEnvironment(environmentId: string): void
}) {
  const { state, reclaimStorage } = usePlatform()
  const [reclaiming, setReclaiming] = useState(false)
  const reclaim = async () => {
    if (reclaiming) return
    setReclaiming(true)
    try { await reclaimStorage() }
    catch (error) { toastManager.add({ title: "Storage cleanup could not finish", description: String(error), type: "error", timeout: 0 }) }
    finally { setReclaiming(false) }
  }
  const [graphErrorContainer, setGraphErrorContainer] = useState<HTMLDivElement | null>(null)
  const [connectionOpen, setConnectionOpen] = useState(false)
  const [connectionMounted, setConnectionMounted] = useState(false)
  const [connectionSourceId, setConnectionSourceId] = useState<string | undefined>()
  const [connectionTargetId, setConnectionTargetId] = useState<string | undefined>()
  const environments = useMemo(() => [...(state?.environments ?? [])].sort((a, b) => new Date(b.lastOpenedAt ?? b.createdAt).getTime() - new Date(a.lastOpenedAt ?? a.createdAt).getTime()), [state?.environments])
  const runningCount = useMemo(() => state?.environments.filter((environment) => environment.status === "running").length ?? 0, [state?.environments])

  const openConnection = useCallback((sourceId?: string, targetId?: string) => {
    void loadConnectionDialog()
    setConnectionMounted(true)
    setConnectionSourceId(sourceId)
    setConnectionTargetId(targetId)
    setConnectionOpen(true)
  }, [])

  if (!state) return null

  return (
    <div className="workspace-overview flex flex-col gap-4">
      <div className="relative">
      <div className="absolute inset-x-0 bottom-full flex h-8 items-center empty:hidden sm:h-10 lg:h-12 [&>*]:w-full" ref={setGraphErrorContainer} />
      <section aria-label="Host resources and storage" className="workspace-metrics grid divide-y md:grid-cols-5 md:divide-x md:divide-y-0">
        <div className="flex min-w-0 flex-col gap-1.5 px-3 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-muted-foreground">Environments</span>
            <span className="text-lg font-medium tabular-nums tracking-[-0.025em]">{state.environments.length}</span>
          </div>
          <p className="workspace-running text-[11px] text-muted-foreground"><span className={runningCount ? "is-active" : ""} aria-hidden="true" />{runningCount} running · {state.environments.length - runningCount} not running</p>
        </div>
        <div className="resource-metric resource-metric-cpu flex min-w-0 flex-col gap-1.5 px-3 py-3">
          <div className="resource-metric-heading"><span>Host CPU</span><span className="resource-metric-value">{Math.round(state.host.usedCpuPercent)}<span className="resource-metric-unit">%</span></span></div>
          <Sparkline className="h-7" label="Recent CPU usage" values={state.host.cpuHistory} />
        </div>
        <div className="resource-metric resource-metric-gpu flex min-w-0 flex-col gap-1.5 px-3 py-3">
          <div className="resource-metric-heading"><span>Host GPU</span>{state.host.gpuUsagePercent === null ? <span className="resource-metric-unit">Unavailable</span> : <span className="resource-metric-value">{Math.round(state.host.gpuUsagePercent)}<span className="resource-metric-unit">%</span></span>}</div>
          <Sparkline className="h-7" label="Recent GPU usage" values={state.host.gpuHistory} unavailable={state.host.gpuUsagePercent === null} />
        </div>
        <div className="resource-metric resource-metric-memory flex min-w-0 flex-col gap-1.5 px-3 py-3">
          <div className="resource-metric-heading"><span>Memory</span><span className="resource-metric-value">{state.host.usedMemoryGb.toFixed(1)}<span className="resource-metric-unit"> / {Math.round(state.host.totalMemoryGb)} GB</span></span></div>
          <Sparkline className="h-7" label="Recent memory usage" values={state.host.memoryHistory} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 px-3 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-muted-foreground" title="Space on the drive where Yougori stores environments, not the combined space of all drives.">Storage{state.host.storageDrive ? ` · ${state.host.storageDrive.replace(/[\\/]+$/, "") || "/"}` : ""}</span>
            <span className="truncate text-sm font-medium tabular-nums tracking-[-0.015em]">{state.host.totalStorageGb > 0 ? `${formatBytesFromGb(Math.max(0, state.host.totalStorageGb - state.host.usedStorageGb))} free` : "Unavailable"}</span>
          </div>
          <p className="truncate text-[11px] text-muted-foreground" title="Usage includes other files on the Yougori drive. Virtual disk capacity is a limit, not space reserved upfront.">{state.host.totalStorageGb > 0 ? `${formatBytesFromGb(state.host.usedStorageGb)} used · ${formatBytesFromGb(state.host.totalStorageGb)} total` : "Could not read the Yougori drive"}</p>
          <Button size="xs" variant="secondary" className="w-fit" disabled={reclaiming} aria-busy={reclaiming} onClick={() => void reclaim()} title="Return unused disk blocks to your computer. Keeps images, snapshots and backups. Stop containers first for full compaction.">{reclaiming ? "Reclaiming space…" : "Reclaim space"}</Button>
        </div>
      </section>
      </div>

      <section aria-label="Environment graph">
        <EnvironmentGraph connections={state.connections} environments={environments} errorContainer={graphErrorContainer} onConnect={openConnection} onOpen={onOpenEnvironment} onSelect={onSelectEnvironment} />
      </section>

      {connectionMounted ? (
        <Suspense fallback={null}>
          <ConnectionDialog initialSourceId={connectionSourceId} initialTargetId={connectionTargetId} onOpenChange={setConnectionOpen} open={connectionOpen} />
        </Suspense>
      ) : null}
    </div>
  )
}
