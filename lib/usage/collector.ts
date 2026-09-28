// 이용통계 수집기. 관리자가 수집을 켰고 이 브라우저가 제외 대상(통계에서 빼기 선택, 추적 거부 신호, 자동화 도구)이 아닐 때만 불러온다.
// - 이벤트는 메모리 큐에 모아 15초마다, 또는 20건이 차면 묶어서 보낸다. 화면이 숨겨질 때는 keepalive 요청으로 남은 값을 보낸다.
// - 요청의 Referer는 도메인까지만 보낸다(페이지 주소에 든 검색어가 호스팅 접근기록에 남지 않게). 그래서 sendBeacon은
//   keepalive 요청을 쓸 수 없을 때만 쓴다(sendBeacon은 Referer 정책을 따로 정할 수 없다).
// - 실패하면 이 화면이 열려 있는 동안 두 번까지만 다시 보낸다. localStorage·IndexedDB에 이벤트를 남기지 않는다.
// - 수집 실패를 다시 수집 API로 보고하지 않는다. 어떤 오류도 화면 기능으로 번지지 않게 한다.
import { ActivityClock } from "./activity";
import {
  FLUSH_INTERVAL_MS,
  MAX_EVENTS_PER_REQUEST,
  MAX_MEASURE_MS,
  MAX_REQUEST_BYTES,
  USAGE_POLICY_VERSION,
  USAGE_SCHEMA_VERSION,
  type EntityKind,
  type LinkDestination,
  type TabCode,
} from "./codes";
import { forgetUsageConfig } from "./preference";
import { attachUsageSink, detachUsageSink, newUsageId, usageVital, type UsageEventBody, type UsageSink } from "./track";

const ENDPOINT = "/api/usage/collect";
const QUEUE_LIMIT = 100;
const MAX_TRIES = 3;
const ENVELOPE_BYTES = 64;

interface Queued {
  readonly event: UsageEventBody;
  readonly bytes: number;
  tries: number;
}

interface Measure {
  readonly id: string;
  readonly body: { tab: TabCode } | { kind: EntityKind; key: string };
  total: number;
  sent: number;
}

type LayoutShiftEntry = PerformanceEntry & { value: number; hadRecentInput: boolean };

function destination(hostname: string): LinkDestination {
  const host = hostname.toLowerCase();
  const within = (domain: string) => host === domain || host.endsWith("." + domain);
  if (within("mohw.go.kr")) return "mohw";
  if (within("bokjiro.go.kr")) return "bokjiro";
  if (within("law.go.kr")) return "law";
  if (within("data.go.kr")) return "data_portal";
  if (host.endsWith(".go.kr") || host.endsWith(".or.kr")) return "gov";
  return "other";
}

let running: (() => void) | null = null;

