// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ContainerStartupCommand } from "./container-startup-command"
import type { Environment } from "@/types/platform"

const update = vi.hoisted(() => vi.fn())
vi.mock("@/context/platform-context", () => ({ usePlatform: () => ({ updateContainerStartupCommand: update }) }))
const environment = { id: "test", status: "stopped", containerCommand: "sleep 2147483647" } as Environment
beforeEach(() => { update.mockReset() })
afterEach(cleanup)

it("preserves edits across polling and sends the command to the selected node", async () => {
  update.mockResolvedValue(undefined)
  const props = { environment, disabled: false, onBusyChange: vi.fn() }
  const view = render(<ContainerStartupCommand {...props} />)
  fireEvent.change(screen.getByLabelText("Startup command"), { target: { value: "cd /project\nexec npm start" } })
  view.rerender(<ContainerStartupCommand {...props} environment={{ ...environment, cpuUsage: 12 }} />)
  expect((screen.getByLabelText("Startup command") as HTMLTextAreaElement).value).toBe("cd /project\nexec npm start")
  fireEvent.click(screen.getByRole("button", { name: "Save startup command" }))
  await waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith("test", "cd /project\nexec npm start"))
  expect(props.onBusyChange).toHaveBeenLastCalledWith(false)
})

it("requires stopping before save, and clearing requests the default startup", async () => {
  const props = { environment: { ...environment, status: "running" as const }, disabled: false, onBusyChange: vi.fn() }
  const view = render(<ContainerStartupCommand {...props} />)
  fireEvent.change(screen.getByLabelText("Startup command"), { target: { value: "" } })
  fireEvent.click(screen.getByRole("button", { name: "Save startup command" }))
  expect(update).not.toHaveBeenCalled()
  expect(screen.getByText(/Stop the container before saving/)).toBeTruthy()
  view.rerender(<ContainerStartupCommand {...props} environment={environment} />)
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save startup command" })))
  expect(update).toHaveBeenCalledExactlyOnceWith("test", "")
})

it("retains a failed command so the user can correct or retry it", async () => {
  update.mockRejectedValue(new Error("Cannot preserve container files"))
  render(<ContainerStartupCommand environment={environment} disabled={false} onBusyChange={vi.fn()} />)
  fireEvent.change(screen.getByLabelText("Startup command"), { target: { value: "exec server" } })
  fireEvent.click(screen.getByRole("button", { name: "Save startup command" }))
  expect((await screen.findByRole("alert")).textContent).toContain("Cannot preserve container files")
  expect((screen.getByLabelText("Startup command") as HTMLTextAreaElement).value).toBe("exec server")
})
