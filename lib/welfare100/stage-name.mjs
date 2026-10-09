// 단계 이름 앞의 영문+숫자 코드(예: "G1 접수·이송")만 코드로 나눈다.
// 복지제도100 단계는 "신청·접수", "바우처 지원"처럼 한글 이름만 있으므로
// 첫 단어를 코드로 보면 이름 일부가 고정폭 글꼴로 나온다.
const STAGE_CODE = /^[A-Z]{1,3}\d{1,3}$/;

export function splitStageName(stage) {
  const separator = stage.indexOf(" ");
  const head = separator > 0 ? stage.slice(0, separator) : "";
  if (head && STAGE_CODE.test(head)) {
    return { full: stage, code: head, label: stage.slice(separator + 1) };
  }
  return { full: stage, code: "", label: stage };
}
