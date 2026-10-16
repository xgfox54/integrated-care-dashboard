import type { ExploreNode } from "./mindmap-view.ts";

export { BRANCH_COLORS, rotationToRight } from "./mindmap-radial.ts";

export const SOLAR_LABEL_FONT_SIZE = 17;
export const SOLAR_LABEL_LINE_HEIGHT = 21;
export const SOLAR_TOGGLE_RADIUS = 11;
const GAP = 24;
const TAU = Math.PI * 2;

export interface SolarNode {
  readonly node: ExploreNode;
  readonly parentId: string | null;
  readonly topId: string;
  readonly depth: number;
  readonly x: number;
  readonly y: number;
  /** Global polar coordinates are used only for rotating a selection to the right. */
  readonly angle: number;
  readonly radius: number;
  /** Each moon orbits its actual parent, not the central Sun. */
  readonly orbitRadius: number;
  readonly r: number;
  readonly expanded: boolean;
  readonly lines: readonly string[];
  readonly labelWidth: number;
  readonly labelInside: boolean;
  /** Circular clearance includes the upright caption, body, focus ring and toggle. */
  readonly clearance: number;
}

function textWidth(label: string): number {
  let width = 0;
  for (const character of label) {
    if (/\p{Mark}/u.test(character)) continue;
    width += SOLAR_LABEL_FONT_SIZE * (/\s/u.test(character) ? 0.34 : character.codePointAt(0)! >= 0x1100 ? 1.06 : /[A-ZMW@%]/.test(character) ? 0.78 : 0.59);
  }
  return Math.ceil(width + 4);
}

/** At most two centered lines; the full label remains in the accessible name and details. */
export function solarLabelLines(label: string, limit = 142): readonly string[] {
  const characters = Array.from(label.trim());
  if (textWidth(label) <= limit) return [label];
  const lines: string[] = [];
  for (let row = 0; row < 2 && characters.length; row++) {
    let line = "";
    while (characters.length && textWidth(line + characters[0] + (row === 1 && characters.length > 1 ? "…" : "")) <= limit) line += characters.shift();
    if (row === 0) {
      const space = line.lastIndexOf(" ");
      if (space >= 3) {
        characters.unshift(...Array.from(line.slice(space + 1)));
        line = line.slice(0, space);
      }
    }
    if (row === 1 && characters.length) line += "…";
    lines.push(line.trim());
    while (characters[0] === " ") characters.shift();
  }
  return lines;
}

export function solarLabelBox(item: Pick<SolarNode, "r" | "labelWidth" | "lines"> & { readonly labelInside?: boolean }) {
  const height = item.lines.length * SOLAR_LABEL_LINE_HEIGHT + 12;
  return { x: -item.labelWidth / 2, y: item.labelInside ? -height / 2 : item.r + 12, width: item.labelWidth, height };
}

export function solarTogglePosition(item: Pick<SolarNode, "r"> & { readonly labelInside?: boolean }) {
  return item.labelInside ? { x: item.r * 0.7, y: -item.r * 0.7 } : { x: item.r * 0.78 + 8, y: -item.r * 0.78 - 2 };
}

interface Entry {
  node: ExploreNode;
  parent: Entry | null;
  topId: string;
  depth: number;
  children: Entry[];
  r: number;
  lines: readonly string[];
  labelWidth: number;
  labelInside: boolean;
  clearance: number;
  extent: number;
  orbit: number;
  phase: number;
  x: number;
  y: number;
}

/**
 * Nested orbital systems, packed bottom-up using circular subtree envelopes.
 * Each envelope reserves the complete horizontal caption in every rotation.
 * The packing is deterministic and independent of counts or animation frames.
 */
