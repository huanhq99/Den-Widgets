// SPDX-License-Identifier: GPL-3.0-only
// Independent Workers transport around the pinned pure GPL media adapter in ./vendor.
// The service is not linked into, or shipped with, the Den App.
import { Buffer } from 'node:buffer';
import * as defaultProtocol from './vendor/protocol.mjs';
import { deriveWrappedKey } from './vendor/keys.mjs';
import { str, cleanUrl, extractAssignedJson, itemToCard, prepareCencHeader, decryptPartial } from './vendor/media.mjs';

const SITE = 'https://hongguoduanju.com';
const UA = 'com.phoenix.read/73932 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3)';
const ALLOWED = ['hongguoduanju.com', 'fqnovel.com', 'snssdk.com', 'bytedanceapi.com',
  'douyinvod.com', 'volcvod.com', 'ixigua.com', 'toutiaovod.com', 'byteimg.com',
  'ibytedtos.com', 'pstatp.com', 'bytecdn.cn', 'bytefcdnrd.com', 'qznovelvod.com'];
const MiB = 1024 * 1024;
const mediaHeaders = { 'User-Agent': UA, Referer: 'https://novel.snssdk.com/' };
function fail(message, code = 'UPSTREAM_ERROR') { const error = new Error(message); error.code = code; return error; }
function identifier(value) {
  if (typeof value !== 'string' || !/^\d{1,30}$/.test(value)) throw fail('Invalid string identifier', 'INVALID_ID');
  return value;
}
function pageNumber(page) { if (!Number.isInteger(page) || page < 1 || page > 100) throw fail('Invalid page', 'INVALID_PAGE'); return page; }
function allowedURL(input) {
  let url; try { url = new URL(input); } catch { throw fail('Invalid upstream address'); }
  if (url.protocol === 'http:') url.protocol = 'https:';
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' ||
      !ALLOWED.some(domain => host === domain || host.endsWith('.' + domain))) throw fail('Unsupported upstream address');
  return url;
}
function linkedSignal(...signals) { const live = signals.filter(Boolean); return live.length === 1 ? live[0] : live.length ? AbortSignal.any(live) : undefined; }
function checkAbort(signal) { if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError'); }
async function readIdle(reader, signal, milliseconds) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', aborted); callback(value); };
    const stop = reason => { finish(reject, reason); reader.cancel(reason).catch(() => {}); };
    const aborted = () => stop(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => stop(fail('Upstream body stalled', 'UPSTREAM_TIMEOUT')), milliseconds);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) { aborted(); return; }
    Promise.resolve(reader.read()).then(value => finish(resolve, value), error => finish(reject, error));
  });
}
async function readBounded(response, maximum, signal, idleMilliseconds = 20000) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maximum) { await response.body?.cancel(); throw fail('Upstream response exceeds limit'); }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(); const parts = []; let size = 0;
  try {
    while (true) { checkAbort(signal); const { done, value } = await readIdle(reader, signal, idleMilliseconds); if (done) break;
      size += value.byteLength; if (size > maximum) throw fail('Upstream response exceeds limit'); parts.push(Buffer.from(value)); }
    return Buffer.concat(parts, size);
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
function card(row) {
  const mapped = itemToCard(row); if (!/^\d{1,30}$/.test(mapped.url) || !mapped.title) return null;
  return { id: mapped.url, title: mapped.title, cover: mapped.img, description: mapped.content, badge: mapped.desc,
    tags: mapped.tname ? mapped.tname.split('/') : [] };
}
function cards(rows) { const seen = new Set(); return rows.slice(0, 200).map(card).filter(row => row && !seen.has(row.id) && seen.add(row.id)); }
function rangeInfo(response, start, end) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
  if (response.status !== 206 || !match) throw fail('Upstream does not support byte ranges');
  const a = Number(match[1]), b = Number(match[2]), total = Number(match[3]);
  if (![a,b,total].every(Number.isSafeInteger) || a !== start || total <= 0 || b !== Math.min(end, total - 1) || b < a) throw fail('Invalid upstream byte range');
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) !== b-a+1) throw fail('Invalid upstream byte length');
  return { total, length: b-a+1 };
}

