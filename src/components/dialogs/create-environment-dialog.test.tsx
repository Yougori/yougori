// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { CreateEnvironmentDialog } from "./create-environment-dialog"
import { gpuApi } from "@/api/gpu-api"
import { platformApi } from "@/api/platform-api"

const create = vi.hoisted(() => vi.fn())
vi.mock("@/context/platform-context", () => ({ usePlatform: () => ({ createEnvironment: create, state: { environments: [], host: { totalCpu: 8, totalMemoryGb: 16 } } }) }))
vi.mock("@/api/gpu-api", () => ({ gpuApi: { cudaStatus: vi.fn(), installCuda: vi.fn() } }))
vi.mock("@/api/platform-api", () => ({ platformApi: { getStorageAllocation: vi.fn() } }))
// Resource drag gestures have their own tests; keep these tests focused on
// category selection, compatibility, and the submitted native request.
vi.mock("@/components/dialogs/creation-resource-sliders", () => ({ CreationResourceSliders: () => null }))

beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent)
  vi.resetAllMocks()
  create.mockResolvedValue(undefined)
  vi.mocked(gpuApi.cudaStatus).mockResolvedValue({ supported: true, installed: true, running: false, detail: "Ready" })
  vi.mocked(platformApi.getStorageAllocation).mockResolvedValue({ capacityGb: 6, maximumGb: 100 } as Awaited<ReturnType<typeof platformApi.getStorageAllocation>>)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it("creates a separate GPU category with CUDA enabled but no network or PC folder grant", async () => {
  render(<CreateEnvironmentDialog open onOpenChange={() => {}} />)
  fireEvent.click(await screen.findByRole("radio", { name: "GPU" }))
  await screen.findByText("Installed")
  expect(screen.queryByRole("group", { name: "Container engine" })).toBeNull()
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "AI workspace" } })
  fireEvent.click(screen.getByRole("button", { name: "Create environment" }))
  await waitFor(() => expect(create).toHaveBeenCalledOnce())
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ kind: "container", provider: "openDockCuda", runtime: "docker.io/library/ubuntu:24.04", gpuAccess: true, networkAccess: false, storageGb: 20 }))
  expect(create.mock.calls[0]![0]).not.toHaveProperty("shares")
})

it.each(["Container", "GPU"])("offers 6 GB through the available maximum for new %s storage", async category => {
  render(<CreateEnvironmentDialog open onOpenChange={() => {}} />)
  fireEvent.click(await screen.findByRole("radio", { name: category }))
  if (category === "GPU") await screen.findByText("Installed")
  const slider = await screen.findByRole("slider", { name: "Storage limit" })
  expect(slider.getAttribute("min")).toBe("6")
  expect(slider.getAttribute("max")).toBe("100")
  fireEvent.change(slider, { target: { value: "6" } })
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: `${category} minimum` } })
  fireEvent.click(screen.getByRole("button", { name: "Create environment" }))
  await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ storageGb: 6 })))
})

it("does not leak GPU permission or image selection back into standard containers", async () => {
  render(<CreateEnvironmentDialog open onOpenChange={() => {}} />)
  fireEvent.click(await screen.findByRole("radio", { name: "GPU" }))
  await screen.findByText("Installed")
  fireEvent.click(screen.getByRole("radio", { name: "Container" }))
  await waitFor(() => expect(screen.queryByText("Loading storage capacity…")).toBeNull())
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Standard workspace" } })
  fireEvent.click(screen.getByRole("button", { name: "Create environment" }))
  await waitFor(() => expect(create).toHaveBeenCalledOnce())
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ kind: "container", provider: "openDockOci", gpuAccess: false, networkAccess: false }))
})

it("blocks unsupported computers from creating GPU environments", async () => {
  vi.mocked(gpuApi.cudaStatus).mockResolvedValue({ supported: false, installed: true, running: false, detail: "No compatible NVIDIA GPU" })
  render(<CreateEnvironmentDialog open onOpenChange={() => {}} />)
  fireEvent.click(await screen.findByRole("radio", { name: "GPU" }))
  await screen.findByText("No compatible NVIDIA GPU")
  expect((screen.getByRole("button", { name: "Create environment" }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole("button", { name: "Create environment" }))
  expect(create).not.toHaveBeenCalled()
})
