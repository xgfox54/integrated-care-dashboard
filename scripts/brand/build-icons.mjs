import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

// 사이트 아이콘을 원본(assets/brand/logo-source.png)에서 만든다.
// 원본은 배경을 제거한 통합돌봄 집·하트 로고다.
//   node scripts/brand/build-icons.mjs [원본 경로]
// - public/favicon.ico: 16·32·48px(브라우저 탭)
// - public/icon-192.png: 고해상도 화면용 투명 아이콘
// - public/apple-touch-icon.png: 휴대폰 홈 화면용 흰 바탕 아이콘
// - public/brand/logo-144.png: 상단 머리글 로고(화면에서 44px, 3배 화면까지 선명).
//   Sites 호스팅이 .webp를 image/webp로 보내지 않아 PNG로 둔다.

const root = process.cwd();
const source = path.resolve(process.argv[2] ?? "assets/brand/logo-source.png");
const out = (...parts) => path.join(root, "public", ...parts);

// 투명 여백을 걷어 내고 정사각형으로 맞춘 로고(여백 비율 margin).
async function squareLogo(margin) {
  const trimmed = await sharp(source).ensureAlpha().trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
  const side = Math.max(trimmed.info.width, trimmed.info.height);
  const canvas = Math.round(side * (1 + margin * 2));
  const left = Math.round((canvas - trimmed.info.width) / 2);
  const top = Math.round((canvas - trimmed.info.height) / 2);
  return sharp({ create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: trimmed.data, left, top }])
    .png()
    .toBuffer();
}

async function smallestPng(image) {
  const [palette, full] = await Promise.all([
    image.clone().png({ palette: true, quality: 92, effort: 10, dither: 1, compressionLevel: 9 }).toBuffer(),
    image.clone().png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 }).toBuffer(),
  ]);
  return palette.length < full.length ? palette : full;
}

async function resized(logo, size, background) {
  let image = sharp(logo).resize(size, size, { kernel: "lanczos3" });
  if (background) image = image.flatten({ background });
  return image;
}

function icoFile(pngs) {
  const header = Buffer.alloc(6 + pngs.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, index) => {
    const at = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, at);
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt8(0, at + 2);
    header.writeUInt8(0, at + 3);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(data.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map(({ data }) => data)]);
}

const tight = await squareLogo(0.02);
const standard = await squareLogo(0.04);
const ico = [];
for (const size of [16, 32, 48]) ico.push({ size, data: await smallestPng(await resized(tight, size)) });
const favicon = icoFile(ico);
writeFileSync(out("favicon.ico"), favicon);
writeFileSync(out("favicon-care-1c125a41.ico"), favicon);
writeFileSync(out("icon-192.png"), await smallestPng(await resized(standard, 192)));

writeFileSync(out("apple-touch-icon.png"), await smallestPng(await resized(standard, 180, { r: 255, g: 255, b: 255 })));

mkdirSync(out("brand"), { recursive: true });
writeFileSync(out("brand", "logo-144.png"), await smallestPng(await resized(standard, 144)));

const shareLogo = await sharp(standard).resize(480, 480).png().toBuffer();
const shareImage = sharp({ create: { width: 1200, height: 630, channels: 3, background: { r: 255, g: 255, b: 255 } } })
  .composite([{ input: shareLogo, left: 360, top: 75 }]);
writeFileSync(out("brand", "share-care-house-heart-v1.png"), await smallestPng(shareImage));

for (const file of ["favicon.ico", "favicon-care-1c125a41.ico", "icon-192.png", "apple-touch-icon.png", "brand/logo-144.png", "brand/share-care-house-heart-v1.png"]) {
  console.log(file, statSync(out(file)).size + " bytes");
}
