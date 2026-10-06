// 공공데이터포털 XML 응답(<items><item><필드>값</필드>…</item></items>)의 평평한 item 목록만 읽는다.
// 원천 명세의 응답은 한 단계 item 구조이므로 범용 XML 파서를 쓰지 않는다. 엔터티는 기본 5종과 숫자 참조만 푼다.

function decodeEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export function xmlItems(xml: string): Record<string, string>[] {
  const items: Record<string, string>[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const record: Record<string, string> = {};
    const body = match[1] ?? "";
    for (const field of body.matchAll(/<([A-Za-z_][\w.-]*)>([\s\S]*?)<\/\1>/g)) record[field[1] ?? ""] = decodeEntities((field[2] ?? "").trim());
    for (const empty of body.matchAll(/<([A-Za-z_][\w.-]*)\s*\/>/g)) record[empty[1] ?? ""] = "";
    items.push(record);
  }
  return items;
}

export function xmlNumber(xml: string, name: string): number | null {
  const match = new RegExp("<" + name + ">\\s*(\\d+)\\s*</" + name + ">").exec(xml);
  return match ? Number(match[1]) : null;
}
