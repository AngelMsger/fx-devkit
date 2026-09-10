// A local-only static preview server; production output does not need Node.js.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const { base } = JSON.parse(await readFile(path.join(root, 'build-manifest.json'), 'utf8'));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith(base)) {
      response.writeHead(302, { Location: base }).end();
      return;
    }
    const file = path.resolve(root, `./${decodeURIComponent(url.pathname.slice(base.length))}`);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(file);
    if (info.isDirectory() && !url.pathname.endsWith('/')) {
      response.writeHead(301, { Location: `${url.pathname}/${url.search}` }).end();
      return;
    }
    const target = info.isDirectory() ? path.join(file, 'index.html') : file;
    const content = await readFile(target);
    response.writeHead(200, {
      'Content-Type': types[path.extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(content);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(
      await readFile(path.join(root, '404.html')).catch(() => 'Build the website first.'),
    );
  }
});
server.listen(4173, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:4173${base}`));
