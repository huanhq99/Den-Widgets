// Local-only wire fixture. Never use this as the production Worker entrypoint.
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { sm3, buildRegisterRequest, createDeviceProfile } from '../src/vendor/protocol.mjs';
import { createWorker } from '../src/worker.mjs';
function probeSM3(){try{return createHash('sm3').update('abc').digest('hex')}catch(e){return {unsupported:true,code:e.code||e.name}}}
const total=3*1024*1024+257;
const value=(a,b)=>Uint8Array.from({length:b-a+1},(_,i)=>(a+i)%251);
export default createWorker({
 async home(page){return {items:[{id:'123',title:'Synthetic fixture'}],page,sm3:probeSM3(),protocol:{sm3:Buffer.from(sm3('abc')).toString('hex'),registerBytes:buildRegisterRequest(createDeviceProfile()).body.length}}},
 async search(query,page){return {items:[{id:'123',title:query}],page}},
 async detail(id){return {id,title:'Synthetic fixture',episodes:[{id:'456',number:1}]}},
 async stream(){return {total,dispose(){},async open(start,end){let offset=start;return new ReadableStream({pull(c){if(offset>end){c.close();return}const last=Math.min(end,offset+65535);c.enqueue(value(offset,last));offset=last+1}})}}}
});
