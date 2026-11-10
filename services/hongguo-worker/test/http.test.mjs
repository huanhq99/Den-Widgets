import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, byteRange } from '../src/worker.mjs';
import vm from 'node:vm';
const SECRET='local-fixture-secret-not-production';
const BASE='https://fixture-worker.example';
const SIZE=3*1024*1024+257;
const bytes=(a,b)=>Uint8Array.from({length:b-a+1},(_,i)=>(i+a)%251);
function fixture({failFirst=false, failLater=false, wrongLength=false, fallback=false}={}) {
 const calls={open:0,chunk:[],dispose:0,home:0,search:0,detail:0,stream:[]};
 const prepared={total:SIZE,dispose(){calls.dispose++},async chunk(a,b){calls.chunk.push([a,b]);if(failFirst)throw new Error('secret=https://upstream.invalid/signed?key=private');return bytes(a,b)}};
 if(!fallback)prepared.open=async(a,b)=>{calls.open++;let offset=a;return new ReadableStream({pull(c){if(failFirst||failLater&&offset>a)throw new Error('private-signed-url');if(offset>b){c.close();return}const end=Math.min(b,offset+65535);c.enqueue(bytes(offset,wrongLength?end+1:end));offset=end+1}})};
 const provider={async home(page){calls.home++;return {items:[{id:'9223372036854775807',title:'fixture'}],page}},async search(q,page){calls.search++;return {items:[{id:'9223372036854775807',title:q}],page}},async detail(id){calls.detail++;return {id,title:'fixture',episodes:[{id:'9223372036854775808',number:1}]}},async stream(id,fresh){calls.stream.push({id,fresh});return prepared}};
 return {worker:createWorker(provider),calls};
}
const request=(path,options={})=>new Request(BASE+path,{headers:{Authorization:'Bearer '+SECRET,...options.headers},...Object.fromEntries(Object.entries(options).filter(([k])=>k!=='headers'))});
const run=(w,path,options={})=>w.fetch(request(path,options),{BRIDGE_TOKEN:SECRET},{waitUntil(p){p.catch(()=>{})}});

