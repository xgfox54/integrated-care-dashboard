import { readFileSync } from "node:fs";
import { lawKind, lawUrl, normalizeLawName } from "../../lib/welfare100/law-url.ts";

const reviews = JSON.parse(readFileSync(new URL("../../data/welfare100/legal-link-reviews.json", import.meta.url), "utf8"));
const corrections = JSON.parse(readFileSync(new URL("../../data/welfare100/legal-link-corrections.json", import.meta.url), "utf8"));
const compactArticle = article => String(article ?? "").replace(/\s/g, "");

export function applyLegalLinkReviews(item, laws, verified = corrections.corrections) {
  const applied = new Set();
  return laws.flatMap(law => {
    const sourceName = law.sourceName ?? law.name;
    const sourceArticle = law.sourceArticle ?? law.article ?? "";
    const candidates = verified.filter(entry => entry.item === item && normalizeLawName(entry.from.name) === normalizeLawName(sourceName));
    const correction = candidates.find(entry => compactArticle(entry.from.article) === compactArticle(sourceArticle));
    if (correction) {
      const key = sourceName + "\u0000" + compactArticle(sourceArticle);
      if (applied.has(key)) return [];
      applied.add(key);
      return correction.to.map(replacement => ({
        name: replacement.name,
        ...(replacement.article ? { article: replacement.article } : {}),
        kind: replacement.kind ?? lawKind(replacement.name),
        ...(!replacement.reviewNote ? { url: replacement.url ?? lawUrl(replacement.name) ?? undefined } : {}),
        ...(replacement.scopeNote ? { scopeNote: replacement.scopeNote } : {}),
        ...(replacement.reviewNote ? { reviewNote: replacement.reviewNote } : {}),
        sourceName,
        sourceArticle,
      }));
    }
    if (candidates.length) return { ...law, url: undefined, reviewNote: "원자료가 검수한 인용과 달라져 이전 정정을 적용하지 않았습니다. 공식 원문 재대조가 필요합니다." };
    const name = normalizeLawName(law.name);
    const matches = reviews.entries.filter(review => review.item === item && normalizeLawName(review.name) === name && (!review.article || !/^제\s*\d/.test(review.article) || (law.article ?? "").replace(/\s/g, "").includes(review.article.replace(/\s/g, ""))));
    const notes = [...new Set(matches.filter(review => review.status === "PENDING").map(review => review.note))];
    const url = notes.length ? undefined : lawUrl(name) ?? (law.url && !/law\.go\.kr\/(?:DRF|법령|자치법규|행정규칙)/i.test(decodeURI(law.url)) ? law.url : undefined);
    return { ...law, name, kind: lawKind(name), url, reviewNote: notes.length ? "근거 연결 검토 중: " + notes.join(" / ") : undefined };
  });
}
