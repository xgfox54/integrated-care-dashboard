import assert from "node:assert/strict";
import test from "node:test";
import { handleLawHttpRequest } from "./law/http.ts";

const env={LAW_OC:"SYNTHETIC_NOT_A_REAL_KEY"};
const jsonRequest=(body,headers={})=>new Request("https://owned.test/api/law",{method:"POST",headers:{"content-type":"application/json",...headers},body});

test("web law handler rejects oversized streamed body before parsing",async()=>{
 let emitted=0,cancelled=false;
 const body=new ReadableStream({pull(c){if(emitted<12){emitted++;c.enqueue(new Uint8Array(16384).fill(32));}else c.close();},cancel(){cancelled=true;}});
 const response=await handleLawHttpRequest(new Request("https://owned.test/api/law",{method:"POST",headers:{"content-type":"application/json"},body,duplex:"half"}),env);
 assert.equal(response.status,413);assert.equal((await response.json()).error,"REQUEST_TOO_LARGE");assert.ok(emitted<12);assert.equal(cancelled,true);
});
test("web law handler checks observed bytes even with an understated length",async()=>{
 const response=await handleLawHttpRequest(jsonRequest('"'+"a".repeat(65536)+'"',{"content-length":"1"}),env);
 assert.equal(response.status,413);
});
for(const origin of ["https://untrusted.invalid","null"])test("web law handler rejects origin "+origin,async()=>{
 const response=await handleLawHttpRequest(jsonRequest("{}",{origin}),env);assert.equal(response.status,403);
});
for(const type of ["text/plain","application/json-ignored"])test("web law handler rejects media type "+type,async()=>{
 const response=await handleLawHttpRequest(jsonRequest("{}",{"content-type":type}),env);assert.equal(response.status,415);
});
test("web law handler preserves successful public status without secret disclosure",async()=>{
 const response=await handleLawHttpRequest(new Request("https://owned.test/api/law"),env);assert.equal(response.status,200);
 const text=await response.text();assert.doesNotMatch(text,/SYNTHETIC_NOT_A_REAL_KEY/);assert.equal(JSON.parse(text).configured,true);
});
test("web law handler rejects malformed JSON, invalid parameters and meta tool calls without network",async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error("unexpected fetch");};
 try {
  const malformed=await handleLawHttpRequest(jsonRequest("{"),env);assert.equal(malformed.status,400);
  const invalid=await handleLawHttpRequest(jsonRequest(JSON.stringify({tool:"search_law",args:{query:[]}})),env);assert.equal(invalid.status,422);
  const meta=await handleLawHttpRequest(jsonRequest(JSON.stringify({tool:"execute_tool",args:{tool_name:"search_ordinance",params:{query:"제주"}}})),env);assert.equal(meta.status,400);
  assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});
