/**
 * 极简日志：info/warn/error 三级，追加写 userData/logs/app.log，永不抛出。
 * 按大小轮转（默认 1MB，保留 2 份归档），避免常驻挂件日志无限增长。
 */
import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { LOG_KEEP_ARCHIVES, shouldRotateLog } from '../shared/logPolicy';

let started = false;

function logFilePath(): string {
  return join(app.getPath('userData'), 'logs', 'app.log');
}

/** 归档一份文件（覆盖同名旧归档），失败由调用方兜底 */
function archive(from: string, to: string): void {
  if (!existsSync(from)) {
    return;
  }
  if (existsSync(to)) {
    unlinkSync(to);
  }
  renameSync(from, to);
}

/** 超过上限时滚动：app.log.N → app.log.N+1，app.log → app.log.1；轮转失败不阻断写入 */
function rotateIfNeeded(file: string): void {
  try {
    if (!existsSync(file) || !shouldRotateLog(statSync(file).size)) {
      return;
    }
    for (let i = LOG_KEEP_ARCHIVES - 1; i >= 1; i -= 1) {
      archive(`${file}.${i}`, `${file}.${i + 1}`);
    }
    archive(file, `${file}.1`);
  } catch {
    /* 轮转失败（占用/权限/并发删除）只跳过轮转，本次日志仍尝试追加 */
  }
}

function write(level: string, message: string): void {
  const line = `[${new Date().toISOString()}] [${level}] ${message}`;
  try {
    console.log(line);
  } catch {
    /* 忽略控制台异常（GBK 环境也不中断） */
  }
  try {
    const file = logFilePath();
    mkdirSync(join(file, '..'), { recursive: true });
    rotateIfNeeded(file);
    appendFileSync(file, `${line}\n`, 'utf-8');
  } catch {
    /* 日志落盘失败不得影响业务 */
  }
}

export const logger = {
  startup(version: string): void {
    if (started) {
      return;
    }
    started = true;
    write('INFO', `app start version=${version}`);
  },
  info(message: string): void {
    write('INFO', message);
  },
  warn(message: string): void {
    write('WARN', message);
  },
  error(message: string, err?: unknown): void {
    if (err === undefined) {
      write('ERROR', message);
    } else {
      write('ERROR', `${message} :: ${String(err)}`);
    }
  },
};
