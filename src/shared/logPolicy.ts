/**
 * 日志轮转策略（纯函数，供主进程 logger 与 node 断言共用）。
 *
 * Electron 挂件长期常驻，app.log 会无限增长；超过上限时归档为 app.log.1，
 * 旧归档顺延，最多保留 LOG_KEEP_ARCHIVES 份。
 */
export const LOG_MAX_BYTES = 1024 * 1024;
export const LOG_KEEP_ARCHIVES = 2;

export function shouldRotateLog(
  sizeBytes: number,
  maxBytes: number = LOG_MAX_BYTES
): boolean {
  if (Number.isNaN(sizeBytes) || !Number.isFinite(maxBytes) || maxBytes <= 0) {
    return false;
  }
  // Infinity 表示文件异常大，应继续轮转而不是静默跳过
  return sizeBytes >= maxBytes;
}
