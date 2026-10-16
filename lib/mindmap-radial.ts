import type { ExploreNode } from "./mindmap-view.ts";

/** The SVG renderer uses these same metrics when drawing the radial labels. */
export const RADIAL_LABEL_FONT_SIZE = 15.5;
export const RADIAL_LABEL_GAP = 28;
export const RADIAL_TOP_LABEL_Y = 0;
export const RADIAL_TOGGLE_OFFSET = 32;
export const RADIAL_TOGGLE_RADIUS = 11;

const LABEL_PADDING_X = 7;
const LABEL_HEIGHT = 28;
const LABEL_CLEARANCE = 4;

export const BRANCH_COLORS: Readonly<Record<string, { readonly line: string; readonly text: string; readonly tint: string }>> = {
  root: { line: "#334155", text: "#334155", tint: "#f1f5f9" },
  target: { line: "#00a074", text: "#087858", tint: "#e6f5ef" },
  service: { line: "#0173bc", text: "#015b94", tint: "#e6f2fa" },
  region: { line: "#168c9e", text: "#116c79", tint: "#e8f5f6" },
  welfare: { line: "#8057b2", text: "#64418f", tint: "#f1ebf8" },
  budget: { line: "#f18101", text: "#9a5100", tint: "#fff2e3" },
  news: { line: "#bb4f76", text: "#96395d", tint: "#faedf2" },
  advanced: { line: "#667085", text: "#525c6c", tint: "#f0f2f5" },
};

export interface RadialNode {
  readonly node: ExploreNode;
  readonly depth: number;
  readonly parentId: string | null;
  /** Taken from ancestry, because source IDs such as svc/* do not start with their top-level ID. */
  readonly topId: string;
  /** Polar angle in radians, normalized to [-π, π). SVG's y axis points down. */
  readonly angle: number;
  readonly radius: number;
  readonly x: number;
  readonly y: number;
  /** Structural circle radius; deliberately independent of the node's data count. */
  readonly r: number;
  /** Text remains horizontal, including while the network rotates. */
  readonly labelAngle: number;
  readonly labelAnchor: "start" | "end";
  /** Extra horizontal displacement when a selected label must clear a neighbouring node. */
  readonly labelOffsetX: number;
  /** Label centre relative to its node; a leader can connect displaced labels. */
  readonly labelY: number;
  readonly expanded: boolean;
  readonly labelWidth: number;
}

interface Entry {
  node: ExploreNode;
  parent: Entry | null;
  depth: number;
  topId: string;
  children: Entry[];
  labelWidth: number;
  weight: number;
  angle: number;
  start: number;
  end: number;
}

const TAU = Math.PI * 2;

function textWidth(label: string): number {
  let width = 0;
  for (const character of label) {
    const code = character.codePointAt(0)!;
    // Korean/CJK and emoji are approximately one em. Latin/digits and punctuation are narrower.
    if (/\p{Mark}/u.test(character)) continue;
    if (/\s/u.test(character)) width += RADIAL_LABEL_FONT_SIZE * 0.32;
    else if (code >= 0x1100) width += RADIAL_LABEL_FONT_SIZE;
    else width += RADIAL_LABEL_FONT_SIZE * (/[A-ZMW@%]/.test(character) ? 0.72 : 0.56);
  }
  // A small allowance accommodates bold top labels and differences between installed fonts.
  return Math.ceil(width * 1.07 + 3);
}

const normalizeAngle = (angle: number) => ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;

/**
 * Deterministic 2D circular tree layout. Only expanded, visible child relationships are traversed.
 * Each main branch receives a separate angular sector based on its visible terminal labels.
 * All terminal nodes below the first ring share an outer radius, creating a clear circular edge.
 * Iterative traversal also handles unusually deep data without overflowing the call stack.
 */
