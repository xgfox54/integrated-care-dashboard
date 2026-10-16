import assert from "node:assert/strict";
import test from "node:test";
import { layoutSolar, projectSolar, rotationToRight, solarBounds, solarConnections, solarLabelBox, solarLabelLines, solarOrbits } from "./mindmap-solar.ts";
import { REGION_DEFINITIONS } from "./region-statistics.ts";

const node = (id, children = [], label = id) => ({ id, label, icon: "item", family: "care", ...(children.length ? { children } : {}) });
const tops = ["target", "service", "region", "welfare", "budget", "news", "advanced"];
const root = node("root", tops.map((top) => {
  const children = Array.from({ length: 23 }, (_, i) => {
    const grandchildren = Array.from({ length: 9 }, (_, j) => node(`${top}/${i}/${j}`, [], "지역별 맞춤형 통합돌봄 서비스의 세부 항목 " + j));
    return node(`${top}/${i}`, grandchildren);
  });
  return node(top, children);
}), "복지정보 관계성 지도");
const visible = item => item.children ?? [];

function assertClear(items) {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.clearance + b.clearance - 1e-7, `${a.node.id} overlaps ${b.node.id}`);
    }
  }
}

test("initial solar system has one centered Sun and every main planet, with moons folded", () => {
  const items = layoutSolar(root, new Set(["root"]), visible);
  assert.equal(items.length, tops.length + 1);
  assert.deepEqual(items.slice(1).map(item => item.node.id), tops);
  assert.equal(items[0].x, 0);
  assert.equal(items[0].y, 0);
  assert.ok(items.slice(1).every(item => item.depth === 1 && item.parentId === "root"));
  assert.ok(solarOrbits(items).length > 0);
  assert.ok(solarOrbits(items).every(orbit => orbit.parent.node.id === "root"));
  assertClear(items);
});

test("moons orbit their actual planet and deeper moons their own parent at every rotation", () => {
  const ids = new Set(["root", "service", "service/14"]);
  const items = layoutSolar(root, ids, visible);
  assert.ok(items.some(item => item.node.id === "service/14/7"));
  for (const rotation of [0, 0.3, Math.PI / 2, Math.PI, 5.4]) {
    const projected = projectSolar(items, rotation);
    const index = new Map(projected.map(item => [item.node.id, item]));
    for (const item of projected.filter(item => item.parentId)) {
      const parent = index.get(item.parentId);
      assert.ok(Math.abs(Math.hypot(item.x - parent.x, item.y - parent.y) - item.orbitRadius) < 1e-7);
    }
    const orbits = solarOrbits(projected);
    assert.ok(orbits.some(orbit => orbit.parent.node.id === "service"));
    assert.ok(orbits.some(orbit => orbit.parent.node.id === "service/14"));
    assertClear(projected);
  }
});

test("complete dense categories and comparison systems reserve full upright captions and controls", () => {
  for (const compact of [false, true]) {
    const expanded = new Set(["root", ...tops, "service/0", "budget/7"]);
    const items = layoutSolar(root, expanded, visible, compact);
    assertClear(items);
    for (const rotation of [0, 1.3, 2.7, 4.2, 5.8]) assertClear(projectSolar(items, rotation));
    for (const id of expanded) {
      const parent = items.find(item => item.node.id === id);
      assert.deepEqual(items.filter(item => item.parentId === id).map(item => item.node.id), parent.node.children.map(child => child.id));
    }
    for (const item of items.filter(item => item.depth > 0)) {
      const box = solarLabelBox(item);
      assert.equal(box.x + box.width / 2, 0);
      assert.ok(Math.hypot(box.width / 2, box.y + box.height) <= item.clearance);
    }
  }
});

test("compact planets keep complete major labels inside their circles without overlapping", () => {
  const labels = ["대상자별", "통합돌봄 서비스별", "지역별", "복지제도별", "복지예산별", "뉴스·자료", "고급 탐색"];
  const tree = node("root", tops.map((id, i) => node(id, [], labels[i])));
  const items = layoutSolar(tree, new Set(["root"]), item => item.children ?? [], true);
  for (const item of items.slice(1)) {
    assert.equal(item.labelInside, true);
    assert.equal(item.lines.join("").replaceAll(" ", ""), item.node.label.replaceAll(" ", ""));
    const box = solarLabelBox(item);
    assert.equal(box.x + box.width / 2, 0);
    assert.equal(box.y + box.height / 2, 0);
  }
  for (const rotation of [0, Math.PI / 2, Math.PI, 4.7]) assertClear(projectSolar(items, rotation));
});

