export function manualPlainText(content: string): string {
  return content.replace(/!\[[^\]]*\]\([^\n]+\)/g, "[이미지 본문 미수록]")
    .replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}
