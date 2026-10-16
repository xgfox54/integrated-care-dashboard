import { readFileSync } from "node:fs";
import { lawKind, lawUrl, normalizeLawName } from "../../lib/welfare100/law-url.ts";

const reviews = JSON.parse(readFileSync(new URL("../../data/welfare100/legal-link-reviews.json", import.meta.url), "utf8"));

export function applyLegalLinkReviews(item, laws) {
  return laws.map(law => {
    const name = normalizeLawName(law.name);
    const matches = reviews.entries.filter(review => review.item === item && normalizeLawName(review.name) === name && (!review.article || !/^제\s*\d/.test(review.article) || (law.article ?? "").replace(/\s/g, "").includes(review.article.replace(/\s/g, ""))));
    const notes = [...new Set(matches.filter(review => review.status === "PENDING").map(review => review.note))];
    const url = notes.length ? undefined : lawUrl(name) ?? (law.url && !/law\.go\.kr\/(?:DRF|법령|자치법규|행정규칙)/i.test(decodeURI(law.url)) ? law.url : undefined);
    return { ...law, name, kind: lawKind(name), url, reviewNote: notes.length ? "근거 연결 검토 중: " + notes.join(" / ") : undefined };
  });
}
