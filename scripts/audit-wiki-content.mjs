import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { findBundledBokjiroExplanation } from "../lib/bokjiro.ts";
import { normalizeRows } from "../lib/dataset.ts";
import {
  alignToRepositoryTaxonomy,
  correctFromRepositoryBaseline,
  removeExtractedContinuationFragments,
  repairKnownExtractionFragments,
} from "../lib/official-correction.ts";
import { readMohwSeed } from "../lib/mohw-seed.ts";
import { readRepositoryBaseline } from "../lib/repository-baseline.ts";
import { createWikiArticle } from "../lib/wiki-article.ts";
import { normalizeWikiText, resolveFallbackKnowledge } from "../lib/wiki-knowledge.ts";
import {
  getVerifiedWikiSupplement,
  listVerifiedWikiSupplements,
} from "../lib/wiki-verified-supplements.ts";

const seed = readMohwSeed();
const baseline = readRepositoryBaseline();
const officialRows = alignToRepositoryTaxonomy(
  correctFromRepositoryBaseline(seed.documents.flatMap((entry) => entry.services), baseline),
  baseline,
);
const rows = normalizeRows(
  removeExtractedContinuationFragments(repairKnownExtractionFragments(officialRows)),
);
const articles = rows.map((row) => createWikiArticle(row, {
  verifiedSupplement: getVerifiedWikiSupplement(row.serviceId),
}));
const displayMismatches = rows.flatMap((row, index) => {
  const dashboardOverview = row.description.replace(/\s+/g, " ").trim();
  const wikiOverview = articles[index]?.overview ?? "";
  return dashboardOverview === wikiOverview
    ? []
    : [{
        serviceId: row.serviceId,
        name: row.name,
        dashboardOverview,
        wikiOverview,
        contentStatus: articles[index]?.contentStatus ?? "missing",
      }];
});
const nameCounts = new Map();
for (const row of rows) nameCounts.set(row.name, (nameCounts.get(row.name) ?? 0) + 1);

function officialDocumentMatches(row) {
  const [bid, listNo] = row.serviceId.split(":");
  const url = new URL(row.detailUrl);
  return url.hostname === "www.mohw.go.kr"
    && url.searchParams.get("bid") === bid
    && url.searchParams.get("list_no") === listNo;
}

const sourceEvidence = [];
for (const row of rows) {
  for (const source of [
    findBundledBokjiroExplanation(row.name),
    resolveFallbackKnowledge(row.name),
  ].filter(Boolean)) {
    const exact = normalizeWikiText(source.matchedTerm) === normalizeWikiText(row.name);
    sourceEvidence.push({
      serviceId: row.serviceId,
      name: row.name,
      tier: source.tier,
      title: source.title,
      matchedTerm: source.matchedTerm,
      matchMode: exact ? "exact-name" : "non-exact",
      url: source.url,
    });
  }
}

const verifiedEvidence = rows.flatMap((row) => {
  const source = getVerifiedWikiSupplement(row.serviceId);
  return source ? [{
    serviceId: row.serviceId,
    name: row.name,
    tier: "verified-official-web",
    title: source.sourceTitle,
    matchedTerm: row.serviceId,
    matchMode: "exact-service-id",
    url: source.url,
  }] : [];
});
const allSupplementEvidence = [...sourceEvidence, ...verifiedEvidence];
const nonExactMatches = allSupplementEvidence.filter((entry) =>
  entry.matchMode !== "exact-name" && entry.matchMode !== "exact-service-id",
);
const genericFallbacks = allSupplementEvidence.filter((entry) =>
  entry.tier === "press" || entry.matchMode === "non-exact",
);
const allowedSupplementHosts = new Set([
  "eminwon.brcn.go.kr",
  "gssw.or.kr",
  "paldal.suwon.go.kr",
  "seed.gb.go.kr",
  "www.hanam.go.kr",
  "www.bokjiro.go.kr",
  "www.gg.go.kr",
  "www.hira.or.kr",
  "m.gimpo.go.kr",
  "www.nhis.or.kr",
  "kbmaeil.com",
]);
const invalidVerifiedUrls = verifiedEvidence.filter((entry) =>
  !allowedSupplementHosts.has(new URL(entry.url).hostname),
);
const officialSourceMismatches = rows
  .filter((row) => !officialDocumentMatches(row))
  .map((row) => ({ serviceId: row.serviceId, name: row.name, detailUrl: row.detailUrl }));

