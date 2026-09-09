import { useEffect, useState } from "react"
import type { Environment } from "@/types/platform"
import { usePlatform } from "@/context/platform-context"
import { cloudApi, type CloudProfile } from "@/api/cloud-api"
import { Button } from "@/components/ui/button"
import { Sheet, SheetPopup, SheetHeader, SheetTitle, SheetDescription, SheetPanel, SheetFooter } from "@/components/ui/sheet"
import { AlertDialog, AlertDialogPopup, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "@/components/ui/alert-dialog"
import { environmentActionLabel } from "@/lib/environment-actions"

export function CloudEnvironmentDetails({ environment, onOpenChange, onOpenEnvironment }: { environment: Environment; onOpenChange(open: boolean): void; onOpenEnvironment(id: string): void }) {
  const { state, environmentActions, setEnvironmentStatus, deleteEnvironment, setConnectionActive, deleteConnection } = usePlatform()
  const [profile, setProfile] = useState<CloudProfile | null>(null)
  const [error, setError] = useState("")
  const [remove, setRemove] = useState(false)
  const [working, setWorking] = useState(false)
  useEffect(() => { let alive = true; void cloudApi.details(environment.id).then(d => { if (alive) setProfile(d.profile) }).catch(e => { if (alive) setError(String(e)) }); return () => { alive = false } }, [environment.id])
  const action = environmentActions[environment.id], busy = working || Boolean(action), connected = environment.status === "running"
  const links = state?.connections.filter(c => c.sourceId === environment.id || c.targetId === environment.id) ?? []
  const perform = async (operation: () => Promise<unknown>) => { if (busy) return; setWorking(true); setError(""); try { await operation() } catch (e) { setError(String(e instanceof Error ? e.message : e)) } finally { setWorking(false) } }
  return <>
    <Sheet open onOpenChange={open => { if (!busy) onOpenChange(open) }}><SheetPopup side="right" className="w-full max-w-[560px]" closeProps={{ disabled: busy }}>
      <SheetHeader><SheetTitle className="text-base">{environment.name}</SheetTitle><SheetDescription>Cloud environment · {connected ? "Connected" : "Disconnected"}</SheetDescription></SheetHeader>
      <SheetPanel className="space-y-6">
        <section className="space-y-2"><h3 className="text-sm font-medium">SSH connection</h3><p className="break-all text-sm">{environment.runtime}</p><p className="break-all text-xs text-muted-foreground">{profile?.identityFile}</p><p className="text-xs text-muted-foreground">Disconnect closes SSH and these terminals. Your server and its independently running applications stay on.</p></section>
        {environment.lastError || error ? <p role="alert" className="whitespace-pre-wrap break-words text-sm text-destructive">{error || environment.lastError}</p> : null}
        {connected ? <section className="space-y-2"><h3 className="text-sm font-medium">Private access from the cloud terminal</h3><p className="text-xs leading-relaxed text-muted-foreground">Use <code>$OPENDOCK_SOCKS_PROXY</code> for connected nodes' TCP ports and <code>$OPENDOCK_SHARED_FILES</code> for the shared-files browser/API. Skills contains each connection's addresses and permissions.</p></section> : null}
        <section className="space-y-3"><h3 className="text-sm font-medium">Connected nodes</h3>{links.length ? links.map(c => { const peer = state?.environments.find(e => e.id === (c.sourceId === environment.id ? c.targetId : c.sourceId)); return <div key={c.id} className="rounded-md border p-3 text-xs space-y-2"><p className="font-medium">{peer?.name ?? "Removed node"} · {c.direction === "bidirectional" ? "Both directions" : "One way"}</p><p className="text-muted-foreground">{c.permissions.join(", ")}{c.ports.length ? ` · TCP ${c.ports.join(", ")}` : ""} · {c.active ? c.enforcementStatus : "Disabled"}</p>{c.lastError ? <p className="text-destructive">{c.lastError}</p> : null}<div className="flex gap-2"><Button size="xs" variant="outline" disabled={busy} onClick={() => void perform(() => setConnectionActive(c.id, !c.active))}>{c.active ? "Disconnect link" : "Reconnect link"}</Button><Button size="xs" variant="ghost" disabled={busy} onClick={() => void perform(() => deleteConnection(c.id))}>Remove link</Button></div></div> }) : <p className="text-xs text-muted-foreground">Use the node's left or right connection point to connect a local node.</p>}</section>
        <p className="border-t pt-4 text-xs text-muted-foreground">Local network and Public access are blocked. Resources, snapshots and power are managed outside Yougori. Removing this node never deletes the remote server or its files.</p>
      </SheetPanel>
      <SheetFooter><Button variant="ghost" disabled={busy} onClick={() => setRemove(true)}>Remove node</Button>{connected ? <Button variant="outline" disabled={busy} loading={action === "disconnecting"} onClick={() => void perform(() => setEnvironmentStatus(environment.id, "stopped"))}>Disconnect</Button> : null}<Button disabled={busy} loading={action === "connecting" || action === "opening"} onClick={() => onOpenEnvironment(environment.id)}>{action ? environmentActionLabel[action] : connected ? "Open" : "Connect"}</Button></SheetFooter>
    </SheetPopup></Sheet>
    <AlertDialog open={remove} onOpenChange={value => { if (!busy) setRemove(value) }}><AlertDialogPopup><AlertDialogHeader><AlertDialogTitle>Remove cloud node?</AlertDialogTitle><AlertDialogDescription>This removes its Yougori connections only. The remote server and its data are not deleted.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><Button variant="outline" disabled={busy} onClick={() => setRemove(false)}>Cancel</Button><Button variant="destructive" loading={action === "deleting"} disabled={busy} onClick={() => void perform(async () => { await deleteEnvironment(environment.id); onOpenChange(false) })}>Remove node</Button></AlertDialogFooter></AlertDialogPopup></AlertDialog>
  </>
}
