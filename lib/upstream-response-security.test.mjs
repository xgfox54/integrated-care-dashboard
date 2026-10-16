import assert from "node:assert/strict";
import test from "node:test";
import { fetchBoundedResponse } from "./upstream-response.ts";
import { secureResponse } from "./http-security.ts";
const url="https://example.invalid/page?serviceKey=SYNTHETIC_SECRET";
const options={maxBytes:128,timeoutMs:200};
const mock=response=>async()=>response;

test("upstream: valid split UTF-8 bytes and status/headers are preserved",async()=>{
 const bytes=new TextEncoder().encode("지원금액");let offset=0;
 const body=new ReadableStream({pull(c){if(offset<bytes.length)c.enqueue(bytes.slice(offset,++offset));else c.close();}});
 const result=await fetchBoundedResponse(url,options,mock(new Response(body,{status:206,headers:{"x-test":"yes"}})));
 assert.equal(await result.text(),"지원금액");assert.equal(result.status,206);assert.equal(result.headers.get("x-test"),"yes");
});
test("upstream: deadline continues after headers until body completion",async()=>{
 let cancelled=false;
 const body=new ReadableStream({cancel(){cancelled=true;}});
 await assert.rejects(fetchBoundedResponse(url,{...options,timeoutMs:20},mock(new Response(body))),e=>e.code==="UPSTREAM_TIMEOUT");
 assert.equal(cancelled,true);
});
test("upstream: header timeout does not wait for a transport ignoring abort",async()=>{
 await assert.rejects(fetchBoundedResponse(url,{...options,timeoutMs:20},()=>new Promise(()=>{})),e=>e.code==="UPSTREAM_TIMEOUT");
});
test("upstream: late response body is cancelled after header timeout",async()=>{
 let resolve,cancelled=false;
 const pending=fetchBoundedResponse(url,{...options,timeoutMs:20},()=>new Promise(r=>{resolve=r;}));
 await assert.rejects(pending,e=>e.code==="UPSTREAM_TIMEOUT");
 resolve(new Response(new ReadableStream({cancel(){cancelled=true;}})));
 await new Promise(r=>setTimeout(r,5));assert.equal(cancelled,true);
});
test("upstream: actual body bytes override understated content length",async()=>{
 let emitted=0,cancelled=false;
 const stream=new ReadableStream({pull(c){if(emitted++<12)c.enqueue(new Uint8Array(32));else c.close();},cancel(){cancelled=true;}});
 await assert.rejects(fetchBoundedResponse(url,options,mock(new Response(stream,{headers:{"content-length":"1"}}))),e=>e.code==="UPSTREAM_BODY_TOO_LARGE");
 assert.ok(emitted<12);assert.equal(cancelled,true);
});
test("upstream: oversized declared body is cancelled before consumption",async()=>{
 let cancelled=false;
 const response=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{"content-length":"1000"}});
 await assert.rejects(fetchBoundedResponse(url,options,mock(response)),e=>e.code==="UPSTREAM_BODY_TOO_LARGE");assert.equal(cancelled,true);
});
test("upstream: non-2xx metadata and body are not rewritten as success or zero",async()=>{
 const result=await fetchBoundedResponse(url,options,mock(new Response("denied",{status:429,headers:{"retry-after":"30"}})));
 assert.equal(result.status,429);assert.equal(result.headers.get("retry-after"),"30");assert.equal(await result.text(),"denied");
});
test("upstream: manual redirects and empty bodies are preserved",async()=>{
 let redirect;
 const result=await fetchBoundedResponse(url,options,async(_url,init)=>{redirect=init.redirect;return new Response(null,{status:302,headers:{location:"https://other.invalid/"}});});
 assert.equal(redirect,"manual");assert.equal(result.status,302);assert.equal(await result.text(),"");
});
test("upstream: pre-aborted call does not start a fetch",async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 await assert.rejects(fetchBoundedResponse(url,{...options,signal:controller.signal},async()=>{calls++;return new Response("ok");}),e=>e.code==="UPSTREAM_ABORTED");assert.equal(calls,0);
});
test("upstream: caller abort cancels a pending body",async()=>{
 const controller=new AbortController();let cancelled=false;
 const result=fetchBoundedResponse(url,{...options,signal:controller.signal},mock(new Response(new ReadableStream({cancel(){cancelled=true;}}))));
 await new Promise(r=>setTimeout(r,5));controller.abort();
 await assert.rejects(result,e=>e.code==="UPSTREAM_ABORTED");assert.equal(cancelled,true);
});
test("upstream: exception never includes upstream URL or response credentials",async()=>{
 await assert.rejects(fetchBoundedResponse(url,options,async()=>{throw Error(url);}),e=>{assert.doesNotMatch(e.message,/serviceKey|SYNTHETIC_SECRET|example.invalid/);return e.code==="UPSTREAM_READ_FAILED";});
});
test("upstream: successful completion clears deadline",async()=>{
 let signal;await fetchBoundedResponse(url,{...options,timeoutMs:20},async(_url,init)=>{signal=init.signal;return new Response("ok");});
 await new Promise(r=>setTimeout(r,30));assert.equal(signal.aborted,false);
});
test("upstream: invalid limits fail before external work",async()=>{
 for(const maxBytes of [0,-1,NaN,1.5])await assert.rejects(fetchBoundedResponse(url,{...options,maxBytes}),RangeError);
});
test("CSP: stronger candidate is report-only for HTML and preserves existing enforcement",async()=>{
 const response=secureResponse(new Response("<html>existing</html>",{headers:{"content-type":"text/html; charset=utf-8"}}));
 assert.match(response.headers.get("content-security-policy"),/script-src 'self' 'unsafe-inline'/);
 const candidate=response.headers.get("content-security-policy-report-only");assert.match(candidate,/script-src-attr 'none'/);assert.doesNotMatch(candidate,/unsafe-inline/);
 assert.equal(await response.text(),"<html>existing</html>");
});
test("CSP: APIs do not receive HTML-only report policy",()=>{
 const response=secureResponse(Response.json({ok:true}));assert.equal(response.headers.get("content-security-policy-report-only"),null);
});
