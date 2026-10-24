import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import fastGlob from "fast-glob";
import { createRequire } from "node:module";

test("replacement supports build extension globs and Next root directory lookup", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dashboard-glob-"));
  try {
    mkdirSync(path.join(directory, "pages", "nested"), { recursive: true });
    for (const file of ["pages/a.ts", "pages/b.js", "pages/c.txt", "pages/nested/index.ts"]) {
      writeFileSync(path.join(directory, file), "");
    }
    const patterns = ["pages/*.{ts,js}", "pages/*/index.{ts,js}"];
    const expected = ["pages/a.ts", "pages/b.js", "pages/nested/index.ts"];
    assert.deepEqual(fastGlob.sync(patterns, { cwd: directory }).sort(), expected);
    assert.deepEqual((await fastGlob(patterns, { cwd: directory })).sort(), expected);
    const { getRootDirs } = createRequire(import.meta.url)("@next/eslint-plugin-next/dist/utils/get-root-dirs.js");
    const rootPattern = path.join(directory, "pages", "*").replaceAll("\\", "/");
    assert.deepEqual(getRootDirs({ cwd: directory, settings: { next: { rootDir: rootPattern } } }), [path.join(directory, "pages", "nested").replaceAll("\\", "/")]);
    assert.deepEqual(fastGlob.sync("pages", { cwd: directory }), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
