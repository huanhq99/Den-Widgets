import {createCipheriv} from 'node:crypto';
import {strict as assert} from 'node:assert';
import test from 'node:test';
import {createProvider} from '../src/provider.mjs';
import {prepareCencHeader,decryptPartial} from '../src/vendor/media.mjs';
import {deriveWrappedKey} from '../src/vendor/keys.mjs';

test('CENC whole/partial headers, codec, boundaries, cache, cancel and stalled media',async()=>{
const checks=[];function check(name,value){assert(value,name);checks.push({name,passed:true});}
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
const box=(kind,...parts)=>{const body=Buffer.concat(parts);return Buffer.concat([u32(body.length+8),Buffer.from(kind),body]);};
const key=Buffer.from('2b7e151628aed2a6abf7158809cf4f3c','hex');
const iv=Buffer.from('f0f1f2f3f4f5f6f70000000000000000','hex');
const iv2=Buffer.from('01020304050607080000000000000000','hex');
const plain=Buffer.from(Array.from({length:1024},(_,i)=>i%251));
const ftyp=box('ftyp',Buffer.from('isom0000'));
function header(dataStart=0,auxStart=0){
 const stsd=box('stsd',Buffer.alloc(4),u32(1),box('encv',Buffer.alloc(78),box('sinf',box('frma',Buffer.from('avc1')))));
 const stsz=box('stsz',Buffer.alloc(4),u32(512),u32(2));
 const stsc=box('stsc',Buffer.alloc(4),u32(1),u32(1),u32(1),u32(1));
 const stco=box('stco',Buffer.alloc(4),u32(2),u32(dataStart),u32(dataStart+512));
 const saiz=box('saiz',Buffer.alloc(4),Buffer.from([8]),u32(2));
 const saio=box('saio',Buffer.alloc(4),u32(1),u32(auxStart));
 const trak=box('trak',box('mdia',box('minf',box('stbl',stsd,stsz,stsc,stco,saiz,saio))));
 const aux=box('free',iv.subarray(0,8),iv2.subarray(0,8));
 return Buffer.concat([ftyp,box('moov',trak,aux)]);
}
let head=header();head=header(head.length+8,head.length-16);
function encrypt(bytes,nonce){const c=createCipheriv('aes-128-ctr',key,nonce);return Buffer.concat([c.update(bytes),c.final()]);}
const media=Buffer.concat([head,box('mdat',encrypt(plain.subarray(0,512),iv),encrypt(plain.subarray(512),iv2))]);
const prepared=prepareCencHeader(head,key);const expected=Buffer.concat([prepared.header,media.subarray(head.length,head.length+8),plain]);
check('sampleTableTwoSamples',prepared.samples.length===2);
check('originalCodecAvc1Preserved',prepared.header.includes(Buffer.from('avc1'))&&!prepared.header.includes(Buffer.from('encv')));
const splits=[0,1,15,16,17,31,head.length-1,head.length+5,head.length+8+1,head.length+8+511,media.length];
for(let i=0;i<splits.length-1;i++){
 const start=splits[i],end=splits[i+1];assert.deepEqual(decryptPartial(media.subarray(start,end),start,key,prepared),expected.subarray(start,end));
}check('partialBoundariesEquivalent',true);
function spade(contentKey){const target=Buffer.from('1'+contentKey.toString('hex')+'1');let previous=85,current=250;const result=Buffer.alloc(41);
 for(let i=0;i<target.length;i++){const pop=i.toString(2).split('1').length-1,old=((target[i]+21+pop)&255)^(i&1?previous:current);result[i+1]=old;if(i&1)previous=old;else current=old;}
 result[0]=54^result[1]^result[2];for(let i=0;i<6;i++)result[35+i]=result[33]^result[34]^Buffer.from('app_v1')[i];return result.toString('base64');}
const spadeA=spade(key);check('testSpadeFixtureRoundtrip',deriveWrappedKey(spadeA).key.equals(key));
let mediaCalls=0,playerCalls=0,registrationCalls=0,cancelled=0, stall='';const calls=[];
const fetcher=async(input,init={})=>{const url=new URL(input);calls.push(url.pathname);
 if(url.pathname==='/service/2/device_register/'){registrationCalls++;return Response.json({device_id_str:'1234567890123456789',install_id_str:'2234567890123456789'},{headers:{'set-cookie':'ttreq=fixture; Path=/; HttpOnly'}});}
 if(url.pathname==='/reading/bookapi/search/tab/v')return Response.json({code:0,search_tabs:[{tab_type:11,has_more:false,data:[{video_data:[{series_id:'123',video_detail:{series_title:'Fixture'}}]}]}]});
 if(url.pathname==='/category'||url.pathname.startsWith('/search/'))return new Response('<script>_ROUTER_DATA='+JSON.stringify({loaderData:{category_page:{recommendList:[{series_id:'123',series_name:'Fixture'}]},search_page:{searchList:[{series_id:'123',series_name:'Fixture'}]}}})+';</script>');
 if(url.pathname==='/detail')return new Response('_ROUTER_DATA='+JSON.stringify({loaderData:{detail_page:{seriesDetail:{series_id:'123',series_name:'Fixture',vid_list:['456','457']}}}}));
 if(url.pathname==='/novel/player/video_model/v1/'){playerCalls++;assert(!new Headers(init.headers).has('authorization'));assert(!new Headers(init.headers).has('cookie'));assert(!new Headers(init.headers).has('x-medusa'));assert.equal(JSON.parse(Buffer.from(init.body).toString()).content_type,1);const id=JSON.parse(Buffer.from(init.body).toString()).video_id;return Response.json({code:0,data:{video_model:id==='456'?{video_list:{high:{main_url:'https://v.test.douyinvod.com/file.mp4',video_meta:{vheight:1080},encrypt_info:{spade_a:spadeA}}}}:null}});}
 if(url.pathname==='/fallback')return Response.json({video_info:{data:{video_list:{high:{main_url:'https://v.test.douyinvod.com/file.mp4',height:1080,spade_a:spadeA}}}}});
 if(url.pathname==='/file.mp4'){mediaCalls++; if(stall==='headers')return new Promise(()=>{});const range=/bytes=(\d+)-(\d+)/.exec(new Headers(init.headers).get('range'));const start=+range[1],end=Math.min(+range[2],media.length-1);let at=start,index=0;
 const body=new ReadableStream({pull(c){if(stall==='body')return new Promise(()=>{});if(init.signal?.aborted){c.error(init.signal.reason);return;}if(at>end){c.close();return;}const n=[1,7,13,129,65,257][index++%6];const stop=Math.min(at+n,end+1);c.enqueue(media.subarray(at,stop));at=stop;},cancel(){cancelled++;}},{highWaterMark:0});
 return new Response(body,{status:206,headers:{'content-range':`bytes ${start}-${end}/${media.length}`,'content-length':String(end-start+1)}});}
 throw Error('Unexpected fixture request '+url.pathname);
};
const p=createProvider({fetch:fetcher,timeouts:{headers:30,idle:20,prepare:2000}});const home=await p.home(1);check('homeHTTPMapping',home.items[0].id==='123');
check('searchHTTPMapping',(await p.search('Fixture')).items[0].title==='Fixture');
check('detailExactStringEpisodes',(await p.detail('123')).episodes[1].id==='457');
const s=await p.stream('456');check('rangeTotal',s.total===media.length);
assert.deepEqual(await s.chunk(3,media.length-3),expected.subarray(3,media.length-2));check('chunkDecryptsAcrossSampleBoundaries',true);
const before=mediaCalls;const open=await s.open(1,media.length-2);assert.deepEqual(Buffer.from(await new Response(open).arrayBuffer()),expected.subarray(1,media.length-1));check('openArbitraryNetworkBoundaries',true);check('openOneUpstreamRequest',mediaCalls===before+1);
await p.stream('456');check('completedPreparationCached',playerCalls===1);check('registeredIdentityReused',registrationCalls===1);
await p.stream('456',true);check('freshReparses',playerCalls===2);
await assert.rejects(()=>p.stream('999'));check('wrongEpisodeNeverSubstituted',true);
await assert.rejects(()=>s.chunk(0,1024*1024+2));check('invalidRangeRejected',true);
const cancelStream=await s.open(0,media.length-1);const reader=cancelStream.getReader();await reader.read();await reader.cancel();check('cancelReleasesUpstream',cancelled>0);
s.dispose();await assert.rejects(()=>s.chunk(0,5));check('disposedSessionRejected',true);

const retry=await p.stream('456');stall='body';
const stalledBody=await retry.open(0,media.length-1);const stalledReader=stalledBody.getReader();
await assert.rejects(()=>stalledReader.read(),e=>e.code==='UPSTREAM_TIMEOUT');check('pendingMediaReadTimeout',true);stalledReader.releaseLock();
stall='headers';await assert.rejects(()=>retry.open(0,media.length-1),e=>e.code==='UPSTREAM_TIMEOUT');check('pendingOpenHeadersTimeout',true);retry.dispose();

});

