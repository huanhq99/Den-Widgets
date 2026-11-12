// SPDX-License-Identifier: GPL-3.0-only
// Workers port of N3urda/hongguoTV PlayerSignature.kt (GPL-3.0-only).
// Argus/Simon structure: tr4cex/TikTok-Encryption (MIT), as credited upstream.
import crypto from 'node:crypto';
import {Buffer} from 'node:buffer';

const hex=s=>Buffer.from(s,'hex');
const md5=b=>crypto.createHash('md5').update(b).digest();
const u64=n=>BigInt.asUintN(64,n);
const ror=(n,s)=>u64((u64(n)>>BigInt(s))|(u64(n)<<BigInt(64-s)));
const rol=(n,s)=>ror(n,64-s);
const le=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(u64(n));return b;};
const pad=b=>Buffer.concat([b,Buffer.alloc(16-b.length%16,16-b.length%16)]);
function proto(fields) {
  const bytes=[];
  const variable=value=>{let n=BigInt(value);while(n>127n){bytes.push(Number(n&127n)|128);n>>=7n;}bytes.push(Number(n));};
  for(const [tag,value] of fields) {
    if(typeof value==='number'||typeof value==='bigint'){variable(tag*8);variable(value);}
    else{const b=Buffer.isBuffer(value)?value:Buffer.from(value);variable(tag*8+2);variable(b.length);bytes.push(...b);}
  }
  return Buffer.from(bytes);
}
function ladon(ts,salt) {
  const ascii=Buffer.from(md5(Buffer.concat([salt,Buffer.from('8662')])).toString('hex'));
  const queue=[ascii.readBigUInt64LE(16),ascii.readBigUInt64LE(24)],keys=[];
  let left=ascii.readBigUInt64LE(0),right=ascii.readBigUInt64LE(8);
  for(let i=0;i<34;i++){keys.push(left);const next=u64(ror(right,8)+left)^BigInt(i);queue.push(next);left=u64(next^rol(left,3));right=queue.shift();}
  const data=pad(Buffer.from(`${ts}-1611921764-8662`)),parts=[salt];
  for(let at=0;at<data.length;at+=16){let a=data.readBigUInt64LE(at),b=data.readBigUInt64LE(at+8);for(const k of keys){b=u64(k^u64(a+ror(b,8)));a=u64(b^rol(a,3));}parts.push(le(a),le(b));}
  return Buffer.concat(parts).toString('base64');
}
function argus(query,body,deviceId,ts,nonce,sm3) {
  const random=nonce.readUInt32LE(6)&0x7fffffff;
  const nested=proto([[1,1],[2,1],[3,1],[7,3348294860]]);
  const environment=proto([[1,'25053RT47C'],[2,'16'],[3,'update_64'],[4,2147483648]]);
  const message=proto([[1,0x40401252],[2,2],[3,random],[4,'8662'],[5,deviceId],[6,'1611921764'],[7,'7.3.5.32'],[8,'v04.07.01-ml-android'],[9,135135744],[10,Buffer.alloc(8)],[11,0],[12,ts*2],[13,sm3(body===null?Buffer.alloc(16):md5(body)).subarray(0,6)],[14,sm3(Buffer.from(query)).subarray(0,6)],[15,nested],[16,Buffer.alloc(0)],[20,'none'],[21,738],[23,environment],[25,2]]);
  const secret=hex('ac1adaae95a7af94a5114ab3b3a97dd80050aa0a39314c40528caec95256c28c');
  const derived=sm3(Buffer.concat([secret,hex('3ccc567b'),secret])),keys=[];
  for(let i=0;i<4;i++)keys.push(derived.readBigUInt64LE(i*8));
  for(let i=4;i<72;i++){const x=ror(keys[i-1],3)^keys[i-3];keys[i]=u64(~keys[i-4]^x^ror(x,1)^((0x3dc94c3a046d678bn>>BigInt((i-4)%62))&1n)^3n);}
  const blocks=pad(message),parts=[];
  for(let at=0;at<blocks.length;at+=16){let a=blocks.readBigUInt64LE(at),b=blocks.readBigUInt64LE(at+8);for(const k of keys){const next=u64(a^(rol(b,1)&rol(b,8))^rol(b,2)^k);a=b;b=next;}parts.push(le(a),le(b));}
  const mask=hex('d04ffdffd04ffdff'),encrypted=Buffer.concat(parts),scrambled=Buffer.from(encrypted.map((b,i)=>b^mask[i%8]));
  const container=Buffer.concat([hex('a6e783ee7001100918'),Buffer.concat([mask,scrambled]).reverse(),hex('567b')]);
  const cipher=crypto.createCipheriv('aes-128-cbc',md5(secret.subarray(0,16)),md5(secret.subarray(16,32)));
  return Buffer.concat([hex('3ccc'),cipher.update(container),cipher.final()]).toString('base64');
}
export function playerSignature(query,body,deviceId,{now=Date.now(),nonce=crypto.randomBytes(11)}={},sm3) {
  if(nonce.length!==11)throw new TypeError('Player nonce must be 11 bytes');
  const ts=Math.floor(now/1000),stamp=Buffer.alloc(4);stamp.writeUInt32BE(ts);
  const input=Buffer.concat([md5(Buffer.from(query)).subarray(0,4),body===null?Buffer.alloc(4):md5(body).subarray(0,4),Buffer.alloc(4),hex('00060b1c'),stamp]);
  const key=hex('44b9b9d9a4aef9fca493aa757ca3c2c4a496938f');
  for(let i=0;i<input.length;i++)input[i]^=key[i];
  for(let i=0;i<input.length;i++){const v=input[i],swapped=((v<<4)|(v>>4))&255;let bits=swapped^input[(i+1)%input.length],reversed=0;for(let n=0;n<8;n++){reversed=(reversed<<1)|(bits&1);bits>>>=1;}input[i]=(reversed^0xeb)&255;}
  const headers={'x-gorgon':Buffer.concat([hex('8404401c0000'),input]).toString('hex'),'x-khronos':String(ts),'x-ss-req-ticket':String(now),'x-argus':argus(query,body,deviceId,ts,nonce,sm3),'x-ladon':ladon(ts,nonce.subarray(2,6))};
  if(body!==null)headers['x-ss-stub']=md5(body).toString('hex').toUpperCase();
  return headers;
}
