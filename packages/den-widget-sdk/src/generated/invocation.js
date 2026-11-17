const saved = globalThis.__moonCapyStorage;
let value;
if (!functionName) {
  value = (0,eval)('typeof WidgetMetadata === "undefined" ? null : WidgetMetadata');
} else {
  const parts = functionName.split('.');
  const owner = parts.length === 1 ? globalThis : (0,eval)(parts.slice(0,-1).join('.'));
  const fn = (0,eval)(functionName);
  if (typeof fn !== 'function') throw new Error('Missing component function');
  let argument = JSON.parse(argumentJSON);
  if (functionName === 'loadDetail' && argument && typeof argument === 'object') {
    const link = argument.link || argument.detailUrl || argument.url;
    if (typeof link === 'string') Object.defineProperty(argument,'toString',{value:() => link,enumerable:false});
  }
  value = await fn.call(owner,argument);
}
return JSON.stringify({value:value === undefined ? null : value, storage:saved});
