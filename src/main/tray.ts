/**
 * TrayService：托盘图标与右键菜单（显示挂件 / 设置 / 退出）。
 * 退出为唯一真退出口（决议 #4：常驻不退出，托盘「退出」仅作维护出口）。
 * 图标为程序生成的 16x16 占位（内联 base64，无外部素材）。
 */
import { Menu, Tray, nativeImage, type BrowserWindow } from 'electron';
import { APP_TITLE } from '../shared/constants';
import { logger } from './logger';
import { TRAY_ICON_PNG_BASE64 } from './trayIcon';

export interface TrayDeps {
  /** 显示挂件（不抢焦点） */
  showWindow: () => void;
  /** 打开设置面板（显示窗口 + 切 settings 模式） */
  openSettings: () => void;
  /** 真退出（置 isQuitting 后 app.quit） */
  requestQuit: () => void;
  /** 打开设置页并检查更新（安装版） */
  checkForUpdates: () => void;
  /** 用户主动重建渲染窗口（崩溃限流放弃后的手动恢复入口） */
  restartWindow: () => void;
  /** 从紧凑态展开为普通态（穿透后托盘/快捷键的唤回入口） */
  expandWindow: () => void;
  /** 供菜单刷新时读取窗口（保留扩展点） */
  getWindow: () => BrowserWindow | null;
}

export class TrayService {
  private tray: Tray | null = null;
  private readonly deps: TrayDeps;

  constructor(deps: TrayDeps) {
    this.deps = deps;
  }

  /** 创建托盘图标与右键菜单（幂等） */
  init(): void {
    if (this.tray !== null) {
      return;
    }
    const image = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_PNG_BASE64}`);
    this.tray = new Tray(image);
    this.tray.setToolTip(APP_TITLE);
    this.setMenu();
    // Windows 托盘惯例：双击显示挂件；紧凑态穿透后这是主要唤回入口
    this.tray.on('double-click', () => {
      this.deps.expandWindow();
    });
    logger.info('tray initialized');
  }

  /** 刷新右键菜单 */
  setMenu(): void {
    if (this.tray === null) {
      return;
    }
    const menu = Menu.buildFromTemplate([
      { label: '显示挂件', click: () => this.deps.showWindow() },
      { label: '展开挂件', click: () => this.deps.expandWindow() },
      {
        label: '设置',
        click: () => {
          this.deps.openSettings();
        },
      },
      { label: '检查更新', click: () => this.deps.checkForUpdates() },
      // 崩溃重建连续失败后，托盘是用户唯一能看到并手动恢复的入口
      { label: '重启界面', click: () => this.deps.restartWindow() },
      { type: 'separator' },
      { label: '退出', click: () => this.deps.requestQuit() },
    ]);
    this.tray.setContextMenu(menu);
  }

  /** 更新悬停提示（例如界面停止后引导用户从托盘重启） */
  setToolTip(text: string): void {
    this.tray?.setToolTip(text);
  }

  /** 首次进入紧凑态时提示唤回方式；专注助手可能拦截气泡，失败不影响功能 */
  showCompactHint(): void {
    if (this.tray === null || process.platform !== 'win32') {
      return;
    }
    try {
      this.tray.displayBalloon({
        title: APP_TITLE,
        content: '紧凑态已鼠标穿透：双击托盘、托盘菜单「展开挂件」或按 Ctrl+Alt+P 展开。',
        iconType: 'info',
      });
    } catch (err) {
      logger.warn(`tray balloon failed: ${String(err)}`);
    }
  }

  dispose(): void {
    if (this.tray !== null) {
      this.tray.destroy();
      this.tray = null;
      logger.info('tray disposed');
    }
  }
}
