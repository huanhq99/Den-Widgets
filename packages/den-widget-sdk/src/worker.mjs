import {parentPort, workerData} from 'node:worker_threads';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read = name => readFileSync(new URL('./generated/' + name, import.meta.url), 'utf8');
const listeners = [];
const timers = new Map();
let timerID = 0;
const sandbox = {
  URL, URLSearchParams, atob, btoa,
  sourceURL: workerData.sourceURL,
  storageJSON: JSON.stringify(workerData.storage),
  sharedCacheJSON: JSON.stringify(workerData.sharedCache ?? {}),
  __denURL(input, base) {
    const u = new URL(input, base || undefined);
    return Object.fromEntries(['href', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash', 'username', 'password'].map(k => [k, u[k]]));
  },
  __denSend: message => parentPort.postMessage(message)
};
if (workerData.timers) {
  sandbox.setTimeout = (fn, ms, ...args) => {
    const id = ++timerID;
    timers.set(id, setTimeout(() => { timers.delete(id); fn(...args); }, ms));
    return id;
  };
  sandbox.clearTimeout = id => { clearTimeout(timers.get(id)); timers.delete(id); };
}
const context = vm.createContext(sandbox);
parentPort.on('message', message => {
  for (const fn of listeners) fn({data: message});
  if (workerData.profile === 'tv') vm.runInContext('__denReply(' + JSON.stringify(message) + ')', context);
});
if (workerData.profile === 'tv') vm.runInContext(read('tv-bootstrap.js'), context);
else {
  sandbox.self = sandbox;
  sandbox.postMessage = message => parentPort.postMessage(message);
  sandbox.addEventListener = (name, fn) => { if (name === 'message') listeners.push(fn); };
}
function safeError(error) {
  const api = /^DEN_UNSUPPORTED:([A-Za-z0-9_.]+)$/.exec(error?.message ?? '');
  return api ? {code: 'UNSUPPORTED_API', message: 'Unsupported API: ' + api[1]}
    : {code: error instanceof SyntaxError || error?.name === 'SyntaxError' ? 'SCRIPT_SYNTAX' : 'SCRIPT_ERROR',
       message: 'Module execution failed; raw script exceptions are omitted from diagnostics'};
}
try {
  vm.runInContext(read('dom.js'), context);
  vm.runInContext(read('worker-setup.js'), context);
  // Diagnostics only. Successful calls still use the unmodified production bridge.
  vm.runInContext([
    'const __sdkKnown = new Set(["http","storage","html","dom","tmdb","sharedCache"]);',
    'globalThis.Widget = new Proxy(Widget, {get(target,key) {',
    '  if (typeof key === "string" && !__sdkKnown.has(key)) throw new Error("DEN_UNSUPPORTED:Widget."+key);',
    '  return target[key];',
    '}});'
  ].join('\n'), context);
  vm.runInContext(workerData.script, context, {filename: 'widget.js'});
  if (workerData.inspect) {
    const metadata = vm.runInContext('typeof WidgetMetadata === "undefined" ? null : WidgetMetadata', context);
    const names = (metadata?.modules ?? []).map(m => m.functionName);
    if (metadata?.search) names.push(metadata.search.functionName);
    if (metadata?.configCheckFunction) names.push(metadata.configCheckFunction);
    const availableFunctions = names.filter(name => {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(name ?? '')) return false;
      try { return vm.runInContext('typeof ' + name + ' === "function"', context); } catch { return false; }
    });
    parentPort.postMessage({kind: 'result', value: JSON.stringify({value: metadata, storage: workerData.storage}), availableFunctions});
  } else {
    sandbox.functionName = workerData.functionName;
    sandbox.argumentJSON = JSON.stringify(workerData.argument);
    const promise = vm.runInContext('(async function(){\n' + read('invocation.js') + '\n})()', context);
    Promise.resolve(promise).then(value => parentPort.postMessage({kind: 'result', value}))
      .catch(error => parentPort.postMessage({kind: 'failure', error: safeError(error)}));
  }
} catch (error) {
  parentPort.postMessage({kind: 'failure', error: safeError(error)});
}
