import {readFileSync} from 'node:fs';

export const contract = Object.freeze(JSON.parse(readFileSync(new URL('./generated/source-manifest.json', import.meta.url), 'utf8')));
export const profiles = Object.freeze({
  common: Object.freeze({name: 'common', engine: 'Node simulation of common host APIs', timers: false, nativeExtensions: []}),
  ios: Object.freeze({name: 'ios', engine: 'Node simulation; not WKWebView device verification', timers: true, nativeExtensions: ['novel', 'comic', 'youtube']}),
  mac: Object.freeze({name: 'mac', engine: 'Node simulation; not Catalyst app verification', timers: true, nativeExtensions: ['novel', 'comic', 'youtube']}),
  tv: Object.freeze({name: 'tv', engine: 'Production TV URL bootstrap in Node; not QuickJS device verification', timers: false, nativeExtensions: []})
});
export const functionPattern = /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;
const parameterTypes = new Set(['input', 'constant', 'enumeration', 'count', 'page', 'offset', 'search']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateMetadata(metadata, availableFunctions) {
  const errors = [], warnings = [];
  const issue = (path, message) => errors.push({path, message});
  if (!object(metadata)) return {valid: false, errors: [{path: 'WidgetMetadata', message: 'Expected a JSON object'}], warnings};
  for (const key of ['id', 'title', 'version']) {
    if (typeof metadata[key] !== 'string' || !metadata[key].trim()) issue(key, 'Required non-empty string for new SDK modules');
  }
  const ids = new Set();
  function params(values, path) {
    if (values === undefined) return;
    if (!Array.isArray(values)) { issue(path, 'Expected an array'); return; }
    const names = new Set();
    values.forEach((p, i) => {
      const at = path + '[' + i + ']';
      if (!object(p) || typeof p.name !== 'string' || !p.name.trim()) { issue(at, 'Parameter needs a name'); return; }
      if (names.has(p.name)) issue(at + '.name', 'Duplicate parameter name');
      names.add(p.name);
      if (!parameterTypes.has(p.type ?? 'input')) issue(at + '.type', 'Unsupported parameter type');
      if (p.type === 'enumeration' && (!Array.isArray(p.enumOptions ?? p.options) || !(p.enumOptions ?? p.options).length)) issue(at, 'Enumeration needs options');
    });
  }
  params(metadata.globalParams, 'globalParams');
  if (!Array.isArray(metadata.modules)) issue('modules', 'Expected an array');
  const modules = Array.isArray(metadata.modules) ? metadata.modules : [];
  const native = metadata.denReadingKind ?? metadata.denNativeKind;
  if (!modules.length && !native) issue('modules', 'A normal JS module needs at least one function');
  function module(m, path) {
    if (!object(m)) { issue(path, 'Expected a module object'); return; }
    if (typeof m.title !== 'string' || !m.title.trim()) issue(path + '.title', 'New SDK modules need a title');
    if (!functionPattern.test(m.functionName ?? '')) issue(path + '.functionName', 'Expected a function name or dotted namespace, not an expression');
    else if (availableFunctions && !availableFunctions.includes(m.functionName)) issue(path + '.functionName', 'Declared function is not callable');
    const id = m.id ?? m.functionName;
    if (ids.has(id)) issue(path + '.id', 'Duplicate module identity');
    ids.add(id);
    if (m.requiresWebView) issue(path + '.requiresWebView', 'Interactive WebView execution is outside this SDK contract');
    params(m.params, path + '.params');
  }
  modules.forEach((m, i) => module(m, 'modules[' + i + ']'));
  if (metadata.search !== undefined) module(metadata.search, 'search');
  if (metadata.configCheckFunction && (!functionPattern.test(metadata.configCheckFunction) || (availableFunctions && !availableFunctions.includes(metadata.configCheckFunction)))) issue('configCheckFunction', 'Declared configuration check is not callable');
  if (native) warnings.push({path: 'nativeExtension', message: 'This opens a native Den extension; it is not a portable JavaScript provider'});
  warnings.push({path: 'scope', message: 'Structure checked only; invoke your functions in fixture tests and verify on each target app'});
  return {valid: !errors.length, errors, warnings};
}

export function validateResult(value, kind = 'list') {
  const errors = [];
  const fail = (path, message) => errors.push({path, message});
  const rows = kind === 'list' ? value : Array.isArray(value) ? value : [value];
  if (!Array.isArray(rows)) return {valid: false, errors: [{path: '$', message: 'List functions must return an array'}]};
  const seen = new Set();
  function item(row, path, depth = 0) {
    if (depth > 12) { fail(path, 'Nested result is too deep'); return; }
    if (!object(row)) { fail(path, 'Expected an item object'); return; }
    if (!['string', 'number'].includes(typeof row.id) || String(row.id).trim() === '') fail(path + '.id', 'New SDK items need an id');
    if (typeof row.id === 'number' && !Number.isSafeInteger(row.id)) fail(path + '.id', 'Use a string for large identifiers');
    if (typeof row.title !== 'string' || !row.title.trim()) fail(path + '.title', 'New SDK items need a title');
    for (const field of ['episodeItems', 'episodes', 'seasonItems', 'seasons', 'playSources']) {
      if (row[field] !== undefined && !Array.isArray(row[field])) fail(path + '.' + field, 'Expected an array');
    }
    for (const field of ['episodeItems', 'episodes', 'seasonItems', 'seasons']) {
      if (Array.isArray(row[field])) row[field].forEach((child, i) => item(child, path + '.' + field + '[' + i + ']', depth + 1));
    }
    if (Array.isArray(row.playSources)) row.playSources.forEach((source, i) => {
      const at = path + '.playSources[' + i + ']';
      if (!object(source)) { fail(at, 'Expected a playback source'); return; }
      try { if (!['http:', 'https:'].includes(new URL(source.videoUrl).protocol)) throw new Error(); }
      catch { fail(at + '.videoUrl', 'New SDK sources need an absolute HTTP(S) media URL'); }
    });
    if (row.videoUrl !== undefined) {
      try { if (!['http:', 'https:'].includes(new URL(row.videoUrl).protocol)) throw new Error(); }
      catch { fail(path + '.videoUrl', 'Resolved media needs an absolute HTTP(S) URL'); }
    }
  }
  rows.forEach((row, i) => {
    item(row, '$[' + i + ']');
    const id = object(row) ? String(row.id) : '';
    if (seen.has(id)) fail('$[' + i + '].id', 'Duplicate item identifier in one list');
    seen.add(id);
  });
  return {valid: !errors.length, errors};
}
