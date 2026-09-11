import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { CopyIcon, FolderPlusIcon, XIcon } from "lucide-react"
import { workspaceApi } from "@/api/workspace-api"
import { publicationDefinitions, publicationDestination, publicationDestinations } from "@/components/graph-capabilities"
import type { useWorkspaceFeatures, WorkspaceDialog } from "@/components/use-workspace-features"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Radio, RadioGroup } from "@/components/ui/radio-group"
import { CloudflareAccountFields } from "@/components/cloudflare-account-fields"
import { accountRequest, emptyCloudflareDraft } from "@/lib/cloudflare-account"
import { changeTour, getTour, isWebsiteTour, ownsTour, tourWebsiteOpened, tourWebsitePublished, useInstructionsTour } from "@/lib/instructions-tour"
import { platformApi } from "@/api/platform-api"

const AddServicePortDialog = lazy(async () => ({ default: (await import("@/components/dialogs/add-service-port-dialog")).AddServicePortDialog }))

type Model = ReturnType<typeof useWorkspaceFeatures>
export function GraphWorkspaceDialogs({ model }: { model: Model }) {
  const [busy, setBusy] = useState(false)
  const tour = useInstructionsTour()
  const guided = Boolean(ownsTour(tour) && tour?.environmentId === model.dialog?.environmentId && (tour?.step.startsWith("demo-") || tour?.step === "done"))
  return <Dialog modal={!guided} disablePointerDismissal={guided} open={Boolean(model.dialog)} onOpenChange={(open, details) => {
    // A publication or writable share must not finish invisibly after dismissal.
    if (!open && busy) { details.cancel(); return }
    const guideEvent = details.event.target instanceof Element && details.event.target.closest('[data-tour-ui]')
    if (!open && (guideEvent || (guided && details.reason === "focus-out"))) { details.cancel(); return }
    if (!open) {
      model.setDialog(null)
      if (guided && model.dialog && isWebsiteTour(model.dialog.environmentId, "demo-port-add", "demo-publish", "demo-link")) changeTour({ step: "demo-port-open" })
    }
  }}>
    {model.dialog?.type === "service" && !model.dialog.port
      ? <Suspense fallback={null}><AddServicePortDialog key={model.dialog.environmentId} environment={model.decorated.find(item => item.id === model.dialog?.environmentId)} onBusyChange={setBusy} onAddPort={port => { if (model.dialog) return model.addPort(model.dialog.environmentId, port) }} /></Suspense>
      : model.dialog ? <WorkspaceDialogContent dialog={model.dialog} key={`${model.dialog.environmentId}:${model.dialog.type}:${model.dialog.type === "service" ? model.dialog.port : ""}`} model={model} onBusyChange={setBusy} /> : null}
  </Dialog>
}

