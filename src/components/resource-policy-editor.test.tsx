// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { ResourcePolicyEditor } from "./resource-policy-editor"
import type { Environment } from "@/types/platform"

const host = vi.hoisted(() => ({ os: "macOS 15.0", totalCpu: 8, totalMemoryGb: 16 }))
vi.mock("@/context/platform-context", () => ({ usePlatform: () => ({ state: { host, environments: [] }, updateResourcePolicy: vi.fn() }) }))
vi.mock("./storage-allocation-editor", () => ({ StorageAllocationEditor: () => null }))
vi.mock("./environment-name-editor", () => ({ EnvironmentNameEditor: () => null }))
afterEach(() => { cleanup(); host.os = "macOS 15.0" })

const environment = {
  id: "mac-test", name: "Test VM", kind: "fullVm", status: "running",
  resourcePolicy: {
    cpu: { min: 1, preferred: 2, max: 4, current: 2 },
    memoryGb: { min: 1, preferred: 2, max: 4, current: 2 },
    dynamic: true, priority: "normal",
  },
} as Environment

it("explains Mac VM restart requirements without promising live dynamic allocation", () => {
  render(<ResourcePolicyEditor environment={environment} compact />)
  expect(screen.getByText(/macOS preview:/).textContent).toContain("Saved changes apply after shutdown and restart")
  expect(screen.queryByText(/Live VM memory adjustment requires/)).toBeNull()
})

it("does not apply the Mac VM limitation to Windows or Mac containers", () => {
  const { rerender } = render(<ResourcePolicyEditor environment={{ ...environment, kind: "container" }} compact />)
  expect(screen.queryByText(/macOS preview:/)).toBeNull()
  host.os = "Windows 11"
  rerender(<ResourcePolicyEditor environment={environment} compact />)
  expect(screen.queryByText(/macOS preview:/)).toBeNull()
  expect(screen.getByText(/Live VM memory adjustment requires/)).toBeTruthy()
})
