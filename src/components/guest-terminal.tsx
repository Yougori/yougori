import { useEffect, useRef, useState } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import { workspaceApi } from "@/api/workspace-api"
import { TerminalLinkCards } from "@/components/terminal-link-cards"
import { terminalClipboard, terminalClipboardAction } from "@/lib/terminal-clipboard"
import { extractTerminalLinks, mergeTerminalLinks, normalizeTerminalLink } from "@/lib/terminal-links"
import { terminalInstallerInput, type TerminalReadyHandler, type TerminalInstallerId } from "@/lib/terminal-installers"
import { tourInstallerStarted } from "@/lib/instructions-tour"

export function GuestTerminal({ environmentId, sessionId, active, onReady, installer }: { environmentId: string; sessionId: string; active: boolean; onReady?: TerminalReadyHandler; installer?: TerminalInstallerId }) {
  const targetRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const activeRef = useRef(active)
  const [error, setError] = useState("")
  const [links, setLinks] = useState<string[]>([])

  useEffect(() => {
    activeRef.current = active
    const frame = active ? requestAnimationFrame(() => { fitRef.current?.fit(); terminalRef.current?.focus() }) : 0
    return () => cancelAnimationFrame(frame)
  }, [active])

  useEffect(() => {
    // Wait until the mounted view has a frame. React's development lifecycle
    // can dispose an immediate xterm before its internal viewport timer fires.
    // Cancelling this frame also avoids creating a throwaway native PTY.
    const initialize = () => {
      const target = targetRef.current
      if (!target) return
      const nativeSessionId = `term-${crypto.randomUUID()}`
      let disposed = false, timer = 0, linkTimer = 0, offset = 0, ready = false, created = false
      let inputQueue = Promise.resolve()
      const terminal = new Terminal({ fontSize: 13, fontFamily: "ui-monospace, Consolas, monospace", cursorBlink: true, scrollback: 3000, theme: { background: "#0c0d0f", foreground: "#e9e9e9" } })
      terminal.options.disableStdin = Boolean(installer)
      const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(target); fit.fit()
      terminalRef.current = terminal; fitRef.current = fit
      const fail = (reason: unknown) => {
        if (disposed) return
        ready = false
        terminal.options.disableStdin = true
        window.clearTimeout(timer)
        if (created) {
          created = false
          void workspaceApi.terminal(environmentId, nativeSessionId, "close").catch(() => undefined)
        }
        setError(reason instanceof Error ? reason.message : String(reason))
        onReady?.(sessionId, false, true)
      }
      terminal.attachCustomKeyEventHandler(event => {
        const action = terminalClipboardAction(event, terminal.hasSelection())
        if (!action) return true // Ctrl+C without a selection remains SIGINT.
        event.preventDefault()
        event.stopPropagation()
        if (event.type !== "keydown" || event.repeat) return false
        const selected = terminal.getSelection()
        if (action === "copy" && selected) {
          void terminalClipboard.writeText(selected).catch(() => { if (!disposed) setError("Couldn't copy to the clipboard. Please try again.") })
        } else if (action === "paste" && ready && !terminal.options.disableStdin) {
          void terminalClipboard.readText().then(text => {
            // Never deliver a delayed clipboard read into a closed or hidden tab.
            if (!disposed && ready && !terminal.options.disableStdin && activeRef.current) terminal.paste(text)
          }).catch(() => { if (!disposed) setError("Couldn't read the clipboard. Please try Ctrl+V again or use right-click Paste.") })
        }
        return false
      })
      const collectLinks = () => {
        if (disposed) return
        const buffer = terminal.buffer.active
        let text = ""
        for (let row = Math.max(0, buffer.length - 200); row < buffer.length; row++) {
          const wraps = buffer.getLine(row + 1)?.isWrapped
          text += (buffer.getLine(row)?.translateToString(!wraps) ?? "") + (wraps ? "" : "\n")
        }
        setLinks(previous => mergeTerminalLinks(previous, extractTerminalLinks(text)))
      }
      // OSC 8 links can hide their URL behind a label. Observe them, but do not
      // consume the sequence or enable any guest-driven clipboard functionality.
      const hyperlink = terminal.parser.registerOscHandler(8, data => {
        const url = normalizeTerminalLink(data.slice(data.indexOf(";") + 1))
        if (url && !disposed) setLinks(previous => mergeTerminalLinks(previous, [url]))
        return false
      })
      const queueLinkScan = () => {
        if (disposed || linkTimer) return
        linkTimer = window.setTimeout(() => { linkTimer = 0; collectLinks() }, 250)
      }
      const poll = async () => {
        if (disposed) return
        try {
          const output = await workspaceApi.terminal(environmentId, nativeSessionId, "read", { offset })
          if (disposed || !ready) return
          offset = output.offset
          if (output.data) terminal.write(Uint8Array.from(atob(output.data), c => c.charCodeAt(0)), queueLinkScan)
          if (output.done) { terminal.writeln("\r\n[Session ended]"); ready = false; onReady?.(sessionId, false, true); return }
        } catch (reason) { fail(reason); return }
        timer = window.setTimeout(() => void poll(), document.visibilityState === "hidden" ? 2000 : activeRef.current ? 150 : 900)
      }
      void workspaceApi.terminal(environmentId, nativeSessionId, "create", { cols: terminal.cols, rows: terminal.rows }).then(async () => {
        if (disposed) { void workspaceApi.terminal(environmentId, nativeSessionId, "close").catch(() => undefined); return }
        created = true; ready = true; if (activeRef.current) terminal.focus(); void poll()
        onReady?.(sessionId, true)
        if (installer) {
          terminal.writeln(`\r\n[Preparing ${installer} installer in this container...]`)
          const command = await workspaceApi.prepareInstaller(environmentId, nativeSessionId, installer)
          if (disposed || !ready) return
          // Fresh dedicated PTY only: never paste into an existing program or a
          // half-written shell command. Send one short command plus Enter directly.
          const data = btoa(terminalInstallerInput(command))
          await workspaceApi.terminal(environmentId, nativeSessionId, "write", { data })
          if (!disposed) tourInstallerStarted(environmentId, installer)
          if (!disposed) terminal.options.disableStdin = false
        }
      }).catch(fail)
      const input = terminal.onData(data => {
        if (!ready || disposed || terminal.options.disableStdin) return
        const bytes = new TextEncoder().encode(data)
        inputQueue = inputQueue.then(async () => {
          for (let start = 0; start < bytes.length && ready && !disposed; start += 16 * 1024) {
            const encoded = btoa(String.fromCharCode(...bytes.slice(start, start + 16 * 1024)))
            await workspaceApi.terminal(environmentId, nativeSessionId, "write", { data: encoded })
          }
        }).catch(reason => { if (!disposed) setError(String(reason)) })
      })
      const resize = terminal.onResize(({ cols, rows }) => { if (ready) void workspaceApi.terminal(environmentId, nativeSessionId, "resize", { cols, rows }).catch(() => undefined) })
      const observer = new ResizeObserver(() => { if (!disposed && activeRef.current && target.clientWidth) fit.fit() }); observer.observe(target)
      return () => { disposed = true; onReady?.(sessionId, false); if (created) void workspaceApi.terminal(environmentId, nativeSessionId, "close").catch(() => undefined); ready = false; window.clearTimeout(timer); window.clearTimeout(linkTimer); hyperlink.dispose(); observer.disconnect(); input.dispose(); resize.dispose(); terminal.dispose(); terminalRef.current = null; fitRef.current = null }
    }
    let release: (() => void) | undefined
    const frame = requestAnimationFrame(() => { release = initialize() })
    return () => { cancelAnimationFrame(frame); release?.() }
  }, [environmentId, sessionId, onReady, installer])

  return <div data-tour="guest-terminal" className="flex size-full min-h-0 min-w-0 flex-col bg-[#0c0d0f]"><div className="relative min-h-0 flex-1 p-3"><div aria-label="Terminal" className="size-full" ref={targetRef} />{error ? <p className="absolute inset-x-3 bottom-3 rounded border border-destructive/30 bg-background p-3 text-sm text-destructive-foreground" role="alert">{error}</p> : null}</div><TerminalLinkCards links={links} /></div>
}
