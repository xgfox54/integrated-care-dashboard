"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { routeProcessEdges } from "@/lib/welfare100/edge-router.mjs";
import { splitStageName } from "@/lib/welfare100/stage-name.mjs";
import type { ProcessEdge, ProcessModel, ProcessNode } from "@/lib/welfare100/types";

type EdgeKind = "sequence" | "message" | "loop";

interface EdgePath {
  edge: ProcessEdge;
  path: string;
}

interface EdgeOverlay {
  width: number;
  height: number;
  paths: EdgePath[];
}

interface NodeRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

const STATUS_META = {
  done: { label: "선행" },
  current: { label: "설명 기준" },
  waiting: { label: "후속" },
  risk: { label: "유의" },
  loop: { label: "재검토" },
} as const;

const EDGE_COLOR: Record<EdgeKind, string> = {
  sequence: "var(--jeju-border-strong)",
  message: "var(--jeju-text-faint)",
  loop: "var(--jeju-orange)",
};

export default function DesktopProcessBoard({
  process,
  compact,
  selectedNodeId,
  onNodeChange,
}: {
  process: ProcessModel;
  compact: boolean;
  selectedNodeId: string;
  onNodeChange: (nodeId: string) => void;
}) {
  const stages = useMemo(
    () => process.stages.map((stage) => splitStageName(stage)),
    [process.stages],
  );
  const loopLabels = useMemo(() => {
    const labels = new Map<string, string>();
    process.edges
      .filter((edge) => edge.type === "loop")
      .forEach((edge) => {
        labels.set(
          edge.source,
          `${edge.label ? `${edge.label} · ` : ""}${edge.target}로`,
        );
      });
    return labels;
  }, [process.edges]);

  if (compact) {
    return (
      <CoreProcessFlow
        process={process}
        selectedNodeId={selectedNodeId}
        loopLabels={loopLabels}
        onNodeChange={onNodeChange}
      />
    );
  }

  return (
    <FullProcessGrid
      process={process}
      stages={stages}
      selectedNodeId={selectedNodeId}
      loopLabels={loopLabels}
      onNodeChange={onNodeChange}
    />
  );
}

