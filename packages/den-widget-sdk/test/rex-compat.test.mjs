import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {createRunner} from '../src/index.mjs';

for(const profile of ['common','ios','mac','tv']) {
  test(profile+': Rex statusCode / string headers retain legacy status and get',async()=>{
    const r=createRunner({profile,script:"async function run(){const r=await Widget.http.get('https://fixture.invalid/test');return {status:r.status,statusCode:r.statusCode,header:r.headers['x-test'],get:r.headers.get('x-test'),raw:r.headerValues['x-test']}}",fixtures:[{url:'https://fixture.invalid/test',data:{},headers:{'X-Test':['a','b']}}]});
    assert.deepEqual((await r.invoke('run')).value,{status:200,statusCode:200,header:'a, b',get:'a, b',raw:['a','b']});
  });
  test(profile+': synchronous legacy storage and await-based Rex storage',async()=>{
    const r=createRunner({profile,script:"async function run(){Widget.storage.set('legacy','value');const sync=Widget.storage.get('legacy');await Widget.storage.set('rex','2');const keys=await Widget.storage.keys();await Widget.storage.remove('legacy');await Widget.storage.clear();return {sync,keys,missing:await Widget.storage.get('missing'),keysAfter:await Widget.storage.keys()}}"});
    assert.deepEqual((await r.invoke('run')).value,{sync:'value',keys:['legacy','rex'],missing:null,keysAfter:[]});
    assert.deepEqual(r.getStorage(),{});
  });
  test(profile+': complete Cheerio selection helpers and legacy element handles',async()=>{
    const r=createRunner({profile,script:"async function run(){const $=await Widget.html.load('<section><a href=\"/one\">One<b>A</b></a><a href=\"/two\">Two</a></section>');return {map:$('a').map((i,e)=>$(e).text()).get(),eq:$('a').eq(1).attr('href'),html:$('a').first().html(),filter:$('a').filter((i,e)=>i===1).length,parent:$('a').first().parent().get(0).tagName,legacy:$('a').get(0).getAttribute('href'),text:$('a').get(0).textContent}}"});
    assert.deepEqual((await r.invoke('run')).value,{map:['OneA','Two'],eq:'/two',html:'One<b>A</b>',filter:1,parent:'section',legacy:'/one',text:'OneA'});
  });
  test(profile+': binary and explicit zlib responses',async()=>{
    const r=createRunner({profile,script:"async function run(){return [(await Widget.http.get('https://fixture.invalid/bin',{base64Data:true})).data,(await Widget.http.get('https://fixture.invalid/zlib',{zlibMode:true})).data]}",fixtures:[{url:'https://fixture.invalid/bin',bodyBase64:Buffer.from([0,1,2,255]).toString('base64')},{url:'https://fixture.invalid/zlib',bodyBase64:deflateSync('{"value":"inflated"}').toString('base64')}]});
    assert.deepEqual((await r.invoke('run')).value,['AAEC/w==',{value:'inflated'}]);
  });
  test(profile+': TMDB fixture returns data without injecting credentials into JS',async()=>{
    const r=createRunner({profile,script:"async function run(){return await Widget.tmdb.get('movie/1',{params:{language:'en',api_key:'ignored'}})}",fixtures:[{url:'https://api.themoviedb.org/3/movie/1?language=en',data:{id:1,title:'Fixture'}}]});
    const result=await r.invoke('run');assert.deepEqual(result.value,{id:1,title:'Fixture'});assert.equal(result.requests[0].headers.Authorization,undefined);
  });
}
test('two independent runners merge shared namespaces while private storage remains isolated',async()=>{
  const sharedCache={};const script="function run(p){Widget.storage.set('private',p.key);Widget.sharedCache.set('namespace',p.key,p.value);return Widget.sharedCache.get('namespace',p.key)}";
  const a=createRunner({script,sharedCache}),b=createRunner({script,sharedCache});
  await Promise.all([a.invoke('run',{key:'a',value:1}),b.invoke('run',{key:'b',value:2})]);
  assert.deepEqual(sharedCache,{namespace:{a:1,b:2}});
  assert.deepEqual(a.getStorage(),{private:'a'});assert.deepEqual(b.getStorage(),{private:'b'});
  const c=createRunner({script:"function run(){Widget.sharedCache.remove('namespace','a');return Widget.sharedCache.get('namespace','b')}",sharedCache});
  assert.equal((await c.invoke('run')).value,2);assert.deepEqual(sharedCache,{namespace:{b:2}});
});
test('shared cache survives explicit snapshot restore and failed calls never commit',async()=>{
  const a=createRunner({script:"function run(){Widget.sharedCache.set('n','k',{value:1})}"});await a.invoke('run');
  const b=createRunner({script:"function run(){return Widget.sharedCache.get('n','k')} function fail(){Widget.sharedCache.set('n','k',9);throw new Error('fail')}",sharedCache:a.getSharedCache()});
  await assert.rejects(b.invoke('fail'));assert.deepEqual((await b.invoke('run')).value,{value:1});
});
test('shared cache bounds and prototype keys do not alter Object prototypes',async()=>{
  const r=createRunner({script:"function run(){Widget.sharedCache.set('__proto__','polluted',1);Widget.storage.set('__proto__','stored');return {clean:({}).polluted===undefined,value:Widget.sharedCache.get('__proto__','polluted')}}"});
  assert.deepEqual((await r.invoke('run')).value,{clean:true,value:1});
  const tooLarge=createRunner({script:"function run(){Widget.sharedCache.set('n','k','x'.repeat(65537))}"});await assert.rejects(tooLarge.invoke('run'));
  assert.deepEqual(tooLarge.getSharedCache(),{});
});
test('TMDB absolute / traversal / account paths fail and encrypted files remain unsupported',async()=>{
  for(const path of ['https://other.invalid/movie/1','//other.invalid/movie/1','movie/../account','movie/%2e%2e/account','movie/1?api_key=x','account/1','authentication/token/new']) {
    const r=createRunner({script:'function run(){return Widget.tmdb.get('+JSON.stringify(path)+')}'});
    await assert.rejects(r.invoke('run'),e=>e.code==='INVALID_URL');
  }
  assert.throws(()=>createRunner({script:'REXENC\n{"v":2}\nopaque'}),e=>e.code==='UNSUPPORTED_ENCRYPTION');
});
