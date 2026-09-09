import { describe, expect, it } from "vitest"
import { storageCleanupDescription } from "./storage-cleanup"

describe("storage cleanup reporting", () => {
  it("distinguishes measured reclaimed bytes from retained images", () => {
    const text = storageCleanupDescription({ reclaimedCacheBytes: 0, reclaimedDiskBytes: 2 * 1_073_741_824, notes: ["Cached images kept."], warnings: [] })
    expect(text).toContain("2.00 GB returned from container disks")
    expect(text).toContain("Cached images kept")
  })
  it("keeps warnings visible even when part of cleanup succeeded", () => {
    expect(storageCleanupDescription({ reclaimedCacheBytes: 0, reclaimedDiskBytes: 1_073_741_824, warnings: ["Stop GPU containers and retry."] })).toContain("Stop GPU containers and retry.")
  })
  it("does not claim reclamation when none was measured", () => {
    expect(storageCleanupDescription({ reclaimedCacheBytes: 0, warnings: [] })).toContain("No additional disk space")
  })
})
