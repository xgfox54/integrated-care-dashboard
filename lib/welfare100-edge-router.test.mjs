import assert from "node:assert/strict";
import test from "node:test";

import { routeProcessEdges } from "./welfare100/edge-router.mjs";

// 업무구조도 격자(레인 열 160px, 단계 열 235px, 레인 행 88px)에 노드 카드를 배치한다.
const LANE = 160;
const COL = 235;
const HEADER = 68;
const ROW = 88;

function layout(cells) {
  const rects = new Map();
  const byCell = new Map();
  for (const [id, col, row] of cells) {
    const key = col + ":" + row;
    byCell.set(key, [...(byCell.get(key) ?? []), id]);
  }
  let rowHeights = [];
  for (const [key, ids] of byCell) {
    const row = Number(key.split(":")[1]);
    rowHeights[row] = Math.max(rowHeights[row] ?? ROW, 16 + ids.length * 54 + (ids.length - 1) * 6);
  }
  rowHeights = Array.from({ length: Math.max(...cells.map((cell) => cell[2])) + 1 }, (_, row) => rowHeights[row] ?? ROW);
  const rowTop = (row) => HEADER + rowHeights.slice(0, row).reduce((sum, value) => sum + value, 0);
  for (const [key, ids] of byCell) {
    const [col, row] = key.split(":").map(Number);
    const height = ids.length * 54 + (ids.length - 1) * 6;
    let top = rowTop(row) + (rowHeights[row] - height) / 2;
    for (const id of ids) {
      const left = LANE + col * COL + 14;
      rects.set(id, { left, right: left + COL - 28, top, bottom: top + 54 });
      top += 60;
    }
  }
  const columns = Math.max(...cells.map((cell) => cell[1])) + 1;
  const region = { left: LANE, top: HEADER, right: LANE + columns * COL, bottom: rowTop(rowHeights.length) };
  const gutters = {
    xs: Array.from({ length: columns + 1 }, (_, col) => LANE + col * COL),
    ys: Array.from({ length: rowHeights.length + 1 }, (_, row) => rowTop(row)),
  };
  return { rects, region, gutters };
}

function crossesInterior([ax, ay], [bx, by], rect) {
  const left = Math.min(ax, bx);
  const right = Math.max(ax, bx);
  const top = Math.min(ay, by);
  const bottom = Math.max(ay, by);
  return right > rect.left + 0.5 && left < rect.right - 0.5 && bottom > rect.top + 0.5 && top < rect.bottom - 0.5;
}

function assertClearRoutes({ rects, region, gutters }, edges) {
  const paths = routeProcessEdges({ rects, edges, region, gutters });
  for (const edge of edges) {
    const points = paths.get(edge.id);
    assert.ok(points && points.length >= 2, edge.id + " 경로가 없음");
    for (let index = 1; index < points.length; index++) {
      const [a, b] = [points[index - 1], points[index]];
      assert.ok(a[0] === b[0] || a[1] === b[1], edge.id + " 직각이 아닌 구간");
      for (const [id, rect] of rects) {
        assert.ok(!crossesInterior(a, b, rect), edge.id + " 선이 " + id + " 상자를 지남: " + JSON.stringify([a, b]));
      }
      for (const [x, y] of [a, b]) {
        assert.ok(x >= region.left - 5 && x <= region.right + 5 && y >= region.top - 5 && y <= region.bottom + 5, edge.id + " 격자 밖으로 나감");
      }
    }
  }
  return paths;
}