/** 수집을 시작하고, 멈추는 함수를 돌려준다. 이미 돌고 있으면 그 함수를 돌려준다. */
export function startUsageCollector(): () => void {
  if (running) return running;
  let stopped = false;
  let queue: Queued[] = [];
  let composing = false;
  const measures = new Map<string, Measure>();
  const cleanups: (() => void)[] = [];
  const now = () => performance.now();

  const enqueue = (event: UsageEventBody) => {
    if (stopped) return;
    queue.push({ event, bytes: JSON.stringify(event).length + 1, tries: 0 });
    if (queue.length > QUEUE_LIMIT) queue = queue.slice(queue.length - QUEUE_LIMIT);
  };

  let clock: ActivityClock | null = null;
  const accrue = () => {
    if (!clock) return;
    const delta = clock.accrue(now());
    if (delta > 0) for (const measure of measures.values()) measure.total += delta;
  };
  const add = (delta: number) => {
    if (delta > 0) for (const measure of measures.values()) measure.total += delta;
  };

  const queueActivity = (measure: Measure) => {
    const ms = Math.min(MAX_MEASURE_MS, Math.floor(measure.total));
    if (ms <= measure.sent) return;
    // 같은 측정의 보내지 않은 누적값은 최신 값 하나만 남긴다.
    queue = queue.filter((item) => item.event.measure !== measure.id);
    enqueue({ type: "activity", id: newUsageId(), measure: measure.id, ...measure.body, ms });
    measure.sent = ms;
  };
  const queueAllActivity = () => {
    accrue();
    for (const measure of measures.values()) queueActivity(measure);
  };
  const openSlot = (slot: string, body: Measure["body"]) => {
    measures.set(slot, { id: newUsageId(), body, total: 0, sent: 0 });
  };
  const closeSlot = (slot: string) => {
    const measure = measures.get(slot);
    if (!measure) return;
    queueActivity(measure);
    measures.delete(slot);
  };

  const takeBatch = (): Queued[] => {
    const batch: Queued[] = [];
    let bytes = ENVELOPE_BYTES;
    while (queue.length > 0 && batch.length < MAX_EVENTS_PER_REQUEST && bytes + queue[0].bytes <= MAX_REQUEST_BYTES) {
      const item = queue.shift()!;
      bytes += item.bytes;
      batch.push(item);
    }
    return batch;
  };
  const requeue = (batch: Queued[]) => {
    if (stopped) return;
    const retry = batch.filter((item) => item.tries + 1 < MAX_TRIES).map((item) => ({ ...item, tries: item.tries + 1 }));
    queue = [...retry, ...queue].slice(-QUEUE_LIMIT);
  };
  const beacon = (body: string) => {
    // keepalive 요청을 쓸 수 없을 때만. true는 '전송 대기열에 올림'일 뿐 저장 완료가 아니다.
    // 서버는 같은 이벤트를 두 번 받아도 한 번만 반영한다.
    try {
      if (typeof navigator.sendBeacon === "function") navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain;charset=UTF-8" }));
    } catch {
      // 보내지 못한 값은 버린다(서비스 이용에는 영향 없음).
    }
  };
  const post = (body: string, batch: Queued[], keepalive: boolean) => {
    fetch(ENDPOINT, {
      method: "POST",
      body,
      keepalive,
      cache: "no-store",
      credentials: "same-origin",
      referrerPolicy: "origin",
      headers: { "content-type": "text/plain;charset=UTF-8" },
    })
      .then(async (response) => {
        if (response.status === 429 || response.status >= 500) {
          requeue(batch);
          return;
        }
        if (!response.ok) return;
        const payload = (await response.json().catch(() => null)) as { collecting?: boolean } | null;
        if (payload?.collecting === false) {
          // 관리자가 수집을 멈췄다. 이 화면의 수집을 멈추고, 다음 화면에서 설정을 다시 확인한다.
          forgetUsageConfig();
          stop();
        }
      })
      .catch(() => {
        if (keepalive) beacon(body);
        else requeue(batch);
      });
  };
  const flush = (unloading: boolean) => {
    if (stopped) return;
    while (queue.length > 0) {
      const batch = takeBatch();
      if (batch.length === 0) {
        queue.shift();
        continue;
      }
      const body = JSON.stringify({ v: USAGE_SCHEMA_VERSION, p: USAGE_POLICY_VERSION, events: batch.map((item) => item.event) });
      try {
        post(body, batch, unloading);
      } catch {
        if (unloading) beacon(body);
      }
    }
  };

  const sink: UsageSink = {
    send(event) {
      enqueue(event);
      if (queue.length >= MAX_EVENTS_PER_REQUEST) flush(false);
    },
    setTab(tab) {
      accrue();
      closeSlot("tab");
      openSlot("tab", { tab });
    },
    openEntity(viewId, kind, key) {
      accrue();
      if (!measures.has("e:" + viewId)) openSlot("e:" + viewId, { kind, key });
    },
    closeEntity(viewId) {
      accrue();
      closeSlot("e:" + viewId);
    },
    isComposing: () => composing,
  };

  const { context, backlog } = attachUsageSink(sink);
  // 화면을 연 때부터 수집 대상이었으면 그때부터, 화면 도중 다시 포함했으면 지금부터 잰다.
  clock = new ActivityClock(context.measuredSince ?? now(), document.visibilityState === "visible");
  if (context.tab) openSlot("tab", { tab: context.tab });
  for (const [viewId, entity] of context.entities) openSlot("e:" + viewId, entity);
  for (const event of backlog) enqueue(event);

  const listen = (target: EventTarget, type: string, handler: EventListener, options?: AddEventListenerOptions) => {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };
  const interact = () => {
    if (clock) add(clock.interact(now()));
  };
  for (const type of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"]) {
    listen(document, type, interact, { passive: true, capture: true });
  }
  listen(document, "compositionstart", () => (composing = true), { capture: true });
  listen(document, "compositionend", () => (composing = false), { capture: true });

  // 성능 지표: 화면을 연 때부터 수집 대상이었을 때만 잰다(제외 중이던 화면의 값을 나중에 보내지 않는다).
  let vitalsReported = false;
  let lcp = 0;
  let cls = 0;
  let clsSupported = false;
  const observers: PerformanceObserver[] = [];
  if (context.measuredSince !== null && typeof PerformanceObserver === "function") {
    try {
      const observer = new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1);
        if (last) lcp = last.startTime;
      });
      observer.observe({ type: "largest-contentful-paint", buffered: true });
      observers.push(observer);
    } catch {
      // 지원하지 않는 브라우저
    }
    try {
      let sessionValue = 0;
      let sessionStart = 0;
      let sessionLast = 0;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as LayoutShiftEntry[]) {
          if (entry.hadRecentInput) continue;
          if (sessionValue > 0 && (entry.startTime - sessionLast > 1000 || entry.startTime - sessionStart > 5000)) sessionValue = 0;
          if (sessionValue === 0) sessionStart = entry.startTime;
          sessionValue += entry.value;
          sessionLast = entry.startTime;
          cls = Math.max(cls, sessionValue);
        }
      });
      observer.observe({ type: "layout-shift", buffered: true });
      observers.push(observer);
      clsSupported = true;
    } catch {
      clsSupported = false;
    }
  }
  const reportVitals = () => {
    if (vitalsReported || context.measuredSince === null) return;
    vitalsReported = true;
    if (lcp > 0) usageVital("lcp", lcp);
    if (clsSupported) usageVital("cls", cls);
  };

  listen(document, "visibilitychange", () => {
    const hidden = document.visibilityState === "hidden";
    if (clock) add(clock.setVisible(now(), !hidden));
    if (hidden) {
      reportVitals();
      queueAllActivity();
      flush(true);
    }
  });
  listen(window, "pagehide", () => {
    reportVitals();
    queueAllActivity();
    flush(true);
  });

  // 출처 링크: 다른 사이트로 가는 링크 클릭만 센다(주소는 보내지 않고 기관 구분 코드만 보낸다).
  const onLink = (event: Event) => {
    const mouse = event as MouseEvent;
    if (mouse.type === "auxclick" && mouse.button !== 1) return;
    const anchor = (mouse.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    let url: URL;
    try {
      url = new URL(anchor.href, window.location.href);
    } catch {
      return;
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.hostname === window.location.hostname) return;
    enqueue({ type: "action", id: newUsageId(), action: "source_link", outcome: "click", dest: destination(url.hostname) });
  };
  listen(document, "click", onLink, { capture: true });
  listen(document, "auxclick", onLink, { capture: true });

  const timer = window.setInterval(() => {
    queueAllActivity();
    flush(false);
  }, FLUSH_INTERVAL_MS);

  function stop() {
    if (stopped) return;
    stopped = true;
    window.clearInterval(timer);
    for (const cleanup of cleanups.splice(0)) cleanup();
    for (const observer of observers) observer.disconnect();
    queue = [];
    measures.clear();
    detachUsageSink("off");
    running = null;
  }
  running = stop;
  return stop;
}

/** 통계에서 빼기를 골랐거나 수집이 꺼졌을 때. 보내지 않은 큐와 임시 연결값을 지운다. */
export function stopUsageCollector(): void {
  running?.();
}
