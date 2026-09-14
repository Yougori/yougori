import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { workspaceApi, type EnvironmentServices, type PublicationKind } from "@/api/workspace-api"
import type { Environment } from "@/types/platform"
import type { GraphEnvironment } from "@/components/graph-capabilities"
import { isWebsiteTour, tourPortAdded } from "@/lib/instructions-tour"
import { accountRequest, savedCloudflareDraft } from "@/lib/cloudflare-account"

export type WorkspaceDialog = { environmentId: string; type: "shares" } | { environmentId: string; type: "service"; port: number; kind?: PublicationKind; error?: string; account?: boolean }
const empty: EnvironmentServices = { services: [], shares: [], publications: [], notice: "" }
const manualKey = "opendock.manual-ports.v1"
function loadManual(): Record<string, number[]> {
  try {
    const value = JSON.parse(localStorage.getItem(manualKey) ?? "{}")
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number[]] => Array.isArray(entry[1]) && entry[1].every(port => Number.isInteger(port) && port > 0 && port < 65536 && port !== 7443)))
  } catch { return {} }
}

export function useWorkspaceFeatures(environments: Environment[]) {
  const [features, setFeatures] = useState<Record<string, EnvironmentServices>>({})
  const [manual, setManual] = useState(loadManual)
  const [dialog, setDialog] = useState<WorkspaceDialog | null>(null)
  const environmentKey = JSON.stringify(environments.map(env => env.id).sort())
  useEffect(() => {
    let active = true
    let revision = 0
    let unlisten: (() => void) | undefined
    void (async () => {
      if ("__TAURI_INTERNALS__" in window) {
        const { listen } = await import("@tauri-apps/api/event")
        const stop = await listen<Record<string, number[]>>("opendock-service-ports", ({ payload }) => { revision++; if (active) setManual(payload) })
        if (!active) { stop(); return }
        unlisten = stop
      }
      let ports = await workspaceApi.manualPorts()
      // One-time, additive migration: retain old graph declarations, never
      // overwrite a concurrent CLI change with an old localStorage snapshot.
      const ids: string[] = JSON.parse(environmentKey)
      const remaining = loadManual()
      for (const [id, legacy] of Object.entries(remaining)) {
        if (!ids.includes(id)) continue
        for (const port of legacy) if (!ports[id]?.includes(port)) ports = await workspaceApi.setManualPort(id, port, true)
        delete remaining[id]
      }
      const before = revision
      ports = await workspaceApi.manualPorts()
      if (active) {
        if (before === revision) setManual(ports)
        if (Object.keys(remaining).length) localStorage.setItem(manualKey, JSON.stringify(remaining))
        else localStorage.removeItem(manualKey)
      }
    })().catch(() => { /* Keep legacy declarations available; retry on next graph load. */ })
    return () => { active = false; unlisten?.() }
  }, [environmentKey])
  const revisions = useRef(new Map<string, number>())
  const runningKey = JSON.stringify(environments.filter(env => env.status === "running" && env.kind !== "computerBranch").map(env => env.id).sort())
  const refresh = useCallback(async (id: string) => {
    const revision = (revisions.current.get(id) ?? 0) + 1
    revisions.current.set(id, revision)
    let data: EnvironmentServices
    try { data = await workspaceApi.services(id) }
    catch (error) { data = { ...empty, notice: error instanceof Error ? error.message : String(error) } }
    if (revisions.current.get(id) === revision) setFeatures(current => JSON.stringify(current[id]) === JSON.stringify(data) ? current : { ...current, [id]: data })
  }, [])
  useEffect(() => {
    let disposed = false, timer = 0
    const currentRevisions = revisions.current
    const ids: string[] = JSON.parse(runningKey)
    const poll = async () => {
      // Limit concurrent requests for large environment lists. Never overlap polling rounds.
      for (let i = 0; i < ids.length && !disposed; i += 4) await Promise.all(ids.slice(i, i + 4).map(refresh))
      if (!disposed && ids.length) timer = window.setTimeout(() => void poll(), document.hidden ? 20000 : 5000)
    }
    void poll()
    return () => { disposed = true; window.clearTimeout(timer); ids.forEach(id => currentRevisions.set(id, (currentRevisions.get(id) ?? 0) + 1)) }
  }, [refresh, runningKey])
  const decorated = useMemo<GraphEnvironment[]>(() => environments.map(env => {
    const data = env.status === "running" ? features[env.id] ?? empty : empty
    const services = new Map(data.services.map(service => [service.port, service]))
    for (const port of [...(manual[env.id] ?? []), ...data.publications.map(p => p.port)]) {
      if (!services.has(port)) services.set(port, { port, name: "Manual port", protocol: "tcp", address: "" })
    }
    return { ...env, workspace: { ...data, services: [...services.values()].sort((a, b) => a.port - b.port) } }
  }), [environments, features, manual])
  const openShares = useCallback((environmentId: string) => setDialog({ type: "shares", environmentId }), [])
  const openService = useCallback((environmentId: string, port: number, kind?: PublicationKind) => setDialog({ type: "service", environmentId, port, kind }), [])
  const publicationLocks = useRef(new Set<string>())
  const connectPublication = useCallback(async (environmentId: string, port: number, kind: PublicationKind) => {
    if (kind === "local" || isWebsiteTour(environmentId, "demo-publish")) { openService(environmentId, port, kind); return }
    const key = `${environmentId}:${port}`
    if (publicationLocks.current.has(key)) return
    publicationLocks.current.add(key)
    try {
      const saved = savedCloudflareDraft(await workspaceApi.savedCloudflare(environmentId, port))
      if (!saved) { openService(environmentId, port, "cloudflare"); return }
      const account = accountRequest(saved)
      await workspaceApi.publish(environmentId, port, "cloudflare", account.hostPort, account.options)
    } catch (error) {
      // Keep account mode on failure. Never silently switch to an anonymous link.
      setDialog({ type: "service", environmentId, port, kind: "cloudflare", account: true, error: error instanceof Error ? error.message : String(error) })
    } finally {
      await refresh(environmentId)
      publicationLocks.current.delete(key)
    }
  }, [openService, refresh])
  const addPort = async (environmentId: string, port: number) => {
    setManual(await workspaceApi.setManualPort(environmentId, port, true))
    openService(environmentId, port)
    tourPortAdded(environmentId, port)
  }
  const removePort = async (environmentId: string, port: number) => {
    setManual(await workspaceApi.setManualPort(environmentId, port, false))
    await refresh(environmentId)
    setDialog(null)
  }
  return { decorated, dialog, setDialog, refresh, openShares, openService, connectPublication, addPort, removePort, manual }
}
