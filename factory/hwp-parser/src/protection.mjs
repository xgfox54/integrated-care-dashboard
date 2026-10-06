// HWP 5.x 보호 문서 판별(작업지시서 v5 §5.13, T69). FileHeader 스트림의 속성(오프셋 36, DWORD)을 읽어
// 암호·배포용·DRM·공인인증서 암호화/DRM 문서는 파서에 넘기지 않는다. kordoc은 배포용 문서를 스스로 풀어 읽기 때문에(2026-10-05 hwplib 표본 확인)
// 파싱 전에 막아야 보호 해제가 일어나지 않는다. 승인된 열람 가능 사본이 없으면 보류(REQUIRES_AUTHORIZED_COPY)한다.
import CFB from "cfb";

/** HWP 5.0 문서 형식 FileHeader 속성 비트. */
const FLAGS = Object.freeze([
  { bit: 1, name: "password", code: "ENCRYPTED" },
  { bit: 2, name: "distribution", code: "DISTRIBUTION_PROTECTED" },
  { bit: 4, name: "drm", code: "DRM_PROTECTED" },
  { bit: 8, name: "certificate_encryption", code: "ENCRYPTED" },
  { bit: 10, name: "certificate_drm", code: "DRM_PROTECTED" },
]);

/** HWP5 바이트의 보호 상태. 보호가 없으면 null. FileHeader를 읽지 못하면 판단을 미루지 않고 오류로 돌린다. */
export function hwp5Protection(bytes) {
  let container;
  try {
    container = CFB.read(Buffer.from(bytes), { type: "buffer" });
  } catch {
    return { code: "PROTECTION_UNREADABLE", flags: [], properties: null };
  }
  const header = CFB.find(container, "FileHeader");
  if (!header || !header.content || header.content.length < 40) return { code: "PROTECTION_UNREADABLE", flags: [], properties: null };
  const content = Buffer.from(header.content);
  if (!content.subarray(0, 17).toString("latin1").startsWith("HWP Document File")) return { code: "PROTECTION_UNREADABLE", flags: [], properties: null };
  const properties = content.readUInt32LE(36);
  const flags = FLAGS.filter((flag) => (properties & (1 << flag.bit)) !== 0);
  if (!flags.length) return null;
  return { code: flags[0].code, flags: flags.map((flag) => flag.name), properties };
}
