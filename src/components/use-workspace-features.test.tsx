// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { workspaceApi } from "@/api/workspace-api"
import { useWorkspaceFeatures } from "@/components/use-workspace-features"
import type { Environment } from "@/types/platform"

vi.mock("@/api/workspace-api", () => ({ workspaceApi: { manualPorts: vi.fn(), setManualPort: vi.fn(), services: vi.fn() } }))
const node = { id: "env-test", name: "Test", kind: "fullVm", status: "stopped" } as Environment
let saved: Record<string, number[]>
beforeEach(() => {
  localStorage.clear()
  saved = { "env-test": [8080] }
  vi.mocked(workspaceApi.manualPorts).mockImplementation(async () => structuredClone(saved))
  vi.mocked(workspaceApi.setManualPort).mockImplementation(async (id, port, present) => {
    saved[id] = present ? [...new Set([...(saved[id] ?? []), port])].sort((a, b) => a - b) : (saved[id] ?? []).filter(p => p !== port)
    return structuredClone(saved)
  })
  vi.mocked(workspaceApi.services).mockResolvedValue({ services: [], publications: [], shares: [], notice: "" })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear() })

describe("shared CLI/desktop manual port declarations", () => {
  it("loads backend ports on stopped VMs and saves/removes through the backend", async () => {
    const { result } = renderHook(() => useWorkspaceFeatures([node]))
    await waitFor(() => expect(result.current.manual[node.id]).toEqual([8080]))
    expect(result.current.decorated[0]?.workspace?.services[0]?.port).toBe(8080)
    await act(() => result.current.addPort(node.id, 3000))
    expect(saved[node.id]).toEqual([3000, 8080])
    expect(result.current.dialog).toEqual({ type: "service", environmentId: node.id, port: 3000 })
    await act(() => result.current.removePort(node.id, 3000))
    expect(saved[node.id]).toEqual([8080])
    expect(result.current.dialog).toBeNull()
  })
  it("migrates old graph ports additively without replacing CLI declarations", async () => {
    localStorage.setItem("opendock.manual-ports.v1", JSON.stringify({ "env-test": [3000, 8080] }))
    const { result } = renderHook(() => useWorkspaceFeatures([node]))
    await waitFor(() => expect(result.current.manual[node.id]).toEqual([3000, 8080]))
    expect(workspaceApi.setManualPort).toHaveBeenCalledExactlyOnceWith(node.id, 3000, true)
    expect(localStorage.getItem("opendock.manual-ports.v1")).toBeNull()
  })
  it("keeps declarations when the backend cannot save them and surfaces the failure", async () => {
    const { result } = renderHook(() => useWorkspaceFeatures([node]))
    await waitFor(() => expect(result.current.manual[node.id]).toEqual([8080]))
    vi.mocked(workspaceApi.setManualPort).mockRejectedValueOnce(new Error("Disk is full"))
    await expect(act(() => result.current.addPort(node.id, 3000))).rejects.toThrow("Disk is full")
    expect(result.current.manual[node.id]).toEqual([8080])
    expect(result.current.dialog).toBeNull()
  })
})
