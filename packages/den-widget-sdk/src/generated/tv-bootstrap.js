globalThis.self=globalThis;
const __listeners=[];
self.postMessage=message=>__denSend(message);
self.addEventListener=(name,fn)=>{if(name==='message')__listeners.push(fn);};
globalThis.__denReply=message=>{for(const fn of __listeners)fn({data:message});};
class URLSearchParams {
  constructor(input=''){this.rows=[];if(typeof input==='string'){for(const pair of input.replace(/^\?/,'').split('&'))if(pair){const i=pair.indexOf('=');this.rows.push([decodeURIComponent((i<0?pair:pair.slice(0,i)).replace(/\+/g,' ')),decodeURIComponent((i<0?'':pair.slice(i+1)).replace(/\+/g,' '))]);}}else if(input[Symbol.iterator])this.rows=Array.from(input,([k,v])=>[String(k),String(v)]);else this.rows=Object.entries(input);}
  get(k){return this.rows.find(r=>r[0]===String(k))?.[1]??null;}
  getAll(k){return this.rows.filter(r=>r[0]===String(k)).map(r=>r[1]);}
  has(k){return this.rows.some(r=>r[0]===String(k));}
  set(k,v){k=String(k);const i=this.rows.findIndex(r=>r[0]===k);this.rows=this.rows.filter(r=>r[0]!==k);this.rows.splice(i<0?this.rows.length:i,0,[k,String(v)]);this.changed?.();}
  append(k,v){this.rows.push([String(k),String(v)]);this.changed?.();}
  delete(k){this.rows=this.rows.filter(r=>r[0]!==String(k));this.changed?.();}
  toString(){const e=s=>encodeURIComponent(s).replace(/%20/g,'+');return this.rows.map(([k,v])=>e(k)+'='+e(v)).join('&');}
  entries(){return this.rows[Symbol.iterator]();}[Symbol.iterator](){return this.entries();}
  keys(){return this.rows.map(r=>r[0])[Symbol.iterator]();} values(){return this.rows.map(r=>r[1])[Symbol.iterator]();}
  forEach(fn){for(const[k,v]of this.rows)fn(v,k,this);}
}
class URL {
  constructor(input,base){const parts=__denURL(String(input),base==null?'':String(base));Object.assign(this,parts);this._rawSearch=parts.search;this.searchParams=new URLSearchParams(parts.search);this._dirty=false;this.searchParams.changed=()=>{this._dirty=true;};delete this.href;}
  get origin(){return this.protocol+'//'+this.host;}
  get href(){const query=this._dirty?this.searchParams.toString():this._rawSearch.replace(/^\?/, '');return this.origin+(this.pathname||'/')+(query?'?'+query:'')+this.hash;}
  set href(value){} toString(){return this.href;} toJSON(){return this.href;}
}
globalThis.URL=URL;globalThis.URLSearchParams=URLSearchParams;
globalThis.atob=s=>{const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let value=0,bits=0,out='';for(const c of String(s).replace(/=+$/,'')){const n=chars.indexOf(c);if(n<0)continue;value=(value<<6)|n;bits+=6;if(bits>=8){bits-=8;out+=String.fromCharCode((value>>bits)&255);}}return out;};
globalThis.btoa=s=>{const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let value=0,bits=0,out='';for(const c of String(s)){const n=c.charCodeAt(0);if(n>255)throw new Error('Invalid character');value=(value<<8)|n;bits+=8;while(bits>=6){bits-=6;out+=chars[(value>>bits)&63];}}if(bits)out+=chars[(value<<(6-bits))&63];return out.padEnd(Math.ceil(out.length/4)*4,'=');};
