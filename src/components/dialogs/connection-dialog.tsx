import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react"
import { ArrowLeftRightIcon, ArrowRightIcon, ContainerIcon, DatabaseIcon, FolderIcon, HardDriveIcon, KeyRoundIcon, Link2Icon, NetworkIcon, ShieldCheckIcon, WaypointsIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Form } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Radio, RadioGroup } from "@/components/ui/radio-group"
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select"
import { usePlatform } from "@/context/platform-context"
import { permissionLabel } from "@/lib/domain"
import { cn } from "@/lib/utils"
import type { ConnectionDirection, PermissionKind } from "@/types/platform"
import "./connection-dialog.css"
import { supportsConnections, supportsSharedConnection, connectionPermissions } from "@/lib/environment-connections"

const permissionDetails = {
  network: { icon: NetworkIcon, description: "Allow all network traffic between these environments." },
  ports: { icon: WaypointsIcon, description: "Allow only the TCP ports you specify." },
  files: { icon: FolderIcon, description: "Exchange files through a shared directory." },
  volumes: { icon: HardDriveIcon, description: "Attach a shared directory for this connection." },
  data: { icon: DatabaseIcon, description: "Exchange data through the shared directory." },
  secrets: { icon: KeyRoundIcon, description: "Attach a separate directory for shared secrets." },
} satisfies Record<PermissionKind, { icon: typeof NetworkIcon; description: string }>

