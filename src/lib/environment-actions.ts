export type EnvironmentAction = "starting" | "opening" | "pausing" | "stopping" | "deleting" | "resetting" | "connecting" | "disconnecting"

export const environmentActionLabel: Record<EnvironmentAction, string> = {
  connecting: "Connecting…",
  disconnecting: "Disconnecting…",
  starting: "Starting…",
  opening: "Opening…",
  pausing: "Pausing…",
  stopping: "Stopping…",
  deleting: "Deleting…",
  resetting: "Factory resetting…",
}
