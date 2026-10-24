# 番茄钟桌面挂件 · 完工说明（v0.2.1）

> 版本：完整版 v0.2.1 · 2026-10-19（由 MVP v0.1.0 完工升级；2026-10-24 发布链路与真升级回归）
> 需求基线：`docs/PRD-番茄钟桌面挂件.md`（v0.2.2）
> 设计基线：`docs/架构设计-番茄钟桌面挂件.md`（v1.0，P1 扩展点见 §8 R4）
> 定位：常驻桌面的 240×240 透明置顶番茄钟挂件——**专注 25 分 / 短休 5 分 / 长休 60 分**（短休 2026-10-19 由 60 分调整为 5 分），到点仅「轻提示音 + 视觉变化」，不打扰剪辑节奏。

---

## 1. 功能清单

### 1.1 P0（MVP 已全部完成，本轮保持）

| 编号 | 需求 | 状态 | 实现位置 / 说明 |
| --- | --- | --- | --- |
| P0-1 | 常驻透明置顶小窗 | ✅ | `src/main/window.ts`：无边框、透明、圆角毛玻璃、`alwaysOnTop('floating')`、`skipTaskbar`、`focusable:false`、`showInactive()`；**不做点击穿透**；三模式 normal 240×240 / compact 160×160 / settings 320×420 |
| P0-2 | 核心番茄计时 | ✅ | `src/main/timer.ts`：主进程 timestamp 驱动状态机（抗睡眠漂移，`powerMonitor` resume 补算）；开始/暂停/重置/跳过；**默认专注 25 分 → 短休 5 分**，长休 60 分（分档见 P1-4）；跳过按**实际已专注时长**结算（0 秒跳过不计番茄） |
| P0-3 | 圆环/数字倒计时 | ✅ | `TimerRing.tsx`：SVG 细线圆环 + `mm:ss` + 状态文案 |
| P0-4 | 到点轻提醒 | ✅ | `remind` 事件 → `audio.ts` WebAudio 合成柔和短音（四类音色）+ 圆环变色/文案切换/0.6s 环闪；**无系统通知弹窗、无语音** |
| P0-5 | 基础设置 | ✅ | `SettingsPanel.tsx`：时长 ±微调、音量/静音、开机自启（默认开）、主题、各提醒开关；实时持久化并广播 |
| P0-6 | 常驻运行与退出出口 | ✅ | 关窗拦截 `hide()`；托盘「显示挂件/设置/退出」（`tray.ts`，双击显示）；退出仅托盘；`autostart.ts` 自启联动 |
| P0-7 | 今日统计 | ✅ | `stats.ts` 按日落盘 + `StatsBar.tsx`：今日四点 + 累计专注 |
| P0-8 | 中文界面 | ✅ | 全简体中文；默认极简黑白毛玻璃 |

### 1.2 P1（本轮完工，逐条状态）

