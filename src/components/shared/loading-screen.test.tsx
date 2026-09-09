// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LoadingScreen } from "./loading-screen"

afterEach(() => { cleanup(); vi.useRealTimers() })

it("announces loading without fake progress or an unnecessary delay", () => {
  const view = render(<LoadingScreen />)
  expect(screen.getByRole("main").getAttribute("aria-busy")).toBe("true")
  expect(screen.getByRole("status").textContent).toBe("Starting your workspace…")
  expect(screen.queryByRole("button")).toBeNull()
  view.unmount()
  expect(screen.queryByRole("status")).toBeNull()
})

it("offers an explicit reload when startup takes unusually long", () => {
  vi.useFakeTimers()
  const retry = vi.fn()
  render(<LoadingScreen onRetry={retry} />)
  act(() => vi.advanceTimersByTime(15_000))
  expect(retry).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Reload window" }))
  expect(retry).toHaveBeenCalledOnce()
})

it("shows startup errors with a working retry instead of an endless spinner", () => {
  const retry = vi.fn()
  const { container } = render(<LoadingScreen error="Runtime unavailable" onRetry={retry} />)
  expect(screen.getByRole("alert").textContent).toContain("Runtime unavailable")
  expect(screen.getByRole("main").getAttribute("aria-busy")).toBe("false")
  expect(container.querySelector(".startup-track")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  expect(retry).toHaveBeenCalledOnce()
})
