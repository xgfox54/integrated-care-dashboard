import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { careInstitutions } from './integrations/public.ts';
test('긴 한글 기관명은 D1 LIKE 제한에 걸리지 않고 지역·유형과 리터럴 기호를 함께 검색한다', async () => {
    const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ['DB'] }));
    try {
        const d1 = await mf.getD1Database('DB');
        await d1.batch([
            d1.prepare('CREATE TABLE ltc_institution(admin_sym TEXT,admin_nm TEXT,designated_on TEXT,sigungu_code TEXT,presence TEXT,last_seen_at INTEGER,detail_status TEXT)'),
            d1.prepare('CREATE TABLE ltc_institution_service(admin_sym TEXT,admin_pttn_cd TEXT,presence TEXT)'),
            d1.prepare('CREATE TABLE ltc_service_type(code TEXT,name TEXT,code_pattern TEXT,service_group TEXT)'),
            d1.prepare("INSERT INTO ltc_service_type VALUES('C01','방문요양',NULL,'HOME_VISIT_CARE')"),
            d1.prepare('CREATE TABLE region_code(code_type TEXT,code TEXT,name TEXT,valid_from TEXT)'),
            d1.prepare("INSERT INTO ltc_institution VALUES('31168000287','(사)서울시각장애인선교회부설은빛사랑방문요양센터','2019-12-11','1168000000','PRESENT',1791000000,'NOT_COLLECTED')"),
            d1.prepare("INSERT INTO ltc_institution_service VALUES('31168000287','C01','PRESENT')"),
            d1.prepare("INSERT INTO region_code VALUES('LEGAL_DONG','1168000000','서울특별시 강남구','2000-01-01')")
        ]);
        const staticRows = sql => sql.includes('FROM ext_dataset') ? [{ dataset_key: 'nhis.ltc_search' }] : sql.includes('FROM ext_scope_state') ? [{ dataset_key: 'nhis.ltc_search', last_status: 'SUCCEEDED', last_success_at: 1791000000 }] : sql.includes('FROM ext_run') ? [] : sql.includes('FROM region_code_map') ? [{ code: '1168000000', relation: 'SAME' }] : null;
        const db = { prepare(sql) { const rows = staticRows(sql); if (rows === null)
                return d1.prepare(sql); return { bind() { return this; }, async all() { return { results: rows }; } }; } };
        const query = '사서울시각장애인선교회부설은빛사랑방문요양센터';
        const found = await careInstitutions(db, 'region:서울특별시|강남구', '2026-10-15', { query, group: 'HOME_VISIT_CARE', offset: 0, limit: 5 });
        assert.equal(found.total, 1);
        assert.equal(found.items[0].institution_id, 'ltc:31168000287');
        for (const excluded of [{ query: query + '%', group: 'HOME_VISIT_CARE' }, { query, group: 'RESIDENTIAL' }, { query: '은빛사랑 _', group: 'HOME_VISIT_CARE' }])
            assert.equal((await careInstitutions(db, 'region:서울특별시|강남구', '2026-10-15', { ...excluded, offset: 0, limit: 5 })).total, 0);
    }
    finally {
        await mf.dispose();
    }
});
