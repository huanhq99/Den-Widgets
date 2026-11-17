import {Worker} from 'node:worker_threads';
import {contract, profiles, functionPattern, validateMetadata, validateResult} from './contract.mjs';

export class WidgetError extends Error {
  constructor(code, message, issues = []) { super(message); this.name = 'WidgetError'; this.code = code; this.issues = issues; }
}
const clone = value => JSON.parse(JSON.stringify(value));
const secret = /authorization|cookie|token|password|secret|api[-_]?key|signature|credential|jwt/i;
export function redact(value, key = '') {
  if (secret.test(key)) return '[redacted]';
  if (Array.isArray(value)) return value.map(v => redact(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  if (typeof value === 'string' && /^https?:\/\//.test(value)) {
    try {
      const url = new URL(value); url.username = ''; url.password = '';
      for (const k of url.searchParams.keys()) if (secret.test(k)) url.searchParams.set(k, '[redacted]');
      return url.href;
    } catch {}
  }
  return value;
}
function checkedURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new WidgetError('INVALID_URL', 'Expected an absolute HTTP(S) address'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new WidgetError('INVALID_URL', 'Expected HTTP(S) without embedded credentials');
  return url;
}
async function network(request, origins, signal) {
  let url = request.url;
  let method = request.method, body = request.body;
  for (let i = 0; i <= 5; i++) {
    const parsed = checkedURL(url);
    if (!origins.includes(parsed.origin)) throw new WidgetError('NETWORK_BLOCKED', 'Network origin is not allowed');
    const response = await fetch(url, {method, headers: request.headers, body: body ?? undefined, signal, redirect: 'manual'});
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.has('location')) {
      await response.body?.cancel();
      url = new URL(response.headers.get('location'), url).href;
      // No cross-origin forwarding of credentials, including redirects.
      if (new URL(url).origin !== parsed.origin) throw new WidgetError('NETWORK_BLOCKED', 'Cross-origin redirect requires a new explicit request');
      if (response.status === 303 || ([301, 302].includes(response.status) && method === 'POST')) { method = 'GET'; body = null; }
      continue;
    }
    const reader = response.body?.getReader(); const chunks = []; let size = 0;
    if (reader) {
      try {
        while (true) {
          const next = await reader.read(); if (next.done) break;
          size += next.value.length;
          if (size > contract.limits.responseBytes) throw new WidgetError('RESPONSE_LIMIT', 'HTTP response exceeds the host limit');
          chunks.push(next.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
    }
    return {status: response.status, body: Buffer.concat(chunks).toString('utf8'), headers: Object.fromEntries(response.headers), url};
  }
  throw new WidgetError('NETWORK_BLOCKED', 'Too many redirects');
}

export function createRunner(options) {
  if (typeof options?.script !== 'string' || Buffer.byteLength(options.script) > contract.limits.scriptBytes) throw new WidgetError('SCRIPT_LIMIT', 'Expected a UTF-8 script within 2 MiB');
  const profile = options.profile ?? 'common';
  if (!profiles[profile]) throw new WidgetError('INVALID_PROFILE', 'Unknown host profile');
  const sourceURL = checkedURL(options.sourceURL ?? 'https://example.invalid/widget.js').href;
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > contract.limits.timeoutMs) throw new WidgetError('INVALID_TIMEOUT', 'Timeout must be between 1000 and 45000 ms');
  const origins = (options.allowNetwork ?? []).map(v => checkedURL(v).origin);
  let storage = clone(options.storage ?? {});
  let busy = false;
  async function execute(functionName, argument, inspect, kind) {
    if (busy) throw new WidgetError('RUNNER_BUSY', 'Use a separate runner for parallel calls');
    if (!inspect && !functionPattern.test(functionName)) throw new WidgetError('INVALID_FUNCTION', 'Expected a function name, not an expression');
    if (options.signal?.aborted) throw new WidgetError('CANCELLED', 'Module execution cancelled');
    busy = true;
    const abort = new AbortController();
    let worker, timer, externalAbort, settled = false, requestCount = 0;
    const requests = [];
    try {
      return await new Promise((resolve, reject) => {
        const finish = (error, result) => {
          if (settled) return; settled = true;
          clearTimeout(timer); abort.abort();
          options.signal?.removeEventListener('abort', externalAbort);
          const terminated = worker?.terminate() ?? Promise.resolve();
          Promise.resolve(terminated).finally(() => error ? reject(error) : resolve(result));
        };
        externalAbort = () => finish(new WidgetError('CANCELLED', 'Module execution cancelled'));
        options.signal?.addEventListener('abort', externalAbort, {once: true});
        worker = new Worker(new URL('./worker.mjs', import.meta.url), {
          execArgv: [], resourceLimits: {maxOldGenerationSizeMb: 96},
          workerData: {script: options.script, sourceURL, profile, timers: profiles[profile].timers, functionName, argument, inspect, storage}
        });
        if (options.signal?.aborted) { externalAbort(); return; }
        timer = setTimeout(() => finish(new WidgetError('TIMEOUT', 'Module execution exceeded its time budget')), timeoutMs);
        worker.on('error', () => finish(new WidgetError('WORKER_ERROR', 'Module worker failed')));
        worker.on('exit', () => { if (!settled) finish(new WidgetError('WORKER_EXIT', 'Module worker exited without a result')); });
        worker.on('message', async message => {
          if (settled) return;
          if (message.kind === 'failure') return finish(new WidgetError(message.error.code, message.error.message));
          if (message.kind === 'result') {
            try {
              if (typeof message.value !== 'string' || Buffer.byteLength(message.value) > contract.limits.resultBytes) throw new WidgetError('RESULT_LIMIT', 'Result exceeds the host limit');
              const result = JSON.parse(message.value);
              if (kind) {
                const validation = validateResult(result.value, kind);
                if (!validation.valid) throw new WidgetError('RESULT_SCHEMA', 'Result does not satisfy the authoring contract', validation.errors);
              }
              storage = clone(result.storage);
              finish(null, {value: result.value, storage: clone(storage), requests, availableFunctions: message.availableFunctions ?? [], profile});
            } catch (e) { finish(e instanceof WidgetError ? e : new WidgetError('INVALID_RESULT', 'Module returned invalid JSON')); }
            return;
          }
          if (message.kind !== 'http') return;
          let error;
          try {
            if (++requestCount > contract.limits.requests) throw new WidgetError('REQUEST_LIMIT', 'Module exceeded 40 HTTP requests');
            const raw = message.request;
            const url = checkedURL(raw.url).href;
            const method = String(raw.method).toUpperCase();
            if (!['GET', 'POST', 'HEAD'].includes(method) || Buffer.byteLength(raw.body ?? '') > contract.limits.bodyBytes) throw new WidgetError('REQUEST_LIMIT', 'Unsupported HTTP method or oversized body');
            const headers = Object.fromEntries(Object.entries(raw.headers ?? {}).filter(([k, v]) => !/[\r\n]/.test(k + v) && !['host', 'content-length', 'connection'].includes(k.toLowerCase())));
            const request = {url, method, headers, body: raw.body, timeout: raw.timeout};
            requests.push(redact(request));
            let response;
            if (typeof options.fixtures === 'function') response = await options.fixtures(clone(request), abort.signal);
            else response = options.fixtures?.find(f => f.url === url && (f.method ?? 'GET').toUpperCase() === method);
            if (!response && origins.length) response = await network(request, origins, abort.signal);
            if (!response) throw new WidgetError('NO_FIXTURE', 'No matching fixture; network is disabled unless explicitly allowed');
            const body = response.body !== undefined ? String(response.body) : JSON.stringify(response.data ?? null);
            if (Buffer.byteLength(body) > contract.limits.responseBytes) throw new WidgetError('RESPONSE_LIMIT', 'HTTP response exceeds the host limit');
            let data; try { data = JSON.parse(body); } catch { data = body; }
            const normalized = {};
            for (const [k, v] of Object.entries(response.headers ?? {})) normalized[k.toLowerCase()] = Array.isArray(v) ? v.map(String) : [String(v)];
            if (!settled) worker.postMessage({kind: 'http-reply', id: message.id, response: {ok: (response.status ?? 200) >= 200 && (response.status ?? 200) < 300, status: response.status ?? 200, data, body, headers: normalized, url: response.url ?? url}});
          } catch (e) {
            error = e instanceof WidgetError ? e : new WidgetError('HTTP_ERROR', 'Fixture or network request failed; raw errors are omitted');
            // Fixture mistakes / policy violations fail the check. Ordinary transport failures
            // reject the production bridge promise so modules can handle them as in the app.
            if (error.code === 'HTTP_ERROR') {
              if (!settled) worker.postMessage({kind: 'http-reply', id: message.id, error: true});
            } else finish(error);
          }
        });
      });
    } finally { busy = false; }
  }
  return {
    profile,
    getStorage: () => clone(storage),
    async inspect() {
      const result = await execute('', null, true);
      const validation = validateMetadata(result.value, result.availableFunctions);
      const extension = result.value?.denReadingKind ?? result.value?.denNativeKind;
      if (extension && !profiles[profile].nativeExtensions.includes(extension)) {
        validation.errors.push({path: 'nativeExtension', message: 'Native extension is outside this profile; Node cannot test native UI'});
        validation.valid = false;
      }
      return {...result, metadata: result.value, validation};
    },
    async invoke(functionName, argument = {}, kind) {
      return execute(functionName, argument, false, kind);
    }
  };
}
