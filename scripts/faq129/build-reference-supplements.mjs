import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { faq129Clarification } from '../../lib/mcp/faq129-clarifications.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
const root = new URL('../../', import.meta.url);
const original = JSON.parse(await readFile(new URL('data/faq129/faq129.json', root), 'utf8'));
const proofs = JSON.parse(await readFile(new URL('outputs/faq-reference-supplements-20261013/source-checks.json', root), 'utf8'));
const urls = {
  '921': 'https://www.socialservice.or.kr:444/user/htmlEditor/view2.do?p_sn=24',
  '12023': 'https://www.socialservice.or.kr:444/user/htmlEditor/view2.do?p_sn=39',
  '12339': 'https://www.law.go.kr/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=1014367307',
  '14003': 'https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1031828345',
  '14234': 'https://www.mohw.go.kr/menu.es?mid=a10711020100',
  '14303': 'https://www.mohw.go.kr/menu.es?mid=a10711020200',
  '16860': 'https://www.hira.or.kr/dummy.do?pgmid=HIRAA020020000003',
};
const items = ['921', '8131', '12023', '12339', '14003', '14234', '14303', '15339', '16860'].map(id => {
  const item = original.items.find(row => row.faq_id === id);
  if (!item) throw new Error('FAQ_NOT_FOUND:' + id);
  const clarification = faq129Clarification(id, hash(item.question + '\n' + item.answer));
  if (!clarification) throw new Error('FAQ_CLARIFICATION_HASH_MISMATCH:' + id);
  const source = proofs.items.find(row => row.url === urls[id]) ?? null;
  if (urls[id] && (!source || source.http_status !== 200 || !/^[a-f0-9]{64}$/.test(source.observed_html_sha256)
    || !clarification.sources.some(row => row.url === source.url))) throw new Error('VERIFIED_SOURCE_REQUIRED:' + id);
  return { id: 'FAQ129-' + id, question: item.question,
    original_question_sha256: hash(item.question), original_answer_sha256: hash(item.answer),
    disposition: id === '8131' ? 'EXCLUDED_BY_USER' : id === '15339' ? 'LOCAL_AUTHORITY_CONFIRMATION' : 'REFERENCE_GUIDANCE',
    disposition_basis: id === '8131' ? 'USER_REQUEST' : id === '15339' ? 'USER_REQUEST_AND_EXISTING_MANUAL_GUIDANCE' : 'OFFICIAL_SOURCE_REVIEW',
    handling_note: id === '8131' ? '사용자 요청에 따라 이번 검수에서 답변 불가·평가 제외로 기록한다. 원본 129 분류는 기초연금사업으로 복지 관련 질문이므로, 복지와 무관하다는 사실 판정이나 전역 MCP 거절 규칙으로 사용하지 않는다.'
      : id === '15339' ? '필요시 이용 가능하다는 공통 원칙을 설명하되, 개별 이용 여부는 해당 지자체 장애인복지 소관부서와 시설에 확인하도록 안내한다.' : null,
    supplied_source_url: id === '12339' ? 'https://www.law.go.kr/lsInfoP.do?lsId=007132&ancYnChk=0#0000' : urls[id] ?? null,
    source_observation: source, official_clarification: clarification, answer_correctness: 'NOT_EVALUATED' };
});
const registry = await readFile(new URL('lib/mcp/faq129-clarifications.ts', root));
const evidence = { schema_version: 'faq-reference-supplements-1', reviewed_at: proofs.checked_at,
  runtime_registry: { path: '../lib/mcp/faq129-clarifications.ts', sha256: hash(registry) },
  count: items.length, items, answer_correctness: 'NOT_EVALUATED', gpt_answer_calls: 0 };
await writeFile(new URL('quality/faq-reference-supplements-20261013.json', root), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ count: items.length, verified_sources: items.filter(item => item.source_observation).length }));
