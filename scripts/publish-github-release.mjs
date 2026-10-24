/**
 * 创建 GitHub Release 并上传 Windows 更新资产。
 * 凭据优先级：GITHUB_TOKEN 环境变量 → git credential fill（不打印 token）。
 * 用法：node scripts/publish-github-release.mjs
 */
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { request } from 'node:https';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const version = pkg.version;
const tag = `v${version}`;
const owner = 'agkp4ever-creator';
const repo = 'kp-dsh';

const token =
  process.env.GITHUB_TOKEN?.trim() ||
  (() => {
    const out = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf-8',
    });
    const line = out.split(/\r?\n/).find((item) => item.startsWith('password='));
    if (line === undefined) {
      throw new Error('未找到 GitHub 凭据，请先登录 git 或设置 GITHUB_TOKEN');
    }
    return line.slice('password='.length);
  })();

const assets = [
  ['latest.yml', join(root, 'release', 'latest.yml')],
  [
    `pomodoro-widget-setup-${version}.exe`,
    join(root, 'release', `pomodoro-widget-setup-${version}.exe`),
  ],
  [
    `pomodoro-widget-setup-${version}.exe.blockmap`,
    join(root, 'release', `pomodoro-widget-setup-${version}.exe.blockmap`),
  ],
];

for (const [name, file] of assets) {
  if (!existsSync(file)) {
    throw new Error(`缺少发布资产：${name}`);
  }
}

async function github(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'pomodoro-widget-release',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(
      `GitHub API ${res.status} ${path}: ${typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300)}`
    );
  }
  return data;
}

async function releaseOrNull() {
  try {
    return await github(`/repos/${owner}/${repo}/releases/tags/${tag}`);
  } catch (err) {
    if (String(err.message).includes('404')) {
      return null;
    }
    throw err;
  }
}

function upload(releaseId, name, file) {
  return new Promise((resolve, reject) => {
    const size = statSync(file).size;
    const req = request(
      {
        hostname: 'uploads.github.com',
        path: `/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/octet-stream',
          'Content-Length': size,
          'User-Agent': 'pomodoro-widget-release',
        },
        timeout: 300_000,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(body));
          } else {
            reject(new Error(`上传 ${name} 失败 HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
          }
        });
      }
    );
    req.on('error', reject);
    const stream = createReadStream(file);
    stream.on('error', reject);
    stream.pipe(req);
  });
}

const body = `## 番茄钟桌面挂件 ${tag}

### 性能
- 计时圆环从 60fps rAF 改为 1fps 快照，隐藏窗口停止补间
- 勿扰探测降至运行 30s / 空闲 120s / 隐藏 300s / 降级 600s；提醒前即时探测

### 发布
- 补齐项目介绍、截图与版本更新日志
- 安装版自动更新源切换为 GitHub Releases

### 安装
下载 \`pomodoro-widget-setup-${version}.exe\`。安装包未签名，Windows SmartScreen 可能提示“未知发布者”，选择“仍要运行”即可。`;

let release = await releaseOrNull();
if (release === null) {
  console.log(`创建 Release ${tag} ...`);
  release = await github(`/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: 'main',
      name: `${tag} · 性能优化与项目介绍`,
      body,
      draft: false,
      prerelease: false,
    }),
  });
} else {
  console.log(`Release ${tag} 已存在，复用 #${release.id}`);
}

const existing = new Map((release.assets ?? []).map((asset) => [asset.name, asset]));
for (const [name, file] of assets) {
  if (existing.has(name)) {
    console.log(`跳过已存在资产 ${name}`);
    continue;
  }
  console.log(`上传 ${name}（${(statSync(file).size / 1024 / 1024).toFixed(1)} MB）...`);
  await upload(release.id, name, file);
}

const final = await github(`/repos/${owner}/${repo}/releases/tags/${tag}`);
console.log(`\nRelease: ${final.html_url}`);
for (const asset of final.assets ?? []) {
  console.log(`  - ${asset.name}  ${(asset.size / 1024 / 1024).toFixed(1)} MB`);
}

const latest = (final.assets ?? []).find((asset) => asset.name === 'latest.yml');
if (latest !== undefined) {
  const res = await fetch(latest.browser_download_url, { method: 'HEAD' });
  if (!res.ok) {
    throw new Error(`latest.yml 下载校验失败：HTTP ${res.status}`);
  }
  console.log(`latest.yml 下载校验：HTTP ${res.status}`);
}