function WorkspaceDialogContent({ dialog, model, onBusyChange }: { dialog: WorkspaceDialog; model: Model; onBusyChange(busy: boolean): void }) {
  const env = model.decorated.find(item => item.id === dialog.environmentId)
  const [busy, setBusy] = useState(false)
  const operationLock = useRef(false)
  const [error, setError] = useState(dialog.type === "service" ? dialog.error ?? "" : "")
  const [writeAccess, setWriteAccess] = useState(false)
  const [folders, setFolders] = useState<string[]>([])
  const [hostPort, setHostPort] = useState("")
  const [cloudflare, setCloudflare] = useState(() => ({ ...emptyCloudflareDraft(), ...(dialog.type === "service" && dialog.account ? { mode: "account" as const } : {}) }))
  const [cloudflareLoading, setCloudflareLoading] = useState(true)
  const [kind, setKind] = useState<"local" | "cloudflare">(dialog.type === "service" && dialog.kind && dialog.kind !== "local" ? "cloudflare" : "local")
  const perform = async (action: () => Promise<unknown>) => {
    if (operationLock.current) return
    operationLock.current = true
    setError(""); setBusy(true); onBusyChange(true)
    try { await action() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally {
      // Reconcile even a partially completed multi-folder operation. A failed
      // refresh must not leave the dialog permanently busy or hide the first error.
      try { await model.refresh(dialog.environmentId) }
      catch (reason) { setError(current => current || (reason instanceof Error ? reason.message : String(reason))) }
      finally { operationLock.current = false; setBusy(false); onBusyChange(false) }
    }
  }
  const running = env?.status === "running"
  const port = dialog.type === "service" ? dialog.port : 0
  const publications = useMemo(() => env?.workspace?.publications.filter(p => p.port === port) ?? [], [env?.workspace?.publications, port])
  const tour = useInstructionsTour()
  useEffect(() => {
    for (const publication of publications) tourWebsitePublished(dialog.environmentId, publication)
  }, [dialog.environmentId, publications, tour?.step])
  const validPort = (value: string) => /^\d+$/.test(value) && Number(value) > 0 && Number(value) < 65536 && Number(value) !== 7443
  const copy = (value: string) => void perform(() => navigator.clipboard.writeText(value))

  return <DialogPopup closeProps={{ disabled: busy }} data-service-options={dialog.type === "service" ? dialog.environmentId : undefined} data-service-port={port}>
    <DialogHeader>
      <DialogTitle>{dialog.type === "shares" ? "My PC" : port ? `Port ${port}` : "Add a service port"} · {env?.name ?? "Environment"}</DialogTitle>
      <DialogDescription>{dialog.type === "shares" ? "Only the folders you choose are shared. Disconnecting revokes access; stopping the environment removes its shares." : "Connect this TCP port to one or several destinations. Publishing stops when the environment stops or Yougori closes."}</DialogDescription>
    </DialogHeader>
    <DialogPanel className="flex flex-col gap-4">
      {!running ? <p className="text-sm text-muted-foreground">Start this environment to share files or publish services.</p> : null}
      {error ? <p className="text-sm text-destructive-foreground" role="alert">{error}</p> : null}
      {dialog.type === "shares" ? <>
        {env?.kind === "fullVm" ? <p className="text-xs text-muted-foreground">This desktop VM has no file-sharing agent. Open the private folder URL in its browser, or mount it as read-only WebDAV. Containers and managed microVMs mount folders automatically.</p> : null}
        {env?.workspace?.shares.map(share => <div className="space-y-1 rounded-lg border p-3 text-xs" key={share.id}>
          <div className="flex items-center gap-2"><span className="min-w-0 flex-1 break-all font-medium">{share.path}</span><span className="shrink-0 text-muted-foreground">{share.readOnly ? "Read only" : "Read / write"}</span><Button aria-label={`Disconnect ${share.path}`} disabled={busy} onClick={() => void perform(() => workspaceApi.unshare(share.id))} size="icon-xs" variant="ghost"><XIcon aria-hidden="true" /></Button></div>
          <div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all text-muted-foreground">{share.mountPath ?? share.guestUrl}</code><Button aria-label="Copy guest folder location" disabled={busy} onClick={() => copy(share.mountPath ?? share.guestUrl)} size="icon-xs" variant="ghost"><CopyIcon aria-hidden="true" /></Button></div>
          {!share.mountPath ? <p className="text-muted-foreground">Keep this URL private. It grants access to the selected folder while connected.</p> : null}
        </div>)}
        {folders.length ? <div className="space-y-2 rounded-lg border p-3">{folders.map(folder => <div className="flex items-center gap-2 text-xs" key={folder}><span className="min-w-0 flex-1 break-all">{folder}</span><Button aria-label={`Remove selected ${folder}`} disabled={busy} onClick={() => setFolders(current => current.filter(p => p !== folder))} size="icon-xs" variant="ghost"><XIcon aria-hidden="true" /></Button></div>)}</div> : null}
        <Button disabled={!running || busy} onClick={() => void perform(async () => { const selected = await workspaceApi.chooseFolders(); setFolders(current => [...new Set([...current, ...selected])]) })} variant="outline"><FolderPlusIcon aria-hidden="true" />Choose folders</Button>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={writeAccess} disabled={busy || env?.kind === "fullVm"} onCheckedChange={checked => setWriteAccess(checked === true)} />Allow this environment to edit these folders</label>
        {writeAccess ? <p className="text-xs text-muted-foreground">Programs inside this environment can change or delete files in the selected folders.</p> : null}
        <Button disabled={!running || !folders.length} loading={busy} onClick={() => void perform(async () => {
          for (const folder of folders) { await workspaceApi.share(dialog.environmentId, folder, !writeAccess); setFolders(current => current.filter(p => p !== folder)) }
        })}>Connect selected folders</Button>
      </> : <>
        {env?.workspace?.notice ? <p className="text-xs text-muted-foreground">{env.workspace.notice}</p> : null}
        {publications.map(publication => <div className="space-y-2 rounded-lg border p-3" key={publication.id}>
          <div className="flex items-center gap-2 text-sm"><span className="flex-1 font-medium">{publicationDefinitions.find(item => item.kind === publication.kind)?.title}{publication.cloudflareAccount ? " · Your account" : ""}</span><span className="text-xs text-muted-foreground">{publication.status}</span><Button aria-label={`Disconnect ${publication.kind} from port ${port}`} disabled={busy} onClick={() => void perform(async () => { await workspaceApi.unpublish(publication.id); if (isWebsiteTour(dialog.environmentId, "demo-link")) { model.setDialog(null); changeTour({ step: "demo-port-open" }) } })} size="icon-xs" variant="ghost"><XIcon aria-hidden="true" /></Button></div>
          {publication.urls.map(url => <div className="flex items-center gap-2" key={url}><button disabled={busy} className="min-w-0 flex-1 break-all text-left text-xs text-primary underline" onClick={() => void perform(async () => { await workspaceApi.openUrl(url); tourWebsiteOpened(dialog.environmentId, port, publication.kind === "cloudflare" && !publication.cloudflareAccount) })} type="button">{url}</button><Button aria-label={`Copy ${url}`} disabled={busy} onClick={() => copy(url)} size="icon-xs" variant="ghost"><CopyIcon aria-hidden="true" /></Button></div>)}
          <p className="text-xs text-muted-foreground">{publication.message}</p>
        </div>)}
        <fieldset className="flex flex-col gap-2"><legend className="mb-2 text-sm font-medium">Publish to</legend><RadioGroup aria-label="Publish to" className="flex flex-wrap gap-3" disabled={busy} onValueChange={value => setKind(value === "local" ? "local" : "cloudflare")} value={publicationDestination(kind)}>{publicationDestinations.map(item => <label className="flex items-center gap-1.5 text-xs" key={item.kind}><Radio value={item.kind} />{item.title}</label>)}</RadioGroup></fieldset>
        <p className="text-xs text-muted-foreground">{kind === "cloudflare" ? "Publishes through Cloudflare. The verified tunnel helper downloads on first use. Public services are accessible to anyone unless you configure visitor access rules." : "Available from this PC, private-network devices, and Internet-enabled managed guests via the displayed host address. The listener rejects public source addresses."}</p>
        {kind === "cloudflare" ? <CloudflareAccountFields environmentId={dialog.environmentId} port={port} value={cloudflare} onChange={setCloudflare} onLoadingChange={setCloudflareLoading} busy={busy || cloudflareLoading} perform={perform} refreshKey={publications.filter(p => p.kind === "cloudflare").map(p => p.id).join(",")} /> : null}
        {kind !== "cloudflare" ? <Field><FieldLabel>Host port (optional)</FieldLabel><Input disabled={busy} inputMode="numeric" onChange={event => setHostPort(event.target.value)} placeholder="Choose an available port automatically" type="text" value={hostPort} /></Field> : null}
        <Button disabled={!running || (kind === "cloudflare" && cloudflareLoading) || publications.some(p => p.kind === kind)} loading={busy} onClick={() => void perform(async () => {
          const current = getTour()
          if (isWebsiteTour(dialog.environmentId, "demo-publish")) {
            if (port !== 3000 || kind !== "cloudflare" || cloudflare.mode !== "quick") throw new Error("For this tutorial, choose Public access / Cloudflare Tunnel and Quick link — no account. Nothing was published.")
            const { verifyHelloWebsite } = await import("@/lib/tour-website")
            await verifyHelloWebsite(platformApi.executeEnvironmentCommand, dialog.environmentId, current!.run)
            // Skip or closing the dialog during this read-only check cancels the
            // subsequent publication; it must not start invisibly afterwards.
            if (!isWebsiteTour(dialog.environmentId, "demo-publish") || getTour()?.run !== current?.run) return
          }
          if (hostPort && kind !== "cloudflare" && !validPort(hostPort)) throw new Error("Enter a valid host port or leave it empty.")
          const account = kind === "cloudflare" && cloudflare.mode === "account" ? accountRequest(cloudflare) : undefined
          const publication = await workspaceApi.publish(dialog.environmentId, port, kind, account?.hostPort ?? (kind === "cloudflare" || !hostPort ? undefined : Number(hostPort)), account?.options)
          tourWebsitePublished(dialog.environmentId, publication)
          setCloudflare(current => ({ ...current, token: "" }))
        })}>{kind === "local" ? "Connect local network" : "Publish service"}</Button>
        {busy ? <p className="text-xs text-muted-foreground" role="status">Connecting… The first Cloudflare download can take a few minutes.</p> : null}
        {model.manual[dialog.environmentId]?.includes(port) && !publications.length ? <Button disabled={busy} onClick={() => void perform(() => model.removePort(dialog.environmentId, port))} variant="ghost">Remove manual port</Button> : null}
      </>}
    </DialogPanel>
    <DialogFooter><DialogClose render={<Button disabled={busy} type="button" variant="ghost" />}>Done</DialogClose></DialogFooter>
  </DialogPopup>
}
