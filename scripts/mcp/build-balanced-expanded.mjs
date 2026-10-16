import { readFile, writeFile } from 'node:fs/promises';
import { CASES as previous } from './evaluate-balanced-search.mjs';
import { createHash } from 'node:crypto';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const root = process.cwd();
const probes = await read(process.argv[2]);
const old = await read('quality/mcp-eval-v2-20261014.json');
const faq = await read('data/faq129/faq129.json');
const verifications = await read('data/manual-table-verifications.json');
const rows = structuredClone(previous);
const add = (tool, args, expect, source) => rows.push({ id: 'EXP-' + String(rows.length + 1).padStart(3, '0'), tool, args, expect, source_basis: source });
const positive = title => ({ nonempty: true, title });
const JEJU = 'region:제주특별자치도', SGW = JEJU + '|서귀포시', GANGNAM = 'region:서울특별시|강남구';
const fq = [['921', '청소년 산모 바우처를 언제까지 쓸 수 있나요?'], ['15439', '장애인 학대 신고의무자 교육에 휴직자와 파견직도 포함되나요?'], ['1016', '기저귀 조제분유 바우처가 만료됐는데 남은 포인트를 살릴 수 있나요?'], ['14238', '난임 시술비 신청 때 사실혼 부부는 진단서가 없어도 되나요?'], ['918', '청소년산모 의료비는 소득 제한이 있고 몇 살까지 받을 수 있나요?'], ['14959', '65세 이상 어르신이 의원에서 외래진료를 받으면 얼마를 부담하나요?'], ['1588', '생계급여를 받고 있는데 기초연금 소득 계산에 그 돈도 들어가나요?'], ['11414', '장애인등록증만 있으면 다른 도시에서도 지하철 요금을 안 내나요?'], ['18122', '췌장장애 등록을 위해 병원을 옮겼는데 이전 검사도 인정되나요?'], ['15940', '수급자가 발달장애인 긴급돌봄을 이용하면 이용료와 식비가 모두 무료인가요?'], ['18364', '장애인연금 받던 사람이 교정시설에 들어가면 지급이 중단되나요?'], ['1589', '국민연금을 받는 사람도 기초연금을 같이 받을 수 있나요?'], ['7170', '혼인신고한 지 1년이 안 됐는데 난임시술 지원이 가능한가요?'], ['7115', '가사간병 서비스 지원중지 통보에 불복하려면 언제까지 이의신청하나요?'], ['4896', '장애인 보조기기 교부는 장애 종류에 따라 받을 수 있는 품목이 다른가요?']];
for (const [id, query] of fq) {
    const source = faq.items.find(f => f.faq_id === id);
    const quotes = source.answer.split(/\n\s*\n/).map(x => x.trim()).filter(x => x && !/보건복지상담센터.*129/.test(x));
    add('search_faq', { query, limit: 5 }, { nonempty: true, ids: ['faq129:' + id], sourceQuotes: quotes, writtenDate: source.written_date }, { file: 'data/faq129/faq129.json', faq_id: id, source_url: source.url });
}
const mq = [
    ['부모급여 0세 어린이집 보육료 지원액과 차액은 얼마인가요?', '4702d0d2b9386659599d'],
    ['부모급여 1세 아이가 0세반을 다니면 차액은 얼마인가요?', '4702d0d2b9386659599d'],
    ['부모급여 영아종일제 아이돌봄서비스 시간당 이용금액은 얼마인가요?', 'd1b043d899bfdc1c96fd'],
    ['부모급여 출생 후 60일 신청기한이 공휴일이면 어떻게 되나요?', 'd027007c2ecf0d933d93'],
    ['첫만남이용권 첫째와 둘째의 지원금액이 다른가요?', '5ea82719033ccc6a0d09'],
    ['첫만남이용권 바우처 사용기간은 출생일 기준 언제까지인가요?', '5ea82719033ccc6a0d09'],
    ['첫만남이용권 디딤씨앗통장으로 현금 지급할 때 출생순위에 따라 금액이 달라지나요?', '2e91849af280f54473cf'],
    ['장애인연금 기초급여는 65세가 되는 달에도 지급하나요?', '33140b908bf22b533e23'],
    ['장애인연금 2026년 부가급여는 나이와 수급자 유형에 따라 어떻게 다른가요?', '5cbbf1de7201eca52c97'],
    ['장애인연금 2026년 부부가 모두 받을 때 기초급여는 각각 얼마인가요?', '376468842fe1c94ff34c'],
    ['노인맞춤돌봄서비스 65세 미만도 예외로 신청할 수 있나요?', '3b9a27707bd9a0caf9eb'],
    ['노인맞춤돌봄서비스 장기요양 등급을 포기한 경우에도 예외가 있나요?', '0c83df12796c759f4122'],
    ['노인맞춤돌봄서비스 배우자가 장기요양을 받는 경우 신청 가능한가요?', '1107feeb317441721f38'],
    ['노인맞춤돌봄서비스 직역연금 수급자의 예외 신청 조건은 무엇인가요?', '1107feeb317441721f38'],
    ['첫만남이용권 사용기간 2026년 출생아는 2년인지 1년인지 알려줘', '6fd750f41af9c0b7c4ac']
];
for (const [query, section] of mq) {
    const verified = verifications.find(v => v.section_id === section);
    const doc = verified?.document_id ?? 'md-0d5cde1744ecb603eec8';
    add('search_manuals', { query, limit: 5 }, { nonempty: true, manualDocument: doc, sourceYear: '2026', sectionIds: section === '4702d0d2b9386659599d' && query.includes('0세 어린이집') ? [section, 'f4d0e844bd8f0d90ff6d'] : [section], detailCheck: 'manual_source' }, { file: 'data/manual-table-verifications.json', section_id: section });
}
for (const c of old.cases.filter(c => c.tool === 'find_programs').slice(0, 15))
    add(c.tool, c.args, { ...positive(c.gold.title), resultRegion: c.args.region_id }, { service_id: c.gold.service_id, file: 'data/mohw-seed.json' });
