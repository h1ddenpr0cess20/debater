import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function createStaticMiddleware(root) {
  const base = root.endsWith(sep) ? root : root + sep;

  async function read(path) {
    let name;
    try {
      name = decodeURIComponent(path);
    } catch {
      return null;
    }

    const file = join(base, normalize(name));
    if (!file.startsWith(base)) return null;
    try {
      if (!(await stat(file)).isFile()) return null;
      return { file, body: await readFile(file) };
    } catch {
      return null;
    }
  }

  return async function serveStatic(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const path = req.url.split('?')[0];
    const immutable = path.startsWith('/assets/');
    const found = (await read(path)) ?? (extname(path) ? null : await read('/index.html'));

    if (!found) return next();

    res.writeHead(200, {
      'content-type': MIME[extname(found.file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'content-length': found.body.length,
    });
    res.end(req.method === 'HEAD' ? undefined : found.body);
  };
}
