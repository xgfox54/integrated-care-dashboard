// 준비 단계 전용(네트워크 허용, 문서 원문 없음): kordoc 내장 OCR 모델을 공식 배포처(Hugging Face PaddlePaddle 저장소)에서 받아
// 작업공간 models/ppocr에 둔다. 다운로드·SHA-256 검증은 kordoc이 한다(첫 OCR 사용 시 자동 다운로드 경로). 이 단계 뒤 문서 처리 워커는 오프라인으로만 돈다.
// 사용: node src/prepare-models.mjs --root var/welfare-factory
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { kordocOcrSpecs, modelCacheRoot, verifyOcrModels } from "./models.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const index = process.argv.indexOf("--root");
const root = index > 0 ? path.resolve(process.argv[index + 1]) : null;
if (!root) {
  console.error("사용: node src/prepare-models.mjs --root <작업공간 루트>");
  process.exit(2);
}
const cache = modelCacheRoot(root);
mkdirSync(cache, { recursive: true });
const env = { ...process.env, KORDOC_MODEL_CACHE: cache };
delete env.KORDOC_OFFLINE;
// 흰 바탕 PNG 한 장(원문 아님)을 kordoc 이미지 OCR에 넣어 공식 모델 준비(ensureOcrModels)를 일으킨다.
const trigger = "import sharp from 'sharp';import {parseImage} from 'kordoc';" +
  "const png=await sharp({create:{width:64,height:32,channels:3,background:'#ffffff'}}).png().toBuffer();" +
  "const r=await parseImage(png.buffer.slice(png.byteOffset,png.byteOffset+png.byteLength),{ocr:true});console.log(JSON.stringify({success:r.success,code:r.code??null}))";
const started = Date.now();
const download = spawnSync(process.execPath, ["--input-type=module", "-e", trigger], { cwd: path.join(here, ".."), env, encoding: "utf8", timeout: 600_000 });
const status = spawnSync(process.execPath, [path.join(here, "..", "node_modules", "kordoc", "dist", "cli.js"), "models", "--status"], { env, encoding: "utf8", timeout: 120_000 });
const statusJson = (() => {
  try {
    return JSON.parse(status.stdout).find((group) => group.group === "ppocr") ?? null;
  } catch {
    return null;
  }
})();
const verified = verifyOcrModels(root);
const specs = kordocOcrSpecs();
const kordocVersion = JSON.parse((await import("node:fs")).readFileSync(path.join(here, "..", "node_modules", "kordoc", "package.json"), "utf8")).version;
const record = {
  prepared_at: new Date().toISOString(),
  purpose: "kordoc 내장 OCR(로컬 ONNX). 문서 원문은 이 단계에 쓰지 않음",
  kordoc_version: kordocVersion,
  model_spec_source: specs ? "node_modules/kordoc/dist/" + specs.dist_file : null,
  official_source: "https://huggingface.co/PaddlePaddle (kordoc 배포본에 적힌 URL)",
  download_ms: Date.now() - started,
  download_exit: download.status,
  kordoc_status: statusJson,
  files: verified.files,
  license_note: "PaddleOCR(PP-OCRv5) 모델은 PaddlePaddle 배포(Apache-2.0). 모델 카드 확인은 docs/dependency-record.md",
};
const allOk = verified.files.length === 3 && verified.files.every((file) => file.ok) && statusJson?.allReady === true;
if (allOk) writeFileSync(path.join(cache, "models-record.json"), JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify({ ok: allOk, cache, files: verified.files.map((file) => ({ filename: file.filename, ok: file.ok, size_bytes: file.size_bytes, sha256: file.sha256 })), kordoc_status_all_ready: statusJson?.allReady ?? null, download_stderr_tail: allOk ? undefined : (download.stderr ?? "").slice(-400) }, null, 2));
process.exitCode = allOk ? 0 : 1;
