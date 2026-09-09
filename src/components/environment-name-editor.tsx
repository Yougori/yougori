import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { usePlatform } from "@/context/platform-context"
import type { Environment } from "@/types/platform"

export function EnvironmentNameEditor({ environment }: { environment: Environment }) {
  const { renameEnvironment } = usePlatform()
  // Keep the draft separate from polling updates; null follows the saved name.
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const name = draft ?? environment.name
  const trimmed = name.trim()
  const valid = [...trimmed].length >= 2 && [...trimmed].length <= 80 && !/\p{Cc}/u.test(trimmed)
  const save = async () => {
    if (saving || !valid || trimmed === environment.name) return
    setSaving(true); setError("")
    try { await renameEnvironment(environment.id, trimmed); setDraft(null) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSaving(false) }
  }
  return <Field>
    <FieldLabel htmlFor="environment-display-name">VM name</FieldLabel>
    <div className="flex items-center gap-2">
      <Input id="environment-display-name" value={name} disabled={saving} aria-invalid={!valid} onChange={event => { setDraft(event.target.value); setError("") }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void save() } }} />
      <Button type="button" variant="outline" loading={saving} disabled={!valid || trimmed === environment.name} onClick={save}>Save name</Button>
    </div>
    <FieldDescription>Changes the display name only. No restart needed.</FieldDescription>
    {!valid ? <p role="alert" className="text-xs text-destructive-foreground">Use 2–80 characters, without control characters.</p> : null}
    {error ? <p role="alert" className="text-xs text-destructive-foreground">{error}</p> : null}
  </Field>
}