export function layoutSolar(root: ExploreNode, expanded: ReadonlySet<string>, visible: (node: ExploreNode) => readonly ExploreNode[], compact = false): SolarNode[] {
  const create = (node: ExploreNode, parent: Entry | null): Entry => {
    const depth = parent ? parent.depth + 1 : 0;
    const labelInside = compact && depth === 1;
    const r = depth === 0 ? (compact ? 64 : 74) : depth === 1 ? (compact ? (node.id === "advanced" ? 43 : 52) : node.id === "advanced" ? 27 : 36) : depth === 2 ? 18 : 15;
    const lines = depth === 0 ? ["복지정보", "관계성 지도"] : solarLabelLines(node.label, labelInside ? 100 : 142);
    const labelWidth = Math.max(64, ...lines.map(textWidth)) + (labelInside ? 8 : 20);
    const box = solarLabelBox({ r, labelWidth, lines, labelInside });
    const toggle = solarTogglePosition({ r, labelInside });
    const clearance = depth === 0 ? r + 14 : Math.ceil(Math.max(Math.hypot(box.width / 2 + 3, box.y + box.height + 3), Math.hypot(toggle.x, toggle.y) + SOLAR_TOGGLE_RADIUS + 4, r + 9));
    return { node, parent, topId: !parent ? node.id : parent.depth === 0 ? node.id : parent.topId, depth, children: [], r, lines, labelWidth, labelInside, clearance, extent: clearance, orbit: 0, phase: 0, x: 0, y: 0 };
  };
  const first = create(root, null);
  const entries: Entry[] = [];
  const seen = new Set([root.id]);
  const stack = [first];
  while (stack.length) {
    const entry = stack.pop()!;
    entries.push(entry);
    if (!expanded.has(entry.node.id)) continue;
    for (const child of visible(entry.node)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      entry.children.push(create(child, entry));
    }
    for (let i = entry.children.length - 1; i >= 0; i--) stack.push(entry.children[i]);
  }

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry.children.length) continue;
    const gap = compact && entry.depth === 0 ? 18 : GAP;
    // Every child is placed. Larger families use successive local orbits, never pages.
    // Ring capacity grows with circumference so the system does not become one huge circle.
    let offset = 0, ring = 0, previousOuterEdge = entry.clearance;
    while (offset < entry.children.length) {
      const capacity = entry.children.length <= 10 ? entry.children.length : 6 * (ring + 1);
      const children = entry.children.slice(offset, offset + capacity);
      let largest = 0;
      for (const child of children) largest = Math.max(largest, child.extent);
      let orbit = previousOuterEdge + largest + gap;
      if (children.length > 32) {
        // A conservative nearest-neighbour bound keeps very large source trees linear.
        orbit = Math.max(orbit, (2 * largest + gap) / (2 * Math.sin(Math.PI / children.length)));
      } else {
        for (let a = 0; a < children.length; a++) {
          for (let b = a + 1; b < children.length; b++) {
            const separation = 2 * Math.abs(Math.sin(Math.PI * (b - a) / children.length));
            orbit = Math.max(orbit, (children[a].extent + children[b].extent + gap) / separation);
          }
        }
      }
      children.forEach((child, position) => {
        child.orbit = Math.ceil(orbit) + (entry.depth === 0 ? (position % 3) * (compact ? 6 : 22) : 0);
        // Stagger neighbouring rings so their connection lines do not share the same rays.
        child.phase = (entry.children.length === 1 ? 0 : -Math.PI / 2) + position * TAU / children.length + (ring % 2 ? Math.PI / children.length : 0);
        entry.extent = Math.max(entry.extent, child.orbit + child.extent);
      });
      previousOuterEdge = entry.extent;
      offset += children.length;
      ring++;
    }
  }

  for (const entry of entries) {
    const direction = entry.depth === 0 ? 0 : Math.atan2(entry.y, entry.x);
    entry.children.forEach((child) => {
      const angle = direction + child.phase;
      child.x = entry.x + Math.cos(angle) * child.orbit;
      child.y = entry.y + Math.sin(angle) * child.orbit;
    });
  }
  return entries.map((entry) => ({
    node: entry.node, parentId: entry.parent?.node.id ?? null, topId: entry.topId, depth: entry.depth,
    x: entry.x, y: entry.y, angle: entry.depth === 0 ? 0 : Math.atan2(entry.y, entry.x), radius: Math.hypot(entry.x, entry.y), orbitRadius: entry.orbit,
    r: entry.r, expanded: expanded.has(entry.node.id), lines: entry.lines, labelWidth: entry.labelWidth, labelInside: entry.labelInside, clearance: entry.clearance,
  }));
}

/** Rotate geometry as one system. Captions and icons never rotate. */
export function projectSolar(items: readonly SolarNode[], rotation = 0): SolarNode[] {
  const cosine = Math.cos(rotation), sine = Math.sin(rotation);
  return items.map((item) => ({ ...item, x: item.x * cosine - item.y * sine, y: item.x * sine + item.y * cosine }));
}

export function solarBounds(items: readonly SolarNode[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const item of items) {
    const box = solarLabelBox(item);
    const toggle = solarTogglePosition(item);
    const root = item.depth === 0;
    minX = Math.min(minX, item.x - (root ? item.r + 14 : Math.max(item.r + 9, box.width / 2 + 3)));
    maxX = Math.max(maxX, item.x + (root ? item.r + 14 : Math.max(item.r + 9, box.width / 2 + 3, toggle.x + SOLAR_TOGGLE_RADIUS + 3)));
    minY = Math.min(minY, item.y - (root ? item.r + 14 : Math.max(item.r + 9, -toggle.y + SOLAR_TOGGLE_RADIUS + 3)));
    maxY = Math.max(maxY, item.y + (root ? item.r + 14 : Math.max(item.r + 9, box.y + box.height + 3)));
  }
  return items.length ? { minX, maxX, minY, maxY } : { minX: -1, maxX: 1, minY: -1, maxY: 1 };
}

export function solarOrbits(items: readonly SolarNode[]) {
  const byId = new Map(items.map((item) => [item.node.id, item]));
  const orbits = new Map<string, { id: string; parent: SolarNode; radius: number }>();
  for (const item of items) {
    const parent = item.parentId ? byId.get(item.parentId) : undefined;
    if (!parent) continue;
    const id = parent.node.id + ":" + item.orbitRadius;
    orbits.set(id, { id, parent, radius: item.orbitRadius });
  }
  return [...orbits.values()];
}

/** One solid relationship per visible child, including every Sun–planet connection. */
export function solarConnections(items: readonly SolarNode[]) {
  const byId = new Map(items.map((item) => [item.node.id, item]));
  return items.flatMap((child) => {
    const parent = child.parentId ? byId.get(child.parentId) : undefined;
    if (!parent) return [];
    const dx = child.x - parent.x, dy = child.y - parent.y;
    const distance = Math.hypot(dx, dy);
    if (!distance) return [];
    const start = Math.min(parent.r + (parent.depth === 0 ? 13 : 3), distance / 2);
    const end = Math.min(child.r + 3, distance / 2);
    return [{ id: child.node.id, parent, child,
      x1: parent.x + dx / distance * start, y1: parent.y + dy / distance * start,
      x2: child.x - dx / distance * end, y2: child.y - dy / distance * end,
    }];
  });
}
