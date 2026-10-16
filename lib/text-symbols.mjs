// 한글 문서·PDF의 기호 글꼴(Wingdings·Symbol) 글머리는 글꼴 없이 유니코드 사용자 정의 영역(U+E000~U+F8FF)으로 저장돼
// 일반 글꼴에서 □로 깨진다. 원래 모양에 가까운 일반 기호로 바꾸고, 모양을 알 수 없는 문자는 글머리표(•)로 바꾼다.
const PRIVATE_SYMBOLS = new Map([
  [0xf000, ""],
  [0xf011, "·"],
  [0xf020, " "],
  [0xf046, "☞"],
  [0xf06c, "●"],
  [0xf06d, "○"],
  [0xf06e, "■"],
  [0xf06f, "□"],
  [0xf071, "□"],
  [0xf076, "◆"],
  [0xf081, "①"],
  [0xf09e, "·"],
  [0xf09f, "•"],
  [0xf0a0, "▪"],
  [0xf0a1, "○"],
  [0xf0a7, "▪"],
  [0xf0d8, "▶"],
  [0xf0e8, "→"],
  [0xf0ec, "→"],
  [0xf0ee, "→"],
  [0xf0fc, "√"],
  [0xf104, "▪"],
]);

export function replacePrivateSymbols(text) {
  if (typeof text !== "string" || !/[\uE000-\uF8FF]/u.test(text)) return text;
  return text.replace(/[\uE000-\uF8FF]/gu, (char) => PRIVATE_SYMBOLS.get(char.codePointAt(0)) ?? "•");
}

export function replacePrivateSymbolsDeep(value) {
  if (typeof value === "string") return replacePrivateSymbols(value);
  if (Array.isArray(value)) return value.map(replacePrivateSymbolsDeep);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replacePrivateSymbolsDeep(item)]));
  return value;
}

