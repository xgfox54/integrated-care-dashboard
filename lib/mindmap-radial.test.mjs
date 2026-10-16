import assert from "node:assert/strict";
import test from "node:test";
import { BRANCH_COLORS, layoutRadial, projectRadial, radialBounds, radialLabelBox, radialLabelLeaderPath, radialLinkPath, rotationToRight, RADIAL_LABEL_GAP, RADIAL_TOP_LABEL_Y, RADIAL_TOGGLE_OFFSET, RADIAL_TOGGLE_RADIUS } from "./mindmap-radial.ts";

const TOP_IDS = ["target", "service", "region", "welfare", "budget", "news"];
const SOURCE_PREFIX = { service: "svc", welfare: "w100", budget: "fiscal" };
const FAMILIES = { target: "people", service: "care", region: "care", welfare: "people", budget: "data", news: "data", advanced: "advanced" };
const visible = (node) => node.children ?? [];
const allIds = (root) => {
  const ids = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    ids.push(node.id);
    stack.push(...visible(node));
  }
  return ids;
};
const mockTree = (size = 8) => ({
  id: "root", label: "복지정보 관계성 지도", family: "root", icon: "root",
  children: [...TOP_IDS, "advanced"].map((topId) => ({
    id: topId, label: topId === "region" ? "지역별" : `${topId} 분야`, family: FAMILIES[topId], icon: topId,
    children: Array.from({ length: size }, (_, index) => ({
      id: `${SOURCE_PREFIX[topId] ?? topId}/${index}`, label: index % 2 ? "제주특별자치도" : "의료·요양 통합돌봄", family: FAMILIES[topId], icon: "item", count: index * 987654,
      ...(index === 0 ? { children: Array.from({ length: 3 }, (_, leaf) => ({
        id: `${SOURCE_PREFIX[topId] ?? topId}/${index}/${leaf}`, label: `세부 사업 ${leaf}`, family: FAMILIES[topId], icon: "item", count: leaf,
      })) } : {}),
    })),
  })),
});
const initial = () => new Set(["root", ...TOP_IDS]);
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.0011, `${a} ≠ ${b}`);

function assertLabelsClearNodes(nodes) {
  for (const item of nodes.filter(node => node.depth > 0)) {
    const local = radialLabelBox(item);
    const box = { ...local, x: item.x + local.x, y: item.y + local.y };
    const clearCircle = (x, y, r, name) => {
      const nearestX = Math.max(box.x, Math.min(x, box.x + box.width));
      const nearestY = Math.max(box.y, Math.min(y, box.y + box.height));
      assert.ok(Math.hypot(nearestX - x, nearestY - y) >= r + 4 - 1e-8, `${item.node.id} label overlaps ${name}`);
    };
    for (const node of nodes) {
      clearCircle(node.x, node.y, node.depth === 0 ? node.r + 8 : Math.max(15, node.r + 8), node.node.id);
      if (node.depth > 0 && node.node.children?.length) {
        clearCircle(node.x + (node.labelAnchor === "start" ? -1 : 1) * RADIAL_TOGGLE_OFFSET, node.y, RADIAL_TOGGLE_RADIUS + 1, node.node.id + " toggle");
      }
    }
  }
}

test("초기 보기에는 여섯 분야의 직속 항목과 접힌 고급 탐색을 원형으로 배치한다", () => {
  const root = mockTree();
  const nodes = layoutRadial(root, initial(), visible);
  assert.equal(nodes.length, 1 + 7 + TOP_IDS.length * 8);
  assert.equal(nodes[0].node, root);
  assert.equal(nodes[0].r, 64);
  assert.equal(new Set(nodes.map(({ node }) => node.id)).size, nodes.length);
  assert.equal(nodes.filter(({ depth }) => depth === 1).length, 7);
  assert.equal(nodes.some(({ node }) => node.id.startsWith("advanced/")), false);
  assert.equal(nodes.some(({ depth }) => depth > 2), false);
  assert.deepEqual(new Set(nodes.filter(({ depth }) => depth === 2).map(({ radius }) => radius)), new Set([390]));
  assert.ok(nodes.filter(({ depth }) => depth === 1).every(({ radius }) => radius >= 125 && radius <= 170));
  assert.equal(new Set(TOP_IDS.map((id) => BRANCH_COLORS[id].line)).size, 6);
});

