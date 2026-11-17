#!/usr/bin/env node
import {readFile, writeFile, mkdir, realpath} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {createRunner, redact} from '../src/testing.mjs';
import {scaffold} from '../src/scaffold.mjs';

const help = `Den Widget SDK (developer preview)
  den-widget init <new-directory> [--id den.example] [--title name] [--sdk directory]
  den-widget check <widget.js> [--profile common|ios|mac|tv] [--json]
  den-widget run <widget.js> <function> [--params JSON | --params-file file.json]
      [--fixtures fixtures.json] [--kind list|detail] [--profile profile]
      [--allow-origin https://host] [--source-url https://host/widget.js] [--timeout milliseconds] [--json]
  den-widget build <widget.js> --out dist/widget.js [--profile profile]
  den-widget --version
Network is disabled by default. Use trusted local scripts only.
Build validates and copies classic JS; it does not transpile TypeScript or bundle imports.
Node profiles are simulations, not certification of installed Apple apps.
`;
function parse(argv) {
  const args = [], opts = {}; const flags = new Set(['json']);
  const allowed = new Set(['id', 'title', 'sdk', 'profile', 'params', 'params-file', 'fixtures', 'kind', 'allow-origin', 'source-url', 'timeout', 'out']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { args.push(arg); continue; }
    const key = arg.slice(2);
    if (flags.has(key)) { opts[key] = true; continue; }
    if (!allowed.has(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Unknown option or missing value: ' + arg);
    if (key === 'allow-origin') (opts[key] ??= []).push(argv[++i]);
    else { if (key in opts) throw new Error('Duplicate option: ' + arg); opts[key] = argv[++i]; }
  }
  return {args, opts};
}
async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes('--help')) { console.log(help); return; }
  if (argv[0] === '--version') { console.log('0.2.0'); return; }
  const {args, opts} = parse(argv); const [command, file, fn] = args;
  if (command === 'init') {
    if (!file || args.length !== 2) throw new Error('init needs one new directory');
    console.log('Created: ' + await scaffold(file, opts)); return;
  }
  if (!['check', 'run', 'build'].includes(command) || !file || args.length !== (command === 'run' ? 3 : 2)) throw new Error('Invalid command; use --help');
  if (opts.kind && !['list', 'detail'].includes(opts.kind)) throw new Error('--kind must be list or detail');
  if (opts.params !== undefined && opts['params-file']) throw new Error('Choose --params or --params-file');
  const script = await readFile(resolve(file), 'utf8');
  const fixtures = opts.fixtures ? JSON.parse(await readFile(resolve(opts.fixtures), 'utf8')) : undefined;
  if (fixtures !== undefined && !Array.isArray(fixtures)) throw new Error('Fixture file must contain an array');
  const runner = createRunner({script, sourceURL: opts['source-url'], profile: opts.profile, fixtures, allowNetwork: opts['allow-origin'], timeoutMs: opts.timeout === undefined ? undefined : Number(opts.timeout)});
  if (command === 'run') {
    const argument = JSON.parse(opts['params-file'] ? await readFile(resolve(opts['params-file']), 'utf8') : opts.params ?? '{}');
    const result = await runner.invoke(fn, argument, opts.kind);
    console.log(JSON.stringify(redact(result), null, 2)); return;
  }
  const inspection = await runner.inspect();
  if (!inspection.validation.valid) { console.log(JSON.stringify(inspection.validation, null, 2)); process.exitCode = 1; return; }
  if (command === 'build') {
    if (!opts.out) throw new Error('build requires --out');
    const output = resolve(opts.out), input = await realpath(resolve(file));
    if (output === input || await realpath(output).catch(() => '') === input) throw new Error('Output must differ from input');
    await mkdir(dirname(output), {recursive: true}); await writeFile(output, script);
    console.log('Validated classic JS: ' + output + '\nTest invoked functions and verify each target App before distribution.');
  } else console.log(opts.json ? JSON.stringify({metadata: inspection.metadata, ...inspection.validation, profile: inspection.profile}, null, 2) : 'Metadata and declared functions passed (' + inspection.profile + ').\nStructure only: run fixture tests and verify each target App.');
}
main().catch(error => { console.error(JSON.stringify({code: error.code ?? 'CLI_ERROR', message: error.code ? error.message : 'Command failed: check arguments, local paths and JSON files', issues: error.issues ?? []}, null, 2)); process.exitCode = 1; });
