// SPDX-License-Identifier: Apache-2.0
// Adapted from beilunyang/openhongguo internal/drm/spade.go at
// 42b73f201309423f012d483bfc0ce579dcc0937c (2026-11-04).
// Portable translation, bounded to the key wrapper. No network or identity state.
import { Buffer } from 'node:buffer';
function invalid() { const error = new Error('Unsupported wrapped media key'); error.code='UNSUPPORTED_MEDIA'; return error; }
function popcount(value){let n=0;for(let v=value>>>0;v;v&=v-1)n++;return n;}
function hexDigit(value){if(value>=48&&value<=57)return value-48;if(value>=97&&value<=102)return value-87;if(value>=65&&value<=70)return value-55;return -1;}
export function deriveWrappedKey(value) {
  if(typeof value!=='string'||value.length>4096||!value.trim()||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.trim()))throw invalid();
  const raw=Buffer.from(value.trim(),'base64');if(raw.length<4)throw invalid();
  const marker=raw[0]^raw[1]^raw[2],prefixLength=marker-0x30,outLength=raw.length-marker+0x2f;
  if(prefixLength<1||prefixLength>raw.length||outLength<2||1+outLength>raw.length)throw invalid();
  const bytes=Buffer.from(raw.subarray(1,1+outLength)),tail=raw.length-prefixLength;
  if(tail-2<0||tail>raw.length)throw invalid();
  const tag=Buffer.alloc(prefixLength);for(let i=0;i<tag.length;i++)tag[i]=raw[tail-1]^raw[tail-2]^raw[tail+i];
  const text=tag.toString('ascii'),v2=text.startsWith('app_v2')||text.startsWith('web_v2');
  if(v2){const last=bytes.length-1;for(let i=0;i+1<bytes.length;i+=2){const a=bytes[i];bytes[i]=bytes[i+1];bytes[i+1]=a;if(i===last-2)break;}}
  let previous=0x55,current=0xfa;
  for(let i=0;i<bytes.length;i++){
    const byte=bytes[i],term=-(0x15+popcount(i));
    if(i%2===0){bytes[i]=((current^byte)-(v2?previous:0)+term)&255;current=byte;}
    else{bytes[i]=((previous^byte)-(v2?previous:0)+term)&255;previous=byte;}
  }
  const versionLength=hexDigit(bytes[0]);if(versionLength<1||versionLength>=outLength)throw invalid();
  const keyLength=outLength-versionLength,hex=bytes.subarray(1,keyLength).toString('ascii');
  if(!hex||hex.length%2||!/^[0-9a-f]+$/i.test(hex))throw invalid();
  const key=Buffer.from(hex,'hex');if(key.length!==16)throw invalid();
  return {key,version:bytes.subarray(keyLength).toString('ascii')};
}
