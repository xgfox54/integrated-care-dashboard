// 업무구조도 연결선을 노드 상자와 겹치지 않게 직각 경로로 잇는다.
// 노드 상자를 여백만큼 키운 장애물로 두고, 칸 경계·상자 둘레의 선들로 만든 격자에서
// 길이 + 꺾임 + 다른 선과 겹쳐 달리는 구간에 비용을 매겨 최소 비용 경로를 찾는다.

const MARGIN = 7;
const TRACK = 6;
const BEND = 22;
const REUSE = 3;
const REUSE_FIXED = 14;
const PORT_GAP_Y = 8;
const PORT_GAP_X = 16;
const ARROW_GAP = 4;
const EPS = 0.01;

const SIDE_DIR = { right: 0, left: 1, bottom: 2, top: 3 };
const SIDES = ["right", "left", "bottom", "top"];
const TYPE_ORDER = { sequence: 0, message: 1, loop: 2 };

// 좌표는 0.5px 단위로 맞춘다. 장애물 경계는 바깥쪽으로 올림·내림해 출입구가 장애물 안으로 밀리지 않게 한다.
const half = (value) => Math.round(value * 2) / 2;
const halfDown = (value) => Math.floor(value * 2) / 2;
const halfUp = (value) => Math.ceil(value * 2) / 2;

function uniqueSorted(values, min, max) {
  const sorted = values.filter((value) => Number.isFinite(value) && value >= min - EPS && value <= max + EPS).map(half).sort((a, b) => a - b);
  const out = [];
  for (const value of sorted) if (out.length === 0 || value - out[out.length - 1] > EPS) out.push(value);
  return out;
}

/** 보조 경로선은 필수 좌표(노드 둘레·출입구·영역 끝)나 다른 보조선과 3px 안에 붙으면 버려 선이 겹쳐 보이지 않게 한다. */
function mergeCoordinates(essential, optional, min, max) {
  const base = uniqueSorted(essential, min, max);
  const kept = [...base];
  for (const value of uniqueSorted(optional, min, max)) {
    if (kept.every((other) => Math.abs(other - value) >= 3)) kept.push(value);
  }
  return kept.sort((a, b) => a - b);
}

function nearestIndex(list, value) {
  let low = 0;
  let high = list.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (list[mid] < value) low = mid + 1;
    else high = mid;
  }
  let best = low;
  if (low > 0 && Math.abs(list[low - 1] - value) < Math.abs(list[low] - value)) best = low - 1;
  return Math.abs(list[best] - value) <= 0.26 ? best : -1;
}

class MinHeap {
  constructor() {
    this.keys = [];
    this.values = [];
  }
  get size() {
    return this.keys.length;
  }
  push(key, value) {
    const keys = this.keys;
    const values = this.values;
    let index = keys.length;
    keys.push(key);
    values.push(value);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[index] = keys[parent];
      values[index] = values[parent];
      index = parent;
    }
    keys[index] = key;
    values[index] = value;
  }
  pop() {
    const keys = this.keys;
    const values = this.values;
    const top = values[0];
    const lastKey = keys.pop();
    const lastValue = values.pop();
    if (keys.length > 0) {
      let index = 0;
      const length = keys.length;
      for (;;) {
        const left = index * 2 + 1;
        if (left >= length) break;
        const right = left + 1;
        const child = right < length && keys[right] < keys[left] ? right : left;
        if (keys[child] >= lastKey) break;
        keys[index] = keys[child];
        values[index] = values[child];
        index = child;
      }
      keys[index] = lastKey;
      values[index] = lastValue;
    }
    return top;
  }
}

function classify(source, target) {
  return {
    forward: target.left >= source.right - 2,
    backward: target.right <= source.left + 2,
    below: target.top >= source.bottom - 2,
    above: target.bottom <= source.top + 2,
  };
}

