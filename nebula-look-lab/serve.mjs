import http from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
const ROOT = path.resolve(process.argv[2] || '/home/user/lab/static');
const PORT = Number(process.argv[3] || 8900);
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.wasm':'application/wasm','.woff2':'font/woff2','.map':'application/json'};
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) return res.writeHead(403).end();
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    res.writeHead(200, {'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': s.size, 'cache-control': 'no-store'});
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, {'content-type': 'application/json'}).end(JSON.stringify({code: 'STATIC_FILE_NOT_FOUND', path: rel}));
  }
}).listen(PORT, '127.0.0.1', () => console.log('static server on http://127.0.0.1:' + PORT + ' root=' + ROOT));
