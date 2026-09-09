import { useEffect, useRef, useState } from "react"
import { CheckIcon, CopyIcon, RefreshCwIcon } from "lucide-react"
import { platformApi } from "@/api/platform-api"
import { terminalClipboard } from "@/lib/terminal-clipboard"
import { Button } from "@/components/ui/button"
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogPopup, DialogPanel, DialogFooter } from "@/components/ui/dialog"
import { usePlatform } from "@/context/platform-context"
import { nodeConnections } from "@/lib/environment-connections"
import { readSkillSnapshot, type SkillSnapshot } from "@/lib/connection-skills"
import { environmentKindLabel, statusLabel } from "@/lib/domain"

export function ConnectionSkillsDialog({ environmentId }: { environmentId: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [copying, setCopying] = useState(false)
  const [copied, setCopied] = useState(false)
  const [snapshot, setSnapshot] = useState<SkillSnapshot | null>(null)
  const [refresh, setRefresh] = useState(0)
  const generation = useRef(0)
  const requestSequence = useRef(0)
  const copyingRef = useRef(false)
  const { state } = usePlatform()
  const connections = nodeConnections(environmentId, state?.connections ?? [])
  const ids = new Set([environmentId, ...connections.flatMap(c => [c.sourceId, c.targetId])])
  // Host metrics update frequently; only access/state changes need a new skill.
  const revision = JSON.stringify([connections, state?.environments.filter(e => ids.has(e.id)).map(e => [e.id, e.name, e.kind, e.status, e.runtime, e.runtimeId])])
  useEffect(() => {
    if (!open) return
    const current = ++generation.current
    let inFlight = false
    setCopied(false); setCopying(false); copyingRef.current = false
    const load = async () => {
      if (inFlight || copyingRef.current) return
      const request = ++requestSequence.current
      inFlight = true; setLoading(true); setError("")
      try {
        const value = await platformApi.connectionSkills(environmentId)
        if (current !== generation.current || request !== requestSequence.current) return
        const data = readSkillSnapshot(value)
        setText(value); setSnapshot(data); setCopied(false)
      } catch (reason) { if (current === generation.current && request === requestSequence.current) setError(`Could not refresh Skills. The displayed snapshot may be out of date: ${String(reason)}`) }
      finally { inFlight = false; if (current === generation.current) setLoading(false) }
    }
    void load()
    const timer = window.setInterval(() => void load(), 10000)
    return () => { generation.current = current + 1; window.clearInterval(timer) }
  }, [open, environmentId, revision, refresh])
  const copy = async () => {
    if (copyingRef.current || loading) return
    const current = generation.current
    const request = ++requestSequence.current
    copyingRef.current = true; setCopying(true); setCopied(false); setError("")
    try {
      // Fetch again: a peer/share may have changed since this dialog opened.
      const fresh = await platformApi.connectionSkills(environmentId)
      if (current !== generation.current || request !== requestSequence.current) return
      const data = readSkillSnapshot(fresh)
      setText(fresh); setSnapshot(data)
      await terminalClipboard.writeText(fresh)
      if (current === generation.current) setCopied(true)
    }
    catch (reason) { if (current === generation.current) setError(`Could not refresh or copy Skills. No cached instructions were copied. ${String(reason)}`) }
    finally { if (current === generation.current) { copyingRef.current = false; setCopying(false) } }
  }
  return <>
    <Button aria-label="Connection skills" title="Copy connection instructions for your AI agent" size="sm" variant="ghost" onClick={() => setOpen(true)} className="text-xs text-muted-foreground">Skills</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup className="max-w-4xl sm:max-w-4xl">
        <DialogHeader><DialogTitle>Connection skills</DialogTitle><DialogDescription>Every directly connected node, its access rules and what to do when it cannot be reached. My PC shares are included when attached.</DialogDescription></DialogHeader>
        <DialogPanel>
          {snapshot ? <>
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{snapshot.summary.connectedNodes} connected {snapshot.summary.connectedNodes === 1 ? "node" : "nodes"}</span>
              <span>{snapshot.summary.connections} links · {snapshot.summary.ready} ready · {snapshot.summary.blocked} unavailable</span>
              <span className="ml-auto">This node: {statusLabel[snapshot.sourceStatus]}</span>
            </div>
            <ul aria-label="Connected nodes" className="mb-3 max-h-52 overflow-y-auto divide-y border-y">
              {snapshot.connections.map(peer => <li key={peer.connectionId} className="py-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{peer.peerName}</span><span className="text-muted-foreground">{peer.peerKind ? environmentKindLabel[peer.peerKind] : "Missing node"} · {peer.peerStatus === "missing" ? "Missing" : statusLabel[peer.peerStatus]}</span><span className={peer.usableNow ? "ml-auto text-success-foreground" : "ml-auto text-destructive-foreground"}>{peer.usableNow ? "Connection ready" : "Unavailable"}</span></div>
                <p className="mt-1 text-muted-foreground">{peer.permissions.join(", ") || "No permissions"} · {peer.direction === "oneWay" ? "One-way" : "Both directions"}</p>
                {peer.issues.length ? peer.issues.map(item => <p key={`${item.code}-${item.nodeId ?? ""}`} className="mt-1 leading-relaxed"><span className="font-medium">{item.side === "source" ? "This node: " : item.side === "peer" ? "Connected node: " : ""}{item.explanation}</span> <span className="text-muted-foreground">{item.nextStep}</span></p>) : <p className="mt-1 text-muted-foreground">{peer.summary}</p>}
                {peer.limitations?.map(limit => <p key={limit} className="mt-1 text-muted-foreground">{limit}</p>)}
              </li>)}
            </ul>
          </> : null}
          <div className="mb-2 flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">Full AI instructions · status, files, My PC and error guide</span><Button aria-label="Refresh skills" size="xs" variant="ghost" loading={loading} disabled={copying} onClick={() => setRefresh(value => value + 1)}><RefreshCwIcon aria-hidden="true" />Refresh</Button></div>
          {loading && !text ? <p role="status" className="text-sm text-muted-foreground">Reading current connections…</p> : <textarea aria-label="AI agent connection instructions" readOnly value={text} className="h-[min(32vh,20rem)] w-full resize-none rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring" />}
          {error ? <p role="alert" className="mt-2 text-sm text-destructive-foreground">{error}</p> : null}
        </DialogPanel>
        <DialogFooter><p className="mr-auto text-xs text-muted-foreground">Copy refreshes the snapshot. Folder paths are included; contents and private tokens are not. No access is granted by copying.</p><Button disabled={!text || loading} loading={copying} onClick={() => void copy()}>{copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}{copied ? "Copied" : "Copy skills"}</Button></DialogFooter>
      </DialogPopup>
    </Dialog>
  </>
}
