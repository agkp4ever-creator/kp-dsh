/**
 * 主题变量注入（P1-3）：六选项 + 深浅色方案。
 * tokens.css 按 [data-theme] 与 [data-scheme] 覆盖变量。
 * - minimal：极简黑白（锁定深色经典款）
 * - tomato / forest / ocean / lavender：主题色（随系统明暗自动切深/浅变体）
 * - system：跟随系统（极简风格 + 系统深浅色）
 */
import type { ThemeName, ThemeScheme } from '../../shared/types';

export type { ThemeName, ThemeScheme };

export type ThemePalette = 'minimal' | 'tomato' | 'forest' | 'ocean' | 'lavender';

/** 计算最终生效的配色族与明暗变体 */
export function resolveTheme(
  theme: ThemeName,
  scheme: ThemeScheme
): { palette: ThemePalette; variant: ThemeScheme } {
  if (theme === 'minimal') {
    return { palette: 'minimal', variant: 'dark' };
  }
  if (theme === 'system') {
    return { palette: 'minimal', variant: scheme };
  }
  return { palette: theme, variant: scheme };
}

/** 将主题应用到文档根节点（data-theme / data-scheme 驱动 CSS 变量覆盖） */
export function applyTheme(theme: ThemeName, scheme: ThemeScheme): void {
  if (typeof document === 'undefined') {
    return;
  }
  const resolved = resolveTheme(theme, scheme);
  document.documentElement.dataset.theme = resolved.palette;
  document.documentElement.dataset.scheme = resolved.variant;
}
