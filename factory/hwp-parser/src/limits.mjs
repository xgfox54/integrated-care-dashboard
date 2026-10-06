// 로컬 문서 파싱 워커의 보수적 상한(작업지시서 v5 §5.16, 2026-10-05 kordoc 4.18.13 개편). kordoc 공식 한도·실측 성능이 아니다.
// 작업 명세의 limits로는 이 값보다 작게만 바꿀 수 있다.
export const LIMITS = Object.freeze({
  /** 원문 크기 */
  maxInputBytes: 50 * 1024 * 1024,
  /** ZIP 계열(HWPX·DOCX·XLSX·PPTX) 누적 해제 크기·항목 수 — 해제 전에 중앙 디렉터리로 검사 */
  maxZipExpandedBytes: 256 * 1024 * 1024,
  maxZipEntries: 10_000,
  /** 문서 하나 처리 시간(OCR 포함). 넘으면 부모가 프로세스 트리를 끝낸다 */
  timeoutMs: 600_000,
  /** V8 힙 한도(--max-old-space-size). ONNX·pdfium 네이티브 메모리는 포함하지 않는다 */
  maxOldSpaceMb: 2048,
  /** 워커 프로세스 상주 메모리(RSS) 한도 — 네이티브 메모리 포함. 넘으면 워커가 스스로 중단한다 */
  maxRssMb: 3072,
  maxOutputBytes: 64 * 1024 * 1024,
  maxDepth: 32,
  maxLogicalSlots: 200_000,
  /** PDF는 앞에서부터 이 쪽 수까지만 파싱한다. 더 길면 PARTIAL(잘린 문서를 완전한 결과로 표시하지 않음) */
  maxPages: 300,
  /** OCR할 쪽 수 상한. 넘으면 OCR하지 않고 검토로 넘긴다 */
  maxOcrPages: 60,
  /** 같은 작업공간에서 동시에 도는 워커 수 */
  maxConcurrentJobs: 2,
});
