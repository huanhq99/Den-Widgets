import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const at = args.indexOf('--app');
const app = at < 0 ? resolve(repo, '../DenPlayer') : resolve(args[at + 1] || '');
const dest = resolve(repo, 'packages/den-widget-sdk/src/generated');
const paths = {
  models: 'MoonSofa/Core/Capy/CapyModels.swift',
  http: 'MoonSofa/Core/Capy/CapyRuntime.swift',
  tv: 'DenTV/TVScriptRuntime.swift',
  dom: 'MoonSofa/Resources/capy-dom.js',
  notices: 'MoonSofa/Resources/CapyDOM-LICENSES.txt'
};
const data = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, path]) => [key, await readFile(resolve(app, path), 'utf8')])));
function literal(text, name) {
  const pattern = new RegExp('static let ' + name + ' = #"""\\n([\\s\\S]*?)\\n    """#');
  const match = pattern.exec(text);
  if (!match) throw new Error('Cannot locate production literal: ' + name);
  return match[1].split('\n').map(line => line.startsWith('    ') ? line.slice(4) : line).join('\n') + '\n';
}
const files = {
  'worker-setup.js': literal(data.models, 'workerSetup'),
  'invocation.js': literal(data.models, 'invocation'),
  'tv-bootstrap.js': literal(data.tv, 'bootstrap'),
  'dom.js': data.dom
};
const manifest = {
  contract: 'den-widget-core/1',
  scope: 'Source contract snapshot; Node checks do not certify installed Apple apps.',
  sources: Object.fromEntries(Object.entries(paths).map(([key, path]) => [path, createHash('sha256').update(data[key]).digest('hex')])),
  limits: {scriptBytes: 2097152, resultBytes: 4194304, responseBytes: 4194304, bodyBytes: 524288, requests: 40, timeoutMs: 45000}
};
files['source-manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';
await mkdir(dest, {recursive: true});
let different = false;
for (const [name, text] of Object.entries(files)) {
  const path = resolve(dest, name);
  if (args.includes('--check')) {
    if (await readFile(path, 'utf8').catch(() => '') !== text) { different = true; console.error('SDK snapshot differs: ' + name); }
  } else await writeFile(path, text);
}
const notices = resolve(dest, '../..', 'THIRD_PARTY_NOTICES.txt');
if (args.includes('--check')) {
  if (await readFile(notices, 'utf8').catch(() => '') !== data.notices) { different = true; console.error('SDK third-party notices differ'); }
} else await writeFile(notices, data.notices);
if (different) process.exitCode = 1;
else console.log(args.includes('--check') ? 'Production host snapshot matches.' : 'Production host snapshot synchronized.');
