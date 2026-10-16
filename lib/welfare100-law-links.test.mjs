import assert from 'node:assert/strict';
import test from 'node:test';
import { lawKind, lawUrl } from './welfare100/law-url.ts';
import { applyLegalLinkReviews } from '../scripts/welfare100/legal-link-reviews.mjs';

test('quoted national names and municipal enforcement rules retain their document kind', () => {
  assert.equal(lawKind('「아동복지법」'), '법률');
  assert.equal(decodeURIComponent(lawUrl('「모자보건법」')), 'https://www.law.go.kr/법령/모자보건법');
  assert.equal(decodeURIComponent(lawUrl('포천시 장애인복지증진을 위한 기본 조례 시행규칙')), 'https://www.law.go.kr/자치법규/포천시장애인복지증진을위한기본조례시행규칙');
  assert.equal(lawKind('지방자치단체의 교육경비 보조에 관한 규정'), '대통령령');
});

test('a bundle cannot masquerade as a direct link to its first document', () => {
  for (const name of ['양양군 공공산후조리원 설치 및 운영 등에 관한 조례ㆍ시행규칙', '거창군 인구증가 지원조례 및 시행규칙', '서울특별시 조례, 부산광역시 조례']) assert.equal(lawUrl(name), null);
  assert.equal(lawUrl('장사 등에 관한 법령'), null);
});

test('unresolved article notation retains the original text without an asserted destination', () => {
  const [law] = applyLegalLinkReviews('WLF00004546', [{ name: '주거기본법', article: '제3조의 7', kind: '법률', url: 'https://www.law.go.kr/법령/주거기본법' }]);
  assert.equal(law.article, '제3조의 7');
  assert.equal(law.url, undefined);
  assert.ok(law.reviewNote);
});
