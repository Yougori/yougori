export type EnvironmentKind = "container" | "microVm" | "fullVm" | "computerBranch" | "cloud"
export type EnvironmentStatus = "running" | "stopped" | "paused" | "provisioning" | "error"
export type RuntimeProviderKind = "openDockOci" | "openDockCuda" | "qemu" | "nativeSandbox" | "cloudSsh"
export type BranchType = "exactCopy" | "appsSettings" | "appsOnly" | "cleanOs"
export type SandboxFileAccess = "readOnly" | "readWrite"
export type Priority = "low" | "normal" | "high" | "critical"
export type PermissionKind = "network" | "ports" | "files" | "volumes" | "data" | "secrets"
export type ConnectionDirection = "oneWay" | "bidirectional"
export type ThemePreference = "light" | "dark" | "system"

export interface ResourceRange {
  min: number
  preferred: number
  max: number
  current: number
}

export interface ResourcePolicy {
  cpu: ResourceRange
  memoryGb: ResourceRange
  priority: Priority
  dynamic: boolean
}

export interface SandboxShare {
  path: string
  access: SandboxFileAccess
}

export interface SandboxPolicy {
  executable: string
  arguments: string
  shares: SandboxShare[]
  networkAccess: boolean
}

export interface Environment {
  id: string
  name: string
  kind: EnvironmentKind
  status: EnvironmentStatus
  runtime: string
  provider?: RuntimeProviderKind
  runtimeId?: string
  runtimePath?: string
  controlEndpoint?: string
  consoleEndpoint?: string
  containerCommand?: string
  networkAccess?: boolean
  gpuAccess?: boolean
  sandboxPolicy?: SandboxPolicy
  lastError?: string
  description: string
  branchType?: BranchType
  createdAt: string
  lastOpenedAt?: string
  cpuUsage: number
  memoryUsageGb: number
  storageDeltaGb: number
  storageLimitGb?: number
  networkRxMbps: number
  resourcePolicy: ResourcePolicy
}

export interface Connection {
  id: string
  sourceId: string
  targetId: string
  direction: ConnectionDirection
  permissions: PermissionKind[]
  ports: string[]
  volume?: string
  active: boolean
  createdAt: string
  enforcementStatus?: "enforced" | "pending" | "error"
  providerRuleIds?: string[]
  lastError?: string
}

export type SnapshotStatus = "ready" | "creating" | "failed"

export interface Snapshot {
  id: string
  environmentId: string
  name: string
  createdAt: string
  sizeGb: number
  deltaGb: number
  encrypted: boolean
  status: SnapshotStatus
  providerSnapshotId?: string
  artifactPath?: string
  artifactSizeBytes?: number
  checksumSha256?: string
  environmentState?: {
    runtime: string
    provider?: RuntimeProviderKind
    runtimePath?: string
    containerCommand?: string
    networkAccess?: boolean
    gpuAccess?: boolean
    sandboxPolicy?: SandboxPolicy
    description: string
    branchType?: BranchType
    resourcePolicy: ResourcePolicy
  }
  connections?: Connection[]
}

export type BackupProvider = "awsS3" | "azureBlob" | "googleCloud" | "s3Compatible"

export interface BackupDestination {
  id: string
  name: string
  provider: BackupProvider
  location: string
  encrypted: boolean
  connected: boolean
  lastVerifiedAt: string
}

export type BackupRunStatus = "complete" | "running" | "failed"

export interface BackupRun {
  id: string
  environmentId: string
  destinationId: string
  createdAt: string
  completedAt?: string
  transferredGb: number
  deduplicatedGb: number
  status: BackupRunStatus
  remoteObject?: string
  checksumSha256?: string
  lastError?: string
}

export interface HostMetrics {
  hostname: string
  os: string
  cpuModel: string
  totalCpu: number
  usedCpuPercent: number
  gpuUsagePercent: number | null
  totalMemoryGb: number
  usedMemoryGb: number
  totalStorageGb: number
  usedStorageGb: number
  storageDrive?: string | null
  storageSavedGb: number
  pressure: "low" | "moderate" | "high"
  cpuHistory: number[]
  gpuHistory: number[]
  memoryHistory: number[]
  updatedAt: string
}

export interface ProviderStatus {
  id: string
  name: string
  kind: "container" | "virtualization" | "storage" | "backup"
  status: "ready" | "unavailable" | "needsSetup"
  detail: string
}

export interface AppSettings {
  theme: ThemePreference
  launchAtStartup: boolean
  minimizeToTray: boolean
  pauseOnBattery: boolean
  telemetryEnabled: boolean
  dataDirectory: string
  snapshotRetention: number
  bandwidthLimitMbps: number
}

export interface PlatformState {
  manualServicePorts?: Record<string, number[]>
  schemaVersion?: number
  environments: Environment[]
  connections: Connection[]
  snapshots: Snapshot[]
  destinations: BackupDestination[]
  backupRuns: BackupRun[]
  pendingVmRestores?: string[]
  host: HostMetrics
  providers: ProviderStatus[]
  settings: AppSettings
}

export interface StorageCleanupResult {
  reclaimedCacheBytes: number
  reclaimedDiskBytes?: number
  notes?: string[]
  warnings: string[]
}

export interface EnvironmentDeletionResult extends PlatformState {
  storageCleanup?: StorageCleanupResult
}

export interface CreateEnvironmentRequest {
  storageGb?: number
  name: string
  kind: EnvironmentKind
  runtime: string
  provider: RuntimeProviderKind
  containerCommand?: string
  networkAccess?: boolean
  gpuAccess?: boolean
  sandboxPolicy?: SandboxPolicy
  description: string
  branchType?: BranchType
  resourcePolicy: Omit<ResourcePolicy, "cpu" | "memoryGb"> & {
    cpu: Omit<ResourceRange, "current">
    memoryGb: Omit<ResourceRange, "current">
  }
}

export interface StorageAllocation {
  limitEnforced?: boolean
  capacityGb: number
  physicalGb: number
  maximumGb: number
  shared: boolean
}

export interface CreateConnectionRequest {
  sourceId: string
  targetId: string
  direction: ConnectionDirection
  permissions: PermissionKind[]
  ports: string[]
  volume?: string
}

export interface AddDestinationRequest {
  name: string
  provider: BackupProvider
  location: string
  accessKey: string
  secretKey: string
}

export interface GuestSession {
  kind: "containerTerminal" | "headlessTerminal" | "embeddedVnc" | "headlessSerial" | "nativeApplication"
  websocketUrl?: string
  password?: string
  message: string
}

export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}
