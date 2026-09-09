import { useId } from "react"
import { HardDriveIcon } from "lucide-react"
import "./dialogs/creation-resource-sliders.css"

export function StorageCapacitySlider({ value, min, max, disabled = false, shared = false, onChange }: {
  value: number; min: number; max: number; disabled?: boolean; shared?: boolean; onChange(value: number): void
}) {
  const id = useId()
  const fill = max > min ? Math.max(0, Math.min(100, (value - min) / (max - min) * 100)) : 0
  return <fieldset disabled={disabled} className="creation-resource" data-resource="storage">
    <legend className="creation-resource-title"><HardDriveIcon aria-hidden="true" />Storage{shared ? " · shared by all containers" : ""}</legend>
    <div className="creation-resource-start">
      <label htmlFor={id}>Disk capacity</label>
      <input id={id} type="range" min={min} max={max} step={1} value={value} className="creation-resource-slider"
        aria-label="Storage capacity" aria-valuetext={`${value} GB`} aria-describedby={`${id}-help`}
        style={{ backgroundImage: `linear-gradient(to right, var(--resource-color) ${fill}%, var(--resource-track) ${fill}%)` }}
        onChange={event => onChange(Number(event.target.value))} />
      <output htmlFor={id}>{value} <span>GB</span></output>
      <div className="creation-resource-scale" aria-hidden="true"><span>{min} GB</span><span>{max} GB</span></div>
    </div>
    <p id={`${id}-help`} className="text-xs text-muted-foreground">Uses host space as files are written, not all at once. Disk capacity never shrinks automatically.{shared ? " This is a shared pool, not a per-container limit." : ""}</p>
  </fieldset>
}
