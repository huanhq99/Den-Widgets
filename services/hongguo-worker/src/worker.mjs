// Den's independent Cloudflare bridge. GPL-3.0-only; see the provider notice.
import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { provider } from './provider.mjs';
import moduleTemplate from './module-template.mjs';

const CHUNK = 1024 * 1024;
const VERSION = '0.1.1';

export function byteRange(value, total) {
  if (!Number.isSafeInteger(total) || total < 1) return null;
  if (value == null) return [0, total - 1];
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const left = match[1] ? Number(match[1]) : null;
  const right = match[2] ? Number(match[2]) : null;
  if ((left != null && !Number.isSafeInteger(left)) || (right != null && !Number.isSafeInteger(right))) return null;
  if (left == null && right === 0) return null;
  const start = left == null ? Math.max(0, total - right) : left;
  const end = left == null || right == null ? total - 1 : Math.min(right, total - 1);
  return start >= 0 && start <= end && start < total ? [start, end] : null;
}

function json(status, value, method = 'GET', extra = {}) {
  return new Response(method === 'HEAD' ? null : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

function authorized(request, secret) {
  const actual = Buffer.from(request.headers.get('Authorization') || '');
  const expected = Buffer.from('Bearer ' + secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Injectable only as a module factory for local tests, never through env/request.
export function createWorker(content = provider) {
  let activeStreams = 0; // Per-isolate backstop, not an account-wide concurrency quota.
  return {
    async fetch(request, env = {}, ctx = {}) {
      const url = new URL(request.url);
      const method = request.method;
      if (!['GET', 'HEAD'].includes(method)) return json(405, { error: '仅支持 GET 和 HEAD' }, method, { Allow: 'GET, HEAD' });

      if (url.pathname === '/manifest.json' || url.pathname === '/widgets.fwd') {
        return json(200, { title: '红果 Cloudflare 模块', widgets: [{
          id: 'den.hongguo.cloudflare', title: '红果短剧（Cloudflare）', author: 'Den', version: VERSION,
          description: 'Cloudflare 匿名接口测试版：支持浏览、搜索和选集，已验证同会话两集传输与自动接播。', url: url.origin + '/hongguo.js',
        }] }, method, { 'Access-Control-Allow-Origin': '*' });
      }
      if (url.pathname === '/hongguo.js') {
        // Public code contains only the service origin, never its access secret.
        const script = moduleTemplate.replace('__DEN_SERVICE_ORIGIN__', () => url.origin);
        return new Response(method === 'HEAD' ? null : script, { headers: {
          'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff',
        } });
      }
      if (url.pathname === '/') return json(200, {
        service: 'Den Hongguo Cloudflare', module: '/hongguo.js', collection: '/manifest.json',
        status: 'preview; two-episode same-session playback checked locally',
        access: '在模块参数中填写部署时配置的访问口令',
      }, method);
      if (!env.BRIDGE_TOKEN) return json(503, { error: '请先配置 BRIDGE_TOKEN' }, method);
      if (!authorized(request, env.BRIDGE_TOKEN)) return json(401, { error: '访问口令不正确' }, method, { 'WWW-Authenticate': 'Bearer' });

      try {
        if (url.pathname === '/health') return json(200, {
          service: 'hongguotv', apiVersion: 1, version: VERSION, runtime: 'cloudflare-workers', upstream: 'anonymous-limited', status: 'preview',
        }, method);
        if (url.pathname === '/api/home' || url.pathname === '/api/search') {
          const text = url.searchParams.get('page') ?? '1';
          if (!/^\d{1,3}$/.test(text)) return json(400, { error: '分页参数无效' }, method);
          const page = Number(text), query = (url.searchParams.get('q') || '').trim();
          if (page < 1 || page > 100) return json(400, { error: '分页参数无效' }, method);
          const searching = url.pathname === '/api/search';
          if (searching && (!query || [...query].length > 80)) return json(400, { error: '请输入 1–80 字的关键词' }, method);
          const result = searching ? await content.search(query, page, { signal: request.signal }) : await content.home(page, { signal: request.signal });
          return json(200, result, method);
        }
        const series = /^\/api\/series\/(\d{1,30})$/.exec(url.pathname);
        if (series) return json(200, await content.detail(series[1], { signal: request.signal }), method);
        const episode = /^\/api\/episodes\/(\d{1,30})\/(play|stream)$/.exec(url.pathname);
        if (!episode) return json(404, { error: '接口不存在' }, method);
        const id = episode[1];
        if (episode[2] === 'play') {
          const prepared = await content.stream(id, url.searchParams.get('fresh') === '1', { signal: request.signal });
          prepared.dispose?.();
          return json(200, { path: `/api/episodes/${id}/stream`, contentType: 'video/mp4' }, method);
        }
        if (activeStreams >= 4) return json(503, { error: '当前节点正在处理其他播放，请稍后重试' }, method);
        activeStreams++;
        let prepared, reader;
        let released = false;
        const release = () => { if (!released) { released = true; activeStreams--; prepared?.dispose?.(); } };
        try {
          prepared = await content.stream(id, false, { signal: request.signal });
          if (!Number.isSafeInteger(prepared.total) || prepared.total < 1) throw new Error('INVALID_MEDIA_LENGTH');
          const suppliedRange = request.headers.get('Range');
          const range = byteRange(suppliedRange, prepared.total);
          if (!range) { release(); return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${prepared.total}` } }); }
          const [start, end] = range, length = end - start + 1;
          const headers = {
            'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(length),
            'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
          };
          if (suppliedRange != null) headers['Content-Range'] = `bytes ${start}-${end}/${prepared.total}`;
          if (method === 'HEAD') { release(); return new Response(null, { status: suppliedRange == null ? 200 : 206, headers }); }
          if (prepared.open) {
            const stream = await prepared.open(start, end, { signal: request.signal });
            reader = stream.getReader();
          } else {
            // Bounded fixture/compatibility fallback. Production provider uses one upstream stream.
            let offset = start;
            reader = new ReadableStream({ async pull(controller) {
              if (offset > end) { controller.close(); return; }
              const last = Math.min(end, offset + CHUNK - 1);
              const part = await prepared.chunk(offset, last); offset = last + 1;
              controller.enqueue(new Uint8Array(part));
            } }).getReader();
          }
          const first = await reader.read(); // Validate before sending 2xx headers.
          if (first.done || !first.value?.byteLength || first.value.byteLength > length) throw new Error('INVALID_FIRST_CHUNK');
          const pipe = typeof FixedLengthStream === 'function' ? new FixedLengthStream(length) : new TransformStream();
          const writer = pipe.writable.getWriter();
          const abort = () => { reader.cancel('client disconnected').catch(() => {}); writer.abort(new Error('CANCELLED')).catch(() => {}); };
          request.signal.addEventListener('abort', abort, { once: true });
          if (request.signal.aborted) abort();
          const pumping = (async () => {
            let written = 0, part = first;
            try {
              while (!part.done) {
                if (part.value.byteLength > length - written) throw new Error('MEDIA_LENGTH_MISMATCH');
                written += part.value.byteLength;
                await writer.write(part.value);
                part = await reader.read();
              }
              if (written !== length) throw new Error('MEDIA_LENGTH_MISMATCH');
              await writer.close();
            } catch {
              await writer.abort(new Error('媒体传输中断，请重试')).catch(() => {});
            } finally {
              request.signal.removeEventListener('abort', abort);
              await reader.cancel().catch(() => {});
              release();
            }
          })();
          ctx.waitUntil?.(pumping);
          return new Response(pipe.readable, { status: suppliedRange == null ? 200 : 206, headers });
        } catch (error) {
          await reader?.cancel().catch(() => {});
          release(); throw error;
        }
      } catch (error) {
        // Provider failures can contain signed URLs/keys. Do not echo or log them.
        if (error?.code === 'ANONYMOUS_LIMITED') return json(429, {
          error: '上游匿名播放访问已受限，请稍后再试。',
          code: 'UPSTREAM_ANONYMOUS_LIMITED',
        }, method, { 'Retry-After': '600' });
        if (['ANONYMOUS_REJECTED', 'REGISTRATION_REJECTED'].includes(error?.code)) return json(502, {
          error: '上游暂不接受匿名播放访问，当前来源暂不可用。', code: 'UPSTREAM_ACCESS_REJECTED',
        }, method);
        if (error?.code === 'UPSTREAM_EMPTY_RESPONSE') return json(502, {
          error: '上游未返回播放信息，当前匿名来源可能已受限。', code: 'UPSTREAM_EMPTY_RESPONSE',
        }, method);
        return json(502, { error: '内容源暂不可用，请稍后重试' }, method);
      }
    },
  };
}

export default createWorker();
