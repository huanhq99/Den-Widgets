// Copyright (c) 2026 Den contributors. MIT license.
var WidgetMetadata = {
  id: 'den.hongguotv', title: '红果短剧', version: '1.0.0',
  description: '连接自部署 HongguoTV 服务，浏览、搜索和按集播放。', author: 'Den',
  site: 'https://github.com/huanhq99/Den-Widgets', requiredVersion: '0.0.1', configCheckFunction:'checkConnection',
  globalParams: [
    { name: 'serverURL', title: '红果服务地址', type: 'input', value: '', required: true },
    { name: 'token', title: '服务口令（可选）', type: 'input', value: '' }
  ],
  modules: [{ id: 'home', title: '推荐短剧', functionName: 'loadHome', params: [{name:'page',type:'page',value:1}] }],
  search: { title: '搜索', functionName: 'search', params: [{name:'keyword',type:'input'},{name:'page',type:'page',value:1}] }
};
function config(input) {
  var p = input && input.__parameters || input || Widget.storage.get('hongguo.config', {});
  var address = String(p.serverURL || '').trim();
  if (!address) throw new Error('请先在红果模块中填写服务地址');
  var url = new URL(address);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error('服务地址必须是 HTTP 或 HTTPS');
  url.hash = ''; url.search = ''; if (!url.pathname.endsWith('/')) url.pathname += '/';
  return {base:url.href,token:String(p.token || '')};
}
function auth(c) { return c.token ? {Authorization:'Bearer '+c.token} : {}; }
async function json(c,path,query) {
  var url = new URL(path,c.base);
  Object.keys(query || {}).forEach(function(k){url.searchParams.set(k,String(query[k]));});
  var response = await Widget.http.get(url.href,{headers:auth(c)});
  if (response.status < 200 || response.status >= 300) {
    if (response.status === 401 || response.status === 403) throw new Error('红果服务口令无效，请检查模块配置');
    throw new Error('红果服务请求失败（HTTP '+response.status+'）');
  }
  var data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
  if (data && data.error) throw new Error('红果服务暂不可用');
  return data;
}
function identifier(id) {
  if (typeof id !== 'string' || !/^\d{1,128}$/.test(id)) throw new Error('剧集 ID 必须由服务端以字符串返回');
  return id;
}
function series(row,c) {
  var id = identifier(row.id);
  return {id:'hg:'+id,type:'url',link:'hg:'+id,title:String(row.title || '未命名短剧'),
    posterPath:row.cover ? new URL(row.cover,c.base).href : '',description:row.description || '',
    remark:row.badge || '',tags:row.tags || [],mediaType:'tv'};
}
async function list(p,searching) {
  p=p || {}; var c=config(p); Widget.storage.set('hongguo.config',p);
  var query={page:Math.max(1,Number(p.page)||1)}; if(searching) query.q=String(p.keyword || '');
  var data=await json(c,searching?'api/search':'api/home',query);
  if(!data || !Array.isArray(data.items)) throw new Error('红果服务返回的列表格式不正确');
  return data.items.map(function(row){return series(row,c);});
}
async function loadHome(p) { return list(p,false); }
async function search(p) { return list(p,true); }
async function loadDetail(argument) {
  var c=config(argument && typeof argument === 'object' ? argument.__parameters || Widget.storage.get('hongguo.config',{}) : Widget.storage.get('hongguo.config',{}));
  var link=String(argument || ''); var match=/^hg:(\d+)(?::(\d+))?$/.exec(link);
  if(!match) throw new Error('无效的红果剧集标识');
  if(match[2]) {
    var play=await json(c,'api/episodes/'+match[2]+'/play',{fresh:1});
    if(!play || typeof play.path !== 'string') throw new Error('红果服务没有返回播放地址');
    var media=new URL(play.path,c.base),base=new URL(c.base);
    if(media.origin !== base.origin || media.username || media.password) throw new Error('播放地址必须属于配置的红果服务');
    return {id:link,title:'第 '+match[2]+' 集',videoUrl:media.href,customHeaders:auth(c)};
  }
  var data=await json(c,'api/series/'+match[1]); var result=series(data,c);
  if(!Array.isArray(data.episodes) || !data.episodes.length) throw new Error('暂无可播放的分集');
  result.episodeItems=data.episodes.map(function(ep,index){
    var id=identifier(ep.id),n=Number(ep.number)||index+1;
    return {id:'hg:'+match[1]+':'+id,link:'hg:'+match[1]+':'+id,type:'url',title:ep.title || '第 '+n+' 集',episodeNumber:n,mediaType:'tv'};
  });
  return result; // Playback URL is resolved only for the episode the user starts.
}

async function checkConnection(params) {
  var c=config(params),health=await json(c,'health');
  if(!health || health.service !== 'hongguotv' || String(health.apiVersion) !== '1') throw new Error('这个地址不是支持 API v1 的 HongguoTV 服务');
  return {ok:true};
}
