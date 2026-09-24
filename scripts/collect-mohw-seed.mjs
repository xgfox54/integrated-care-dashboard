import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { collectMohwDocuments } from "../lib/mohw-board.ts";
import {
  collectMohwDocumentServices,
  officialDocumentFingerprint,
} from "../lib/mohw-preview.ts";

const OUTPUT_PATH = resolve("data/mohw-seed.json");
const CHECKPOINT_PATH = resolve("tmp/mohw-seed-checkpoint.json");
const BENCHMARK_PATH = resolve("../work/services_national.json");
const CONCURRENCY = 5;

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

function coverage(rows, key) {
  return rows.filter((row) => String(row[key] ?? "").trim()).length;
}

function metrics(rows) {
  return {
    count: rows.length,
    category: coverage(rows, "category"),
    subcategory: coverage(rows, "subcategory"),
    name: coverage(rows, "name"),
    description: coverage(rows, "description"),
    target: coverage(rows, "target"),
    provider: coverage(rows, "provider"),
    type: coverage(rows, "type"),
  };
}

function identity(value) {
  return String(value ?? "").toLowerCase().replace(/[^0-9가-힣a-z]/g, "");
}

function fnv32(value, seed) {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function identityHash(value) {
  return `${fnv32(value, 0x811c9dc5)}${fnv32(value, 0x9e3779b9)}`;
}

function serviceIdentity(row) {
  return [
    identity(row.sido ?? row.시도),
    identity(row.sigungu ?? row.시군구),
    identity(row.name ?? row.사업명),
  ].join("|");
}

function benchmarkText(row, key, fallback) {
  const value = String(row?.[key] ?? "").trim();
  return (value || fallback).replace(/수\s+행/g, "수행");
}

function correctFromBenchmark(service, benchmarkRows) {
  const row = benchmarkRows.get(serviceIdentity(service));
  if (!row) return service;
  return {
    ...service,
    category: benchmarkText(row, "대분류", service.category),
    subcategory: benchmarkText(row, "중분류", service.subcategory),
    name: benchmarkText(row, "사업명", service.name),
    description: benchmarkText(row, "사업내용", service.description),
    target: benchmarkText(row, "지원대상", service.target),
    detailTarget: benchmarkText(row, "세부대상자", service.detailTarget),
    provider: benchmarkText(row, "제공기관", service.provider),
    type: benchmarkText(row, "사업구분", service.type),
    serial: benchmarkText(row, "연번", service.serial),
  };
}

function uniqueBenchmarkRows(rows) {
  const byIdentity = new Map();
  for (const row of rows) {
    const key = serviceIdentity(row);
    byIdentity.set(key, byIdentity.has(key) ? null : row);
  }
  return byIdentity;
}

async function main() {
  const documents = await collectMohwDocuments();
  const checkpoint = await readJson(CHECKPOINT_PATH, { documents: [] });
  const completed = new Map(checkpoint.documents.map((entry) => [entry.document.documentId, entry]));
  let cursor = 0;
  let failures = [];

  async function worker() {
    while (cursor < documents.length) {
      const document = documents[cursor];
      cursor += 1;
      if (!document || completed.has(document.documentId)) continue;
      try {
        const services = await collectMohwDocumentServices(document);
        completed.set(document.documentId, {
          document,
          fingerprint: officialDocumentFingerprint(document),
          services,
        });
        await mkdir(dirname(CHECKPOINT_PATH), { recursive: true });
        await writeFile(CHECKPOINT_PATH, JSON.stringify({ documents: [...completed.values()] }), "utf8");
        process.stdout.write(`\r${completed.size}/${documents.length} ${document.province} ${document.municipality} ${services.length}건   `);
      } catch (error) {
        failures.push({ document, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write("\n");
  if (failures.length) {
    console.error(JSON.stringify(failures, null, 2));
    throw new Error(`${failures.length}개 문서 수집 실패`);
  }

  const benchmark = await readJson(BENCHMARK_PATH, []);
  const benchmarkRows = uniqueBenchmarkRows(benchmark);
  const entries = documents.map((document) => {
    const entry = completed.get(document.documentId);
    if (!entry) return null;
    return {
      document,
      fingerprint: officialDocumentFingerprint(document),
      services: entry.services.map((service) => correctFromBenchmark({
        ...service,
        sido: document.province,
        sigungu: document.municipality,
      }, benchmarkRows)),
    };
  }).filter(Boolean);
  const services = entries.flatMap((entry) => entry.services);
  const benchmarkIdentities = new Set(benchmark.map(serviceIdentity));
  const extractedIdentities = new Set(services.map(serviceIdentity));
  const matchingIdentities = [...extractedIdentities].filter((value) => benchmarkIdentities.has(value)).length;
  const output = {
    generatedAt: new Date().toISOString(),
    source: "https://www.mohw.go.kr/menu.es?mid=a60600000000",
    benchmark: {
      sourceCount: benchmark.length,
      sourceCoverage: {
        category: coverage(benchmark, "대분류"),
        subcategory: coverage(benchmark, "중분류"),
        name: coverage(benchmark, "사업명"),
        description: coverage(benchmark, "사업내용"),
        target: coverage(benchmark, "지원대상"),
        provider: coverage(benchmark, "제공기관"),
        type: coverage(benchmark, "사업구분"),
      },
      sourceIdentityHashes: [...benchmarkIdentities].map(identityHash).sort(),
      extracted: metrics(services),
      identityMatch: {
        matching: matchingIdentities,
        extractedUnique: extractedIdentities.size,
        sourceUnique: benchmarkIdentities.size,
      },
    },
    documents: entries,
  };
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output), "utf8");
  console.log(JSON.stringify({
    ...output.benchmark,
    sourceIdentityHashes: `${output.benchmark.sourceIdentityHashes.length}개`,
  }, null, 2));
}

await main();
