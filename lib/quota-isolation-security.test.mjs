import assert from "node:assert/strict";
import test from "node:test";
import { enforceApiRateLimit, apiRatePolicy, rateLimitFingerprint } from "./api-rate-limit.ts";
import { redactCredentialValue } from "./credential-redaction.ts";
function db(){const counts=new Map();return{prepare(){return{bind(key){return{async first(){const n=(counts.get(key)??0)+1;counts.set(key,n);return{request_count:n};}};}};}};}
const req=(ip="203.0.113.20",route="/mcp")=>new Request("https://owned.test"+route,{headers:{"cf-connecting-ip":ip}});
const subjectRoute="/claude/mcp";
const subjectReq=(ip)=>req(ip,subjectRoute);
test("verified account quota is independent of IP and cannot be reset by changing IP",async()=>{
 const data=db();const context={verifiedSubject:"subject-a"};const limit=apiRatePolicy(subjectRoute).subjectLimit;
 assert.ok(limit>=apiRatePolicy(subjectRoute).limit);
 for(let n=0;n<limit;n++)assert.equal(await enforceApiRateLimit(subjectReq("203.0.113.20"),data,1800000000,context),null);
 assert.equal((await enforceApiRateLimit(subjectReq("203.0.113.21"),data,1800000000,context)).status,429);
 assert.equal(await enforceApiRateLimit(subjectReq("203.0.113.22"),data,1800000000,{verifiedSubject:"subject-b"}),null);
});
test("anonymous MCP requests keep the IP quota and verified subjects still share an IP backstop",async()=>{
 const policy=apiRatePolicy("/mcp");
 const anon=db();
 for(let n=0;n<policy.limit;n++)assert.equal(await enforceApiRateLimit(req("203.0.113.30"),anon,1800000000),null);
 const blocked=await enforceApiRateLimit(req("203.0.113.30"),anon,1800000000);
 assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get("retry-after"))>=1&&Number(blocked.headers.get("retry-after"))<=policy.windowSeconds);
 const subjectPolicy=apiRatePolicy(subjectRoute);
 const cap=Math.min(subjectPolicy.backstopLimit,subjectPolicy.globalLimit);
 const shared=db();let allowed=0;
 for(let n=0;n<cap+5;n++){if(await enforceApiRateLimit(subjectReq("203.0.113.31"),shared,1800000000,{verifiedSubject:"user-"+n})===null)allowed++;}
 assert.equal(allowed,cap,"사용자 ID를 바꿔도 같은 IP 보호선과 경로 총량을 넘을 수 없다");
});
test("IPv6 canonicalization keeps equivalent IPs in one identity",async()=>{
 assert.equal(await rateLimitFingerprint(req("2001:db8::1")),await rateLimitFingerprint(req("2001:0db8:0000:0000:0000:0000:0000:0001")));
});
test("route trailing slash does not skip an existing rate policy",()=>{
 assert.deepEqual(apiRatePolicy("/mcp/"),apiRatePolicy("/mcp"));assert.deepEqual(apiRatePolicy("/api/law/"),apiRatePolicy("/api/law"));
});
test("quota database failure remains fail closed",async()=>{
 assert.equal((await enforceApiRateLimit(req(),undefined,1800000000)).status,503);
 assert.equal((await enforceApiRateLimit(req(),{prepare(){throw Error("unavailable");}},1800000000)).status,503);
});
test("redaction does not invoke getters or fail on cycles",()=>{
 let called=0;const obj={get token(){called++;return "SECRET";}};obj.self=obj;
 const safe=redactCredentialValue(obj);assert.equal(called,0);assert.doesNotMatch(JSON.stringify(safe),/SECRET/);assert.match(JSON.stringify(safe),/CIRCULAR/);
});