test('single/open/suffix ranges and invalid input matrix',()=>{
 const cases=[['bytes=0-0',[0,0]],['bytes=4-',[4,99]],['bytes=-7',[93,99]],['bytes=-200',[0,99]],['bytes=90-200',[90,99]],[null,[0,99]],['bytes=-0',null],['bytes=100-',null],['bytes=9-1',null],['bytes=0-1,3-4',null],['bytes=',null],['bytes=9007199254740992-',null],['items=0-9',null],['',null]];
 for(const [a,b]of cases)assert.deepEqual(byteRange(a,100),b,a);
 assert.equal(byteRange(null,0),null);
});
test('public JS and collection are importable with no access credential disclosure',async()=>{
 const {worker}=fixture();const script=await (await worker.fetch(new Request(BASE+'/hongguo.js'),{BRIDGE_TOKEN:SECRET})).text();assert.ok(!script.includes(SECRET));assert.ok(!script.includes('__DEN_SERVICE_ORIGIN__'));
 const context=vm.createContext({});vm.runInContext(script,context);assert.equal(context.WidgetMetadata.id,'den.hongguo.cloudflare');assert.equal(context.WidgetMetadata.version,'0.1.0');assert.equal(context.WidgetMetadata.globalParams[0].value,BASE);assert.equal(context.WidgetMetadata.globalParams[1].value,'');
 for(const p of ['/manifest.json','/widgets.fwd']){const data=await (await worker.fetch(new Request(BASE+p),{BRIDGE_TOKEN:SECRET})).json();assert.equal(data.widgets[0].url,BASE+'/hongguo.js');assert.ok(!JSON.stringify(data).includes(SECRET))}
});
test('API fails closed without a configured secret and rejects missing/wrong bearer',async()=>{
 const {worker,calls}=fixture();assert.equal((await worker.fetch(request('/api/home'),{})).status,503);
 for(const auth of ['', 'Bearer wrong'])assert.equal((await worker.fetch(new Request(BASE+'/api/home',{headers:{Authorization:auth}}),{BRIDGE_TOKEN:SECRET})).status,401);
 assert.equal(calls.home,0);
});
test('metadata IDs stay exact strings and input errors never call provider',async()=>{
 const {worker,calls}=fixture();const data=await(await run(worker,'/api/home?page=2')).json();assert.equal(data.items[0].id,'9223372036854775807');assert.equal(data.page,2);
 const found=await(await run(worker,'/api/search?q=%E6%B5%8B%E8%AF%95')).json();assert.equal(found.items[0].title,'测试');
 const detail=await(await run(worker,'/api/series/9223372036854775807')).json();assert.equal(detail.episodes[0].id,'9223372036854775808');
 for(const p of ['/api/home?page=0','/api/home?page=101','/api/home?page=1e1','/api/search?q=','/api/search?q='+encodeURIComponent('a'.repeat(81))])assert.equal((await run(worker,p)).status,400);
 assert.equal((await run(worker,'/api/series/'+ '1'.repeat(31))).status,404);assert.equal(calls.home,1);assert.equal(calls.search,1);assert.equal((await run(worker,'/proxy?url=http://127.0.0.1')).status,404);assert.equal((await run(worker,'/api/home',{method:'POST'})).status,405);
});
test('play response is a fresh same-origin path without upstream material',async()=>{
 const {worker,calls}=fixture();const data=await(await run(worker,'/api/episodes/123/play?fresh=1')).json();assert.deepEqual(data,{path:'/api/episodes/123/stream',contentType:'video/mp4'});assert.equal(calls.stream[0].fresh,true);assert.equal(calls.dispose,1);assert.equal(calls.open,0);
});
test('full open-ended range crosses MiB boundaries with one upstream open',async()=>{
 const {worker,calls}=fixture();const res=await run(worker,'/api/episodes/123/stream',{headers:{Range:'bytes=0-'}});assert.equal(res.status,206);assert.equal(res.headers.get('Content-Range'),`bytes 0-${SIZE-1}/${SIZE}`);assert.equal(Number(res.headers.get('Content-Length')),SIZE);const output=new Uint8Array(await res.arrayBuffer());assert.deepEqual(output,bytes(0,SIZE-1));assert.equal(calls.open,1);assert.deepEqual(calls.chunk,[]);await new Promise(r=>setImmediate(r));assert.equal(calls.dispose,1);
});
test('HEAD advertises matching range length and never downloads the media body',async()=>{
 const {worker,calls}=fixture();const res=await run(worker,'/api/episodes/123/stream',{method:'HEAD',headers:{Range:'bytes=5-25'}});assert.equal(res.status,206);assert.equal(res.headers.get('Content-Length'),'21');assert.equal((await res.arrayBuffer()).byteLength,0);assert.equal(calls.open,0);assert.equal(calls.dispose,1);
});
test('suffix/plain stream and invalid ranges retain HTTP semantics',async()=>{
 const {worker,calls}=fixture();let res=await run(worker,'/api/episodes/123/stream',{headers:{Range:'bytes=-11'}});assert.deepEqual(new Uint8Array(await res.arrayBuffer()),bytes(SIZE-11,SIZE-1));assert.equal(res.headers.get('Content-Length'),'11');
 res=await run(worker,'/api/episodes/123/stream',{method:'HEAD'});assert.equal(res.status,200);assert.equal(res.headers.get('Content-Range'),null);assert.equal(Number(res.headers.get('Content-Length')),SIZE);
 for(const range of ['bytes=-0','bytes=9-1','bytes=0-1,3-4',`bytes=${SIZE}-`]){res=await run(worker,'/api/episodes/123/stream',{headers:{Range:range}});assert.equal(res.status,416);assert.equal(res.headers.get('Content-Range'),`bytes */${SIZE}`)}
 assert.equal(calls.open,1);
});
test('upstream errors before first media bytes return sanitized 502',async()=>{
 const {worker}=fixture({failFirst:true});const res=await run(worker,'/api/episodes/123/stream');assert.equal(res.status,502);const text=await res.text();assert.ok(!text.includes('private'));assert.ok(!text.includes('upstream.invalid'));
});
test('mid-stream errors abort body and release isolate gate',async()=>{
 const {worker,calls}=fixture({failLater:true});const res=await run(worker,'/api/episodes/123/stream');await assert.rejects(res.arrayBuffer());await new Promise(r=>setTimeout(r,5));assert.equal(calls.dispose,1);
});
test('client cancellation releases backpressure and the isolate gate',async()=>{
 const {worker,calls}=fixture();const res=await run(worker,'/api/episodes/123/stream');await res.body.cancel();await new Promise(r=>setTimeout(r,10));assert.equal(calls.dispose,1);
 for(let i=0;i<5;i++){const head=await run(worker,'/api/episodes/123/stream',{method:'HEAD'});assert.equal(head.status,200)}
});
test('fixture-only chunk fallback never truncates an open range at its first MiB',async()=>{
 const {worker,calls}=fixture({fallback:true});const res=await run(worker,'/api/episodes/123/stream');assert.deepEqual(new Uint8Array(await res.arrayBuffer()),bytes(0,SIZE-1));assert.equal(calls.chunk.length,4);
});

