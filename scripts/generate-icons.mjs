/**
 * 程序生成图标素材（无外部素材依赖）：
 *   assets/icons/tray.png —— 16x16 托盘图标
 *   assets/icons/app.ico  —— 多尺寸应用/安装包图标（16/32/48/64/128/256，PNG 内嵌 ICO）
 * 运行：node scripts/generate-icons.mjs
 * 同时产出 src/main/trayIcon.ts（托盘 base64 内联常量，勿手改）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ICO_SIZES = [16, 32, 48, 64, 128, 256];

/** CRC32（PNG 规范附录 D） */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = c >>> 1 ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 绘制 SxS：近黑圆角底、白色细圆环、顶部番茄红进度点（比例恒定，任意尺寸清晰） */
function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const cardR = size * 0.49;
  const ringInner = size * 0.275;
  const ringOuter = size * 0.394;
  const cornerMin = Math.max(1, size * 0.06);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = (y * size + x) * 4;
      // 背景：近黑圆角块（四角透明）
      const corner = Math.min(x, y, size - 1 - x, size - 1 - y);
      const insideCard = dist < cardR && corner > 0;
      if (!insideCard) {
        rgba[idx + 3] = 0;
        continue;
      }
      // 深底
      rgba[idx] = 20;
      rgba[idx + 1] = 20;
      rgba[idx + 2] = 20;
      rgba[idx + 3] = 235;
      void cornerMin;
      // 圆环
      if (dist >= ringInner && dist <= ringOuter) {
        const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI; // -90 为正上方
        const isTop = angleDeg > -100 && angleDeg < -80;
        if (isTop) {
          rgba[idx] = 0xe8;
          rgba[idx + 1] = 0x50;
          rgba[idx + 2] = 0x3a;
          rgba[idx + 3] = 255;
        } else {
          rgba[idx] = 0xf5;
          rgba[idx + 1] = 0xf5;
          rgba[idx + 2] = 0xf5;
          rgba[idx + 3] = 255;
        }
      }
    }
  }
  return encodePng(size, size, rgba);
}

/** PNG 帧序列 → ICO 容器（PNG 内嵌，Windows Vista+ 兼容） */
function encodeIco(pngFrames) {
  const count = pngFrames.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + count * 16;
  for (const { size, data } of pngFrames) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bit count
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...pngFrames.map((f) => f.data)]);
}

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(projectRoot, 'assets', 'icons');
mkdirSync(outDir, { recursive: true });

// 1) 托盘 16x16 PNG
const trayPng = drawIcon(16);
const trayFile = join(outDir, 'tray.png');
writeFileSync(trayFile, trayPng);
console.log(`written: ${trayFile} (${trayPng.length} bytes)`);

// 2) app.ico 多尺寸
const frames = ICO_SIZES.map((size) => ({ size, data: drawIcon(size) }));
const ico = encodeIco(frames);
const icoFile = join(outDir, 'app.ico');
writeFileSync(icoFile, ico);
console.log(`written: ${icoFile} (${ico.length} bytes, sizes=${ICO_SIZES.join('/')})`);

// 3) 托盘图标内联常量模块（避免手工拷贝 base64 出错）
const base64 = trayPng.toString('base64');
const tsFile = join(projectRoot, 'src', 'main', 'trayIcon.ts');
const tsSource = `/**
 * 托盘图标内联常量（由 scripts/generate-icons.mjs 生成，勿手改）。
 * 对应产物：assets/icons/tray.png（16x16 深底白圆环 + 番茄红进度点）。
 */
export const TRAY_ICON_PNG_BASE64 = '${base64}';
`;
writeFileSync(tsFile, tsSource, 'utf-8');
console.log(`written: ${tsFile}`);
