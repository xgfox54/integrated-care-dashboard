// kordoc 내장 OCR(PP-OCRv5 korean) 모델 확인. 모델은 준비 단계(prepare-models.mjs)에서만 받고, 문서 처리 워커는 오프라인으로 이 파일만 읽는다.
// 기대 해시·URL·크기는 설치된 kordoc 배포본(dist)의 모델 사양에서 읽는다(우리가 값을 지어내지 않음).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const KORDOC_DIST = path.join(here, "..", "node_modules", "kordoc", "dist");
export const OCR_GROUP = "ppocr";
const SPEC_NAMES = ["OCR_DET_MODEL", "OCR_REC_MODEL", "OCR_REC_DICT"];

/** 작업공간 아래 모델 캐시(KORDOC_MODEL_CACHE). 저장소(git)에는 넣지 않는다. */
export function modelCacheRoot(root) {
  return path.join(root, "models");
}

/** 설치된 kordoc 배포본에서 PP-OCRv5 모델 사양을 읽는다. 찾지 못하면 null(OCR 미준비로 처리). */
export function kordocOcrSpecs() {
  if (!existsSync(KORDOC_DIST)) return null;
  for (const file of readdirSync(KORDOC_DIST).filter((name) => name.endsWith(".js"))) {
    const source = readFileSync(path.join(KORDOC_DIST, file), "utf8");
    if (!source.includes("var OCR_DET_MODEL = {")) continue;
    const specs = [];
    for (const name of SPEC_NAMES) {
      const block = new RegExp("var " + name + " = \\{([\\s\\S]*?)\\};").exec(source)?.[1];
      if (!block) return null;
      const field = (key) => new RegExp(key + ':\\s*"([^"]+)"').exec(block)?.[1] ?? null;
      const size = /sizeMb:\s*(\d+)/.exec(block)?.[1];
      specs.push({ spec: name, name: field("name"), filename: field("filename"), url: field("url"), sha256: field("sha256"), size_mb_declared: size ? Number(size) : null });
    }
    if (specs.every((spec) => spec.filename && spec.sha256 && /^https:\/\/huggingface\.co\/PaddlePaddle\//.test(spec.url ?? ""))) return { dist_file: file, specs };
    return null;
  }
  return null;
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** 모델 파일이 kordoc 사양 해시와 같고 준비 기록이 있을 때만 ready. 내려받지 않는다. */
export function verifyOcrModels(root) {
  const specs = kordocOcrSpecs();
  const dir = path.join(modelCacheRoot(root), OCR_GROUP);
  const recordPath = path.join(modelCacheRoot(root), "models-record.json");
  if (!specs) return { ready: false, reason: "KORDOC_MODEL_SPEC_NOT_FOUND", files: [] };
  const files = specs.specs.map((spec) => {
    const file = path.join(dir, spec.filename);
    if (!existsSync(file)) return { filename: spec.filename, expected_sha256: spec.sha256, sha256: null, size_bytes: null, ok: false };
    const sha256 = sha256File(file);
    return { filename: spec.filename, name: spec.name, url: spec.url, expected_sha256: spec.sha256, sha256, size_bytes: statSync(file).size, ok: sha256 === spec.sha256 };
  });
  const record = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, "utf8")) : null;
  const ready = files.every((file) => file.ok) && record !== null;
  return {
    ready,
    reason: ready ? null : !record ? "MODELS_NOT_PREPARED" : "MODEL_HASH_MISMATCH",
    engine: "PP-OCRv5 mobile det + korean rec (ONNX, onnxruntime-node CPU)",
    files: files.map(({ filename, name, url, expected_sha256, sha256, size_bytes, ok }) => ({ filename, name, url, expected_sha256, sha256, size_bytes, ok })),
    digest: ready ? createHash("sha256").update(files.map((file) => file.filename + ":" + file.sha256).join("\n")).digest("hex") : null,
    prepared_at: record?.prepared_at ?? null,
  };
}
