/**
 * AutostartService：开机自启封装（app.setLoginItemSettings）。
 * 默认开启（决议 #4）；随设置 autoStartAtLogin 联动。
 */
import { app } from 'electron';
import { logger } from './logger';

export class AutostartService {
  /** 开启开机自启 */
  enable(): void {
    this.apply(true);
  }

  /** 关闭开机自启 */
  disable(): void {
    this.apply(false);
  }

  /** 当前是否已注册登录项 */
  isEnabled(): boolean {
    try {
      return app.getLoginItemSettings().openAtLogin;
    } catch (err) {
      logger.error('read login item failed', err);
      return false;
    }
  }

  /** 按设置值同步登录项（幂等，重复调用无副作用） */
  apply(enabled: boolean): void {
    try {
      app.setLoginItemSettings({ openAtLogin: enabled });
      logger.info(`autostart ${enabled ? 'enabled' : 'disabled'}`);
    } catch (err) {
      logger.error('set login item failed', err);
    }
  }
}
