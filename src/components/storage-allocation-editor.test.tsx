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
  it.each(["openDockOci", "openDockCuda"] as const)("increases a running %s container's own limit while peers run", async provider => {
    vi.mocked(platformApi.getStorageAllocation).mockResolvedValue({ ...storage, limitEnforced: true })
    vi.mocked(platformApi.expandEnvironmentStorage).mockResolvedValue({ ...storage, capacityGb: 100, limitEnforced: true })
    render(<StorageAllocationEditor environment={{ ...environment, provider, kind: "container", status: "running" }} otherContainersActive />)
    const slider = await screen.findByRole("slider", { name: "Storage limit" })
    expect(screen.getByText(/Used by this container: 2.00 GB/)).toBeTruthy()
    fireEvent.change(slider, { target: { value: "100" } })
    fireEvent.click(screen.getByRole("button", { name: "Save storage limit" }))
    await waitFor(() => expect(platformApi.expandEnvironmentStorage).toHaveBeenCalledWith(environment.id, 100))
    expect(await screen.findByText(/Storage limit saved for this container/)).toBeTruthy()
    expect(slider.getAttribute("min")).toBe("6")
    expect(slider.getAttribute("max")).toBe("200")
  })

  it.each(["openDockOci", "openDockCuda"] as const)("reduces a running %s container to 6 GB when its files fit", async provider => {
    vi.mocked(platformApi.getStorageAllocation).mockResolvedValue({ ...storage, capacityGb: 20, limitEnforced: true })
    vi.mocked(platformApi.expandEnvironmentStorage).mockResolvedValue({ ...storage, capacityGb: 6, limitEnforced: true })
    render(<StorageAllocationEditor environment={{ ...environment, provider, kind: "container", status: "running" }} otherContainersActive />)
    const slider = await screen.findByRole("slider", { name: "Storage limit" })
    fireEvent.change(slider, { target: { value: "6" } })
    fireEvent.click(screen.getByRole("button", { name: "Save storage limit" }))
    await waitFor(() => expect(platformApi.expandEnvironmentStorage).toHaveBeenCalledWith(environment.id, 6))
    expect(await screen.findByText(/Storage limit saved for this container/)).toBeTruthy()
    expect(slider.getAttribute("min")).toBe("6")
  })

  it("explains why a selected limit below current usage cannot be saved", async () => {
    vi.mocked(platformApi.getStorageAllocation).mockResolvedValue({ ...storage, capacityGb: 20, physicalGb: 9.27, limitEnforced: true })
    render(<StorageAllocationEditor environment={{ ...environment, kind: "container", status: "running" }} otherContainersActive />)
    fireEvent.change(await screen.findByRole("slider"), { target: { value: "6" } })
    expect((await screen.findByRole("alert")).textContent).toContain("Choose at least 10 GB")
    expect((screen.getByRole("button", { name: "Save storage limit" }) as HTMLButtonElement).disabled).toBe(true)
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

  it("requires only the legacy target to stop once and permits accepting its suggested limit", async () => {
    vi.mocked(platformApi.getStorageAllocation).mockResolvedValue({ ...storage, limitEnforced: false })
    vi.mocked(platformApi.expandEnvironmentStorage).mockResolvedValue({ ...storage, limitEnforced: true })
    const { rerender } = render(<StorageAllocationEditor environment={{ ...environment, kind: "container", status: "running" }} otherContainersActive />)
    await screen.findByRole("slider")
    expect((screen.getByRole("button", { name: "Set storage limit" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Other containers can keep running/)).toBeTruthy()
    rerender(<StorageAllocationEditor environment={{ ...environment, kind: "container", status: "stopped" }} otherContainersActive />)
    await screen.findByRole("slider")
    fireEvent.click(screen.getByRole("button", { name: "Set storage limit" }))
    await waitFor(() => expect(platformApi.expandEnvironmentStorage).toHaveBeenCalledWith(environment.id, 64))
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
