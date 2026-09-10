import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { ArrowRightIcon, CheckIcon, GpuIcon, LayersIcon, ServerIcon, SlidersHorizontalIcon, TerminalIcon } from "lucide-react"
import { CreationResourceSliders } from "@/components/dialogs/creation-resource-sliders"
import { StorageCapacitySlider } from "@/components/storage-capacity-slider"
import { OciImagePicker } from "@/components/dialogs/oci-image-picker"
import { CudaRuntimePanel } from "@/components/dialogs/cuda-runtime-panel"
import type { CudaRuntimeStatus } from "@/api/gpu-api"
import { isolationPresentation } from "@/components/dialogs/environment-creation-options"
import { cn } from "@/lib/utils"
import "./create-environment-dialog.css"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Form } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Radio, RadioGroup } from "@/components/ui/radio-group"
import { creationResourceErrors, creationResourceLimits } from "@/lib/resource-controls"
import { Textarea } from "@/components/ui/textarea"
import { platformApi } from "@/api/platform-api"
import { usePlatform } from "@/context/platform-context"
import { customOciImage, defaultOciImage, ociImages, ociStartupCommand, type OciImageOption } from "@/data/oci-images"
import { containerPurposes, containerPurposeImage, type ContainerPurpose } from "@/data/container-purposes"
import { environmentKindDescription, environmentKindLabel, priorityLabel } from "@/lib/domain"
import type { EnvironmentKind, Priority, StorageAllocation } from "@/types/platform"
import type { EnvironmentCategory } from "@/lib/environment-category"
import { defaultGpuImage, gpuImageGroups, gpuImageIssue } from "@/data/gpu-images"
import { ownsTour, trackTourCreation, useInstructionsTour } from "@/lib/instructions-tour"

const kinds: EnvironmentCategory[] = ["container", "gpu", "microVm", "fullVm", "computerBranch"]
const priorities: Priority[] = ["low", "normal", "high", "critical"]

const runtimeDefaults: Record<EnvironmentKind, string> = {
  cloud: "",
  container: defaultOciImage.value,
  microVm: "builtin:alpine",
  fullVm: "",
  computerBranch: "",
}