export function layoutRadial(
  root: ExploreNode,
  expanded: ReadonlySet<string>,
  visible: (node: ExploreNode) => readonly ExploreNode[],
): RadialNode[] {
  const first: Entry = {
    node: root, parent: null, depth: 0, topId: root.id, children: [],
    labelWidth: textWidth(root.label), weight: 1, angle: 0, start: 0, end: TAU,
  };
  const entries: Entry[] = [];
  const seen = new Set<string>([root.id]);
  const stack: Entry[] = [first];
  let maxDepth = 0;

  while (stack.length) {
    const entry = stack.pop()!;
    entries.push(entry);
    maxDepth = Math.max(maxDepth, entry.depth);
    if (!expanded.has(entry.node.id)) continue;
    for (const child of visible(entry.node)) {
      // Source nodes normally have unique IDs; ignore a repeated ID/cycle defensively.
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      entry.children.push({
        node: child, parent: entry, depth: entry.depth + 1,
        topId: entry.depth === 0 ? child.id : entry.topId,
        children: [], labelWidth: textWidth(child.label), weight: 1,
        angle: 0, start: 0, end: 0,
      });
    }
    for (let index = entry.children.length - 1; index >= 0; index--) stack.push(entry.children[index]);
  }

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    // Slightly wider slots for long labels supplement the common line-height clearance.
    entry.weight = entry.children.length
      ? entry.children.reduce((total, child) => total + child.weight, 0)
      : 1 + Math.min(0.45, entry.labelWidth / 400);
  }

  const branches = first.children;
  const gap = branches.length > 1 ? Math.min(0.085, TAU / (branches.length * 5)) : 0;
  const usableAngle = TAU - branches.length * gap;
  const totalSectorWeight = branches.reduce((total, branch) => total + Math.max(4, branch.weight), 0);
  const firstSpan = totalSectorWeight ? usableAngle * Math.max(4, branches[0].weight) / totalSectorWeight : 0;
  // Keep the first branch centred at 12 o'clock; source order proceeds clockwise.
  let cursor = -Math.PI / 2 - firstSpan / 2;
  for (const branch of branches) {
    const span = usableAngle * Math.max(4, branch.weight) / totalSectorWeight;
    branch.start = cursor;
    branch.end = cursor + span;
    cursor += span + gap;
  }

  for (const entry of entries) {
    if (entry.depth === 0) continue;
    entry.angle = normalizeAngle((entry.start + entry.end) / 2);
    let childCursor = entry.start;
    for (const child of entry.children) {
      const span = (entry.end - entry.start) * child.weight / entry.weight;
      child.start = childCursor;
      child.end = childCursor + span;
      childCursor += span;
    }
  }

  const firstRing = 152;
  // Normal first view: 390 px. Expansion grows the circumference to preserve readable slots.
  // Depth contributes at most four steps, and an extreme dataset cannot produce infinite extents.
  const outerRing = Math.min(8_000, Math.max(
    390 + Math.max(0, Math.min(maxDepth, 6) - 2) * 16,
    totalSectorWeight * 23 / Math.max(usableAngle, 0.1),
  ));

  return entries.map((entry): RadialNode => {
    const radius = entry.depth === 0 ? 0
      : entry.depth === 1 ? firstRing
        : entry.children.length === 0 ? outerRing
          : firstRing + (outerRing - firstRing) * (entry.depth - 1) / Math.max(1, maxDepth - 1);
    const left = Math.cos(entry.angle) < -1e-10;
    return {
      node: entry.node, depth: entry.depth, parentId: entry.parent?.node.id ?? null,
      topId: entry.topId, angle: entry.angle, radius,
      x: Math.cos(entry.angle) * radius,
      y: Math.sin(entry.angle) * radius,
      r: entry.depth === 0 ? 64 : entry.depth === 1 ? 7 : (entry.node.children?.length ?? 0) > 0 ? 5 : 3.5,
      labelAngle: 0,
      labelAnchor: left ? "end" : "start",
      labelOffsetX: 0,
      labelY: RADIAL_TOP_LABEL_Y,
      expanded: entry.children.length > 0,
      labelWidth: entry.labelWidth,
    };
  });
}

/** The nearest equivalent rotation that puts a selected node at three o'clock. */
export function rotationToRight(nodeAngle: number, currentRotation: number): number {
  return currentRotation + normalizeAngle(-nodeAngle - currentRotation);
}

