import { useRef, useState } from "react"
import { cloudApi, type CloudProfile, type CloudHostKey } from "@/api/cloud-api"
import { usePlatform } from "@/context/platform-context"
import { Button } from "@/components/ui/button"
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription, DialogPanel, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const empty: CloudProfile = { name: "", vendor: "aws", host: "", port: 22, username: "ubuntu", identityFile: "", hostKey: "" }
export function CloudEnvironmentDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { addCloudEnvironment } = usePlatform()
  const [profile, setProfile] = useState<CloudProfile>(empty)
  const [keys, setKeys] = useState<CloudHostKey[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const guard = useRef(false)
  const edit = (change: Partial<CloudProfile>) => { setProfile(p => ({ ...p, ...change, ...("host" in change || "port" in change ? { hostKey: "" } : {}) })); if ("host" in change || "port" in change) setKeys([]); setError("") }
  const perform = async (operation: () => Promise<void>) => { if (guard.current) return; guard.current = true; setBusy(true); setError(""); try { await operation() } catch (e) { setError(String(e instanceof Error ? e.message : e)) } finally { guard.current = false; setBusy(false) } }
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value) }}>
    <DialogPopup className="w-[min(760px,calc(100vw-2rem))] max-w-none" closeProps={{ disabled: busy }}>
      <DialogHeader><DialogTitle className="text-base">Cloud environment</DialogTitle><DialogDescription>Connect an existing Linux server over SSH. Its power stays under your control.</DialogDescription></DialogHeader>
      <form className="contents" onSubmit={e => { e.preventDefault(); void perform(async () => { await addCloudEnvironment(profile); onOpenChange(false); setProfile(empty); setKeys([]) }) }}>
        <DialogPanel className="space-y-5">
          <fieldset disabled={busy} className="space-y-5">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Cloud provider">{([['aws', 'AWS EC2'], ['google', 'Google Compute Engine'], ['azure', 'Azure VM'], ['other', 'Other server']] as const).map(([value, label]) => <Button key={value} type="button" size="sm" variant={profile.vendor === value ? "default" : "outline"} aria-pressed={profile.vendor === value} onClick={() => edit({ vendor: value })}>{label}</Button>)}</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Label className="grid gap-2">Node name<Input autoFocus required minLength={2} maxLength={80} value={profile.name} onChange={e => edit({ name: e.target.value })} placeholder="Production database" /></Label>
              <Label className="grid gap-2">Server address<Input required value={profile.host} onChange={e => edit({ host: e.target.value.trim() })} placeholder="IP address or hostname" spellCheck={false} /></Label>
              <Label className="grid gap-2">SSH username<Input required value={profile.username} onChange={e => edit({ username: e.target.value })} autoComplete="off" spellCheck={false} /></Label>
              <Label className="grid gap-2">SSH port<Input required type="number" min={1} max={65535} value={profile.port} onChange={e => edit({ port: Number(e.target.value) })} /></Label>
            </div>
            <div className="space-y-2"><Label htmlFor="cloud-identity">SSH identity file</Label><div className="flex gap-2"><Input id="cloud-identity" required value={profile.identityFile} onChange={e => edit({ identityFile: e.target.value })} placeholder="Choose your .pem or SSH key" spellCheck={false} /><Button type="button" variant="outline" onClick={() => void perform(async () => { const path = await cloudApi.selectKey(); if (path) edit({ identityFile: path }) })}>Browse</Button></div><p className="text-xs text-muted-foreground">Your private key stays on this PC. Unlock encrypted keys in your SSH agent first. Requires OpenSSH here and Python 3 on the server.</p></div>
            <section className="space-y-3 border-t pt-4" aria-label="Verify server identity"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">Server identity</p><Button disabled={!profile.host || !profile.port || busy} type="button" variant="outline" size="sm" loading={busy && !profile.hostKey} onClick={() => void perform(async () => { setKeys([]); edit({ hostKey: "" }); setKeys(await cloudApi.scan(profile.host, profile.port)) })}>Check identity</Button></div>
              <p className="text-xs text-muted-foreground">Compare the fingerprint with your server administrator or cloud console before trusting it. A changed key will block reconnection.</p>
              {keys.map(key => <Label key={key.key} className="flex items-start gap-2 rounded-md border p-3"><input type="radio" name="cloud-host-key" checked={profile.hostKey === key.key} onChange={() => edit({ hostKey: key.key })} /><span className="min-w-0 text-xs">Trust this server key<span className="mt-1 block break-all font-mono text-muted-foreground">{key.fingerprint}</span></span></Label>)}
            </section>
          </fieldset>
          <p className="text-xs leading-relaxed text-muted-foreground">Private connections to your local nodes and selected shared data only. Local network and Public access are unavailable for cloud nodes. Nothing is installed as a background service.</p>
          {error ? <p role="alert" className="text-sm text-destructive whitespace-pre-wrap">{error}</p> : null}
        </DialogPanel>
        <DialogFooter><Button disabled={busy} type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={busy || !profile.hostKey} loading={busy && Boolean(profile.hostKey)}>Add cloud node</Button></DialogFooter>
      </form>
    </DialogPopup>
  </Dialog>
}