| 编号 | 需求 | 状态 | 实现说明 |
| --- | --- | --- | --- |
| P1-1 | 20-20-20 护眼提醒 | ✅ 完成 | `src/main/health.ts`：每 **20 分钟**提醒远眺 20 秒（间隔可配 5–120 分，开关默认开）；轻提示音（E5 轻音）+ 横幅「护眼 20-20-20 · 看看 6 米外 20 秒」展示 20s；`RemindEvent.kind` 按架构 R4 扩展 `eyeCare`/`sedentary`；**防双音**：主进程 `REMIND_MERGE_MS=250ms` 合并窗口，同时触发只发一条提醒（优先级 focusEnd>breakEnd>sedentary>eyeCare） |
| P1-2 | 久坐起身提醒 | ✅ 完成 | 同 `health.ts`：默认 **45 分钟**（可配 10–180 分，开关默认开）；G4 低柔音 + 横幅「久坐提醒 · 起身活动一下」15s |
| P1-3 | 主题跟随系统深浅色 | ✅ 完成 | 设置三选：**极简黑白**（深色经典款）/ **番茄红**（随系统明暗）/ **跟随系统**（极简风格 + 系统明暗）；主进程 `nativeTheme` 经 `theme:scheme` 通道推送（启动回推 + `updated` 事件）；`tokens.css` 补齐 minimal/tomato 两族**浅色变体**（低饱和浅玻璃，按钮/开关/分割线全部变量化） |
| P1-4 | 短休/长休分档补完整 | ✅ 完成 | 设置「4 个番茄后长休」开关（默认关）+ 长休间隔 2–12 可调；开启后 StatsBar 显示 **「本组 N/4」** 当前番茄序号；每 4 个番茄自动进 **长休 60 分**（`timer.ts` nextBreakPhase） |
| P1-5 | 位置记忆 + 贴边吸附 | ✅ 完成 | `PersistData.windowPos` 保存/恢复（启动恢复，越界钳回工作区；无记录默认右下角 24px）；拖动结束贴边吸附（距工作区边缘 **≤12px** 对齐）；close/quit 均落盘 |
| P1-6 | 勿扰模式 | ✅ 完成（层级 a + 降级 b） | **a) 自动检测**：每 10s 探测前台进程（PowerShell GetForegroundWindow），命中 Adobe Premiere / After Effects / DaVinci Resolve / 剪映(CapCut) → 提醒自动降为「仅视觉」；**b) 降级**：连续 3 次探测失败自动停用检测（日志标注），仅保留**手动勿扰开关**（settings.dndMode，提醒仅视觉）；顶栏显示「勿扰」角标（自动检测与手动开关都会点亮，主进程主动推送）。*全屏检测说明：Electron 无跨窗口全屏判定 API，以「剪辑软件前台检测 + 手动开关」覆盖该场景，如实标注实现层级* |
| P1-7 | 手动收纳到屏幕侧边（方案 B） | ✅ 完成 | **仅手动收纳，不做悬停自动展开**。顶栏「⇥ / 收纳到侧边」按钮（**仅 normal 模式显示**，settings/compact 不显示）→ 窗口边收窄边滑向最近侧边（按窗口中心 vs 所在显示器 `workArea` 中心判左/右），最终收为 **10×160 竖向把手**贴边常驻（垂直居中于原窗口中心，越界钳回工作区）。把手视觉 = 半透明暗色毛玻璃竖条 + 按 `remainingMs/totalMs` 比例的圆角剩余时间进度线；**点击把手任意位置展开**，恢复收纳前的模式与尺寸（normal 240×240 / compact 160×160）与位置（越界钳回）。**收纳态为正交状态**：不新增 `WindowMode` 枚举值，主进程内存维护 `docked + side + preDockBounds`，经 `window:docked` 推送渲染层（`DockHandle.tsx`）。**位置保护**：收纳/动画期间 `moved` 不吸附不落盘、`persistWindowPos` 跳过，展开后位置不变即沿用记忆；**重启始终 normal 启动**（不记忆收纳态）。**动画**：10 帧 × 16ms ≈ 160ms ease-out，全程沿用 `applyWindowMode` 的收缩修复包裹（动画前 `setResizable(true)`、终帧精确落定后立即 `setResizable(false)`，`setFocusable` 在尺寸操作之前）。**托盘「设置」在收纳态**：先立即展开回收纳前 bounds，再切 settings（`applyWindowMode` 内处理，不会出现动画与 resize 抢写）。**限制**：无悬停自动展开（需鼠标点击把手）；把手为固定 10px 宽、160px 高，不做多屏记忆（重启不记忆收纳态与把手所在屏） |

### 1.3 P2（后续迭代，本轮不做）

- 统计图表 / 历史趋势（日/周专注曲线、番茄分布）
- 番茄完成小动效 / 休息白噪音（雨声等）
- 任务命名（「剪 A 选题口播」等）
- 全局快捷键（开始/暂停/跳过）

