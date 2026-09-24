// GPS 좌표가 어느 광역시·도에 속하는지 기기 안에서 판별한다(좌표를 서버로 보내지 않는다).
// 경계 자료: public/data/geo/sido-boundaries.json (scripts/geo/build-sido-boundaries.mjs로 생성)

const KOREA = { south: 32.5, north: 39.2, west: 124, east: 132.2 };

/** 0.001도 정수를 차분 부호화한 고리를 [경도, 위도] 배열로 푼다. */
function decodeRing(flat, scale) {
  const points = [];
  let x = 0;
  let y = 0;
  for (let index = 0; index < flat.length; index += 2) {
    x += flat[index];
    y += flat[index + 1];
    points.push([x / scale, y / scale]);
  }
  return points;
}

function ringArea(ring) {
  let sum = 0;
  for (let index = 0, prev = ring.length - 1; index < ring.length; prev = index++) {
    sum += (ring[prev][0] + ring[index][0]) * (ring[prev][1] - ring[index][1]);
  }
  return Math.abs(sum / 2);
}

export function decodeSidoBoundaries(data) {
  const scale = data.scale ?? 1000;
  return data.sido.map((entry) => {
    const polygons = entry.p.map((polygon) => polygon.map((ring) => decodeRing(ring, scale)));
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;
    let area = 0;
    for (const polygon of polygons) {
      area += ringArea(polygon[0]);
      for (const [lon, lat] of polygon[0]) {
        if (lon < west) west = lon;
        if (lon > east) east = lon;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      }
    }
    return { name: entry.n, polygons, bbox: { west, east, south, north }, area };
  });
}

function insideRing(lon, lat, ring) {
  let inside = false;
  for (let index = 0, prev = ring.length - 1; index < ring.length; prev = index++) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[prev];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function insidePolygon(lon, lat, polygon) {
  if (!insideRing(lon, lat, polygon[0])) return false;
  for (let index = 1; index < polygon.length; index++) if (insideRing(lon, lat, polygon[index])) return false;
  return true;
}

function distanceToRingKm(lon, lat, ring) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  const ky = 110.57;
  let best = Infinity;
  for (let index = 0, prev = ring.length - 1; index < ring.length; prev = index++) {
    const ax = (ring[prev][0] - lon) * kx;
    const ay = (ring[prev][1] - lat) * ky;
    const bx = (ring[index][0] - lon) * kx;
    const by = (ring[index][1] - lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    const t = length > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
    const px = ax + t * dx;
    const py = ay + t * dy;
    best = Math.min(best, Math.hypot(px, py));
  }
  return best;
}

/**
 * 위도·경도가 속한 광역시·도 이름을 돌려준다. 경계를 단순화해 해안선 가까이에서 벗어난 점은
 * 가장 가까운 시도(최대 maxDistanceKm)로 잡는다. 국내가 아니면 null.
 */
export function locateSido(lat, lon, regions, { maxDistanceKm = 15 } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < KOREA.south || lat > KOREA.north || lon < KOREA.west || lon > KOREA.east) return null;
  const hits = regions.filter(
    (region) =>
      lon >= region.bbox.west && lon <= region.bbox.east && lat >= region.bbox.south && lat <= region.bbox.north &&
      region.polygons.some((polygon) => insidePolygon(lon, lat, polygon)),
  );
  // 단순화로 경계가 조금 겹치면 더 작은 쪽(광역시 등)을 고른다.
  if (hits.length > 0) return hits.sort((a, b) => a.area - b.area)[0].name;
  let best = null;
  let bestDistance = Infinity;
  for (const region of regions) {
    for (const polygon of region.polygons) {
      const distance = distanceToRingKm(lon, lat, polygon[0]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = region.name;
      }
    }
  }
  return bestDistance <= maxDistanceKm ? best : null;
}

