import type { Environment, EnvironmentKind } from "@/types/platform"
import { environmentKindLabel } from "@/lib/domain"

// A presentation category, not a new disk format or isolation boundary.
// Existing CUDA containers keep their IDs, provider, snapshots and files.
export type EnvironmentCategory = EnvironmentKind | "gpu"
export function environmentCategory(environment: Pick<Environment, "kind" | "provider">): EnvironmentCategory {
  return environment.kind === "container" && environment.provider === "openDockCuda" ? "gpu" : environment.kind
}
export function environmentLabel(environment: Pick<Environment, "kind" | "provider">) {
  return environmentCategory(environment) === "gpu" ? "GPU · NVIDIA CUDA" : environmentKindLabel[environment.kind]
}
