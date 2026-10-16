import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { findExplorePath, TOP_IDS } from "./mindmap-view.ts";
import { BRANCH_COLORS, layoutSolar, projectSolar, solarBounds, solarConnections, solarLabelBox, solarTogglePosition, rotationToRight, SOLAR_LABEL_FONT_SIZE, SOLAR_LABEL_LINE_HEIGHT, SOLAR_TOGGLE_RADIUS } from "./mindmap-solar.ts";
import { REGION_DEFINITIONS } from "./region-statistics.ts";

// Execute the production callbacks with a controlled frame clock. This verifies
// interaction state and animation cancellation without claiming browser coverage.
const require = createRequire(import.meta.url);
const source = ts.createSourceFile("welfare-mindmap.tsx", readFileSync(new URL("../components/mindmap/welfare-mindmap.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const definitions = new Map();
const visit = (node) => {
  if (ts.isFunctionDeclaration(node) && node.name) definitions.set(node.name.text, node.getText(source));
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    const expression = ts.isCallExpression(node.initializer) && node.initializer.expression.getText(source) === "useCallback" ? node.initializer.arguments[0] : node.initializer;
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) definitions.set(node.name.text, expression.getText(source));
  }
  ts.forEachChild(node, visit);
};
visit(source);
function bind(name, env) {
  assert.ok(definitions.has(name), `Production callback missing: ${name}`);
  const compiled = ts.transpileModule(`export default ${definitions.get(name)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const compiledModule = { exports: {} };
  new Function("env", "module", "exports", "require", `with (env) { ${compiled} }`)(env, compiledModule, compiledModule.exports, require);
  return compiledModule.exports.default;
}
const node = (id, children = [], label = id) => ({ id, label, family: "care", icon: "item", ...(children.length ? { children } : {}) });
const flatten = value => Array.isArray(value) ? value.flatMap(flatten) : value?.props ? [value, ...flatten(value.props.children)] : [];
function harness() {
  const root = node("root", [node("target", [node("target/elderly", [node("target/elderly/medical")])]), node("service", [node("svc/medical", [node("svc/visit", [node("svc/document")])]), node("svc/daily")]), node("region", [node("region/seoul")])]);
  const env = {
    root, TOP_IDS, findExplorePath, compare: false, mode: "map", selectedId: "root", hoveredId: null, sheetOpen: false,
    expanded: new Set(["root"]), pendingFocus: { current: null }, urlWrites: [], scrolls: [], compact: false, pathOnly: false, pathIds: new Set(["root"]),
    toolbarRef: { current: { getBoundingClientRect: () => ({ top: 340 }) } },
    window: { scrollY: 120, matchMedia: () => ({ matches: false }), scrollTo: options => env.scrolls.push(options) },
    setSelectedId: id => { env.selectedId = id; env.pathIds = new Set(findExplorePath(env.root, id).map(item => item.id)); }, setHoveredId: id => { env.hoveredId = id; },
    setExpanded: update => { env.expanded = update(env.expanded); }, setSheetOpen: value => { env.sheetOpen = value; },
    syncUrl: (id, push) => env.urlWrites.push({ id, push }), usageClick() {}, usageFilter() {},
  };
  env.index = bind("buildIndex", env)(root);
  for (const name of ["initialExpanded", "scrollToSearch", "focusBranch", "select", "toggle", "choose", "visible"]) env[name] = bind(name, env);
  return env;
}
function graphControl(env, id, rotation = 0) {
  const item = projectSolar(layoutSolar(env.root, env.expanded, env.visible, env.compact), rotation).find(item => item.node.id === id);
  assert.ok(item, "The requested control must be visible before the click: " + id);
  const graphEnv = { branchColor: id => BRANCH_COLORS[id] ?? BRANCH_COLORS.advanced, countText: () => "", solarLabelBox, solarTogglePosition, SOLAR_LABEL_FONT_SIZE, SOLAR_LABEL_LINE_HEIGHT, SOLAR_TOGGLE_RADIUS, ICONS: { item: null }, Sun: require("lucide-react").Sun, FONT_FAMILY: "sans-serif" };
  const element = bind("GraphNode", graphEnv)({ item, selected: false, hovered: false, dim: false, hit: false, onSelect: () => env.choose(id), onToggle: () => env.toggle(id), onHover() {} });
  return element.props.children.find(child => child?.props?.role === "treeitem").props;
}

test("실제 노드 클릭은 + 없이 한 단계 펼치고, 다시 선택해도 열린 상태를 유지한다", () => {
  const env = harness();
  env.expanded.add("service");
  const control = graphControl(env, "svc/medical");
  control.onClick({ detail: 1, timeStamp: 10 });
  assert.equal(env.selectedId, "svc/medical");
  assert.ok(env.expanded.has("svc/medical"));
  assert.equal(env.expanded.has("svc/visit"), false);
  assert.equal(env.pendingFocus.current, "svc/medical");
  assert.equal(env.sheetOpen, false);
  assert.deepEqual(env.scrolls.at(-1), { top: 452, behavior: "smooth" });
  control.onClick({ detail: 1, timeStamp: 30 });
  assert.ok(env.expanded.has("svc/medical"));
  assert.deepEqual(env.urlWrites.at(-1), { id: "svc/medical", push: true });
});

test("Enter로 선택·자동 펼침, Space로 접기와 다른 노드의 선택 갱신이 일치한다", () => {
  const env = harness();
  env.expanded.add("service");
  const event = key => ({ key, preventDefault() {}, stopPropagation() {} });
  const control = graphControl(env, "svc/medical");
  control.onKeyDown(event("Enter"));
  assert.ok(env.expanded.has("svc/medical"));
  control.onKeyDown(event(" "));
  assert.equal(env.expanded.has("svc/medical"), false);
  assert.equal(env.scrolls.length, 2);
  env.toggle("target/elderly");
  assert.equal(env.selectedId, "target/elderly");
  assert.equal(env.pendingFocus.current, env.selectedId);
  assert.deepEqual(env.urlWrites.at(-1), { id: env.selectedId, push: true });
});

test("공유 주소·뒤로 가기 선택은 조상을 복원하되 새 기록을 만들지 않고 비교 상태를 보존한다", () => {
  const env = harness();
  env.compare = true;
  env.expanded.add("target/elderly");
  env.select("svc/visit", { push: false });
  for (const id of ["root", "service", "svc/medical", "svc/visit", "target/elderly"]) assert.ok(env.expanded.has(id));
  assert.equal(env.urlWrites.length, 0);
  assert.equal(env.scrolls.length, 0);
  env.compare = false;
  env.choose("svc/medical");
  assert.equal(env.expanded.has("target/elderly"), false);
});

test("검색 도구 상단 정렬은 위로 스크롤·동작 줄이기·누락된 영역도 안전하게 처리한다", () => {
  const env = harness();
  env.window.scrollY = 900;
  env.toolbarRef.current.getBoundingClientRect = () => ({ top: -300 });
  env.window.matchMedia = () => ({ matches: true });
  env.choose("region/seoul");
  assert.deepEqual(env.scrolls.at(-1), { top: 592, behavior: "instant" });
  env.window.scrollY = 0;
  env.toolbarRef.current.getBoundingClientRect = () => ({ top: 4 });
  env.scrollToSearch();
  assert.equal(env.scrolls.at(-1).top, 0);
  env.toolbarRef.current = null;
  env.choose("svc/medical");
  assert.equal(env.scrolls.length, 2);
  assert.equal(env.selectedId, "svc/medical");
  assert.ok(env.expanded.has("svc/medical"));
});

test("회전 전후 행성·위성의 이름은 수평을 유지하고 이름표 칸의 정중앙에 놓인다", () => {
  const env = harness();
  env.expanded.add("service");
  const sides = new Set();
  for (const rotation of [0, Math.PI]) {
    const contents = flatten(graphControl(env, "svc/medical", rotation).children);
    const box = contents.find(item => item.type === "rect").props;
    const label = contents.find(item => item.type === "text").props;
    assert.equal(label.textAnchor, "middle");
    assert.equal(label.dominantBaseline, "middle");
    assert.equal(label.x, box.x + box.width / 2);
    assert.equal(label.transform, undefined);
    const rows = label.children.map(row => row.props);
    assert.ok(rows.every(row => row.x === box.x + box.width / 2));
    assert.equal(rows.reduce((sum, row) => sum + row.y, 0) / rows.length, box.y + box.height / 2);
    const item = projectSolar(layoutSolar(env.root, env.expanded, env.visible), rotation).find(item => item.node.id === "svc/medical");
    sides.add(Math.sign(item.x));
  }
  assert.equal(sides.size, 2);
});

test("실제 focusOn은 위성계의 수평 이름표 경계로 선택 노드를 오른쪽에 맞춘다", () => {
  const env = harness();
  env.choose("svc/medical");
  env.layout = layoutSolar(env.root, env.expanded, env.visible);
  env.layoutById = new Map(env.layout.map(item => [item.node.id, item]));
  env.frameRef = { current: { clientWidth: 1000, clientHeight: 740 } };
  env.viewRef = { current: { x: 0, y: 0, k: 1, rotation: 6.1 } };
  Object.assign(env, { projectSolar, solarBounds, rotationToRight, visibleArea: bind("visibleArea", env), animateTo: target => { env.target = target; } });
  bind("focusOn", env)(env.selectedId);
  const selected = projectSolar(env.layout, env.target.rotation).find(item => item.node.id === env.selectedId);
  assert.ok(Math.abs(selected.y) < 1e-8);
  assert.ok(selected.x > 0);
  assert.equal(solarLabelBox(selected).x + selected.labelWidth / 2, 0);
  assert.ok(Math.abs(env.target.rotation - env.viewRef.current.rotation) <= Math.PI);
  assert.ok(Object.values(env.target).every(Number.isFinite));
});

test("첫 화면은 태양과 행성만, 직접 선택은 해당 경로만, 태양은 전체 행성으로 복원한다", () => {
  const env = harness();
  assert.deepEqual([...env.initialExpanded()], ["root"]);
  assert.ok(layoutSolar(env.root, env.expanded, env.visible).every(item => item.depth <= 1));
  graphControl(env, "service").onClick({ detail: 1, timeStamp: 10 });
  assert.deepEqual([...env.expanded], ["root", "service"]);
  graphControl(env, "svc/medical").onClick({ detail: 1, timeStamp: 20 });
  assert.ok(env.expanded.has("svc/medical"));
  env.select("target");
  assert.deepEqual([...env.expanded], ["root", "target"]);
  env.select("root");
  assert.deepEqual([...env.expanded], ["root"]);
});

test("지역 행성 클릭은 16개 전체를 펼치며 좁은 화면에서도 마지막 지역을 바로 선택한다", () => {
  const env = harness();
  const region = env.root.children.find(item => item.id === "region");
  region.children = REGION_DEFINITIONS.map((definition, i) => node("region/" + i, [node("region/" + i + "/local")], definition.fullName));
  assert.equal(region.children.length, 16);
  env.index = bind("buildIndex", env)(env.root);
  for (const compact of [false, true]) {
    env.compact = compact;
    graphControl(env, "region").onClick({ detail: 1, timeStamp: 10 });
    assert.deepEqual(env.visible(region).map(item => item.id), region.children.map(item => item.id));
    const items = layoutSolar(env.root, env.expanded, env.visible, compact);
    assert.deepEqual(items.filter(item => item.parentId === "region").map(item => item.node.id), region.children.map(item => item.id));
    graphControl(env, "region/15").onClick({ detail: 1, timeStamp: 20 });
    assert.equal(env.selectedId, "region/15");
    assert.ok(env.expanded.has("region/15"));
    assert.equal(env.visible(region).length, 16);
    assert.ok(layoutSolar(env.root, env.expanded, env.visible, compact).some(item => item.node.id === "region/15/local"));
  }
});

test("검색·공유 주소로 뒤쪽 항목을 선택해도 같은 부모의 전체 하위 항목이 유지된다", () => {
  const env = harness();
  const service = env.root.children[1];
  service.children.push(...Array.from({ length: 16 }, (_, i) => node("svc/extra-" + i)));
  env.index = bind("buildIndex", env)(env.root);
  env.select("svc/extra-13", { push: false });
  const expected = service.children.map(item => item.id);
  for (const compact of [false, true]) {
    env.compact = compact;
    assert.deepEqual(env.visible(service).map(item => item.id), expected);
    assert.deepEqual(layoutSolar(env.root, env.expanded, env.visible, compact).filter(item => item.parentId === "service").map(item => item.node.id), expected);
  }
  assert.equal(env.selectedId, "svc/extra-13");
  assert.ok(env.expanded.has("service"));
  assert.equal(env.scrolls.length, 0);
  assert.equal(env.urlWrites.length, 0);
});

test("하위 항목 제한은 없고 선택 경로만 보기는 명시적으로 켰을 때만 형제를 가린다", () => {
  const env = harness();
  env.select("svc/visit");
  const service = env.root.children.find(item => item.id === "service");
  assert.equal(env.visible(env.root).length, env.root.children.length);
  assert.deepEqual(env.visible(service).map(item => item.id), ["svc/medical", "svc/daily"]);
  env.pathOnly = true;
  assert.deepEqual(env.visible(env.root).map(item => item.id), ["service"]);
  assert.deepEqual(env.visible(service).map(item => item.id), ["svc/medical"]);
  env.pathOnly = false;
  assert.deepEqual(env.visible(service).map(item => item.id), ["svc/medical", "svc/daily"]);
});

test("실제 연결선 계층은 태양·행성·위성의 모든 부모 관계를 선택 강조와 회전에도 유지한다", () => {
  const env = harness();
  const region = env.root.children.find(item => item.id === "region");
  region.children = Array.from({ length: 16 }, (_, i) => node("region/" + i));
  env.index = bind("buildIndex", env)(env.root);
  const connectionEnv = { solarConnections, branchColor: id => BRANCH_COLORS[id] ?? BRANCH_COLORS.advanced };
  const render = bind("ConnectionLayer", connectionEnv);
  for (const expanded of [new Set(["root"]), new Set(["root", "region"])]) {
    for (const rotation of [0, Math.PI / 2, 4.3]) {
      const items = projectSolar(layoutSolar(env.root, expanded, env.visible), rotation);
      const expected = solarConnections(items);
      for (const highlightedPath of [new Set(), new Set(["root"]), new Set(["root", "region", "region/15"])]) {
        const lines = flatten(render({ items, highlightedPath })).filter(element => element.type === "line").map(element => element.props);
        assert.equal(lines.length, items.length - 1);
        assert.equal(new Set(lines.map(line => line["data-child"])).size, lines.length);
        for (const edge of expected) {
          const line = lines.find(line => line["data-child"] === edge.child.node.id);
          assert.ok(line);
          assert.equal(line["data-relation"], "parent-child");
          assert.equal(line["data-parent"], edge.parent.node.id);
          for (const coordinate of ["x1", "y1", "x2", "y2"]) assert.equal(line[coordinate], edge[coordinate]);
          assert.ok(line.stroke && line.stroke !== "none" && line.stroke !== "transparent");
          assert.ok(line.strokeWidth > 0);
          assert.ok(line.strokeOpacity === undefined || line.strokeOpacity > 0);
        }
        assert.equal(lines.filter(line => line["data-parent"] === "root").length, env.root.children.length);
        if (expanded.has("region")) assert.equal(lines.filter(line => line["data-parent"] === "region").length, 16);
      }
    }
  }
});

test("많은 위성을 선택해도 글자 배율을 유지하며 선택한 노드가 화면 안에 남는다", () => {
  for (const compact of [false, true]) {
    const env = harness();
    env.compact = compact;
    const service = env.root.children.find(item => item.id === "service");
    service.children = Array.from({ length: 73 }, (_, i) => node("service/" + i, [], "통합돌봄 세부 지원 항목 " + i));
    env.index = bind("buildIndex", env)(env.root);
    env.select("service");
    env.layout = layoutSolar(env.root, env.expanded, env.visible, compact);
    env.layoutById = new Map(env.layout.map(item => [item.node.id, item]));
    const width = compact ? 390 : 1000, height = compact ? 540 : 740;
    env.frameRef = { current: { clientWidth: width, clientHeight: height } };
    env.viewRef = { current: { x: 0, y: 0, k: 1, rotation: 0.7 } };
    Object.assign(env, { projectSolar, solarBounds, rotationToRight, visibleArea: bind("visibleArea", env), animateTo: target => { env.target = target; } });
    bind("focusOn", env)(env.selectedId);
    assert.ok(env.target.k >= (compact ? 0.82 : 0.72));
    assert.ok(Object.values(env.target).every(Number.isFinite));
    const selected = projectSolar(env.layout, env.target.rotation).find(item => item.node.id === env.selectedId);
    const bounds = solarBounds([selected]);
    assert.ok(bounds.minX * env.target.k + env.target.x >= 0);
    assert.ok(bounds.maxX * env.target.k + env.target.x <= width);
    assert.ok(bounds.minY * env.target.k + env.target.y >= 0);
    assert.ok(bounds.maxY * env.target.k + env.target.y <= height);
  }
});

test("1040×740 기본 지역 초점은 읽기 배율에서 16개 지역의 원과 이름표를 모두 화면에 보존한다", () => {
  const env = harness();
  const region = env.root.children.find(item => item.id === "region");
  region.children = REGION_DEFINITIONS.map(definition => node("region/" + definition.id, [], definition.fullName));
  env.index = bind("buildIndex", env)(env.root);
  env.select("region");
  env.layout = layoutSolar(env.root, env.expanded, env.visible);
  env.layoutById = new Map(env.layout.map(item => [item.node.id, item]));
  const width = 1040, height = 740;
  env.frameRef = { current: { clientWidth: width, clientHeight: height } };
  env.viewRef = { current: { x: 0, y: 0, k: 1, rotation: 0.7 } };
  Object.assign(env, { projectSolar, solarBounds, rotationToRight, visibleArea: bind("visibleArea", env), animateTo: target => { env.target = target; } });
  bind("focusOn", env)("region");
  assert.ok(env.target.k >= 0.72);
  const projected = projectSolar(env.layout, env.target.rotation);
  const children = projected.filter(item => item.parentId === "region");
  assert.equal(children.length, 16);
  assert.deepEqual(children.map(item => item.node.id), region.children.map(item => item.id));
  for (const item of children) {
    const bounds = solarBounds([item]);
    assert.ok(bounds.minX * env.target.k + env.target.x >= -1e-7, item.node.label + " left edge clipped");
    assert.ok(bounds.maxX * env.target.k + env.target.x <= width + 1e-7, item.node.label + " right edge clipped");
    assert.ok(bounds.minY * env.target.k + env.target.y >= -1e-7, item.node.label + " top edge clipped");
    assert.ok(bounds.maxY * env.target.k + env.target.y <= height + 1e-7, item.node.label + " bottom caption clipped");
  }
});

test("위성 전체 맞춤은 화면 크기와 관계없이 16개·73개 전체의 원과 이름표를 포함하고 오른쪽 정렬을 유지한다", () => {
  for (const count of [16, 73]) {
    for (const compact of [false, true]) {
      const env = harness();
      env.compact = compact;
      const parentId = count === 16 ? "region" : "service";
      const parent = env.root.children.find(item => item.id === parentId);
      parent.children = count === 16
        ? REGION_DEFINITIONS.map(definition => node("region/" + definition.id, [], definition.fullName))
        : Array.from({ length: count }, (_, i) => node("service/" + i, [], "통합돌봄 세부 지원 항목 " + i));
      env.index = bind("buildIndex", env)(env.root);
      env.select(parentId);
      env.layout = layoutSolar(env.root, env.expanded, env.visible, compact);
      env.layoutById = new Map(env.layout.map(item => [item.node.id, item]));
      const width = compact ? 390 : 1040, height = compact ? 540 : 740;
      env.frameRef = { current: { clientWidth: width, clientHeight: height } };
      env.viewRef = { current: { x: 0, y: 0, k: 1, rotation: 0.7 } };
      Object.assign(env, { projectSolar, solarBounds, rotationToRight, visibleArea: bind("visibleArea", env), animateTo: target => { env.target = target; } });
      bind("focusOn", env)(parentId, true);
      const projected = projectSolar(env.layout, env.target.rotation);
      const selected = projected.find(item => item.node.id === parentId);
      const children = projected.filter(item => item.parentId === parentId);
      assert.equal(children.length, count);
      assert.deepEqual(children.map(item => item.node.id), parent.children.map(item => item.id));
      assert.ok(selected.x > 0);
      assert.ok(Math.abs(selected.y) < 1e-7);
      assert.ok(Object.values(env.target).every(Number.isFinite));
      for (const item of [selected, ...children]) {
        const bounds = solarBounds([item]);
        assert.ok(bounds.minX * env.target.k + env.target.x >= 24 - 1e-7, item.node.label + " left bound");
        assert.ok(bounds.maxX * env.target.k + env.target.x <= width - 24 + 1e-7, item.node.label + " right bound");
        assert.ok(bounds.minY * env.target.k + env.target.y >= 60 - 1e-7, item.node.label + " top bound");
        assert.ok(bounds.maxY * env.target.k + env.target.y <= height - 60 + 1e-7, item.node.label + " bottom caption");
      }
    }
  }
});

test("화면 맞춤은 태양을 지도 정중앙에 놓고 전체 이름표를 화면 안에 맞춘다", () => {
  const env = harness();
  env.layout = layoutSolar(env.root, env.expanded, env.visible);
  env.layoutById = new Map(env.layout.map(item => [item.node.id, item]));
  env.frameRef = { current: { clientWidth: 900, clientHeight: 740 } };
  env.viewRef = { current: { x: 0, y: 0, k: 1, rotation: 0.9 } };
  Object.assign(env, { projectSolar, solarBounds, rotationToRight, visibleArea: bind("visibleArea", env), stopAnimation() {}, setView: target => { env.target = target; } });
  bind("fit", env)();
  assert.equal(env.target.x, 450);
  assert.equal(env.target.y, 370);
  const bounds = solarBounds(projectSolar(env.layout, env.target.rotation));
  assert.ok(bounds.minX * env.target.k + env.target.x >= 24);
  assert.ok(bounds.maxX * env.target.k + env.target.x <= 876);
  assert.ok(bounds.minY * env.target.k + env.target.y >= 50);
  assert.ok(bounds.maxY * env.target.k + env.target.y <= 690);
});

test("모바일 첫 배치로 바뀔 때 태양 보기의 기존 배율도 다시 맞춘다", () => {
  const env = harness();
  const desktop = layoutSolar(env.root, env.expanded, env.visible);
  env.previousLayout = { current: desktop };
  env.layout = layoutSolar(env.root, env.expanded, env.visible, true);
  env.layoutById = new Map(env.layout.map(item => [item.node.id, item]));
  env.fitPending = { current: false };
  env.focuses = [];
  env.focusOn = id => env.focuses.push(id);
  bind("syncLayoutView", env)();
  assert.deepEqual(env.focuses, ["root"]);
  assert.equal(env.previousLayout.current, env.layout);
  bind("syncLayoutView", env)();
  assert.deepEqual(env.focuses, ["root"]);
});

function animationHarness(reduced = false) {
  const frames = new Map(); let nextId = 1; let now = 0;
  const env = {
    frameRef: { current: { clientWidth: 1000, clientHeight: 740 } },
    viewRef: { current: { x: 0, y: 0, k: 1, rotation: 0 } }, animationRef: { current: null },
    window: { matchMedia: () => ({ matches: reduced }) }, performance: { now: () => now },
    requestAnimationFrame: callback => { const id = nextId++; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id), setView: view => { env.view = typeof view === "function" ? view(env.viewRef.current) : view; },
  };
  env.stopAnimation = bind("stopAnimation", env);
  env.animateTo = bind("animateTo", env);
  env.tick = value => { now = value; const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(now); };
  env.frames = frames;
  return env;
}

test("연속 선택은 진행 중 회전에서 새 목표로 이어지고 취소된 프레임이 덮어쓰지 않는다", () => {
  const env = animationHarness();
  env.animateTo({ x: 100, y: 80, k: 1.2, rotation: 1.4 });
  env.tick(160);
  assert.ok(env.view.rotation > 0 && env.view.rotation < 1.4);
  const target = { x: 210, y: 60, k: 0.8, rotation: -0.6 };
  env.animateTo(target);
  assert.equal(env.frames.size, 1);
  env.tick(640);
  for (const key of Object.keys(target)) assert.ok(Math.abs(env.view[key] - target[key]) < 1e-8);
  assert.equal(env.frames.size, 0);
  env.animateTo({ ...target, rotation: 2 });
  env.stopAnimation();
  assert.equal(env.frames.size, 0);
  env.tick(1000);
  assert.equal(env.view.rotation, target.rotation);
});

test("동작 줄이기는 회전·이동·확대를 즉시 완료하며 확대 버튼은 회전 상태를 보존한다", () => {
  const env = animationHarness(true);
  const target = { x: 120, y: 200, k: 1.3, rotation: 0.9 };
  env.animateTo(target);
  assert.deepEqual(env.view, target);
  assert.deepEqual(env.viewRef.current, target);
  assert.equal(env.frames.size, 0);
  env.visibleArea = bind("visibleArea", env);
  env.rotationToRight = rotationToRight;
  env.selectedId = "service";
  env.layoutById = new Map([["service", { angle: -target.rotation }]]);
  env.interruptMotion = bind("interruptMotion", env);
  bind("zoom", env)(1.2);
  assert.ok(Math.abs(env.view.rotation - target.rotation) < 1e-8);
  assert.ok(env.view.k > target.k);
});

test("회전 도중 팬·줌으로 중단해도 선택 노드는 중간 각도에 남지 않는다", () => {
  const env = animationHarness();
  Object.assign(env, { rotationToRight, selectedId: "service", layoutById: new Map([["service", { angle: -Math.PI / 2 }]]) });
  env.animateTo({ x: 100, y: 80, k: 1.2, rotation: Math.PI / 2 });
  env.tick(120);
  assert.ok(env.view.rotation > 0 && env.view.rotation < Math.PI / 2);
  const previous = env.view;
  bind("interruptMotion", env)();
  assert.ok(Math.abs(env.view.rotation - Math.PI / 2) < 1e-8);
  for (const key of ["x", "y", "k"]) assert.equal(env.view[key], previous[key]);
  assert.equal(env.frames.size, 0);
});
