export function selectionFieldStatus(selection: string | null | undefined) {
  if (selection?.trim()) return { status: "STORED_TEXT" as const, note: "저장된 선정기준입니다. 현재 적용기준과 개인 자격의 검증을 뜻하지 않습니다." };
  return {
    status: "SEPARATE_FIELD_NOT_STORED" as const,
    note: "선정기준 독립 필드 미수록. 조건이 없다는 뜻은 아닙니다. 지원대상·지원내용과 공식 원문의 조건·예외를 함께 확인하세요.",
  };
}