test("원본 ID 접두사가 달라도 실제 부모 경로와 분야 색상을 상속한다", () => {
  const root = mockTree();
  const nodes = layoutRadial(root, new Set(allIds(root)), visible);
  const sourceParent = new Map();
  for (const branch of root.children) {
    for (const item of branch.children) {
      sourceParent.set(item.id, branch.id);
      for (const leaf of visible(item)) sourceParent.set(leaf.id, item.id);
    }
  }
  for (const node of nodes.filter(({ depth }) => depth >= 2)) assert.equal(node.parentId, sourceParent.get(node.node.id));
  assert.equal(nodes.find(({ node }) => node.id === "svc/0/0").topId, "service");
  assert.equal(nodes.find(({ node }) => node.id === "w100/0").topId, "welfare");
  assert.equal(nodes.find(({ node }) => node.id === "fiscal/0/0").topId, "budget");
});

test("접기와 필터는 제외된 항목의 하위 노드까지 제거하며 고아 연결을 만들지 않는다", () => {
  const root = mockTree();
  const expanded = new Set(allIds(root));
  expanded.delete("service");
  const nodes = layoutRadial(root, expanded, (node) => visible(node).filter((child) => child.id !== "region/0" && child.id !== "news"));
  const ids = new Set(nodes.map(({ node }) => node.id));
  assert.equal(nodes.some(({ node }) => node.id.startsWith("svc/")), false);
  assert.equal(nodes.some(({ node }) => node.id.startsWith("region/0")), false);
  assert.equal(nodes.some(({ topId }) => topId === "news"), false);
  assert.equal(nodes.find(({ node }) => node.id === "service").expanded, false);
  assert.ok(nodes.every(({ parentId }) => parentId === null || ids.has(parentId)));
});

test("형상 계산은 원본과 펼침 상태를 바꾸지 않고 데이터 건수를 크기로 표현하지 않는다", () => {
  const root = mockTree();
  const before = structuredClone(root);
  const expanded = initial();
  const first = layoutRadial(root, expanded, visible);
  assert.deepEqual(root, before);
  assert.deepEqual([...expanded], ["root", ...TOP_IDS]);
  assert.deepEqual(layoutRadial(root, expanded, visible), first);
  const secondRoot = structuredClone(root);
  for (const branch of secondRoot.children) for (const node of branch.children) node.count = Number.MAX_SAFE_INTEGER;
  const second = layoutRadial(secondRoot, expanded, visible);
  assert.deepEqual(first.map(({ x, y, r }) => [x, y, r]), second.map(({ x, y, r }) => [x, y, r]));
});

test("모든 글자는 수평이며 좌우 반구에 맞게 노드 바깥쪽으로 정렬된다", () => {
  const nodes = layoutRadial(mockTree(), initial(), visible).filter(({ depth }) => depth > 0);
  assert.ok(nodes.some(({ labelAnchor }) => labelAnchor === "end"));
  assert.equal(RADIAL_TOP_LABEL_Y, 0);
  for (const item of nodes) {
    assert.equal(item.labelAngle, 0);
    assert.equal(item.labelY, 0);
    assert.equal(item.labelAnchor, item.x < -1e-8 ? "end" : "start");
    const box = radialLabelBox(item);
    assert.equal(box.width, item.labelWidth + 14);
    assert.equal(box.height, 28);
    close(box.x, item.labelAnchor === "end" ? -RADIAL_LABEL_GAP - item.labelWidth - 7 : RADIAL_LABEL_GAP - 7);
  }
});

