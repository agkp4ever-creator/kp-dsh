# 番茄钟桌面挂件（MVP）

不打扰剪辑节奏的常驻桌面番茄钟小窗：240×240 透明无边框、置顶、不抢焦点、不占任务栏，到点仅「轻提示音 + 视觉变化」（无系统弹窗、无语音）。

技术栈：Electron 31 + electron-vite 2 + React 18 + TypeScript 5（纯 CSS 设计 token，无 UI 框架）。

## 环境要求

- Windows 10+（目标平台 22H2 x64）
- Node.js 18+（本机使用 managed Node 22）

### 本机环境注意事项（重要）

1. **`ELECTRON_RUN_AS_NODE=1` 必须清除**：WorkBuddy/VS Code 类终端会注入该变量，导致 Electron 以纯 Node 模式运行（`electron.app` 为 undefined，启动即崩）。启动前执行：
   ```powershell
   Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
   ```
2. **safe-delete shim 干扰构建（可选关闭）**：若构建时报 `[safe-delete][SAFE_DELETE_BULK_GUARD_ERROR] ... ENOENT`，执行 `$env:CODEBUDDY_SAFE_DELETE_ENABLED = '0'` 后重试。
3. **dev server 已固定 IPv4**：`electron.vite.config.ts` 中 renderer server 绑定 `127.0.0.1:5173`，避免 vite 只监听 `[::1]` 导致 Electron `ERR_CONNECTION_REFUSED`。

## 安装依赖

```powershell
cd D:\WorkbuddyDatas\2026-10-19-14-05-58\pomodoro_desktop_widget
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
npm install --registry=https://registry.npmmirror.com
```

## 启动 / 类型检查

```powershell
npm run dev         # 开发模式，弹出 240×240 挂件窗
npm run typecheck   # tsc --noEmit（node + web 两段），应 0 error
npm run build       # 仅构建产物到 out/（MVP 不含安装包打包）
```

## 测试与质量断言

```powershell
node tests/timer-settlement-assert.mjs    # 计时结算、设置变更重算
node tests/crash-recovery-assert.mjs     # 崩溃原因决策、退避、unresponsive 接线
node tests/window-mode-resize-assert.mjs  # 窗口模式/缩放静态约束
node tests/perf-hardening-assert.mjs      # 勿扰降频、崩溃恢复、日志轮转、CSP
node tests/theme-assert.mjs               # 六族配色、深浅变体、设置校验
$env:CHECK_BUILD_OUTPUT='1'; node tests/perf-hardening-assert.mjs  # 构建后校验产物 CSP
npm run test:assert                       # 一次跑完全部 node 断言
npm run test:e2e                          # 真实 Electron：冒烟 + 崩溃自愈专项
npm run test:upgrade                      # 真升级回归：安装 0.2.0 → 静默升级 0.2.1（会安装/卸载本机程序）
```

## 视觉主题

设置面板「视觉主题」提供 6 个选项，全部为低饱和毛玻璃风格：

| 选项 | 配色族 | 明暗 |
| --- | --- | --- |
| 极简黑白 | `minimal` | 锁定深色经典款 |
| 番茄红 | `tomato` | 随系统明暗（深 / 浅） |
| 森林绿 | `forest` | 随系统明暗（深 / 浅） |
| 深海蓝 | `ocean` | 随系统明暗（深 / 浅） |
| 薰衣草 | `lavender` | 随系统明暗（深 / 浅） |
| 跟随系统 | `system` | 极简风格 + 系统明暗 |

新增主题只需：在 `src/shared/types.ts` 的 `THEME_NAMES` 加名字 → `src/renderer/src/styles/tokens.css` 加深/浅两组变量 → `SettingsPanel.tsx` 的 `THEME_OPTIONS` 加标签。

第二批性能与健壮性要点：

- 勿扰前台探测按需调度：运行 10s / 空闲 60s / 隐藏 120s / 降级 300s；窗口 show/restore 后立即刷新。
- 主进程 tick 1000ms，渲染层用 `requestAnimationFrame` 按 `endsAt` 本地补间，每秒快照校正且不倒退。
- 渲染进程异常退出后 60s 内最多重建 3 次；重建互斥，重建期间 `window-all-closed` 不误退出。
- `sendToRenderer` 跳过已崩溃的 webContents；生产构建注入 CSP，开发模式不注入。
- 崩溃重建连续限流放弃后，托盘右键「重启界面」可手动恢复并清空限流预算。
- 主进程用上一 tick 快照检测 `Date.now()` 回拨（阈值 1s），回拨时按回拨前剩余重锚 `endsAt`，计时不会倒走。
- 日志超过 1MB 轮转，保留 2 份归档。