export function createProvider({ fetch: fetcher = globalThis.fetch, now = Date.now, timeouts = {}, protocol = defaultProtocol } = {}) {
  const headerTimeout = timeouts.headers ?? 20000, idleTimeout = timeouts.idle ?? 20000, preparationTimeout = timeouts.prepare ?? 20000;
  const metadata = new Map(), streams = new Map();
  let guest, registration, registrationWindow = 0, registrationCount = 0;
  function cached(map, key, limit) {
    const time = now(); for (const [id, entry] of map) if (entry.expires <= time) map.delete(id);
    const value = map.get(key); if (value) { map.delete(key); map.set(key, value); return value.value; }
    while (map.size >= limit) map.delete(map.keys().next().value);
  }
  function store(map, key, value, ttl) {
    map.delete(key); map.set(key, { value, expires: now() + ttl });
    const maximum = map === streams ? 2 : 24; while (map.size > maximum) map.delete(map.keys().next().value);
    return value;
  }
  async function upstream(input, init = {}) {
    let url = allowedURL(input); let response;
    for (let redirects = 0; redirects <= 4; redirects++) {
      checkAbort(init.signal);
      const deadline = new AbortController(); let timer, onAbort;
      const fetchSignal = linkedSignal(init.signal, deadline.signal);
      try {
        const pending = Promise.resolve(fetcher(url.href, { ...init, signal: fetchSignal, redirect: 'manual' })).then(result => {
          if (fetchSignal?.aborted) { result.body?.cancel().catch(() => {}); throw fetchSignal.reason; }
          return result;
        });
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
          const error = fail('Upstream headers timed out', 'UPSTREAM_TIMEOUT'); deadline.abort(error); reject(error);
        }, headerTimeout); });
        const abort = new Promise((_, reject) => { if (init.signal?.aborted) reject(init.signal.reason); else { onAbort = () => reject(init.signal.reason); init.signal?.addEventListener('abort', onAbort, { once: true }); } });
        response = await Promise.race([pending, timeout, abort]);
      } catch (error) { checkAbort(init.signal); if (error.code === 'UPSTREAM_TIMEOUT') throw error; throw fail('Upstream request failed'); }
      finally { clearTimeout(timer); if (onAbort) init.signal?.removeEventListener('abort', onAbort); }
      if (![301,302,303,307,308].includes(response.status)) return response;
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location || init.method && init.method !== 'GET') throw fail('Unsupported upstream redirect');
      url = allowedURL(new URL(location, url));
    }
    throw fail('Too many upstream redirects');
  }
  async function text(url, options = {}) {
    const signal = linkedSignal(options.signal, AbortSignal.timeout(20000));
    const response = await upstream(url, { ...options, signal, headers: { ...mediaHeaders, 'Accept-Language': 'zh-CN,zh;q=0.9', ...options.headers } });
    if (response.status !== 200) { await response.body?.cancel(); throw fail('Upstream content is unavailable'); }
    return (await readBounded(response, 8*MiB, signal, idleTimeout)).toString('utf8');
  }
  async function json(url, options) {
    let data; try { data = JSON.parse(await text(url, options)); } catch (error) { if (error.code || error.name === 'AbortError') throw error; throw fail('Invalid upstream JSON'); }
    return data;
  }
  async function router(url, options) { return extractAssignedJson(await text(url, options)); }
  async function smallRange(stream, start, end, signal) {
    const response = await upstream(stream.url, { signal, headers: { ...mediaHeaders, Range: `bytes=${start}-${end}` } });
    let info; try { info = rangeInfo(response, start, end); } catch (error) { await response.body?.cancel(); throw error; }
    const data = await readBounded(response, end-start+1, signal, idleTimeout);
    if (data.length !== info.length) throw fail('Truncated upstream byte range');
    return { data, total: info.total };
  }
  function cookies(response, json) {
    const lines = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie')].filter(Boolean);
    const jar = {};
    for (const line of lines.flatMap(value => value.split(/,(?=\s*[A-Za-z0-9_-]+=)/))) {
      const pair = line.split(';',1)[0], at = pair.indexOf('='); if (at < 1) continue;
      const key = pair.slice(0,at).trim(), value = pair.slice(at+1).trim();
      if (['ttreq','store-region','store-region-src'].includes(key) && value.length <= 4096 && !/[\x00-\x20;]/.test(value)) jar[key] = value;
    }
    if (!jar.ttreq) return '';
    return `passport_csrf_token=; passport_csrf_token_default=; store-region=${jar['store-region'] ?? ''}; store-region-src=${jar['store-region-src'] ?? ''}; install_id=${json.install_id_str ?? ''}; ttreq=${jar.ttreq}`;
  }
  async function responseJSON(response, signal) {
    if (response.status === 403 || response.status === 429) { await response.body?.cancel(); throw fail('Anonymous upstream access was rejected','ANONYMOUS_REJECTED'); }
    if (response.status !== 200) { await response.body?.cancel(); throw fail('Upstream content is unavailable'); }
    const bytes = await readBounded(response,8*MiB,signal,idleTimeout);
    if (!bytes.length) throw fail('Anonymous upstream response is empty','UPSTREAM_EMPTY_RESPONSE');
    try { return JSON.parse(bytes.toString('utf8')); } catch { throw fail('Invalid upstream JSON'); }
  }
  function waitFor(promise, signal) {
    checkAbort(signal); if (!signal) return promise;
    return new Promise((resolve,reject) => {
      const abort = () => { signal.removeEventListener('abort',abort); reject(signal.reason ?? new DOMException('Aborted','AbortError')); };
      signal.addEventListener('abort',abort,{once:true});
      promise.then(value => { signal.removeEventListener('abort',abort); resolve(value); },error => { signal.removeEventListener('abort',abort); reject(error); });
      if (signal.aborted) abort();
    });
  }
  async function registered(signal) {
    checkAbort(signal); if (guest) return guest;
    if (!registration) {
      if (now()-registrationWindow >= 600000) { registrationWindow=now(); registrationCount=0; }
      if (registrationCount >= 2) throw fail('Anonymous device refresh limit reached; retry later','ANONYMOUS_LIMITED');
      registrationCount++;
      const task=(async()=>{
        const registrationSignal=AbortSignal.timeout(preparationTimeout);
        const profile=protocol.createDeviceProfile(); const request=protocol.buildRegisterRequest(profile,{now:now()});
        const response=await upstream(request.url,{...request,signal:registrationSignal});
        const data=await responseJSON(response,registrationSignal);
        try { guest=protocol.registeredDevice(data,profile,{cookie:cookies(response,data)}); }
        catch { throw fail('Anonymous device registration was not accepted','REGISTRATION_REJECTED'); }
        return guest;
      })();
      registration=task;
      task.then(()=>{if(registration===task)registration=null;},()=>{if(registration===task)registration=null;});
    }
    return waitFor(registration,signal);
  }
  async function appJSON(build, signal, alternate) {
    const bounded=linkedSignal(signal,AbortSignal.timeout(preparationTimeout));
    for(let attempt=0;attempt<2;attempt++) {
      const identity=await registered(bounded);
      const routes=alternate?[build,alternate]:[build];
      for(let route=0;route<routes.length;route++) {
        let data;
        try {
          const request=routes[route](identity);
          const response=await upstream(request.url,{...request,signal:bounded});
          data=await responseJSON(response,bounded);
        } catch(error) {
          // Try one protocol route with the same device before a bounded refresh.
          // Explicit denials, timeouts and rate limits never rotate identities.
          if(error.code==='UPSTREAM_EMPTY_RESPONSE') {
            if(route+1<routes.length)continue;
            if(attempt===0) { if(guest===identity)guest=null; break; }
          }
          throw error;
        }
        if(Number(data.code ?? data.Code ?? 0)!==0)throw fail('Anonymous upstream access was rejected','ANONYMOUS_REJECTED');
        return data;
      }
    }
    throw fail('Anonymous playback is unavailable','ANONYMOUS_LIMITED');
  }
  async function resolve(id, signal) {
    const data=await appJSON(identity=>protocol.signedVideoModel(identity,{itemId:id,now:now()}),signal,
      identity=>protocol.signedVideoModel(identity,{itemId:id,now:now(),batch:true}));
    const entry=data.data?.video_model?data.data:data.data?.[id];
    let model; try { model=typeof entry?.video_model==='string'?JSON.parse(entry.video_model):entry?.video_model; }
    catch { throw fail('Invalid video model'); }
    if(!model || typeof model!=='object')throw fail('Video model is unavailable');
    const raw=model.video_list;
    const representations=Array.isArray(raw)?raw:raw && typeof raw==='object'?Object.values(raw):[];
    const height=row=>Number(row.video_meta?.vheight ?? row.vheight ?? row.height ?? 0);
    const candidates=representations.filter(row=>row && typeof row==='object' && typeof row.main_url==='string')
      .sort((a,b)=>height(b)-height(a));
    const selected=candidates[0];if(!selected)throw fail('No muxed MP4 rendition is available','UNSUPPORTED_MEDIA');
    if(selected.hls || selected.m3u8 || ['dash','m3u8'].includes(String(selected.video_meta?.vtype ?? selected.vtype ?? '').toLowerCase()))throw fail('Separate or segmented media is unsupported','UNSUPPORTED_MEDIA');
    let encryption=selected.encrypt_info;
    if(typeof encryption==='string'){try{encryption=JSON.parse(encryption);}catch{throw fail('Unsupported media encryption','UNSUPPORTED_MEDIA');}}
    const wrapped=encryption?.spade_a ?? selected.spade_a;
    const protectedMedia=wrapped || encryption?.encrypt || encryption?.encryption_method || encryption?.kid || selected.encrypt || selected.encryption_method || selected.gear_des_key || selected.kid || selected.check_info;
    let contentKey=null;if(wrapped)contentKey=deriveWrappedKey(wrapped).key;
    else if(protectedMedia)throw fail('Media key material is unavailable','UNSUPPORTED_MEDIA');
    const url=allowedURL(cleanUrl(selected.main_url)).href;
    const stream={url,key:contentKey};
    const first = await smallRange(stream, 0, 256*1024-1, signal); let head = first.data;
    if (head.length < 16 || head.toString('ascii',4,8) !== 'ftyp') throw fail('Invalid MP4 header');
    const ftyp = head.readUInt32BE(0);
    if (ftyp < 8 || ftyp+8 > head.length || head.toString('ascii',ftyp+4,ftyp+8) !== 'moov') throw fail('Unsupported MP4 layout');
    const moovSize = head.readUInt32BE(ftyp), moovEnd = ftyp+moovSize;
    if (moovSize < 8 || moovEnd > first.total || moovEnd > 8*MiB) throw fail('MP4 header exceeds supported limits');
    if (moovEnd > head.length) head = Buffer.concat([head, (await smallRange(stream,head.length,moovEnd-1,signal)).data]);
    const prepared = stream.key ? prepareCencHeader(head.subarray(0,moovEnd),stream.key) : { header:head.subarray(0,moovEnd),samples:[] };
    return { ...stream, ...prepared, total:first.total, quality:str(selected.video_meta?.quality_desc || selected.quality_desc || selected.video_meta?.definition || selected.definition || height(selected) || '自动') };
  }
  return {
    async home(page=1, options={}) {
      pageNumber(page); const key='home:'+page; const previous=cached(metadata,key,24); if(previous)return previous;
      const data=await router(SITE+'/category?tab=1&sort_type=1'+(page>1?'&page='+page:''),options);
      const section=data?.loaderData?.category_page ?? data?.loaderData?.['category_$'];
      const rows=section?.recommendList ?? section?.categoryData?.recommendList;
      if(!Array.isArray(rows))throw fail('Home content format changed');
      return store(metadata,key,{items:cards(rows),page},120000);
    },
    async search(keyword,page=1,options={}) {
      pageNumber(page); keyword=String(keyword??'').trim(); if(!keyword || [...keyword].length>80)throw fail('Invalid search query','INVALID_QUERY');
      const key='search:'+page+':'+keyword; const previous=cached(metadata,key,24); if(previous)return previous;
      const data=await appJSON(identity=>protocol.signedSearch(identity,{keyword,count:20,offset:(page-1)*20,now:now()}),options.signal);
      const tabs=data.search_tabs ?? data.data?.search_tabs;
      if(!Array.isArray(tabs))throw fail('Search content format changed');
      const tab=tabs.find(value=>Number(value.tab_type)===11);if(!tab || !Array.isArray(tab.data))throw fail('Short-play search is unavailable');
      const items=[],seen=new Set();
      const append=row=>{
        const id=row.series_id_str ?? row.series_id,title=row.series_title ?? row.series_name;
        if(typeof id!=='string'||!/^\d{1,30}$/.test(id)||typeof title!=='string'||!title.trim()||seen.has(id))return;
        seen.add(id);items.push({id,title:title.trim(),cover:cleanUrl(row.series_cover ?? ''),description:str(row.series_intro),
          badge:row.episode_cnt?`全 ${row.episode_cnt} 集`:'',tags:[]});
      };
      for(const cell of tab.data.slice(0,200)) {
        const videos=Array.isArray(cell.video_data)?cell.video_data:cell.video_data && typeof cell.video_data==='object'?[cell.video_data]:[];
        for(const video of videos.slice(0,50)) {
          const detail=video.video_detail;
          if(detail && typeof detail==='object') {
            append({...detail,series_id:video.series_id});
            for(const row of Array.isArray(detail.video_detail_list)?detail.video_detail_list.slice(0,50):[])append(row);
          }
        }
      }
      return store(metadata,key,{items,page,hasMore:Boolean(tab.has_more)},60000);
    },
    async detail(id,options={}) {
      identifier(id); const key='detail:'+id; const previous=cached(metadata,key,24); if(previous)return previous;
      const data=await router(SITE+'/detail?series_id='+id,options); const series=data?.loaderData?.detail_page?.seriesDetail;
      if(!series || !Array.isArray(series.vid_list) || !series.vid_list.length || series.vid_list.length>10000)throw fail('Series details unavailable');
      const ids=series.vid_list.map(identifier); if(new Set(ids).size!==ids.length)throw fail('Duplicate episode identifiers');
      const mapped=card(series); if(!mapped || mapped.id!==id)throw fail('Series identity mismatch');
      return store(metadata,key,{...mapped,id,episodes:ids.map((episode,index)=>({id:episode,title:`第 ${index+1} 集`,number:index+1}))},120000);
    },
    async stream(id,fresh=false,options={}) {
      identifier(id); checkAbort(options.signal); if(fresh)streams.delete(id);
      let prepared=cached(streams,id,2); if(!prepared)prepared=store(streams,id,await resolve(id,linkedSignal(options.signal,AbortSignal.timeout(preparationTimeout))),90000);
      const controller=new AbortController(); let disposed=false;
      const signal=linkedSignal(options.signal,controller.signal);
      function valid(start,end) {
        checkAbort(signal); if(disposed)throw fail('Playback request closed','ABORTED');
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=prepared.total)throw fail('Invalid media range','INVALID_RANGE');
      }
      return {
        total:prepared.total,quality:prepared.quality,
        async chunk(start,end) {
          valid(start,end); if(end-start+1>MiB)throw fail('Media chunk exceeds limit','INVALID_RANGE');
          const remote=await smallRange(prepared,start,end,signal); if(remote.total!==prepared.total)throw fail('Media changed during playback');
          return decryptPartial(remote.data,start,prepared.key,prepared);
        },
        async open(start,end,openOptions={}) {
          valid(start,end); const local=new AbortController(); const openSignal=linkedSignal(signal,openOptions.signal,local.signal);
          const response=await upstream(prepared.url,{signal:openSignal,headers:{...mediaHeaders,Range:`bytes=${start}-${end}`}});
          let info; try { info=rangeInfo(response,start,end); if(info.total!==prepared.total)throw fail('Media changed during playback'); }
          catch(error){await response.body?.cancel();throw error;}
          if(!response.body)throw fail('Empty upstream media');
          const reader=response.body.getReader(); let offset=start,pending=null,pendingOffset=0,ended=false;
          async function close(reason){if(ended)return;ended=true;local.abort(reason);await reader.cancel(reason).catch(()=>{});reader.releaseLock();}
          return new ReadableStream({
            async pull(output) {
              try {
                checkAbort(openSignal);
                if(!pending){const part=await readIdle(reader,openSignal,idleTimeout);if(part.done){if(offset!==end+1)throw fail('Truncated media stream');ended=true;reader.releaseLock();output.close();return;}pending=part.value;pendingOffset=0;
                  if(pending.byteLength>8*MiB)throw fail('Upstream media chunk exceeds limit');}
                const length=Math.min(MiB,pending.byteLength-pendingOffset);
                if(offset+length>end+1)throw fail('Upstream media length mismatch');
                const value=decryptPartial(Buffer.from(pending.buffer,pending.byteOffset+pendingOffset,length),offset,prepared.key,prepared);
                offset+=length;pendingOffset+=length;if(pendingOffset===pending.byteLength)pending=null;
                output.enqueue(value);
              }catch(error){await close(error);output.error(error);}
            },
            cancel(reason){return close(reason);}
          },{highWaterMark:0});
        },
        dispose(){if(disposed)return;disposed=true;controller.abort();}
      };
    },
    clear(){metadata.clear();streams.clear();}
  };
}
export const provider=createProvider();
