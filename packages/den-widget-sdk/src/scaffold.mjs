import {mkdir, readFile, writeFile, rm, lstat} from 'node:fs/promises';
import {resolve, relative, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export async function scaffold(directory, options = {}) {
  const dest = resolve(directory);
  if (await lstat(dest).catch(() => null)) throw new Error('Destination already exists; choose a new directory');
  const id = options.id ?? 'den.example';
  const title = options.title ?? 'Den 示例模块';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || !title.trim()) throw new Error('Invalid module id or empty title');
  const sdk = resolve(options.sdk ?? fileURLToPath(new URL('..', import.meta.url)));
  const packageInfo = JSON.parse(await readFile(resolve(sdk, 'package.json'), 'utf8'));
  if (packageInfo.name !== '@denplayer/widget-sdk') throw new Error('--sdk must point to an installed SDK directory');
  // mkdir is exclusive: an existing project is never replaced, including symlinks.
  await mkdir(dirname(dest), {recursive: true});
  await mkdir(dest);
  try {
    for (const name of ['widget.js', 'widget.test.mjs', 'fixtures.json', 'tsconfig.json', 'README.md']) {
      let contents = await readFile(new URL('../templates/' + name, import.meta.url), 'utf8');
      if (name === 'widget.js') contents = contents.replace("'__DEN_ID__'", JSON.stringify(id)).replace("'__DEN_TITLE__'", JSON.stringify(title));
      await writeFile(resolve(dest, name), contents);
    }
    await writeFile(resolve(dest, '.gitignore'), 'node_modules/\ndist/\n');
    await writeFile(resolve(dest, 'package.json'), JSON.stringify({
      name: id.toLowerCase(), version: '1.0.0', private: true, type: 'module',
      scripts: {test: 'node --test widget.test.mjs', typecheck: 'tsc -p tsconfig.json', check: 'den-widget check widget.js', build: 'den-widget build widget.js --out dist/widget.js'},
      devDependencies: {'@denplayer/widget-sdk': 'file:' + relative(dest, sdk), typescript: '5.9.3'}
    }, null, 2) + '\n');
  } catch (error) { await rm(dest, {recursive: true, force: true}); throw error; }
  return dest;
}
