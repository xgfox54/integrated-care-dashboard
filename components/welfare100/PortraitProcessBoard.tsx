"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ProcessEdge,
  ProcessLaneGroup,
  ProcessModel,
  ProcessNode,
  SourceVerification,
} from "@/lib/welfare100/types";
import { routeProcessEdges } from "@/lib/welfare100/edge-router.mjs";
import { splitStageName } from "@/lib/welfare100/stage-name.mjs";
import { ProcessVerificationSummaryBar } from "./ProcessVerification";
import {
  Legend,
  MobileProcessFlow,
  NodeDrawer,
  SwimlaneNodeCard,
  stageStatus,
} from "./SwimlaneBoard";

interface PortraitEdgePath {
  edge: ProcessEdge;
  path: string;
  labelX?: number;
  labelY?: number;
}

const STAGE_LABEL_WIDTH = 132;
const MIN_GROUP_WIDTH = 218;
const EMBEDDED_STAGE_LABEL_WIDTH = 64;

export default function PortraitProcessBoard({
  process,
  verification,
  laneGroups,
  initialNodeId,
  onNodeChange,
  embedded = false,
  showDrawer = true,
}: {
  process: ProcessModel;
  verification?: SourceVerification;
  laneGroups?: ProcessLaneGroup[];
  initialNodeId?: string;
  onNodeChange?: (nodeId: string | null) => void;
  embedded?: boolean;
  showDrawer?: boolean;
}) {
  const stageLabelWidth = embedded
    ? EMBEDDED_STAGE_LABEL_WIDTH
    : STAGE_LABEL_WIDTH;
  const groups = useMemo(
    () => laneGroups?.length ? laneGroups : fallbackGroups(process.lanes),
    [laneGroups, process.lanes]
  );
  const lanePageStarts = useMemo(() => {
    if (groups.length === 0) return [];
    if (groups.length <= 2) return [0];
    return [0, groups.length - 2];
  }, [groups.length]);
  const [activeNode, setActiveNode] = useState<ProcessNode | null>(() =>
    process.nodes.find((node) => node.id === initialNodeId) ?? null
  );
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [activeLanePage, setActiveLanePage] = useState(0);
  const [edgePaths, setEdgePaths] = useState<PortraitEdgePath[]>([]);
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 });
  const boardRef = useRef<HTMLDivElement>(null);
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const groupHeaderRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const nodeRefs = useRef<Map<string, HTMLElement>>(new Map());
  const stageRefs = useRef<Map<string, HTMLElement>>(new Map());

  const computeEdges = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    setSvgSize({ width: board.scrollWidth, height: board.scrollHeight });
    setEdgePaths(
      buildPortraitEdgePaths(process.edges, nodeRefs.current, board)
    );
    // 행위자 묶음·단계 폭이 바뀌면 카드 위치가 달라지므로 다시 잇는다.
  }, [process.edges, groups, stageLabelWidth]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    computeEdges();
    const observer = new ResizeObserver(computeEdges);
    if (boardRef.current) observer.observe(boardRef.current);
    return () => observer.disconnect();
  }, [computeEdges]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(computeEdges);
    return () => window.cancelAnimationFrame(frame);
  }, [computeEdges]);

  const handleNodeClick = useCallback(
    (node: ProcessNode) => {
      setActiveNode(node);
      onNodeChange?.(node.id);
    },
    [onNodeChange]
  );
  const handleClose = useCallback(() => {
    setActiveNode(null);
    onNodeChange?.(null);
  }, [onNodeChange]);
  const handleStageClick = useCallback((stage: string) => {
    const target = stageRefs.current.get(stage);
    if (!target) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    target.scrollIntoView({
      block: "center",
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }, []);

  const scrollToLanePage = useCallback(
    (pageIndex: number) => {
      const scroller = boardScrollRef.current;
      if (!scroller || lanePageStarts.length === 0) return;
      const nextPage = Math.max(
        0,
        Math.min(pageIndex, lanePageStarts.length - 1)
      );
      const group = groups[lanePageStarts[nextPage]];
      const header = group ? groupHeaderRefs.current.get(group.id) : null;
      if (!header) return;
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      scroller.scrollTo({
        left: Math.min(
          maxScroll,
          Math.max(0, header.offsetLeft - stageLabelWidth)
        ),
        behavior: reducedMotion ? "auto" : "smooth",
      });
    },
    [groups, lanePageStarts, stageLabelWidth]
  );

  const handleBoardScroll = useCallback(() => {
    const scroller = boardScrollRef.current;
    if (!scroller || lanePageStarts.length <= 1) return;
    const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    let nearestPage = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    lanePageStarts.forEach((groupIndex, pageIndex) => {
      const group = groups[groupIndex];
      const header = group ? groupHeaderRefs.current.get(group.id) : null;
      if (!header) return;
      const target = Math.min(
        maxScroll,
        Math.max(0, header.offsetLeft - stageLabelWidth)
      );
      const distance = Math.abs(scroller.scrollLeft - target);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPage = pageIndex;
      }
    });
    setActiveLanePage((current) =>
      current === nearestPage ? current : nearestPage
    );
  }, [groups, lanePageStarts, stageLabelWidth]);

  const handleBoardKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      scrollToLanePage(
        activeLanePage + (event.key === "ArrowRight" ? 1 : -1)
      );
    },
    [activeLanePage, scrollToLanePage]
  );

  const connectedEdgeIds = new Set<string>();
  const connectedNodeIds = new Set<string>();
  if (hoveredNodeId) {
    for (const edge of process.edges) {
      if (edge.source === hoveredNodeId || edge.target === hoveredNodeId) {
        connectedEdgeIds.add(edge.id);
        connectedNodeIds.add(edge.source);
        connectedNodeIds.add(edge.target);
      }
    }
  }

  const embeddedGroupWidthSum = groups
    .map(() => "var(--portrait-group-width)")
    .join(" + ");
  const embeddedMinGridWidth = embeddedGroupWidthSum
    ? `calc(var(--portrait-stage-width) + ${embeddedGroupWidthSum})`
    : "var(--portrait-stage-width)";

  return (
    <div className="portrait-process-board" data-embedded={embedded ? "true" : undefined}>
      {!embedded && (
        <ProcessVerificationSummaryBar
          process={process}
          verification={verification}
        />
      )}

      <div className="portrait-process-desktop-view">
        {!embedded && <nav className="portrait-stage-nav" aria-label="업무 단계 바로가기">
          {process.stages.map((stage) => {
            const { code, label } = splitStageName(stage);
            return (
              <button
                key={stage}
                type="button"
                data-status={stageStatus(stage, process.nodes)}
                onClick={() => handleStageClick(stage)}
              >
                {code ? <span>{code}</span> : null}
                <strong>{label}</strong>
              </button>
            );
          })}
        </nav>}

        {embedded && lanePageStarts.length > 1 && (
          <nav className="portrait-lane-pager" aria-label="행위자 묶음 보기">
            <span>행위자 묶음</span>
            <div>
              {lanePageStarts.map((groupIndex, pageIndex) => {
                const pageGroups = groups.slice(groupIndex, groupIndex + 2);
                const pageEnd = Math.min(groupIndex + 2, groups.length);
                const pageTitle = pageGroups.map((group) => group.title).join(" · ");
                return (
                  <button
                    key={groupIndex}
                    type="button"
                    aria-label={`${pageTitle} 보기`}
                    aria-pressed={activeLanePage === pageIndex}
                    title={pageTitle}
                    onClick={() => scrollToLanePage(pageIndex)}
                  >
                    {groupIndex + 1}–{pageEnd}
                  </button>
                );
              })}
            </div>
          </nav>
        )}

        <div
          ref={boardScrollRef}
          className="portrait-process-scroll"
          role="region"
          aria-label="세로형 업무구조도 탐색 영역"
          tabIndex={0}
          onKeyDown={handleBoardKeyDown}
          onScroll={handleBoardScroll}
        >
          <div
            ref={boardRef}
            className="portrait-process-grid"
            style={
              embedded
                ? ({
                    "--portrait-stage-width": `${stageLabelWidth}px`,
                    gridTemplateColumns: `var(--portrait-stage-width) repeat(${groups.length}, minmax(var(--portrait-group-width), 1fr))`,
                    minWidth: embeddedMinGridWidth,
                  } as React.CSSProperties)
                : {
                    gridTemplateColumns: `${stageLabelWidth}px repeat(${groups.length}, minmax(${MIN_GROUP_WIDTH}px, 1fr))`,
                    minWidth: stageLabelWidth + groups.length * MIN_GROUP_WIDTH,
                  }
            }
          >
            {svgSize.width > 0 && (
              <svg
                className="portrait-process-edges"
                aria-hidden="true"
                width={svgSize.width}
                height={svgSize.height}
              >
                <defs>
                  <PortraitArrowMarker id="portrait-arr-sequence" color="var(--jeju-text-muted)" />
                  <PortraitArrowMarker id="portrait-arr-message" color="var(--jeju-green-dark)" />
                  <PortraitArrowMarker id="portrait-arr-loop" color="var(--jeju-blue-dark)" />
                </defs>
                {edgePaths.map(({ edge, path }) => {
                  const color = edgeColor(edge.type);
                  const highlighted = hoveredNodeId
                    ? connectedEdgeIds.has(edge.id)
                    : false;
                  const dimmed = hoveredNodeId !== null && !highlighted;
                  const strokeWidth = highlighted
                    ? 3
                    : edge.type === "loop"
                      ? 2.5
                      : 2.2;
                  return (
                    <g
                      key={edge.id}
                      opacity={dimmed ? 0.12 : highlighted ? 1 : 0.92}
                    >
                      <path
                        d={path}
                        fill="none"
                        stroke="var(--jeju-surface)"
                        strokeWidth={strokeWidth + 3.2}
                        strokeDasharray={edgeDash(edge.type)}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d={path}
                        fill="none"
                        stroke={color}
                        strokeWidth={strokeWidth}
                        strokeDasharray={edgeDash(edge.type)}
                        markerEnd={`url(#portrait-arr-${edge.type})`}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                  );
                })}
                {edgePaths.map(({ edge, labelX, labelY }) => {
                  if (!edge.label || labelX === undefined || labelY === undefined) {
                    return null;
                  }
                  const color = edgeColor(edge.type);
                  const highlighted = hoveredNodeId
                    ? connectedEdgeIds.has(edge.id)
                    : false;
                  const dimmed = hoveredNodeId !== null && !highlighted;
                  const labelWidth = Math.max(
                    58,
                    Array.from(edge.label).length * 7 + 16
                  );
                  return (
                    <g
                      key={`label-${edge.id}`}
                      opacity={dimmed ? 0.12 : highlighted ? 1 : 0.96}
                    >
                      <rect
                        x={labelX - labelWidth / 2}
                        y={labelY - 9}
                        width={labelWidth}
                        height={19}
                        rx={4}
                        fill="var(--jeju-surface)"
                        stroke={color}
                        strokeWidth={0.7}
                      />
                      <text
                        x={labelX}
                        y={labelY + 5}
                        textAnchor="middle"
                        fontSize={12}
                        fontWeight={650}
                        fill={color}
                      >
                        {edge.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}

            <div className="portrait-corner-cell">
              <strong>{embedded ? "게이트" : "단계 ↓"}</strong>
              <span>{embedded ? "↓" : "행위자 묶음 →"}</span>
            </div>

            {groups.map((group, groupIndex) => (
              <div
                key={group.id}
                ref={(element) => {
                  if (element) groupHeaderRefs.current.set(group.id, element);
                  else groupHeaderRefs.current.delete(group.id);
                }}
                className="portrait-group-header"
                data-page-start={
                  lanePageStarts.includes(groupIndex) ? "true" : undefined
                }
                style={{ "--portrait-group-accent": group.accent } as React.CSSProperties}
              >
                <strong>{group.title}</strong>
                <span title={group.lanes.join(" · ")}>{group.lanes.join(" · ")}</span>
              </div>
            ))}

            {process.stages.flatMap((stage, stageIndex) => {
              const { code, label } = splitStageName(stage);
              const status = stageStatus(stage, process.nodes);
              return [
                <div
                  key={`stage-${stage}`}
                  ref={(element) => {
                    if (element) stageRefs.current.set(stage, element);
                    else stageRefs.current.delete(stage);
                  }}
                  className="portrait-stage-label"
                  data-status={status}
                  style={{ gridColumn: 1, gridRow: stageIndex + 2 }}
                >
                  {code ? <span className="mono">{code}</span> : null}
                  <strong>{label}</strong>
                </div>,
                ...groups.map((group, groupIndex) => {
                  const cellNodes = process.nodes.filter(
                    (node) => node.stage === stage && group.lanes.includes(node.lane)
                  );
                  return (
                    <div
                      key={`${stage}-${group.id}`}
                      className="portrait-stage-cell"
                      data-current={status === "current"}
                      style={{
                        gridColumn: groupIndex + 2,
                        gridRow: stageIndex + 2,
                      }}
                    >
                      {cellNodes.map((node) => {
                        const hoverActive = hoveredNodeId !== null;
                        const connected = connectedNodeIds.has(node.id);
                        const current = hoveredNodeId === node.id;
                        const selected = activeNode?.id === node.id;
                        return (
                          <SwimlaneNodeCard
                            key={node.id}
                            node={node}
                            verification={verification}
                            onClick={handleNodeClick}
                            highlighted={selected || (hoverActive && (current || connected))}
                            dimmed={hoverActive && !current && !connected}
                            onHover={() => setHoveredNodeId(node.id)}
                            onLeave={() => setHoveredNodeId(null)}
                            setRef={(element) => {
                              if (element) nodeRefs.current.set(node.id, element);
                              else nodeRefs.current.delete(node.id);
                            }}
                          />
                        );
                      })}
                    </div>
                  );
                }),
              ];
            })}
          </div>
        </div>

        <p className="portrait-layout-disclosure">
          원래 {process.lanes.length}개 행위자 레인을 {groups.length}개 레이아웃 묶음으로 배치했습니다.
        </p>
        <Legend />
      </div>

      {!embedded && <div className="portrait-process-mobile-view">
        <MobileProcessFlow
          process={process}
          verification={verification}
          onNodeClick={handleNodeClick}
        />
        <Legend />
      </div>}

      {showDrawer && activeNode && (
        <NodeDrawer
          node={activeNode}
          edges={process.edges}
          verification={verification}
          onClose={handleClose}
        />
      )}
    </div>
  );
}

function PortraitArrowMarker({ id, color }: { id: string; color: string }) {
  return (
    <marker
      id={id}
      markerWidth={14}
      markerHeight={11}
      refX={12}
      refY={5.5}
      orient="auto"
      markerUnits="userSpaceOnUse"
    >
      <path
        d="M1,1 L13,5.5 L1,10 Z"
        fill={color}
        stroke="var(--jeju-surface)"
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </marker>
  );
}

function buildPortraitEdgePaths(
  edges: ProcessEdge[],
  nodeElements: Map<string, HTMLElement>,
  board: HTMLElement,
): PortraitEdgePath[] {
  const boardRect = board.getBoundingClientRect();
  const nodeRects = new Map<string, Rect>();
  nodeElements.forEach((element, nodeId) => {
    const rect = relativeRect(element, boardRect);
    if (rect.width > 0 && rect.height > 0) nodeRects.set(nodeId, rect);
  });

  // 단계 이름 열과 행위자 묶음 머리글을 뺀 칸 영역 안에서만, 카드를 피해 선을 잇는다.
  const corner = board.querySelector<HTMLElement>(".portrait-corner-cell");
  const cornerRect = corner ? relativeRect(corner, boardRect) : null;
  const region = {
    left: cornerRect?.right ?? 0,
    top: cornerRect?.bottom ?? 0,
    right: board.scrollWidth,
    bottom: board.scrollHeight,
  };
  const gutterXs = new Set<number>();
  const gutterYs = new Set<number>();
  board.querySelectorAll<HTMLElement>(".portrait-stage-cell").forEach((cell) => {
    const rect = relativeRect(cell, boardRect);
    gutterXs.add(Math.round(rect.left));
    gutterXs.add(Math.round(rect.right));
    gutterYs.add(Math.round(rect.top));
    gutterYs.add(Math.round(rect.bottom));
  });
  const routed = routeProcessEdges({
    rects: nodeRects,
    edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, type: edge.type })),
    region,
    gutters: { xs: [...gutterXs], ys: [...gutterYs] },
  });

  const placedLabels: Rect[] = [];
  return edges.flatMap((edge) => {
    const points = routed.get(edge.id);
    if (!points) return [];
    const path = points
      .map(([x, y], index) => (index === 0 ? "M " : "L ") + round(x) + " " + round(y))
      .join(" ");
    const label = edge.label ? placeEdgeLabel(points, edge.label, nodeRects, placedLabels, region) : null;
    if (label) placedLabels.push(label.rect);
    return [{ edge, path, labelX: label?.x, labelY: label?.y }];
  });
}

/** 되돌림 선의 설명 칩을 카드·다른 칩과 겹치지 않는 선 위의 빈 자리에 놓는다. */
function placeEdgeLabel(
  points: number[][],
  label: string,
  nodeRects: Map<string, Rect>,
  placed: Rect[],
  region: { left: number; top: number; right: number; bottom: number },
): { x: number; y: number; rect: Rect } | null {
  const width = Math.max(58, Array.from(label).length * 7 + 16);
  const height = 19;
  const segments = points
    .slice(1)
    .map((point, index) => ({ a: points[index], b: point, length: Math.hypot(point[0] - points[index][0], point[1] - points[index][1]) }))
    .sort((left, right) => {
      const leftHorizontal = left.a[1] === left.b[1] ? 1 : 0;
      const rightHorizontal = right.a[1] === right.b[1] ? 1 : 0;
      return rightHorizontal - leftHorizontal || right.length - left.length;
    });
  const overlaps = (rect: Rect, other: Rect) =>
    rect.left < other.right + 3 && rect.right > other.left - 3 && rect.top < other.bottom + 3 && rect.bottom > other.top - 3;
  for (const { a, b, length } of segments) {
    if (length < 24) continue;
    for (const fraction of [0.5, 0.3, 0.7, 0.2, 0.8]) {
      const x = a[0] + (b[0] - a[0]) * fraction;
      const y = a[1] + (b[1] - a[1]) * fraction;
      const rect: Rect = { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2, width, height };
      if (rect.left < region.left + 2 || rect.right > region.right - 2 || rect.top < region.top + 2 || rect.bottom > region.bottom - 2) continue;
      if ([...nodeRects.values()].some((node) => overlaps(rect, node))) continue;
      if (placed.some((other) => overlaps(rect, other))) continue;
      return { x, y, rect };
    }
  }
  return null;
}


interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function relativeRect(element: HTMLElement, boardRect: DOMRect): Rect {
  const rect = element.getBoundingClientRect();
  const left = rect.left - boardRect.left;
  const top = rect.top - boardRect.top;
  return {
    left,
    top,
    right: left + rect.width,
    bottom: top + rect.height,
    width: rect.width,
    height: rect.height,
  };
}

function fallbackGroups(lanes: string[]): ProcessLaneGroup[] {
  const accents = ["var(--jeju-primary)", "var(--jeju-blue-dark)", "var(--jeju-warning)", "var(--jeju-blue-dark)"];
  const groupCount = Math.min(4, lanes.length);
  const sizes = Array.from(
    { length: groupCount },
    () => Math.floor(lanes.length / groupCount)
  );
  const order = [2, 1, 0, 3].filter((index) => index < groupCount);
  for (let index = 0; index < lanes.length % groupCount; index += 1) {
    sizes[order[index] ?? index] += 1;
  }
  let cursor = 0;
  return sizes.map((size, index) => {
    const groupLanes = lanes.slice(cursor, cursor + size);
    cursor += size;
    return {
      id: `fallback-${index + 1}`,
      title: groupLanes[0],
      lanes: groupLanes,
      accent: accents[index],
    };
  });
}

function edgeColor(type: ProcessEdge["type"]) {
  if (type === "loop") return "var(--jeju-blue-dark)";
  if (type === "message") return "var(--jeju-green-dark)";
  return "var(--jeju-text-muted)";
}

function edgeDash(type: ProcessEdge["type"]) {
  if (type === "message") return "7 5";
  if (type === "loop") return "6 4";
  return undefined;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
