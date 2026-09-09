import { describe, expect, it } from "vitest"
import { allCapabilities, capabilityIssue } from "./graph-capabilities"
import type { Environment } from "@/types/platform"

describe("live internet cable", () => {
  it("only exposes optional capabilities, not automatic allocation", () => {
    expect(allCapabilities.map(item => item.capability)).toEqual(["internet", "pc"])
  })
  for (const kind of ["container", "fullVm"] as const) {
    for (const status of ["running", "paused", "stopped"] as const) {
      it(`allows ${kind} while ${status}`, () => {
        const env = { name: "Test", kind, provider: kind === "container" ? "openDockOci" : "qemu", status } as Environment
        expect(capabilityIssue(env, "internet")).toBeNull()
      })
    }
  }
  it("does not disconnect the microVM control connection", () => {
    const env = { name: "Test", kind: "microVm", provider: "qemu", status: "running" } as Environment
    expect(capabilityIssue(env, "internet")).not.toBeNull()
  })
  it("blocks unfinished creation", () => {
    const env = { name: "Test", kind: "container", provider: "openDockOci", status: "provisioning" } as Environment
    expect(capabilityIssue(env, "internet")).toContain("ready")
  })
})