function FullProcessGrid({
  process,
  stages,
  selectedNodeId,
  loopLabels,
  onNodeChange,
}: {
  process: ProcessModel;
  stages: ReturnType<typeof splitStageName>[];
  selectedNodeId: string;
  loopLabels: Map<string, string>;
  onNodeChange: (nodeId: string) => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const overlaySignature = useRef("");
  const [overlay, setOverlay] = useState<EdgeOverlay>({
    width: 0,
    height: 0,
    paths: [],
  });
  const markerPrefix = `desktop-process-${useId().replaceAll(":", "")}`;

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    let active = true;
    let frame = 0;

    const measure = () => {
      if (!active) return;
      const next = measureEdges(
        board,
        process.nodes,
        process.edges,
        nodeRefs.current,
      );
      const signature = JSON.stringify(next);
      if (signature !== overlaySignature.current) {
        overlaySignature.current = signature;
        setOverlay(next);
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(board);
    nodeRefs.current.forEach((node) => observer.observe(node));
    window.addEventListener("resize", schedule);
    void document.fonts.ready.then(schedule);
    schedule();

    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [process.edges, process.nodes]);

  const sortedPaths = [...overlay.paths].sort(
    (left, right) =>
      Number(isSelectedEdge(left.edge, selectedNodeId)) -
      Number(isSelectedEdge(right.edge, selectedNodeId)),
  );
  const minWidth = 128 + stages.length * 135;

  return (
    <div
      className="desktop-process-v2-scroll"
      role="region"
      aria-label="업무구조도 스윔레인 탐색 영역"
      tabIndex={0}
    >
      <div
        ref={boardRef}
        className="desktop-process-v2-grid"
        style={{
          gridTemplateColumns: `128px repeat(${stages.length}, minmax(135px, 1fr))`,
          minWidth,
        }}
      >
        {overlay.width > 0 && (
          <svg
            className="desktop-process-v2-edges"
            width={overlay.width}
            height={overlay.height}
            aria-hidden="true"
          >
            <defs>
              <ArrowMarker id={`${markerPrefix}-sequence`} color={EDGE_COLOR.sequence} />
              <ArrowMarker id={`${markerPrefix}-message`} color={EDGE_COLOR.message} />
              <ArrowMarker id={`${markerPrefix}-loop`} color={EDGE_COLOR.loop} />
              <ArrowMarker id={`${markerPrefix}-selected`} color="var(--jeju-primary)" />
              <ArrowMarker id={`${markerPrefix}-selected-loop`} color="var(--jeju-warning)" />
            </defs>
            {sortedPaths.map(({ edge, path }) => {
              const selected = isSelectedEdge(edge, selectedNodeId);
              const color = selected
                ? edge.type === "loop"
                  ? "var(--jeju-warning)"
                  : "var(--jeju-primary)"
                : EDGE_COLOR[edge.type];
              const marker = selected
                ? edge.type === "loop"
                  ? `${markerPrefix}-selected-loop`
                  : `${markerPrefix}-selected`
                : `${markerPrefix}-${edge.type}`;
              const strokeWidth = selected ? 1.8 : 1.15;
              const strokeDasharray =
                edge.type === "loop"
                  ? "5 4"
                  : edge.type === "message"
                    ? "2 4"
                    : undefined;
              return (
                <g
                  key={edge.id}
                  data-source={edge.source}
                  data-target={edge.target}
                  opacity={selected ? 1 : 0.9}
                >
                  <path
                    d={path}
                    fill="none"
                    stroke="var(--jeju-surface)"
                    strokeWidth={strokeWidth + 2.8}
                    strokeDasharray={strokeDasharray}
                  />
                  <path
                    d={path}
                    fill="none"
                    stroke={color}
                    strokeWidth={strokeWidth}
                    strokeDasharray={strokeDasharray}
                    markerEnd={`url(#${marker})`}
                  />
                </g>
              );
            })}
          </svg>
        )}

        <div className="desktop-process-v2-corner">
          레인 <span aria-hidden="true">＼</span> 게이트
        </div>
        {stages.map((stage, stageIndex) => (
          <div
            key={stage.full}
            className="desktop-process-v2-stage"
            style={{ gridColumn: stageIndex + 2, gridRow: 1 }}
          >
            {stage.code ? <span>{stage.code}</span> : null}
            <strong>{stage.label}</strong>
          </div>
        ))}

        {process.lanes.flatMap((lane, laneIndex) => {
          const row = laneIndex + 2;
          return [
            <div
              key={`lane-${lane}`}
              className="desktop-process-v2-lane"
              style={{ gridColumn: 1, gridRow: row }}
            >
              {lane}
            </div>,
            ...stages.map((stage, stageIndex) => {
              const nodes = process.nodes.filter(
                (node) => node.lane === lane && node.stage === stage.full,
              );
              return (
                <div
                  key={`${lane}-${stage.full}`}
                  className="desktop-process-v2-cell"
                  data-even={laneIndex % 2 === 0 ? "true" : undefined}
                  style={{ gridColumn: stageIndex + 2, gridRow: row }}
                >
                  {nodes.map((node) => (
                    <ProcessGridCard
                      key={node.id}
                      node={node}
                      loopLabel={loopLabels.get(node.id)}
                      selected={selectedNodeId === node.id}
                      onClick={() => onNodeChange(node.id)}
                      setRef={(element) => {
                        if (element) nodeRefs.current.set(node.id, element);
                        else nodeRefs.current.delete(node.id);
                      }}
                    />
                  ))}
                </div>
              );
            }),
          ];
        })}
      </div>
    </div>
  );
}

function CoreProcessFlow({
  process,
  selectedNodeId,
  loopLabels,
  onNodeChange,
}: {
  process: ProcessModel;
  selectedNodeId: string;
  loopLabels: Map<string, string>;
  onNodeChange: (nodeId: string) => void;
}) {
  const stages = process.stages
    .map((stage) => ({ ...splitStageName(stage), nodes: process.nodes.filter((node) => node.stage === stage) }))
    .filter((stage) => stage.nodes.length > 0);

  return (
    <div className="desktop-process-v2-core" aria-label="핵심 업무 흐름">
      {stages.map((stage) => (
        <section key={stage.full}>
          <header>
            {stage.code ? <span>{stage.code}</span> : null}
            <strong>{stage.label}</strong>
          </header>
          <div>
            {stage.nodes.map((node, index) => (
              <div className="desktop-process-v2-core-step" key={node.id}>
                <ProcessGridCard
                  node={node}
                  loopLabel={loopLabels.get(node.id)}
                  selected={selectedNodeId === node.id}
                  onClick={() => onNodeChange(node.id)}
                />
                {index < stage.nodes.length - 1 && <span aria-hidden="true">→</span>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ProcessGridCard({
  node,
  loopLabel,
  selected,
  onClick,
  setRef,
}: {
  node: ProcessNode;
  loopLabel?: string;
  selected: boolean;
  onClick: () => void;
  setRef?: (element: HTMLButtonElement | null) => void;
}) {
  const status = STATUS_META[node.status];
  return (
    <button
      ref={setRef}
      type="button"
      className="desktop-process-v2-card"
      data-node-id={node.id}
      data-status={node.status}
      aria-pressed={selected}
      aria-label={`${node.name} — ${status.label}`}
      onClick={onClick}
    >
      <span className="desktop-process-v2-card-meta">
        <b>{node.id}</b>
        <i>{status.label}</i>
      </span>
      <strong>{node.name}</strong>
      {loopLabel && <small>↩ {loopLabel}</small>}
    </button>
  );
}

function ArrowMarker({ id, color }: { id: string; color: string }) {
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX="8.5"
      refY="5"
      markerWidth="8"
      markerHeight="8"
      markerUnits="userSpaceOnUse"
      orient="auto-start-reverse"
    >
      <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
    </marker>
  );
}

function measureEdges(
  board: HTMLDivElement,
  nodes: ProcessNode[],
  edges: ProcessEdge[],
  nodeElements: Map<string, HTMLButtonElement>,
): EdgeOverlay {
  const boardRect = board.getBoundingClientRect();
  const rects = new Map<string, NodeRect>();
  nodes.forEach((node) => {
    const element = nodeElements.get(node.id);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    rects.set(node.id, {
      left: rect.left - boardRect.left,
      right: rect.right - boardRect.left,
      top: rect.top - boardRect.top,
      bottom: rect.bottom - boardRect.top,
      centerX: rect.left - boardRect.left + rect.width / 2,
      centerY: rect.top - boardRect.top + rect.height / 2,
    });
  });

  // 레인 이름 열과 단계 머리글을 뺀 칸 영역 안에서만, 노드 상자를 피해 선을 잇는다.
  const corner = board.querySelector(".desktop-process-v2-corner")?.getBoundingClientRect();
  const region = {
    left: corner ? corner.right - boardRect.left : 0,
    top: corner ? corner.bottom - boardRect.top : 0,
    right: boardRect.width,
    bottom: boardRect.height,
  };
  const gutterXs = new Set<number>();
  const gutterYs = new Set<number>();
  board.querySelectorAll<HTMLElement>(".desktop-process-v2-cell").forEach((cell) => {
    const rect = cell.getBoundingClientRect();
    gutterXs.add(Math.round(rect.left - boardRect.left));
    gutterXs.add(Math.round(rect.right - boardRect.left));
    gutterYs.add(Math.round(rect.top - boardRect.top));
    gutterYs.add(Math.round(rect.bottom - boardRect.top));
  });
  const routed = routeProcessEdges({
    rects,
    edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, type: edge.type })),
    region,
    gutters: { xs: [...gutterXs], ys: [...gutterYs] },
  });

  const paths = edges.flatMap((edge) => {
    const points = routed.get(edge.id);
    if (points) return [{ edge, path: roundedPath(points, 8) }];
    const source = rects.get(edge.source);
    const target = rects.get(edge.target);
    if (!source || !target) return [];
    const forward = target.left > source.right;
    const midX = forward ? (source.right + target.left) / 2 : Math.min(source.left, target.left) - 10;
    const fallback = [
      [forward ? source.right : source.left, source.centerY],
      [midX, source.centerY],
      [midX, target.centerY],
      [target.left - 4, target.centerY],
    ];
    return [{ edge, path: roundedPath(fallback, 8) }];
  });

  return {
    width: Math.ceil(boardRect.width),
    height: Math.ceil(boardRect.height),
    paths,
  };
}


const ARROW_LENGTH = 9;

function roundedPath(points: number[][], radius: number) {
  if (points.length < 2) return "";
  let path = `M ${round(points[0][0])} ${round(points[0][1])}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const [previousX, previousY] = points[index - 1];
    const [currentX, currentY] = points[index];
    const [nextX, nextY] = points[index + 1];
    const incoming = Math.hypot(currentX - previousX, currentY - previousY);
    const outgoing = Math.hypot(nextX - currentX, nextY - currentY);
    // 마지막 꺾임은 화살촉(8px) 뒤에서 끝나야 선이 화살촉 밑변 가운데로 곧게 들어간다.
    const isLastCorner = index === points.length - 2;
    const cornerRadius = Math.min(radius, incoming / 2, isLastCorner ? Math.max(0, outgoing - ARROW_LENGTH) : outgoing / 2);
    if (cornerRadius < 1) {
      path += ` L ${round(currentX)} ${round(currentY)}`;
      continue;
    }
    const incomingX = currentX - Math.sign(currentX - previousX) * cornerRadius * Number(currentX !== previousX);
    const incomingY = currentY - Math.sign(currentY - previousY) * cornerRadius * Number(currentY !== previousY);
    const outgoingX = currentX + Math.sign(nextX - currentX) * cornerRadius * Number(nextX !== currentX);
    const outgoingY = currentY + Math.sign(nextY - currentY) * cornerRadius * Number(nextY !== currentY);
    path += ` L ${round(incomingX)} ${round(incomingY)} Q ${round(currentX)} ${round(currentY)} ${round(outgoingX)} ${round(outgoingY)}`;
  }
  const [lastX, lastY] = points.at(-1)!;
  return `${path} L ${round(lastX)} ${round(lastY)}`;
}

function isSelectedEdge(edge: ProcessEdge, selectedNodeId: string) {
  return edge.source === selectedNodeId || edge.target === selectedNodeId;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
