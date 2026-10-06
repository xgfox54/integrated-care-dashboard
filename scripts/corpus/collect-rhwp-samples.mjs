// 형식 판별·보호 문서 실표본(작업지시서 v5 T52·T69): MIT 라이선스 공개 저장소 edwardkim/rhwp의 고정 커밋에서 표본을 받는다.
// 원문은 var/welfare-factory/raw/public-samples/rhwp(git 제외)에 두고 manifest.json에 출처·커밋·라이선스·해시를 남긴다. 비밀번호는 쓰지 않는다.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const COMMIT = "680111ec7bea2fe11110de18c3676ba5a1cf7847";
const FILES = [
  ["samples/HWP3-password-123456.hwp", "HWP3 암호 문서"],
  ["samples/hwp3-sample16-hwp5-2024-password-123456.hwp", "HWP5 암호 문서"],
  ["samples/HWP5-password-123456.hwpx", "HWPX 암호 문서"],
  ["samples/HWP5-nopassword-123456.hwp", "HWP5 비보호 대조"],
  ["fuzz/corpus/parse_hwp3/hwp3-sample.hwp", "HWP3 일반"],
  ["fuzz/corpus/parse_hwp3/SO-SUEOP.hwp", "HWP3 일반"],
  ["fuzz/corpus/parse_hwp3/hwp3-table-caption.hwp", "HWP3 표"],
  ["fuzz/corpus/parse_hwp/blank_hwpx.hwp", "확장자 .hwp 표본(실제 형식은 바이트로 판별)"],
];
const out = path.resolve("var/welfare-factory/raw/public-samples/rhwp");
mkdirSync(out, { recursive: true });
const items = [];
for (const [file, note] of FILES) {
  const url = "https://raw.githubusercontent.com/edwardkim/rhwp/" + COMMIT + "/" + file.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(url, { headers: { "User-Agent": "welfare-corpus-sampler/1.0" } });
  if (!response.ok) throw new Error(file + " HTTP " + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  const name = path.basename(file);
  writeFileSync(path.join(out, name), bytes);
  items.push({ file: name, source_path: file, note, url, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), head_hex: bytes.subarray(0, 8).toString("hex") });
}
writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ source: "https://github.com/edwardkim/rhwp", commit: COMMIT, license: "MIT (Copyright (c) 2025-2026 Edward Kim)", collected_at: new Date().toISOString(), purpose: "형식 판별·보호 문서 처리 시험 전용. 공개·재배포하지 않음", items }, null, 2) + "\n");
console.log(items.map((i) => i.file + " " + i.size + " " + i.head_hex).join("\n"));

