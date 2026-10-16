// Pure native-tool scheduler. It runs through an injected ChatGPT tool adapter;
// importing this module never calls a service. The journal/reconciler owns disk I/O.
export function createFaqNativeCollector(runtime) {
  const state = runtime.state;
  const now = runtime.now ?? Date.now;
  const sleep = runtime.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const notify = runtime.notify ?? (() => {});
  const iso = (time = now()) => new Date(time).toISOString();
  const allowedTypes = new Set(["implementation", "document_program", "government_service", "document", "manual_section"]);
  if (state?.schema_version !== "faq-native-collection-1" || !Array.isArray(state.items)) throw new Error("Invalid native collection state");
  if (!state.policy || state.policy.concurrency !== 2 || state.policy.batch_interval_ms < 4000 || state.policy.batch_interval_ms > 8000 || state.policy.max_attempts !== 3 || state.policy.max_calls_per_minute > 60) throw new Error("Invalid collection policy");
  const kindOf = (hit) => {
    const id = String(hit?.id ?? "");
    if (/^manual:/.test(id)) return "manual_section";
    if (/^service:/.test(id)) return "implementation";
    if (/^docprog:/.test(id)) return "document_program";
    if (/^(gov24_service:|gov24:|gov24-|publicservice:|public-service:)/.test(id)) return "government_service";
    if (/^(doc:|document:)/.test(id)) return "document";
    if (/^bl-/.test(id)) return "budget_line";
    if (/^news:/.test(id)) return "news_metadata";
    return hit?.entity_type ?? "unknown";
  };
  const unwrap = (input) => {
    if (!input) return { ok: false, data: null, error: { code: "MISSING_RESPONSE" } };
    if (input.error && !input.structuredContent) return { ok: false, data: null, error: typeof input.error === "string" ? { message: input.error } : input.error };
    const outer = input.jsonrpc ? input.result : input;
    if (!outer) return { ok: false, data: null, error: { code: "INVALID_RPC_RESPONSE" } };
    let data = outer.structuredContent;
    if (data === undefined && Array.isArray(outer.content)) {
      const text = outer.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      try { data = JSON.parse(text); } catch { data = { text }; }
    }
    data ??= outer;
    if (outer.isError || data?.error) {
      const error = typeof data?.error === "object" && data.error ? data.error : {};
      return { ok: false, data, error: { ...error, code: error.code ?? data?.error_code ?? "MCP_TOOL_ERROR", message: error.message ?? data?.error ?? data?.text ?? "MCP tool error", retry_after_seconds: error.retry_after_seconds ?? data?.retry_after_seconds ?? data?.retry_after } };
    }
    return { ok: true, data, error: null };
  };
  const keyOf = (target) => `${target.type}:${target.id}`;
  const latest = (target) => state.targets[keyOf(target)]?.attempts.at(-1);
  const metadata = (data) => ({
    server_version: data?.metadata?.server_version ?? data?.server_version ?? data?.data?.server_version ?? null,
    release_bundle_id: data?.metadata?.release_bundle_id ?? data?.release_bundle_id ?? null,
    gov24_revision: data?.metadata?.gov24_revision ?? data?.gov24_revision ?? null,
    manual_revision: data?.metadata?.manual_revision ?? data?.manual_revision ?? data?.data?.manuals?.revision ?? (typeof data?.components?.manuals === "string" ? data.components.manuals.replace(/^manuals:/, "") : null),
  });
  const selected = () => state.items.flatMap((item) => latest({ type: "search", id: item.id })?.selected ?? []);
  const uniqueFetchTargets = () => [...new Map(selected().filter((hit) => hit.admissible && typeof hit.id === "string" && hit.id).map((hit) => [hit.id, { type: "fetch", id: hit.id }])).values()];
  const statusTargets = (phase) => [{ type: "dataset_status", id: phase }, { type: "integration_status", id: phase }];
  const candidatesForPhase = (phase) => phase === "search" || phase === "retry_search"
    ? state.items.map((item) => ({ type: "search", id: item.id, question: item.question, question_sha256: item.question_sha256 }))
    : phase === "fetch" || phase === "retry_fetch" ? uniqueFetchTargets()
      : phase === "start" || phase === "end" ? statusTargets(phase) : null;
  const canRetry = (last) => last && !last.ok && last.retryable !== false && last.attempt < state.policy.max_attempts;
  const pendingForPhase = (phase) => {
    const candidates = candidatesForPhase(phase);
    if (!candidates) throw new Error("Unsupported phase: " + phase);
    return candidates.filter((target) => {
      const last = latest(target);
      return phase.startsWith("retry_") ? canRetry(last) : (phase === "start" || phase === "end") ? !last || canRetry(last) : !last;
    });
  };
  const startGate = () => {
    const dataset = latest({ type: "dataset_status", id: "start" });
    const integration = latest({ type: "integration_status", id: "start" });
    if (!dataset?.ok || !integration?.ok) return "START_STATUS_NOT_SUCCESSFUL";
    if (!dataset.manual_status?.revision || dataset.manual_status.document_count < 1 || dataset.manual_status.section_count < 1) return "MANUAL_CORPUS_NOT_READABLE";
    const expected = state.ready?.expected ?? {};
    if (expected.manual_revision && dataset.identity.manual_revision !== expected.manual_revision) return "UNEXPECTED_MANUAL_REVISION";
    if (expected.server_version && dataset.identity.server_version !== expected.server_version) return "UNEXPECTED_SERVER_VERSION";
    if (expected.document_count !== undefined && dataset.manual_status.document_count !== expected.document_count) return "UNEXPECTED_MANUAL_DOCUMENT_COUNT";
    if (expected.section_count !== undefined && dataset.manual_status.section_count !== expected.section_count) return "UNEXPECTED_MANUAL_SECTION_COUNT";
    return null;
  };
  const progress = (phase, reason = null) => {
    const searches = state.items.map((item) => latest({ type: "search", id: item.id })).filter(Boolean);
    const fetchTargets = uniqueFetchTargets();
    const fetches = fetchTargets.map(latest).filter(Boolean);
    const attempts = Object.values(state.targets).flatMap((target) => target.attempts);
    const identities = (key) => [...new Set(attempts.filter((attempt) => attempt.response_observed).map((attempt) => attempt.identity?.[key]).filter(Boolean))];
    return {
      run_id: state.run_id, phase, at: iso(), reason,
      search_recorded: searches.length, search_success: searches.filter((attempt) => attempt.ok).length,
      search_nonempty: searches.filter((attempt) => attempt.ok && attempt.result_count > 0).length,
      search_empty: searches.filter((attempt) => attempt.ok && attempt.result_count === 0).length,
      search_errors: searches.filter((attempt) => !attempt.ok).length,
      unique_fetch_candidates: fetchTargets.length, fetch_recorded: fetches.length,
      fetch_success: fetches.filter((attempt) => attempt.ok).length,
      fetch_errors: fetches.filter((attempt) => !attempt.ok).length,
      dispatch_intents: attempts.length, responses_observed: attempts.filter((attempt) => attempt.response_observed).length,
      unresolved_dispatch_intents: attempts.filter((attempt) => !attempt.response_observed && attempt.outcome === "NATIVE_RESULT_NOT_RECOVERED").length,
      native_exceptions: attempts.filter((attempt) => attempt.outcome === "NATIVE_EXCEPTION").length,
      server_versions: identities("server_version"), release_bundle_ids: identities("release_bundle_id"),
      manual_revisions: identities("manual_revision"), gov24_revisions: identities("gov24_revision"),
      batch_interval_ms: state.policy.batch_interval_ms, next_sequence: state.next_sequence,
      start_gate: state.ready ? startGate() : "WAITING_FOR_READY",
    };
  };
  const applyCompleted = (event) => {
    const targetKey = keyOf(event.target);
    const targetState = (state.targets[targetKey] ??= { type: event.target.type, id: event.target.id, attempts: [] });
    const priorIndex = targetState.attempts.findIndex((attempt) => attempt.call_id === event.call_id);
    let parsed = unwrap(event.response);
    if (event.target.type === "search" && parsed.ok && !Array.isArray(parsed.data?.results)) parsed = { ...parsed, ok: false, error: { code: "INVALID_SEARCH_RESPONSE", message: "results array is absent" } };
    if (event.target.type === "fetch" && parsed.ok && parsed.data?.id !== event.target.id) parsed = { ...parsed, ok: false, error: { code: parsed.data?.id ? "FETCH_ID_MISMATCH" : "FETCH_ID_MISSING", message: "Fetch response ID is not the requested candidate ID" } };
    const error = event.exception ? { code: "NATIVE_EXCEPTION", message: event.exception.message } : parsed.error;
    const retryable = !/^(?:UNAUTHORIZED|FORBIDDEN|INVALID_ARGUMENT|INVALID_PARAMS|NOT_FOUND|SNAPSHOT_MISMATCH|VERSION_MISMATCH|FETCH_ID_MISMATCH|FETCH_ID_MISSING|MANUAL_REVISION_MISMATCH|401|403|404|-32602)$/.test(String(error?.code ?? ""));
    const retrySeconds = Number(error?.retry_after_seconds ?? parsed.data?.error_data?.retry_after ?? 0);
    const retryDelay = Math.max(15_000 * 2 ** (event.attempt - 1), Number.isFinite(retrySeconds) ? Math.max(0, retrySeconds) * 1000 + 1000 : 0);
    const meta = {
      call_id: event.call_id, sequence: event.sequence, attempt: event.attempt, phase: event.phase,
      started_at: event.started_at, completed_at: event.completed_at, latency_ms: event.latency_ms,
      response_observed: !event.exception, outcome: event.exception ? "NATIVE_EXCEPTION" : parsed.ok ? "SUCCESS" : "TOOL_ERROR",
      ok: !event.exception && parsed.ok, error: error ?? null, retryable,
      retry_not_before: Date.parse(event.completed_at) + retryDelay,
      identity: metadata(parsed.data),
      ...(event.target.type === "search" ? { result_count: parsed.ok ? parsed.data.results.length : null,
        selected: parsed.ok ? parsed.data.results.slice(0, 5).map((hit, index) => ({ id: hit.id ?? null, rank: index + 1, title: hit.title ?? null, type: kindOf(hit), admissible: allowedTypes.has(kindOf(hit)), revision: hit.revision ?? null })) : [] } : {}),
      ...(event.target.type === "dataset_status" ? { manual_status: parsed.data?.data?.manuals ?? null } : {}),
    };
    if (priorIndex >= 0) targetState.attempts[priorIndex] = meta; else targetState.attempts.push(meta);
    targetState.attempts.sort((a, b) => a.sequence - b.sequence);
    return meta;
  };
  const recordUnresolved = (event) => {
    const targetState = (state.targets[keyOf(event.target)] ??= { type: event.target.type, id: event.target.id, attempts: [] });
    if (targetState.attempts.some((attempt) => attempt.call_id === event.call_id)) return;
    targetState.attempts.push({ call_id: event.call_id, sequence: event.sequence, attempt: event.attempt, phase: event.phase, started_at: event.prepared_at, completed_at: null, response_observed: false, outcome: "NATIVE_RESULT_NOT_RECOVERED", ok: false, error: { code: "NATIVE_RESULT_NOT_RECOVERED", message: "A dispatch intent was saved but no completion event was recovered; actual dispatch/result is unknown." }, retryable: true, retry_not_before: Date.parse(event.prepared_at) + 60_000, identity: {} });
    targetState.attempts.sort((a, b) => a.sequence - b.sequence);
  };
  async function runChunk({ phase = "search", maxBatches = 4 } = {}) {
    if (!state.ready?.confirmed_at) throw new Error("WAITING_FOR_READY: no production tools may be called");
    if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 8) throw new Error("maxBatches must be 1..8");
    if (!["start", "end"].includes(phase)) {
      const blocked = startGate();
      if (blocked) return progress(phase, blocked);
    }
    for (let batch = 0; batch < maxBatches; batch++) {
      if (await runtime.shouldPause?.()) return progress(phase, "PAUSED_BY_FILE");
      const pending = pendingForPhase(phase);
      if (!pending.length) return progress(phase, "PHASE_COMPLETE");
      const eligible = pending.filter((target) => (latest(target)?.retry_not_before ?? 0) <= now());
      if (!eligible.length) return progress(phase, "RETRY_COOLDOWN");
      const chosen = eligible.slice(0, state.policy.concurrency);
      state.dispatch_times = state.dispatch_times.filter((time) => time > now() - 60_000);
      const rateWait = state.dispatch_times.length + chosen.length > state.policy.max_calls_per_minute ? state.dispatch_times[chosen.length - 1] + 60_001 : 0;
      const waitUntil = Math.max(state.next_batch_at ?? 0, state.cooldown_until ?? 0, rateWait);
      if (waitUntil - now() > 10_000) return progress(phase, "GLOBAL_COOLDOWN");
      while (waitUntil > now()) await sleep(Math.min(5000, waitUntil - now()));
      const prepared = [];
      for (const target of chosen) {
        const sequence = state.next_sequence++;
        const event = { kind: "call_started", schema_version: "faq-native-call-1", run_id: state.run_id, dataset_id: state.dataset_id,
          call_id: `${state.run_id}:${String(sequence).padStart(6, "0")}`, sequence, phase, target,
          attempt: (latest(target)?.attempt ?? 0) + 1, prepared_at: iso(),
          dispatch_status: "INTENT_PERSISTED_BEFORE_TOOL_INVOCATION",
          tool: target.type === "search" ? "app_search" : target.type === "fetch" ? "app_fetch" : target.type === "dataset_status" ? "app_get_dataset_status" : "app_get_integration_status",
          arguments: target.type === "search" ? { query: target.question } : target.type === "fetch" ? { id: target.id } : {},
          policy: { concurrency: 2, batch_interval_ms: state.policy.batch_interval_ms, max_attempts: 3, max_calls_per_minute: state.policy.max_calls_per_minute },
        };
        await runtime.persist(event);
        prepared.push(event);
      }
      const batchStarted = now();
      state.next_batch_at = batchStarted + state.policy.batch_interval_ms;
      let journal = Promise.resolve();
      const results = await Promise.allSettled(prepared.map(async (start) => {
        const began = now();
        state.dispatch_times.push(began);
        let response = null, exception = null;
        try { response = await runtime.call(start.tool, start.arguments); }
        catch (error) { exception = { name: error?.name ?? "Error", message: String(error?.message ?? error) }; }
        const event = { ...start, kind: "call_completed", started_at: iso(began), completed_at: iso(), latency_ms: now() - began, response, exception };
        runtime.capture?.(event);
        journal = journal.then(() => runtime.persist(event));
        await journal;
        return applyCompleted(event);
      }));
      for (const result of results) if (result.status === "rejected") throw result.reason;
      const failures = results.filter((result) => !result.value.ok);
      if (failures.length) {
        state.policy.batch_interval_ms = 8000;
        state.cooldown_until = Math.max(state.cooldown_until ?? 0, ...failures.map((result) => result.value.retry_not_before));
      }
      state.consecutive_error_batches = failures.length === results.length ? (state.consecutive_error_batches ?? 0) + 1 : 0;
      if (state.consecutive_error_batches >= 3) state.cooldown_until = Math.max(state.cooldown_until ?? 0, now() + 120_000);
      await runtime.checkpoint?.(state, progress(phase));
      notify(progress(phase));
    }
    return progress(phase, "CHUNK_COMPLETE");
  }
  return { state, runChunk, progress, applyCompleted, recordUnresolved, pendingForPhase, uniqueFetchTargets, startGate };
}
