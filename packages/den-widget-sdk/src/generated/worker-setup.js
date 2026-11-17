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
    body: body == null ? null : body, timeout: Number(options.timeout) || 20000
  });
  response.text = async () => response.body;
  response.json = async () => JSON.parse(response.body);
  response.headers.get = key => (response.headers[String(key).toLowerCase()] || []).join(', ');
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
  html: {load:htmlLoad},
  dom: {
    parse:html => {const id=++documentID;documents.set(id,new DOMParser().parseFromString(String(html),'text/html'));return id;},
    select:(id,selector) => nodes(documents.get(id),selector).map(domNode),
    text:node => node ? node.text || '' : '',
    attr:(node,name) => node && node.attributes ? node.attributes[name] || null : null,
    remove:id => documents.delete(id)
  },
  storage: {get:(key,fallback) => Object.hasOwn(saved,key) ? saved[key] : fallback,
            getAsync:async (key,fallback) => Object.hasOwn(saved,key) ? saved[key] : fallback,
            set:(key,value) => {saved[key]=value;}, remove:key => {delete saved[key];}}
};
globalThis.__moonCapyStorage = saved;
