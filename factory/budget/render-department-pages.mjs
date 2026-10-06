import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(new URL("../hwp-parser/package.json", import.meta.url));
const { PDFiumLibrary } = require("@hyzyla/pdfium");
const sharp = require("sharp");
const root = path.resolve(process.argv[2]);
const report = JSON.parse(readFileSync(path.join(root, "matches.json")));
const codes = ["1105010", "1105040", "1105050", ...Array.from({ length: 4 }, (_, i) => String(2105070 + i * 10)), ...Array.from({ length: 9 }, (_, i) => String(3015070 + i * 10))];
const absent = codes.filter((code) => !report.mappings.some((m) => m.department_code === code));
const targets = codes.filter((code) => !absent.includes(code)).map((code) => { const match = report.mappings.find((m) => m.department_code === code); const d = match.evidence[0].document; return { code, previous_name: match.department_name, volume: d.volume, page: d.page }; });
const out = path.join(root, "p1-visual"); mkdirSync(out, { recursive: true });
const library = await PDFiumLibrary.init(), images = [];
try {
  for (const volume of [1, 2]) {
    const doc = await library.loadDocument(readFileSync(path.join(root, "raw", `jeju-2026-volume-${volume}.pdf`)));
    for (const target of targets.filter((t) => t.volume === volume)) {
      const rendered = await doc.getPage(target.page - 1).render({ scale: 1.5, render: async ({ data, width, height }) => sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer() });
      const file = `${target.code}-v${volume}-p${target.page}.png`;
      writeFileSync(path.join(out, file), Buffer.from(rendered.data));
      const label = Buffer.from(`<svg width="900" height="30"><rect width="100%" height="100%" fill="white"/><text x="10" y="22" font-size="18">${target.code} / volume ${volume} / PDF page ${target.page}</text></svg>`);
      const top = await sharp(rendered.data).extract({ left: 0, top: 0, width: 850, height: 150 }).extend({ top: 30, bottom: 0, left: 0, right: 50, background: "white" }).composite([{ input: label, top: 0, left: 0 }]).png().toBuffer();
      images.push(top); target.image = file;
    }
    doc.destroy();
  }
  const contact = await sharp({ create: { width: 900, height: images.length * 180, channels: 4, background: "white" } }).composite(images.map((input, i) => ({ input, left: 0, top: i * 180 }))).png().toBuffer();
  writeFileSync(path.join(out, "headers.png"), contact);
  writeFileSync(path.join(out, "targets.json"), JSON.stringify(targets, null, 2));
  console.log(JSON.stringify({ rendered: targets.length, absent_from_prior_mappings: absent, output: out }));
} finally { library.destroy(); }
