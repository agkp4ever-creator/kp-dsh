/**
 * 本地更新源：把 release/ 以静态 HTTP 暴露，供 electron-updater 验证。
 * 用法：node scripts/serve-updates.mjs [--port 8787] [--root release]
 * 生产环境把 latest.yml 与安装包放到任意静态服务器即可，不需要 Node 常驻。
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const port = Number(readArg('--port', process.env.PORT ?? 8787));
const root = resolve(projectRoot, readArg('--root', 'release'));

const MIME = {
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.exe': 'application/octet-stream',
  '.zip': 'application/zip',
  '.blockmap': 'application/octet-stream',
};

const server = createServer((req, res) => {
  const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
  const pathname = decodeURIComponent(requestUrl.pathname);
  const relative = pathname === '/' ? 'latest.yml' : pathname.replace(/^\/+/, '');
  const file = normalize(join(root, relative));

  // 防目录穿越：解析后的路径必须仍在 root 内
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }

  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end(`not found: ${relative}`);
    return;
  }

  const stat = statSync(file);
  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`update server: http://127.0.0.1:${port}/`);
  console.log(`serving: ${root}`);
  console.log('在应用里设置 UPDATE_URL 或把 electron-builder.yml 的 publish.url 指向该地址');
});
