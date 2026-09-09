import { describe, expect, it } from "vitest"
import { supportsConnections, supportsSharedConnection, connectionPermissions } from "./environment-connections"

describe("connection endpoint support", () => {
  it("supports all container and VM combinations but not computer branches", () => {
    for (const kind of ["container", "microVm", "fullVm"] as const) expect(supportsConnections({ kind })).toBe(true)
    expect(supportsConnections({ kind: "computerBranch" })).toBe(false)
  })
  it("exposes only enforceable permissions for each pair", () => {
    for (const source of ["container", "microVm", "fullVm"] as const) for (const target of ["container", "microVm", "fullVm"] as const) {
      const shared = supportsSharedConnection({ kind: source }, { kind: target })
      expect(shared).toBe(source === "container" && target === "container")
      expect(connectionPermissions(shared)).toEqual(shared ? ["network", "ports", "files", "volumes", "data", "secrets"] : ["network", "ports", "files", "volumes", "data"])
    }
  })
})
