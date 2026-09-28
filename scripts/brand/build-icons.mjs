import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

// 사이트 아이콘을 원본(assets/brand/logo-source.png)에서 만든다.
// 원본은 투명 바탕 위에 흰 둥근 판과 그림이 있는 앱 아이콘(192px)이다.
//   node scripts/brand/build-icons.mjs [원본 경로]
// - public/favicon.ico: 16·32·48px(브라우저 탭)
// - public/icon-192.png: 고해상도 화면용 아이콘(원본이 192px이면 다시 그리지 않고 압축만 한다)
// - public/apple-touch-icon.png: 휴대폰 홈 화면. iOS가 모서리를 직접 둥글게 자르고 투명 부분을 검게 채우므로,
//   흰 판을 네모 끝까지 판 색으로 채운다.
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

/** 흰 판(불투명 부분)만 잘라 판 색으로 채운 정사각형. 판 가장자리의 반투명 테두리는 1px 안쪽으로 들여 자른다. */
async function filledTile() {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => (y * info.width + x) * 4;
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[at(x, y) + 3] < 250) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  const inset = 1;
  const left = x0 + inset, top = y0 + inset;
  const width = x1 - x0 + 1 - inset * 2, height = y1 - y0 + 1 - inset * 2;
  // 판 색: 위쪽 가운데 가장자리 바로 안쪽
  const probe = at(Math.round((x0 + x1) / 2), y0 + 3);
  const background = { r: data[probe], g: data[probe + 1], b: data[probe + 2] };
  const side = Math.max(width, height);
  const cropped = await sharp(source).extract({ left, top, width, height }).flatten({ background }).png().toBuffer();
  return sharp(cropped)
    .extend({
      top: Math.floor((side - height) / 2),
      bottom: Math.ceil((side - height) / 2),
      left: Math.floor((side - width) / 2),
      right: Math.ceil((side - width) / 2),
      background: { ...background, alpha: 1 },
    })
    .png()
    .toBuffer();
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
const ico = [];
for (const size of [16, 32, 48]) ico.push({ size, data: await smallestPng(await resized(tight, size)) });
writeFileSync(out("favicon.ico"), icoFile(ico));
const meta = await sharp(source).metadata();
writeFileSync(
  out("icon-192.png"),
  await smallestPng(meta.width === 192 && meta.height === 192 ? sharp(source) : await resized(tight, 192)),
);

writeFileSync(out("apple-touch-icon.png"), await smallestPng(await resized(await filledTile(), 180, { r: 255, g: 255, b: 255 })));

mkdirSync(out("brand"), { recursive: true });
writeFileSync(out("brand", "logo-144.png"), await smallestPng(await resized(await squareLogo(0), 144)));

for (const file of ["favicon.ico", "icon-192.png", "apple-touch-icon.png", "brand/logo-144.png"]) {
  console.log(file, statSync(out(file)).size + " bytes");
}
