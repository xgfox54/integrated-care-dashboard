// Python 오프셋 시험이 부르는 도우미: 특수 문자가 섞인 문단을 청크로 나눠 원문과 JS 조각·오프셋을 JSON으로 내보낸다.
import { buildDocument } from "../../../hwp-parser/src/normalize.mjs";
import { chunkDocument } from "../../../hwp-parser/src/chunk.mjs";

const TEXT = "면적 30m² 이하, 소득 ≤ 중위 50%\n(단, 𝑥 ≥ 2인 가구) 😀 지원 H₂O −3℃ 〈별표 1〉 ①항 ".repeat(3);
const { document, tables } = buildDocument({ metadata: { pageMode: "layout" }, blocks: [{ type: "paragraph", text: TEXT, pageNumber: 1 }] }, "p_" + "4".repeat(32), { maxDepth: 3, maxLogicalSlots: 1000 });
const out = [];
for (const max of [7, 13, 20, 31]) {
  const result = chunkDocument({ document, tables, maxChars: max });
  for (const chunk of result.chunks) for (const span of chunk.spans) out.push({ max, start: span.start, end: span.end, start_cp: span.start_cp, end_cp: span.end_cp, js_slice: TEXT.slice(span.start, span.end) });
}
process.stdout.write(JSON.stringify({ text: TEXT, spans: out }));
