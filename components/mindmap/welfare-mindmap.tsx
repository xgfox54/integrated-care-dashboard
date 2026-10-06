"use client";

import {
  ArrowRight, ChevronDown, ChevronRight, ClipboardList, Compass, HeartHandshake, Info, Locate, MapPin, Maximize2, Minus, MoreHorizontal,
  Network, Newspaper, PanelRightClose, PanelRightOpen, Plus, RotateCcw, Search, Users, Wallet, X,
} from "lucide-react";
import { type ComponentType, type ReactNode, type SVGProps, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { buildWelfare100Branch, type MindmapSource, type MindNode, type Welfare100Entry } from "@/lib/mindmap";
import {
  ADVANCED_ID, buildExploreTree, countExplore, type ExploreFamily, type ExploreIcon, type ExploreNode, findExplorePath, ROOT_LABEL, searchExplore, TOP_IDS,
} from "@/lib/mindmap-view";
import { HOUSEHOLD_ORDER, LIFECYCLE_ORDER, TOPIC_ORDER } from "@/lib/welfare100/model";
import { loadCatalog } from "@/lib/welfare100/payload";
import { usageClick, usageError, usageErrorCode, usageFilter } from "@/lib/usage/track";
import { useSearchUsage } from "@/lib/usage/use-search-usage";

// 복지정보 관계성 지도(2026-10-06 작업지시서): 탐색 기준 6개에서 시작해 한 가지씩 따라 들어가는 탐색형 지도.
// 데이터는 lib/mindmap-view.ts(View Model)가 만들고, 이 파일은 그리기·조작·주소 상태만 맡는다.
// 펼친 마디만 배치·그리며(793개+를 한꺼번에 그리지 않음), 마디 본문은 「선택」, 옆의 +/−는 「펼침·접힘」으로 나눈다.

const FAMILY: Record<ExploreFamily, { readonly line: string; readonly text: string; readonly tint: string }> = {
  root: { line: "#1f2937", text: "#ffffff", tint: "#1f2937" },
  care: { line: "#0173bc", text: "#015f9b", tint: "#e6f1fa" },
  people: { line: "#00a074", text: "#007a59", tint: "#e3f5ef" },
  data: { line: "#f18101", text: "#a65500", tint: "#fdf0e2" },
  advanced: { line: "#64748b", text: "#475569", tint: "#eef2f6" },
};
const ICONS: Record<ExploreIcon, ComponentType<SVGProps<SVGSVGElement>> | null> = {
  root: Compass, target: Users, service: HeartHandshake, region: MapPin, welfare: ClipboardList, budget: Wallet, news: Newspaper, advanced: Network, item: null,
};
const FONT_FAMILY = '"Pretendard GOV", Pretendard, "Noto Sans KR", sans-serif';
const SIZES = [
  { h: 56, font: 18, weight: 800 },
  { h: 54, font: 15, weight: 800 },
  { h: 38, font: 14, weight: 700 },
  { h: 30, font: 13, weight: 600 },
] as const;
const GAP_X = 64;
const GAP_Y = 12;
/** 오른쪽에 두는 첫 단계 가지(나머지는 왼쪽). */
const RIGHT = new Set(["target", "service", "region"]);
const INTRO_KEY = "icd-relation-map-intro-v1";
const nf = new Intl.NumberFormat("ko-KR");
const countText = (node: ExploreNode) => (node.count === undefined ? "" : nf.format(node.count) + (node.unit ?? ""));
const sizeOf = (depth: number) => SIZES[Math.min(depth, 3)];

let measureContext: CanvasRenderingContext2D | null = null;
function textWidth(text: string, size: number, weight: number): number {
  if (typeof document === "undefined") return text.length * size;
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return text.length * size;
  measureContext.font = weight + " " + size + "px " + FONT_FAMILY;
  return measureContext.measureText(text).width;
}

function nodeSize(node: ExploreNode, depth: number): { w: number; h: number } {
  const size = sizeOf(depth);
  const label = textWidth(node.label, size.font, size.weight);
  if (depth === 0) return { w: Math.max(200, label + 64), h: size.h };
  if (depth === 1) return { w: Math.max(150, label + 64, textWidth(countText(node), 12, 600) + 64), h: size.h };
  const count = countText(node);
  return { w: label + (count ? textWidth(count, size.font - 1, 600) + 12 : 0) + 28, h: size.h };
}

interface Placed {
  readonly node: ExploreNode;
  readonly depth: number;
  readonly side: 1 | -1;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly parentId: string | null;
  readonly expanded: boolean;
}

/** 펼친 마디만 배치한다. 잎 하나가 (높이+간격)을 차지하고, 부모는 자식 줄 가운데에 선다. */
function layout(root: ExploreNode, expanded: ReadonlySet<string>, visible: (node: ExploreNode) => readonly ExploreNode[]): Placed[] {
  const out: Placed[] = [];
  const rootSize = nodeSize(root, 0);
  out.push({ node: root, depth: 0, side: 1, x: 0, y: 0, ...rootSize, parentId: null, expanded: true });
  const open = (node: ExploreNode) => expanded.has(node.id) && visible(node).length > 0;
  for (const side of [1, -1] as const) {
    const mine = visible(root).filter((node) => RIGHT.has(node.id) === (side === 1));
    const widths: number[] = [];
    const collect = (node: ExploreNode, depth: number) => {
      widths[depth] = Math.max(widths[depth] ?? 0, nodeSize(node, depth).w);
      if (open(node)) for (const child of visible(node)) collect(child, depth + 1);
    };
    for (const node of mine) collect(node, 1);
    const columnX: number[] = [0, rootSize.w / 2 + GAP_X];
    for (let depth = 2; depth <= widths.length; depth += 1) columnX[depth] = columnX[depth - 1] + (widths[depth - 1] ?? 0) + GAP_X;
    const span = (node: ExploreNode, depth: number): number => (open(node) ? visible(node).reduce((total, child) => total + span(child, depth + 1), 0) : sizeOf(depth).h + GAP_Y);
    const total = mine.reduce((acc, node) => acc + span(node, 1), 0);
    let cursor = -total / 2;
    const place = (node: ExploreNode, depth: number, parentId: string): number => {
      let y: number;
      if (open(node)) {
        const ys = visible(node).map((child) => place(child, depth + 1, node.id));
        y = (ys[0] + ys[ys.length - 1]) / 2;
      } else {
        const h = sizeOf(depth).h + GAP_Y;
        y = cursor + h / 2;
        cursor += h;
      }
      out.push({ node, depth, side, x: side * columnX[depth], y, ...nodeSize(node, depth), parentId, expanded: open(node) });
      return y;
    };
    for (const node of mine) place(node, 1, root.id);
  }
  return out;
}

function nodeBox(p: Placed): { left: number; top: number } {
  if (p.depth === 0) return { left: -p.w / 2, top: -p.h / 2 };
  return { left: p.side === 1 ? p.x : p.x - p.w, top: p.y - p.h / 2 };
}

function linkPath(parent: Placed, child: Placed): string {
  const startX = parent.depth === 0 ? (child.side === 1 ? parent.w / 2 : -parent.w / 2) : child.side === 1 ? parent.x + parent.w + 22 : parent.x - parent.w - 22;
  const endX = child.x;
  const middle = (startX + endX) / 2;
  return "M" + startX + "," + parent.y + " C" + middle + "," + parent.y + " " + middle + "," + child.y + " " + endX + "," + child.y;
}

interface View { readonly x: number; readonly y: number; readonly k: number }
interface IndexEntry { readonly node: ExploreNode; readonly parent: string | null; readonly top: string; readonly depth: number }

function buildIndex(root: ExploreNode): Map<string, IndexEntry> {
  const index = new Map<string, IndexEntry>();
  const walk = (node: ExploreNode, parent: string | null, top: string, depth: number) => {
    index.set(node.id, { node, parent, top, depth });
    for (const child of node.children ?? []) walk(child, node.id, depth === 0 ? child.id : top, depth + 1);
  };
  walk(root, null, "root", 0);
  return index;
}

function allIds(node: ExploreNode, maxDepth: number, depth = 0, out: string[] = []): string[] {
  if (node.children?.length && depth < maxDepth) {
    out.push(node.id);
    for (const child of node.children) allIds(child, maxDepth, depth + 1, out);
  }
  return out;
}

function readNodeParam(): string {
  return new URLSearchParams(window.location.search).get("node") ?? "root";
}

export function WelfareMindmap() {
  const [source, setSource] = useState<MindmapSource | null>(null);
  const [welfareBranch, setWelfareBranch] = useState<MindNode | null>(null);
  const [welfareEntries, setWelfareEntries] = useState<readonly Welfare100Entry[] | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["root"]));
  const [selectedId, setSelectedId] = useState("root");
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [mode, setMode] = useState<"map" | "list">("map");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [compare, setCompare] = useState(false);
  const [pathOnly, setPathOnly] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [intro, setIntro] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDetailsElement>(null);
  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const fitPending = useRef(true);
  const restored = useRef(false);

  useEffect(() => {
    let active = true;
    fetch("/api/mindmap")
      .then(async (response) => {
        if (!response.ok) throw new Error("status " + response.status);
        return (await response.json()) as MindmapSource;
      })
      .then((data) => { if (active) setSource(data); })
      .catch((reason: unknown) => {
        if (!active) return;
        setError("관계성 지도 자료를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
        usageError("mindmap_data", usageErrorCode(reason));
      });
    loadCatalog()
      .then((catalog) => {
        if (!active) return;
        setWelfareEntries(catalog.entries);
        setWelfareBranch(buildWelfare100Branch(catalog.entries, { topics: TOPIC_ORDER, lifecycle: LIFECYCLE_ORDER, household: HOUSEHOLD_ORDER }));
      })
      .catch(() => { if (active) setWelfareBranch({ id: "w100", label: "복지제도100", href: "/welfare100", note: "복지제도 대장을 불러오지 못했습니다." }); });
    // 좁은 화면(768px 미만)은 목록형 탐색이 기본이다. 주소에 view=map이 있으면 지도로 연다. 첫 안내는 「다시 보지 않기」 전까지 보인다.
    const frame = requestAnimationFrame(() => {
      const viewParam = new URLSearchParams(window.location.search).get("view");
      if (viewParam === "list" || (viewParam !== "map" && window.innerWidth < 768)) setMode("list");
      try {
        setIntro(window.localStorage.getItem(INTRO_KEY) !== "hidden");
      } catch {
        setIntro(true);
      }
    });
    return () => { active = false; cancelAnimationFrame(frame); };
  }, []);

  const root = useMemo(() => (source ? buildExploreTree({ source, welfareBranch, welfareEntries }) : null), [source, welfareBranch, welfareEntries]);
  const index = useMemo(() => (root ? buildIndex(root) : new Map<string, IndexEntry>()), [root]);
  const selectedPath = useMemo(() => (root ? findExplorePath(root, selectedId) ?? [root] : []), [root, selectedId]);
  const selected = selectedPath.at(-1) ?? null;
  const pathIds = useMemo(() => new Set(selectedPath.map((node) => node.id)), [selectedPath]);

  // 「선택 경로만 보기」: 경로 위의 마디는 경로 쪽 자식만, 선택 마디는 모든 자식을 보인다.
  const visible = useCallback((node: ExploreNode): readonly ExploreNode[] => {
    const children = node.children ?? [];
    if (!pathOnly || node.id === selectedId || !pathIds.has(node.id)) return children;
    return children.filter((child) => pathIds.has(child.id));
  }, [pathOnly, selectedId, pathIds]);
  const placed = useMemo(() => (root ? layout(root, expanded, visible) : []), [root, expanded, visible]);
  const byId = useMemo(() => new Map(placed.map((item) => [item.node.id, item])), [placed]);

  const deferredQuery = useDeferredValue(query);
  const hits = useMemo(() => (root ? searchExplore(root, deferredQuery, 40) : []), [root, deferredQuery]);
  const hitIds = useMemo(() => new Set(deferredQuery.trim() ? hits.map((hit) => hit.node.id) : []), [hits, deferredQuery]);
  useSearchUsage({ scope: "mindmap_node", keyword: query, conditions: "", settled: root !== null, failed: false, count: hits.length, match: null });

  // ---------- 화면 이동 ----------
  const viewRef = useRef<View>(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  const animationRef = useRef<number | null>(null);
  const stopAnimation = useCallback(() => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
  }, []);
  useEffect(() => stopAnimation, [stopAnimation]);
  const animateTo = useCallback((target: View, duration = 320) => {
    const frame = frameRef.current;
    stopAnimation();
    if (!frame || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setView(target);
      return;
    }
    const start = viewRef.current;
    const cx = frame.clientWidth / 2;
    const cy = frame.clientHeight / 2;
    const from = { x: (cx - start.x) / start.k, y: (cy - start.y) / start.k };
    const to = { x: (cx - target.x) / target.k, y: (cy - target.y) / target.k };
    const began = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      const k = start.k * Math.pow(target.k / start.k, e);
      const wx = from.x + (to.x - from.x) * e;
      const wy = from.y + (to.y - from.y) * e;
      setView({ k, x: cx - wx * k, y: cy - wy * k });
      animationRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    animationRef.current = requestAnimationFrame(step);
  }, [stopAnimation]);

  /** 지도 틀 가운데 지금 화면에 보이는 부분(틀이 화면보다 길어도 보이는 곳 가운데에서 이동·확대). */
  const visibleArea = (frame: HTMLElement) => {
    const rect = frame.getBoundingClientRect();
    const top = Math.max(0, -rect.top);
    const bottom = Math.min(rect.height, window.innerHeight - rect.top);
    const left = Math.max(0, -rect.left);
    const right = Math.min(rect.width, window.innerWidth - rect.left);
    if (bottom - top < 160 || right - left < 160) return { cx: rect.width / 2, cy: rect.height / 2, width: rect.width, height: rect.height };
    return { cx: (left + right) / 2, cy: (top + bottom) / 2, width: right - left, height: bottom - top };
  };

  const boundsOf = (items: readonly Placed[]) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const item of items) {
      const box = nodeBox(item);
      minX = Math.min(minX, box.left - 24); maxX = Math.max(maxX, box.left + item.w + 24);
      minY = Math.min(minY, box.top); maxY = Math.max(maxY, box.top + item.h);
    }
    return { minX, maxX, minY, maxY };
  };

  /** 보이는 마디 전체를 화면에 맞춘다(배율 0.3~1.1). */
  const fit = useCallback((animate = false) => {
    const frame = frameRef.current;
    if (!frame || !placed.length) return;
    const { minX, maxX, minY, maxY } = boundsOf(placed);
    const { cx, cy, width, height } = visibleArea(frame);
    const k = Math.max(0.3, Math.min(1.1, (width - 48) / (maxX - minX), (height - 48) / (maxY - minY)));
    const target = { k, x: cx - ((minX + maxX) / 2) * k, y: cy - ((minY + maxY) / 2) * k };
    if (animate) animateTo(target);
    else setView(target);
  }, [placed, animateTo]);

  useEffect(() => {
    if (fitPending.current && placed.length > 1 && mode === "map") {
      fitPending.current = false;
      fit(false);
    }
  }, [placed, fit, mode]);

  /** 마디와 펼친 하위 마디가 화면 가운데에 오도록 이동·확대한다(배율 0.6~1.3). */
  const focusOn = useCallback((id: string) => {
    const frame = frameRef.current;
    const item = byId.get(id);
    if (!frame || !item) return;
    const { minX, maxX, minY, maxY } = boundsOf([item, ...placed.filter((entry) => entry.parentId === id)]);
    const { cx, cy, width, height } = visibleArea(frame);
    const k = Math.max(0.6, Math.min(1.3, (width - 96) / (maxX - minX), (height - 96) / (maxY - minY)));
    animateTo({ k, x: cx - ((minX + maxX) / 2) * k, y: cy - ((minY + maxY) / 2) * k });
  }, [byId, placed, animateTo]);

  const pendingFocus = useRef<string | null>(null);
  const lastClick = useRef<{ id: string; at: number } | null>(null);
  /** 두 번 누르기: 첫 클릭으로 배치가 바뀌어 두 번째 클릭이 다른 곳에 떨어져도, 처음 누른 항목의 자료 화면으로 간다. */
  const openLastClicked = useCallback((detail: number, at: number) => {
    const last = lastClick.current;
    if (detail < 2 || !last || at - last.at > 600) return;
    lastClick.current = null;
    const href = index.get(last.id)?.node.href;
    if (href) window.location.assign(href);
  }, [index]);
  useEffect(() => {
    if (pendingFocus.current && byId.has(pendingFocus.current) && mode === "map") {
      focusOn(pendingFocus.current);
      pendingFocus.current = null;
    }
  }, [byId, focusOn, mode]);

  // ---------- 선택·펼침(한 가지 집중) ----------
  /** 첫 단계 가지 하나만 열어 둔다(여러 가지 비교가 켜져 있으면 그대로 둔다). */
  const focusBranch = useCallback((ids: Set<string>, top: string) => {
    if (compare || top === "root") return ids;
    return new Set([...ids].filter((id) => id === "root" || index.get(id)?.top === top));
  }, [compare, index]);

  const syncUrl = (id: string, push: boolean) => {
    const url = new URL(window.location.href);
    if (id === "root") url.searchParams.delete("node");
    else url.searchParams.set("node", id);
    if (url.href !== window.location.href) window.history[push ? "pushState" : "replaceState"]({ node: id }, "", url);
  };

  const select = useCallback((id: string, options: { push?: boolean; expandSelf?: boolean } = {}) => {
    const entry = index.get(id);
    if (!root || !entry) return;
    const path = findExplorePath(root, id) ?? [root];
    setSelectedId(id);
    setExpanded((current) => {
      const next = focusBranch(new Set([...current, ...path.slice(0, -1).map((node) => node.id)]), entry.top);
      if (options.expandSelf && entry.node.children?.length) next.add(id);
      return next;
    });
    pendingFocus.current = id;
    if (options.push !== false) syncUrl(id, true);
    if (id !== "root") {
      usageClick("mindmap_select");
      if (entry.top !== "root") usageFilter("mindmap_branch", entry.top);
    }
  }, [index, root, focusBranch]);

  const toggle = useCallback((id: string) => {
    const entry = index.get(id);
    if (!entry?.node.children?.length || id === "root") return;
    setExpanded((current) => {
      if (current.has(id)) {
        const next = new Set(current);
        next.delete(id);
        return next;
      }
      return new Set([...focusBranch(current, entry.top), id]);
    });
    pendingFocus.current = id;
  }, [index, focusBranch]);

  // 주소의 ?node=로 위치를 되살리고(새로고침·공유 링크), 뒤로·앞으로 가기를 따른다.
  useEffect(() => {
    if (!root || restored.current) return;
    restored.current = true;
    const frame = requestAnimationFrame(() => {
      const id = readNodeParam();
      if (id !== "root" && index.has(id)) select(id, { push: false, expandSelf: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [root, index, select]);
  useEffect(() => {
    const onPop = () => {
      const id = readNodeParam();
      select(index.has(id) ? id : "root", { push: false, expandSelf: true });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [index, select]);

  const reset = () => {
    setExpanded(new Set(["root"]));
    setSelectedId("root");
    setCompare(false);
    setPathOnly(false);
    setQuery("");
    fitPending.current = true;
    syncUrl("root", true);
  };

  const zoom = useCallback((factor: number, cx?: number, cy?: number) => {
    const frame = frameRef.current;
    if (!frame) return;
    stopAnimation();
    const area = visibleArea(frame);
    const px = cx ?? area.cx;
    const py = cy ?? area.cy;
    setView((current) => {
      const k = Math.max(0.3, Math.min(2.5, current.k * factor));
      return { k, x: px - ((px - current.x) * k) / current.k, y: py - ((py - current.y) * k) / current.k };
    });
  }, [stopAnimation]);

  const ready = Boolean(root);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || mode !== "map" || !ready) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = frame.getBoundingClientRect();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? frame.clientHeight : 1);
      zoom(Math.exp(-Math.max(-120, Math.min(120, pixels)) * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [mode, ready, zoom]);

  // Esc: 정보칸·아래 시트·검색 결과를 닫는다.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSearchOpen(false);
      setSheetOpen(false);
      setShowKeys(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const closeMore = () => moreRef.current?.removeAttribute("open");
  const changeMode = (next: "map" | "list") => {
    setMode(next);
    fitPending.current = true;
    pendingFocus.current = selectedId;
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(window.history.state, "", url);
  };
  // 목록 보기에서는 하위 항목이 있는 줄은 목록 안에서 펼쳐 보이고, 정보칸(모바일 아래 시트)은 끝 항목이나 정보 단추에서만 연다.
  const choose = (id: string, expandSelf = false) => {
    select(id, { expandSelf: expandSelf || mode === "list" });
    if (mode === "map" || !index.get(id)?.node.children?.length) setSheetOpen(true);
  };

  if (error) return <p role="alert" className="rounded-lg border border-border bg-card p-4 text-(length:--jeju-text-sm)">{error}</p>;
  if (!root || !source) return <p className="p-6 text-(length:--jeju-text-sm) text-muted-foreground" role="status">복지정보 관계성 지도 자료를 불러오는 중입니다…</p>;

  const stats: readonly [string, string][] = [
    ["통합돌봄 사업", nf.format(source.services.total) + "건"],
    ["복지제도", welfareEntries ? nf.format(welfareEntries.length) + "개" : "…"],
    ["공식 보도자료", nf.format(source.news.total) + "건"],
    ["지방자치단체", nf.format(source.fiscal.entityTotal) + "곳"],
    ["지도 마디", nf.format(countExplore(root)) + "개"],
  ];
  const tops = (root.children ?? []).filter((node) => node.id !== ADVANCED_ID);
  const advanced = (root.children ?? []).find((node) => node.id === ADVANCED_ID);
  const strong = new Set<string>([selectedId, index.get(selectedId)?.parent ?? "", ...(selected?.children ?? []).map((child) => child.id)]);
  const groupedHits = TOP_IDS.concat([ADVANCED_ID] as never).map((top) => ({ top, hits: hits.filter((hit) => hit.path[1]?.id === top).slice(0, 6) })).filter((group) => group.hits.length);
  const firstHit = groupedHits[0]?.hits[0];
  // 검색 결과 사이를 방향키로 옮겨 다닌다. 맨 위에서 ↑를 누르면 검색칸으로 돌아간다.
  const moveHit = (from: HTMLElement, step: number) => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("#mindmap-search-results [data-hit]")];
    const next = buttons[buttons.indexOf(from as HTMLButtonElement) + step];
    if (next) next.focus();
    else if (step < 0) document.getElementById("mindmap-search")?.focus();
  };

  const panel = selected ? <NodePanel node={selected} path={selectedPath} onSelect={(id) => choose(id)} onToggle={toggle} expanded={expanded.has(selected.id)} /> : null;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-(length:--jeju-h2-size) font-extrabold text-(--jeju-text-strong)">{ROOT_LABEL}</h1>
            <p className="mt-1 max-w-3xl text-(length:--jeju-text-sm) text-muted-foreground">사업·대상자·지역·복지제도의 관계를 따라 필요한 정보를 찾아보세요.</p>
          </div>
          <div role="group" aria-label="보기 방식" className="flex rounded-lg border border-border p-0.5">
            {(["map", "list"] as const).map((value) => (
              <button key={value} type="button" aria-pressed={mode === value} onClick={() => changeMode(value)}
                className={"rounded-md px-3 py-1.5 text-(length:--jeju-text-sm) font-bold " + (mode === value ? "bg-[#0173bc] text-white" : "text-(--jeju-text-body) hover:bg-(--jeju-primary-tint)")}>
                {value === "map" ? "관계성 지도로 보기" : "목록으로 보기"}
              </button>
            ))}
          </div>
        </div>
        {intro ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#0173bc33] bg-[#f3f8fc] px-3 py-2 text-(length:--jeju-text-sm)">
            <p><b>복지정보를 한눈에 탐색해 보세요.</b> ① 기준을 고르고 ② 가지를 따라 들어가 ③ 오른쪽(모바일은 아래)에서 관련 사업·제도·예산을 확인하세요.</p>
            <span className="flex gap-2">
              <button type="button" className="font-bold text-[#015f9b] underline-offset-2 hover:underline" onClick={() => setIntro(false)}>닫기</button>
              <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => { setIntro(false); try { window.localStorage.setItem(INTRO_KEY, "hidden"); } catch { /* 저장 못 해도 닫기만 한다 */ } }}>다시 보지 않기</button>
            </span>
          </div>
        ) : null}
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border px-3 py-1.5">
              <dt className="text-(length:--jeju-text-xs) text-muted-foreground">{label}</dt>
              <dd className="text-(length:--jeju-text-md) font-extrabold text-(--jeju-text-strong)">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-(length:--jeju-text-xs) text-muted-foreground">
          자료 기준: 통합돌봄 사업안내 {source.knowledge.dataAsOf || "기준일 미상"} 수집본 · 집계 {new Date(source.generatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}. 수는 사업·제도·게시물 건수이며 수혜자 수나 예산 규모가 아닙니다.
        </p>
      </section>

      <section aria-label="탐색 도구" className="space-y-2 rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1">
            <label htmlFor="mindmap-search" className="sr-only">통합검색</label>
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <span id="mindmap-search-help" className="sr-only">Enter를 누르면 첫 결과로 이동하고, 아래 방향키로 결과 목록을 옮겨 다닙니다.</span>
            <input id="mindmap-search" type="search" value={query} autoComplete="off" aria-describedby="mindmap-search-help"
              onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && firstHit) { event.preventDefault(); choose(firstHit.node.id, true); setSearchOpen(false); }
                else if (event.key === "ArrowDown") { event.preventDefault(); setSearchOpen(true); document.querySelector<HTMLButtonElement>("#mindmap-search-results [data-hit]")?.focus(); }
                else if (event.key === "Escape") setSearchOpen(false);
              }}
              placeholder="사업·대상자·지역·복지제도 검색 (예: 치매, 제주특별자치도, 퇴원환자, ㅊㅁ)"
              aria-controls="mindmap-search-results"
              className="h-10 w-full rounded-lg border border-border bg-white pr-9 pl-9 text-(length:--jeju-text-sm) outline-none focus-visible:shadow-(--jeju-focus-ring)" />
            {query ? <button type="button" aria-label="검색어 지우기" onClick={() => { setQuery(""); setSearchOpen(false); }} className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground"><X className="size-4" /></button> : null}
            {searchOpen && query.trim() ? (
              <div id="mindmap-search-results" className="absolute top-11 left-0 z-30 max-h-[26rem] w-full min-w-[20rem] overflow-auto rounded-lg border border-border bg-white p-2 shadow-lg">
                {groupedHits.length ? groupedHits.map(({ top, hits: list }) => (
                  <div key={top} className="mb-2">
                    <p className="px-2 text-(length:--jeju-text-xs) font-bold text-muted-foreground">{index.get(top)?.node.label}</p>
                    <ul>
                      {list.map((hit, position) => (
                        <li key={hit.node.id}>
                          <button type="button" data-hit onClick={() => { choose(hit.node.id, true); setSearchOpen(false); }}
                            onKeyDown={(event) => {
                              if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); moveHit(event.currentTarget, event.key === "ArrowDown" ? 1 : -1); }
                              else if (event.key === "Escape") { setSearchOpen(false); document.getElementById("mindmap-search")?.focus(); }
                            }}
                            className="w-full rounded-md px-2 py-1.5 text-left outline-none hover:bg-(--jeju-primary-tint) focus-visible:bg-(--jeju-primary-tint) focus-visible:shadow-(--jeju-focus-ring)">
                            <span className="font-bold">{hit.node.label}</span> <span className="text-(length:--jeju-text-sm) text-muted-foreground">{countText(hit.node)}</span>
                            <span className="block truncate text-(length:--jeju-text-xs) text-muted-foreground">{hit.path.slice(1, -1).map((item) => item.label).join(" › ") || "탐색 기준"}</span>
                          </button>
                          {position === 0 && top === groupedHits[0].top && hit.node.related?.some((item) => item.count > 0) ? (
                            <ul aria-label={hit.node.label + " 관련 정보"} className="mb-1 ml-3 flex flex-wrap gap-1.5 border-l border-border pl-2">
                              {hit.node.related.filter((item) => item.count > 0 && item.href).map((item) => (
                                <li key={item.key + item.label}><a href={item.href} className="inline-flex rounded-full border border-border px-2 py-0.5 text-(length:--jeju-text-xs) text-(--jeju-text-body) no-underline hover:border-[#0173bc] hover:text-[#015f9b]">{item.label} {nf.format(item.count)}{item.unit}</a></li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )) : <p role="status" className="px-2 py-1 text-(length:--jeju-text-sm) text-muted-foreground">찾는 항목이 없습니다. 대상자·서비스·지역·제도 이름이나 초성(예: ㅊㅁ)으로 찾아 주세요.</p>}
              </div>
            ) : null}
          </div>
          {mode === "map" ? (
            <>
              <div role="group" aria-label="확대·축소" className="flex items-center gap-1">
                <ToolButton label="축소" onClick={() => zoom(1 / 1.2)}><Minus aria-hidden="true" className="size-4" /></ToolButton>
                <span className="w-12 text-center text-(length:--jeju-text-sm) font-bold tabular-nums" aria-live="polite">{Math.round(view.k * 100)}%</span>
                <ToolButton label="확대" onClick={() => zoom(1.2)}><Plus aria-hidden="true" className="size-4" /></ToolButton>
              </div>
              <ToolButton label="화면 맞춤" text onClick={() => fit(true)}><Maximize2 aria-hidden="true" className="size-4" /></ToolButton>
              <ToolButton label="현재 위치" text onClick={() => focusOn(selectedId)}><Locate aria-hidden="true" className="size-4" /></ToolButton>
            </>
          ) : null}
          <ToolButton label="초기화" text onClick={reset}><RotateCcw aria-hidden="true" className="size-4" /></ToolButton>
          <details ref={moreRef} className="relative">
            <summary className="grid h-9 cursor-pointer list-none place-items-center rounded-lg border border-border bg-white px-2.5 text-(length:--jeju-text-sm) font-bold hover:bg-(--jeju-primary-tint)" aria-label="더보기">
              <span className="flex items-center gap-1"><MoreHorizontal aria-hidden="true" className="size-4" />더보기</span>
            </summary>
            <div role="menu" className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-border bg-white p-1 shadow-lg">
              <MenuItem onClick={() => { setExpanded(new Set(["root", ...allIds(root, 3)])); setCompare(true); fitPending.current = true; closeMore(); }}>모두 펼치기</MenuItem>
              <MenuItem checked={pathOnly} onClick={() => { setPathOnly((value) => !value); fitPending.current = true; closeMore(); }}>선택 경로만 보기</MenuItem>
              <MenuItem checked={compare} onClick={() => { setCompare((value) => !value); closeMore(); }}>여러 가지 비교</MenuItem>
              <MenuItem onClick={() => { reset(); closeMore(); }}>지도 초기화</MenuItem>
              <MenuItem onClick={() => { setShowKeys(true); closeMore(); }}>키보드 사용법</MenuItem>
            </div>
          </details>
          {mode === "map" ? (
            <ToolButton label={panelOpen ? "정보칸 닫기" : "정보칸 열기"} onClick={() => setPanelOpen((value) => !value)} className="hidden lg:grid">
              {panelOpen ? <PanelRightClose aria-hidden="true" className="size-4" /> : <PanelRightOpen aria-hidden="true" className="size-4" />}
            </ToolButton>
          ) : null}
        </div>
        <nav aria-label="현재 위치" className="flex flex-wrap items-center gap-1 text-(length:--jeju-text-sm)">
          <span className="sr-only">현재 위치: </span>
          {selectedPath.map((node, position) => (
            <span key={node.id} className="flex items-center gap-1">
              {position ? <ChevronRight aria-hidden="true" className="size-3.5 text-muted-foreground" /> : null}
              <button type="button" aria-current={position === selectedPath.length - 1 ? "location" : undefined} onClick={() => choose(node.id)}
                className={"rounded px-1.5 py-0.5 hover:bg-(--jeju-primary-tint) " + (position === selectedPath.length - 1 ? "font-extrabold text-(--jeju-text-strong)" : "text-[#015f9b] underline-offset-2 hover:underline")}>
                {node.label}
              </button>
            </span>
          ))}
          {compare ? <span className="ml-2 rounded-full bg-[#fdf0e2] px-2 py-0.5 text-(length:--jeju-text-xs) font-bold text-[#a65500]">여러 가지 비교 중</span> : null}
          {pathOnly ? <span className="ml-1 rounded-full bg-[#eef2f6] px-2 py-0.5 text-(length:--jeju-text-xs) font-bold text-[#475569]">선택 경로만 보기</span> : null}
        </nav>
        <div role="group" aria-label="무엇을 기준으로 찾아볼까요?" className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-(length:--jeju-text-xs) font-bold text-muted-foreground">무엇을 기준으로 찾아볼까요?</span>
          {tops.map((node) => {
            const Icon = ICONS[node.icon];
            const active = index.get(selectedId)?.top === node.id;
            return (
              <button key={node.id} type="button" aria-pressed={active} onClick={() => choose(node.id, true)}
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-(length:--jeju-text-sm) font-bold"
                style={{ borderColor: FAMILY[node.family].line, background: active ? FAMILY[node.family].tint : "#ffffff", color: FAMILY[node.family].text }}>
                {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}{node.label}
              </button>
            );
          })}
          {advanced ? (
            <button type="button" onClick={() => choose(advanced.id, true)} className="ml-auto inline-flex items-center gap-1 rounded-full border border-dashed border-[#94a3b8] px-3 py-1 text-(length:--jeju-text-xs) font-bold text-[#475569]">
              <Network aria-hidden="true" className="size-3.5" />고급 탐색: 데이터 관계·온톨로지
            </button>
          ) : null}
        </div>
        {showKeys ? (
          <div role="note" className="flex items-start justify-between gap-3 rounded-lg bg-(--jeju-surface-inset) px-3 py-2 text-(length:--jeju-text-sm)">
            <p>Tab: 마디 사이 이동 · Enter: 마디 선택 · Space: 하위 항목 펼침/접힘 · Esc: 검색 결과·아래 시트 닫기 · +/−: 확대·축소(지도에 초점) · 더블클릭: 자료 화면으로 이동 · 끌기: 화면 이동 · 휠: 커서 위치 기준 확대·축소</p>
            <button type="button" aria-label="키보드 사용법 닫기" onClick={() => setShowKeys(false)}><X className="size-4" /></button>
          </div>
        ) : null}
      </section>

      <div className={"grid gap-4 " + (panelOpen ? "lg:grid-cols-[minmax(0,7fr)_minmax(18rem,3fr)]" : "")}>
        {mode === "map" ? (
          <section aria-label="복지정보 관계성 지도 그림" className="relative overflow-hidden rounded-xl border border-border bg-[#f6f8fb]">
            <div
              ref={frameRef}
              tabIndex={-1}
              onClick={(event) => openLastClicked(event.detail, event.timeStamp)}
              className="h-[72vh] min-h-[480px] cursor-grab touch-none select-none outline-none active:cursor-grabbing lg:h-[144vh] lg:min-h-[960px]"
              onKeyDown={(event) => {
                if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(1.2); }
                if (event.key === "-" || event.key === "_") { event.preventDefault(); zoom(1 / 1.2); }
              }}
              onPointerDown={(event) => {
                if ((event.target as Element).closest("[data-node]")) return;
                stopAnimation();
                dragRef.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag) return;
                setView((current) => ({ ...current, x: drag.vx + event.clientX - drag.x, y: drag.vy + event.clientY - drag.y }));
              }}
              onPointerUp={() => { dragRef.current = null; }}
              onPointerCancel={() => { dragRef.current = null; }}
            >
              <svg width="100%" height="100%" role="tree" aria-label={ROOT_LABEL + ". 탐색 기준 " + tops.length + "개. 목록으로 보기에서 같은 내용을 글로 볼 수 있습니다."}>
                <g transform={"translate(" + view.x + "," + view.y + ") scale(" + view.k + ")"}>
                  {placed.filter((item) => item.parentId).map((item) => {
                    const parent = byId.get(item.parentId as string);
                    if (!parent) return null;
                    const direct = item.node.id === selectedId || item.parentId === selectedId;
                    const onPath = pathIds.has(item.node.id);
                    return (
                      <path key={"l-" + item.node.id} d={linkPath(parent, item)} fill="none" stroke={FAMILY[item.node.family].line}
                        strokeOpacity={direct || onPath ? 0.9 : 0.28} strokeWidth={direct || onPath ? 2.6 : Math.max(1.2, 3 - item.depth * 0.6)} strokeLinecap="round" />
                    );
                  })}
                  {placed.map((item) => (
                    <GraphNode key={item.node.id} item={item} selected={item.node.id === selectedId} dim={selectedId !== "root" && !strong.has(item.node.id) && !pathIds.has(item.node.id)}
                      hit={hitIds.has(item.node.id)} onSelect={(at) => { lastClick.current = { id: item.node.id, at }; choose(item.node.id); }} onToggle={() => toggle(item.node.id)} />
                  ))}
                </g>
              </svg>
            </div>
            <p className="pointer-events-none absolute bottom-2 left-3 rounded bg-white/85 px-2 py-0.5 text-(length:--jeju-text-xs) text-muted-foreground">마디를 누르면 선택, 옆의 +/−로 펼치고 접기, 두 번 누르면 자료 화면으로 이동합니다.</p>
          </section>
        ) : (
          <section aria-label="복지정보 관계성 지도 목록" className="rounded-xl border border-border bg-card p-4">
            <ExploreList root={root} selectedId={selectedId} expanded={expanded} onToggle={toggle} onSelect={(id) => select(id, { expandSelf: true })} onInfo={(id) => { select(id); setSheetOpen(true); }} />
          </section>
        )}
        {panelOpen && panel ? (
          <aside aria-label="선택한 항목 정보" className="hidden rounded-xl border border-border bg-card p-4 lg:sticky lg:top-4 lg:block lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-auto">
            {panel}
          </aside>
        ) : null}
      </div>

      {sheetOpen && panel && selectedId !== "root" ? (
        <div role="dialog" aria-modal="false" aria-label={(selected?.label ?? "") + " 정보"} className="fixed inset-x-0 bottom-0 z-40 max-h-[72vh] overflow-auto rounded-t-2xl border-t border-border bg-white p-4 shadow-[0_-8px_24px_rgba(15,23,42,0.15)] lg:hidden">
          <div className="mb-2 flex justify-end">
            <button type="button" onClick={() => setSheetOpen(false)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-(length:--jeju-text-sm) font-bold"><X aria-hidden="true" className="size-4" />닫기</button>
          </div>
          {panel}
        </div>
      ) : null}
    </div>
  );
}

function GraphNode({ item, selected, dim, hit, onSelect, onToggle }: {
  readonly item: Placed; readonly selected: boolean; readonly dim: boolean; readonly hit: boolean; readonly onSelect: (at: number) => void; readonly onToggle: () => void;
}) {
  const box = nodeBox(item);
  const { node, depth } = item;
  const color = FAMILY[node.family];
  const size = sizeOf(depth);
  const count = countText(node);
  const hasChildren = Boolean(node.children?.length) && depth > 0;
  const Icon = ICONS[node.icon];
  const isRoot = depth === 0;
  const fill = isRoot ? "#1f2937" : selected ? color.tint : "#ffffff";
  const label = node.label + (count ? ", " + count : "") + (hasChildren ? (item.expanded ? ", 하위 항목 펼침" : ", 하위 항목 접힘") : "") + (selected ? ", 선택됨" : "");
  const toggleX = item.side === 1 ? item.w + 14 : -14;
  return (
    <g data-node="" transform={"translate(" + box.left + "," + box.top + ")"} opacity={dim ? 0.5 : 1} style={{ transition: "opacity 180ms" }}>
      <g role="treeitem" tabIndex={0} aria-level={depth + 1} aria-selected={selected} aria-expanded={hasChildren ? item.expanded : undefined} aria-label={label}
        onClick={(event) => { if (event.detail < 2) onSelect(event.timeStamp); }}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); onSelect(Number.NEGATIVE_INFINITY); }
          if (event.key === " ") { event.preventDefault(); onToggle(); }
        }}
        className="cursor-pointer outline-none [&:focus-visible>rect.frame]:stroke-[#111827] [&:focus-visible>rect.frame]:stroke-[3px]">
        {selected && !isRoot ? <rect x={-5} y={-5} width={item.w + 10} height={item.h + 10} rx={(item.h + 10) / 2.6} fill="none" stroke="#111827" strokeWidth={2.5} /> : null}
        {hit ? <rect x={-4} y={-4} width={item.w + 8} height={item.h + 8} rx={(item.h + 8) / 2.6} fill="none" stroke="#f18101" strokeWidth={2} strokeDasharray="5 3" /> : null}
        <rect className="frame" width={item.w} height={item.h} rx={depth <= 1 ? 12 : item.h / 2} fill={fill}
          stroke={isRoot ? "#1f2937" : color.line} strokeWidth={depth === 1 ? 2 : 1.4} strokeDasharray={node.family === "advanced" ? "5 3" : undefined} />
        {depth === 1 ? <rect width={6} height={item.h} rx={3} fill={color.line} /> : null}
        {isRoot ? (
          <>
            {Icon ? <Icon x={18} y={item.h / 2 - 11} width={22} height={22} color="#ffffff" aria-hidden="true" /> : null}
            <text x={48} y={item.h / 2 + 6.5} fill="#ffffff" style={{ font: size.weight + " " + size.font + "px " + FONT_FAMILY }}>{node.label}</text>
          </>
        ) : depth === 1 ? (
          <>
            {Icon ? <Icon x={16} y={item.h / 2 - 10} width={20} height={20} color={color.line} aria-hidden="true" /> : null}
            <text x={44} y={22} fill="#111827" style={{ font: size.weight + " " + size.font + "px " + FONT_FAMILY }}>{node.label}</text>
            {count ? <text x={44} y={41} fill={color.text} style={{ font: "600 12px " + FONT_FAMILY }}>{count}</text> : null}
          </>
        ) : (
          <text x={14} y={item.h / 2 + size.font / 2.8} fill="#111827" style={{ font: (selected ? 800 : size.weight) + " " + size.font + "px " + FONT_FAMILY }}>
            {node.label}
            {count ? <tspan dx={8} fill={color.text} style={{ font: "600 " + (size.font - 1) + "px " + FONT_FAMILY }}>{count}</tspan> : null}
          </text>
        )}
      </g>
      {hasChildren ? (
        <g aria-hidden="true" className="cursor-pointer" onClick={(event) => { event.stopPropagation(); onToggle(); }}>
          <circle cx={toggleX} cy={item.h / 2} r={10} fill="#ffffff" stroke={color.line} strokeWidth={1.6} />
          <text x={toggleX} y={item.h / 2 + 4.5} textAnchor="middle" fill={color.text} style={{ font: "800 14px sans-serif" }}>{item.expanded ? "−" : "+"}</text>
        </g>
      ) : null}
    </g>
  );
}

function NodePanel({ node, path, onSelect, onToggle, expanded }: {
  readonly node: ExploreNode; readonly path: readonly ExploreNode[]; readonly onSelect: (id: string) => void; readonly onToggle: (id: string) => void; readonly expanded: boolean;
}) {
  const color = FAMILY[node.family];
  const related = (node.related ?? []).filter((item) => item.count > 0);
  const children = node.children ?? [];
  return (
    <div className="space-y-3">
      <div>
        <p className="text-(length:--jeju-text-xs) text-muted-foreground">현재 경로: {path.map((item) => item.label).join(" > ")}</p>
        <h2 className="mt-1 text-(length:--jeju-h3-size) font-extrabold text-(--jeju-text-strong)">{node.label}</h2>
        {node.count !== undefined && node.id !== "root" ? <p className="text-(length:--jeju-text-xl) font-extrabold" style={{ color: color.text }}>{countText(node)}</p> : null}
        {node.note ? <p className="mt-1 text-(length:--jeju-text-sm) text-(--jeju-text-body)">{node.note}</p> : null}
      </div>
      {related.length ? (
        <section aria-label="관련 자료">
          <h3 className="mb-1 text-(length:--jeju-text-sm) font-bold">관련 자료</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {related.map((item) => (
              <li key={item.key + item.label}>
                {item.href ? (
                  <a href={item.href} className="flex items-baseline justify-between gap-2 px-3 py-2 text-(length:--jeju-text-sm) text-(--jeju-text-body) no-underline hover:bg-(--jeju-primary-tint)">
                    <span>{item.label}</span><span className="font-extrabold text-(--jeju-text-strong) tabular-nums">{nf.format(item.count)}{item.unit}</span>
                  </a>
                ) : (
                  <span className="flex items-baseline justify-between gap-2 px-3 py-2 text-(length:--jeju-text-sm)"><span>{item.label}</span><span className="font-extrabold tabular-nums">{nf.format(item.count)}{item.unit}</span></span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {node.topics?.length ? (
        <section aria-label="주요 연관 분야">
          <h3 className="mb-1 text-(length:--jeju-text-sm) font-bold">주요 연관 분야</h3>
          <ul className="flex flex-wrap gap-1.5">
            {node.topics.map((topic) => <li key={topic} className="rounded-full bg-(--jeju-surface-inset) px-2 py-0.5 text-(length:--jeju-text-xs) font-bold">{topic}</li>)}
          </ul>
        </section>
      ) : null}
      {node.links?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {node.links.map((link, position) => (
            <a key={link.label} href={link.href} className={"inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-(length:--jeju-text-sm) font-bold no-underline " + (position === 0 ? "bg-[#0173bc] text-white hover:bg-[#015f9b]" : "border border-border text-(--jeju-text-body) hover:bg-(--jeju-primary-tint)")}>
              {link.label} <ArrowRight aria-hidden="true" className="size-3.5" />
            </a>
          ))}
        </div>
      ) : null}
      {children.length ? (
        <section aria-label="하위 항목">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="text-(length:--jeju-text-sm) font-bold">하위 항목 {children.length}개</h3>
            {node.id !== "root" ? <button type="button" onClick={() => onToggle(node.id)} className="text-(length:--jeju-text-xs) font-bold text-[#015f9b] hover:underline">하위 항목 {expanded ? "접기" : "펼치기"}</button> : null}
          </div>
          <ul className="max-h-80 space-y-0.5 overflow-auto">
            {children.map((child) => (
              <li key={child.id}>
                <button type="button" onClick={() => onSelect(child.id)} className="flex w-full items-baseline justify-between gap-2 rounded-md px-2 py-1 text-left text-(length:--jeju-text-sm) hover:bg-(--jeju-primary-tint)">
                  <span className="truncate">{child.label}</span><span className="shrink-0 font-bold tabular-nums" style={{ color: FAMILY[child.family].text }}>{countText(child)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** 목록형 탐색(모바일 기본·목록으로 보기): 기준별 아코디언. 항목을 누르면 정보(모바일은 아래 시트)를 보인다. */
/** 목록 보기: 지도와 같은 펼침 상태를 쓴다. 하위 항목이 있는 줄은 눌러서 펼치고, 정보 단추나 끝 항목을 누르면 정보칸을 연다. */
function ExploreList({ root, selectedId, expanded, onToggle, onSelect, onInfo }: {
  readonly root: ExploreNode; readonly selectedId: string; readonly expanded: ReadonlySet<string>;
  readonly onToggle: (id: string) => void; readonly onSelect: (id: string) => void; readonly onInfo: (id: string) => void;
}) {
  // 검색·기준 단추로 고른 항목이 목록 밖에 있으면 보이는 곳으로 옮긴다.
  useEffect(() => {
    document.querySelector("[data-list-id=\"" + CSS.escape(selectedId) + "\"] > div")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);
  const row = (node: ExploreNode, depth: number): ReactNode => {
    const hasChildren = Boolean(node.children?.length);
    const isOpen = expanded.has(node.id);
    const Icon = depth === 0 ? ICONS[node.icon] : null;
    return (
      <li key={node.id} data-list-id={node.id} role="treeitem" aria-level={depth + 1} aria-expanded={hasChildren ? isOpen : undefined} aria-selected={selectedId === node.id}>
        <div className={"flex items-center gap-1 rounded-lg " + (depth === 0 ? "border border-border bg-white px-1 py-1" : "px-1")} style={depth === 0 ? { borderLeft: "5px solid " + FAMILY[node.family].line } : undefined}>
          {hasChildren ? (
            <button type="button" aria-label={(isOpen ? "접기: " : "펼치기: ") + node.label} onClick={() => onToggle(node.id)} className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-(--jeju-primary-tint)">
              {isOpen ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}
            </button>
          ) : <span className="size-9 shrink-0" aria-hidden="true" />}
          <button type="button" onClick={() => { if (!hasChildren) onInfo(node.id); else if (isOpen && selectedId === node.id) onToggle(node.id); else onSelect(node.id); }}
            className={"flex min-h-9 flex-1 items-center justify-between gap-2 rounded-md px-1 text-left hover:bg-(--jeju-primary-tint) " + (selectedId === node.id ? "font-extrabold" : "")}>
            <span className="flex items-center gap-1.5">{Icon ? <Icon aria-hidden="true" className="size-4" style={{ color: FAMILY[node.family].line }} /> : null}<span className={depth === 0 ? "text-(length:--jeju-text-md) font-extrabold" : "text-(length:--jeju-text-sm)"}>{node.label}</span></span>
            <span className="shrink-0 text-(length:--jeju-text-sm) font-bold tabular-nums" style={{ color: FAMILY[node.family].text }}>{countText(node)}</span>
          </button>
          {hasChildren ? (
            <button type="button" aria-label={"정보 보기: " + node.label} title="관련 자료 보기" onClick={() => onInfo(node.id)} className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-(--jeju-primary-tint) hover:text-[#015f9b]">
              <Info aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </div>
        {hasChildren && isOpen ? <ul role="group" className="ml-4 border-l border-border pl-2">{(node.children ?? []).map((child) => row(child, depth + 1))}</ul> : null}
      </li>
    );
  };
  return (
    <div className="space-y-2">
      <p className="text-(length:--jeju-text-sm) font-bold">무엇을 기준으로 찾아볼까요?</p>
      <ul role="tree" aria-label={ROOT_LABEL + " 목록"} className="space-y-2">{(root.children ?? []).map((node) => row(node, 0))}</ul>
    </div>
  );
}

function ToolButton({ label, onClick, children, text = false, className = "" }: { readonly label: string; readonly onClick: () => void; readonly children: ReactNode; readonly text?: boolean; readonly className?: string }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className={"grid h-9 min-w-9 place-items-center rounded-lg border border-border bg-white px-2 text-(--jeju-text-body) hover:bg-(--jeju-primary-tint) " + className}>
      <span className="flex items-center gap-1 text-(length:--jeju-text-sm) font-bold">{children}{text ? <span className="hidden xl:inline">{label}</span> : null}</span>
    </button>
  );
}

function MenuItem({ children, onClick, checked }: { readonly children: ReactNode; readonly onClick: () => void; readonly checked?: boolean }) {
  return (
    <button type="button" role={checked === undefined ? "menuitem" : "menuitemcheckbox"} aria-checked={checked} onClick={onClick}
      className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-(length:--jeju-text-sm) hover:bg-(--jeju-primary-tint)">
      {children}{checked ? <span aria-hidden="true" className="font-bold text-[#0173bc]">✓</span> : null}
    </button>
  );
}

