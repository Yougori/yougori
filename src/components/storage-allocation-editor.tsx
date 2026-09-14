import { useEffect, useState } from "react"
import { platformApi } from "@/api/platform-api"
import { Button } from "@/components/ui/button"
import { StorageCapacitySlider } from "@/components/storage-capacity-slider"
import type { Environment, StorageAllocation } from "@/types/platform"

export function StorageAllocationEditor({ environment }: { environment: Environment; otherContainersActive: boolean }) {
  const [allocation, setAllocation] = useState<StorageAllocation | null>(null)
  const [capacity, setCapacity] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    setSaved(false)
    platformApi.getStorageAllocation(environment.id).then(value => {
      if (active) { setAllocation(value); setCapacity(Math.ceil(value.capacityGb)) }
    }).catch(reason => { if (active) setError(String(reason)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [environment.id, environment.status, retry])
  const container = environment.kind === "container"
  const needsLimit = container && allocation?.limitEnforced !== true
  const mustStop = environment.status !== "stopped" && (!container || needsLimit)
  const minimum = container ? 6 : allocation ? Math.ceil(allocation.capacityGb) : 1
  const belowUsage = Boolean(container && allocation && capacity <= allocation.physicalGb)
  const changed = Boolean(allocation && capacity >= minimum && (container ? needsLimit || capacity !== allocation.capacityGb : capacity > allocation.capacityGb))
  const action = container ? needsLimit ? "Set storage limit" : "Save storage limit" : "Expand storage"
  const expand = async () => {
    if (saving || mustStop || !allocation || !changed || belowUsage) return
    setSaving(true); setError(""); setSaved(false)
    try {
      const value = await platformApi.expandEnvironmentStorage(environment.id, capacity)
      setAllocation(value); setCapacity(Math.ceil(value.capacityGb)); setSaved(true)
    } catch (reason) { setError(String(reason)) }
    finally { setSaving(false) }
  }
  if (loading) return <p role="status" className="text-xs text-muted-foreground">Loading storage capacity…</p>
  return <div className="flex flex-col gap-3">
    {allocation ? <>
      <StorageCapacitySlider value={capacity} min={minimum} max={allocation.maximumGb} container={container} disabled={saving} onChange={value => { setCapacity(value); setSaved(false) }} />
      {container ? <p className="text-xs text-muted-foreground">{needsLimit ? "Suggested" : "Current"} limit: {Number(allocation.capacityGb.toFixed(2))} GB · Used by this container: {allocation.physicalGb.toFixed(2)} GB</p> : null}
      {!container ? <p className="text-xs text-muted-foreground">Current disk: {Number(allocation.capacityGb.toFixed(2))} GB · Host space used: {allocation.physicalGb.toFixed(2)} GB</p> : null}
      <p className="text-xs text-muted-foreground">{container ? "Choose from 6 GB to the available maximum. Writable files, private volumes and logs count toward this limit. Base images, snapshots and connected folders use additional space. An enabled limit can increase or decrease while the container runs, but must stay above its current usage." : `${environment.runtime === "builtin:alpine" ? "The filesystem expands automatically at the next start." : "After expansion, extend the partition inside the guest (Windows: Disk Management → Extend Volume)."} Shrinking is disabled to protect your files.`}</p>
      {belowUsage ? <p role="alert" className="text-xs text-destructive-foreground">This container uses {allocation.physicalGb.toFixed(2)} GB. Choose at least {Math.max(6, Math.floor(allocation.physicalGb) + 1)} GB.</p> : null}
      {mustStop ? <p role="status" className="text-xs text-muted-foreground">{container ? "Stop this container once to enable its storage limit. Other containers can keep running." : "Stop this environment before expanding storage."}</p> : null}
      <Button type="button" variant="outline" loading={saving} disabled={mustStop || !changed || belowUsage} onClick={expand}>{action}</Button>
    </> : null}
    {error ? <div role="alert" className="text-xs text-destructive-foreground">{error}<Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setRetry(value => value + 1)}>Refresh storage</Button></div> : null}
    {saved ? <p role="status" className="text-xs text-success-foreground">{container ? "Storage limit saved for this container. Existing files were preserved." : "Disk capacity expanded. Existing files were preserved."}</p> : null}
  </div>
}
