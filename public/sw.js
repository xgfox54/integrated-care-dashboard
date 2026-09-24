// 정적 파일 보관용 서비스 워커.
// 이 사이트의 호스팅은 정적 파일에 긴 보관 기간(Cache-Control)을 붙이지 않아, 다시 방문할
// 때마다 모든 스크립트·스타일·자료 파일을 서버에 확인했다. 이름에 내용 지문이 들어간 파일
// (/_next/static/*)과 주소에 ?v=지문을 붙인 자료(/data/*?v=)는 내용이 바뀌면 주소가 바뀌므로,
// 한 번 받은 파일을 브라우저에 두고 서버 확인 없이 바로 쓴다.
// 화면(HTML)·API 요청은 건드리지 않으며, 미리 받아 두는 파일도 없다(데이터 절약).

const STATIC_CACHE = "site-static-v1";
const DATA_CACHE = "site-data-v1";
const STORED_AT = "x-sw-stored-at";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, DATA_CACHE]);
      for (const name of await caches.keys()) {
        if (!keep.has(name)) await caches.delete(name);
      }
      await pruneOld(STATIC_CACHE);
      await pruneOld(DATA_CACHE);
      await self.clients.claim();
    })(),
  );
});

function cacheNameFor(url) {
  if (url.origin !== self.location.origin) return null;
  if (url.pathname.startsWith("/_next/static/")) return STATIC_CACHE;
  if (url.pathname.startsWith("/data/") && url.searchParams.has("v")) return DATA_CACHE;
  return null;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);
  const name = cacheNameFor(url);
  if (!name) return;
  event.respondWith(cacheFirst(event, request, url, name));
});

async function cacheFirst(event, request, url, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(url.href);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.status === 200 && response.type === "basic") {
    const copy = response.clone();
    event.waitUntil(store(cache, name, url, copy).catch(() => undefined));
  }
  return response;
}

async function store(cache, name, url, response) {
  const headers = new Headers(response.headers);
  headers.set(STORED_AT, String(Date.now()));
  const body = await response.blob();
  if (name === DATA_CACHE) {
    // 같은 자료의 예전 판(다른 ?v=)은 지운다.
    for (const key of await cache.keys()) {
      const old = new URL(key.url);
      if (old.pathname === url.pathname && old.search !== url.search) await cache.delete(key);
    }
  }
  await cache.put(url.href, new Response(body, { status: 200, statusText: response.statusText, headers }));
}

async function pruneOld(name) {
  const cache = await caches.open(name);
  const now = Date.now();
  for (const key of await cache.keys()) {
    const response = await cache.match(key);
    const storedAt = Number(response?.headers.get(STORED_AT) ?? 0);
    if (!storedAt || now - storedAt > MAX_AGE_MS) await cache.delete(key);
  }
}
