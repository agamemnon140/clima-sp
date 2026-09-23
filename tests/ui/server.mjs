import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('docs');
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!target.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try { const body = await readFile(target); response.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream' }); response.end(body); }
  catch { response.writeHead(404).end(); }
}).listen(8765, '127.0.0.1');