export interface RadialLabelBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Local SVG coordinates shared by label backgrounds, hit targets, and viewport fitting. */
export function radialLabelBox(item: RadialNode): RadialLabelBox {
  const width = item.labelWidth + LABEL_PADDING_X * 2;
  return {
    x: (item.depth === 0 ? -width / 2
      : item.labelAnchor === "end" ? -RADIAL_LABEL_GAP - item.labelWidth - LABEL_PADDING_X
        : RADIAL_LABEL_GAP - LABEL_PADDING_X) + item.labelOffsetX,
    y: item.labelY - LABEL_HEIGHT / 2,
    width,
    height: LABEL_HEIGHT,
  };
}

function worldLabelBox(item: RadialNode): RadialLabelBox {
  const box = radialLabelBox(item);
  return { ...box, x: item.x + box.x, y: item.y + box.y };
}

/** Reserve the visible node, its hover/focus area, and the expand/collapse control. */
function nodeObstacles(item: RadialNode): RadialLabelBox[] {
  const label = radialLabelBox(item);
  const radius = item.depth === 0 ? item.r + 8 : Math.max(15, item.r + 8);
  const halfWidth = item.depth === 0 ? Math.max(radius, label.width / 2) : radius;
  const obstacles = [{ x: item.x - halfWidth, y: item.y - radius, width: halfWidth * 2, height: radius * 2 }];
  if (item.depth > 0 && item.node.children?.length) {
    // Reserve this even before hover so showing a button cannot cover another label.
    const x = item.x + (item.labelAnchor === "start" ? -1 : 1) * RADIAL_TOGGLE_OFFSET;
    const r = RADIAL_TOGGLE_RADIUS + 1;
    obstacles.push({ x: x - r, y: item.y - r, width: r * 2, height: r * 2 });
  }
  return obstacles;
}

/** Keep the selected name on its node's row, moving it outwards past any blocked space. */
function outwardLabelX(box: RadialLabelBox, direction: number, occupied: readonly RadialLabelBox[]): number {
  const blockers = occupied
    .filter((other) => box.y < other.y + other.height + LABEL_CLEARANCE && box.y + box.height + LABEL_CLEARANCE > other.y)
    .sort((a, b) => direction > 0 ? a.x - b.x : b.x + b.width - a.x - a.width);
  let x = box.x;
  for (const other of blockers) {
    if (x < other.x + other.width + LABEL_CLEARANCE && x + box.width + LABEL_CLEARANCE > other.x) {
      x = direction > 0 ? other.x + other.width + LABEL_CLEARANCE : other.x - box.width - LABEL_CLEARANCE;
    }
  }
  return x;
}

/**
 * Find the nearest free label centre. Only boxes sharing horizontal space are
 * obstacles: inner and outer labels may retain the same row when they fit.
 */
function nearestLabelY(box: RadialLabelBox, desiredY: number, occupied: readonly RadialLabelBox[]): number {
  const halfHeight = box.height / 2;
  const forbidden = occupied
    .filter((other) => box.x < other.x + other.width + LABEL_CLEARANCE && box.x + box.width + LABEL_CLEARANCE > other.x)
    .map((other) => ({ low: other.y - halfHeight - LABEL_CLEARANCE, high: other.y + other.height + halfHeight + LABEL_CLEARANCE }));
  if (!forbidden.some(({ low, high }) => desiredY > low && desiredY < high)) return desiredY;
  forbidden.sort((a, b) => a.low - b.low);
  let low = forbidden[0].low;
  let high = forbidden[0].high;
  const nearestEdge = () => {
    const up = desiredY - low;
    const down = high - desiredY;
    // Equal choices go away from the centre, keeping the hub clear.
    return up < down || (up === down && desiredY < 0) ? low : high;
  };
  for (let index = 1; index < forbidden.length; index++) {
    const interval = forbidden[index];
    if (interval.low < high) {
      high = Math.max(high, interval.high);
      continue;
    }
    if (desiredY > low && desiredY < high) return nearestEdge();
    low = interval.low;
    high = interval.high;
  }
  return desiredY > low && desiredY < high ? nearestEdge() : desiredY;
}

