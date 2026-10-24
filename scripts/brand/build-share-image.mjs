import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = new URL("../../", import.meta.url);
const logo = await sharp(fileURLToPath(new URL("assets/brand/logo-source.png", root)))
  .trim({ threshold: 1 })
  .resize(200, 200, { fit: "inside" })
  .png()
  .toBuffer();
const output = new URL("public/brand/share-dashboard-v2.png", root);
await sharp(readFileSync(new URL("assets/brand/share-dashboard-v2.svg", root)))
  .composite([{ input: logo, left: 936, top: 88 }])
  .png({ compressionLevel: 9 })
  .toFile(fileURLToPath(output));
console.log(`Share cover: 1200x630 PNG, ${statSync(output).size} bytes`);
