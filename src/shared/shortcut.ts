/** 将 Electron accelerator 转成界面/托盘可读文案。 */
export function formatShortcutLabel(accelerator: string): string {
  return accelerator.replace(/CommandOrControl/g, 'Ctrl').replace(/\+/g, ' + ');
}
