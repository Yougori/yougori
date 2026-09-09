// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { StorageAllocationEditor } from "./storage-allocation-editor"
import { platformApi } from "@/api/platform-api"
import type { Environment, StorageAllocation } from "@/types/platform"

vi.mock("@/api/platform-api", () => ({ platformApi: { getStorageAllocation: vi.fn(), expandEnvironmentStorage: vi.fn() } }))
const storage: StorageAllocation = { capacityGb: 64, physicalGb: 2, maximumGb: 200, shared: false }
const environment = { id: "test-vm", kind: "fullVm", status: "stopped", runtime: "windows.iso" } as Environment
beforeEach(() => { vi.resetAllMocks(); vi.mocked(platformApi.getStorageAllocation).mockResolvedValue(storage) })
afterEach(cleanup)

describe("storage allocation", () => {
  it("keeps the CUDA disk separate and never offers a QEMU resize", async () => {
    render(<StorageAllocationEditor environment={{ ...environment, provider: "openDockCuda", kind: "container" }} otherContainersActive={false} />)
    expect(await screen.findByText(/CUDA uses its own shared WSL disk/)).toBeTruthy()
    expect(screen.getByText(/Host space used: 2.00 GB/)).toBeTruthy()
    expect(screen.queryByRole("slider")).toBeNull()
    expect(screen.queryByRole("button", { name: "Expand storage" })).toBeNull()
    expect(platformApi.expandEnvironmentStorage).not.toHaveBeenCalled()
  })

  it("shows capacity in GB and saves the slider with loading feedback", async () => {
    let finish!: (value: StorageAllocation) => void
    vi.mocked(platformApi.expandEnvironmentStorage).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    render(<StorageAllocationEditor environment={environment} otherContainersActive={false} />)
    const slider = await screen.findByRole("slider", { name: "Storage capacity" })
    expect(slider.getAttribute("min")).toBe("64")
    expect(slider.getAttribute("aria-valuetext")).toBe("64 GB")
    fireEvent.change(slider, { target: { value: "100" } })
    fireEvent.click(screen.getByRole("button", { name: "Expand storage" }))
    await waitFor(() => expect(platformApi.expandEnvironmentStorage).toHaveBeenCalledWith("test-vm", 100))
    expect(screen.getByRole("button", { name: "Expand storage" }).getAttribute("aria-busy")).toBe("true")
    await act(async () => { finish({ ...storage, capacityGb: 100 }) })
    expect(await screen.findByText("Disk capacity expanded. Existing files were preserved.")).toBeTruthy()
    expect(slider.getAttribute("min")).toBe("100")
  })

  it("prevents expanding shared storage while another container is active", async () => {
    vi.mocked(platformApi.getStorageAllocation).mockResolvedValue({ ...storage, shared: true })
    render(<StorageAllocationEditor environment={{ ...environment, kind: "container" }} otherContainersActive />)
    fireEvent.change(await screen.findByRole("slider"), { target: { value: "100" } })
    expect((screen.getByRole("button", { name: "Expand storage" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/shared pool, not a per-container limit/)).toBeTruthy()
  })

  it("shows failures without claiming that storage was expanded", async () => {
    vi.mocked(platformApi.expandEnvironmentStorage).mockRejectedValue(new Error("Disk locked"))
    render(<StorageAllocationEditor environment={environment} otherContainersActive={false} />)
    fireEvent.change(await screen.findByRole("slider"), { target: { value: "100" } })
    fireEvent.click(screen.getByRole("button", { name: "Expand storage" }))
    expect((await screen.findByRole("alert")).textContent).toContain("Disk locked")
    expect(screen.queryByText(/Disk capacity expanded/)).toBeNull()
  })
})
