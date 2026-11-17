const __hostSend=self.postMessage.bind(self);
const __pending=new Map();let __requestID=0;
function hostHTTP(request){return new Promise((resolve,reject)=>{
  const id=++__requestID;__pending.set(id,{resolve,reject});__hostSend({kind:'http',id,request});
});}
self.addEventListener('message',event=>{
  const message=event.data||{};
  if(message.kind!=='http-reply')return;
  const pending=__pending.get(message.id);if(!pending)return;__pending.delete(message.id);
  if(message.error)pending.reject(new Error('Component HTTP failed'));else pending.resolve(message.response);
});
const saved = JSON.parse(storageJSON);
const shared = JSON.parse(typeof sharedCacheJSON === 'string' ? sharedCacheJSON : '{}');
const sharedMutations = [];
function sharedKey(namespace,key) {
  namespace=String(namespace);key=String(key);
  if (!namespace || !key || namespace.length>256 || key.length>256) throw new Error('Invalid shared cache key');
  return [namespace,key];
}
function updateShared(namespace,key,value,remove) {
  [namespace,key]=sharedKey(namespace,key);
  if(sharedMutations.length>=256)throw new Error('Shared cache mutation limit');
  if(remove){if(Object.hasOwn(shared,namespace))delete shared[namespace][key];}
  else {
    const copy=JSON.parse(JSON.stringify(value===undefined?null:value));
    if(JSON.stringify(copy).length>65536)throw new Error('Shared cache value limit');
    if(!Object.hasOwn(shared,namespace))Object.defineProperty(shared,namespace,{value:Object.create(null),enumerable:true});
    Object.defineProperty(shared[namespace],key,{value:copy,writable:true,enumerable:true,configurable:true});
  }
  sharedMutations.push({namespace,key,operation:remove?'remove':'set',value:remove?null:shared[namespace][key]});
}
async function request(input, options) {
  options = options || {};
  const url = new URL(String(input), sourceURL);
  for (const [key, value] of Object.entries(options.params || {})) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  let body = options.body === undefined ? options.data : options.body;
  const headers = Object.assign({}, options.headers || {});
  if (body != null && typeof body !== 'string') {
    body = JSON.stringify(body);
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
  }
  const response = await hostHTTP({
    url: url.href, method: options.method || 'GET', headers,
    body: body == null ? null : body, timeout: Number(options.timeout) || 20000,
    base64Data:!!options.base64Data,zlibMode:!!options.zlibMode,allow_redirects:options.allow_redirects!==false
  });
  response.statusCode=response.status;
  response.headerValues=response.headers;
  response.headers=Object.fromEntries(Object.entries(response.headerValues).map(([k,v])=>[k,Array.isArray(v)?v.join(', '):String(v)]));
  response.text = async () => response.body;
  response.json = async () => JSON.parse(response.body);
  Object.defineProperty(response.headers,'get',{value:key=>response.headers[String(key).toLowerCase()]||''});
  return response;
}
const documents = new Map(); let documentID = 0;
function nodes(root, selector) { return Array.from(root.querySelectorAll(selector)); }
function selection(elements) {
  return {
    length: elements.length, toArray: () => elements.slice(),
    first: () => selection(elements.slice(0, 1)),
    find: selector => selection(elements.flatMap(e => nodes(e, selector))),
    closest: selector => selection([...new Set(elements.map(e => e.closest(selector)).filter(Boolean))]),
    attr: name => elements[0] ? elements[0].getAttribute(name) : null,
    text: () => elements.map(e => e.textContent).join(''),
    each: callback => { elements.forEach((e, i) => callback(i, e)); }
  };
}
function htmlLoad(html) {
  if(typeof globalThis.__capyCheerioLoad==='function'){
    const $=globalThis.__capyCheerioLoad(...arguments);
    $.root().find('*').each((i,node)=>{
      if(typeof node.getAttribute!=='function')Object.defineProperty(node,'getAttribute',{value:name=>node.attribs&&Object.hasOwn(node.attribs,name)?node.attribs[name]:null});
      if(!('textContent' in node))Object.defineProperty(node,'textContent',{get:()=>$(node).text()});
    });
    return $;
  }
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  return selector => selection(typeof selector === 'string' ? nodes(doc, selector) : [selector]);
}
function domNode(e) {
  const attributes = Object.fromEntries(Array.from(e.attributes).map(a => [a.name, a.value]));
  return {tag:e.tagName.toLowerCase(), text:e.textContent, html:e.innerHTML, outerHtml:e.outerHTML,
          attributes, attrs:attributes, id:e.id, className:e.className, classes:Array.from(e.classList)};
}
globalThis.fetch = request;
globalThis.console = {log(){}, warn(){}, error(){}, debug(){}};
globalThis.Widget = {
  http: {get:(url,opts) => request(url,Object.assign({},opts,{method:'GET'})),
         head:(url,opts) => request(url,Object.assign({},opts,{method:'HEAD'})),
         post:(url,data,opts) => request(url,Object.assign({},opts,{method:'POST',data})),
         request:opts => request(opts.url,opts)},
  tmdb: {get:async (path,options) => {
    const response=await hostHTTP({service:'tmdb',path:String(path),params:options&&options.params||{},timeout:Number(options&&options.timeout)||20000});
    return response.data;
  }},
  html: {load:htmlLoad},
  dom: {
    parse:html => {const id=++documentID;documents.set(id,new DOMParser().parseFromString(String(html),'text/html'));return id;},
    select:(id,selector) => nodes(documents.get(id),selector).map(domNode),
    text:node => node ? node.text || '' : '',
    attr:(node,name) => node && node.attributes ? node.attributes[name] || null : null,
    remove:id => documents.delete(id)
  },
  storage: {get:(key,fallback=null) => Object.hasOwn(saved,key) ? saved[key] : fallback,
            getAsync:async (key,fallback) => Object.hasOwn(saved,key) ? saved[key] : fallback,
            set:(key,value) => {Object.defineProperty(saved,String(key),{value,writable:true,enumerable:true,configurable:true});return Promise.resolve();},
            remove:key => {delete saved[key];return Promise.resolve();},
            keys:async () => Object.keys(saved),
            clear:() => {for(const key of Object.keys(saved))delete saved[key];return Promise.resolve();}},
  sharedCache: {
    get:(namespace,key)=>{[namespace,key]=sharedKey(namespace,key);return Object.hasOwn(shared,namespace)&&Object.hasOwn(shared[namespace],key)?shared[namespace][key]:null;},
    set:(namespace,key,value)=>updateShared(namespace,key,value,false),
    remove:(namespace,key)=>updateShared(namespace,key,null,true)
  }
};
globalThis.__moonCapyStorage = saved;
globalThis.__moonCapySharedMutations = sharedMutations;
