import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { workspaceApi, type SavedCloudflareAccount } from "@/api/workspace-api"
import { savedCloudflareDraft, type CloudflareDraft } from "@/lib/cloudflare-account"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Radio, RadioGroup } from "@/components/ui/radio-group"

export function CloudflareAccountFields({ environmentId, port, value, onChange, onLoadingChange, busy, perform, refreshKey }: {
  environmentId: string; port: number; value: CloudflareDraft; onChange: Dispatch<SetStateAction<CloudflareDraft>>; onLoadingChange(loading: boolean): void; busy: boolean; perform(action: () => Promise<unknown>): Promise<void>; refreshKey: string
}) {
  const [saved, setSaved] = useState<SavedCloudflareAccount | null>(null)
  const [loadError, setLoadError] = useState("")
  const [revision, setRevision] = useState(0)
  const restored = useRef(false)
  useEffect(() => {
    let disposed = false
    onLoadingChange(true)
    void workspaceApi.savedCloudflare(environmentId, port).then(result => {
      if (disposed) return
      const draft = savedCloudflareDraft(result)
      setSaved(result); setLoadError("")
      if (!restored.current) {
        restored.current = true
        if (draft) onChange(current => current.hostname || current.localPort || current.token ? current : draft)
      }
    }).catch(() => { if (!disposed) setLoadError("Could not read saved credentials. You can paste a token for this session or retry.") })
      .finally(() => { if (!disposed) onLoadingChange(false) })
    return () => { disposed = true }
  }, [environmentId, port, revision, onChange, onLoadingChange, refreshKey])
  const origin = /^\d+$/.test(value.localPort) && Number(value.localPort) > 0 && Number(value.localPort) <= 65535 ? `http://127.0.0.1:${Number(value.localPort)}` : "http://127.0.0.1:<local tunnel port>"
  return <section aria-label="Cloudflare account options" className="flex flex-col gap-3 rounded-lg border p-3">
    <RadioGroup aria-label="Cloudflare account mode" className="flex flex-col gap-2" disabled={busy} value={value.mode} onValueChange={mode => onChange(current => ({ ...current, mode: mode === "account" ? "account" : "quick", token: "", routesReviewed: false }))}>
      <Label className="flex items-center gap-2 text-sm"><Radio value="quick" />Quick link — no account</Label>
      <Label className="flex items-center gap-2 text-sm"><Radio value="account" />Use my Cloudflare account (optional)</Label>
    </RadioGroup>
    {value.mode === "account" ? <>
      <p className="text-xs text-muted-foreground">Works with free and paid Cloudflare accounts. Sign in on Cloudflare, then authenticate this connector using a dedicated tunnel token. Yougori never needs your Cloudflare password.</p>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void perform(() => workspaceApi.openUrl("https://dash.cloudflare.com/"))}>Cloudflare login / dashboard</Button><Button type="button" size="sm" variant="link" disabled={busy} onClick={() => void perform(() => workspaceApi.openUrl("https://developers.cloudflare.com/tunnel/advanced/tunnel-tokens/"))}>Where to get the token</Button></div>
      <Field><FieldLabel>Public hostname</FieldLabel><Input type="text" placeholder="app.example.com" autoComplete="off" spellCheck={false} maxLength={253} disabled={busy} value={value.hostname} onChange={event => onChange(current => ({ ...current, hostname: event.target.value, routesReviewed: false }))} /><FieldDescription>A hostname on a domain you manage in Cloudflare, not a trycloudflare.com link.</FieldDescription></Field>
      <Field><FieldLabel>Local tunnel port</FieldLabel><Input type="text" inputMode="numeric" placeholder="45000" maxLength={5} disabled={busy} value={value.localPort} onChange={event => onChange(current => ({ ...current, localPort: event.target.value, routesReviewed: false }))} /><FieldDescription>Choose an unused port on this PC. This is the local bridge port, not the port inside the environment.</FieldDescription></Field>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground"><p>In Cloudflare → Networking → Tunnels, create a dedicated cloudflared tunnel. Add your public hostname with this HTTP Service URL:</p><code className="break-all text-foreground" aria-label="Cloudflare service URL">{origin}</code><p>Copy only the token from its installation command. Do not run that command—Yougori starts and stops the connector for you.</p></div>
      <Field><FieldLabel>Tunnel token</FieldLabel><Input type="password" autoComplete="new-password" spellCheck={false} maxLength={2048} placeholder={saved?.saved ? "Saved securely — leave empty to reuse" : "Paste the eyJ… token only"} disabled={busy} value={value.token} onChange={event => onChange(current => ({ ...current, token: event.target.value, routesReviewed: false }))} /><FieldDescription>{saved?.saved ? "A saved token is available for this environment and port. It is never sent back to this form." : "Leave Remember unchecked to use the token for this connection only."}</FieldDescription></Field>
      <Label className="flex items-center gap-2 text-xs"><Checkbox disabled={busy} checked={value.remember} onCheckedChange={checked => onChange(current => ({ ...current, remember: checked === true }))} />Remember for this node and port</Label>
      <p className="text-xs text-muted-foreground">Saves the hostname, local tunnel port, and token securely on this PC after connecting. Next time you connect this port to Public access, Yougori reuses them without opening setup.</p>
      {saved?.saved ? <Button type="button" size="sm" variant="ghost" className="self-start" disabled={busy} onClick={() => void perform(async () => { await workspaceApi.forgetCloudflare(environmentId, port); setSaved({ saved: false, hostname: "", hostPort: null }); onChange(current => ({ ...current, token: "", remember: false, routesReviewed: false })) })}>Forget saved token</Button> : null}
      {loadError ? <div className="flex flex-col gap-1"><p role="alert" className="text-xs text-destructive-foreground">{loadError}</p><Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => setRevision(current => current + 1)}>Retry credential lookup</Button></div> : null}
      <p className="text-xs text-muted-foreground">Use a dedicated tunnel with only this service’s route. Other dashboard routes could expose other host services; Yougori does not verify or edit those routes. Do not run replicas pointing to different services.</p>
      <Label className="flex items-start gap-2 text-xs"><Checkbox disabled={busy} checked={value.routesReviewed} onCheckedChange={checked => onChange(current => ({ ...current, routesReviewed: checked === true }))} />I reviewed this dedicated tunnel’s routes</Label>
      <p className="text-xs text-muted-foreground">Account authentication does not make visitors log in. Configure Cloudflare Access in your dashboard if you want visitor login. Disconnect stops this connector; forgetting a saved token does not stop an active connector or revoke it in Cloudflare.</p>
    </> : <p className="text-xs text-muted-foreground">The existing temporary public link. No account, token, domain, or paid plan is needed.</p>}
  </section>
}