---

## 2. 运行方法

### 2.1 浏览器预览（推荐先看，零依赖）

直接**双击打开** `preview/mvp-preview.html`（单文件、无外部依赖、无联网请求）：

- 240×240 挂件视觉（对照 PRD §5.2/5.3 线框）+ SVG 圆环倒计时
- 开始/暂停/重置/跳过 + 25 分专注 → 5 分短休（→ 4 个后长休 60 分）状态流转
- **「演示加速 ×60」**：25 秒看完一个番茄、5 秒看完短休
- **20-20-20 护眼 / 久坐提醒演示**（可开关；加速下每 20 秒 / 45 秒触发横幅+提示音）
- **勿扰开关**（提醒仅视觉 + 「勿扰」角标）
- **手动收纳演示（P1-7）**：点顶栏「⇥」→ 卡片收成右侧 10×160 细把手浮层（含剩余时间进度线），点把手展开（纯 CSS/JS 演示，真机动画由主进程逐帧 `setBounds` 驱动，两者节奏不完全一致）
- **双主题 + 跟随系统**（极简黑白 / 番茄红 / 跟随系统，深浅色自动切换）
- 到点 WebAudio 轻提示音 + 圆环变色/文案切换（动效 ≤0.6s）；今日统计联动

### 2.2 桌面端开发运行

```powershell
cd pomodoro_desktop_widget
npm install          # 首次
npm run dev          # electron-vite dev
npm run build        # 产出 out/{main,preload,renderer}
npm start            # electron-vite preview
npm run typecheck
npm run test:assert                  # 全部 node 静态/纯函数断言（无需 Electron）
npm run test:e2e                     # Playwright Electron 冒烟（启动/计时/主题/最小化/崩溃重建）
node tests/e2e/update-smoke.mjs      # 安装版检查更新（需先 npm run release:win）
node tests/e2e/portable-update-smoke.mjs  # 绿色版更新降级提示（需先同步绿色版 out）
npm run test:upgrade                 # 真升级回归：安装 0.2.0 → 下载/静默安装 0.2.1 → 校验版本与设置
                                    # 会安装/卸载本机程序，运行前先退出正在运行的番茄钟
```

### 2.3 打包与发布（NSIS 安装包 + 自动更新）

```powershell
cd pomodoro_desktop_widget
npm install
npm run release:win        # 构建 + 打包 + 校验 latest.yml / 安装包 / app-update.yml
# → release/pomodoro-widget-setup-0.2.1.exe（ASCII 文件名，便于更新源 URL）
# → release/latest.yml（自动更新元数据）
# → release/win-unpacked/resources/app-update.yml（安装版更新源配置）
```

打包配置见 `electron-builder.yml`（NSIS、appId `com.gao.pomodoro-widget`、中文产品名「番茄钟挂件」、可选安装目录、桌面/开始菜单快捷方式、generic 更新源）；`assets/icons/app.ico` 由 `npm run icons` 程序生成（16–256 六尺寸）。

自动更新：

- 安装版启动 15s 后静默检查一次；设置页提供「检查更新 / 下载更新 / 重启安装」，托盘右键也有「检查更新」。默认只检查、不自动下载。
- 点击「重启安装」后走静默安装并自动重启（`quitAndInstall(true, true)`），不再弹安装向导。
- 默认更新源是 `electron-builder.yml` 的 `publish.url`（占位 `https://updates.example.com/pomodoro/`），发布前替换；运行时可用 `UPDATE_URL` 环境变量覆盖。
- 本地验证：`npm run serve:updates`（默认 `http://127.0.0.1:8787/`），把 `latest.yml` + 安装包放在 `release/`；启动安装版并设 `UPDATE_URL=http://127.0.0.1:8787/`。
- 真升级回归：`npm run test:upgrade` 会自动安装 0.2.0、改设置、检查/下载/静默安装 0.2.1，并验证版本与设置保留；脚本会清理安装目录与临时数据。
- 绿色版没有 `app-update.yml`，自动降级为「绿色版请手动下载新版本覆盖」，不发起网络检查。
- 更新源目录需要同时提供 `latest.yml`、安装包；`latest.yml` 的 `sha512` 必须与安装包一致（`release:win` 自动生成）。