test("되돌림 선과 정보 전달 선이 노드 상자를 가로지르지 않는다(해산·장제급여 배치)", () => {
  // 단계: 0 기준고시 1 신청·접수 2 조사 3 결정·통지 4 급여지급 5 사후관리 6 이의신청
  const board = layout([
    ["P01", 0, 0],
    ["P02", 1, 1],
    ["P10", 6, 1],
    ["P03", 1, 2],
    ["P04", 2, 3],
    ["P05", 2, 4],
    ["P06", 3, 4],
    ["P07", 3, 4],
    ["P08", 4, 4],
    ["P09", 5, 4],
    ["P11", 6, 5],
  ]);
  const edges = [
    ["P01", "P03", "message"],
    ["P02", "P03", "sequence"],
    ["P03", "P04", "sequence"],
    ["P04", "P05", "sequence"],
    ["P05", "P06", "sequence"],
    ["P06", "P07", "sequence"],
    ["P07", "P08", "sequence"],
    ["P08", "P09", "sequence"],
    ["P09", "P05", "loop"],
    ["P07", "P10", "message"],
    ["P10", "P11", "sequence"],
    ["P11", "P06", "loop"],
  ].map(([source, target, type], index) => ({ id: "E" + index, source, target, type }));
  assertClearRoutes(board, edges);
});

test("복지로 처리절차로 만든 흐름도 모든 선이 상자를 피한다", () => {
  const board = layout([
    ["P01", 0, 0],
    ["P02", 0, 1],
    ["P03", 1, 1],
    ["P04", 2, 2],
    ["P05", 3, 2],
    ["P06", 4, 1],
    ["P07", 5, 2],
  ]);
  const edges = [
    ["P01", "P02", "sequence"],
    ["P02", "P03", "sequence"],
    ["P03", "P04", "sequence"],
    ["P04", "P05", "sequence"],
    ["P05", "P06", "sequence"],
    ["P06", "P03", "loop"],
    ["P04", "P07", "message"],
    ["P07", "P04", "loop"],
  ].map(([source, target, type], index) => ({ id: "E" + index, source, target, type }));
  const paths = assertClearRoutes(board, edges);
  // 되돌림 선끼리 같은 길을 겹쳐 달리지 않는다.
  const segments = (id) => {
    const points = paths.get(id);
    return points.slice(1).map((point, index) => [points[index], point]);
  };
  const overlap = (first, second) => {
    let total = 0;
    for (const [a, b] of first) {
      for (const [c, d] of second) {
        if (a[1] === b[1] && c[1] === d[1] && a[1] === c[1]) {
          total += Math.max(0, Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) - Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])));
        }
        if (a[0] === b[0] && c[0] === d[0] && a[0] === c[0]) {
          total += Math.max(0, Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) - Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])));
        }
      }
    }
    return total;
  };
  assert.equal(overlap(segments("E5"), segments("E7")), 0);
});

test("소수점 좌표에서도 바로 옆 노드는 곧게 잇고, 같은 칸에 쌓인 노드는 세로선으로 잇는다", () => {
  // 실제 화면처럼 카드 위치에 소수점이 섞인 배치
  const shift = (rect, dx, dy) => ({ left: rect.left + dx, right: rect.right + dx, top: rect.top + dy, bottom: rect.bottom + dy });
  const board = layout([
    ["P05", 2, 1],
    ["P06", 3, 1],
    ["P07", 3, 1],
    ["P08", 4, 1],
    ["P09", 5, 1],
  ]);
  const rects = new Map([...board.rects].map(([id, rect], index) => [id, shift(rect, 0.37 + index * 0.21, 0.63 - index * 0.17)]));
  const edges = [
    ["P05", "P06", "sequence"],
    ["P06", "P07", "sequence"],
    ["P07", "P08", "sequence"],
    ["P08", "P09", "sequence"],
    ["P09", "P05", "loop"],
  ].map(([source, target, type], index) => ({ id: "E" + index, source, target, type }));
  const paths = assertClearRoutes({ ...board, rects }, edges);
  const bends = (id) => paths.get(id).length - 2;
  assert.ok(bends("E3") <= 2, "P08→P09는 옆 칸으로 곧게 가야 한다: " + JSON.stringify(paths.get("E3")));
  assert.ok(bends("E2") <= 2, "P07→P08은 옆 칸으로 곧게 가야 한다: " + JSON.stringify(paths.get("E2")));
  assert.equal(paths.get("E1").length, 2, "같은 칸의 P06→P07은 세로 직선");
  const e3 = paths.get("E3");
  assert.ok(e3[0][0] <= rects.get("P08").right + 0.5 && e3.at(-1)[0] <= rects.get("P09").left, "P08 오른쪽에서 나가 P09 왼쪽으로 들어간다");
});

