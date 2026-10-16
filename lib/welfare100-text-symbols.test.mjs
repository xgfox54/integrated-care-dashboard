import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { replacePrivateSymbols } from './text-symbols.mjs';

test('기호 글꼴 글머리는 일반 기호로 바꾸고 복지제도 데이터에 남기지 않는다', () => {
  assert.equal(replacePrivateSymbols('\uF06D 저소득 중장년\n\uF0FC 제외'), '○ 저소득 중장년\n√ 제외');
  assert.equal(replacePrivateSymbols('\uE123가'), '•가');
  const dir = new URL('../public/data/welfare100/', import.meta.url);
  const files = [...fs.readdirSync(new URL('items/', dir)).map((name) => new URL('items/' + name, dir)), new URL('index.json', dir), new URL('index-lite.json', dir), new URL('index-extra.json', dir)];
  assert.deepEqual(files.filter((file) => /[\uE000-\uF8FF]/u.test(fs.readFileSync(file, 'utf8'))).map(String), []);
});


test('대시보드 사업 행과 매뉴얼 본문 요약도 기호 글꼴 글머리를 일반 기호로 바꾼다', async () => {
  const { normalizeRows } = await import('./dataset.ts');
  const { manualPlainText } = await import('./manuals/plain-text.ts');
  const [row] = normalizeRows([{ 사업명: '치매 예방', 사업내용: '\uF06D 치매선별검사 실시', 지원대상: '\uF0A7 65세 이상' }]);
  assert.equal(row.description, '○ 치매선별검사 실시');
  assert.equal(row.target, '▪ 65세 이상');
  assert.equal(manualPlainText('\uF104 지원대상 \uF011 소득기준'), '▪ 지원대상 · 소득기준');
  assert.doesNotMatch(fs.readFileSync(new URL('../public/data/regions/jeonnam_gwangju.json', import.meta.url), 'utf8'), /[\uE000-\uF8FF]/u);
});

