import { run } from "@/api/platform-api"

export interface GpuAdapter {
  id: string; name: string; luid: string; vendorId: number; deviceId: number
  subSysId: number; revision: number; memoryBytes: number
}
export interface GpuSettings {
  adapters: GpuAdapter[]
  selectedId: string | null
  active: { runtimeId: string; adapter: GpuAdapter | null }[]
  blockedReason: string | null
}
export interface CudaRuntimeStatus {
  supported: boolean
  installed: boolean
  running: boolean
  updateAvailable?: boolean
  detail: string
  checks?: { name: string; passed: boolean; detail: string }[]
}
export interface CudaVerification { stdout: string; stderr: string; exitCode: number }
function fixtureState(): GpuSettings {
  const fixture = JSON.parse(localStorage.getItem("opendock.gpu.fixture") ?? '{"adapters":[],"active":[]}')
  const platform = JSON.parse(localStorage.getItem("opendock.platform.v1") ?? '{"environments":[]}')
  const busy = platform.environments.some((e: { status: string; kind: string; gpuAccess?: boolean }) =>
    (e.status === "running" || e.status === "paused") && (e.kind === "container" || e.gpuAccess && e.kind === "fullVm"))
  return { ...fixture, selectedId: localStorage.getItem("opendock.gpu.selected"), blockedReason: busy ? "Stop all running or paused containers and GPU-enabled full VMs before changing the shared GPU." : null }
}
export const gpuApi = {
  verifyCuda(environmentId: string) {
    return run<CudaVerification>("verify_environment_cuda", { environmentId }, () => { throw new Error("A real GPU calculation can only be verified inside the desktop app. Browser preview cannot test CUDA.") })
  },
  cudaStatus() {
    return run<CudaRuntimeStatus>("get_cuda_runtime_status", {}, () => JSON.parse(localStorage.getItem("opendock.cuda.fixture") ?? '{"supported":false,"installed":false,"running":false,"detail":"CUDA setup and computation require the desktop app on Windows with an NVIDIA GPU."}'))
  },
  installCuda() {
    return run<CudaRuntimeStatus>("install_cuda_runtime", {}, () => { throw new Error("Open the desktop app to install the CUDA runtime.") })
  },
  getSettings() { return run<GpuSettings>("get_shared_gpu_settings", {}, fixtureState) },
  select(selectedId: string | null) {
    return run<GpuSettings>("set_shared_gpu_selection", { selectedId }, () => {
      const state = fixtureState()
      if (selectedId && !state.adapters.some(a => a.id === selectedId)) throw new Error("The selected GPU is unavailable")
      if (state.selectedId !== selectedId && state.blockedReason) throw new Error(state.blockedReason)
      if (selectedId) localStorage.setItem("opendock.gpu.selected", selectedId)
      else localStorage.removeItem("opendock.gpu.selected")
      return fixtureState()
    })
  },
}
