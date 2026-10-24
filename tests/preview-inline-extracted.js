(function () {
        'use strict';

        // ---------- 常量（与 src/shared 保持一致） ----------
        var MINUTE_MS = 60000;
        var FOCUS_MINUTES = 25;
        var BREAK_MINUTES = 5;
        var LONG_BREAK_MINUTES = 60;
        var LONG_BREAK_EVERY = 4;
        var TICK_MS = 250;
        var RADIUS = 52;
        var CIRCUMFERENCE = 2 * Math.PI * RADIUS;
        var REMIND_FLASH_MS = 600;
        var REMIND_MERGE_MS = 250;

        // ---------- 状态 ----------
        var phase = 'focus'; // focus | shortBreak | longBreak
        var status = 'idle'; // idle | running | paused
        var remainingMs = FOCUS_MINUTES * MINUTE_MS;
        var totalMs = remainingMs;
        var endsAt = null;
        var completedPomodoros = 0;
        var cyclePomodoros = 0;
        var focusMsTotal = 0;
        var fastMode = false;
        var soundOn = true;
        var dndOn = false;
        var eyeOn = true;
        var sedOn = true;
        var tieredOn = false;
        var themeChoice = 'minimal'; // minimal | tomato | system
        var systemScheme = 'dark';
        var remindUntil = 0;
        var lastEyeAt = Date.now();
        var lastSedAt = Date.now();
        var docked = false;

        // ---------- DOM ----------
        var widget = document.getElementById('widget');
        var titleText = document.getElementById('titleText');
        var statusDot = document.getElementById('statusDot');
        var dndBadge = document.getElementById('dndBadge');
        var timeText = document.getElementById('timeText');
        var captionText = document.getElementById('captionText');
        var ringProgress = document.getElementById('ringProgress');
        var timerRing = document.getElementById('timerRing');
        var healthBanner = document.getElementById('healthBanner');
        var controlBar = document.getElementById('controlBar');
        var tipLine = document.getElementById('tipLine');
        var statsDots = document.getElementById('statsDots');
        var statsFocus = document.getElementById('statsFocus');
        var statsCycle = document.getElementById('statsCycle');
        var cycleDivider = document.getElementById('cycleDivider');
        var phaseText = document.getElementById('phaseText');
        var fastToggle = document.getElementById('fastToggle');
        var muteToggle = document.getElementById('muteToggle');
        var dndToggle = document.getElementById('dndToggle');
        var eyeToggle = document.getElementById('eyeToggle');
        var sedToggle = document.getElementById('sedToggle');
        var tieredToggle = document.getElementById('tieredToggle');
        var themePicker = document.getElementById('themePicker');
        var btnResetAll = document.getElementById('btnResetAll');
        var btnDock = document.getElementById('btnDock');
        var dockHandle = document.getElementById('dockHandle');
        var dockProgress = document.getElementById('dockProgress');

        // ---------- 时间格式化（与 shared/format.ts 一致） ----------
        function pad2(v) {
          return String(v).padStart(2, '0');
        }

        function formatMmSs(ms) {
          var safe = Number.isFinite(ms) ? Math.max(0, ms) : 0;
          var totalSeconds = Math.ceil(safe / 1000);
          return pad2(Math.floor(totalSeconds / 60)) + ':' + pad2(totalSeconds % 60);
        }

        function formatDurationMs(ms) {
          var safe = Number.isFinite(ms) ? Math.max(0, ms) : 0;
          var totalMinutes = Math.floor(safe / MINUTE_MS);
          var h = Math.floor(totalMinutes / 60);
          var m = totalMinutes % 60;
          return h > 0 ? h + 'h' + pad2(m) + 'm' : m + 'm';
        }

        // ---------- WebAudio 轻提示音（与 src/renderer/src/audio.ts 同源） ----------
        var audioCtx = null;

        function getAudioContext() {
          var Ctor = window.AudioContext || window.webkitAudioContext;
          if (!Ctor) {
            return null;
          }
          if (audioCtx === null) {
            audioCtx = new Ctor();
          }
          return audioCtx;
        }

        function scheduleTone(ctx, startTime, frequency, duration, peak) {
          var oscillator = ctx.createOscillator();
          var gain = ctx.createGain();
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(frequency, startTime);
          var floor = 0.0001;
          var attack = Math.min(0.06, duration * 0.2);
          var release = Math.min(0.25, duration * 0.5);
          var sustain = Math.max(peak, floor * 2);
          gain.gain.setValueAtTime(floor, startTime);
          gain.gain.exponentialRampToValueAtTime(sustain, startTime + attack);
          gain.gain.setValueAtTime(sustain, startTime + duration - release);
          gain.gain.exponentialRampToValueAtTime(floor, startTime + duration);
          oscillator.connect(gain);
          gain.connect(ctx.destination);
          oscillator.start(startTime);
          oscillator.stop(startTime + duration + 0.02);
        }

        function playRemind(kind) {
          if (!soundOn || dndOn) {
            return;
          }
          var ctx = getAudioContext();
          if (ctx === null) {
            return;
          }
          if (ctx.state === 'suspended') {
            void ctx.resume();
          }
          var peak = 0.16;
          var t0 = ctx.currentTime + 0.02;
          if (kind === 'focusEnd') {
            scheduleTone(ctx, t0, 660, 0.55, peak);
          } else if (kind === 'breakEnd') {
            scheduleTone(ctx, t0, 523.25, 0.32, peak);
            scheduleTone(ctx, t0 + 0.18, 659.25, 0.42, peak);
          } else if (kind === 'eyeCare') {
            scheduleTone(ctx, t0, 659.25, 0.4, peak);
          } else {
            scheduleTone(ctx, t0, 392, 0.5, peak);
          }
        }

        // ---------- 提醒合并（防双音轰炸，与主进程 REMIND_MERGE_MS 同源） ----------
        var pendingKinds = [];
        var mergeTimer = null;
        var healthHideTimer = null;

        function enqueueRemind(kind) {
          pendingKinds.push(kind);
          if (mergeTimer !== null) {
            return;
          }
          mergeTimer = setTimeout(function () {
            mergeTimer = null;
            var kinds = pendingKinds.filter(function (k, i) {
              return pendingKinds.indexOf(k) === i;
            });
            pendingKinds = [];
            var priority = ['focusEnd', 'breakEnd', 'sedentary', 'eyeCare'];
            var primary = kind;
            for (var i = 0; i < priority.length; i += 1) {
              if (kinds.indexOf(priority[i]) >= 0) {
                primary = priority[i];
                break;
              }
            }
            remindUntil = Date.now() + REMIND_FLASH_MS;
            playRemind(primary);
            var bannerText = null;
            for (var j = 0; j < kinds.length; j += 1) {
              if (kinds[j] === 'eyeCare') {
                bannerText = '护眼 20-20-20 · 看看 6 米外 20 秒';
                break;
              }
              if (kinds[j] === 'sedentary') {
                bannerText = '久坐提醒 · 起身活动一下';
                break;
              }
            }
            if (bannerText !== null) {
              healthBanner.textContent = bannerText;
              healthBanner.classList.remove('health-banner--hidden');
              if (healthHideTimer !== null) {
                clearTimeout(healthHideTimer);
              }
              healthHideTimer = setTimeout(function () {
                healthBanner.classList.add('health-banner--hidden');
                healthHideTimer = null;
              }, 15000);
            }
            render();
          }, REMIND_MERGE_MS);
        }

        // 首次手势解锁 AudioContext
        function unlockAudio() {
          var ctx = getAudioContext();
          if (ctx !== null && ctx.state === 'suspended') {
            void ctx.resume();
          }
        }
        window.addEventListener('pointerdown', unlockAudio);

        // ---------- 状态机（与 main/timer.ts 流转规则一致，含 P1-4 长休分档） ----------
        function currentTotalMs() {
          var minutes = FOCUS_MINUTES;
          if (phase === 'shortBreak') {
            minutes = BREAK_MINUTES;
          } else if (phase === 'longBreak') {
            minutes = LONG_BREAK_MINUTES;
          }
          return minutes * MINUTE_MS;
        }

        function nextBreakPhase() {
          if (tieredOn && cyclePomodoros > 0 && cyclePomodoros % LONG_BREAK_EVERY === 0) {
            return 'longBreak';
          }
          return 'shortBreak';
        }

        function start() {
          if (status === 'running') {
            return;
          }
          status = 'running';
          endsAt = Date.now() + remainingMs;
          render();
        }

        function pause() {
          if (status !== 'running') {
            return;
          }
          remainingMs = Math.max(0, (endsAt || Date.now()) - Date.now());
          status = 'paused';
          endsAt = null;
          render();
        }

        function reset() {
          totalMs = currentTotalMs();
          remainingMs = totalMs;
          status = 'idle';
          endsAt = null;
          render();
        }

        function skip() {
          completePhase();
        }

        function startNext() {
          // 休息中一键进入下一番茄：跳过剩余休息 + 立即开始
          skip();
          start();
        }

        function completePhase() {
          if (phase === 'focus') {
            // 与主进程一致：按实际已专注时长结算，跳过不再按满额计入
            var elapsedFocus = Math.max(0, Math.min(totalMs, totalMs - remainingMs));
            if (elapsedFocus > 0) {
              completedPomodoros += 1;
              focusMsTotal += elapsedFocus;
            }
            cyclePomodoros += 1;
            phase = nextBreakPhase();
            totalMs = currentTotalMs();
            remainingMs = totalMs;
            status = 'running';
            endsAt = Date.now() + remainingMs;
            enqueueRemind('focusEnd');
          } else {
            phase = 'focus';
            totalMs = currentTotalMs();
            remainingMs = totalMs;
            status = 'idle';
            endsAt = null;
            enqueueRemind('breakEnd');
          }
          render();
        }

        // ---------- 渲染 ----------
        function titleFor() {
          if (phase === 'focus') {
            if (status === 'running') return '专注中';
            if (status === 'paused') return '已暂停';
            return '准备专注';
          }
          if (status === 'running') return phase === 'longBreak' ? '长休中' : '休息一下';
          if (status === 'paused') return '休息暂停';
          return '休息就绪';
        }

        function captionFor() {
          if (phase === 'focus') {
            if (status === 'running') return '专注中';
            if (status === 'paused') return '已暂停';
            return '准备开始';
          }
          if (status === 'running') return '起身远眺';
          if (status === 'paused') return '休息暂停';
          return '休息就绪';
        }

        function renderControls() {
          var html = '';
          if (status === 'running') {
            html += '<button type="button" class="btn" data-action="pause">暂停</button>';
            if (phase === 'focus') {
              html += '<button type="button" class="btn btn--ghost" data-action="skip">跳过</button>';
            } else {
              html +=
                '<button type="button" class="btn btn--primary" data-action="startNext">开始下一个番茄</button>';
            }
          } else if (status === 'paused') {
            html += '<button type="button" class="btn btn--primary" data-action="start">继续</button>';
            html += '<button type="button" class="btn btn--ghost" data-action="reset">重置</button>';
          } else {
            var label = phase === 'focus' && completedPomodoros > 0 ? '开始下一个番茄' : '开始';
            html +=
              '<button type="button" class="btn btn--primary btn--wide" data-action="start">' +
              label +
              '</button>';
          }
          controlBar.innerHTML = html;
        }

        function renderStats() {
          var dots = '';
          for (var i = 0; i < 4; i += 1) {
            dots +=
              '<span class="stats-bar__dot' +
              (i < completedPomodoros ? ' stats-bar__dot--filled' : '') +
              '"></span>';
          }
          statsDots.innerHTML = dots;
          statsFocus.textContent = '专注 ' + formatDurationMs(focusMsTotal);
          if (tieredOn) {
            var inCycle = cyclePomodoros > 0 ? ((cyclePomodoros - 1) % LONG_BREAK_EVERY) + 1 : 0;
            statsCycle.textContent = '本组 ' + inCycle + '/' + LONG_BREAK_EVERY;
            statsCycle.style.display = '';
            cycleDivider.style.display = '';
          } else {
            statsCycle.style.display = 'none';
            cycleDivider.style.display = 'none';
          }
        }

        var lastControlsKey = '';

        function render() {
          var isBreak = phase !== 'focus';
          widget.classList.toggle('widget--break', isBreak);
          titleText.textContent = titleFor();
          captionText.textContent = captionFor();
          timeText.textContent = formatMmSs(remainingMs);
          dndBadge.style.display = dndOn ? '' : 'none';

          var ratio = totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0;
          ringProgress.setAttribute('stroke-dashoffset', String(CIRCUMFERENCE * (1 - ratio)));
          if (docked) {
            syncDockProgress();
          }

          var reminding = Date.now() < remindUntil;
          timerRing.classList.toggle('timer-ring--reminding', reminding);
          statusDot.classList.toggle('titlebar__dot--running', status === 'running');

          tipLine.style.visibility = isBreak ? 'visible' : 'hidden';

          var speedNote = fastMode ? '（加速 ×60）' : '';
          if (phase === 'focus') {
            phaseText.textContent = fastMode
              ? '专注 25 分（加速 25 秒）'
              : '专注 25 分 → 休息 5 分';
          } else if (phase === 'longBreak') {
            phaseText.textContent = '长休 60 分' + speedNote;
          } else {
            phaseText.textContent = fastMode ? '休息 5 分（加速 5 秒）' : '短休 5 分';
          }

          // 仅在状态/阶段变化时重建按钮，避免每 tick 重绘 DOM
          var controlsKey = status + '|' + phase + '|' + (completedPomodoros > 0 ? 'n' : 'f');
          if (controlsKey !== lastControlsKey) {
            lastControlsKey = controlsKey;
            renderControls();
          }
          renderStats();
        }

        // ---------- P1-7 手动收纳到侧边（方案 B：仅手动，无悬停自动展开） ----------
        function syncDockProgress() {
          var ratio = totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0;
          dockProgress.style.height = (ratio * 100).toFixed(2) + '%';
          dockHandle.classList.toggle('dock-handle--break', phase !== 'focus');
        }

        function setDocked(next) {
          docked = next;
          widget.classList.toggle('widget--docked', docked);
          dockHandle.classList.toggle('dock-handle--visible', docked);
          if (docked) {
            syncDockProgress();
          }
        }

        btnDock.addEventListener('click', function () {
          setDocked(true);
        });

        dockHandle.addEventListener('click', function () {
          setDocked(false);
        });

        // ---------- 事件 ----------
        controlBar.addEventListener('click', function (event) {
          var target = event.target;
          if (!(target instanceof HTMLElement)) return;
          var action = target.getAttribute('data-action');
          if (action === 'start') start();
          else if (action === 'pause') pause();
          else if (action === 'reset') reset();
          else if (action === 'skip') skip();
          else if (action === 'startNext') startNext();
        });

        fastToggle.addEventListener('click', function () {
          fastMode = !fastMode;
          fastToggle.classList.toggle('toggle--on', fastMode);
          fastToggle.setAttribute('aria-checked', fastMode ? 'true' : 'false');
          render();
        });

        muteToggle.addEventListener('click', function () {
          soundOn = !soundOn;
          // 按钮语义：开启=提示音开
          muteToggle.classList.toggle('toggle--on', soundOn);
          muteToggle.setAttribute('aria-checked', soundOn ? 'true' : 'false');
        });

        function bindSwitch(button, getValue, setValue) {
          button.addEventListener('click', function () {
            var next = !getValue();
            setValue(next);
            button.classList.toggle('toggle--on', next);
            button.setAttribute('aria-checked', next ? 'true' : 'false');
            render();
          });
        }

        bindSwitch(dndToggle, function () { return dndOn; }, function (v) { dndOn = v; });
        bindSwitch(eyeToggle, function () { return eyeOn; }, function (v) {
          eyeOn = v;
          lastEyeAt = Date.now();
        });
        bindSwitch(sedToggle, function () { return sedOn; }, function (v) {
          sedOn = v;
          lastSedAt = Date.now();
        });
        bindSwitch(tieredToggle, function () { return tieredOn; }, function (v) { tieredOn = v; });

        // ---------- 主题（P1-3：极简黑白 / 番茄红 / 跟随系统） ----------
        function applyTheme() {
          var palette = themeChoice === 'tomato' ? 'tomato' : 'minimal';
          var scheme = 'dark';
          if (themeChoice === 'tomato') {
            scheme = systemScheme;
          } else if (themeChoice === 'system') {
            scheme = systemScheme;
          }
          document.body.dataset.palette = palette;
          document.body.dataset.scheme = scheme;
        }

        if (window.matchMedia) {
          var mq = window.matchMedia('(prefers-color-scheme: dark)');
          systemScheme = mq.matches ? 'dark' : 'light';
          if (mq.addEventListener) {
            mq.addEventListener('change', function (event) {
              systemScheme = event.matches ? 'dark' : 'light';
              applyTheme();
            });
          }
        }

        themePicker.addEventListener('click', function (event) {
          var target = event.target;
          if (!(target instanceof HTMLElement)) return;
          var value = target.getAttribute('data-theme');
          if (value !== 'minimal' && value !== 'tomato' && value !== 'system') return;
          themeChoice = value;
          var chips = themePicker.querySelectorAll('.theme-chip');
          for (var i = 0; i < chips.length; i += 1) {
            chips[i].classList.toggle('theme-chip--active', chips[i] === target);
          }
          applyTheme();
        });

        btnResetAll.addEventListener('click', function () {
          completedPomodoros = 0;
          cyclePomodoros = 0;
          focusMsTotal = 0;
          phase = 'focus';
          lastEyeAt = Date.now();
          lastSedAt = Date.now();
          reset();
        });

        // ---------- 健康提醒（P1-1 20-20-20 / P1-2 久坐，加速下按比例提前） ----------
        function checkHealth(now) {
          var factor = fastMode ? 60 : 1;
          if (eyeOn && now - lastEyeAt >= 20 * MINUTE_MS / factor) {
            lastEyeAt = now;
            enqueueRemind('eyeCare');
          }
          if (sedOn && now - lastSedAt >= 45 * MINUTE_MS / factor) {
            lastSedAt = now;
            enqueueRemind('sedentary');
          }
        }

        var lastTickAt = Date.now();
        setInterval(function () {
          var now = Date.now();
          var elapsed = now - lastTickAt;
          lastTickAt = now;
          if (status === 'running' && endsAt !== null) {
            if (fastMode) {
              // 加速消耗：把真实流逝时间放大 60 倍，推进 endsAt
              endsAt -= elapsed * 59;
            }
            remainingMs = Math.max(0, endsAt - now);
            if (remainingMs <= 0) {
              completePhase();
              return;
            }
          }
          checkHealth(now);
          render();
        }, TICK_MS);

        applyTheme();
        render();
      })();