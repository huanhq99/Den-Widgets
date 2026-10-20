// Own, deterministic fixtures; no third-party content or service credentials.
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import http from 'node:http';
const root=new URL('./',import.meta.url);
export function fixture(path){
  const u=new URL(path,'http://fixture.invalid');
  if(['/huangguo/api/videos','/huangguo/api/search','/huangguo/api/ranks/hot'].includes(u.pathname))return {data:{items:[{id:'fixture',title:'接口回归',cover:'https://images.invalid/encrypted',episode_count:60}]}};
  if(u.pathname==='/huangguo/api/videos/fixture')return {data:{id:'fixture',title:'接口回归',cover:'https://images.invalid/encrypted',episodes:Array.from({length:60},(_,i)=>({ep_num:i+1}))}};
  if(u.pathname==='/huangguo/api/videos/fixture/play')return {data:{video_url:'https://media.invalid/episode-'+u.searchParams.get('ep')+'.mp4'}};
  if(u.pathname==='/hongguo/health')return {service:'hongguotv',apiVersion:1};
  if(['/hongguo/api/home','/hongguo/api/search'].includes(u.pathname))return {items:u.searchParams.get('page')==='2'?[]:[{id:'7694653385668037657',title:'红果回归',cover:'',badge:'全2集'}]};
  if(u.pathname==='/hongguo/api/series/7694653385668037657')return {id:'7694653385668037657',title:'红果回归',episodes:[{id:'7694655440692448281',number:1},{id:'7694655210777480217',number:2}]};
  if(u.pathname.startsWith('/hongguo/api/episodes/'))return {path:u.pathname.includes('/403/')?'https://different.invalid/video.mp4':'media/'+u.pathname.split('/').at(-2)+'.mp4'};
  return null;
}
async function run(){
  const requests=[],saved={};
  const context=vm.createContext({URL,Widget:{storage:{get:(k,d)=>saved[k]??d,set:(k,v)=>saved[k]=v},http:{get:async(url,opts)=>{
    requests.push({url,opts}); const data=fixture(url); return {status:data?200:404,data};
  }}}});
  vm.runInContext(await readFile(new URL('hongguo.js',root),'utf8'),context);
  const p={serverURL:'http://fixture.invalid/hongguo/',token:'fixture-token'};
  assert.equal((await context.checkConnection(p)).ok,true);
  const list=await context.loadHome({...p,page:1}); assert.equal(list[0].id,'hg:7694653385668037657');
  assert.equal((await context.loadHome({...p,page:2})).length,0);
  function arg(link){return {link,__parameters:p,toString:()=>link};}
  const detail=await context.loadDetail(arg(list[0].link));
  assert.equal(detail.episodeItems.length,2); assert.equal(requests.filter(r=>r.url.includes('/play')).length,0);
  const episode=await context.loadDetail(arg(detail.episodeItems[1].link));
  assert.equal(episode.videoUrl,'http://fixture.invalid/hongguo/media/7694655210777480217.mp4');
  assert.equal(episode.customHeaders.Authorization,'Bearer fixture-token');
  assert.equal(requests.filter(r=>r.url.includes('/play')).length,1);
  await assert.rejects(()=>context.loadDetail(arg('hg:7694653385668037657:403')),/播放地址必须属于/);
  await assert.rejects(()=>context.loadHome({}),/填写服务地址/);
  assert(requests.every(r=>r.opts.headers.Authorization==='Bearer fixture-token'));
  console.log('Hongguo: health, list, pagination, string IDs, lazy episodes, headers, same-origin guard and missing configuration PASS');
  const requests2=[],storage2={};
  const c2=vm.createContext({URL,Widget:{storage:{get:(k,d)=>storage2[k]??d,set:(k,v)=>storage2[k]=v},http:{get:async(url,opts)=>{
    requests2.push({url,opts}); const data=fixture(url);return {status:data?200:404,data};
  }}}});
  vm.runInContext(await readFile(new URL('huangguo.js',root),'utf8'),c2);
  const p2={apiBase:'http://fixture.invalid/huangguo/',coverProxy:'https://cover.invalid/decrypt',coverToken:'fixture-cover'};
  assert.equal((await c2.checkConnection(p2)).ok,true);
  const list2=await c2.loadHot(p2); assert.equal(list2[0].id,'hgai:fixture');
  assert.equal(new URL(list2[0].posterPath).searchParams.get('token'),'fixture-cover');
  const detail2=await c2.loadDetail({__parameters:p2,toString:()=>list2[0].link});
  assert.equal(detail2.episodeItems.length,60);assert.equal(requests2.filter(r=>new URL(r.url).pathname.endsWith('/play')).length,0);
  const ep2=await c2.loadDetail({__parameters:p2,toString:()=>detail2.episodeItems[49].link});
  assert.equal(ep2.videoUrl,'https://media.invalid/episode-50.mp4');
  assert.equal(requests2.filter(r=>new URL(r.url).pathname.endsWith('/play')).length,1);
  assert.equal(ep2.customHeaders.Authorization,undefined);
  assert(!JSON.stringify(ep2).includes('fixture-cover'));
  await assert.rejects(()=>c2.loadHot({}),/填写服务 API/);
  assert.equal(c2.WidgetMetadata.globalParams.find(p=>p.name==='coverToken').value,'');
  const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  assert.equal(manifest.widgets.length,4);assert.equal(new Set(manifest.widgets.map(e=>e.id)).size,4);
  assert.deepEqual(manifest,JSON.parse(await readFile(new URL('den-widgets.fwd',root),'utf8')));
  for(const entry of manifest.widgets){ assert.equal(new URL(entry.url).hostname,'raw.githubusercontent.com'); }
  console.log('Huangguo: configurable API, proxy parameters, 60-episode detail without prewarming, lazy episode 50, no proxy credential forwarding and empty secret defaults PASS');
  for(const kind of ['novel','comic']) {
    const reading=vm.createContext({});
    vm.runInContext(await readFile(new URL(kind+'.js',root),'utf8'),reading);
    const metadata=reading.WidgetMetadata;
    assert.equal(metadata.id,'den.reading.'+kind);
    assert.equal(metadata.denReadingKind,kind);
    assert.equal(metadata.modules.length,0);
    assert.equal(manifest.widgets.find(e=>e.id===metadata.id).url,'https://raw.githubusercontent.com/huanhq99/Den-Widgets/main/'+kind+'.js');
    assert.equal(metadata.globalParams,undefined);
  }
  console.log('Reading: separate novel/comic native-extension identities, no video functions or embedded source accounts PASS');
  console.log('Manifest: four entries, unique identities and matching .fwd PASS');

}
if(process.argv.includes('--serve')){
  const paths=[];
  const server=http.createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://fixture.invalid').pathname;
    if(pathname==='/__state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({paths}));return;}
    paths.push(pathname);
    if(pathname==='/manifest.json'){
      const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
      manifest.widgets=manifest.widgets.map(row=>({...row,url:'http://127.0.0.1:8798/'+row.url.split('/').at(-1)}));
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(manifest));return;
    }
    if(pathname.endsWith('.js')){try{res.setHeader('Content-Type','application/javascript');res.end(await readFile(new URL(pathname.slice(1),root)));}catch{res.statusCode=404;res.end('{}');}return;}
    if(!pathname.startsWith('/huangguo/') && req.headers.authorization!=='Bearer fixture-token'){res.statusCode=401;res.end('{}');return;}
    const value=fixture(req.url);res.setHeader('Content-Type','application/json');res.statusCode=value?200:404;res.end(JSON.stringify(value??{}));
  });server.listen(8798,'127.0.0.1',()=>console.log('Module fixture on 8798'));
}else await run();
