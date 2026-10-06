// 정책브리핑(korea.kr, robots.txt Allow: /) 보건복지부 보도자료 첨부(HWP/HWPX/PDF) 표본 수집. 출처·해시를 manifest에 남긴다.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const OUT = "var/welfare-factory/raw/korea-kr";
const TARGET = Number(process.argv[2] ?? 30);
mkdirSync(OUT, { recursive: true });
const manifestPath = OUT + "/manifest.json";
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { source: "https://www.korea.kr/briefing/pressReleaseList.do", robots: "https://www.korea.kr/robots.txt (User-Agent: * Allow: /)", items: [] };
const UA = { "user-agent": "Mozilla/5.0 (compatible; welfare-dashboard-corpus; +https://integrated-care-national-dashboard.xgfox54.chatgpt.site/sources)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url) => { const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(r.status + " " + url); return r; };
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const seen = new Set(manifest.items.map((item) => item.news_id));
let docs = manifest.items.filter((item) => item.files.some((f) => /\.hwpx?$/i.test(f.file_name))).length;
for (let page = 1; page <= 80 && docs < TARGET; page += 1) {
  const html = await (await get("https://www.korea.kr/briefing/pressReleaseList.do?pageIndex=" + page)).text();
  await sleep(1000);
  const items = [...html.matchAll(/pressReleaseView\.do\?newsId=(\d+)[\s\S]*?<strong>([\s\S]*?)<\/strong>[\s\S]*?<span class="source">\s*<span>([\d.]+)<\/span>\s*<span>([^<]+)<\/span>/g)];
  for (const [, newsId, rawTitle, date, ministry] of items) {
    if (ministry.trim() !== "보건복지부" || seen.has(newsId)) continue;
    seen.add(newsId);
    const viewUrl = "https://www.korea.kr/briefing/pressReleaseView.do?newsId=" + newsId;
    const view = await (await get(viewUrl)).text();
    await sleep(1000);
    const links = [...new Map([...view.matchAll(/href="(\/common\/download\.do\?fileId=(\d+)&amp;tblKey=GMN)"/g)].map((m) => [m[2], decode(m[1])])).values()];
    const files = [];
    for (const link of links) {
      const response = await get("https://www.korea.kr" + link);
      await sleep(1000);
      const cd = response.headers.get("content-disposition") ?? "";
      const nameMatch = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      const fileName = nameMatch ? decodeURIComponent(nameMatch[1].replace(/\+/g, " ")) : link.split("=")[1];
      const ext = (fileName.match(/\.(hwpx|hwp|pdf|xlsx|xls|zip)$/i) || [""])[0].toLowerCase();
      if (!ext) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      const sha = createHash("sha256").update(bytes).digest("hex");
      const local = "kr-" + newsId + "-" + link.match(/fileId=(\d+)/)[1] + ext;
      writeFileSync(OUT + "/" + local, bytes);
      files.push({ file_name: fileName, local, url: "https://www.korea.kr" + link, sha256: sha, bytes: bytes.length });
    }
    manifest.items.push({ news_id: newsId, title: decode(rawTitle.trim()), ministry: ministry.trim(), date, view_url: viewUrl, retrieved_at: new Date().toISOString(), files });
    if (files.some((f) => /\.hwpx?$/i.test(f.local))) docs += 1;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
    console.log(docs, newsId, date, files.map((f) => f.local.split(".").pop()).join(","), decode(rawTitle.trim()).slice(0, 40));
    if (docs >= TARGET) break;
  }
}
console.log("done docs", docs);
