import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRunner, redact, validateMetadata, validateResult} from '../src/index.mjs';

const metadata = "var WidgetMetadata={id:'test',title:'Test',version:'1',modules:[{title:'List',functionName:'list'}]};\n";
const run = (body, options = {}) => createRunner({script: metadata + body, ...options});
const code = expected => error => error.code === expected;

test('metadata: callable namespace, missing function, expressions and duplicate identity', async () => {
  const script = "const WidgetMetadata={id:'t',title:'T',version:'1',modules:[{title:'L',functionName:'Provider.list'}]}; const Provider={value:7,list(){return this.value}};";
  const runner = createRunner({script});
  assert.equal((await runner.inspect()).validation.valid, true);
  assert.equal((await runner.invoke('Provider.list')).value, 7);
  assert.equal((await run('').inspect()).validation.valid, false);
  const bad = {id:'t',title:'T',version:'1',modules:[{functionName:'list()'},{functionName:'list()'}]};
  assert.ok(validateMetadata(bad).errors.length >= 3);
  await assert.rejects(runner.invoke('Provider.list()'), code('INVALID_FUNCTION'));
});
test('new author schemas reject unsafe ids, wrong arrays, unresolved video URL and duplicate ids', () => {
  assert.equal(validateResult([{id:'9223372036854775807', title:'OK'}]).valid, true);
  assert.equal(validateResult([{id:9223372036854775807, title:'Bad'}]).valid, false);
  assert.equal(validateResult({id:'1',title:'X',episodeItems:{forEach:1}}, 'detail').valid, false);
  assert.equal(validateResult({id:'1',title:'X',videoUrl:'/page'}, 'detail').valid, false);
  assert.equal(validateResult([{id:'1',title:'X'},{id:'1',title:'Y'}]).valid, false);
  assert.equal(validateResult({id:'1',title:'X'}).valid, false);
});
for (const profile of ['common','ios','mac','tv']) {
  test(profile + ': actual host HTTP parameters, JSON POST, HEAD, response helpers and headers', async () => {
    const runner = run(`async function list(){
      const a=await Widget.http.get('/api',{params:{q:'a b',page:2,empty:null}});
      const b=await Widget.http.post('/save',{name:'x'},{headers:{Host:'bad',Authorization:'secret'}});
      const c=await Widget.http.head('/head');
      return {a:a.data,b:await b.json(),text:await b.text(),header:b.headers.get('X-Test'),status:c.status};
    }`, {profile, sourceURL:'https://example.invalid/widget.js', fixtures: request => {
      if (request.method === 'GET') {assert.equal(request.url,'https://example.invalid/api?q=a+b&page=2'); return {data:[1,2]};}
      if (request.method === 'HEAD') return {status:204,body:''};
      assert.equal(request.headers.Host, undefined);
      assert.equal(request.headers['Content-Type'],'application/json');
      assert.equal(request.body,'{"name":"x"}');
      return {data:{ok:true},headers:{'X-Test':['a','b']}};
    }});
    const result = await runner.invoke('list');
    assert.deepEqual(result.value, {a:[1,2],b:{ok:true},text:'{"ok":true}',header:'a, b',status:204});
    assert.equal(result.requests[1].headers.Authorization,'[redacted]');
  });
  test(profile + ': production DOM, HTML subset, URL parameters and base64', async () => {
    const result = await run(`function list(){
      const html='<html><body><section><a href="/one">One</a><a href="/two">Two</a></section></body></html>';
      const $=Widget.html.load(html);const values=[];
      $('a').each((i,e)=>values.push($(e).attr('href')));
      const id=Widget.dom.parse(html), nodes=Widget.dom.select(id,'a');
      const u=new URL('/foo?x=1','https://example.invalid/base'); u.searchParams.set('q','a b');
      const value={values,text:$('section').find('a').text(),first:$('a').first().text(),closest:$('a').closest('section').length,
        attr:Widget.dom.attr(nodes[1],'href'),dom:Widget.dom.text(nodes[0]),tag:nodes[0].tag,url:u.href,b64:atob(btoa('Hello'))};
      Widget.dom.remove(id);return value;
    }`, {profile}).invoke('list');
    assert.deepEqual(result.value,{values:['/one','/two'],text:'OneTwo',first:'One',closest:1,attr:'/two',dom:'One',tag:'a',url:'https://example.invalid/foo?x=1&q=a+b',b64:'Hello'});
  });
}
test('persistent storage commits successful calls and isolates runners / rejected result schema', async () => {
  const runner = run("function list(){const n=Widget.storage.get('n',0)+1;Widget.storage.set('n',n);return [{id:String(n),title:'X'}]} function bad(){Widget.storage.set('n',999);return {}} function remove(){Widget.storage.remove('n')} ");
  await runner.invoke('list',{},'list');
  assert.equal((await runner.invoke('list',{},'list')).value[0].id,'2');
  await assert.rejects(runner.invoke('bad',{},'list'),code('RESULT_SCHEMA'));
  assert.deepEqual(runner.getStorage(),{n:2});
  const copy=runner.getStorage();copy.n=5;assert.equal(runner.getStorage().n,2);
  assert.deepEqual(run('function list(){}').getStorage(),{});
  await runner.invoke('remove'); assert.deepEqual(runner.getStorage(),{});
});
test('loadDetail retains host string coercion and configuration parameters', async () => {
  const result = await run("function loadDetail(arg){return {id:'1',title:String(arg),description:arg.__parameters.region}} ").invoke('loadDetail',{link:'https://example.invalid/item',__parameters:{region:'CN'}},'detail');
  assert.equal(result.value.title,'https://example.invalid/item');assert.equal(result.value.description,'CN');
});
test('unsupported TMDB and browser modules fail explicitly without leaking raw script exceptions', async () => {
  await assert.rejects(run('function list(){return Widget.unknownApi.get()}').invoke('list'),code('UNSUPPORTED_API'));
  const error = await run("function list(){throw new Error('private-token-123')} ").invoke('list').catch(e=>e);
  assert.equal(error.code,'SCRIPT_ERROR');assert.ok(!error.message.includes('private-token'));
  await assert.rejects(run('export function list(){}').inspect(),code('SCRIPT_SYNTAX'));
});
test('profile boundaries: common / TV have no timers; iOS / Mac simulation allows them', async () => {
  for (const profile of ['common','tv']) assert.equal((await run('function list(){return typeof setTimeout}',{profile}).invoke('list')).value,'undefined');
  for (const profile of ['ios','mac']) assert.equal((await run('async function list(){await new Promise(r=>setTimeout(r,5));return 1}',{profile}).invoke('list')).value,1);
  const native="var WidgetMetadata={id:'n',title:'N',version:'1',modules:[],denNativeKind:'youtube'}";
  assert.equal((await createRunner({script:native,profile:'tv'}).inspect()).validation.valid,false);
  assert.equal((await createRunner({script:native,profile:'ios'}).inspect()).validation.valid,true);
});
test('no matching fixture, invalid URL, method, request count, body, script, response and result limits', async () => {
  await assert.rejects(run("async function list(){return Widget.http.get('https://example.invalid/a')}").invoke('list'),code('NO_FIXTURE'));
  for (const url of ['file:///tmp/a','https://user:password@example.invalid/']) {
    await assert.rejects(run('async function list(){return Widget.http.get('+JSON.stringify(url)+')}').invoke('list'),code('INVALID_URL'));
  }
  await assert.rejects(run("async function list(){return Widget.http.request({url:'https://example.invalid',method:'PUT'})}").invoke('list'),code('REQUEST_LIMIT'));
  await assert.rejects(run("async function list(){return Widget.http.post('https://example.invalid','x'.repeat(524289))}").invoke('list'),code('REQUEST_LIMIT'));
  await assert.rejects(run("async function list(){for(let i=0;i<41;i++)await Widget.http.get('https://example.invalid/a')}",{fixtures:()=>({data:{}})}).invoke('list'),code('REQUEST_LIMIT'));
  await assert.rejects(run("async function list(){return Widget.http.get('https://example.invalid/a')}",{fixtures:()=>({body:'x'.repeat(4194305)})}).invoke('list'),code('RESPONSE_LIMIT'));
  await assert.rejects(run("function list(){return 'x'.repeat(4194305)}").invoke('list'),code('RESULT_LIMIT'));
  assert.throws(()=>createRunner({script:' '.repeat(2097153)}),code('SCRIPT_LIMIT'));
});
test('transport failure rejects the real HTTP promise and can be caught in a module', async () => {
  const result=await run("async function list(){try{await fetch('https://example.invalid/a')}catch(e){return 'fallback'}}",{fixtures:()=>{throw new Error('secret')}}).invoke('list');
  assert.equal(result.value,'fallback');
});
test('bounded synchronous loop and unresolved Promise both terminate their workers', async () => {
  for (const source of ['function list(){while(true){}}','function list(){return new Promise(()=>{})}']) {
    const start=Date.now();await assert.rejects(run(source,{timeoutMs:1000}).invoke('list'),code('TIMEOUT'));
    assert.ok(Date.now()-start<5000);
  }
});
test('abort, busy guard and recovery after a failed invocation', async () => {
  const cancelled=new AbortController();cancelled.abort();
  await assert.rejects(run('function list(){}',{signal:cancelled.signal}).invoke('list'),code('CANCELLED'));
  const abort=new AbortController();
  const waiting=run("async function list(){return fetch('https://example.invalid/a')}",{signal:abort.signal,fixtures:(_,signal)=>new Promise(resolve=>signal.addEventListener('abort',()=>resolve({data:null}),{once:true}))});
  const pending=waiting.invoke('list');
  await assert.rejects(waiting.invoke('list'),code('RUNNER_BUSY'));abort.abort();await assert.rejects(pending,code('CANCELLED'));
  const recovery=run("function list(){return 2} function fail(){throw new Error('bad')} ");
  await assert.rejects(recovery.invoke('fail'),code('SCRIPT_ERROR'));
  assert.equal((await recovery.invoke('list')).value,2);
});
test('local network opt-in, same-origin POST redirect and cross-origin redirect protection', async () => {
  const server=createServer((req,res)=>{
    if(req.url==='/same'){res.writeHead(303,{location:'/ok'});res.end();}
    else if(req.url==='/cross'){res.writeHead(302,{location:'https://example.invalid/private'});res.end();}
    else {res.setHeader('content-type','application/json');res.end(JSON.stringify({method:req.method}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  try {
    const runner=run("async function list(){return (await Widget.http.post('"+origin+"/same',{x:1})).data}",{allowNetwork:[origin]});
    assert.deepEqual((await runner.invoke('list')).value,{method:'GET'});
    await assert.rejects(run("async function list(){return fetch('"+origin+"/cross')}",{allowNetwork:[origin]}).invoke('list'),code('NETWORK_BLOCKED'));
    await assert.rejects(run("async function list(){return fetch('https://example.invalid/a')}",{allowNetwork:[origin]}).invoke('list'),code('NETWORK_BLOCKED'));
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('redaction covers known credentials, nested fields and URL queries', () => {
  const value=redact({Authorization:'abc',nested:{password:'x'},url:'https://u:p@example.invalid/?token=123&page=1'});
  assert.equal(value.Authorization,'[redacted]');assert.equal(value.nested.password,'[redacted]');
  assert.ok(!value.url.includes('123'));assert.ok(!value.url.includes('u:p'));assert.ok(value.url.includes('page=1'));
});
test('the distributed template exercises actual host code without live external services', async () => {
  const script=await readFile(new URL('../templates/widget.js',import.meta.url),'utf8');
  const fixtures=JSON.parse(await readFile(new URL('../templates/fixtures.json',import.meta.url),'utf8'));
  for(const profile of ['common','tv']) {
    const runner=createRunner({script,fixtures,profile});assert.equal((await runner.inspect()).validation.valid,true);
    const list=(await runner.invoke('list',{page:1},'list')).value;
    const detail=await runner.invoke('loadDetail',{link:list[0].link},'detail');
    assert.equal(detail.requests.length,1);
    const playback=await runner.invoke('resolve',{link:detail.value.episodeItems[0].link},'detail');
    assert.equal(playback.requests.length,1);assert.match(playback.value.videoUrl,/\.mp4$/);
  }
});
