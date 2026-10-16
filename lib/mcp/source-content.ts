export const SOURCE_CONTENT_ALGORITHM = 'official-visible-content-v1';
export async function sourceContentHash(bytes: Uint8Array, contentType: string): Promise<string> {
  let content = bytes;
  if (/text\/html/i.test(contentType)) {
    const html = new TextDecoder().decode(bytes);
    const body = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
      ?? html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
      ?? html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
    const text = body.replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('SOURCE_CONTENT_EMPTY');
    content = new TextEncoder().encode(text);
  }
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(content)))).map(value => value.toString(16).padStart(2, '0')).join('');
}