test('search accepts 80 supplementary Unicode codepoints',async()=>{
 const p=createProvider({fetch:async url=>new URL(url).pathname.includes('device_register')?Response.json({device_id_str:'1234567890123456789',install_id_str:'2234567890123456789'}):Response.json({code:0,search_tabs:[{tab_type:11,data:[]}]})});
 assert.deepEqual((await p.search('😀'.repeat(80))).items,[]);
 await assert.rejects(()=>p.search('😀'.repeat(81)),e=>e.code==='INVALID_QUERY');
});
test('pending content headers time out even when fetch ignores abort',async()=>{
 const p=createProvider({fetch:()=>new Promise(()=>{}),timeouts:{headers:15}});
 await assert.rejects(()=>p.home(),e=>e.code==='UPSTREAM_TIMEOUT');
});
test('caller cancellation releases pending content headers',async()=>{
 const p=createProvider({fetch:()=>new Promise(()=>{}),timeouts:{headers:2000}});const abort=new AbortController();
 const pending=p.home(1,{signal:abort.signal});abort.abort(new DOMException('Cancelled fixture','AbortError'));
 await assert.rejects(()=>pending,e=>e.name==='AbortError');
});
test('pending content body read has an idle timeout and cancels reader',async()=>{
 let cancelled=false;const p=createProvider({fetch:async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}})),timeouts:{idle:15}});
 await assert.rejects(()=>p.home(),e=>e.code==='UPSTREAM_TIMEOUT');assert(cancelled);
});

