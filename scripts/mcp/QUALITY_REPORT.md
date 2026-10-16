# Offline quality reports

Run from the site root:

```sh
node scripts/mcp/run-quality-report.mjs --manifest captured/manifest.json --output captured/report --profile current
```

This command reads local files only. It makes no model or network requests. It writes
`quality.json` and `REPORT.md`, including failures. Exit 0 means all declared required
retrieval suites pass, 1 means complete evidence fails a retrieval contract gate, and
2 means required evidence is missing, invalid, stale or mixed. Historical profile can
render old evidence but always has `release_eligible:false`, including on exit 0.

The two exported core functions are `validateQualityRun(input, {profile, now})` and
`buildQualityReport(validatedRun)`. Core artifact values include `{path, sha256, bytes}`;
the CLI resolves path references and verifies file SHA-256 before parsing JSON.
The benchmark and observations are reevaluated; input scores and check booleans are
never accepted as evidence. Artifact hashes protect local integrity, not capture authenticity.

## Collection contract

Use the existing authorized MCP connection. Capture `get_dataset_status` immediately
before and after the original suite. Keep full raw envelopes including errors. Capture
`initialize` server version and `tools/list` when available. When the native connected
app does not expose these protocol operations, explicitly use
`server_version_basis:"get_dataset_status"` and toolset
`basis:"enabled_app_tool_metadata"`; never invent an initialize or tools/list response.
The latter proves the enabled connector's tool names, not a direct protocol listing.

Balanced observations must be exactly 50 rows with the original `CASES` IDs, tool names
and arguments from `evaluate-balanced-search.mjs`:

```json
[{"id":"BAL-001","tool":"search","args":{"query":"서귀포시 복지사업"},"response":{"structuredContent":{}},"latency_ms":123}]
```

This abbreviated example is not passing evidence. Preserve every original failure;
unavailable tools are `TOOLSET_MISMATCH`, never grounds to remove a case or domain.
Use null for unmeasured latency, never an estimate or zero placeholder. Optional
`source_pins:[{response_pointer:"/revision",status_pointer:"/faq_129/revision"}]`
bind a response field to a captured status field. Pointers resolve against the decoded
payload (`structuredContent.data`, `structuredContent`, direct `.data`, or direct object).
Unknown pins fail; cached old content cannot inherit a new revision. Per-response
version/bundle fields are checked when present. Unexposed response provenance remains
an explicit limitation, not an invented equality assertion.

Save the benchmark as the exact JSON serialization of exported `CASES`, then hash
its bytes. Registered tools artifact shape:

```json
{"basis":"enabled_app_tool_metadata","tools":[{"name":"search"},{"name":"search_faq"}]}
```

Include all enabled tool names (the example is abbreviated). Full metadata is allowed.
The manifest uses SHA-256 of each complete file; paths resolve relative to the manifest:

```json
{
  "schema_version":"quality-manifest-1",
  "required_suites":["balanced"],
  "suites":{
    "balanced":{
      "run":{
        "run_id":"captured-run-id",
        "started_at":"2026-10-13T00:00:00.000Z",
        "completed_at":"2026-10-13T00:10:00.000Z",
        "code_commit":"0123456789012345678901234567890123456789",
        "endpoint_label":"authorized-welfare-mcp",
        "server_versions":["1.12.0"],
        "server_version_basis":"get_dataset_status"
      },
      "benchmark":{"path":"balanced-cases.json","sha256":"REPLACE_WITH_SHA256"},
      "observations":{"path":"responses.json","sha256":"REPLACE_WITH_SHA256"},
      "before":{"path":"before.json","sha256":"REPLACE_WITH_SHA256"},
      "after":{"path":"after.json","sha256":"REPLACE_WITH_SHA256"},
      "registered_tools":{"path":"registered-tools.json","sha256":"REPLACE_WITH_SHA256"},
      "revision_pointers":["/faq_129/revision","/gov24/revision","/welfare100/revision","/manuals/revision","/knowledge/component","/news/component","/fiscal/component","/budget_documents/component","/documents/component","/links/component","/statistics/revision"]
    }
  }
}
```

Server and bundle IDs are compared separately from source revisions. All exposed
`revision` and `component` fields are compared, including statistics dataset revisions
keyed by dataset ID; changing refresh/check timestamps does not change a revision.
Source evidence retains actual JSON pointers into the before artifact. Collection must
start within 24 hours for a current report. End snapshots cannot be reconstructed later.

## Separate suites and dimensions

Balanced has 50 cases, ten equally weighted domains, five cases per domain. The
existing >=95% domain gate requires 5/5. Missing cases stay in the expected denominator
and block the gate. Retrieval, unsupported handling, FAQ condition paragraph routing,
latency, source identity, citation integrity and generated answers are separate.
Condition routing is structural evidence, not proof of semantic condition correctness.
Citation presence is not citation integrity. Those semantic checks remain NOT_EVALUATED.

Golden uses a separate `golden` artifact set with the same run envelope. Its benchmark
is the existing 200-item golden/FAQ JSON consumed by `validateGolden`. Each observation
is `{id,tool:"search",args:{query:item.question},response:raw,latency_ms}`. `raw` preserves
`question`, `search.arguments.query`, `search.result`, and every `fetched` entry from
the existing golden runner. The existing `evaluateRecord` and `summarize` are rerun.
Golden retrieval gate requires program and expected-document recall@5 in >=95% of the
complete benchmark. FAQ source-observation profiles have no verified answer key and
cannot pass this golden gate. Golden metrics keep their original profile and denominators.
Historical golden results should use a separate historical manifest; they never become
current release proof. Required suites are explicit, so a current balanced-only manifest
can be used when golden capture is unavailable. Different revisions are explicitly
marked `INCOMPATIBLE_REVISIONS`; suite percentages are never averaged.

Optional `actual_answers` contains `{benchmark:{path,sha256},observations:{path,sha256},
evidence_root:"relative-directory"}`. Only complete preexisting records accepted by
`evaluateActualAnswers` are evaluated. Its original manual-review basis
`MANUAL_REVIEW_REPORTED`, tool-usage visibility and limitations are retained in `review`.
Absent answers are NOT_EVALUATED; malformed/partial answers are INVALID. Neither counts
as a passing generated-answer gate or prevents a separately passing retrieval gate.
No prompts, answers, API keys or model calls are generated by this workflow.

Unit fixtures under `quality-report-fixtures.mjs` are visibly synthetic and are not
production observations. Tests exercise file tampering, missing/duplicate cases,
binding mismatches, stale runs, mixed revisions, optional-answer rejection, latency
and CLI exit codes. Evidence from those tests proves report behavior only.
