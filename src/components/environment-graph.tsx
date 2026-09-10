import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection as FlowConnection,
  type Edge,
  type BuiltInEdge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { GripVerticalIcon, LinkIcon, MaximizeIcon, MinusIcon, PauseIcon, PlusIcon, Settings2Icon, SquareIcon, XIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, type PointerEvent } from "react"
import { createPortal } from "react-dom"
import { allCapabilities, capabilityDefinitions, pcDefinition, capabilityEnabled, capabilityIssue, sameEndpoint, serviceId, type GraphEnvironment, type CapabilityEndpoint, type CapabilityKind } from "@/components/graph-capabilities"
import { useCapabilityConnections } from "@/components/use-capability-connections"
import { useWorkspaceFeatures } from "@/components/use-workspace-features"
import { GraphWorkspaceDialogs } from "@/components/graph-workspace-dialogs"
import { FixedWorkspaceControl } from "@/components/graph-workspace-controls"
import { Status } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { usePlatform } from "@/context/platform-context"
import { formatBytesFromGb } from "@/lib/domain"
import { environmentLabel } from "@/lib/environment-category"
import { environmentActionLabel } from "@/lib/environment-actions"
import { graphColors } from "@/lib/graph-colors"
import { supportsConnections } from "@/lib/environment-connections"
import { useInstructionsTour } from "@/lib/instructions-tour"
import { tourPreviewEnvironment } from "@/lib/tour-preview"
import type { Environment } from "@/types/platform"
import "@/components/dashboard-actions.css"

interface EnvironmentNodeData extends Record<string, unknown> {
  preview?: boolean
  accent: string
  active: CapabilityEndpoint | null
  hovered: CapabilityEndpoint | null
  pending: boolean
  environment: GraphEnvironment
  onEndpointClick(endpoint: CapabilityEndpoint): void
  onEndpointPointerDown(event: PointerEvent<HTMLElement>, endpoint: CapabilityEndpoint): void
  onCapabilityChange(environmentId: string, capability: CapabilityKind, enabled: boolean): void
  onConnect(environmentId: string): void
  onOpen(environmentId: string): void
  onSelect(environmentId: string): void
  onService(environmentId: string, port: number): void
  onShares(environmentId: string): void
}

type EnvironmentNode = Node<EnvironmentNodeData, "environment">

const environmentSourceHandle = "environment-source"
const environmentTargetHandle = "environment-target"
const networkHandleClass = "!size-4 !border-[3px] !border-background !bg-[var(--node-accent)] after:absolute after:-inset-3 after:rounded-full hover:!bg-primary focus-visible:!bg-primary"

function NodeAction({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  )
}

