// Verifies the actual tarball as an offline consumer; no npm registry publication.
import {readFile, writeFile, mkdir, mkdtemp, symlink, rm} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile), root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
function option(key){const i=args.indexOf(key);if(i<0||!args[i+1])throw new Error('Required: '+key);return resolve(args[i+1]);}
const out=option('--out'),scratch=option('--scratch'),tsc=option('--tsc');
await mkdir(out,{recursive:true});await mkdir(scratch,{recursive:true});
const temp=await mkdtemp(resolve(scratch,'package-check-'));
const records=[];
async function run(name,cmd,argv,cwd){
  const result=await exec(cmd,argv,{cwd,timeout:60000,maxBuffer:4*1024*1024});
  records.push({name,passed:true,stdout:result.stdout,stderr:result.stderr});return result.stdout;
}
try {
  const packed=JSON.parse(await run('pack SDK','npm',['pack','./packages/den-widget-sdk','--json','--pack-destination',out],root))[0];
  await writeFile(resolve(out,'package-manifest.json'),JSON.stringify(packed,null,2)+'\n');
  const paths=packed.files.map(f=>f.path);
  for(const required of ['LICENSE','THIRD_PARTY_NOTICES.txt','types/env.d.ts','src/generated/dom.js','templates/widget.js','bin/den-widget.mjs'])if(!paths.includes(required))throw new Error('Missing package file '+required);
  if(paths.some(p=>!['package.json','LICENSE','THIRD_PARTY_NOTICES.txt','README.md','CHANGELOG.md'].includes(p)&&!['src/','bin/','types/','templates/'].some(prefix=>p.startsWith(prefix))))throw new Error('Unexpected package files');
  await writeFile(resolve(temp,'package.json'),'{"name":"sdk-consumer","private":true,"type":"module"}\n');
  await run('offline install tarball','npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund',resolve(out,packed.filename)],temp);
  const installed=resolve(temp,'node_modules/@denplayer/widget-sdk');
  const cli=resolve(installed,'bin/den-widget.mjs'),project=resolve(temp,'new-module');
  await run('installed CLI scaffolds module',process.execPath,[cli,'init',project,'--id','den.package-check'],temp);
  await mkdir(resolve(project,'node_modules/@denplayer'),{recursive:true});
  await symlink(installed,resolve(project,'node_modules/@denplayer/widget-sdk'),'dir');
  await run('generated project tests',process.execPath,['--test','widget.test.mjs'],project);
  await run('generated project typecheck',process.execPath,[tsc,'-p','tsconfig.json'],project);
  await writeFile(resolve(project,'negative.js'),[
    '/// <reference types="@denplayer/widget-sdk/env" />',
    'Widget.tmdb.get("movie/1");',
    '// @ts-expect-error TMDB does not accept host Authorization overrides', 'Widget.tmdb.get("movie/1",{headers:{Authorization:"private"}});',
    '// @ts-expect-error PUT is not a host method', 'Widget.http.request({url:"https://example.invalid",method:"PUT"});',
    '// @ts-expect-error No browser window', 'window.alert("no");',
    '// @ts-expect-error No common timer API', 'setTimeout(()=>{},1);',
    '// @ts-expect-error No Node process', 'process.exit(1);',
    '// @ts-expect-error New author metadata requires version', 'var invalidMetadata = /** @type {import("@denplayer/widget-sdk").Metadata} */ ({id:"x",title:"X",modules:[]});',
    'Widget.storage.set("n",1);',
    'Widget.http.get("https://example.invalid",{params:{page:1}});'
  ].join('\n'));
  const config=JSON.parse(await readFile(resolve(project,'tsconfig.json'),'utf8'));config.files=['widget.js','negative.js'];
  await writeFile(resolve(project,'tsconfig.json'),JSON.stringify(config));
  await run('unsupported API negative type assertions',process.execPath,[tsc,'-p','tsconfig.json'],project);
  await run('installed CLI checks TV profile',process.execPath,[cli,'check','widget.js','--profile','tv','--json'],project);
  await run('installed CLI builds distribution',process.execPath,[cli,'build','widget.js','--out','dist/widget.js'],project);
  if(await readFile(resolve(project,'dist/widget.js'),'utf8')!==await readFile(resolve(project,'widget.js'),'utf8'))throw new Error('Build changed original script');
  console.log('SDK tarball, offline consumer, generated tests, types and CLI passed.');
} catch(error){records.push({passed:false,message:error.message,stdout:error.stdout,stderr:error.stderr});throw error;}
finally {await writeFile(resolve(out,'consumer-verification.json'),JSON.stringify(records,null,2)+'\n');await rm(temp,{recursive:true,force:true});}
