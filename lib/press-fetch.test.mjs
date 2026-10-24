import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { runInNewContext } from "node:vm";
import { timedPressFetcher } from "./press/fetch.ts";

test("실제 HTTP 서버의 끝나지 않은 오류 본문도 discard 호출로 연결이 닫힌다", { timeout: 5000 }, async (t) => {
  let finishResponse;
  const closed = new Promise((resolve) => { finishResponse = resolve; });
  const server = createServer((_request, response) => {
    response.once("close", finishResponse);
    response.writeHead(503);
    response.write("pending");
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await timedPressFetcher(7000)(`http://127.0.0.1:${address.port}/feed`, {});

  response.discard();

  await closed;
  assert.equal(response.status, 503);
});

test("사용하지 않을 오류 응답을 버리면 연결과 제한 타이머를 즉시 정리한다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream(), { status: 503 });
  });
  const response = await timedPressFetcher(7000)("https://www.mohw.go.kr/rss/", {});

  response.discard();

  assert.equal(signal.aborted, true);
  assert.equal(response.status, 503);
  t.mock.timers.tick(7000);
  assert.equal(signal.reason.name, "AbortError");
});

test("헤더 뒤 본문 수신이 멈춰도 전체 요청 제한 시간이 지나면 취소한다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream());
  });
  const outcome = timedPressFetcher(1000)("https://www.mohw.go.kr/rss/", {})
    .then(async (response) => { await response.text(); return "received"; })
    .catch((error) => error.name);
  await new Promise((resolve) => setImmediate(resolve));

  t.mock.timers.tick(1000);

  assert.equal(signal.aborted, true);
  assert.equal(await outcome, "TimeoutError");
});

test("정상 본문과 상태·헤더를 유지하고 본문 완료 뒤 취소 타이머를 해제한다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    signal = options.signal;
    assert.equal(options.redirect, "manual");
    return new Response("<rss>정상</rss>", { headers: { etag: '"v1"' } });
  });
  const response = await timedPressFetcher(3000)("https://www.mohw.go.kr/rss/", {});

  const body = await response.text();
  t.mock.timers.tick(3000);

  assert.equal(body, "<rss>정상</rss>");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("etag"), '"v1"');
  assert.equal(signal.aborted, false);
});

test("헤더 수신 실패는 보존하고 본문 오류는 정보 없이 취소·정리한다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const signals = [];
  const failure = new TypeError("connection closed");
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    signals.push(options.signal);
    if (signals.length === 1) throw failure;
    return new Response(new ReadableStream({ start(controller) { controller.error(failure); } }));
  });
  const fetcher = timedPressFetcher(1000);

  await assert.rejects(fetcher("https://www.mohw.go.kr/rss/", {}), (error) => error === failure);
  const response = await fetcher("https://www.mohw.go.kr/rss/", {});
  await assert.rejects(response.text(), (error) => error.code === "UPSTREAM_READ_FAILED");
  t.mock.timers.tick(1000);

  assert.equal(signals[0].aborted, false);
  assert.equal(signals[1].aborted, true);
});

test("읽지 않은 응답도 제한 시간에 취소되지만 본문 없는 304 응답은 취소하지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const signals = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    signals.push(options.signal);
    return signals.length === 1 ? new Response("대기") : new Response(null, { status: 304 });
  });
  const fetcher = timedPressFetcher(1000);
  await fetcher("https://www.mohw.go.kr/rss/", {});
  await fetcher("https://www.mohw.go.kr/rss/", {});

  t.mock.timers.tick(1000);

  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
});

test("전체 수집 마감은 요청별 제한보다 먼저 적용하고 이미 만료되면 기관을 요청하지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  let signal;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    signal = options.signal;
    return new Response("대기");
  });
  await timedPressFetcher(7000, 1001)("https://www.mohw.go.kr/rss/", {});

  t.mock.timers.tick(1000);

  assert.equal(signal.aborted, true);
  await assert.rejects(timedPressFetcher(7000, 1001)("https://www.mohw.go.kr/rss/", {}), { name: "TimeoutError" });
  assert.equal(globalThis.fetch.mock.calls.length, 1);
});

test("호스팅의 다른 실행 영역에서 온 취소 오류도 수집기의 Error 경계에 전달된다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const foreignError = runInNewContext('Object.assign(new Error("The operation was aborted"), { name: "AbortError" })');
  assert.equal(foreignError instanceof Error, false);
  t.mock.method(globalThis, "fetch", async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(foreignError), { once: true });
  }));
  const observed = timedPressFetcher(1000)("https://www.mohw.go.kr/robots.txt", {}).catch((error) => error);

  t.mock.timers.tick(1000);

  const error = await observed;
  assert.equal(error instanceof Error, true, "robots·목록 수집기의 기존 Error 경계가 처리할 수 있어야 한다");
  assert.equal(error.name, "AbortError");
});

test("본문의 호스팅 취소 객체도 정규화하지만 관련 없는 객체 오류는 감추지 않는다", async (t) => {
  const cancellation = { name: "AbortError", message: "The operation was aborted" };
  const unrelated = { name: "CustomFailure", marker: "original" };
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (calls++ > 0) throw unrelated;
    return new Response(new ReadableStream({ start(controller) { controller.error(cancellation); } }));
  });
  const fetcher = timedPressFetcher(1000);
  const response = await fetcher("https://www.mohw.go.kr/rss/", {});

  await assert.rejects(response.text(), (error) => error instanceof Error && error.name === "AbortError");
  await assert.rejects(fetcher("https://www.mohw.go.kr/rss/", {}), (error) => error === unrelated);
});