function EnvironmentGraphNode({ data, selected }: NodeProps<EnvironmentNode>) {
  const { setEnvironmentStatus, environmentActions } = usePlatform()
  const { environment } = data
  const action = environmentActions[environment.id]
  const busy = Boolean(action) || environment.status === "provisioning"
  const opening = action === "starting" || action === "opening" || action === "connecting"
  const cloud = environment.kind === "cloud"
  const creating = environment.status === "provisioning"
  const isNativeApplication = environment.provider === "nativeSandbox" || environment.kind === "computerBranch"
  const canConnect = supportsConnections(environment)
  const canPause = !cloud && environment.status === "running" && environment.provider !== "nativeSandbox" && environment.kind !== "computerBranch"
  const endpoint: CapabilityEndpoint = { kind: "environment", id: environment.id }
  const issue = data.active?.kind === "capability" ? capabilityIssue(environment, data.active.id) : null
  const eligible = data.active?.kind === "capability" && !issue && !data.pending
  const highlighted = sameEndpoint(data.active, endpoint) || (eligible && sameEndpoint(data.hovered, endpoint))
  const enabledCapabilities = allCapabilities.filter(({ capability }) => capabilityEnabled(environment, capability))

  return (
    <article
      data-environment-id={environment.id}
      data-tour-preview={data.preview || undefined}
      onClickCapture={data.preview ? event => { event.preventDefault(); event.stopPropagation() } : undefined}
      onPointerDownCapture={data.preview ? event => { event.preventDefault(); event.stopPropagation() } : undefined}
      data-environment-color={data.accent}
      style={{ "--node-accent": data.accent } as React.CSSProperties}
      data-selected={selected || highlighted || undefined}
      aria-busy={data.pending || busy}
      data-connection-eligible={data.active?.kind === "capability" ? eligible : undefined}
      title={issue ?? undefined}
      className={`workspace-node relative w-72 rounded-lg border bg-background shadow-sm/5 transition-colors ${highlighted ? "border-primary ring-2 ring-primary/30" : eligible || selected ? "border-primary/70 ring-2 ring-primary/10" : "border-border"}`}
    >
      {canConnect ? <Handle aria-label={`Connect another environment to ${environment.name}`} className={networkHandleClass} id={environmentTargetHandle} position={Position.Left} type="target" isConnectable={!data.preview && !data.active} /> : null}
      {!cloud && environment.workspace?.services.length ? <div aria-label={`Services in ${environment.name}`} className="nodrag flex flex-wrap gap-x-3 gap-y-4 border-b px-3 pb-2 pt-3">
        {environment.workspace.services.map(service => {
          const endpoint: CapabilityEndpoint = { kind: "service", id: serviceId(environment.id, service.port) }
          const publications = environment.workspace!.publications.filter(p => p.port === service.port)
          const highlighted = sameEndpoint(data.active, endpoint) || sameEndpoint(data.hovered, endpoint)
          return <div className="relative min-w-14" data-service-card={endpoint.id} key={service.port}>
            <Button aria-label={`Port ${service.port} in ${environment.name}`} className={`h-6! w-full text-[10px]! ${highlighted ? "ring-2 ring-primary" : ""}`} onClick={() => data.onService(environment.id, service.port)} size="xs" title={`${service.name} · ${service.protocol.toUpperCase()} ${service.port}`} variant="outline">:{service.port}</Button>
            <Button aria-label={`Connect port ${service.port} in ${environment.name}`} aria-pressed={sameEndpoint(data.active, endpoint)} className="absolute! -top-3 left-1/2 z-30 size-11! touch-none rounded-full! p-0! hover:bg-transparent" data-service-connection-point={endpoint.id} data-connection-side="top" onClick={() => data.onEndpointClick(endpoint)} onPointerDown={event => data.onEndpointPointerDown(event, endpoint)} style={{ transform: "translate(-50%, -50%) scale(var(--connector-scale, 1))" }} variant="ghost"><span aria-hidden="true" style={{ backgroundColor: data.accent }} className="pointer-events-none size-3 rounded-full border-[3px] border-background bg-primary shadow-[0_0_0_1px_var(--node-accent)]" /></Button>
            {publications.length ? <button aria-label={`Published destinations for port ${service.port}`} className="mt-0.5 block w-full text-center text-[8px] leading-3 text-primary" onClick={() => data.onService(environment.id, service.port)} title={publications.map(p => `${p.kind}: ${p.urls.join(", ")}`).join("\n")} type="button">{publications.map(p => p.kind === "cloudflare" ? "CF" : p.kind === "local" ? "LAN" : "Public").join(" · ")}</button> : null}
          </div>
        })}
      </div> : null}
      <div className="p-3">
        <div className="flex items-start gap-2">
          <span className="cursor-grab pt-0.5 text-muted-foreground active:cursor-grabbing" title="Move environment" data-node-drag-grip><GripVerticalIcon aria-hidden="true" className="size-4" /></span>
          <button
            className="nodrag block min-w-0 flex-1 text-left outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => data.onSelect(environment.id)}
            type="button"
          >
            <span className="flex items-center justify-between gap-3">
              <span className="truncate text-sm font-medium">{environment.name}</span>
              {action ? <span className="shrink-0 text-[10px] text-muted-foreground" role="status">{environmentActionLabel[action]}</span> : cloud ? <span className="text-[10px] text-muted-foreground">{environment.status === "running" ? "Connected" : environment.status === "error" ? "Unable to connect" : "Disconnected"}</span> : <Status compact status={environment.status} />}
            </span>
            <span className="mt-1 block truncate text-[11px] text-muted-foreground">{data.preview ? "Preview only · no resources used" : environmentLabel(environment)}</span>
          </button>
        </div>
        {enabledCapabilities.length ? (
          <div aria-label="Attached capabilities" className="nodrag mt-2 flex min-w-0 flex-nowrap gap-1">
            {enabledCapabilities.map(({ capability, title }) => (
              <button
                aria-label={`Detach ${title} from ${environment.name}`}
                className="inline-flex h-5 min-w-0 flex-1 items-center justify-center gap-1 rounded border bg-muted/50 px-1 text-[9px] text-muted-foreground outline-none hover:border-destructive/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                disabled={data.pending}
                key={capability}
                onClick={() => capability === "pc" ? data.onShares(environment.id) : data.onCapabilityChange(environment.id, capability, false)}
                title={capability === "pc" ? "Manage shared folders" : `Click to detach ${title}`}
                type="button"
              >
                <span className="truncate">{capability === "internet" ? "Internet" : "My PC"}</span>
                {capability !== "pc" ? <XIcon aria-hidden="true" className="size-2.5 shrink-0" /> : null}
              </button>
            ))}
          </div>
        ) : null}
        {cloud ? <p className="mt-3 truncate border-t pt-2 text-[11px] text-muted-foreground" title={environment.runtime}>{environment.runtime}</p> : <dl className="mt-3 grid grid-cols-3 gap-3 border-t pt-2 text-[10px] tabular-nums text-muted-foreground">
          <div><dt>CPU</dt><dd className="mt-1 text-xs text-foreground">{Math.round(environment.cpuUsage)}%</dd></div>
          <div><dt>Memory</dt><dd className="mt-1 text-xs text-foreground">{environment.memoryUsageGb.toFixed(1)} GB</dd></div>
          <div><dt>Storage</dt><dd className="mt-1 text-xs text-foreground">+{formatBytesFromGb(environment.storageDeltaGb)}</dd></div>
        </dl>}
        {environment.status === "error" && environment.lastError ? <p className="mt-2 line-clamp-2 text-[11px] text-destructive-foreground" title={environment.lastError}>{environment.lastError}</p> : null}
      </div>
      <div className="nodrag flex items-center gap-1 border-t px-3 py-2 [&_button]:z-40">
        <NodeAction label={canConnect ? `Connect ${environment.name}` : "Connections support containers, MicroVMs and VMs"}>
          <Button data-tour="node-connect" aria-label={`Connect ${environment.name}`} disabled={!canConnect} onClick={() => data.onConnect(environment.id)} size="icon-xs" type="button" variant="ghost"><LinkIcon aria-hidden="true" /></Button>
        </NodeAction>
        {!isNativeApplication && !cloud ? <NodeAction label={environment.workspace?.notice || "Add a service port. Listening ports also appear automatically."}><Button data-tour="node-port" aria-label={`Add service port to ${environment.name}`} className="px-1.5 text-[10px]! tracking-wide" onClick={() => data.onService(environment.id, 0)} size="xs" variant="ghost">PORT</Button></NodeAction> : null}
        <NodeAction label={`Configure ${environment.name}`}>
          <Button data-tour="node-configure" aria-label={`Configure ${environment.name}`} onClick={() => data.onSelect(environment.id)} size="icon-xs" type="button" variant="ghost"><Settings2Icon aria-hidden="true" /></Button>
        </NodeAction>
        {canPause ? (
          <NodeAction label={`Pause ${environment.name}`}>
            <Button aria-label={`Pause ${environment.name}`} disabled={busy} loading={action === "pausing"} onClick={() => void setEnvironmentStatus(environment.id, "paused").catch(() => undefined)} size="icon-xs" type="button" variant="ghost"><PauseIcon aria-hidden="true" /></Button>
          </NodeAction>
        ) : null}
        {cloud && environment.status === "running" ? <Button disabled={busy} loading={action === "disconnecting"} onClick={() => void setEnvironmentStatus(environment.id, "stopped").catch(() => undefined)} size="xs" variant="ghost">Disconnect</Button> : null}
        {!cloud && (environment.status !== "stopped" || environment.provider === "qemu") ? (
          <NodeAction label={`Shut down ${environment.name}`}>
            <Button aria-label={`Shut down ${environment.name}`} disabled={busy} loading={action === "stopping"} onClick={() => void setEnvironmentStatus(environment.id, "stopped").catch(() => undefined)} size="icon-xs" type="button" variant="ghost"><SquareIcon aria-hidden="true" /></Button>
          </NodeAction>
        ) : null}
        <Button data-tour="node-launch" className="node-launch ml-auto" data-running={environment.status === "running" ? "true" : undefined} aria-busy={creating || opening || undefined} disabled={isNativeApplication || busy} loading={opening} title={creating ? "Creating this environment. You can keep using Yougori." : opening ? environmentActionLabel[action] : undefined} onClick={() => data.onOpen(environment.id)} size="xs" type="button" variant={environment.status === "running" ? "outline" : "default"}>
          {creating ? <><Spinner aria-hidden="true" />Creating…</> : isNativeApplication ? "Unavailable" : environment.status === "running" ? "Open" : cloud ? "Connect" : "Start"}
        </Button>
      </div>
      {canConnect ? <Handle aria-label={`Connect ${environment.name} to another environment`} className={networkHandleClass} id={environmentSourceHandle} position={Position.Right} type="source" isConnectable={!data.preview && !data.active} /> : null}
      {!cloud ? <Button
        aria-label={`Connect capabilities to ${environment.name}`}
        aria-pressed={sameEndpoint(data.active, endpoint)}
        className="nodrag nopan absolute! -bottom-px left-1/2 z-30 size-11! touch-none rounded-full! p-0! hover:bg-transparent"
        data-environment-connection-point={environment.id}
        loading={data.pending}
        onClick={() => data.onEndpointClick(endpoint)}
        onPointerDown={event => data.onEndpointPointerDown(event, endpoint)}
        style={{ transform: "translate(-50%, 50%) scale(var(--connector-scale, 1))" }}
        title={issue ?? "Drag to a capability, or click to connect"}
        type="button"
        variant="ghost"
      >
        <span aria-hidden="true" style={{ backgroundColor: data.accent }} className={`pointer-events-none size-4 rounded-full border-[3px] border-background bg-primary shadow-[0_0_0_1px_var(--node-accent)] ${data.pending ? "invisible" : highlighted ? "ring-4 ring-primary/20" : ""}`} />
      </Button> : null}
    </article>
  )
}