test('published modern wrapped-key vector and invalid material',()=>{
 const result=deriveWrappedKey('nLwSxG6JI85zhT//c7AK4HauO+lzrg7TdZwO0XWrP+J0pDypqQ==');
 assert.equal(result.key.toString('hex'),'1be760855c48a8c86000eeb8c5bb1010');assert.equal(result.version,'1');
 for(const input of ['', 'not base64 !!','AAAA','MTIzNDU2Nzg5MDEyMzQ1Ng=='])assert.throws(()=>deriveWrappedKey(input));
});

test('parallel signed requests share one successful registration',async()=>{
 let registrations=0;
 const p=createProvider({fetch:async url=>{
  if(new URL(url).pathname.includes('device_register')){registrations++;await new Promise(resolve=>setTimeout(resolve,5));return Response.json({device_id_str:'1234567890123456789',install_id_str:'2234567890123456789'},{headers:{'set-cookie':'ttreq=guest; Path=/; HttpOnly'}});}
  return Response.json({code:0,search_tabs:[{tab_type:11,data:[]}]});
 }});
 await Promise.all([p.search('first'),p.search('second')]);assert.equal(registrations,1);
});
test('empty upstream refreshes at most once and registration budget is bounded',async()=>{
 let registrations=0,requests=0;const p=createProvider({fetch:async url=>{
  if(new URL(url).pathname.includes('device_register')){registrations++;return Response.json({device_id_str:'1234567890123456789',install_id_str:'2234567890123456789'});}
  requests++;return new Response(null,{status:200});
 }});
 await assert.rejects(()=>p.search('one'),e=>e.code==='UPSTREAM_EMPTY_RESPONSE');
 assert.equal(registrations,2);assert.equal(requests,2);
 await assert.rejects(()=>p.search('two'),e=>e.code==='ANONYMOUS_LIMITED');assert.equal(registrations,2);
});
test('explicit upstream rejection never rotates registered device',async()=>{
 let registrations=0;const p=createProvider({fetch:async url=>{
  if(new URL(url).pathname.includes('device_register')){registrations++;return Response.json({device_id_str:'1234567890123456789',install_id_str:'2234567890123456789'});}
  return new Response('denied',{status:403});
 }});
 await assert.rejects(()=>p.search('one'),e=>e.code==='ANONYMOUS_REJECTED');assert.equal(registrations,1);
});
test('malformed or rounded anonymous registration is rejected',async()=>{
 const p=createProvider({fetch:async()=>Response.json({device_id:1234567890123456789,install_id:2234567890123456789})});
 await assert.rejects(()=>p.search('one'),e=>e.code==='REGISTRATION_REJECTED');
});