for (const c of old.cases.filter(c => c.domain === '복지제도100'))
    add(c.tool, c.args, positive(c.gold.title), { file: 'data/welfare100', title: c.gold.title });
for (const c of old.cases.filter(c => c.domain === '복지통계'))
    add(c.tool, c.args, { nonempty: true, datasetId: c.gold.statistics_id, periods: c.gold.periods, unit: c.gold.unit, detailCheck: 'statistic' }, { dataset_id: c.gold.statistics_id, snapshot_date: '2026-10-14' });
const nq = [...old.cases.filter(c => c.domain === '공식 보도자료').filter(c => !['통합돌봄', '노인 맞춤 돌봄'].includes(c.args.query)).map(c => [c.args, c.gold.title_contains]), [{ query: '아동', date_from: '2026-10-01', date_to: '2026-10-15', limit: 10 }, '아동'], [{ query: '장애인', date_from: '2026-09-01', date_to: '2026-10-15', limit: 10 }, '장애인'], [{ query: '요양', limit: 10 }, '요양'], [{ query: '주거', limit: 10 }, '주거'], [{ query: '건강', limit: 10 }, '건강'], [{ query: '돌봄', region_ids: [SGW], date_from: '2026-01-01', limit: 10 }, '돌봄'], [{ query: '복지', region_ids: ['region:서울특별시'], limit: 10 }, '복지']];
for (const [args, title] of nq)
    add('search_news', args, { ...positive(title), newsContract: true }, { source: '공식 보도자료 제목·발행기관·게시일' });
const fiscal = probes.find(p => p.name === 'find_budget_projects').response.result.structuredContent.data.items;
for (const item of fiscal)
    for (const query of [item.name, item.name.replace(/사업|서비스|\(성인지예산\)/g, '').trim()])
        add('find_budget_projects', { fiscal_year: 2026, mode: 'integrated_care', region_id: JEJU, query, limit: 10 }, { nonempty: true, ids: [item.fiscal_project_id], safeAmounts: true, fiscalYear: 2026 }, { source: '공개 재정 원천 스냅샷', fiscal_project_id: item.fiscal_project_id });
for (const year of [2024, 2025, 2027, 2028, 2031])
    add('find_budget_projects', { fiscal_year: year, mode: 'integrated_care', region_id: JEJU, limit: 5 }, year === 2025 ? { empty: true, status: 'NO_MATCHES', reasonCode: 'NO_MATCHING_PROJECTS_IN_PUBLISHED_SCOPE' } : { unavailable: true }, { source: year === 2025 ? '2025 회계연도 공개 스냅샷에서 해당 지역·통합돌봄 조건에 일치하는 사업 없음' : '수집되지 않은 회계연도는 금액 추정 금지' });
