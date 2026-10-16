export function readableWelfareText(text: string): string {
  const brackets: string[] = [];
  const closing: Readonly<Record<string, string>> = { "(": ")", "[": "]", "（": "）", "「": "」", "『": "』" };
  return text.replace(/[()[\]（）「」『』]|[.!?][ \t]+(?=[가-힣0-9])/g, (match, offset: number) => {
    const close = closing[match];
    if (close) {
      brackets.push(close);
      return match;
    }
    if (match === brackets.at(-1)) {
      brackets.pop();
      return match;
    }
    if (/^[.!?]/.test(match) && brackets.length === 0 && /[가-힣)）\]」』]/.test(text[offset - 1] ?? "")) {
      return match[0] + "\n";
    }
    return match;
  });
}

export function readableWelfareSummary(text: string): string {
  return readableWelfareText(text).replace(
    " 최저생활을 보장하는 기초생활보장의 핵심 급여",
    " 최저생활을 보장하는\n기초생활보장의 핵심 급여",
  );
}
