// SPDX-License-Identifier: GPL-3.0-only
// Independent Go reference vectors published with N3urda/hongguoTV.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {playerSignature} from '../src/vendor/player-signature.mjs';
import {sm3} from '../src/vendor/protocol.mjs';
import {createProvider} from '../src/provider.mjs';
test('player signatures match independently published body and bodyless reference vectors',()=>{
 const rows=JSON.parse(readFileSync(new URL('./fixtures/player-signing.json',import.meta.url)));
 for(const row of rows){const actual=playerSignature(row.query,row.body===null?null:Buffer.from(row.body),row.deviceId,{now:row.now,nonce:Buffer.from(row.nonce,'hex')},sm3);for(const [key,value]of Object.entries(row.headers))assert.equal(actual[key.toLowerCase()],value,key);}
});
test('one alternate route reuses registered identity and never substitutes a different episode',async()=>{
 let registrations=0;const identities=[],routes=[];const identity={id:'fixture'};
 const protocol={createDeviceProfile:()=>({}),buildRegisterRequest:()=>({url:'https://log5-applog-lq.fqnovel.com/register'}),registeredDevice:()=>{registrations++;return identity;},signedVideoModel:(device,{batch})=>{identities.push(device);routes.push(batch===true);return {url:'https://api5-normal-sinfonlinea.fqnovel.com/'+(batch?'batch':'single')}}};
 const fetcher=async input=>{const path=new URL(input).pathname;if(path==='/register')return Response.json({});if(path==='/single')return new Response('');if(path==='/batch')return Response.json({data:{'999':{video_model:{video_list:[]}}}});throw Error('Unexpected request');};
 const provider=createProvider({protocol,fetch:fetcher});await assert.rejects(()=>provider.stream('123'));assert.equal(registrations,1);assert.deepEqual(routes,[false,true]);assert(identities.every(x=>x===identity));
});