test('served JS drives API v1 health, browse, search, detail and selected playback end to end',async()=>{
 const {worker,calls}=fixture();const source=await(await worker.fetch(new Request(BASE+'/hongguo.js'))).text();const store={};
 const context=vm.createContext({URL,URLSearchParams,Widget:{storage:{get(k,fallback){return store[k]??fallback},set(k,v){store[k]=v}},http:{async get(url,options={}){const res=await worker.fetch(new Request(url,{headers:options.headers}),{BRIDGE_TOKEN:SECRET});return {status:res.status,data:await res.json()}}}}});vm.runInContext(source,context);
 const params={serverURL:BASE,token:SECRET,page:1};assert.equal((await context.checkConnection(params)).ok,true);
 const rows=await context.loadHome(params);assert.equal(rows[0].id,'hg:9223372036854775807');
 const found=await context.search({...params,keyword:'Synthetic'});assert.equal(found[0].title,'Synthetic');
 const root=await context.loadDetail(rows[0].link);assert.equal(root.episodeItems.length,1);assert.equal(calls.stream.length,0);
 const playable=await context.loadDetail(root.episodeItems[0].link);assert.equal(playable.videoUrl,BASE+'/api/episodes/9223372036854775808/stream');assert.equal(playable.customHeaders.Authorization,'Bearer '+SECRET);assert.equal(calls.stream.length,1);
});

test('anonymous source quota is explicit rather than a misleading generic server failure',async()=>{
 const worker=createWorker({async stream(){const error=new Error('private-signed-source-url');error.code='ANONYMOUS_LIMITED';throw error}});
 const response=await run(worker,'/api/episodes/123/play?fresh=1');assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'600');const body=await response.json();assert.equal(body.code,'UPSTREAM_ANONYMOUS_LIMITED');assert.ok(!JSON.stringify(body).includes('private-signed'));
 const code=await(await worker.fetch(new Request(BASE+'/hongguo.js'))).text();const context=vm.createContext({URL,URLSearchParams,Widget:{storage:{get(k,f){return f},set(){}},http:{async get(url,options={}){const res=await worker.fetch(new Request(url,{headers:options.headers}),{BRIDGE_TOKEN:SECRET});return {status:res.status,data:await res.json()}}}}});vm.runInContext(code,context);
 const argument=vm.runInContext("Object.assign(new String('hg:1:123'),{__parameters:{serverURL:"+JSON.stringify(BASE)+",token:"+JSON.stringify(SECRET)+"}})",context);
 await assert.rejects(context.loadDetail(argument),/匿名播放访问已受限/);
});
