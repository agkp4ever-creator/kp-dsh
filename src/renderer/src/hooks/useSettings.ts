/**
 * useSettings：启动拉取 settings:get，订阅 settings:changed，提交局部更新。
 */
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS } from '../../../shared/constants';
import type { Settings } from '../../../shared/types';

export interface UseSettingsResult {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    let disposed = false;
    void window.pomodoro.settings.get().then((result) => {
      if (!disposed && result.ok && result.data) {
        setSettings(result.data);
      }
    });
    const unsubscribe = window.pomodoro.settings.onChanged((next) => {
      setSettings(next);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    void window.pomodoro.settings.update(patch);
  }, []);

  return { settings, update };
}
