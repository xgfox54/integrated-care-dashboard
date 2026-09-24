// 통계청 시도 경계(southkorea-maps kostat 2018 provinces GeoJSON)를 단순화해 GPS 시도 판별용 자료로 만든다.
// 원본: https://raw.githubusercontent.com/southkorea/southkorea-maps/master/kostat/2018/json/skorea-provinces-2018-geo.json
// 2023년 7월 경상북도에서 대구광역시로 넘어간 군위군은 시군구 경계에서 가져와 대구광역시에 붙인다.
// 원본: https://raw.githubusercontent.com/southkorea/southkorea-maps/master/kostat/2018/json/skorea-municipalities-2018-geo.json
// 실행: node scripts/geo/build-sido-boundaries.mjs --input ../geo/provinces-2018.json --municipalities ../geo/municipalities-2018.json
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf("--" + name);
  return index >= 0 ? argv[index + 1] : fallback;
};
const input = path.resolve(arg("input", "../geo/provinces-2018.json"));
const municipalities = path.resolve(arg("municipalities", "../geo/municipalities-2018.json"));
const output = path.resolve(arg("output", "public/data/geo/sido-boundaries.json"));
const TOLERANCE = Number(arg("tolerance", "0.002"));
const SCALE = 1000;

// 2026년 현재 광역시·도 이름으로 맞춘다(광주·전남 통합, 강원·전북 특별자치도).
const RENAME = {
  강원도: "강원특별자치도",
  전라북도: "전북특별자치도",
  광주광역시: "전남광주통합특별시",
  전라남도: "전남광주통합특별시",
};

function perpendicular([x, y], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(x - ax, y - ay);
  return Math.abs(dy * x - dx * y + bx * ay - by * ax) / length;
}

function douglasPeucker(points, tolerance) {
  if (points.length <= 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let farthest = -1;
    let distance = 0;
    for (let index = start + 1; index < end; index++) {
      const d = perpendicular(points[index], points[start], points[end]);
      if (d > distance) {
        distance = d;
        farthest = index;
      }
    }
    if (distance > tolerance && farthest > 0) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

function encodeRing(ring) {
  // 닫힌 고리의 마지막 점(첫 점과 같음)은 빼고, 0.001도 정수로 차분 부호화한다.
  let points = ring.slice(0, -1);
  // 닫힌 고리는 두 반쪽으로 나눠 단순화해야 모양이 유지된다.
  const middle = Math.floor(points.length / 2);
  points = [...douglasPeucker(points.slice(0, middle + 1), TOLERANCE).slice(0, -1), ...douglasPeucker(points.slice(middle).concat([points[0]]), TOLERANCE).slice(0, -1)];
  let ints = points.map(([lon, lat]) => [Math.round(lon * SCALE), Math.round(lat * SCALE)]);
  ints = ints.filter((point, index) => index === 0 || point[0] !== ints[index - 1][0] || point[1] !== ints[index - 1][1]);
  if (ints.length < 3) {
    // 작은 섬은 경계 상자로 남긴다(독도 등).
    const xs = ring.map(([lon]) => lon);
    const ys = ring.map(([, lat]) => lat);
    const west = Math.floor(Math.min(...xs) * SCALE);
    const east = Math.ceil(Math.max(...xs) * SCALE);
    const south = Math.floor(Math.min(...ys) * SCALE);
    const north = Math.ceil(Math.max(...ys) * SCALE);
    ints = [[west, south], [east, south], [east, north], [west, north]];
  }
  const flat = [];
  let px = 0;
  let py = 0;
  for (const [x, y] of ints) {
    flat.push(x - px, y - py);
    px = x;
    py = y;
  }
  return flat;
}

const geo = JSON.parse(fs.readFileSync(input, "utf8"));
const bySido = new Map();
for (const feature of geo.features) {
  const name = RENAME[feature.properties.name] ?? feature.properties.name;
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const list = bySido.get(name) ?? [];
  for (const polygon of polygons) list.push(polygon.map(encodeRing));
  bySido.set(name, list);
}
// 군위군(코드 37310)은 대구광역시로 편입됐다. 경상북도 경계와 겹치지만 판별할 때 더 작은 시도를 고르므로 대구광역시로 잡힌다.
const gunwi = JSON.parse(fs.readFileSync(municipalities, "utf8")).features.find((feature) => feature.properties.code === "37310");
if (!gunwi) throw new Error("군위군 경계를 찾지 못했습니다");
const gunwiPolygons = gunwi.geometry.type === "Polygon" ? [gunwi.geometry.coordinates] : gunwi.geometry.coordinates;
bySido.get("대구광역시").push(...gunwiPolygons.map((polygon) => polygon.map(encodeRing)));
const data = {
  v: 1,
  scale: SCALE,
  source: "통계청 2018 시도 경계(southkorea-maps) 단순화, 2026년 광역시·도 이름과 군위군 대구 편입 반영",
  sido: [...bySido].map(([n, p]) => ({ n, p })),
};
fs.mkdirSync(path.dirname(output), { recursive: true });
const json = JSON.stringify(data);
fs.writeFileSync(output, json);
const points = data.sido.reduce((sum, entry) => sum + entry.p.reduce((a, polygon) => a + polygon.reduce((b, ring) => b + ring.length / 2, 0), 0), 0);
console.log(JSON.stringify({ sido: data.sido.length, points, bytes: Buffer.byteLength(json) }));
