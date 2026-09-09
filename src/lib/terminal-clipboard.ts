export const terminalClipboard = {
  async readText(): Promise<string> {
    if ("__TAURI_INTERNALS__" in window) {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager")
      return readText()
    }
    return navigator.clipboard.readText()
  },
  async writeText(text: string): Promise<void> {
    if ("__TAURI_INTERNALS__" in window) {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager")
      return writeText(text)
    }
    return navigator.clipboard.writeText(text)
  },
}

// Called only by the focused terminal's keyboard handler, never by guest output.
// In particular, OSC 52 must not grant guest programs access to the host clipboard.
export function terminalClipboardAction(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">, hasSelection: boolean): "copy" | "paste" | null {
  if (event.altKey) return null
  const key = event.key.toLowerCase()
  if (key === "insert" && event.shiftKey && !event.ctrlKey && !event.metaKey) return "paste"
  if (!event.ctrlKey && !event.metaKey) return null
  if (key === "v") return "paste"
  if (key === "c" && (hasSelection || event.shiftKey || event.metaKey)) return "copy"
  return null
}
