import { useState } from "react"
import { localBackupApi } from "@/api/local-backup-api"
import { Button } from "@/components/ui/button"
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogPanel, DialogFooter, DialogPopup, DialogTrigger } from "@/components/ui/dialog"
import { usePlatform } from "@/context/platform-context"
import type { Environment } from "@/types/platform"
import { CudaRuntimePanel } from "@/components/dialogs/cuda-runtime-panel"

export function LocalBackupDialog({ environment, triggerClassName }: { environment?: Environment; triggerClassName?: string }) {
  const { importLocalBackup } = usePlatform()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [path, setPath] = useState("")
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [targetProvider, setTargetProvider] = useState<"openDockCuda" | undefined>()
  const importing = !environment
  const supported = importing || (["openDockOci", "openDockCuda"].includes(environment.provider ?? "") && environment.kind === "container") || (environment.provider === "qemu" && (environment.kind === "fullVm" || (environment.kind === "microVm" && environment.runtime === "builtin:alpine")))
  const canExport = supported && (importing || environment.status === "stopped")
  const choose = async () => {
    setBusy(true); setError("")
    try { const selected = await localBackupApi.choose(importing); if (selected) { setPath(selected); setSaved("") } }
    catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const submit = async () => {
    if (busy || !path || !canExport) return
    setBusy(true); setError(""); setSaved("")
    try {
      if (environment) setSaved(await localBackupApi.export(environment.id, path))
      else { await importLocalBackup(path, targetProvider); setOpen(false) }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={value => { if (!busy) { setOpen(value); if (value) { setPath(""); setError(""); setSaved(""); setTargetProvider(undefined) } } }}>
    <DialogTrigger render={<Button data-tour={importing ? "load-backup" : undefined} className={triggerClassName} aria-label={importing ? "Load local backup" : "Back up to this PC"} title={importing ? "Load local backup" : "Back up to this PC"} size="sm" type="button" variant="outline" />}>
      <span>{importing ? "Load local backup" : "Back up to this PC"}</span>
    </DialogTrigger>
    <DialogPopup showCloseButton={!busy}>
      <DialogHeader><DialogTitle>{importing ? "Load a local backup" : `Back up ${environment.name}`}</DialogTitle><DialogDescription>{importing ? "Restore disk/files and settings into a new, stopped environment. Existing nodes are not overwritten." : "Save the environment’s disk/files and settings in a portable folder on your computer."}</DialogDescription></DialogHeader>
      <DialogPanel className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{importing ? "Choose backup.yougori inside the backup folder (older backup.opendock files also work). Keep disk.data beside it. Only load backups you trust: they contain executable applications." : "Keep the whole backup folder together. Backups are not encrypted and may contain passwords or other sensitive files inside the guest."}</p>
        <p className="text-xs text-muted-foreground">Shared PC folders, host credentials, public tunnels, terminal sessions, connection permissions, VM firmware settings and snapshot history are not included. Reconnect access after restoring.</p>
        {importing ? <div className="space-y-2"><p className="text-sm font-medium">Restore engine</p><div className="flex gap-2" role="group" aria-label="Restore engine">
          <Button type="button" size="sm" variant={targetProvider ? "outline" : "secondary"} disabled={busy} aria-pressed={!targetProvider} onClick={() => setTargetProvider(undefined)}>Keep original</Button>
          <Button type="button" size="sm" variant={targetProvider ? "secondary" : "outline"} disabled={busy} aria-pressed={Boolean(targetProvider)} onClick={() => setTargetProvider("openDockCuda")}>NVIDIA CUDA · containers</Button>
        </div>{targetProvider ? <><p className="text-xs text-muted-foreground">Copies a container backup into the GPU category (NVIDIA CUDA). The original and backup stay untouched. Enable GPU access in the new node's settings after restoring; other permissions remain disconnected. This does not convert VM disks, Windows apps or incompatible Linux libraries.</p><CudaRuntimePanel /></> : null}</div> : null}
        {!supported ? <p role="alert" className="text-sm">Portable backups for native branches and custom microVMs are not supported yet.</p> : !canExport ? <p role="alert" className="text-sm">Stop this environment before backing it up. This prevents an inconsistent disk copy.</p> : null}
        <Button disabled={busy || !canExport} onClick={() => void choose()} type="button" variant="outline">{importing ? "Choose backup file" : "Choose destination folder"}</Button>
        {path ? <p className="break-all text-xs text-muted-foreground">{path}</p> : null}
        {error ? <p role="alert" className="break-words text-sm text-destructive-foreground">{error}</p> : null}
        {saved ? <p role="status" className="break-all text-sm">Backup saved and verified: {saved}</p> : null}
        {busy ? <p role="status" className="text-sm text-muted-foreground">Working… Large disks can take several minutes. Keep Yougori open.</p> : null}
      </DialogPanel>
      <DialogFooter><Button disabled={busy} onClick={() => setOpen(false)} type="button" variant="ghost">{saved ? "Done" : "Cancel"}</Button><Button disabled={!path || !canExport || Boolean(saved)} loading={busy} onClick={() => void submit()} type="button">{importing ? "Restore as new environment" : "Create local backup"}</Button></DialogFooter>
    </DialogPopup>
  </Dialog>
}