test("곡선은 정확한 자식에 닿고 루트 외곽 70px에서 시작한다", () => {
  const nodes = layoutRadial(mockTree(), initial(), visible);
  const byId = new Map(nodes.map((item) => [item.node.id, item]));
  for (const child of nodes.slice(1)) {
    const parent = byId.get(child.parentId);
    const path = radialLinkPath(parent, child);
    assert.match(path, /^M [-\d.]+ [-\d.]+ C [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+$/);
    const coordinates = path.match(/-?\d+(?:\.\d+)?/g).map(Number);
    assert.equal(coordinates.length, 8);
    assert.ok(coordinates.every(Number.isFinite));
    close(coordinates[6], child.x);
    close(coordinates[7], child.y);
    if (parent.depth === 0) close(Math.hypot(coordinates[0], coordinates[1]), 70);
    else { close(coordinates[0], parent.x); close(coordinates[1], parent.y); }
  }
});

test("자동맞춤 경계는 이동한 수평 레이블 배경과 모든 노드를 포함한다", () => {
  const nodes = projectRadial(layoutRadial(mockTree(), initial(), visible), Math.PI / 3, "service");
  const bounds = radialBounds(nodes);
  assert.ok(Object.values(bounds).every(Number.isFinite));
  const contains = (x, y) => {
    assert.ok(x >= bounds.minX - 1e-8 && x <= bounds.maxX + 1e-8, `x=${x} outside bounds`);
    assert.ok(y >= bounds.minY - 1e-8 && y <= bounds.maxY + 1e-8, `y=${y} outside bounds`);
  };
  for (const item of nodes) {
    contains(item.x - item.r, item.y - item.r);
    contains(item.x + item.r, item.y + item.r);
    const box = radialLabelBox(item);
    contains(item.x + box.x, item.y + box.y);
    contains(item.x + box.x + box.width, item.y + box.y + box.height);
  }
});

test("선택 노드는 모든 사분면과 누적 회전에서 최단 각도로 오른쪽에 정렬된다", () => {
  for (const nodeAngle of [-Math.PI, -2.7, -Math.PI / 2, -0.01, 0, 0.01, Math.PI / 2, 2.7, Math.PI]) {
    for (const current of [-21 * Math.PI, -Math.PI, -0.01, 0, 0.01, Math.PI, 21 * Math.PI]) {
      const target = rotationToRight(nodeAngle, current);
      assert.ok(Math.abs(target - current) <= Math.PI + 1e-10);
      close(Math.cos(nodeAngle + target), 1);
      close(Math.sin(nodeAngle + target), 0);
    }
  }
  // Crossing the angle boundary should turn 20 degrees, not make a full lap.
  close(rotationToRight(-10 * Math.PI / 180, 350 * Math.PI / 180), 370 * Math.PI / 180);
});

test("회전 투영은 원본 배열·관계·반지름을 보존하고 연결선도 회전된 노드에 닿는다", () => {
  const base = layoutRadial(mockTree(), initial(), visible);
  const before = structuredClone(base);
  const selectedId = "service";
  const selected = base.find(({ node }) => node.id === selectedId);
  const angle = rotationToRight(selected.angle, 2.9);
  const rotated = projectRadial(base, angle, selectedId);
  assert.deepEqual(base, before);
  assert.deepEqual(rotated.map(({ node, parentId, topId, radius, r, expanded }) => [node.id, parentId, topId, radius, r, expanded]),
    base.map(({ node, parentId, topId, radius, r, expanded }) => [node.id, parentId, topId, radius, r, expanded]));
  const focused = rotated.find(({ node }) => node.id === selectedId);
  close(focused.x, focused.radius);
  close(focused.y, 0);
  assert.equal(focused.labelY, 0);
  const byId = new Map(rotated.map((item) => [item.node.id, item]));
  for (const item of rotated) {
    assert.equal(item.labelAngle, 0);
    close(Math.hypot(item.x, item.y), item.radius);
    if (!item.parentId) continue;
    const points = radialLinkPath(byId.get(item.parentId), item).match(/-?\d+(?:\.\d+)?/g).map(Number);
    close(points[6], item.x);
    close(points[7], item.y);
  }
  assert.deepEqual(projectRadial(base, angle, selectedId), rotated);
});

test("가지가 펼쳐져 각도와 반지름이 바뀐 뒤에도 새로운 배치를 기준으로 오른쪽에 정렬된다", () => {
  const root = mockTree();
  const selectedId = "svc/0";
  const first = layoutRadial(root, initial(), visible);
  const firstItem = first.find(({ node }) => node.id === selectedId);
  const firstRotation = rotationToRight(firstItem.angle, 0);
  const expanded = new Set([...initial(), selectedId]);
  const next = layoutRadial(root, expanded, visible);
  const nextItem = next.find(({ node }) => node.id === selectedId);
  assert.notEqual(nextItem.angle, firstItem.angle);
  assert.notEqual(nextItem.radius, firstItem.radius);
  const target = rotationToRight(nextItem.angle, firstRotation);
  const focused = projectRadial(next, target, selectedId).find(({ node }) => node.id === selectedId);
  close(focused.y, 0);
  close(focused.x, focused.radius);
  assert.equal(focused.labelY, 0);
  assert.equal(focused.expanded, true);
});

test("여러 회전각에서 수평 레이블은 서로 또는 중앙 허브와 겹치지 않는다", () => {
  const base = layoutRadial(mockTree(), new Set([...initial(), "svc/0", "target/0"]), visible);
  const overlap = (a, b) => a.x < b.x + b.width - 1e-8 && a.x + a.width > b.x + 1e-8 && a.y < b.y + b.height - 1e-8 && a.y + a.height > b.y + 1e-8;
  for (const rotation of [0, 0.41, Math.PI / 2, Math.PI, -Math.PI / 2, -2.7, 10 * Math.PI + 0.6]) {
    const nodes = projectRadial(base, rotation, "service");
    const labels = nodes.filter(({ depth }) => depth > 0).map((item) => {
      const box = radialLabelBox(item);
      return { id: item.node.id, x: item.x + box.x, y: item.y + box.y, width: box.width, height: box.height };
    });
    const root = nodes[0];
    const halfWidth = Math.max(root.r + 8, radialLabelBox(root).width / 2);
    const hub = { x: -halfWidth, y: -72, width: halfWidth * 2, height: 144 };
    for (let index = 0; index < labels.length; index++) {
      assert.equal(overlap(labels[index], hub), false, `hub collision at ${rotation}: ${labels[index].id}`);
      for (const next of labels.slice(index + 1)) assert.equal(overlap(labels[index], next), false, `label collision at ${rotation}: ${labels[index].id}/${next.id}`);
    }
    // Actual x intersections avoid stacking all visible nodes into a single column.
    const bounds = radialBounds(nodes);
    assert.ok(bounds.maxY - bounds.minY < 1_200, `unnecessary vertical spread at ${rotation}`);
    assert.equal(nodes.find(({ node }) => node.id === "service").labelY, 0);
    assert.ok(nodes.some(({ labelY }) => labelY !== 0));
  }
});

test("회전·펼침·호버 상태에서도 이름표는 모든 원형 노드와 펼침 버튼을 피한다", () => {
  const root = mockTree();
  for (const expanded of [initial(), new Set([...initial(), "svc/0", "target/0"]), new Set(allIds(root))]) {
    const base = layoutRadial(root, expanded, visible);
    for (let step = 0; step < 24; step++) {
      for (const selected of [undefined, "service", "target/0"]) {
        assertLabelsClearNodes(projectRadial(base, step * Math.PI / 12, selected));
      }
    }
  }
});

test("선택한 긴 이름표는 오른쪽 정렬을 유지하면서 같은 줄의 자식 노드도 피한다", () => {
  const template = layoutRadial(mockTree(), initial(), visible).find(({ node }) => node.id === "service");
  const base = [
    { ...template, node: { ...template.node, id: "selected" }, angle: 0, radius: 152, labelWidth: 240 },
    { ...template, node: { ...template.node, id: "child", children: undefined }, angle: 0, radius: 272, depth: 2, r: 5, labelWidth: 90 },
  ];
  for (const rotation of [0, Math.PI]) {
    const nodes = projectRadial(base, rotation, "selected");
    const selected = nodes[0];
    assert.equal(selected.labelY, 0);
    assert.ok(Math.abs(selected.labelOffsetX) > 0);
    assert.equal(Math.sign(selected.labelOffsetX), selected.labelAnchor === "start" ? 1 : -1);
    assertLabelsClearNodes(nodes);
    const leader = radialLabelLeaderPath(selected);
    assert.match(leader, /^M [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+$/);
    const points = leader.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const box = radialLabelBox(selected);
    close(points[3], selected.y + selected.labelY);
    close(points[2], selected.x + (selected.labelAnchor === "start" ? box.x - 3 : box.x + box.width + 3));
    const bounds = radialBounds(nodes);
    assert.ok(selected.x + box.x >= bounds.minX && selected.x + box.x + box.width <= bounds.maxX);
  }
});

test("서로 다른 x 구간은 원래 y를 공유하고 충돌하는 배경만 가장 가까운 행으로 이동한다", () => {
  const template = layoutRadial(mockTree(), initial(), visible).find(({ node }) => node.id === "service");
  const fixture = [
    { ...template, node: { ...template.node, id: "near" }, angle: 0, radius: 152, labelWidth: 120 },
    { ...template, node: { ...template.node, id: "selected" }, angle: 0, radius: 162, labelWidth: 120 },
    { ...template, node: { ...template.node, id: "far" }, angle: 0, radius: 620, labelWidth: 120 },
  ];
  const nodes = projectRadial(fixture, 0, "selected");
  assert.deepEqual(nodes.map(({ node }) => node.id), ["near", "selected", "far"]);
  assert.equal(nodes[1].labelY, 0);
  assert.equal(nodes[2].labelY, 0);
  // Node hit/hover radius 15 + label half-height 14 + clearance 4.
  assert.equal(Math.abs(nodes[0].labelY), 33);
});

test("선택이 없거나 루트만 있는 회전도 유한한 좌표와 수평 레이블을 반환한다", () => {
  assert.deepEqual(projectRadial([], Math.PI), []);
  const base = layoutRadial(mockTree(), new Set(), visible);
  const rotated = projectRadial(base, Math.PI * 5, "root");
  assert.equal(rotated.length, 1);
  assert.deepEqual([rotated[0].x, rotated[0].y, rotated[0].labelY, rotated[0].labelAngle], [0, 0, 0, 0]);
  assert.ok(Object.values(radialBounds(rotated)).every(Number.isFinite));
  const dense = projectRadial(layoutRadial(mockTree(150), initial(), visible), -0.4);
  assert.ok(dense.length > 900);
  assert.ok(dense.every(({ x, y, labelY }) => [x, y, labelY].every(Number.isFinite)));
});

test("빈 배열·루트 한 개·큰 데이터와 깊은 연결에서도 좌표와 경계가 유한하다", () => {
  const empty = radialBounds([]);
  assert.ok(empty.minX < empty.maxX && empty.minY < empty.maxY);
  const root = mockTree();
  const single = layoutRadial(root, new Set(), visible);
  assert.equal(single.length, 1);
  assert.deepEqual([single[0].x, single[0].y, single[0].radius], [0, 0, 0]);
  assert.ok(Object.values(radialBounds(single)).every(Number.isFinite));

  const large = mockTree(150);
  const dense = layoutRadial(large, new Set(allIds(large)), visible);
  assert.ok(dense.length > 1_000);
  assert.ok(Object.values(radialBounds(dense)).every(Number.isFinite));
  for (const node of dense) assert.ok([node.x, node.y, node.radius, node.angle, node.labelWidth].every(Number.isFinite));
  assert.ok(Math.max(...dense.map(({ radius }) => radius)) > 390);

  let deep = { id: "last", label: "마지막", family: "care", icon: "item" };
  for (let index = 2_000; index >= 0; index--) deep = { id: index ? `deep/${index}` : "root", label: "깊은 연결", family: "care", icon: "item", children: [deep] };
  const deepNodes = layoutRadial(deep, new Set(allIds(deep)), visible);
  assert.equal(deepNodes.length, 2_002);
  assert.ok(Object.values(radialBounds(deepNodes)).every(Number.isFinite));
  assert.ok(deepNodes.every(({ x, y, radius }) => Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(radius)));
});

test("잘못된 중복 ID나 순환 관계는 그래프를 무한 순회하게 만들지 않는다", () => {
  const child = { id: "service", label: "서비스", family: "care", icon: "service", children: [] };
  const root = { id: "root", label: "지도", family: "root", icon: "root", children: [child, child] };
  child.children.push(root);
  const nodes = layoutRadial(root, new Set(["root", "service"]), visible);
  assert.deepEqual(nodes.map(({ node }) => node.id), ["root", "service"]);
  assert.ok(Object.values(radialBounds(nodes)).every(Number.isFinite));
});