test("all 16 regional satellites are present together on multiple orbits at either screen size", () => {
  const children = REGION_DEFINITIONS.map(region => node("region/" + region.id, [], region.fullName));
  assert.equal(children.length, 16);
  const tree = node("root", [node("region", children, "지역별")]);
  const before = JSON.stringify(tree);
  for (const compact of [false, true]) {
    const items = layoutSolar(tree, new Set(["root", "region"]), visible, compact);
    const moons = items.filter(item => item.parentId === "region");
    assert.deepEqual(moons.map(item => item.node.id), children.map(child => child.id));
    assert.equal(new Set(items.map(item => item.node.id)).size, items.length);
    assert.ok(new Set(moons.map(item => item.orbitRadius)).size > 1);
    for (const rotation of [0, Math.PI / 2, Math.PI, 4.7]) assertClear(projectSolar(items, rotation));
  }
  assert.equal(JSON.stringify(tree), before);
});

test("expanded categories beyond the former limits retain every child without changing their source", () => {
  for (const count of [7, 9, 17, 31, 73]) {
    const children = Array.from({ length: count }, (_, i) => node("service/" + i, [], "통합돌봄 세부 지원 항목 " + i));
    const tree = node("root", [node("service", children)]);
    const before = JSON.stringify(tree);
    for (const compact of [false, true]) {
      const items = layoutSolar(tree, new Set(["root", "service"]), visible, compact);
      assert.deepEqual(items.filter(item => item.parentId === "service").map(item => item.node.id), children.map(child => child.id));
      assert.equal(items.length, count + 2);
      for (const rotation of [0, 0.8, Math.PI, 5.2]) assertClear(projectSolar(items, rotation));
    }
    assert.equal(JSON.stringify(tree), before);
  }
});

test("every visible planet and moon has one correctly clipped connection to its actual parent after rotation", () => {
  for (const compact of [false, true]) {
    const items = layoutSolar(root, new Set(["root", "region", "region/22"]), visible, compact);
    for (const rotation of [0, 0.4, Math.PI / 2, Math.PI, 5.6]) {
      const projected = projectSolar(items, rotation);
      const connections = solarConnections(projected);
      assert.equal(connections.length, projected.length - 1);
      assert.equal(new Set(connections.map(edge => edge.id)).size, connections.length);
      assert.deepEqual(connections.map(edge => edge.child.node.id).sort(), projected.filter(item => item.parentId).map(item => item.node.id).sort());
      assert.equal(connections.filter(edge => edge.parent.node.id === "root").length, tops.length);
      for (const edge of connections) {
        const { parent, child, x1, y1, x2, y2 } = edge;
        assert.equal(child.parentId, parent.node.id);
        assert.notEqual(parent.node.id, child.node.id);
        assert.ok(projected.includes(parent));
        assert.ok(projected.includes(child));
        assert.ok([x1, y1, x2, y2].every(Number.isFinite));
        const distance = Math.hypot(child.x - parent.x, child.y - parent.y);
        const dx = (child.x - parent.x) / distance, dy = (child.y - parent.y) / distance;
        const start = parent.r + (parent.depth === 0 ? 13 : 3), end = child.r + 3;
        assert.ok(Math.abs(x1 - (parent.x + dx * start)) < 1e-7);
        assert.ok(Math.abs(y1 - (parent.y + dy * start)) < 1e-7);
        assert.ok(Math.abs(x2 - (child.x - dx * end)) < 1e-7);
        assert.ok(Math.abs(y2 - (child.y - dy * end)) < 1e-7);
      }
    }
  }
});

test("long Korean captions wrap to centered two-line presentation while retaining original labels", () => {
  const label = "노인 대상 맞춤형 지역사회 통합돌봄 재택의료 방문 서비스와 상세 지원 항목";
  const item = node("long", [], label);
  const lines = solarLabelLines(label);
  assert.equal(lines.length, 2);
  assert.ok(lines.every(line => line.length > 0));
  assert.ok(lines[1].endsWith("…"));
  const placed = layoutSolar(node("root", [item]), new Set(["root"]), visible)[1];
  assert.equal(placed.node.label, label);
  assert.equal(placed.node, item);
  assert.deepEqual(solarLabelLines("복지예산별"), ["복지예산별"]);
});

test("all selections align to the right via the shortest rotation and return finite fitted bounds", () => {
  const items = layoutSolar(root, new Set(["root", "welfare"]), visible);
  for (const item of items.filter(item => item.depth > 0)) {
    const current = 5.4;
    const rotation = rotationToRight(item.angle, current);
    assert.ok(Math.abs(rotation - current) <= Math.PI);
    const projected = projectSolar(items, rotation);
    const selected = projected.find(value => value.node.id === item.node.id);
    assert.ok(selected.x > 0);
    assert.ok(Math.abs(selected.y) < 1e-7);
    assert.ok(Object.values(solarBounds(projected)).every(Number.isFinite));
  }
});

test("repeated IDs and cycles cannot create duplicate planets or an infinite layout", () => {
  const first = node("a"), second = node("b");
  first.children = [second]; second.children = [first];
  const items = layoutSolar(node("root", [first, first]), new Set(["root", "a", "b"]), item => item.children ?? []);
  assert.deepEqual(items.map(item => item.node.id), ["root", "a", "b"]);
  assertClear(items);
});