/** 선이 나가거나 들어가는 면의 자연스러움 점수. 0이 가장 자연스럽다. */
function sidePenalty(side, role, relation, type) {
  const { forward, backward, below, above } = relation;
  let natural;
  if (role === "out") {
    natural = forward ? ["right"] : backward ? ["left", "top", "bottom"] : below ? ["bottom"] : above ? ["top"] : ["right"];
    if (forward && below) natural.push("bottom");
    if (forward && above) natural.push("top");
  } else {
    natural = forward ? ["left"] : backward ? ["right", "top", "bottom"] : below ? ["top"] : above ? ["bottom"] : ["left"];
    if (forward && below) natural.push("top");
    if (forward && above) natural.push("bottom");
  }
  if (natural.includes(side)) return 0;
  return type === "loop" ? 20 : 45;
}

/**
 * @param {{ rects: Map<string, {left:number,right:number,top:number,bottom:number}>,
 *   edges: {id:string, source:string, target:string, type:"sequence"|"message"|"loop"}[],
 *   region: {left:number, top:number, right:number, bottom:number},
 *   gutters?: {xs:number[], ys:number[]} }} input
 * @returns {Map<string, number[][]>}
 */
export function routeProcessEdges({ rects, edges, region, gutters = { xs: [], ys: [] } }) {
  const nodes = [...rects.entries()].map(([id, rect]) => ({
    id,
    raw: rect,
    cx: half((rect.left + rect.right) / 2),
    cy: half((rect.top + rect.bottom) / 2),
    left: halfDown(rect.left - MARGIN),
    right: halfUp(rect.right + MARGIN),
    top: halfDown(rect.top - MARGIN),
    bottom: halfUp(rect.bottom + MARGIN),
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));

  const xValues = [region.left + 3, region.right - 3];
  const yValues = [region.top + 3, region.bottom - 3];
  const xOptional = [];
  const yOptional = [];
  for (const x of gutters.xs) xOptional.push(x, x - TRACK, x + TRACK);
  for (const y of gutters.ys) yOptional.push(y, y - TRACK, y + TRACK);
  for (const node of nodes) {
    xValues.push(node.left, node.right, node.cx, node.cx - PORT_GAP_X, node.cx + PORT_GAP_X);
    yValues.push(node.top, node.bottom, node.cy, node.cy - PORT_GAP_Y, node.cy + PORT_GAP_Y);
    xOptional.push(node.left - TRACK, node.right + TRACK);
    yOptional.push(node.top - TRACK, node.bottom + TRACK);
  }
  const xs = mergeCoordinates(xValues, xOptional, region.left + 1, region.right - 1);
  const ys = mergeCoordinates(yValues, yOptional, region.top + 1, region.bottom - 1);
  const nx = xs.length;
  const ny = ys.length;
  const inside = (x, y) => nodes.some((node) => x > node.left + EPS && x < node.right - EPS && y > node.top + EPS && y < node.bottom - EPS);

  const free = new Uint8Array(nx * ny);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) free[j * nx + i] = inside(xs[i], ys[j]) ? 0 : 1;
  // 가로 이음(i→i+1, 같은 j), 세로 이음(j→j+1, 같은 i)이 장애물 안을 지나는지 미리 계산한다.
  const hOpen = new Uint8Array(nx * ny);
  const vOpen = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      hOpen[a] = free[a] && free[a + 1] && !inside((xs[i] + xs[i + 1]) / 2, ys[j]) ? 1 : 0;
    }
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny - 1; j++) {
      const a = j * nx + i;
      vOpen[a] = free[a] && free[a + nx] && !inside(xs[i], (ys[j] + ys[j + 1]) / 2) ? 1 : 0;
    }
  }

  const usedH = new Uint8Array(nx * ny);
  const usedV = new Uint8Array(nx * ny);
  const usedPorts = new Set();

  function ports(node, role, relation, type) {
    const list = [];
    for (const side of SIDES) {
      const vertical = side === "left" || side === "right";
      const offsets = [0, -1, 1];
      for (const k of offsets) {
        let x;
        let y;
        let px;
        let py;
        if (vertical) {
          y = node.cy + k * PORT_GAP_Y;
          if (k !== 0 && (y < node.raw.top + 6 || y > node.raw.bottom - 6)) continue;
          x = side === "right" ? node.right : node.left;
          px = side === "right" ? node.raw.right : node.raw.left;
          py = y;
        } else {
          x = node.cx + k * PORT_GAP_X;
          if (k !== 0 && (x < node.raw.left + 10 || x > node.raw.right - 10)) continue;
          y = side === "bottom" ? node.bottom : node.top;
          px = x;
          py = side === "bottom" ? node.raw.bottom : node.raw.top;
        }
        const i = nearestIndex(xs, x);
        const j = nearestIndex(ys, y);
        if (i < 0 || j < 0 || !free[j * nx + i]) continue;
        const key = node.id + ":" + side + ":" + k;
        const cost = sidePenalty(side, role, relation, type) + (k !== 0 ? 4 : 0) + (usedPorts.has(key) ? 80 : 0);
        list.push({ side, k, key, index: j * nx + i, px, py, cost });
      }
    }
    return list;
  }

  function route(edge) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) return null;
    const direct = edge.type === "loop" ? null : straightVertical(source, target);
    if (direct) return direct;
    const relation = classify(source.raw, target.raw);
    const starts = ports(source, "out", relation, edge.type);
    const ends = ports(target, "in", relation, edge.type);
    if (starts.length === 0 || ends.length === 0) return null;

    const stateCount = nx * ny * 4;
    const dist = new Float64Array(stateCount).fill(Infinity);
    const prev = new Int32Array(stateCount).fill(-1);
    const heap = new MinHeap();
    const startPort = new Map();
    for (const port of starts) {
      const state = port.index * 4 + SIDE_DIR[port.side];
      if (port.cost < dist[state]) {
        dist[state] = port.cost;
        startPort.set(state, port);
        heap.push(port.cost, state);
      }
    }
    // 도착면별 목표: 격자점에 도착한 뒤 노드 안쪽으로 들어가는 방향으로 끝난다.
    const endByIndex = new Map();
    for (const port of ends) {
      const list = endByIndex.get(port.index) ?? [];
      list.push(port);
      endByIndex.set(port.index, list);
    }
    const inward = { right: 1, left: 0, bottom: 3, top: 2 };

    let best = Infinity;
    let bestState = -1;
    let bestEnd = null;
    while (heap.size > 0) {
      const state = heap.pop();
      const cost = dist[state];
      if (cost >= best) break;
      const index = (state / 4) | 0;
      const dir = state % 4;
      const endPorts = endByIndex.get(index);
      if (endPorts) {
        for (const port of endPorts) {
          const need = inward[port.side];
          const total = cost + port.cost + (dir === need ? 0 : BEND);
          if (total < best) {
            best = total;
            bestState = state;
            bestEnd = port;
          }
        }
      }
      const i = index % nx;
      const j = (index - i) / nx;
      for (let d = 0; d < 4; d++) {
        // 되돌아가기(정반대 방향)는 허용하지 않는다.
        if ((d ^ 1) === dir) continue;
        let ni = i;
        let nj = j;
        let open = 0;
        let used = 0;
        let length = 0;
        if (d === 0 && i < nx - 1) {
          ni = i + 1;
          open = hOpen[j * nx + i];
          used = usedH[j * nx + i];
          length = xs[i + 1] - xs[i];
        } else if (d === 1 && i > 0) {
          ni = i - 1;
          open = hOpen[j * nx + i - 1];
          used = usedH[j * nx + i - 1];
          length = xs[i] - xs[i - 1];
        } else if (d === 2 && j < ny - 1) {
          nj = j + 1;
          open = vOpen[j * nx + i];
          used = usedV[j * nx + i];
          length = ys[j + 1] - ys[j];
        } else if (d === 3 && j > 0) {
          nj = j - 1;
          open = vOpen[(j - 1) * nx + i];
          used = usedV[(j - 1) * nx + i];
          length = ys[j] - ys[j - 1];
        }
        if (!open) continue;
        const nextIndex = nj * nx + ni;
        const nextState = nextIndex * 4 + d;
        const step = length + (d === dir ? 0 : BEND) + (used ? length * REUSE + REUSE_FIXED : 0);
        const nextCost = cost + step;
        if (nextCost < dist[nextState]) {
          dist[nextState] = nextCost;
          prev[nextState] = state;
          heap.push(nextCost, nextState);
        }
      }
    }
    if (bestState < 0 || !bestEnd) return null;

    const chain = [];
    let state = bestState;
    while (state >= 0) {
      chain.push(state);
      state = prev[state];
    }
    chain.reverse();
    const startState = chain[0];
    const startPortInfo = startPort.get(startState);
    if (!startPortInfo) return null;

    const gridPoints = chain.map((entry) => {
      const index = (entry / 4) | 0;
      const i = index % nx;
      return [i, (index - i) / nx];
    });
    for (let step = 1; step < gridPoints.length; step++) {
      const [ai, aj] = gridPoints[step - 1];
      const [bi, bj] = gridPoints[step];
      if (aj === bj) usedH[aj * nx + Math.min(ai, bi)] = 1;
      else usedV[Math.min(aj, bj) * nx + ai] = 1;
    }
    usedPorts.add(startPortInfo.key);
    usedPorts.add(bestEnd.key);

    const endPoint = (() => {
      switch (bestEnd.side) {
        case "left":
          return [bestEnd.px - ARROW_GAP, bestEnd.py];
        case "right":
          return [bestEnd.px + ARROW_GAP, bestEnd.py];
        case "top":
          return [bestEnd.px, bestEnd.py - ARROW_GAP];
        default:
          return [bestEnd.px, bestEnd.py + ARROW_GAP];
      }
    })();
    const points = [[startPortInfo.px, startPortInfo.py], ...gridPoints.map(([i, j]) => [xs[i], ys[j]]), endPoint];
    return simplify(points);
  }

  /** 같은 칸에 위아래로 붙은 노드는 사이에 다른 노드가 없으면 짧은 세로선으로 바로 잇는다. */
  function straightVertical(source, target) {
    const left = Math.max(source.raw.left, target.raw.left);
    const right = Math.min(source.raw.right, target.raw.right);
    if (right - left < 24) return null;
    const down = target.raw.top >= source.raw.bottom - 1;
    const up = target.raw.bottom <= source.raw.top + 1;
    if (!down && !up) return null;
    const x = Math.min(Math.max(target.cx, left + 12), right - 12);
    const y1 = down ? source.raw.bottom : source.raw.top;
    const y2 = down ? target.raw.top - ARROW_GAP : target.raw.bottom + ARROW_GAP;
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    const blocked = nodes.some(
      (node) => node !== source && node !== target && x > node.raw.left - 2 && x < node.raw.right + 2 && bottom > node.raw.top - 2 && top < node.raw.bottom + 2,
    );
    if (blocked) return null;
    const i = nearestIndex(xs, x);
    if (i >= 0) {
      for (let j = 0; j < ny - 1; j++) if (ys[j] >= top - 0.5 && ys[j + 1] <= bottom + 0.5) usedV[j * nx + i] = 1;
    }
    return [
      [x, y1],
      [x, y2],
    ];
  }

  const order = [...edges].sort((a, b) => {
    const typeGap = (TYPE_ORDER[a.type] ?? 1) - (TYPE_ORDER[b.type] ?? 1);
    if (typeGap !== 0) return typeGap;
    const span = (edge) => {
      const s = byId.get(edge.source);
      const t = byId.get(edge.target);
      return s && t ? Math.abs(s.cx - t.cx) + Math.abs(s.cy - t.cy) : 0;
    };
    return span(a) - span(b);
  });

  const result = new Map();
  for (const edge of order) {
    const points = route(edge);
    if (points) result.set(edge.id, points);
  }
  return result;
}

/** 같은 직선 위의 중간점과 겹친 점을 지운다. */
export function simplify(points) {
  const out = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - point[0]) < 0.01 && Math.abs(last[1] - point[1]) < 0.01) continue;
    out.push(point);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      const collinear = (Math.abs(a[0] - b[0]) < 0.01 && Math.abs(b[0] - c[0]) < 0.01) || (Math.abs(a[1] - b[1]) < 0.01 && Math.abs(b[1] - c[1]) < 0.01);
      if (!collinear) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}
