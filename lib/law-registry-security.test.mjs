import assert from "node:assert/strict";
import test from "node:test";
import { createReadOnlyRegistry } from "./law/registry.ts";
import { getExecutableLawToolNames, runLawTool, LAW_TOOL_NAMES, LAW_WEB_TOOL_NAMES } from "./law/mcp-tools.ts";
import { LawApiClient } from "korean-law-mcp/lib/api-client";

const response = {content:[{type:"text",text:"ok"}]};
function entry(name, events) {return {name,description:"조례 조회",schema:{parse(input){events.push("parse");if(typeof input.query!=="string")throw Error("invalid");return input;}},handler:async()=>{events.push("execute");return response;}};}

test("A1: discovery and execution use exactly the same registry",async()=>{
 const events=[];const registry=createReadOnlyRegistry([entry("search_ordinance",events)]);
 assert.match(registry.discover("조례"),/search_ordinance/);assert.doesNotMatch(registry.discover("조례"),/chain_ordinance_compare/);
 assert.equal(await registry.execute({},"search_ordinance",{query:"제주"}),response);assert.deepEqual(events,["parse","execute"]);
 assert.equal(Object.isFrozen(registry.names),true);
});
test("A1: schema rejection happens before dispatch",async()=>{
 const events=[];const registry=createReadOnlyRegistry([entry("search_ordinance",events)]);
 await assert.rejects(registry.execute({},"search_ordinance",{query:[]}));assert.deepEqual(events,["parse"]);
});
test("A1: unregistered, duplicate and recursive tools fail closed",async()=>{
 const events=[];const registry=createReadOnlyRegistry([entry("search_ordinance",events)]);
 await assert.rejects(registry.execute({},"not_registered",{}));
 await assert.rejects(registry.execute({},"execute_tool",{}));
 await assert.rejects(registry.execute({},"discover_tools",{}));
 assert.deepEqual(events,[]);
 assert.throws(()=>createReadOnlyRegistry([entry("search_ordinance",events),entry("search_ordinance",events)]));
});
test("A1: actual catalog has approved specialized tools without expanding public/web scope",async()=>{
 const names=getExecutableLawToolNames();assert.equal(names.length,16);assert.equal(LAW_TOOL_NAMES.length,10);assert.equal(LAW_WEB_TOOL_NAMES.length,8);
 for(const name of ["search_ordinance","get_ordinance","search_admin_rule","get_admin_rule","get_batch_articles","get_three_tier","compare_old_new","search_law_bulk"])assert.ok(names.includes(name),name);
 // 운영본은 모든 법령 도구 실행 전에 서버 LAW_OC를 요구한다. 탐색은 네트워크를 쓰지 않으므로 합성 키로 목록만 확인한다.
 const result=await runLawTool("discover_tools",{intent:"search_ordinance get_ordinance 조례"},{apiKey:"SYNTHETIC_NOT_A_REAL_KEY"});
 const text=result.content.map(item=>item.text).join("\n");
 assert.match(text,/search_ordinance/);assert.match(text,/get_ordinance/);assert.doesNotMatch(text,/chain_ordinance_compare|설명 없음/);
 for(const match of text.matchAll(/^- ([a-z_]+):/gm))assert.ok(names.includes(match[1]),match[1]);
});
test("A1: actual specialized dispatch reaches the pinned engine after schema validation",async()=>{
 const original=LawApiClient.prototype.searchOrdinance;let calls=0;
 LawApiClient.prototype.searchOrdinance=async function(){calls++;throw new Error("LOCAL_UPSTREAM_SENTINEL");};
 try {
  const result=await runLawTool("execute_tool",{tool_name:"search_ordinance",params:{query:"제주",display:1}},{apiKey:"SYNTHETIC_NOT_A_REAL_KEY"});
  assert.ok(calls>0);assert.doesNotMatch(result.content.map(x=>x.text).join("\n"),/도구를 찾을 수 없습니다|등록되지 않은/);
 } finally {LawApiClient.prototype.searchOrdinance=original;}
});
test("A1: meta recursion, size and invalid inputs are rejected without fetching",async()=>{
 const original=globalThis.fetch;let fetches=0;globalThis.fetch=async()=>{fetches++;throw Error("unexpected network");};
 try {
  for(const input of [{tool_name:"execute_tool",params:{}},{tool_name:"discover_tools",params:{}},{tool_name:"search_ordinance",params:{query:[]}},{tool_name:"search_ordinance",params:{query:"a".repeat(51000)}}]) {
   const result=await runLawTool("execute_tool",input);assert.equal(result.isError,true);
  }
  assert.equal(fetches,0);
 } finally {globalThis.fetch=original;}
});