崩溃自愈增强（P0）：

- 渲染进程 `unresponsive` 先给 5s 宽限（E2E 可缩短），仍无响应则 `forcefullyCrashRenderer()`，走统一重建。
- 重建退避 300ms → 800ms → 1500ms；重建失败自动重试一次，仍失败则保留托盘「重启界面」手动入口。
- `launch-failed` / `integrity-failure` 同原因只重试一次，避免损坏的包反复重建；`killed` / `clean-exit` 不重建。
- 主进程 `uncaughtException` 写日志并弹窗退出，`unhandledRejection` 留痕，避免后台无窗口驻留。

## 测试钩子（QA 快速验证到点流转）

通过环境变量覆盖阶段时长（毫秒），未设置时按默认 25 分钟 / 60 分钟：

| 环境变量 | 作用 | 默认 |
| --- | --- | --- |
| `POMODORO_FOCUS_MS` | 覆盖「专注」阶段时长 | settings.focusMinutes（25 分） |
| `POMODORO_BREAK_MS` | 覆盖「短休/长休」阶段时长 | settings.shortBreakMinutes（60 分） |

PowerShell 示例（把专注与休息都缩到 8 秒）：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue   # 见上文环境注意事项
$env:POMODORO_FOCUS_MS = '8000'
$env:POMODORO_BREAK_MS = '8000'
npm run dev
```

验证步骤：

1. 点击「开始」→ 圆环开始递减、文案「专注中」。
2. 等 8 秒到点 → 听到轻提示音（单音），圆环变绿、自动进入休息倒计时。
3. 再等 8 秒休息到点 → 又一声轻提示（双音），回到「准备开始」，按钮变为「开始下一个番茄」。
4. 点「开始下一个番茄」→ 进入下一个专注。

（用完请关闭该终端或 `Remove-Item Env:POMODORO_FOCUS_MS`，避免影响正常时长。）

## 使用说明

- 顶栏可拖动挂件；「✕」退出应用（MVP 关窗即退出）。
- 「➖」最小化到 160×160 紧凑态：240↔160 尺寸与不透明度做 160ms 补间，收起后整窗不透明度降到 62%；点击紧凑窗恢复 240×240。
- 运行中：「暂停」「跳过」；暂停后：「继续」「重置」。
- 提示音音量/静音暂经设置默认值（volume=60、muted=false），无设置面板 UI。

## MVP 范围与已知未含功能

**已实现**：透明置顶挂件窗、timestamp 驱动番茄计时（开始/暂停/继续/重置/跳过、到点自动流转）、圆环+mm:ss 倒计时、到点轻提示音（Web Audio 合成，focusEnd/breakEnd 两种音色）+ 圆环变色/文案切换、设置持久化（`userData/pomodoro-data.json` 原子读写）、测试钩子。

**MVP 未含（后续任务 T04/T07/T08 全量）**：

- 托盘图标与右键菜单（显示/设置/退出）
- 开机自启（Settings 字段 `autoStartAtLogin` 已预留）
- 关窗最小化到托盘（常驻不退出）
- 今日统计（番茄数 / 累计专注时长展示与落盘）
- 设置面板 UI（时长微调 / 音量滑杆 / 静音 / 自启开关）
- 紧凑模式、主题切换 UI、护眼小贴士
- electron-builder 打包为 Windows NSIS 安装包

## 目录结构（MVP 子集）

```
pomodoro_desktop_widget/
├── package.json / electron.vite.config.ts / tsconfig*.json / index.html
└── src/
    ├── shared/    types.ts · constants.ts · format.ts
    ├── main/      index.ts · window.ts · timer.ts · ipc.ts · settings.ts · store.ts · logger.ts
    ├── preload/   index.ts（window.pomodoro 白名单 API）
    └── renderer/src/
        ├── main.tsx · App.tsx · audio.ts · env.d.ts
        ├── hooks/     useTimer.ts · useSettings.ts
        ├── components/ TitleBar.tsx · TimerRing.tsx · ControlBar.tsx
        └── styles/    tokens.css · global.css
```

## 数据与日志

- 持久化：`%APPDATA%/pomodoro_desktop_widget/pomodoro-data.json`（损坏自动回退默认值）
- 日志：`%APPDATA%/pomodoro_desktop_widget/logs/app.log`
