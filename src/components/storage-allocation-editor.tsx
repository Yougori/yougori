import { useEffect, useState } from "react"
import { platformApi } from "@/api/platform-api"
import { Button } from "@/components/ui/button"
import { StorageCapacitySlider } from "@/components/storage-capacity-slider"
import type { Environment, StorageAllocation } from "@/types/platform"

export function StorageAllocationEditor({ environment, otherContainersActive }: { environment: Environment; otherContainersActive: boolean }) {
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
  const mustStop = environment.status !== "stopped" || Boolean(allocation?.shared && otherContainersActive)
  const expand = async () => {
    if (saving || mustStop || !allocation || capacity <= allocation.capacityGb) return
    setSaving(true); setError(""); setSaved(false)
    try {
      const value = await platformApi.expandEnvironmentStorage(environment.id, capacity)
      setAllocation(value); setCapacity(Math.ceil(value.capacityGb)); setSaved(true)
    } catch (reason) { setError(String(reason)) }
    finally { setSaving(false) }
  }
  if (loading) return <p role="status" className="text-xs text-muted-foreground">Loading storage capacity…</p>
  if (environment.provider === "openDockCuda") return <div className="space-y-2 text-xs text-muted-foreground">
    <p>CUDA uses its own shared WSL disk. Host space grows as files are written; the disk capacity is not a per-container quota.</p>
    {allocation ? <p>Virtual capacity: {allocation.capacityGb.toFixed(0)} GB · Host space used: {allocation.physicalGb.toFixed(2)} GB</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>
  return <div className="flex flex-col gap-3">
    {allocation ? <>
      <StorageCapacitySlider value={capacity} min={Math.ceil(allocation.capacityGb)} max={allocation.maximumGb} shared={allocation.shared} disabled={saving} onChange={value => { setCapacity(value); setSaved(false) }} />
      <p className="text-xs text-muted-foreground">Current disk: {Number(allocation.capacityGb.toFixed(2))} GB · Host space used: {allocation.physicalGb.toFixed(2)} GB</p>
      <p className="text-xs text-muted-foreground">{allocation.shared || environment.runtime === "builtin:alpine" ? "The filesystem expands automatically at the next start." : "After expansion, extend the partition inside the guest (Windows: Disk Management → Extend Volume)."} Shrinking is disabled to protect your files.</p>
      {mustStop ? <p role="status" className="text-xs text-muted-foreground">{allocation.shared ? "Stop all running or paused containers before expanding shared storage." : "Stop this environment before expanding storage."}</p> : null}
      <Button type="button" variant="outline" loading={saving} disabled={mustStop || capacity <= allocation.capacityGb} onClick={expand}>Expand storage</Button>
    </> : null}
    {error ? <div role="alert" className="text-xs text-destructive-foreground">{error}<Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setRetry(value => value + 1)}>Refresh storage</Button></div> : null}
    {saved ? <p role="status" className="text-xs text-success-foreground">Disk capacity expanded. Existing files were preserved.</p> : null}
  </div>
}