export function CreateEnvironmentDialog({ open, onOpenChange, initialKind }: { open: boolean; onOpenChange(open: boolean): void; initialKind?: EnvironmentKind }) {
  const tour = useInstructionsTour()
  const guided = ownsTour(tour) && Boolean(tour?.step.startsWith("create-"))
  const guidedRun = guided ? tour?.run : undefined
  const { createEnvironment, state } = usePlatform()
  const [category, setCategory] = useState<EnvironmentCategory>("container")
  const kind: EnvironmentKind = category === "gpu" ? "container" : category
  const cudaContainer = category === "gpu"
  const containerRuntime = cudaContainer ? "openDockCuda" : "openDockOci"
  const [name, setName] = useState("")
  const [runtime, setRuntime] = useState(runtimeDefaults.container)
  const [selectedOciImage, setSelectedOciImage] = useState<OciImageOption>(defaultOciImage)
  const [useCustomImage, setUseCustomImage] = useState(false)
  const [selectedPurpose, setSelectedPurpose] = useState<ContainerPurpose | null>(null)
  const [containerCommand, setContainerCommand] = useState("sleep 2147483647")
  const [cudaStatus, setCudaStatus] = useState<CudaRuntimeStatus | null>(null)
  const [description, setDescription] = useState("")
  const [cpu, setCpu] = useState([0.5, 0.5, 1])
  const [memory, setMemory] = useState([0.5, 0.5, 0.5])
  const [priority, setPriority] = useState<Priority>("normal")
  const [storage, setStorage] = useState(6)
  const [storageInfo, setStorageInfo] = useState<StorageAllocation | null>(null)
  const [storageError, setStorageError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const submitLock = useRef(false)
  const [formError, setFormError] = useState("")
  const cpuMaximum = useMemo(() => Math.max(1, state?.host.totalCpu ?? 16), [state?.host.totalCpu])
  const memoryMaximum = useMemo(() => Math.floor((state?.host.totalMemoryGb ?? 32) * 8) / 8, [state?.host.totalMemoryGb])
  const limits = creationResourceLimits(kind, cpuMaximum, memoryMaximum)
  const policy = {
    cpu: { min: cpu[0]!, preferred: cpu[1]!, max: cpu[2]!, current: 0 },
    memoryGb: { min: memory[0]!, preferred: memory[1]!, max: memory[2]!, current: 0 },
    priority, dynamic: true,
  }
  const policyErrors = creationResourceErrors(policy, kind, cpuMaximum, memoryMaximum)
  const storageMinimum = kind === "container" ? Math.ceil(storageInfo?.capacityGb ?? 6) : kind === "microVm" ? 6 : 1
  const storageMaximum = Math.max(storageMinimum, storageInfo?.maximumGb ?? storageMinimum)

  useEffect(() => {
    if (!open || cudaContainer) return
    let active = true
    setStorageInfo(null); setStorageError("")
    platformApi.getStorageAllocation(undefined, kind === "fullVm" || kind === "microVm").then(info => {
      if (!active) return
      const required = kind === "microVm" ? 6 : kind === "container" ? Math.ceil(info.capacityGb) : 1
      if (info.maximumGb < required) { setStorageError(`Not enough free space on the Yougori drive. At least ${required} GB is needed, with 2 GB kept free for the host.`); return }
      setStorageInfo(info)
      setStorage(kind === "container" ? Math.ceil(info.capacityGb) : Math.min(kind === "fullVm" ? 64 : 6, info.maximumGb))
    }).catch(reason => { if (active) setStorageError(String(reason)) })
    return () => { active = false }
  }, [open, kind, cudaContainer])

  useEffect(() => {
    if (open) setCategory(initialKind === "computerBranch" ? "container" : initialKind ?? "container")
  }, [initialKind, open])

  useEffect(() => {
    setRuntime(runtimeDefaults[kind])
    setSelectedPurpose(null)
    if (kind === "container") {
      const image = cudaContainer ? defaultGpuImage : defaultOciImage
      setRuntime(image.value)
      setSelectedOciImage(image)
      setUseCustomImage(false)
      setContainerCommand(ociStartupCommand(image))
    }
    if (kind === "fullVm") {
      setCpu([1, Math.min(2, cpuMaximum), Math.min(8, cpuMaximum)])
      setMemory([1, Math.min(4, memoryMaximum), Math.min(8, memoryMaximum)])
    } else if (kind === "microVm") {
      setCpu([1, 1, Math.min(2, cpuMaximum)])
      setMemory([1, Math.min(1, memoryMaximum), Math.min(2, memoryMaximum)])
    } else {
      setCpu([0.5, Math.min(0.5, cpuMaximum), Math.min(1, cpuMaximum)])
      setMemory([0.5, Math.min(0.5, memoryMaximum), Math.min(0.5, memoryMaximum)])
    }
  }, [cpuMaximum, kind, memoryMaximum, cudaContainer])

  useEffect(() => {
    if (!open) {
      setName("")
      setDescription("")
      setFormError("")
      setSubmitting(false)
      submitLock.current = false
      setRuntime(runtimeDefaults.container)
      setSelectedOciImage(defaultOciImage)
      setUseCustomImage(false)
      setSelectedPurpose(null)
      setContainerCommand("sleep 2147483647")
    }
  }, [open])

  const chooseOciImage = (image: OciImageOption | null) => {
    if (!image) return
    setSelectedPurpose(null)
    setSelectedOciImage(image)
    setUseCustomImage(image.value === customOciImage.value)
    setRuntime(image.value === customOciImage.value ? "" : image.value)
    setContainerCommand(ociStartupCommand(image))
    // Keep the service preset small; the host-sized range remains adjustable.
    if (image.value === "docker.io/library/mongo:latest") {
      setCpu([0.5, 1, Math.min(2, cpuMaximum)])
      setMemory([0.5, 0.5, Math.min(0.5, memoryMaximum)])
    }
  }

  useEffect(() => {
    if (!open || !guidedRun) return
    setCategory("container")
    setRuntime(defaultOciImage.value)
    setSelectedOciImage(defaultOciImage)
    setUseCustomImage(false)
    setSelectedPurpose(null)
    setContainerCommand(ociStartupCommand(defaultOciImage))
  }, [open, guidedRun])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitLock.current) return
    if (guided && (category !== "container" || runtime !== defaultOciImage.value || containerCommand !== ociStartupCommand(defaultOciImage))) {
      setFormError("The guide uses one default container. Skip the guide to choose another type or image.")
      return
    }
    if (kind === "computerBranch") {
      setFormError("Computer Branch is temporarily unavailable.")
      return
    }
    if (name.trim().length < 2) {
      setFormError("Give the environment a name with at least two characters.")
      return
    }
    if (!runtime.trim()) {
      setFormError(kind === "container"
        ? "Enter an OCI image reference."
        : kind === "microVm"
          ? "Use the built-in image or select a microVM JSON manifest."
          : "Select an installer ISO or an existing virtual disk.")
      return
    }
    if (policyErrors.length) { setFormError(policyErrors[0]!); return }
    if (cudaContainer && (!cudaStatus?.supported || !cudaStatus.installed || cudaStatus.updateAvailable)) { setFormError(cudaStatus?.supported === false ? cudaStatus.detail : "Set up or update NVIDIA CUDA first, then create this GPU environment."); return }
    if (cudaContainer && gpuImageIssue(runtime)) { setFormError(gpuImageIssue(runtime)!); return }
    if (!cudaContainer && (!storageInfo || storageError || storage < storageMinimum || storage > storageMaximum)) { setFormError(storageError || "Wait for storage capacity to load, then choose an available size."); return }
    if (state?.environments.some(environment => environment.name.toLowerCase() === name.trim().toLowerCase())) {
      setFormError("An environment with this name already exists.")
      return
    }
    submitLock.current = true
    setSubmitting(true)
    setFormError("")
    try {
      if (kind === "container" && !cudaContainer) trackTourCreation(name.trim())
      const creation = createEnvironment({
        name: name.trim(),
        storageGb: cudaContainer ? undefined : storage,
        kind,
        runtime: runtime.trim(),
        provider: kind === "container" ? containerRuntime : "qemu",
        containerCommand: kind === "container" ? containerCommand.trim() : undefined,
        networkAccess: false,
        gpuAccess: cudaContainer,
        description: description.trim() || (cudaContainer ? "A GPU container using NVIDIA CUDA and the shared WSL kernel." : environmentKindDescription[kind]),
        resourcePolicy: {
          cpu: { min: cpu[0] ?? 1, preferred: cpu[1] ?? 2, max: cpu[2] ?? 6 },
          memoryGb: { min: memory[0] ?? 1, preferred: memory[1] ?? 4, max: memory[2] ?? 8 },
          priority,
          dynamic: true,
        },
      })
      // Progress and errors belong to the persisted node and provider. A later
      // result must never close or overwrite a newly opened creation form.
      void creation.catch(() => undefined)
      onOpenChange(false)
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : String(reason))
      submitLock.current = false
      setSubmitting(false)
    }
  }

  const chooseBootMedia = async () => {
    setFormError("")
    try {
      const selected = await platformApi.selectBootMedia()
      if (selected) setRuntime(selected)
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const KindIcon = cudaContainer ? GpuIcon : isolationPresentation[kind].icon

  return (
    <Dialog modal={!guided} disablePointerDismissal={guided} onOpenChange={(value, details) => {
      const guideEvent = details.event.target instanceof Element && details.event.target.closest('[data-tour-ui]')
      if (!value && (guideEvent || (guided && details.reason === "focus-out"))) { details.cancel(); return }
      if (!submitting) onOpenChange(value)
    }} open={open}>
      <DialogPopup bottomStickOnMobile={false} closeProps={{ disabled: submitting }} className="creation-workbench max-h-[calc(100dvh-2rem)] max-w-none overflow-hidden rounded-2xl sm:max-w-none" data-create-environment data-create-kind={category}>
        <DialogHeader className="creation-header">
          <div className="creation-heading"><LayersIcon aria-hidden="true" /><DialogTitle className="text-base leading-5">New environment</DialogTitle></div>
          <span className="creation-host"><ServerIcon aria-hidden="true" />Local machine</span>
          <DialogDescription className="sr-only">Choose an environment type, its image, and resources.</DialogDescription>
        </DialogHeader>
        <Form className="contents" onSubmit={submit}>
          <DialogPanel scrollFade={false} className="p-0!">
            <section aria-label="Isolation options" className="creation-isolation">
              <RadioGroup aria-label="Environment type" disabled={submitting} className="creation-types" onValueChange={value => setCategory(value as EnvironmentCategory)} value={category}>
                {kinds.map(item => {
                  const Icon = item === "gpu" ? GpuIcon : isolationPresentation[item].icon
                  return <Label key={item} className={cn("creation-type", category === item && "is-selected", item === "computerBranch" && "is-unavailable")}>
                    <Radio className="sr-only" disabled={submitting || item === "computerBranch" || (guided && item !== "container")} value={item} />
                    <Icon aria-hidden="true" /><span>{item === "gpu" ? "GPU" : environmentKindLabel[item]}</span>{category === item ? <CheckIcon aria-hidden="true" className="creation-type-check" /> : null}
                    {item === "computerBranch" ? <span className="creation-unavailable-label">Unavailable</span> : null}
                  </Label>
                })}
              </RadioGroup>
              <p className="creation-isolation-description">{guided ? "The guide uses one default container for your first website. Other types and images are available after the guide." : cudaContainer ? "GPU containers for AI and computing. NVIDIA CUDA access is included." : isolationPresentation[kind].description}</p>
            </section>
            <div className="creation-columns">
              <section aria-label="Environment configuration" className="creation-configuration">
                <div className="creation-section-heading"><h2><TerminalIcon aria-hidden="true" />Configuration</h2><span>{cudaContainer ? "NVIDIA CUDA" : kind === "container" ? "OCI runtime" : "QEMU runtime"}</span></div>
                {cudaContainer ? <CudaRuntimePanel onStatus={setCudaStatus} /> : null}
                <Field name="name" data-tour="create-name">
                  <FieldLabel>Name</FieldLabel>
                  <Input disabled={submitting} className="creation-input creation-name" maxLength={80} onChange={event => setName(event.target.value)} placeholder="Ubuntu Development" required type="text" value={name} />
                </Field>
                <Field name="runtime" className="min-w-0" data-tour="create-image">
                <FieldLabel>{kind === "container" ? "OCI image" : kind === "microVm" ? "Direct-kernel microVM source" : "Installer ISO or virtual disk"}</FieldLabel>
                {kind === "container" ? (
                  <div className="flex w-full min-w-0 flex-col gap-2">
                    <OciImagePicker disabled={submitting || guided} onChange={chooseOciImage} value={selectedOciImage} groups={cudaContainer ? gpuImageGroups : undefined} />
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input disabled={submitting} className="creation-input font-mono" onChange={(event) => setRuntime(event.target.value)} placeholder={kind === "microVm" ? "builtin:alpine or a microVM JSON manifest" : "Select an .iso, .qcow2, .vhdx, .vmdk, or .img file"} required type="text" value={runtime} />
                    <Button className="creation-browse" disabled={submitting} onClick={chooseBootMedia} type="button" variant="outline">Browse</Button>
                  </div>
                )}
                <FieldDescription className="creation-help">{cudaContainer ? "Compatible Linux bases, or a custom glibc image. Your AI framework or CUDA toolkit must also support your GPU and driver." : kind === "container" ? `${ociImages.length - 1} curated images from public registries, plus any custom OCI reference.` : kind === "microVm" ? "Use built-in Alpine or a JSON manifest with your kernel, root disk, and boot settings." : "An ISO installs into a new disk using your selected storage capacity. Imported disks keep their size if larger; they are never shrunk."}</FieldDescription>
              </Field>
                {kind === "container" && useCustomImage ? <Field name="custom-runtime" className="-mt-2 min-w-0">
                  <FieldLabel className="sr-only">Custom OCI image reference</FieldLabel>
                  <Input disabled={submitting} className="creation-input font-mono" autoFocus onChange={event => setRuntime(event.target.value)} placeholder="registry.example.com/organization/image:tag" required type="text" value={runtime} />
                </Field> : null}
                {cudaContainer && gpuImageIssue(runtime) ? <p role="alert" className="creation-error">{gpuImageIssue(runtime)}</p> : null}
                {kind === "container" && !cudaContainer && !guided ? <div className="creation-purpose-picker">
                  <span id="creation-purpose-label">What are you building?</span>
                  <div aria-labelledby="creation-purpose-label" role="group" className="creation-purpose-options">
                    {containerPurposes.map(purpose => <button
                      key={purpose.id} type="button" disabled={submitting}
                      aria-pressed={selectedPurpose?.id === purpose.id}
                      className={cn("creation-purpose", selectedPurpose?.id === purpose.id && "is-selected")}
                      onClick={() => { chooseOciImage(containerPurposeImage(purpose)); setSelectedPurpose(purpose) }}
                    >{purpose.label}</button>)}
                  </div>
                  <p className="creation-purpose-help" aria-live="polite">{selectedPurpose
                    ? selectedPurpose.description
                    : "Choose a purpose to select a base image, or search the catalog above."}</p>
                  <p className="creation-purpose-hint">Selects an image and startup command only. Your project and additional tools are up to you.</p>
                </div> : null}
                <div className="creation-startup">
                  {kind === "container" ? <Field name="container-command">
                    <FieldLabel>Startup command (optional)</FieldLabel>
                    <div className="creation-command"><span aria-hidden="true">$</span><Input disabled={submitting || guided} className="creation-input font-mono" onChange={event => setContainerCommand(event.target.value)} placeholder="Use the image’s default startup" type="text" value={containerCommand} /></div>
                    <FieldDescription className="creation-help">Leave blank to run the image’s default service.</FieldDescription>
                  </Field> : null}
                  <Field name="description">
                    <FieldLabel>Description <span className="creation-optional">optional</span></FieldLabel>
                    <Textarea disabled={submitting} className="creation-input creation-description" maxLength={220} onChange={event => setDescription(event.target.value)} placeholder="Add a note about this environment…" value={description} />
                  </Field>
                </div>
              </section>
              <section aria-label="Resource allocation" className="creation-resources">
                <div className="creation-section-heading"><h2><SlidersHorizontalIcon aria-hidden="true" />Resources</h2><span>Drag to allocate</span></div>
                <CreationResourceSliders label="CPU" max={limits.cpu.max} min={limits.cpu.min} onChange={setCpu} step={limits.cpu.step} unit="CPUs" disabled={submitting} value={cpu} />
                <CreationResourceSliders label="Memory" max={limits.memory.max} min={limits.memory.min} onChange={setMemory} step={limits.memory.step} unit="GB" disabled={submitting} value={memory} />
                {cudaContainer ? <p className="creation-resource-note">CUDA storage grows as files are written, limited by free host space and the WSL disk capacity. It is a separate shared pool, not a per-container disk limit.</p> : storageInfo ? <StorageCapacitySlider value={storage} min={storageMinimum} max={storageMaximum} disabled={submitting} shared={kind === "container"} onChange={setStorage} /> : <p role="status" className="creation-resource-note">{storageError || "Loading storage capacity…"}</p>}
                {state?.host.storageDrive ? <p className="creation-resource-note">Stored on {state.host.storageDrive} · Space on other drives is not included. Original installer files are kept when you delete a VM.</p> : null}
                {kind === "container" && !cudaContainer && storageInfo && storage > storageInfo.capacityGb ? <p className="creation-resource-note">Expands storage for every standard container. Stop all running or paused standard containers before creating with this larger capacity.</p> : null}
                {kind === "fullVm" && storage < 64 ? <p className="creation-resource-note">Windows 11 requires a disk of at least 64 GB.</p> : null}
                {policyErrors.length ? <p role="alert" className="creation-error">{policyErrors[0]}</p> : null}
                <div className="creation-priority">
                  <span className="text-sm font-medium">Priority</span>
                  <RadioGroup aria-label="Resource priority" disabled={submitting} className="creation-priorities" onValueChange={value => setPriority(value as Priority)} value={priority}>
                    {priorities.map(item => <Label className={cn("creation-priority-option", priority === item && "is-selected")} key={item}><Radio className="sr-only" disabled={submitting} value={item} />{priorityLabel[item]}</Label>)}
                  </RadioGroup>
                </div>
                <p className="creation-resource-note">Resources adjust automatically between Minimum and Maximum, aiming for Preferred. {kind === "microVm" ? "Memory changes apply on restart." : kind === "container" ? "Slider limits reflect your computer’s CPU and RAM." : "Live memory changes require a guest balloon driver."}</p>
                {kind === "container" ? <p className="creation-resource-note">{cudaContainer ? "Effective limits also depend on WSL resources. GPU memory is shared, not reserved; large models may exceed available memory on smaller GPUs." : "The shared VM reserves space for configured container limits and keeps RAM for your computer. If it needs to grow, stop all containers and retry; their disks are preserved."}</p> : null}
              </section>
            </div>
          </DialogPanel>
          <DialogFooter className="creation-footer">
            {formError ? <p role="alert" className="creation-error">{formError}</p> : null}
            {submitting ? <p role="status" className="creation-resource-note">{kind === "container" ? "Preparing the runtime and image. The first download can take a few minutes." : "Preparing the boot media and virtual disk."}</p> : null}
            <div className="creation-footer-row">
              <div aria-label="Startup summary" className="creation-summary"><KindIcon aria-hidden="true" /><span className="creation-summary-name" title={name.trim() || "Untitled environment"}>{name.trim() || "Untitled environment"}</span><span className="creation-summary-resources">{cpu[1]} CPUs<span aria-hidden="true">/</span>{memory[1]} GB</span></div>
              <div className="creation-actions"><DialogClose render={<Button disabled={submitting} type="button" variant="ghost" />}>Cancel</DialogClose><Button data-tour="create-submit" className="creation-submit" disabled={policyErrors.length > 0 || (cudaContainer && (!cudaStatus?.supported || !cudaStatus.installed || Boolean(cudaStatus.updateAvailable) || Boolean(gpuImageIssue(runtime))))} loading={submitting} type="submit">Create environment<ArrowRightIcon aria-hidden="true" className="size-4" /></Button></div>
            </div>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  )
}
