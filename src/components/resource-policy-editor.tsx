import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { ResourceRangeFields } from "@/components/resource-range-fields"
import { StorageAllocationEditor } from "@/components/storage-allocation-editor"
import { EnvironmentNameEditor } from "@/components/environment-name-editor"
import { CreationResourceSliders } from "@/components/dialogs/creation-resource-sliders"
import { resourceControlErrors, resourceControlLimits } from "@/lib/resource-controls"
import { Label } from "@/components/ui/label"
import { Radio, RadioGroup } from "@/components/ui/radio-group"
import { usePlatform } from "@/context/platform-context"
import { priorityLabel } from "@/lib/domain"
import type { Environment, Priority, ResourcePolicy } from "@/types/platform"

const priorities: Priority[] = ["low", "normal", "high", "critical"]

export function ResourcePolicyEditor({ environment, compact = false, saveTarget }: { environment: Environment; compact?: boolean; saveTarget?: HTMLElement | null }) {
  const { updateResourcePolicy, state } = usePlatform()
  const [policy, setPolicy] = useState<ResourcePolicy>(environment.resourcePolicy)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [saved, setSaved] = useState(false)
  const [inputMode, setInputMode] = useState<"sliders" | "values">("sliders")

  // Host polling creates a new environment object repeatedly. Never discard
  // a draft while the user is typing; current allocation is not an edit field.
  useEffect(() => { if (!dirty) setPolicy(environment.resourcePolicy) }, [environment, dirty])
  const limits = resourceControlLimits(environment.kind, state?.host.totalCpu, state?.host.totalMemoryGb)
  const errors = resourceControlErrors(policy, environment.kind, state?.host.totalCpu, state?.host.totalMemoryGb)
  const update = (next: ResourcePolicy) => { setPolicy(next); setDirty(true); setSaved(false); setSaveError("") }
  const memoryRestart = environment.kind === "microVm" && environment.status === "running" && policy.memoryGb.preferred !== environment.resourcePolicy.memoryGb.current
  const macVm = /macos|mac os|darwin/i.test(state?.host.os ?? "") && ["fullVm", "microVm"].includes(environment.kind)

  const save = async () => {
    if (saving || errors.length) return
    setSaving(true)
    setSaveError("")
    try {
      await updateResourcePolicy(environment.id, { ...policy, dynamic: true })
      setDirty(false)
      setSaved(true)
    } catch (reason) { setSaveError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSaving(false) }
  }

  const saveButton = <Button disabled={errors.length > 0} loading={saving} onClick={save} type="button" variant="outline">Save changes</Button>

  return (
    <div className="inspector-resource-editor flex flex-col gap-6">
      {environment.kind === "fullVm" || environment.kind === "microVm" ? <EnvironmentNameEditor key={`${environment.id}:name`} environment={environment} /> : null}
      <div className="inspector-section-heading"><h3 className="inspector-section-title">Resource allocation</h3><div role="group" aria-label="Resource input mode" className="inspector-input-modes"><Button aria-pressed={inputMode === "sliders"} disabled={saving || errors.length > 0} onClick={() => setInputMode("sliders")} type="button" variant="ghost" size="sm">Sliders</Button><Button aria-pressed={inputMode === "values"} disabled={saving} onClick={() => setInputMode("values")} type="button" variant="ghost" size="sm">Exact values</Button></div></div>
      {macVm ? <p role="status" className="text-xs text-muted-foreground">macOS preview: VMs use the preferred CPU and memory at startup. Saved changes apply after shutdown and restart; live dynamic VM allocation is unavailable.</p> : null}
      {inputMode === "sliders" ? <>
        <CreationResourceSliders label="CPU" min={limits.cpu.min} max={limits.cpu.max} step={limits.cpu.step} disabled={saving} unit="CPUs" value={[policy.cpu.min, policy.cpu.preferred, policy.cpu.max]} onChange={([min, preferred, max]) => update({ ...policy, cpu: { ...policy.cpu, min: min!, preferred: preferred!, max: max! } })} />
        <CreationResourceSliders label="Memory" min={limits.memory.min} max={limits.memory.max} step={limits.memory.step} disabled={saving} unit="GB" value={[policy.memoryGb.min, policy.memoryGb.preferred, policy.memoryGb.max]} onChange={([min, preferred, max]) => update({ ...policy, memoryGb: { ...policy.memoryGb, min: min!, preferred: preferred!, max: max! } })} />
      </> : <><ResourceRangeFields
        label="CPU"
        max={limits.cpu.max}
        min={limits.cpu.min}
        onChange={([min, preferred, max]) => update({ ...policy, cpu: { ...policy.cpu, min: min!, preferred: preferred!, max: max! } })}
        value={[policy.cpu.min, policy.cpu.preferred, policy.cpu.max]}
        step={limits.cpu.step}
        disabled={saving}
        unit="CPUs"
      />
      <ResourceRangeFields
        label="Memory"
        max={limits.memory.max}
        min={limits.memory.min}
        onChange={([min, preferred, max]) => update({ ...policy, memoryGb: { ...policy.memoryGb, min: min!, preferred: preferred!, max: max! } })}
        value={[policy.memoryGb.min, policy.memoryGb.preferred, policy.memoryGb.max]}
        step={limits.memory.step}
        disabled={saving}
        unit="GB"
      />
      </>}
      {environment.kind !== "computerBranch" ? <StorageAllocationEditor key={`${environment.id}:storage`} environment={environment} otherContainersActive={Boolean(state?.environments.some(item => item.kind === "container" && ["running", "paused", "provisioning"].includes(item.status)))} /> : null}
      {!compact ? (
        <Field>
          <FieldLabel>Scheduling priority</FieldLabel>
          <RadioGroup aria-label="Scheduling priority" disabled={saving} className="inspector-priorities" onValueChange={(value) => update({ ...policy, priority: value as Priority })} value={policy.priority}>
            {priorities.map((item) => (
              <Label className="inspector-priority" key={item}>
                <Radio className="sr-only" value={item} />
                {priorityLabel[item]}
              </Label>
            ))}
          </RadioGroup>
          <FieldDescription>Higher priority receives preferred capacity first during contention.</FieldDescription>
        </Field>
      ) : null}
      <details className="inspector-runtime-notes"><summary>Runtime limits &amp; restart behavior</summary><p>{macVm ? "CPU and RAM stay at the VM's boot allocation until shutdown and restart. Container allocation remains automatic." : environment.kind === "microVm" ? "MicroVM memory stays at its boot allocation until restart. CPU allocation adjusts automatically." : environment.kind === "fullVm" ? "Live VM memory adjustment requires a guest balloon driver. Stop the VM before increasing its maximums." : "Containers share a host-sized resource budget with RAM reserved for the host and runtime. Stop all containers before growing the shared VM; retrying resizes it without deleting disks."}</p><p>Minimum ≤ Preferred ≤ Maximum.</p></details>
      {errors.length ? <Field invalid><FieldError match role="alert">{errors[0]}</FieldError></Field> : null}
      {memoryRestart ? <p role="status" className="text-xs text-muted-foreground">Restart required for memory: running with {Number(environment.resourcePolicy.memoryGb.current.toFixed(3))} GB; next boot uses {Number.isFinite(policy.memoryGb.preferred) ? Number(policy.memoryGb.preferred.toFixed(3)) : "—"} GB.</p> : null}
      {saveError ? <p role="alert" className="text-xs text-destructive-foreground">{saveError}</p> : null}
      {saved ? <p role="status" className="text-xs text-success-foreground">Resource policy saved.</p> : null}
      {saveTarget === undefined ? <div className="inspector-policy-footer">{saveButton}</div> : saveTarget ? createPortal(saveButton, saveTarget) : null}
    </div>
  )
}