/**
 * Rotate node positions without tilting text or changing source order/topology.
 * The selected label stays beside its node. Other labels move only when their
 * rectangles overlap a label, node, or control. Upper-level labels receive first choice.
 */
export function projectRadial(items: readonly RadialNode[], rotation: number, selectedId?: string): RadialNode[] {
  const projected = items.map((item): RadialNode => {
    const angle = item.depth === 0 ? 0 : normalizeAngle(item.angle + rotation);
    return {
      ...item,
      angle,
      x: item.depth === 0 ? 0 : Math.cos(angle) * item.radius,
      y: item.depth === 0 ? 0 : Math.sin(angle) * item.radius,
      labelAngle: 0,
      labelAnchor: Math.cos(angle) < -1e-10 ? "end" : "start",
      labelOffsetX: 0,
      labelY: 0,
    };
  });
  const occupied = projected.flatMap(nodeObstacles);
  const order = projected.map((item, index) => ({ item, index }))
    .filter(({ item }) => item.depth > 0)
    .sort((a, b) => Number(b.item.node.id === selectedId) - Number(a.item.node.id === selectedId) || a.item.depth - b.item.depth || a.index - b.index);
  for (const { item, index } of order) {
    const box = worldLabelBox(item);
    const selected = item.node.id === selectedId;
    const labelOffsetX = selected ? outwardLabelX(box, item.labelAnchor === "start" ? 1 : -1, occupied) - box.x : 0;
    const labelY = selected ? 0 : nearestLabelY(box, item.y, occupied) - item.y;
    const placed = { ...item, labelOffsetX, labelY: Math.abs(labelY) < 1e-9 ? 0 : labelY };
    projected[index] = placed;
    occupied.push(worldLabelBox(placed));
  }
  return projected;
}

const coordinate = (value: number) => String(Math.round(value * 1_000) / 1_000);

/** Draw these with the branch lines, below every node and opaque label background. */
export function radialLabelLeaderPath(item: RadialNode): string | null {
  if (item.depth === 0 || (Math.abs(item.labelY) < 0.5 && Math.abs(item.labelOffsetX) < 0.5)) return null;
  const direction = item.labelAnchor === "start" ? 1 : -1;
  const box = radialLabelBox(item);
  const edge = item.labelAnchor === "start" ? box.x : box.x + box.width;
  return `M ${coordinate(item.x + direction * (item.r + 1))} ${coordinate(item.y)} L ${coordinate(item.x + edge - direction * 3)} ${coordinate(item.y + item.labelY)}`;
}

/** Curved radial connection between actual parent and child centres; the root starts outside its ring. */
export function radialLinkPath(parent: RadialNode, child: RadialNode): string {
  const fromRoot = parent.depth === 0;
  const startAngle = fromRoot ? child.angle : parent.angle;
  const startRadius = fromRoot ? parent.r + 6 : parent.radius;
  const startX = fromRoot ? Math.cos(startAngle) * startRadius : parent.x;
  const startY = fromRoot ? Math.sin(startAngle) * startRadius : parent.y;
  const middleRadius = (startRadius + child.radius) / 2;
  const points = [
    startX, startY,
    Math.cos(startAngle) * middleRadius, Math.sin(startAngle) * middleRadius,
    Math.cos(child.angle) * middleRadius, Math.sin(child.angle) * middleRadius,
    child.x, child.y,
  ].map(coordinate);
  return `M ${points[0]} ${points[1]} C ${points[2]} ${points[3]} ${points[4]} ${points[5]} ${points[6]} ${points[7]}`;
}

/** Bounds include displaced horizontal label backgrounds and the root's outer ring. */
export function radialBounds(items: readonly RadialNode[]): { minX: number; maxX: number; minY: number; maxY: number } {
  if (!items.length) return { minX: -80, maxX: 80, minY: -80, maxY: 80 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };

  for (const item of items) {
    for (const obstacle of nodeObstacles(item)) {
      include(obstacle.x, obstacle.y);
      include(obstacle.x + obstacle.width, obstacle.y + obstacle.height);
    }
    const box = worldLabelBox(item);
    include(box.x, box.y);
    include(box.x + box.width, box.y + box.height);
  }
  return { minX, maxX, minY, maxY };
}