export function ConnectionDialog({ open, onOpenChange, initialSourceId, initialTargetId }: {
  open: boolean
  onOpenChange(open: boolean): void
  initialSourceId?: string
  initialTargetId?: string
}) {
  const { state, createConnection } = usePlatform()
  const options = useMemo(() => state?.environments.filter(supportsConnections).map((environment) => ({ label: environment.name, value: environment.id })) ?? [], [state?.environments])
  const [sourceId, setSourceId] = useState("")
  const [targetId, setTargetId] = useState("")
  const [direction, setDirection] = useState<ConnectionDirection>("bidirectional")
  const [selectedPermissions, setSelectedPermissions] = useState<PermissionKind[]>(["files"])
  const [ports, setPorts] = useState("")
  const [volume, setVolume] = useState("")
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState("")
  const initialized = useRef<string | null>(null)
  const descriptionId = useId()
  const shared = supportsSharedConnection(state?.environments.find(e => e.id === sourceId), state?.environments.find(e => e.id === targetId))
  const permissions = connectionPermissions(shared)
  const cloud = state?.environments.some(e => (e.id === sourceId || e.id === targetId) && e.kind === "cloud")
  useEffect(() => {
    if (!shared) setSelectedPermissions(current => {
      const filtered = current.filter(p => p !== "secrets")
      return filtered.length === current.length ? current : filtered.length ? filtered : ["files"]
    })
  }, [shared])

  useEffect(() => {
    if (!open) { initialized.current = null; return }
    // Host telemetry and other windows may refresh the environment list while
    // this form is open. Initialize once per opening, never erase an active draft.
    const key = JSON.stringify([initialSourceId, initialTargetId])
    if (initialized.current === key) return
    initialized.current = key
    const source = options.find(item => item.value === initialSourceId)?.value ?? options[0]?.value ?? ""
    setSourceId(source)
    setTargetId(options.find(item => item.value === initialTargetId && item.value !== source)?.value ?? options.find(item => item.value !== source)?.value ?? "")
    setSelectedPermissions(["files"])
    setDirection("bidirectional")
    setPorts("")
    setVolume("")
    setFormError("")
  }, [initialSourceId, initialTargetId, open, options])

  const togglePermission = (permission: PermissionKind, checked: boolean) => {
    setSelectedPermissions((current) => checked ? [...new Set([...current, permission])] : current.filter((item) => item !== permission))
    setFormError("")
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    if (!sourceId || !targetId || sourceId === targetId) {
      setFormError("Choose two different environments.")
      return
    }
    if (!options.some(item => item.value === sourceId) || !options.some(item => item.value === targetId)) {
      setFormError("A selected environment is no longer available. Choose another environment.")
      return
    }
    if (!selectedPermissions.length) {
      setFormError("Select at least one permission.")
      return
    }
    const allowedPorts = selectedPermissions.includes("ports") ? ports.split(",").map(port => port.trim()).filter(Boolean) : []
    if (selectedPermissions.includes("ports") && !selectedPermissions.includes("network") && !allowedPorts.length) {
      setFormError("Enter at least one TCP port, or grant full network access instead.")
      return
    }
    if (allowedPorts.some(port => !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65_535)) {
      setFormError("TCP ports must be whole numbers between 1 and 65535, separated by commas.")
      return
    }
    const normalizedPorts = allowedPorts.map(port => String(Number(port)))
    if (new Set(normalizedPorts).size !== normalizedPorts.length) {
      setFormError("Each TCP port should only be listed once.")
      return
    }
    const sharedVolume = selectedPermissions.includes("volumes") ? volume.trim() : ""
    if (sharedVolume && !/^[a-zA-Z0-9_.-]{1,80}$/.test(sharedVolume)) {
      setFormError("Shared volume names may use up to 80 letters, numbers, dots, dashes, or underscores.")
      return
    }
    setSaving(true)
    setFormError("")
    try {
      await createConnection({
        sourceId,
        targetId,
        direction,
        permissions: selectedPermissions,
        ports: normalizedPorts,
        volume: sharedVolume || undefined,
      })
      onOpenChange(false)
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  if (!state) return null
  const sourceOption = options.find((item) => item.value === sourceId)
  const targetOption = options.find((item) => item.value === targetId)
  const hasNetwork = selectedPermissions.includes("network")
  const hasPorts = selectedPermissions.includes("ports")
  const hasStorage = selectedPermissions.some(permission => ["files", "volumes", "data"].includes(permission))
  const DirectionIcon = direction === "oneWay" ? ArrowRightIcon : ArrowLeftRightIcon

  return (
    <Dialog onOpenChange={value => { if (!saving) onOpenChange(value) }} open={open}>
      <DialogPopup bottomStickOnMobile={false} closeProps={{ disabled: saving }} className="connection-workbench max-h-[calc(100dvh-2rem)] max-w-[1040px] overflow-hidden sm:max-w-[1040px]">
        <DialogHeader className="connection-header">
          <Link2Icon aria-hidden="true" />
          <DialogTitle className="text-base leading-5">New connection</DialogTitle>
          <DialogDescription className="connection-subtitle">Private connections between containers, MicroVMs and VMs.</DialogDescription>
        </DialogHeader>
        <Form className="contents" onSubmit={submit}>
          <DialogPanel scrollFade={false} className="p-0!">
            <section aria-label="Connection endpoints" className="connection-route">
              <div className="connection-endpoints">
                <Field className="min-w-0">
                  <FieldLabel>From</FieldLabel>
                  <Select disabled={saving || !options.length} items={options} onValueChange={value => { setSourceId(value ?? ""); setFormError("") }} value={sourceId}>
                    <SelectTrigger className="connection-endpoint"><ContainerIcon aria-hidden="true" /><SelectValue placeholder="Choose source" /></SelectTrigger>
                    <SelectPopup alignItemWithTrigger={false} className="max-w-[calc(100vw-3rem)]">{options.map(item => <SelectItem disabled={item.value === targetId} key={item.value} value={item.value}><span className="truncate">{item.label}</span></SelectItem>)}</SelectPopup>
                  </Select>
                </Field>
                <Button aria-label="Swap source and destination" title="Swap source and destination" className="connection-swap" disabled={saving || !sourceId || !targetId} onClick={() => { setSourceId(targetId); setTargetId(sourceId); setFormError("") }} size="icon" type="button" variant="ghost"><DirectionIcon aria-hidden="true" /></Button>
                <Field className="min-w-0">
                  <FieldLabel>To</FieldLabel>
                  <Select disabled={saving || options.length < 2} items={options} onValueChange={value => { setTargetId(value ?? ""); setFormError("") }} value={targetId}>
                    <SelectTrigger className="connection-endpoint"><ContainerIcon aria-hidden="true" /><SelectValue placeholder="Choose destination" /></SelectTrigger>
                    <SelectPopup alignItemWithTrigger={false} className="max-w-[calc(100vw-3rem)]">{options.map(item => <SelectItem disabled={item.value === sourceId} key={item.value} value={item.value}><span className="truncate">{item.label}</span></SelectItem>)}</SelectPopup>
                  </Select>
                </Field>
              </div>
              <div className="connection-direction-row">
                <RadioGroup aria-label="Connection direction" className="connection-directions" disabled={saving} onValueChange={value => { setDirection(value as ConnectionDirection); setFormError("") }} value={direction}>
                  <Label className={cn("connection-direction", direction === "oneWay" && "is-selected")}><Radio className="sr-only" value="oneWay" /><ArrowRightIcon aria-hidden="true" />One-way</Label>
                  <Label className={cn("connection-direction", direction === "bidirectional" && "is-selected")}><Radio className="sr-only" value="bidirectional" /><ArrowLeftRightIcon aria-hidden="true" />Bidirectional</Label>
                </RadioGroup>
                <p className="connection-direction-help">{direction === "oneWay" ? "Network access goes from source to destination." : "Network access works in both directions."}</p>
              </div>
              {options.length < 2 ? <p role="status" className="connection-empty">Create at least two environments to connect them.</p> : null}
            </section>

            <div className="connection-columns">
              <section aria-label="Permissions" className="connection-permissions">
                <div className="connection-section-heading"><h2>Access rules</h2><span>{selectedPermissions.length} selected</span></div>
                <div className="connection-permission-list">
                  {permissions.map(permission => {
                    const { icon: Icon } = permissionDetails[permission]
                    const description = cloud && permission === "network" ? "Allow TCP between these nodes over SSH. Cloud terminals use a private SOCKS proxy; no UDP or LAN routing." : cloud && ["files", "volumes", "data"].includes(permission) ? "Connection-owned shared folder. Cloud servers use its browser/API, not a mounted drive." : permissionDetails[permission].description
                    const checked = selectedPermissions.includes(permission)
                    return <Label className={cn("connection-permission", checked && "is-selected")} key={permission}>
                      <Icon aria-hidden="true" />
                      <span className="connection-permission-copy"><span id={`${descriptionId}-${permission}-label`}>{permissionLabel[permission]}</span><span id={`${descriptionId}-${permission}`}>{permission === "network" && !shared && !cloud ? "Private IPv4: TCP, UDP and ping between these two environments." : permission === "ports" && hasNetwork ? "Network access already includes every TCP port." : description}</span></span>
                      <Checkbox aria-labelledby={`${descriptionId}-${permission}-label`} aria-describedby={`${descriptionId}-${permission}`} checked={checked} disabled={saving} onCheckedChange={value => togglePermission(permission, value)} />
                    </Label>
                  })}
                </div>
              </section>

              <section aria-label="Connection details" className="connection-details">
                <div className="connection-section-heading"><h2>Connection details</h2><ShieldCheckIcon aria-hidden="true" /></div>
                <div aria-label="Access summary" role="group" className="connection-summary">
                  <p className="connection-summary-route"><span title={sourceOption?.label}>{sourceOption?.label ?? "Source"}</span><DirectionIcon aria-label={direction === "oneWay" ? "to" : "both ways"} /><span title={targetOption?.label}>{targetOption?.label ?? "Destination"}</span></p>
                  <p>{hasNetwork ? cloud ? "All TCP ports are allowed over SSH. UDP, ping and LAN routing are unavailable." : shared ? "All network traffic is allowed. The TCP port list does not restrict this connection." : "IPv4 TCP, UDP and ping are allowed. No IPv6, multicast or fragmented IP traffic." : hasPorts ? "Network access is restricted to your allowed TCP ports." : "No network traffic is granted by this connection."}</p>
                </div>
                {hasPorts ? <Field name="ports">
                  <FieldLabel>Allowed TCP ports <span className="connection-optional">{hasNetwork ? "Optional" : "Required"}</span></FieldLabel>
                  <Input className="connection-input" disabled={saving} onChange={event => { setPorts(event.target.value); setFormError("") }} placeholder="443, 5432, 6379" type="text" value={ports} />
                  <FieldDescription className="connection-help">{hasNetwork ? "Saved as a reference only; all ports are already allowed." : "Separate ports with commas. Valid range: 1–65535."}</FieldDescription>
                </Field> : null}
                {selectedPermissions.includes("volumes") ? <Field name="volume">
                  <FieldLabel>Shared volume <span className="connection-optional">Optional</span></FieldLabel>
                  <Input className="connection-input" disabled={saving} maxLength={80} onChange={event => { setVolume(event.target.value); setFormError("") }} placeholder="workspace-data" type="text" value={volume} />
                  <FieldDescription className="connection-help">A label for this connection’s shared directory.</FieldDescription>
                </Field> : null}
                {hasStorage || selectedPermissions.includes("secrets") ? <p className="connection-help">{hasStorage ? "Files, volumes and data use the same connection directory. " : ""}{selectedPermissions.includes("secrets") ? "Secrets use a separate directory. " : ""}{direction === "oneWay" ? "The source can write; the destination can only read." : "Both environments can read and write."}</p> : null}
                {!shared ? <p className="connection-help">Files and Data create a private connection folder. Containers and built-in MicroVMs mount it under /opendock/shared. In Windows or Ubuntu VMs, open http://10.192.0.1:7444 in the guest browser to upload, read, edit and download files. Local-to-local links need no SSH or Internet. Cloud servers use the loopback file browser/API listed in Skills and need SSH reachability. Existing VMs may need one stop/start for the private adapter. Custom MicroVMs need the Yougori agent for automatic mounts.</p> : null}
                {hasStorage ? <p className="connection-help">Only files placed in the connection folder are shared—not the entire guest disk. Copy database exports here, not live database files. Folders persist on this computer when disconnected; VM snapshots do not include cross-VM shared folders.</p> : null}
                <p className="connection-scope"><Link2Icon aria-hidden="true" /><span>{cloud ? "Connects only these two nodes over SSH; your PC must be able to reach the cloud server. No Local network or Public access publishing." : "This connects these two environments only. It works independently of Internet access and does not publish anything."}</span></p>
              </section>
            </div>
          </DialogPanel>
          <DialogFooter className="connection-footer">
            {formError ? <p className="connection-error" role="alert">{formError}</p> : null}
            <div className="connection-footer-row">
              <span className="connection-footer-note">Rules apply when both environments are running.</span>
              <div className="connection-actions">
                <DialogClose render={<Button className="rounded-full" disabled={saving} type="button" variant="ghost" />}>Cancel</DialogClose>
                <Button aria-label="Create connection" aria-busy={saving} className="connection-submit" disabled={options.length < 2} loading={saving} type="submit"><Link2Icon aria-hidden="true" />Create connection</Button>
              </div>
            </div>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  )
}
