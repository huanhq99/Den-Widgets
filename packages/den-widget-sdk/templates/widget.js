/// <reference types="@denplayer/widget-sdk/env" />
// Classic script: do not add runtime import / export / require statements.
/** @type {import('@denplayer/widget-sdk').Metadata} */
var WidgetMetadata = {
  id: '__DEN_ID__', title: '__DEN_TITLE__', version: '1.0.0', author: '',
  description: 'Den SDK example; configure your own authorized service.',
  detailCacheDuration: 30,
  modules: [{id: 'latest', title: '最新', functionName: 'list', params: [
    {name: 'page', title: '页码', type: 'page', value: 1}
  ]},
  {id: 'detail', title: '详情', functionName: 'loadDetail', type: 'detail'},
  {id: 'play', title: '播放解析', functionName: 'resolve', type: 'stream'}],
  search: {title: '搜索', functionName: 'search', type: 'search', params: [
    {name: 'keyword', title: '关键词', type: 'input'},
    {name: 'page', title: '页码', type: 'page', value: 1}
  ]}
};
var API = 'https://example.invalid/api';
/** @typedef {{id: string, title: string, poster?: string}} Entry */
/** @param {Entry} row @returns {import('@denplayer/widget-sdk').MediaItem} */
function card(row) {
  return {id: row.id, title: row.title, link: API + '/detail/' + encodeURIComponent(row.id), posterPath: row.poster, type: 'url', mediaType: 'movie'};
}
/** @param {import('@denplayer/widget-sdk').Parameters} params */
async function list(params) {
  var response = await Widget.http.get(API + '/list', {params: {page: Number(params.page || 1)}});
  if (!response.ok) throw new Error('Service unavailable');
  /** @type {{items: Entry[]}} */
  var data = await response.json();
  return data.items.map(card);
}
/** @param {import('@denplayer/widget-sdk').Parameters} params */
async function search(params) {
  var response = await Widget.http.get(API + '/search', {params: {keyword: String(params.keyword || ''), page: Number(params.page || 1)}});
  /** @type {{items: Entry[]}} */
  var data = await response.json();
  return data.items.map(card);
}
/** @param {import('@denplayer/widget-sdk').DetailArgument} argument @returns {Promise<import('@denplayer/widget-sdk').MediaItem>} */
async function loadDetail(argument) {
  var link = typeof argument === 'string' ? argument : argument.link;
  var response = await Widget.http.get(link);
  /** @type {{id: string, title: string, versions: {id: string, title: string, link: string}[]}} */
  var data = await response.json();
  // Keep detail links lazy. Resolve only the version the user chooses to play.
  return {id: data.id, title: data.title, mediaType: 'movie', episodeItems: data.versions.map(function(version) {
    return {id: version.id, title: version.title, link: version.link, type: 'url'};
  })};
}
/** @param {import('@denplayer/widget-sdk').Parameters} params @returns {Promise<import('@denplayer/widget-sdk').MediaItem>} */
async function resolve(params) {
  var response = await Widget.http.get(String(params.link));
  /** @type {{id: string, title: string, videoUrl: string}} */
  var data = await response.json();
  return {id: data.id, title: data.title, videoUrl: data.videoUrl};
}
