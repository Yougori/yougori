import { useRef, useState } from "react"
import { TerminalIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { usePlatform } from "@/context/platform-context"
import type { Environment } from "@/types/platform"

export function ContainerStartupCommand({ environment, disabled, onBusyChange }: {
  environment: Environment; disabled: boolean; onBusyChange(busy: boolean): void
}) {
  const { updateContainerStartupCommand } = usePlatform()
  const savedCommand = environment.containerCommand ?? ""
  const [draft, setDraft] = useState<string | null>(null)
  const command = draft ?? savedCommand
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const lock = useRef(false)
  const stopped = environment.status === "stopped"
  const save = async () => {
    if (lock.current || disabled || !stopped) return
    lock.current = true; setSaving(true); onBusyChange(true); setError("")
    try {
      await updateContainerStartupCommand(environment.id, command)
      setDraft(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { lock.current = false; setSaving(false); onBusyChange(false) }
  }
  return <section className="inspector-section" aria-label="Container startup">
    <h3 className="inspector-section-title"><TerminalIcon aria-hidden="true" />Startup</h3>
    <Field>
      <FieldLabel>Startup command</FieldLabel>
      <Textarea className="font-mono text-xs" rows={3} maxLength={32768} disabled={disabled || saving} value={command} placeholder="Use the image’s default startup" onChange={event => { setDraft(event.target.value); setError("") }} />
      <FieldDescription>Runs inside this container each time it starts. Leave empty to use the image’s default startup. Keep your main process in the foreground; the container stops when it exits.</FieldDescription>
    </Field>
    {!stopped ? <p className="inspector-description">Stop the container before saving a different startup command.</p> : null}
    {error ? <p role="alert" className="text-xs text-destructive-foreground">{error}</p> : null}
    <Button type="button" size="sm" variant="outline" disabled={disabled || !stopped || command.trim() === savedCommand} loading={saving} onClick={() => void save()}>Save startup command</Button>
  </section>
}