const report = {
  sourceGeneratedAt: seed.generatedAt,
  auditedRows: rows.length,
  requiredFieldCoverage: {
    name: articles.filter((article) => article.name).length,
    overview: articles.filter((article) => article.overview).length,
    content: articles.filter((article) => article.content).length,
  },
  dashboardWikiConsistency: {
    comparedRows: rows.length,
    exactMatches: rows.length - displayMismatches.length,
    mismatches: displayMismatches.length,
    evidence: displayMismatches,
  },
  contentProvenance: {
    officialRows: articles.filter((article) => article.contentStatus === "official-row").length,
    verifiedSupplements: articles.filter((article) => article.contentStatus === "verified-supplement").length,
    unavailable: articles.filter((article) => article.contentStatus === "unavailable").length,
  },
  applicationConditions: {
    includedFromPublishedSupportCriteria: articles.filter((article) => article.applicationConditions).length,
    omittedBecauseNotPublished: articles.filter((article) => !article.applicationConditions).length,
  },
  officialSource: {
    linkedRows: rows.filter((row) => row.detailUrl).length,
    uniqueDocuments: new Set(rows.map((row) => row.detailUrl)).size,
    serviceDocumentIdentityMismatches: officialSourceMismatches.length,
    mismatchEvidence: officialSourceMismatches,
  },
  sourceMatching: {
    attachedSupplementRows: allSupplementEvidence.length,
    exactMatches: allSupplementEvidence.length - nonExactMatches.length,
    nonExactMatches: nonExactMatches.length,
    genericPressReleaseFallbacks: genericFallbacks.length,
    invalidVerifiedUrls: invalidVerifiedUrls.length,
    policy: "Bokjiro and Welfare Talk require exact normalized names; verified web supplements require exact service IDs and explicitly verified official or press-source hosts.",
    evidence: allSupplementEvidence,
  },
  verifiedWebSources: listVerifiedWikiSupplements().map((source) => ({
    serviceIds: source.serviceIds,
    title: source.sourceTitle,
    publisher: source.publisher,
    url: source.url,
    verifiedOn: source.verifiedOn,
  })),
  duplicateNameGroups: [...nameCounts.values()].filter((count) => count > 1).length,
  overviewLineBreakViolations: articles.filter((article) => /[\r\n]/.test(article.overview)).length,
};

assert.equal(report.requiredFieldCoverage.name, rows.length);
assert.equal(report.requiredFieldCoverage.overview, rows.length);
assert.equal(report.requiredFieldCoverage.content, rows.length);
assert.equal(report.dashboardWikiConsistency.mismatches, 0, JSON.stringify(displayMismatches));
assert.equal(report.contentProvenance.unavailable, 0);
assert.equal(report.officialSource.linkedRows, rows.length);
assert.equal(report.officialSource.serviceDocumentIdentityMismatches, 0);
assert.equal(report.sourceMatching.nonExactMatches, 0);
assert.equal(report.sourceMatching.genericPressReleaseFallbacks, 0);
assert.equal(report.sourceMatching.invalidVerifiedUrls, 0);
assert.equal(report.overviewLineBreakViolations, 0);

const output = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv.includes("--write")) {
  const outputUrl = new URL("../data/wiki-content-audit.json", import.meta.url);
  await writeFile(fileURLToPath(outputUrl), output, "utf8");
}
process.stdout.write(output);
