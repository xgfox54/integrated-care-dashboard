"use client";

import {
  ArrowRight, ChevronDown, ChevronRight, ClipboardList, HeartHandshake, Info, Locate, MapPin, Maximize2, Minus, MoreHorizontal,
  Network, Newspaper, Plus, RotateCcw, Search, Sun, Users, Wallet, X,
} from "lucide-react";
import { type ComponentType, type ReactNode, type SVGProps, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { buildWelfare100Branch, type MindmapSource, type MindNode, type Welfare100Entry } from "@/lib/mindmap";
import {
  ADVANCED_ID, buildExploreTree, countExplore, type ExploreIcon, type ExploreNode, findExplorePath, ROOT_LABEL, searchExplore, TOP_IDS,
} from "@/lib/mindmap-view";
import {
  BRANCH_COLORS, layoutSolar, projectSolar, solarBounds, solarConnections, solarLabelBox, solarOrbits, solarTogglePosition, rotationToRight,
  SOLAR_LABEL_FONT_SIZE, SOLAR_LABEL_LINE_HEIGHT, SOLAR_TOGGLE_RADIUS, type SolarNode as Placed,
} from "@/lib/mindmap-solar";
import { HOUSEHOLD_ORDER, LIFECYCLE_ORDER, TOPIC_ORDER } from "@/lib/welfare100/model";
import { loadCatalog } from "@/lib/welfare100/payload";
import { usageClick, usageError, usageErrorCode, usageFilter } from "@/lib/usage/track";
import { useSearchUsage } from "@/lib/usage/use-search-usage";

// 원본 집계·안정적 ID·실제 부모·자식 관계를 유지하며 2D 태양·행성·위성 구조로 그린다.
// 원 크기는 분류의 계층을 나타낸다. 서로 단위가 다른 건수를 면적으로 비교하지 않는다.
const ICONS: Record<ExploreIcon, ComponentType<SVGProps<SVGSVGElement>> | null> = {
  root: Sun, target: Users, service: HeartHandshake, region: MapPin, welfare: ClipboardList, budget: Wallet, news: Newspaper, advanced: Network, item: null,
};
const FONT_FAMILY = '"Pretendard GOV", Pretendard, "Noto Sans KR", sans-serif';
const INTRO_KEY = "icd-relation-map-intro-solar-v1";
const nf = new Intl.NumberFormat("ko-KR");
const countText = (node: ExploreNode) => (node.count === undefined ? "" : nf.format(node.count) + (node.unit ?? ""));
const initialExpanded = () => new Set<string>(["root"]);
const branchColor = (topId: string) => BRANCH_COLORS[topId] ?? BRANCH_COLORS.advanced;

interface View { readonly x: number; readonly y: number; readonly k: number; readonly rotation: number }
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

function readNodeParam(): string {
  return new URLSearchParams(window.location.search).get("node") ?? "root";
}

export function WelfareMindmap() {
  const [source, setSource] = useState<MindmapSource | null>(null);
  const [welfareBranch, setWelfareBranch] = useState<MindNode | null>(null);
  const [welfareEntries, setWelfareEntries] = useState<readonly Welfare100Entry[] | null>(null);
  const [catalogSettled, setCatalogSettled] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);
  const [compact, setCompact] = useState(false);
  const [selectedId, setSelectedId] = useState("root");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1, rotation: 0 });
  const [mode, setMode] = useState<"map" | "list">("map");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [compare, setCompare] = useState(false);
  const [pathOnly, setPathOnly] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [intro, setIntro] = useState(false);
  const toolbarRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDetailsElement>(null);
  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
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
      .catch(() => { if (active) setWelfareBranch({ id: "w100", label: "복지제도100", href: "/welfare100", note: "복지제도 대장을 불러오지 못했습니다." }); })
      .finally(() => { if (active) setCatalogSettled(true); });
    // 작은 화면에서도 2D 지도를 먼저 보여 주고, 같은 자료의 목록 보기를 제공한다.
    const frame = requestAnimationFrame(() => {
      const viewParam = new URLSearchParams(window.location.search).get("view");
      if (viewParam === "list") setMode("list");
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

  // 펼친 부모의 모든 하위 항목을 그린다. 경로 제한은 사용자가 켠 경우에만 적용한다.
  const visible = useCallback((node: ExploreNode): readonly ExploreNode[] => {
    const children = node.children ?? [];
    if (pathOnly && node.id !== selectedId && pathIds.has(node.id)) return children.filter((child) => pathIds.has(child.id));
    return children;
  }, [pathOnly, selectedId, pathIds]);
  // 화면이 좁아져도 위성 수는 유지한다. 회전 중에는 같은 항성계를 그대로 옮긴다.
  const layout = useMemo(() => (root ? layoutSolar(root, expanded, visible, compact) : []), [root, expanded, visible, compact]);
  const layoutById = useMemo(() => new Map(layout.map((item) => [item.node.id, item])), [layout]);
  const placed = useMemo(() => projectSolar(layout, view.rotation), [layout, view.rotation]);

  const deferredQuery = useDeferredValue(query);
  const hits = useMemo(() => (root ? searchExplore(root, deferredQuery, 40) : []), [root, deferredQuery]);
  const hitIds = useMemo(() => new Set(deferredQuery.trim() ? hits.map((hit) => hit.node.id) : []), [hits, deferredQuery]);
  useSearchUsage({ scope: "mindmap_node", keyword: query, conditions: "", settled: root !== null, failed: false, count: hits.length, match: null });

  // ---------- 화면 이동 ----------
  /** 항목을 직접 고르면 검색 도구를 화면 위에 맞춘다. 입력 초점은 옮기지 않는다. */
  const scrollToSearch = useCallback(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    window.scrollTo({
      top: Math.max(0, window.scrollY + toolbar.getBoundingClientRect().top - 8),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }, []);

  const viewRef = useRef<View>(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  const animationRef = useRef<number | null>(null);
  const stopAnimation = useCallback(() => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
  }, []);
  useEffect(() => stopAnimation, [stopAnimation]);
  // 직접 팬·줌을 시작하면 이동은 넘겨주되, 회전은 선택 항목의 오른쪽 정렬까지 마친다.
  const interruptMotion = useCallback(() => {
    stopAnimation();
    const item = layoutById.get(selectedId);
    if (!item) return;
    const current = viewRef.current;
    const next = { ...current, rotation: rotationToRight(item.angle, current.rotation) };
    viewRef.current = next;
    setView(next);
  }, [layoutById, selectedId, stopAnimation]);
  const animateTo = useCallback((target: View, duration = 480) => {
    const frame = frameRef.current;
    stopAnimation();
    if (!frame || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      viewRef.current = target;
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
      const next = t === 1 ? target : { k, x: cx - wx * k, y: cy - wy * k, rotation: start.rotation + (target.rotation - start.rotation) * e };
      viewRef.current = next;
      setView(next);
      animationRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    animationRef.current = requestAnimationFrame(step);
  }, [stopAnimation]);

  /** 원 전체를 지도 틀에 맞춘다. 페이지 스크롤 위치가 첫 배율을 바꾸지 않는다. */
  const visibleArea = (frame: HTMLElement) => {
    return { cx: frame.clientWidth / 2, cy: frame.clientHeight / 2, width: frame.clientWidth, height: frame.clientHeight };
  };

  /** 태양을 화면 중앙에 놓고 수평 이름표까지 전체 항성계를 맞춘다. */
  const fit = useCallback((animate = false) => {
    const frame = frameRef.current;
    if (!frame || !layout.length) return;
    const item = layoutById.get(selectedId);
    const rotation = rotationToRight(item?.angle ?? 0, viewRef.current.rotation);
    const { minX, maxX, minY, maxY } = solarBounds(projectSolar(layout, rotation));
    const { cx, cy, width, height } = visibleArea(frame);
    const k = Math.max(0.04, Math.min(1.1, (width - 48) / (2 * Math.max(-minX, maxX)), (height - 100) / (2 * Math.max(-minY, maxY))));
    const target = { k, x: cx, y: cy, rotation };
    if (animate) animateTo(target);
    else { stopAnimation(); viewRef.current = target; setView(target); }
  }, [layout, layoutById, selectedId, animateTo, stopAnimation]);

  useEffect(() => {
    if (selectedId === "root") fitPending.current = true;
  }, [root, selectedId]);

  /** 펼친 다음의 각도로 선택 마디를 3시 방향에 정렬하고 부모·자식 관계를 함께 맞춘다. */
  const focusOn = useCallback((id: string, fitAll = false) => {
    if (id === "root") { fit(true); return; }
    const frame = frameRef.current;
    const item = layoutById.get(id);
    if (!frame || !item) return;
    const rotation = rotationToRight(item.angle, viewRef.current.rotation);
    const projected = projectSolar(layout, rotation);
    const centerId = item.expanded && item.node.children?.length ? id : item.parentId ?? id;
    const contextIds = new Set<string>([id, centerId]);
    const context = projected.filter((entry) => contextIds.has(entry.node.id) || entry.parentId === centerId);
    const { cx, cy, width, height } = visibleArea(frame);
    const minimum = fitAll ? 0.04 : width < 640 ? 0.82 : 0.72;
    // 충분한 공간이 있을 때는 태양도 함께 보여 준다. 큰 위성계는 해당 부모에 집중한다.
    const sun = projected.find((entry) => entry.node.id === "root");
    if (!fitAll && item.depth === 1 && width >= 640 && sun) {
      const bounds = solarBounds([...context, sun]);
      if (Math.min((width - 48) / (bounds.maxX - bounds.minX), (height - 120) / (bounds.maxY - bounds.minY)) >= minimum) context.push(sun);
    }
    const { minX, maxX, minY, maxY } = solarBounds(context);
    const fitted = Math.min(1.4, (width - 48) / (maxX - minX), (height - 120) / (maxY - minY));
    const k = Math.max(minimum, fitted);
    const selectedItem = projected.find((entry) => entry.node.id === id)!;
    // 이름표를 포함한 위성계 중심에 맞춘다. 최소 배율에서도 하단 이름표가 밀리지 않는다.
    let x = cx - ((minX + maxX) / 2) * k;
    let y = cy - ((minY + maxY) / 2) * k;
    if (fitted < minimum) {
      // 큰 위성계에서 끝 항목을 선택해도 선택한 원·이름표가 화면 밖으로 나가지 않는다.
      const selectedBounds = solarBounds([selectedItem]);
      x = Math.min(Math.max(x, 24 - selectedBounds.minX * k), width - 24 - selectedBounds.maxX * k);
      y = Math.min(Math.max(y, 60 - selectedBounds.minY * k), height - 84 - selectedBounds.maxY * k);
    }
    animateTo({ k, x, y, rotation });
  }, [layoutById, layout, animateTo, fit]);

  const pendingFocus = useRef<string | null>(null);
  // 작은 화면에서는 행성 이름을 원 안에 배치하고 모든 위성은 그대로 유지한다.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || mode !== "map" || !root) return;
    let width = frame.clientWidth, height = frame.clientHeight;
    setCompact(width < 640);
    const observer = new ResizeObserver(() => {
      if (width === frame.clientWidth && height === frame.clientHeight) return;
      width = frame.clientWidth; height = frame.clientHeight;
      const nextCompact = width < 640;
      if (nextCompact !== compact) { pendingFocus.current = selectedId; setCompact(nextCompact); }
      else focusOn(selectedId);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [mode, root, compact, selectedId, focusOn]);
  const lastClick = useRef<{ id: string; at: number } | null>(null);
  /** 두 번 누르기: 첫 클릭으로 배치가 바뀌어 두 번째 클릭이 다른 곳에 떨어져도, 처음 누른 항목의 자료 화면으로 간다. */
  const openLastClicked = useCallback((detail: number, at: number) => {
    const last = lastClick.current;
    if (detail < 2 || !last || at - last.at > 600) return;
    lastClick.current = null;
    const href = index.get(last.id)?.node.href;
    if (href) window.location.assign(href);
  }, [index]);
  const previousLayout = useRef(layout);
  const syncLayoutView = useCallback(() => {
    const changed = previousLayout.current !== layout;
    previousLayout.current = layout;
    if (mode !== "map" || layout.length < 2) return;
    const pending = pendingFocus.current;
    if (pending && layoutById.has(pending)) {
      pendingFocus.current = null;
      fitPending.current = false;
      focusOn(pending);
    } else if (fitPending.current) {
      fitPending.current = false;
      fit(false);
    } else if (changed && layoutById.has(selectedId)) {
      // 모바일 첫 배치·늦게 도착한 자료도 태양 중앙 맞춤과 선택 항목 정렬을 유지한다.
      focusOn(selectedId);
    }
  }, [layout, layoutById, selectedId, focusOn, fit, mode]);
  useEffect(syncLayoutView, [syncLayoutView]);

  // ---------- 선택·펼침(한 가지 집중) ----------
  /** 기본은 선택 경로의 위성계만 펼친다. 비교 모드에서는 이전 위성계도 유지한다. */
  const focusBranch = useCallback((ids: Set<string>, id: string) => {
    if (id === "root") return initialExpanded();
    const ancestors = root ? (findExplorePath(root, id) ?? []).slice(0, -1).map((node) => node.id) : [];
    return new Set([...(compare ? ids : []), "root", ...ancestors]);
  }, [compare, root]);

  const syncUrl = (id: string, push: boolean) => {
    const url = new URL(window.location.href);
    if (id === "root") url.searchParams.delete("node");
    else url.searchParams.set("node", id);
    if (url.href !== window.location.href) window.history[push ? "pushState" : "replaceState"]({ node: id }, "", url);
  };

  const select = useCallback((id: string, options: { push?: boolean; expandSelf?: boolean } = {}) => {
    const entry = index.get(id);
    if (!root || !entry) return;
    setSelectedId(id);
    setHoveredId(null);
    setExpanded((current) => {
      const next = focusBranch(current, id);
      if (options.expandSelf !== false && entry.node.children?.length) next.add(id);
      return next;
    });
    pendingFocus.current = id;
    if (options.push !== false) {
      syncUrl(id, true);
      scrollToSearch();
    }
    if (id !== "root") {
      usageClick("mindmap_select");
      if (entry.top !== "root") usageFilter("mindmap_branch", entry.top);
    }
  }, [index, root, focusBranch, scrollToSearch]);

  const toggle = useCallback((id: string) => {
    const entry = index.get(id);
    if (!entry?.node.children?.length || id === "root") return;
    setSelectedId(id);
    setHoveredId(null);
    setExpanded((current) => {
      const next = focusBranch(current, id);
      if (current.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    pendingFocus.current = id;
    syncUrl(id, true);
    scrollToSearch();
  }, [index, focusBranch, scrollToSearch]);

  // 주소의 ?node=로 위치를 되살리고(새로고침·공유 링크), 뒤로·앞으로 가기를 따른다.
  useEffect(() => {
    if (!root || restored.current) return;
    const id = readNodeParam();
    // 복지제도 대장이 늦게 도착해도 w100/... 공유 주소의 복원을 놓치지 않는다.
    if (id !== "root" && !index.has(id) && !catalogSettled) return;
    const frame = requestAnimationFrame(() => {
      restored.current = true;
      if (id !== "root" && index.has(id)) { select(id, { push: false, expandSelf: true }); setSheetOpen(true); }
    });
    return () => cancelAnimationFrame(frame);
  }, [root, index, select, catalogSettled]);
  useEffect(() => {
    const onPop = () => {
      const id = readNodeParam();
      if (id !== "root" && !index.has(id) && !catalogSettled) restored.current = false;
      const validId = index.has(id) ? id : "root";
      setMode(new URLSearchParams(window.location.search).get("view") === "list" ? "list" : "map");
      fitPending.current = true;
      select(validId, { push: false, expandSelf: true });
      setSheetOpen(validId !== "root");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [index, select, catalogSettled]);

  const reset = () => {
    stopAnimation();
    pendingFocus.current = null;
    setExpanded(initialExpanded());
    setSelectedId("root");
    setHoveredId(null);
    setSheetOpen(false);
    setCompare(false);
    setPathOnly(false);
    setQuery("");
    fitPending.current = true;
    syncUrl("root", true);
    scrollToSearch();
  };

  const zoom = useCallback((factor: number, cx?: number, cy?: number) => {
    const frame = frameRef.current;
    if (!frame) return;
    interruptMotion();
    const area = visibleArea(frame);
    const px = cx ?? area.cx;
    const py = cy ?? area.cy;
    setView((current) => {
      const k = Math.max(0.08, Math.min(3.5, current.k * factor));
      return { ...current, k, x: px - ((px - current.x) * k) / current.k, y: py - ((py - current.y) * k) / current.k };
    });
  }, [interruptMotion]);

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
  const choose = (id: string, expandSelf = true) => {
    select(id, { expandSelf });
    // 지도 선택으로 열린 가지를 가리지 않는다. 모바일 상세정보는 지도 안의 명시적인 버튼으로 연다.
    setSheetOpen(mode === "list" && !index.get(id)?.node.children?.length);
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
  const highlightId = hoveredId ?? selectedId;
  const highlighted = index.get(highlightId);
  const highlightedPath = new Set<string>();
  let ancestor: string | null = highlightId;
  while (ancestor) { highlightedPath.add(ancestor); ancestor = index.get(ancestor)?.parent ?? null; }
  const strong = new Set<string>([highlightId, ...(highlighted?.node.children ?? []).map((child) => child.id), ...highlightedPath]);
  const groupedHits = TOP_IDS.concat([ADVANCED_ID] as never).map((top) => ({ top, hits: hits.filter((hit) => hit.path[1]?.id === top).slice(0, 6) })).filter((group) => group.hits.length);
  const firstHit = groupedHits[0]?.hits[0];
  const orbitParent = selected?.children?.length && expanded.has(selected.id) ? selected : selectedPath.at(-2);
  const orbitChildren = orbitParent && orbitParent.id !== "root" && expanded.has(orbitParent.id) ? visible(orbitParent) : [];
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
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold tracking-[0.12em] text-[#9a630a]"><Sun aria-hidden="true" className="size-3.5" />태양계로 살펴보는 복지정보</p>
            <h1 className="text-2xl font-extrabold tracking-tight text-(--jeju-text-strong) sm:text-[30px]">{ROOT_LABEL}</h1>
            <p className="mt-2 max-w-3xl text-(length:--jeju-text-sm) text-muted-foreground">가운데 태양에서 시작해 분야별 행성을 탐색하세요. 행성을 누르면 소분류가 위성처럼 펼쳐집니다.</p>
          </div>
          <div role="group" aria-label="보기 방식" className="flex rounded-lg border border-border p-0.5">
            {(["map", "list"] as const).map((value) => (
              <button key={value} type="button" aria-pressed={mode === value} onClick={() => changeMode(value)}
                className={"rounded-md px-3 py-1.5 text-(length:--jeju-text-sm) font-bold " + (mode === value ? "bg-[#0173bc] text-white" : "text-(--jeju-text-body) hover:bg-(--jeju-primary-tint)")}>
                {value === "map" ? "태양계 지도" : "목록으로 보기"}
              </button>
            ))}
          </div>
        </div>
        {intro ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#0173bc33] bg-[#f3f8fc] px-3 py-2 text-(length:--jeju-text-sm)">
            <p><b>행성 → 위성 → 세부 정보.</b> 항목을 누르면 모든 하위 위성이 펼쳐집니다. 선을 따라 관계를 살펴보고, 위성이 많으면 지도를 끌어 이동하거나 ‘위성 전체 맞춤’을 눌러 보세요.</p>
            <span className="flex gap-2">
              <button type="button" className="font-bold text-[#015f9b] underline-offset-2 hover:underline" onClick={() => setIntro(false)}>닫기</button>
              <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => { setIntro(false); try { window.localStorage.setItem(INTRO_KEY, "hidden"); } catch { /* 저장 못 해도 닫기만 한다 */ } }}>다시 보지 않기</button>
            </span>
          </div>
        ) : null}
        <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2 border-t border-border pt-3 sm:grid-cols-5">
          {stats.map(([label, value]) => (
            <div key={label}>
              <dt className="text-(length:--jeju-text-xs) text-muted-foreground">{label}</dt>
              <dd className="text-(length:--jeju-text-md) font-extrabold text-(--jeju-text-strong)">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-(length:--jeju-text-xs) text-muted-foreground">
          자료 기준: 통합돌봄 사업안내 {source.knowledge.dataAsOf || "기준일 미상"} 수집본 · 집계 {new Date(source.generatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}. 수는 사업·제도·게시물 건수이며 수혜자 수나 예산 규모가 아닙니다.
        </p>
      </section>

      <section ref={toolbarRef} aria-label="탐색 도구" className="space-y-2 rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 basis-72 flex-1">
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
              placeholder="대상자·서비스·지역 검색 (예: 치매, 제주, ㅊㅁ)"
              aria-controls="mindmap-search-results"
              className="h-10 w-full rounded-lg border border-border bg-white pr-9 pl-9 text-(length:--jeju-text-sm) outline-none focus-visible:shadow-(--jeju-focus-ring)" />
            {query ? <button type="button" aria-label="검색어 지우기" onClick={() => { setQuery(""); setSearchOpen(false); }} className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground"><X className="size-4" /></button> : null}
            {searchOpen && query.trim() ? (
              <div id="mindmap-search-results" className="absolute top-11 left-0 z-30 max-h-[26rem] w-full overflow-auto rounded-lg border border-border bg-white p-2 shadow-lg">
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
              <MenuItem onClick={() => { setExpanded(new Set(["root", ...TOP_IDS, ADVANCED_ID])); setSelectedId("root"); setCompare(true); fitPending.current = true; closeMore(); }}>모든 행성의 위성 보기</MenuItem>
              <MenuItem checked={pathOnly} onClick={() => { setPathOnly((value) => !value); fitPending.current = true; closeMore(); }}>선택 경로만 보기</MenuItem>
              <MenuItem checked={compare} onClick={() => { if (compare) setExpanded(new Set(selectedPath.filter((node) => node.children?.length).map((node) => node.id))); setCompare((value) => !value); closeMore(); }}>여러 행성계 비교</MenuItem>
              <MenuItem onClick={() => { reset(); closeMore(); }}>지도 초기화</MenuItem>
              <MenuItem onClick={() => { setShowKeys(true); closeMore(); }}>키보드 사용법</MenuItem>
            </div>
          </details>
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
          {compare ? <span className="ml-2 rounded-full bg-[#fdf0e2] px-2 py-0.5 text-(length:--jeju-text-xs) font-bold text-[#a65500]">여러 행성계 비교 중</span> : null}
          {pathOnly ? <span className="ml-1 rounded-full bg-[#eef2f6] px-2 py-0.5 text-(length:--jeju-text-xs) font-bold text-[#475569]">선택 경로만 보기</span> : null}
        </nav>
        {mode === "map" && orbitParent && orbitChildren.length > 0 ? (
          <div aria-label="하위 위성 표시 현황" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#dfe6ec] bg-[#f8fafc] px-3 py-2">
            <div className="min-w-0 text-xs text-(--jeju-text-body)">
              <p className="flex items-center gap-1.5 font-bold text-(--jeju-text-strong)"><span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: branchColor(index.get(orbitParent.id)?.top ?? orbitParent.id).line }} /><span className="truncate">{orbitParent.label}</span></p>
              <p className="mt-0.5" role="status">하위 위성 {nf.format(orbitChildren.length)}개{orbitChildren.length === orbitParent.children?.length ? " 모두 표시" : " · 선택 경로만 표시"}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-muted-foreground">화면 밖 위성은 끌어서 확인 · 확대 가능</p>
              <button type="button" onClick={() => focusOn(orbitParent.id, true)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-bold text-(--jeju-text-body) hover:bg-(--jeju-surface-inset)"><Maximize2 aria-hidden="true" className="size-3.5" />위성 전체 맞춤</button>
            </div>
          </div>
        ) : null}
        {showKeys ? (
          <div role="note" className="flex items-start justify-between gap-3 rounded-lg bg-(--jeju-surface-inset) px-3 py-2 text-(length:--jeju-text-sm)">
            <p>Tab: 노드 사이 이동 · Enter: 선택·자동 펼침·오른쪽 정렬 · Space: 하위 항목 펼침/접힘 · Esc: 검색 결과·아래 시트 닫기 · +/−: 확대·축소(지도에 초점) · 방향키: 지도 이동(지도에 초점) · 더블클릭: 자료 화면으로 이동 · 휠: 커서 위치 기준 확대·축소</p>
            <button type="button" aria-label="키보드 사용법 닫기" onClick={() => setShowKeys(false)}><X className="size-4" /></button>
          </div>
        ) : null}
      </section>

      <div className="grid overflow-hidden rounded-2xl border border-[#dbe3ec] bg-white lg:grid-cols-[272px_minmax(0,1fr)]">
        <aside aria-label="분야별 색상 범례와 선택 항목" className="min-w-0 border-b border-[#dbe3ec] bg-white p-4 sm:p-5 lg:border-r lg:border-b-0">
          <div className="mb-4 flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-bold tracking-wide text-[#0173bc]">분야별 행성</p>
              <h2 className="mt-1 text-lg font-extrabold leading-snug text-(--jeju-text-strong)">어떤 정보가 궁금하세요?</h2>
            </div>
            <button type="button" onClick={reset} className="shrink-0 rounded-md border border-border bg-white px-2 py-1 text-xs font-bold text-(--jeju-text-body) hover:bg-(--jeju-primary-tint)">전체 보기</button>
          </div>
          <ul aria-label="분야별 색상 범례" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-1">
            {[...tops, ...(advanced ? [advanced] : [])].map((node) => {
              const color = branchColor(node.id);
              const active = index.get(selectedId)?.top === node.id;
              const Icon = ICONS[node.icon];
              return <li key={node.id}>
                <button type="button" aria-pressed={active} onClick={() => choose(node.id, true)}
                  className="flex min-h-12 w-full items-center gap-2 rounded-lg border px-2 py-2 text-left outline-none transition-colors hover:border-(--jeju-border-strong) focus-visible:shadow-(--jeju-focus-ring)"
                  style={{ borderColor: active ? color.line : "#e8edf3", background: active ? color.tint : undefined }}>
                  <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full" style={{ background: color.tint, color: color.text }}>{Icon ? <Icon className="size-4" /> : <span className="size-2 rounded-full" style={{ background: color.line }} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-bold" style={{ color: color.text }}>{node.label}</span>
                    {node.count !== undefined ? <span className="mt-0.5 block text-(length:--jeju-text-xs) tabular-nums text-muted-foreground">{countText(node)}</span> : null}
                  </span>
                  <ChevronRight aria-hidden="true" className="hidden size-3.5 shrink-0 text-muted-foreground lg:block" style={active ? { color: color.text } : undefined} />
                </button>
              </li>;
            })}
          </ul>
          <div className="mt-4 space-y-2 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
            <p className="flex items-center gap-2"><Sun aria-hidden="true" className="mx-1 size-6 shrink-0 text-[#bd8523]" />태양 · 복지정보 전체 지도</p>
            <p className="flex items-center gap-2"><span aria-hidden="true" className="mx-2 size-4 shrink-0 rounded-full bg-[#0173bc]" />행성 · 대분류</p>
            <p className="flex items-center gap-2"><span aria-hidden="true" className="mx-2.5 size-3 shrink-0 rounded-full border-2 border-[#0173bc] bg-[#e6f2fa]" />위성 · 소분류와 세부 항목</p>
            <p className="pt-1"><b className="font-bold text-(--jeju-text-body)">실선은 상위·하위 항목을 연결합니다.</b><br />위성은 부모 주위의 궤도에 모두 놓입니다. 이름은 항상 수평·가운데 정렬입니다.</p>
          </div>
          {selectedId !== "root" && panel ? <div className="mt-5 hidden border-t border-border pt-4 lg:block">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-muted-foreground">선택한 항목</p>
              <button type="button" aria-label="항목 선택 해제" onClick={() => select("root")} className="rounded p-1 hover:bg-(--jeju-surface-inset)"><X aria-hidden="true" className="size-3.5" /></button>
            </div>
            {panel}
          </div> : null}
        </aside>
        {mode === "map" ? (
          <section aria-label="복지정보 태양계 지도" className="relative min-w-0 overflow-hidden bg-[#f8fafc]" style={{ backgroundImage: "radial-gradient(#d5dde6 0.7px, transparent 0.7px)", backgroundSize: "44px 44px" }}>
            <div className="pointer-events-none absolute top-4 right-4 left-4 z-10 flex items-start justify-between gap-3">
              <span className="flex items-center gap-2 rounded-full border border-[#e9dfc5] bg-[#fffbef] px-3 py-1.5 text-xs font-bold text-[#906016]"><Sun aria-hidden="true" className="size-3.5" />태양 · 행성 · 위성</span>
              <span className="rounded-md bg-(--jeju-surface-inset)/95 px-2 py-1.5 text-(length:--jeju-text-xs) tabular-nums text-muted-foreground">표시 {nf.format(placed.length)} / 전체 {nf.format(countExplore(root))}</span>
            </div>
            <div
              ref={frameRef}
              tabIndex={0}
              aria-label="태양계 지도 조작 영역. 행성이나 위성을 선택하면 하위 위성이 펼쳐지고 오른쪽에 정렬됩니다. 플러스와 마이너스로 확대·축소, 방향키로 이동합니다."
              onClick={(event) => {
                if (dragged.current) { dragged.current = false; return; }
                openLastClicked(event.detail, event.timeStamp);
                if (event.detail === 1 && !(event.target as Element).closest("[data-node]")) { select("root"); setSheetOpen(false); }
              }}
              className="h-[68vh] min-h-[540px] w-full cursor-grab touch-none select-none outline-none focus-visible:shadow-(--jeju-focus-ring) active:cursor-grabbing lg:h-[min(76vh,900px)] lg:min-h-[740px]"
              onKeyDown={(event) => {
                if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(1.2); }
                if (event.key === "-" || event.key === "_") { event.preventDefault(); zoom(1 / 1.2); }
                if (event.target === event.currentTarget && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                  event.preventDefault(); interruptMotion();
                  setView((current) => ({ ...current, x: current.x + (event.key === "ArrowLeft" ? 50 : event.key === "ArrowRight" ? -50 : 0), y: current.y + (event.key === "ArrowUp" ? 50 : event.key === "ArrowDown" ? -50 : 0) }));
                }
              }}
              onPointerDown={(event) => {
                if (event.button !== 0 || (event.target as Element).closest("[data-node]")) return;
                interruptMotion(); setHoveredId(null); dragged.current = false;
                const current = viewRef.current;
                dragRef.current = { x: event.clientX, y: event.clientY, vx: current.x, vy: current.y, moved: false };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag) return;
                if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 3) drag.moved = true;
                if (drag.moved) setView((current) => ({ ...current, x: drag.vx + event.clientX - drag.x, y: drag.vy + event.clientY - drag.y }));
              }}
              onPointerUp={(event) => {
                dragged.current = dragRef.current?.moved ?? false; dragRef.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => { dragRef.current = null; }}
              onLostPointerCapture={() => { dragRef.current = null; }}
            >
              <svg width="100%" height="100%" role="tree" aria-label={ROOT_LABEL + ". 중앙 태양, 분야별 행성, 소분류 위성으로 구성한 2D 지도. 목록으로 보기에서 전체 항목을 글로 볼 수 있습니다."}>
                <g transform={"translate(" + view.x + "," + view.y + ") scale(" + view.k + ")"}>
                  <OrbitLayer items={placed} highlightId={highlightId} />
                  <ConnectionLayer items={placed} highlightedPath={highlightedPath} />
                  {placed.map((item) => (
                    <GraphNode key={item.node.id} item={item} selected={item.node.id === selectedId} hovered={item.node.id === hoveredId}
                      dim={highlightId !== "root" && !strong.has(item.node.id)} hit={hitIds.has(item.node.id)}
                      onHover={(active) => setHoveredId(active ? item.node.id : null)}
                      onSelect={(at) => { lastClick.current = { id: item.node.id, at }; if (item.node.id === "root") reset(); else choose(item.node.id); }}
                      onToggle={() => toggle(item.node.id)} />
                  ))}
                </g>
              </svg>
            </div>
            {hoveredId && hoveredId !== "root" && highlighted ? <div className="pointer-events-none absolute right-4 bottom-14 left-4 mx-auto w-fit max-w-[calc(100%_-_2rem)] rounded-lg border border-border bg-white px-4 py-2 text-sm">
              <span className="mr-2 inline-block size-2 rounded-full" style={{ background: branchColor(highlighted.top).line }} />
              <strong>{highlighted.node.label}</strong><span className="ml-2 text-xs text-muted-foreground">{countText(highlighted.node)}</span>
            </div> : null}
            {selectedId !== "root" && selected ? <div className="absolute right-3 bottom-3 left-3 flex items-center justify-between gap-2 rounded-xl border border-[#dbe3ec] bg-white px-3 py-2 lg:hidden">
              <div className="min-w-0"><p className="truncate text-sm font-bold text-(--jeju-text-strong)">{selected.label}</p><p className="text-(length:--jeju-text-xs) text-muted-foreground">{selected.children?.length ? (expanded.has(selectedId) ? "하위 위성 펼침" : "하위 위성 접힘") : "세부 항목 선택"}{countText(selected) ? " · " + countText(selected) : ""}</p></div>
              <button type="button" onClick={() => setSheetOpen(true)} className="flex min-h-10 shrink-0 items-center gap-1 rounded-lg bg-[#0173bc] px-3 text-xs font-bold text-white">상세정보<ArrowRight aria-hidden="true" className="size-3.5" /></button>
            </div> : null}
            {selectedId === "root" ? <p className="pointer-events-none absolute right-3 bottom-3 left-3 text-center text-(length:--jeju-text-xs) leading-relaxed text-muted-foreground">행성을 눌러 위성 탐색 · 태양을 눌러 전체 보기 · 끌어서 이동 · 휠 / + −로 확대·축소</p> : null}
            <p role="status" className="sr-only">{selectedId === "root" ? "태양과 분야별 행성 전체 보기" : (selected?.label ?? "") + " 선택됨. 오른쪽에 정렬됩니다." + (selected?.children?.length ? (expanded.has(selectedId) ? " 하위 위성이 펼쳐졌습니다." : " 하위 위성이 접혔습니다.") : "")}</p>
          </section>
        ) : (
          <section aria-label="복지정보 관계성 지도 목록" className="min-w-0 bg-white p-4 sm:p-6">
            <ExploreList root={root} selectedId={selectedId} expanded={expanded} onToggle={toggle} onSelect={(id) => select(id, { expandSelf: true })} onInfo={(id) => { select(id); setSheetOpen(true); }} />
          </section>
        )}
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

function OrbitLayer({ items, highlightId }: { readonly items: readonly Placed[]; readonly highlightId: string }) {
  return <g aria-hidden="true" pointerEvents="none">
    {solarOrbits(items).map(({ id, parent, radius }) => {
      const solar = parent.depth === 0;
      const color = branchColor(parent.topId);
      return <circle key={id} cx={parent.x} cy={parent.y} r={radius} fill="none"
        stroke={solar ? "#cbd6e2" : color.line} strokeOpacity={solar ? 0.58 : parent.node.id === highlightId ? 0.38 : 0.2}
        strokeWidth={solar ? 1 : 1.4} strokeDasharray={solar ? undefined : "4 7"} />;
    })}
  </g>;
}

function ConnectionLayer({ items, highlightedPath }: { readonly items: readonly Placed[]; readonly highlightedPath: ReadonlySet<string> }) {
  return <g aria-hidden="true" pointerEvents="none">
    {solarConnections(items).map(({ id, parent, child, x1, y1, x2, y2 }) => {
      const active = highlightedPath.has(child.node.id);
      return <line key={id} data-relation="parent-child" data-parent={parent.node.id} data-child={child.node.id}
        x1={x1} y1={y1} x2={x2} y2={y2} stroke={branchColor(child.topId).line}
        strokeOpacity={active ? 0.85 : child.depth === 1 ? 0.6 : 0.45} strokeWidth={active ? 2 : 1.25}
        vectorEffect="non-scaling-stroke" />;
    })}
  </g>;
}

function GraphNode({ item, selected, hovered, dim, hit, onSelect, onToggle, onHover }: {
  readonly item: Placed; readonly selected: boolean; readonly hovered: boolean; readonly dim: boolean; readonly hit: boolean;
  readonly onSelect: (at: number) => void; readonly onToggle: () => void; readonly onHover: (active: boolean) => void;
}) {
  const { node, depth } = item;
  const color = branchColor(item.topId);
  const count = countText(node);
  const hasChildren = Boolean(node.children?.length) && depth > 0;
  const isRoot = depth === 0;
  const isPlanet = depth === 1;
  const Icon = ICONS[node.icon];
  const active = selected || hovered;
  const label = node.label + (count ? ", " + count : "") + (hasChildren ? (item.expanded ? ", 하위 항목 펼침" : ", 하위 항목 접힘") : "") + (selected ? ", 선택됨" : "");
  const box = solarLabelBox(item);
  const toggle = solarTogglePosition(item);
  return (
    <g data-node={node.id} data-celestial={isRoot ? "sun" : isPlanet ? "planet" : "moon"} transform={"translate(" + item.x + "," + item.y + ")"}
      onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      <g role="treeitem" tabIndex={0} aria-level={depth + 1} aria-selected={selected} aria-expanded={hasChildren ? item.expanded : undefined} aria-label={label}
        onClick={(event) => { if (event.detail < 2) onSelect(event.timeStamp); }}
        onFocus={() => onHover(true)} onBlur={() => onHover(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); onSelect(Number.NEGATIVE_INFINITY); }
          if (event.key === " ") { event.preventDefault(); event.stopPropagation(); onToggle(); }
        }}
        className="cursor-pointer outline-none [&:focus-visible>.focus-ring]:stroke-[#111827] [&:focus-visible>.focus-ring]:stroke-[2.5px]">
        <title>{label}</title>
        {isRoot ? <>
          <circle r={item.r + 12} fill="#fff7df" stroke="#eddaa6" strokeWidth={1} />
          <circle r={item.r} fill="#f8ce69" stroke="#dea535" strokeWidth={1.5} />
          <Sun x={-13} y={-49} width={26} height={26} strokeWidth={1.5} color="#875612" aria-hidden="true" />
          <text textAnchor="middle" y={1} dominantBaseline="middle" fill="#644010" style={{ font: "800 " + (item.r < 74 ? 18 : 21) + "px " + FONT_FAMILY }}>복지정보</text>
          <text textAnchor="middle" y={25} dominantBaseline="middle" fill="#644010" style={{ font: "750 " + (item.r < 74 ? 16 : 18) + "px " + FONT_FAMILY }}>관계성 지도</text>
          <text textAnchor="middle" y={49} dominantBaseline="middle" fill="#80571e" style={{ font: "600 11px " + FONT_FAMILY }}>전체 보기</text>
          <circle className="focus-ring" r={item.r + 13} fill="none" stroke="transparent" />
        </> : <>
          <circle className={item.labelInside ? "focus-ring" : undefined} r={Math.max(22, item.r + 9)} fill={active || isPlanet ? color.tint : "transparent"} stroke={active ? color.line : "transparent"} strokeWidth={1} />
          <circle r={item.r} fill={item.labelInside ? color.tint : isPlanet || active ? color.line : color.tint} stroke={color.line} strokeWidth={item.labelInside ? 1.7 : isPlanet ? 1 : 2} />
          {!item.labelInside ? (isPlanet && Icon ? <Icon aria-hidden="true" x={-item.r * 0.4} y={-item.r * 0.4} width={item.r * 0.8} height={item.r * 0.8} strokeWidth={1.6} color="#ffffff" /> : <circle r={4} fill={active ? "#ffffff" : color.line} />) : null}
          <rect className={item.labelInside ? undefined : "focus-ring"} x={box.x} y={box.y} width={box.width} height={box.height} rx={9}
            fill={item.labelInside ? "transparent" : active ? color.tint : "#ffffff"} stroke={item.labelInside ? "transparent" : selected ? color.line : hit ? "#a65500" : "#dce4ec"}
            strokeWidth={selected ? 1.7 : 1} strokeDasharray={hit && !selected ? "3 3" : undefined} />
          <text x={0} textAnchor="middle" dominantBaseline="middle" fill={dim ? "#64748b" : isPlanet || active ? color.text : "#374151"}
            style={{ font: (isPlanet || active ? "750 " : "550 ") + SOLAR_LABEL_FONT_SIZE + "px " + FONT_FAMILY }}>
            {item.lines.map((line, position) => <tspan key={position} x={0} y={box.y + box.height / 2 + (position - (item.lines.length - 1) / 2) * SOLAR_LABEL_LINE_HEIGHT}>{line}</tspan>)}
          </text>
        </>}
      </g>
      {hasChildren && active ? <g aria-hidden="true" className="cursor-pointer" onClick={(event) => { event.stopPropagation(); onToggle(); }}>
        <circle cx={toggle.x} cy={toggle.y} r={SOLAR_TOGGLE_RADIUS} fill="#ffffff" stroke={color.line} strokeWidth={1.5} />
        <text x={toggle.x} y={toggle.y + 0.5} dominantBaseline="middle" textAnchor="middle" fill={color.text} style={{ font: "700 15px sans-serif" }}>{item.expanded ? "−" : "+"}</text>
      </g> : null}
    </g>
  );
}

function NodePanel({ node, path, onSelect, onToggle, expanded }: {
  readonly node: ExploreNode; readonly path: readonly ExploreNode[]; readonly onSelect: (id: string) => void; readonly onToggle: (id: string) => void; readonly expanded: boolean;
}) {
  const color = branchColor(path[1]?.id ?? node.id);
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
      {node.href && !node.links?.length ? <a href={node.href} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold text-white" style={{ background: color.text }}>상세 자료 보기<ArrowRight aria-hidden="true" className="size-3.5" /></a> : null}
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
                  <span className="truncate">{child.label}</span><span className="shrink-0 font-bold tabular-nums" style={{ color: color.text }}>{countText(child)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** 목록 보기: 지도와 같은 펼침 상태를 쓴다. 하위 항목이 있는 줄은 눌러서 펼치고, 정보 단추나 끝 항목을 누르면 정보칸을 연다. */
function ExploreList({ root, selectedId, expanded, onToggle, onSelect, onInfo }: {
  readonly root: ExploreNode; readonly selectedId: string; readonly expanded: ReadonlySet<string>;
  readonly onToggle: (id: string) => void; readonly onSelect: (id: string) => void; readonly onInfo: (id: string) => void;
}) {
  // 검색·기준 단추로 고른 항목이 목록 밖에 있으면 보이는 곳으로 옮긴다.
  useEffect(() => {
    document.querySelector("[data-list-id=\"" + CSS.escape(selectedId) + "\"] > div")?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [selectedId]);
  const row = (node: ExploreNode, depth: number, topId: string): ReactNode => {
    const color = branchColor(topId);
    const hasChildren = Boolean(node.children?.length);
    const isOpen = expanded.has(node.id);
    const Icon = depth === 0 ? ICONS[node.icon] : null;
    return (
      <li key={node.id} data-list-id={node.id} role="treeitem" aria-level={depth + 1} aria-expanded={hasChildren ? isOpen : undefined} aria-selected={selectedId === node.id}>
        <div className={"flex items-center gap-1 rounded-lg " + (depth === 0 ? "border border-border bg-white px-1 py-1" : "px-1")} style={depth === 0 ? { borderLeft: "5px solid " + color.line } : undefined}>
          {hasChildren ? (
            <button type="button" aria-label={(isOpen ? "접기: " : "펼치기: ") + node.label} onClick={() => onToggle(node.id)} className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-(--jeju-primary-tint)">
              {isOpen ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}
            </button>
          ) : <span className="size-9 shrink-0" aria-hidden="true" />}
          <button type="button" onClick={() => { if (!hasChildren) onInfo(node.id); else if (isOpen && selectedId === node.id) onToggle(node.id); else onSelect(node.id); }}
            className={"flex min-h-9 flex-1 items-center justify-between gap-2 rounded-md px-1 text-left hover:bg-(--jeju-primary-tint) " + (selectedId === node.id ? "font-extrabold" : "")}>
            <span className="flex items-center gap-1.5">{Icon ? <Icon aria-hidden="true" className="size-4" style={{ color: color.line }} /> : null}<span className={depth === 0 ? "text-(length:--jeju-text-md) font-extrabold" : "text-(length:--jeju-text-sm)"}>{node.label}</span></span>
            <span className="shrink-0 text-(length:--jeju-text-sm) font-bold tabular-nums" style={{ color: color.text }}>{countText(node)}</span>
          </button>
          {hasChildren ? (
            <button type="button" aria-label={"정보 보기: " + node.label} title="관련 자료 보기" onClick={() => onInfo(node.id)} className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-(--jeju-primary-tint) hover:text-[#015f9b]">
              <Info aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </div>
        {hasChildren && isOpen ? <ul role="group" className="ml-4 border-l border-border pl-2">{(node.children ?? []).map((child) => row(child, depth + 1, topId))}</ul> : null}
      </li>
    );
  };
  return (
    <div className="space-y-2">
      <p className="text-(length:--jeju-text-sm) font-bold">무엇을 기준으로 찾아볼까요?</p>
      <ul role="tree" aria-label={ROOT_LABEL + " 목록"} className="space-y-2">{(root.children ?? []).map((node) => row(node, 0, node.id))}</ul>
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

