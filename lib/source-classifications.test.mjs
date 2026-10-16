import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restoreReviewedClassifications, reviewedClassificationOf } from './source-classifications.ts';
import { sourceRowCells } from '../scripts/data-quality/source-row-cells.mjs';
import { computeBuildVersions } from '../scripts/data-versions.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/mohw/classification-cells-20261015.json',import.meta.url),'utf8'));
const glyphApproved = new Set(JSON.parse(readFileSync(new URL('../docs/data-quality/classification-restorations-20261015.json',import.meta.url),'utf8')).rows.map(row=>row.service_id));
const pdfApproved = JSON.parse(readFileSync(new URL('../docs/data-quality/classification-restorations-20261015-v2.json',import.meta.url),'utf8')).rows;
const reviewed = JSON.parse(readFileSync(new URL('../data/source-classification-restorations.json',import.meta.url),'utf8'));

test('Given vertical headers and full names When source rows are located Then actual national and local cells remain distinct', () => {
 const fixture=fixtures['0077:1489748:1:1'];const result=sourceRowCells(fixture.page,fixture.services);
 assert.equal(result.rows.find(row=>row.service_id==='0077:1489748:1:1:1').fields.type,'국가');
 assert.equal(result.rows.find(row=>row.service_id==='0077:1489748:1:1:7').fields.type,'지자체');
 assert.equal(result.rows.find(row=>row.service_id==='0077:1489748:1:1:8').fields.type,'지자체');
 assert.equal(result.rows.find(row=>row.service_id==='0077:1489748:1:1:11').fields.type,'가지자체');
 assert.equal(glyphApproved.has('0077:1489748:1:1:11'),false);
 assert.ok(pdfApproved.some(row=>row.service_id==='0077:1489748:1:1:11'&&row.agreed));
});

test('Given wrapped source labels When original cells are read Then linked services are not truncated or replaced by national scope', () => {
 const fixture=fixtures['0080:1489581:1:2'];const result=sourceRowCells(fixture.page,fixture.services);
 const row=result.rows.find(row=>row.name==='일차의료 방문진료 수가시범사업(의과, 한의)');
 assert.equal(row.fields.sourceType,'연계서비스');
});

test('Given a reviewed source When its identity or existing value changes Then the review cannot overwrite the new source', () => {
 const [id,entry]=Object.entries(reviewed.rows).find(([,entry])=>entry.fields.type);
 const row={serviceId:id,name:entry.name,updatedDate:entry.updated_date,type:'미분류',subcategory:'기타'};
 assert.equal(restoreReviewedClassifications(row).type,entry.fields.type.value);
 for(const changed of [{...row,name:row.name+' 새 사업'},{...row,updatedDate:'2030-01'},{...row,serviceId:'unreviewed'},{...row,type:'광역'}]) assert.equal(restoreReviewedClassifications(changed),changed);
 assert.equal(reviewedClassificationOf({...row,name:'다른 사업'}),undefined);
});

test('Given a newly verified subcategory When applied Then it is preserved only for its exact source row', () => {
 const [id,entry]=Object.entries(reviewed.rows).find(([,entry])=>entry.fields.subcategory?.value==='구강');
 const row={serviceId:id,name:entry.name,updatedDate:entry.updated_date,type:'지역특화',subcategory:''};
 const after=restoreReviewedClassifications(row);
 assert.equal(after.subcategory,'구강');assert.equal(restoreReviewedClassifications(after),after);
 assert.equal(restoreReviewedClassifications({...row,serviceId:'other'}).subcategory,'');
});

test('Given only review data changes When fingerprints are built Then stale dataset and MCP caches are bypassed', t => {
 const root=mkdtempSync(join(tmpdir(),'classification-version-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'data'));
 const path=join(root,'data/source-classification-restorations.json');writeFileSync(path,'{"revision":"before"}');const before=computeBuildVersions(root);writeFileSync(path,'{"revision":"after"}');const after=computeBuildVersions(root);assert.notEqual(after.datasetCache,before.datasetCache);assert.notEqual(after.mcpCache,before.mcpCache);
});

test('Given an adjacent source name cannot be located When cell bounds are checked Then that row requires independent PDF evidence instead of glyph approval', () => {
 const fixture=fixtures['0077:1489748:1:1'];const complete=sourceRowCells(fixture.page,fixture.services);
 const selected=complete.rows.find(row=>row.verified_bounds && fixture.services.findIndex(s=>s.serviceId===row.service_id)<fixture.services.length-1);
 assert.ok(selected);const index=fixture.services.findIndex(s=>s.serviceId===selected.service_id);
 const incomplete=fixture.services.map((row,i)=>i===index+1?{...row,name:'원문에 없는 이웃 사업명'}:row);
 assert.equal(sourceRowCells(fixture.page,incomplete).rows.find(row=>row.service_id===selected.service_id).verified_bounds,false);
 assert.equal(glyphApproved.has('0076:1489560:1:3:2'),false);
 assert.ok(pdfApproved.some(row=>row.service_id==='0076:1489560:1:3:2'&&row.agreed));
});
