import { describe, expect, it } from "vitest"
import { terminalClipboardAction } from "./terminal-clipboard"

const key = (key: string, options = {}) => ({ key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...options })
describe("terminal clipboard shortcuts", () => {
  it("copies a selection but preserves Ctrl+C interrupts without one", () => {
    expect(terminalClipboardAction(key("c"), true)).toBe("copy")
    expect(terminalClipboardAction(key("c"), false)).toBeNull()
    expect(terminalClipboardAction(key("C", { shiftKey: true }), false)).toBe("copy")
  })
  it("handles Windows, Linux and Mac paste shortcuts", () => {
    expect(terminalClipboardAction(key("v"), false)).toBe("paste")
    expect(terminalClipboardAction(key("V", { shiftKey: true }), false)).toBe("paste")
    expect(terminalClipboardAction(key("Insert", { ctrlKey: false, shiftKey: true }), false)).toBe("paste")
    expect(terminalClipboardAction(key("v", { ctrlKey: false, metaKey: true }), false)).toBe("paste")
  })
  it("leaves ordinary typing, AltGr and other control keys alone", () => {
    expect(terminalClipboardAction(key("v", { ctrlKey: false }), true)).toBeNull()
    expect(terminalClipboardAction(key("v", { altKey: true }), true)).toBeNull()
    expect(terminalClipboardAction(key("d"), false)).toBeNull()
  })
})
