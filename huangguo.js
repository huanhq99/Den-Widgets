// Copyright (c) 2026 Den contributors. MIT license.
// Clean-room adapter for the API shape in the user-provided widget.
// No third-party script, embedded proxy credential or content is redistributed.
var WidgetMetadata={
  id:'den.huangguo.compat',title:'黄果接口适配',version:'1.0.0',author:'Den',
  description:'连接自行配置的兼容接口，按需解析当前分集。封面代理与令牌由用户填写。',
  site:'https://github.com/huanhq99/Den-Widgets',requiredVersion:'0.0.1',configCheckFunction:'checkConnection',
  globalParams:[
    {name:'apiBase',title:'服务 API 地址',type:'input',value:'',required:true},
    {name:'coverProxy',title:'封面解密代理（可选）',type:'input',value:''},
    {name:'coverToken',title:'封面代理 Token（可选）',type:'input',value:''}
  ],
  modules:[
    {id:'hot',title:'热门',functionName:'loadHot',params:[{name:'page',type:'page',value:1}]},
    {id:'new',title:'最新',functionName:'loadNew',params:[{name:'page',type:'page',value:1}]},
    {id:'rank',title:'排行榜',functionName:'loadRank',params:[{name:'page',type:'page',value:1}]},
    {id:'duanju',title:'短剧',functionName:'loadDuanju',params:[{name:'page',type:'page',value:1}]},
    {id:'manju',title:'漫剧',functionName:'loadManju',params:[{name:'page',type:'page',value:1}]},
    {id:'resource',title:'播放解析',type:'stream',functionName:'loadResource',params:[]}
  ],
  search:{title:'搜索',functionName:'search',params:[{name:'keyword',type:'input'},{name:'page',type:'page',value:1}]}
};
function configuration(p){
  p=p&&p.__parameters||p||Widget.storage.get('huangguo.config',{});
  var address=String(p.apiBase||'').trim(); if(!address)throw new Error('请先在模块配置中填写服务 API 地址');
  var base=new URL(address); if(!/^https?:$/.test(base.protocol)||base.username||base.password)throw new Error('服务地址必须是 HTTP 或 HTTPS');
  base.hash='';base.search='';if(!base.pathname.endsWith('/'))base.pathname+='/';
  return {base:base.href,proxy:String(p.coverProxy||'').trim(),coverToken:String(p.coverToken||'')};
}
async function request(c,path,params){
  var url=new URL(path,c.base);Object.keys(params||{}).forEach(function(k){url.searchParams.set(k,String(params[k]));});
  var response=await Widget.http.get(url.href,{headers:{Accept:'application/json',Referer:new URL(c.base).origin+'/'}});
  if(response.status<200||response.status>=300)throw new Error('内容源请求失败（HTTP '+response.status+'）');
  return typeof response.data==='string'?JSON.parse(response.data):response.data;
}
function identifier(value){
  if(typeof value==='number'&&!Number.isSafeInteger(value))throw new Error('服务返回的剧集 ID 精度不足');
  var id=String(value==null?'':value);if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new Error('无效的剧集标识');return id;
}
function cover(c,path){
  if(!path||!c.proxy)return '';
  var proxy=new URL(c.proxy);if(!/^https?:$/.test(proxy.protocol)||proxy.username||proxy.password)throw new Error('封面代理地址无效');
  proxy.searchParams.set('url',new URL(String(path),c.base).href);if(c.coverToken)proxy.searchParams.set('token',c.coverToken);return proxy.href;
}
function item(row,c){
  var id=identifier(row.id??row.video_id??row.vod_id);
  return {id:'hgai:'+id,link:'hgai:'+id,type:'url',title:String(row.title||row.vod_name||row.name||id),
    posterPath:cover(c,row.cover||row.vod_pic||row.pic),description:String(row.description||''),
    remark:row.episode_count?'共'+row.episode_count+'集':'',mediaType:'tv'};
}
function items(data){
  var d=data&&data.data!=null?data.data:data;if(Array.isArray(d))return d;
  return d&&(d.items||d.list||d.results)||[];
}
async function list(p,kind,keyword){
  p=p||{};var c=configuration(p);Widget.storage.set('huangguo.config',p);
  var path=kind==='rank'?'api/ranks/hot':kind==='search'?'api/search':'api/videos';
  var query={page:Math.max(1,Number(p.page)||1),page_size:24};
  if(kind==='search')query.q=String(keyword||'');else if(kind!=='rank')query.sort=kind;
  var rows=items(await request(c,path,query));if(!Array.isArray(rows))throw new Error('内容列表格式不正确');
  return rows.slice(0,200).map(function(row){return item(row,c);});
}
async function loadHot(p){return list(p,'hot');}
async function loadNew(p){return list(p,'new');}
async function loadRank(p){return list(p,'rank');}
async function loadDuanju(p){return list(p,'search','短剧');}
async function loadManju(p){return list(p,'search','漫剧');}
async function search(p){return list(p,'search',p&&p.keyword);}
function parse(argument){
  var m=/^hgai:([A-Za-z0-9_-]+)(?::(\d+))?$/.exec(String(argument||''));if(!m)throw new Error('无效的分集地址');
  return {id:identifier(m[1]),episode:m[2]?Number(m[2]):null};
}
async function playback(c,id,episode){
  if(!Number.isInteger(episode)||episode<1||episode>10000)throw new Error('分集序号无效');
  var response=await request(c,'api/videos/'+encodeURIComponent(id)+'/play',{ep:episode});
  var d=response&&response.data||response||{},value=d.video_url;
  if(typeof value!=='string'||!value)throw new Error('接口没有返回播放地址');
  var url=new URL(value,c.base);if(!/^https?:$/.test(url.protocol)||url.username||url.password)throw new Error('播放地址无效');
  return {videoUrl:url.href,customHeaders:{Referer:new URL(c.base).origin+'/'}};
}
async function loadDetail(argument){
  var c=configuration(argument&&argument.__parameters||Widget.storage.get('huangguo.config',{})),p=parse(argument);
  if(p.episode)return Object.assign({id:String(argument),title:'第'+p.episode+'集'},await playback(c,p.id,p.episode));
  var response=await request(c,'api/videos/'+encodeURIComponent(p.id)),d=response&&response.data||response||{};
  var result=item(Object.assign({},d,{id:p.id}),c),episodes=Array.isArray(d.episodes)?d.episodes:[];
  if(!episodes.length){var count=Math.min(1000,Math.max(1,Number(d.episode_count||d.total_episodes)||1));episodes=Array.from({length:count},function(_,i){return {ep_num:i+1};});}
  result.episodeItems=episodes.slice(0,10000).map(function(ep,i){
    var n=Number(ep.ep_num||ep.episode)||i+1,link='hgai:'+p.id+':'+n;
    return {id:link,link:link,type:'url',title:ep.title||'第'+n+'集',episodeNumber:n,mediaType:'tv'};
  });
  return result; // No prewarming: opening a detail page makes zero play requests.
}
async function loadResource(p){
  p=p||{};var c=configuration(p),target=parse(p.link||p.id),value=await playback(c,target.id,target.episode||Number(p.episode)||1);
  return [{name:'默认线路',url:value.videoUrl,customHeaders:value.customHeaders}];
}
async function checkConnection(p){
  var rows=items(await request(configuration(p),'api/videos',{page:1,page_size:1,sort:'hot'}));
  if(!Array.isArray(rows))throw new Error('接口返回的内容列表格式不正确');return {ok:true};
}
