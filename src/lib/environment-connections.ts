import type { Connection, Environment, PermissionKind } from "@/types/platform"

// Keep saved inactive links visible: Skills explains why they cannot be used.
export function nodeConnections(environmentId: string, connections: Connection[]) {
  return connections.filter(c => c.sourceId !== c.targetId && (c.sourceId === environmentId || c.targetId === environmentId))
}

export function supportsConnections(environment: Pick<Environment, "kind">) {
  return ["container", "microVm", "fullVm", "cloud"].includes(environment.kind)
}
export function supportsSharedConnection(source?: Pick<Environment, "kind">, target?: Pick<Environment, "kind">) {
  return source?.kind === "container" && target?.kind === "container"
}
export function connectionPermissions(shared: boolean): PermissionKind[] {
  return shared ? ["network", "ports", "files", "volumes", "data", "secrets"] : ["network", "ports", "files", "volumes", "data"]
}
