// Transparent recording proxy: forwards to the live v4 server on 8836 and
// appends every /api/ request it sees to a log, byte-exact.
import http from 'node:http';
import {appendFileSync, writeFileSync} from 'node:fs';

const UP = 'http://127.0.0.1:8836';
const PORT = Number(process.env.PROXY_PORT || 8837);
const LOG = process.env.PROXY_LOG || '/home/user/lab/recorded/test-traffic.ndjson';
writeFileSync(LOG, '');

http.createServer(async (req, res) => {
  const target = new URL(req.url, UP);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: {...req.headers, host: '127.0.0.1:8836'},
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
      redirect: 'manual',
    });
  } catch (e) {
    res.writeHead(502).end(String(e));
    return;
  }
  const buf = Buffer.from(await upstream.arrayBuffer());
  const headers = {};
  upstream.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) headers[k] = v; });
  res.writeHead(upstream.status, headers);
  res.end(buf);

  appendFileSync(LOG, JSON.stringify({
    method: req.method,
    path: req.url,
    status: upstream.status,
    bytes: buf.length,
    // Record the body only for API calls; static assets are copied wholesale.
    body: req.url.startsWith('/api/') ? buf.toString('utf8') : undefined,
  }) + '\n');
}).listen(PORT, '127.0.0.1', () => console.log('recording proxy on ' + PORT));
