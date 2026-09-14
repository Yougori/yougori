// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { EnvironmentNameEditor } from "./environment-name-editor"
import type { Environment } from "@/types/platform"

const rename = vi.hoisted(() => vi.fn())
vi.mock("@/context/platform-context", () => ({ usePlatform: () => ({ renameEnvironment: rename }) }))
afterEach(() => { cleanup(); rename.mockReset() })
const environment = { id: "vm-1", name: "Windows 11", kind: "fullVm" } as Environment

it("keeps the draft during polling and saves on Enter", async () => {
  rename.mockResolvedValue(undefined)
  const { rerender } = render(<EnvironmentNameEditor environment={environment} />)
  fireEvent.change(screen.getByLabelText("VM name"), { target: { value: "  Work VM  " } })
  rerender(<EnvironmentNameEditor environment={{ ...environment }} />)
  expect((screen.getByLabelText("VM name") as HTMLInputElement).value).toBe("  Work VM  ")
  fireEvent.keyDown(screen.getByLabelText("VM name"), { key: "Enter" })
  await waitFor(() => expect(rename).toHaveBeenCalledWith("vm-1", "Work VM"))
})

it("rejects blank names and preserves the draft on save failure", async () => {
  rename.mockRejectedValue(new Error("Could not save"))
  render(<EnvironmentNameEditor environment={environment} />)
  fireEvent.change(screen.getByLabelText("VM name"), { target: { value: " " } })
  expect((screen.getByRole("button", { name: "Save name" }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText("VM name"), { target: { value: "New VM" } })
  fireEvent.click(screen.getByRole("button", { name: "Save name" }))
  await screen.findByText("Could not save")
  expect((screen.getByLabelText("VM name") as HTMLInputElement).value).toBe("New VM")
})