const nodeTypes = { environment: EnvironmentGraphNode }

export function EnvironmentGraph({ environments, connections, errorContainer, onConnect, onOpen, onSelect }: {
  errorContainer: HTMLElement | null
  environments: Environment[]
  connections: Array<{ id: string; sourceId: string; targetId: string; direction: "oneWay" | "bidirectional"; active: boolean; enforcementStatus?: "enforced" | "pending" | "error" }>
  onConnect(sourceId: string, targetId?: string): void
  onOpen(environmentId: string): void
  onSelect(environmentId: string): void
}) {
  const { updateContainerNetwork } = usePlatform()
  const tour = useInstructionsTour()
  const preview = useMemo(() => tourPreviewEnvironment(tour), [tour])
  const graphContainerRef = useRef<HTMLDivElement>(null)
  const flowRef = useRef<ReactFlowInstance<EnvironmentNode, BuiltInEdge> | null>(null)
  const workspace = useWorkspaceFeatures(environments)
  const { decorated, openShares, openService, connectPublication } = workspace
  const colors = useMemo(() => graphColors(environments.map(environment => environment.id)), [environments])

  const setCapability = useCallback(async (environmentId: string, capability: CapabilityKind, enabled: boolean) => {
    const environment = environments.find((item) => item.id === environmentId)
    if (!environment) throw new Error("Environment not found")
    if (capability === "pc") { openShares(environmentId); return }
    if (capability === "internet") return updateContainerNetwork(environmentId, enabled)
  }, [environments, openShares, updateContainerNetwork])

  const wiring = useCapabilityConnections(graphContainerRef, decorated, setCapability, connectPublication)
  const { active, hovered, pending, change, clickEndpoint, pointerDown, scheduleGeometry } = wiring

  const initialNodes = useMemo<EnvironmentNode[]>(() => [...(preview ? [preview] : []), ...decorated].map((environment, index): EnvironmentNode => ({
      id: environment.id,
      type: "environment",
      draggable: environment === preview ? false : undefined,
      selectable: environment === preview ? false : undefined,
      connectable: environment === preview ? false : undefined,
      position: { x: 70 + (index % 3) * 360, y: 65 + Math.floor(index / 3) * 310 },
      data: { preview: environment === preview, accent: colors[environment.id] ?? "#7194c2", active, hovered, pending: pending.has(environment.id), environment, onCapabilityChange: change, onEndpointClick: clickEndpoint, onEndpointPointerDown: pointerDown, onConnect, onOpen, onSelect, onService: openService, onShares: openShares },
    })), [preview, colors, active, hovered, pending, change, clickEndpoint, pointerDown, decorated, onConnect, onOpen, onSelect, openService, openShares])
  const initialEdges = useMemo<BuiltInEdge[]>(() => connections.map((connection, index): BuiltInEdge => ({
      id: connection.id,
      type: "smoothstep",
      pathOptions: { borderRadius: 14, offset: 24 + index * 8, stepPosition: 0.35 + index / Math.max(1, connections.length) * 0.3 },
      source: connection.sourceId,
      sourceHandle: environmentSourceHandle,
      target: connection.targetId,
      targetHandle: environmentTargetHandle,
      deletable: false,
      label: connection.active && connection.enforcementStatus === "error" ? "Needs attention" : connection.active && connection.enforcementStatus === "pending" ? "Pending" : undefined,
      labelStyle: { fill: "var(--muted-foreground)", fontSize: 11 },
      labelBgStyle: { fill: "var(--background)" },
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: colors[connection.sourceId] },
      markerStart: connection.direction === "bidirectional" ? { type: MarkerType.ArrowClosed, width: 14, height: 14, color: colors[connection.sourceId] } : undefined,
      style: { stroke: colors[connection.sourceId], strokeWidth: connection.active ? 1.8 : 1.4, opacity: connection.active ? 0.9 : 0.4, strokeDasharray: connection.active && (!connection.enforcementStatus || connection.enforcementStatus === "enforced") ? undefined : "5 4" },
    })), [colors, connections])
  const [nodes, setNodes, onNodesChange] = useNodesState<EnvironmentNode>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const knownNodesRef = useRef(new Set(initialNodes.map(node => node.id)))
  const fitNewNodesRef = useRef(false)

  useEffect(() => {
    if (initialNodes.some(node => !knownNodesRef.current.has(node.id))) fitNewNodesRef.current = true
    knownNodesRef.current = new Set(initialNodes.map(node => node.id))
    setNodes((current) => {
      const previous = new Map(current.map(node => [node.id, node]))
      return initialNodes.map(node => {
        const existing = previous.get(node.id)
        // Preserve selection, drag state and measurements when telemetry updates.
        if (existing) return { ...existing, data: node.data }
        let position = node.position
        while (current.some(item => Math.abs(item.position.x - position.x) < 310 && Math.abs(item.position.y - position.y) < 280)) {
          position = { ...position, y: position.y + 310 }
        }
        return { ...node, position }
      })
    })
  }, [initialNodes, setNodes])
  useEffect(() => setEdges(initialEdges), [initialEdges, setEdges])
  useEffect(() => {
    if (fitNewNodesRef.current && flowRef.current && nodes.length && nodes.every(node => node.measured?.width && node.measured?.height)) {
      fitNewNodesRef.current = false
      void flowRef.current.fitView({ padding: 0.25, maxZoom: 1, nodes: preview ? [{ id: preview.id }] : undefined })
    }
    scheduleGeometry()
  }, [nodes, preview, scheduleGeometry])

  const validConnection = useCallback((connection: FlowConnection | Edge) => {
    const environment = environments.find((item) => item.id === connection.target)
    return connection.sourceHandle === environmentSourceHandle
      && connection.targetHandle === environmentTargetHandle
      && connection.source !== connection.target
      && environments.some((item) => item.id === connection.source && supportsConnections(item))
      && Boolean(environment && supportsConnections(environment))
  }, [environments])

  const connect = useCallback((connection: FlowConnection) => {
    if (!connection.source || !connection.target || !validConnection(connection)) return
    onConnect(connection.source, connection.target)
  }, [onConnect, validConnection])

  return (
    <TooltipProvider>
      {wiring.feedback && errorContainer ? createPortal(
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-background px-2 py-0.5 text-xs text-destructive-foreground" role="alert">
          <p className="min-w-0 flex-1 truncate" title={wiring.feedback}>{wiring.feedback}</p>
          <Button aria-label="Dismiss graph error" onClick={wiring.dismissFeedback} size="icon-xs" type="button" variant="ghost"><XIcon aria-hidden="true" /></Button>
        </div>, errorContainer,
      ) : null}
      <div
        className="workspace-graph relative isolate w-full overflow-hidden rounded-lg border bg-background"
        data-environment-graph
        data-connecting={Boolean(active)}
        onClickCapture={event => {
          if (wiring.consumeClick()) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
          if (active?.kind === "publication") {
            const service = (event.target as HTMLElement).closest<HTMLElement>("[data-service-card]")
            if (service) { event.preventDefault(); event.stopPropagation(); clickEndpoint({ kind: "service", id: service.dataset.serviceCard! }) }
            return
          }
          if (active?.kind !== "capability") return
          const node = (event.target as HTMLElement).closest<HTMLElement>("[data-environment-id]")
          if (!node) return
          event.preventDefault()
          event.stopPropagation()
          clickEndpoint({ kind: "environment", id: node.dataset.environmentId! })
        }}
        onPointerCancel={wiring.cancel}
        onLostPointerCapture={event => { if (event.buttons) wiring.cancel() }}
        onPointerMove={wiring.pointerMove}
        onPointerUp={wiring.pointerUp}
        ref={graphContainerRef}
      >
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 size-full" data-capability-lines>
          {wiring.lines.map(line => (
            <g key={line.id}>
              <path d={line.path} fill="none" stroke="var(--background)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6" />
              <path d={line.path} data-capability-line={line.id} fill="none" stroke={colors[line.environmentId]} strokeOpacity="0.85" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </g>
          ))}
          {wiring.preview ? <path d={wiring.preview} data-connection-preview fill="none" stroke="var(--primary)" strokeDasharray="6 4" strokeLinecap="round" strokeWidth="2.5" /> : null}
        </svg>
        <section aria-label="Service destinations" className="relative z-10 flex justify-center gap-5 border-b px-3 pb-6 pt-3">
          <FixedWorkspaceControl kind="local" side="bottom" wiring={wiring} environments={decorated} />
          <FixedWorkspaceControl kind="public" side="bottom" wiring={wiring} environments={decorated} />
        </section>
        <div
          className="relative z-10 h-[clamp(460px,calc(100dvh-400px),1200px)]"
          data-environment-canvas
        >
          <ReactFlow
            connectionLineType={ConnectionLineType.SmoothStep}
            connectionRadius={32}
            edges={edges}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
            maxZoom={1.5}
            minZoom={0.3}
            nodeDragThreshold={6}
            nodesDraggable={!active}
            nodes={nodes}
            nodeTypes={nodeTypes}
            onConnect={connect}
            onEdgesChange={onEdgesChange}
            onInit={instance => { flowRef.current = instance; graphContainerRef.current?.style.setProperty("--connector-scale", String(1 / instance.getZoom())); scheduleGeometry() }}
            onMove={(_, viewport) => { graphContainerRef.current?.style.setProperty("--connector-scale", String(1 / viewport.zoom)); scheduleGeometry() }}
            onNodesChange={onNodesChange}
            onPaneClick={wiring.cancel}
            panOnDrag={!active}
            zoomOnDoubleClick={false}
            isValidConnection={validConnection}
            proOptions={{ hideAttribution: true }}
            style={{ height: "100%", width: "100%" }}
          >
            <Background color="var(--graph-dot)" gap={24} size={1.5} variant={BackgroundVariant.Dots} />
          </ReactFlow>
          <div className="absolute right-3 top-3 z-20 flex gap-1 rounded-lg border bg-background p-1 shadow-xs">
            {active ? <Button aria-label="Cancel connection" onClick={wiring.cancel} size="icon-sm" title="Cancel connection (Esc)" variant="ghost"><XIcon aria-hidden="true" /></Button> : null}
            <Button aria-label="Zoom out" onClick={() => void flowRef.current?.zoomOut()} size="icon-sm" title="Zoom out" variant="ghost"><MinusIcon aria-hidden="true" /></Button>
            <Button aria-label="Zoom in" onClick={() => void flowRef.current?.zoomIn()} size="icon-sm" title="Zoom in" variant="ghost"><PlusIcon aria-hidden="true" /></Button>
            <Button aria-label="Fit environments" onClick={() => void flowRef.current?.fitView({ padding: 0.25, maxZoom: 1 })} size="icon-sm" title="Fit environments" variant="ghost"><MaximizeIcon aria-hidden="true" /></Button>
          </div>
          <span className="sr-only" aria-live="polite">{active ? active.kind === "capability" ? "Choose an environment. Press Escape to cancel." : "Choose a capability below. Press Escape to cancel." : ""}</span>
          {!environments.length && !preview ? <div className="workspace-empty pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center"><p className="text-base font-medium">Your workspace starts here</p><p className="max-w-sm text-sm leading-6 text-muted-foreground">Choose New environment above to create a container, VM or MicroVM.</p><p className="mt-2 text-xs text-muted-foreground">Then connect its files, network and service ports here.</p></div> : null}
        </div>
        <section aria-label="Environment capabilities" className="relative z-10 border-t px-3 pb-3 pt-7">
          <div className="mx-auto grid w-full max-w-lg grid-cols-2 gap-3 sm:gap-5">
            {[pcDefinition, ...capabilityDefinitions].map(({ capability, icon: Icon, title }) => {
              const connectedCount = decorated.filter((environment) => capabilityEnabled(environment, capability)).length
              const endpoint: CapabilityEndpoint = { kind: "capability", id: capability }
              const armed = sameEndpoint(active, endpoint)
              const selectedEnvironment = active?.kind === "environment" ? environments.find(item => item.id === active.id) : null
              const issue = selectedEnvironment ? capabilityIssue(selectedEnvironment, capability) : null
              const eligible = Boolean(selectedEnvironment && !issue && !pending.has(selectedEnvironment.id))
              const highlighted = armed || (eligible && sameEndpoint(hovered, endpoint))
              return (
                <div className="relative min-w-0" data-capability-card={capability} data-connection-eligible={selectedEnvironment ? eligible : undefined} key={capability}>
                <Button
                  aria-label={title}
                  aria-pressed={armed}
                  className={`h-auto! min-h-16 w-full touch-none flex-col gap-1.5 whitespace-normal px-2 pb-2 pt-3 text-center sm:min-h-14 sm:flex-row sm:justify-start sm:gap-2 sm:px-3 sm:py-3 ${highlighted ? "border-primary! ring-2 ring-primary/20" : eligible ? "border-primary/60" : ""}`}
                  data-capability-kind={capability}
                  onClick={() => clickEndpoint(endpoint)}
                  onPointerDown={event => pointerDown(event, endpoint)}
                  title={issue ?? `Connect ${title}`}
                  type="button"
                  variant={armed ? "secondary" : "outline"}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 text-[11px] leading-4 sm:flex-1 sm:text-left sm:text-xs">{title}</span>
                  <span aria-label={`${connectedCount} connected`} className="hidden shrink-0 rounded bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground sm:block">{connectedCount}</span>
                </Button>
                <Button
                  aria-label={`Connect ${title}`}
                  aria-pressed={armed}
                  className="absolute! -top-px left-1/2 z-30 size-11! -translate-x-1/2 -translate-y-1/2 touch-none rounded-full! p-0! hover:bg-transparent"
                  data-capability-connection-point={capability}
                  data-connection-side="top"
                  onClick={() => clickEndpoint(endpoint)}
                  onPointerDown={event => pointerDown(event, endpoint)}
                  title={issue ?? "Drag to an environment, or click to connect"}
                  type="button"
                  variant="ghost"
                >
                  <span aria-hidden="true" className={`pointer-events-none size-4 rounded-full border-[3px] border-background bg-primary shadow-[0_0_0_1px_var(--primary)] ${highlighted ? "ring-4 ring-primary/20" : ""}`} />
                </Button>
                </div>
              )
            })}
          </div>
        </section>

        <div className="workspace-graph-caption flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-[11px] text-muted-foreground">
          <span>{environments.length} {environments.length === 1 ? "environment" : "environments"} · {connections.length} {connections.length === 1 ? "connection" : "connections"}</span>
          <span>Drag to arrange · Select a node to configure · Connect using the dots</span>
        </div>
      </div>
      <GraphWorkspaceDialogs model={workspace} />
    </TooltipProvider>
  )
}