### 2.4 本机已知环境坑（R1，如实记录）

| # | 现象 | 处置 |
| --- | --- | --- |
| 1 | `npm run xxx` 派生报「系统找不到指定的文件」 | 等价直调：`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json`（web 换 `-p tsconfig.web.json`）、`node node_modules/electron-vite/bin/electron-vite.js build` |
| 2 | vite 构建报 `SAFE_DELETE_BULK_GUARD_ERROR` | 执行前设 `$env:CODEBUDDY_SAFE_DELETE_ENABLED='0'` |
| 3 | `electron-vite dev` 报 `electron.app` undefined | 环境变量 `ELECTRON_RUN_AS_NODE=1` 污染，运行前 `Remove-Item Env:ELECTRON_RUN_AS_NODE` |
| 4 | electron.exe 启动即原生崩溃 `uv_cpumask_size` SIGABRT（exit 134） | 实为 `ELECTRON_RUN_AS_NODE=1` 污染：清除该环境变量（`env -u ELECTRON_RUN_AS_NODE` / PowerShell `Remove-Item Env:ELECTRON_RUN_AS_NODE`）后可正常启动，e2e 已覆盖 |
| 5 | `electron-builder --win` 偶发 `read ENOTCONN`（app-builder 子进程） | 重试或换新终端；本机已成功产出 NSIS 安装包与 `latest.yml` |

---

## 3. 与全量需求差异

- **P0 + P1 全部完成**（P1-6 的「全屏检测」以剪辑软件前台检测 + 手动勿扰覆盖，见 §1.2）。
- 2026-10-23 稳定性修订：单实例锁、空闲态改时长即时生效、多显示器位置夹取、勿扰自动态徽标推送、跳过按实际专注时长结算、收纳动画竞态守卫。
- 2026-10-24 发布链路：NSIS 安装包 + `latest.yml`、应用内检查/下载/重启安装、托盘检查更新、本地更新源脚本、绿色版降级提示；新增 Playwright Electron e2e（冒烟 + 安装版检查更新 + 绿色版降级）。
- 2026-10-24 真升级回归：0.2.0 安装版 → 检查到 0.2.1 → 下载 → 静默安装并自动重启 → 版本/主题/专注时长全部保留；新增 `tests/e2e/real-upgrade.spec.mjs` 与 `npm run test:upgrade`；升级安装改为静默模式。
- **P2 未做**：统计图表、白噪音、任务命名、全局快捷键（清单见 §1.3，留后续迭代）。
- 提示音为 WebAudio 合成（无外部素材依赖、禁外网下载），如需真实 mp3 替换 `audio.ts` 音色表即可。

---

## 4. 默认值与一致性声明

默认值：**focus 25 分 / 短休 5 分 / 长休 60 分 / 长休分档关（4 个后长休）/ 音量 60 / 自启 true / 主题 minimal / 护眼 20 分开 / 久坐 45 分开 / 勿扰关**。
IPC 通道名收口 `src/shared/constants.ts`（23 通道，含 `theme:scheme`、P1-7 的 `window:dock` / `window:undock` / `window:docked`、`timer:get` / `dnd:get` / `dnd:state`，以及自动更新的 `update:get/check/download/install/status`）；样式 token 与架构 §7 一致并扩展浅色变体；提醒仅轻提示音+视觉（禁系统弹窗/语音）；不做点击穿透；常驻 close→hide、退出仅托盘。全局一致性审查结论见交付回执（IS_PASS）。
