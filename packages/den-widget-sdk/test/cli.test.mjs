import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec=promisify(execFile), cli=fileURLToPath(new URL('../bin/den-widget.mjs',import.meta.url));
const command=(...args)=>exec(process.execPath,[cli,...args],{timeout:15000});
test('CLI scaffold preserves existing folders; generated file validates and builds unchanged',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'den-sdk-cli-'));
  try {
    const project=resolve(root,'project');
    await command('init',project,'--id','den.demo','--title','示例 "测试"');
    const script=resolve(project,'widget.js');
    const check=JSON.parse((await command('check',script,'--json')).stdout);
    assert.equal(check.valid,true);assert.equal(check.metadata.title,'示例 "测试"');
    assert.deepEqual(check.metadata.modules.map(m=>m.type),[undefined,'detail','stream']);
    await assert.rejects(command('init',project));
    assert.ok((await readFile(script,'utf8')).includes('den.demo'));
    const dest=resolve(root,'dist/widget.js');
    await command('build',script,'--out',dest);
    assert.equal(await readFile(dest,'utf8'),await readFile(script,'utf8'));
    await assert.rejects(command('build',script,'--out',script));
    const run=JSON.parse((await command('run',script,'search','--params','{"keyword":"demo","page":1}','--fixtures',resolve(project,'fixtures.json'),'--kind','list','--profile','tv')).stdout);
    assert.equal(run.value[0].id,'demo');
    assert.equal((await command('--version')).stdout.trim(),'0.1.0');
  } finally {await rm(root,{recursive:true,force:true});}
});
test('CLI refuses malformed script / JSON, bad arguments and unknown profile',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'den-sdk-cli-'));
  try {
    const file=resolve(root,'bad.js');await writeFile(file,'export var WidgetMetadata={}');
    await assert.rejects(command('check',file));
    await writeFile(file,"var WidgetMetadata={id:'t',title:'T',version:'1',modules:[{functionName:'missing'}]}");
    await assert.rejects(command('build',file,'--out',resolve(root,'bad-copy.js')));
    await assert.rejects(command('check',file,'--profile','unknown'));
    await assert.rejects(command('run',file,'missing','--params','invalid-json'));
    await assert.rejects(command('check',file,'--not-a-flag'));
    await mkdir(resolve(root,'existing'));await writeFile(resolve(root,'existing/keep'),'preserve');
    await assert.rejects(command('init',resolve(root,'existing')));
    assert.equal(await readFile(resolve(root,'existing/keep'),'utf8'),'preserve');
  } finally {await rm(root,{recursive:true,force:true});}
});
