// Retry temporary transport failures without accepting incomplete or mismatched data.
export async function backupFetch(url, { timeoutMs = 30000, ...options } = {}, { fetchFn = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now(), maxAttempts = 4 } = {}) {
 for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  let response;
  try { response = await fetchFn(url, { ...options, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (error) { if (attempt === maxAttempts) throw error; await pause(1000 * 2 ** attempt); continue; }
  if (![429, 500, 502, 503, 504].includes(response.status)) return response;
  if (attempt === maxAttempts) throw new Error('공개 백업 요청 실패: HTTP ' + response.status);
  const retry = response.headers.get('retry-after');
  const serverDelay = retry === null ? 0 : /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - now());
  const delay = Math.max(1000 * 2 ** attempt, Number.isFinite(serverDelay) ? serverDelay : 0);
  await response.body?.cancel();
  if (delay > 30000) throw new Error('공개 백업 요청 대기 필요: Retry-After ' + retry);
  await pause(delay);
 }
 throw new Error('공개 백업 요청 재시도 횟수가 잘못되었습니다.');
}