const budget = probes.find(p => p.name === 'search_budget_lines').response.result.structuredContent.data.items;
for (const item of budget)
    add('search_budget_lines', { fiscal_year: 2026, issuer_sigungu: '금정구', query: item.name, limit: 5 }, { nonempty: true, ids: [item.budget_line_id], amountKRW: item.amount_krw, documentRevision: item.document_revision_id }, { source: '승인된 예산서 원문 행', budget_line_id: item.budget_line_id });
const institutions = probes.find(p => p.name === 'find_care_institutions').response.result.structuredContent.data.items;
for (const item of institutions.slice(4, 19))
    add('find_care_institutions', { region_id: GANGNAM, query: item.name.replace(/[()'\"]/g, '').replace(/^A/, '').trim(), service_group: item.service_types[0].group, limit: 10 }, { nonempty: true, ids: [item.institution_id], institutionContract: true }, { source: '공개 장기요양기관 목록', institution_id: item.institution_id });
const sq = [
    ['서귀포 온정가게 지원대상과 지원내용', { nonempty: true, region: SGW, title: '온정가게' }],
    ['부모급여 신청 서류와 지급금액', { nonempty: true, title: '부모급여', facts: ['document', 'amount'] }],
    ['장애인연금 신청 대상과 소득 재산 기준', { nonempty: true, title: '장애인연금' }],
    ['노인맞춤돌봄서비스 신청 방법', { nonempty: true, title: '노인맞춤돌봄' }],
    ['2026년 첫만남이용권 사용기간', { nonempty: true, title: '첫만남' }],
    ['국민연금 받으면 기초연금도 가능한가요', { nonempty: true, title: '기초연금' }],
    ['기저귀 조제분유 바우처 소멸 후 복구 가능한가요', { nonempty: true, title: '기저귀' }],
    ['발달장애인 긴급돌봄 수급자 식비', { nonempty: true, title: '긴급돌봄' }],
    ['서귀포시 100세 장수축하금', { nonempty: true, title: '장수축하금', region: SGW }],
    ['서귀포시 청년 취업준비 응시료 지원', { nonempty: true, title: '취업', region: SGW }],
    ['제주 서귀포시 복지사업 알려줘', { nonempty: true, region: SGW }],
    ['서울 강남구 노인 돌봄 사업', { nonempty: true, region: GANGNAM }],
    ['2026년 생계급여 4인 가구 선정기준', { nonempty: true, title: '국민기초생활' }],
    ['2025년 자료는 제외하고 2026년 기초연금 신청서류', { nonempty: true, title: '기초연금', absentTitle: '2025년 기초연금' }],
    ['2031년 부모급여 지원금액 확정액', { unsupported: true, reason: 'YEAR_' }]
];
for (const [query, expect] of sq)
    add('search', { query }, expect, { source: '의역·복합조건·지역·연도 회귀 사례' });
const counts = {};
for (const r of rows)
    counts[r.tool] = (counts[r.tool] ?? 0) + 1;
if (Object.values(counts).some(n => n !== 20))
    throw new Error(JSON.stringify(counts));
const cases = rows.sort((a, b) => a.tool.localeCompare(b.tool)).map((r, i) => ({ ...r, id: 'BAL2-' + String(i + 1).padStart(3, '0') }));
const suite = { version: 'balanced-search-20261015-v2', created_at: '2026-10-15', tools: 10, per_tool: 20, case_count: cases.length, final_answer_accuracy: 'NOT_EVALUATED', ground_truth_note: '원천 FAQ·매뉴얼·승인된 자료 식별자를 기준으로 검색 및 반환 계약을 검증한다. 웹 GPT 또는 다른 생성 모델을 호출하지 않는다. 데이터의 현행성·모든 사실의 진위나 실제 AI 답변 정확도를 측정하는 시험은 아니다.', cases };
suite.cases_sha256 = createHash('sha256').update(JSON.stringify(cases)).digest('hex');
await writeFile('quality/balanced-search-20261015.json', JSON.stringify(suite, null, 2) + '\n');
console.log(counts);
