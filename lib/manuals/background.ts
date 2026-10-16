// Only the deployment-pinned corpus may be advanced. No request body, URL,
// uploaded manifest, user credential or MCP argument reaches the importer.
import { flagEnabled } from "../platform/flags.ts";
import { advanceManualCorpus } from "./store.ts";
import { MANUAL_CORPUS_MANIFEST } from "./manifest.ts";
import { createEncryptedManualAssetLoader, type EncryptedManualAssetsManifest } from "./assets.ts";
import encryptedManifest from "../../data/manual-corpus/encrypted-assets.json" with { type: "json" };

let running = false;
let lastAttemptAt = 0;
let completedRevision: string | null = null;

export async function advanceBundledManuals(env: Cloudflare.Env): Promise<void> {
  if (!env.DB || !env.ASSETS || !env.MANUAL_CORPUS_KEY || running || completedRevision === MANUAL_CORPUS_MANIFEST.revision) return;
  const now = Date.now();
  if (now - lastAttemptAt < 750) return;
  lastAttemptAt = now;
  running = true;
  try {
    const loadAsset = createEncryptedManualAssetLoader(env.ASSETS, env.MANUAL_CORPUS_KEY,
      MANUAL_CORPUS_MANIFEST, encryptedManifest as EncryptedManualAssetsManifest);
    const result = await advanceManualCorpus(env.DB, loadAsset, MANUAL_CORPUS_MANIFEST, { maxMillis: 12_000, leaseSeconds: 30 });
    if (result.status === "FAILED") throw new Error(result.error_code ?? "MANUAL_IMPORT_FAILED");
    if (result.status === "ACTIVE") {
      if (flagEnabled("RELEASE_BUNDLE_ENABLED")) {
        const { ensureActiveBundle } = await import("../platform/bundle.ts");
        await ensureActiveBundle(env.DB, Math.floor(Date.now() / 1000));
      }
      completedRevision = result.revision;
    }
    if (result.status === "SUPERSEDED") completedRevision = result.revision;
  } finally {
    running = false;
  }
}
