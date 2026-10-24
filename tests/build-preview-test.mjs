/**
 * QA 测试脚手架 v2：把 preview/mvp-preview.html 原样取出，
 * 注入可控时钟/定时器/超时队列/WebAudio 侦察/matchMedia mock，
 * 后置注入断言驱动（P0 47 项回归 + P1 新增），生成 tests/preview-under-test.html。
 * 被测脚本 = preview 文件里的原文（逐字节保留），不改 src。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const previewPath = join(here, '..', 'preview', 'mvp-preview.html');
const outPath = join(here, 'preview-under-test.html');
const extractedScriptPath = join(here, 'preview-inline-extracted.js');

const html = readFileSync(previewPath, 'utf-8');

const scriptMatch = html.match(/<script>\s*\(function \(\) \{[\s\S]*?\}\)\(\);\s*<\/script>/);
if (!scriptMatch) {
  console.error('FAIL: cannot locate inline script in preview');
  process.exit(2);
}
const inlineScript = scriptMatch[0];
writeFileSync(
  extractedScriptPath,
  inlineScript.replace(/^<script>\s*/, '').replace(/\s*<\/script>$/, ''),
  'utf-8'
);

const mockScript = `
<script>
/* ===== QA mock layer v2 (runs BEFORE app script) ===== */
window.__qa = {
  now: Date.now(),
  ticks: [],
  timeouts: [],
  timeoutSeq: 0,
  oscillatorCount: 0,
  audioCtxCreated: 0,
  consoleErrors: [],
  windowErrors: [],
  scheme: 'dark',
  mqListener: null,
};
Date.now = function () { return window.__qa.now; };

window.setInterval = function (fn, delay) {
  window.__qa.ticks.push({ fn: fn, delay: delay });
  return window.__qa.ticks.length;
};

window.setTimeout = function (fn, delay) {
  var id = ++window.__qa.timeoutSeq;
  window.__qa.timeouts.push({ id: id, fn: fn, delay: delay || 0, due: window.__qa.now + (delay || 0), fired: false });
  return id;
};
window.clearTimeout = function (id) {
  for (var i = 0; i < window.__qa.timeouts.length; i += 1) {
    if (window.__qa.timeouts[i].id === id) { window.__qa.timeouts[i].fired = true; return; }
  }
};

window.__fireTick = function () {
  for (var i = 0; i < window.__qa.ticks.length; i += 1) window.__qa.ticks[i].fn();
};
window.__fireDueTimeouts = function () {
  for (var round = 0; round < 10; round += 1) {
    var fired = false;
    for (var i = 0; i < window.__qa.timeouts.length; i += 1) {
      var t = window.__qa.timeouts[i];
      if (!t.fired && t.due <= window.__qa.now) { t.fired = true; t.fn(); fired = true; }
    }
    if (!fired) break;
  }
};
window.__advanceMs = function (ms) {
  window.__qa.now += ms;
  window.__fireDueTimeouts();
};
window.__advanceMsNoFire = function (ms) { window.__qa.now += ms; };
window.__pendingTimeouts = function () {
  return window.__qa.timeouts.filter(function (t) { return !t.fired; }).length;
};

(function () {
  var OrigAC = window.AudioContext || window.webkitAudioContext;
  if (OrigAC) {
    var Wrapped = function () {
      window.__qa.audioCtxCreated += 1;
      var ctx = new OrigAC();
      var origOsc = ctx.createOscillator.bind(ctx);
      ctx.createOscillator = function () {
        window.__qa.oscillatorCount += 1;
        return origOsc();
      };
      return ctx;
    };
    Wrapped.prototype = OrigAC.prototype;
    window.AudioContext = Wrapped;
    if (window.webkitAudioContext) window.webkitAudioContext = Wrapped;
  }
})();

window.matchMedia = function (query) {
  if (String(query).indexOf('prefers-color-scheme') >= 0) {
    return {
      matches: window.__qa.scheme === 'dark',
      media: query,
      addEventListener: function (_evt, fn) { window.__qa.mqListener = fn; },
      removeEventListener: function () { window.__qa.mqListener = null; },
      addListener: function (fn) { window.__qa.mqListener = fn; },
      removeListener: function () { window.__qa.mqListener = null; },
    };
  }
  return { matches: false, media: query, addEventListener: function () {}, removeEventListener: function () {}, addListener: function () {}, removeListener: function () {} };
};
window.__setSystemScheme = function (s) {
  window.__qa.scheme = s;
  if (window.__qa.mqListener) window.__qa.mqListener({ matches: s === 'dark' });
};

window.addEventListener('error', function (e) {
  window.__qa.windowErrors.push(String(e.message || e.error));
});
var __origConsoleError = console.error;
console.error = function () {
  window.__qa.consoleErrors.push(Array.prototype.slice.call(arguments).map(String).join(' '));
  __origConsoleError.apply(console, arguments);
};
</script>`;

const driverScript = `
<script>
/* ===== QA assertion driver v2 (runs AFTER app script) ===== */
(function () {
  'use strict';
  var results = [];
  function ok(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || '' });
  }
  function $(id) { return document.getElementById(id); }
  function timeText() { return $('timeText').textContent; }
  function titleText() { return $('titleText').textContent; }
  function captionText() { return $('captionText').textContent; }
  function widgetClass() { return $('widget').className; }
  function btnLabels() {
    var btns = $('controlBar').querySelectorAll('button');
    var out = [];
    for (var i = 0; i < btns.length; i += 1) out.push(btns[i].textContent.trim());
    return out.join('|');
  }
  function clickAction(action) {
    var btns = $('controlBar').querySelectorAll('button');
    for (var i = 0; i < btns.length; i += 1) {
      if (btns[i].getAttribute('data-action') === action) { btns[i].click(); return true; }
    }
    return false;
  }
  function filledDots() { return $('statsDots').querySelectorAll('.stats-bar__dot--filled').length; }
  function ringOffset() { return parseFloat($('ringProgress').getAttribute('stroke-dashoffset')); }
  function bannerText() { return $('healthBanner').textContent; }
  function bannerVisible() { return $('healthBanner').className.indexOf('health-banner--hidden') < 0; }
  function dndBadgeShown() { return $('dndBadge').style.display !== 'none'; }
  function cycleText() { return $('statsCycle').style.display === 'none' ? '(hidden)' : $('statsCycle').textContent; }
  function themeAttrs() {
    return 'palette=' + document.body.dataset.palette + ' scheme=' + document.body.dataset.scheme;
  }
  function ringFocusVar() { return getComputedStyle(document.body).getPropertyValue('--ring-focus').trim(); }
  function ringStroke() {
    var el = $('ringProgress');
    el.style.transition = 'none';
    var s = getComputedStyle(el).stroke;
    el.style.transition = '';
    return s;
  }
  function flushRemind() { window.__advanceMs(300); }

  /* ================= P0 回归（期望值已按「默认短休 5 分」更新） ================= */
  var widget = $('widget');
  var cs = window.getComputedStyle(widget);
  ok('C1-widget-240x240', cs.width === '240px' && cs.height === '240px', cs.width + 'x' + cs.height);
  ok('C1-radius-rounded', parseFloat(cs.borderRadius) >= 16, 'border-radius=' + cs.borderRadius);
  ok('C1-glass-bg', (cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none'),
     'backdrop=' + (cs.backdropFilter || cs.webkitBackdropFilter || 'n/a') + ' bg=' + cs.backgroundColor);
  var svg = document.querySelector('.timer-ring__svg');
  ok('C1-svg-ring-present', svg !== null && svg.querySelectorAll('circle').length === 2);

  ok('C2-initial-25-00', timeText() === '25:00', 'got=' + timeText());
  ok('C2-initial-caption', captionText() === '准备开始', 'got=' + captionText());

  ok('C3-btn-start-present', btnLabels() === '开始', btnLabels());
  clickAction('start');
  ok('C3-after-start-title', titleText() === '专注中', titleText());
  var offsetAtStart = ringOffset();
  window.__advanceMs(60000);
  window.__fireTick();
  ok('C3-countdown-decreased', timeText() === '24:00', 'got=' + timeText());
  ok('C3-ring-shrinks', ringOffset() > offsetAtStart, offsetAtStart + ' -> ' + ringOffset());

  ok('C3b-btn-pause-present', btnLabels().indexOf('暂停') >= 0, btnLabels());
  clickAction('pause');
  var frozen = timeText();
  ok('C3b-paused-caption', captionText() === '已暂停', captionText());
  window.__advanceMs(300000);
  window.__fireTick();
  window.__fireTick();
  ok('C3b-pause-frozen', timeText() === frozen, 'frozen=' + frozen + ' after=' + timeText());
  ok('C3b-resume-btn', btnLabels().indexOf('继续') >= 0 && btnLabels().indexOf('重置') >= 0, btnLabels());
  clickAction('start');
  window.__advanceMs(1000);
  window.__fireTick();
  ok('C3b-resume-no-drift', timeText() === '23:59', 'frozen=' + frozen + ' resumed=' + timeText());

  clickAction('pause');
  clickAction('reset');
  ok('C3c-reset-full', timeText() === '25:00', 'got=' + timeText());
  ok('C3c-reset-idle', btnLabels() === '开始', btnLabels());

  var dotBefore = filledDots();
  clickAction('start');
  clickAction('skip');
  flushRemind();
  ok('C3d-skip-to-break', widgetClass().indexOf('widget--break') >= 0, widgetClass());
  ok('C3d-break-5-00', timeText() === '05:00', 'got=' + timeText());
  ok('C3d-break-caption', captionText() === '起身远眺', captionText());
  ok('C3d-break-title', titleText() === '休息一下', titleText());
  ok('C3d-stat-counted', filledDots() === dotBefore + 1, dotBefore + ' -> ' + filledDots());
  ok('C3d-break-cta', btnLabels().indexOf('开始下一个番茄') >= 0, btnLabels());

  $('btnResetAll').click();
  window.__fireTick();
  ok('C4-reset-clean', timeText() === '25:00' && widgetClass().indexOf('widget--break') < 0, timeText());
  var oscBefore = window.__qa.oscillatorCount;
  clickAction('start');
  window.__advanceMs(25 * 60 * 1000);
  window.__fireTick();
  flushRemind();
  ok('C4-auto-to-break', widgetClass().indexOf('widget--break') >= 0, widgetClass());
  ok('C4-break-text-switch', titleText() === '休息一下' && captionText() === '起身远眺', titleText() + '/' + captionText());
  ok('C4-tip-visible', $('tipLine').style.visibility === 'visible', $('tipLine').style.visibility);
  ok('C4-sound-focusEnd', window.__qa.oscillatorCount > oscBefore, 'osc ' + oscBefore + ' -> ' + window.__qa.oscillatorCount);
  ok('C4-remind-flash-class', $('timerRing').className.indexOf('timer-ring--reminding') >= 0, $('timerRing').className);
  window.__advanceMs(5 * 60 * 1000);
  window.__fireTick();
  flushRemind();
  ok('C4-back-to-focus-idle', widgetClass().indexOf('widget--break') < 0 && titleText() === '准备专注', widgetClass() + '/' + titleText());
  ok('C4-breakEnd-cta', btnLabels().indexOf('开始下一个番茄') >= 0, btnLabels());
  ok('C4-tip-hidden-focus', $('tipLine').style.visibility === 'hidden', $('tipLine').style.visibility);

  $('btnResetAll').click();
  window.__fireTick();
  $('fastToggle').click();
  ok('C5-fast-toggle-on', $('fastToggle').className.indexOf('toggle--on') >= 0, $('fastToggle').className);
  ok('C5-fast-label', $('phaseText').textContent.indexOf('加速') >= 0, $('phaseText').textContent);
  clickAction('start');
  window.__advanceMs(1000);
  window.__fireTick();
  ok('C5-fast-60x-consume', timeText() === '24:00', 'after 1s real -> ' + timeText());
  window.__advanceMs(24000);
  window.__fireTick();
  flushRemind();
  ok('C5-fast-to-break', widgetClass().indexOf('widget--break') >= 0, timeText() + ' ' + widgetClass());
  $('fastToggle').click();

  $('btnResetAll').click();
  window.__fireTick();
  $('muteToggle').click();
  var oscMutedBefore = window.__qa.oscillatorCount;
  clickAction('start');
  clickAction('skip');
  flushRemind();
  ok('C6-muted-no-sound', window.__qa.oscillatorCount === oscMutedBefore, oscMutedBefore + ' -> ' + window.__qa.oscillatorCount);
  $('muteToggle').click();
  $('btnResetAll').click();
  window.__fireTick();
  var oscOnBefore = window.__qa.oscillatorCount;
  clickAction('start');
  clickAction('skip');
  flushRemind();
  ok('C6-unmuted-sound', window.__qa.oscillatorCount > oscOnBefore, oscOnBefore + ' -> ' + window.__qa.oscillatorCount);
  ok('C6-audioctx-used', window.__qa.audioCtxCreated >= 1, 'audioCtxCreated=' + window.__qa.audioCtxCreated);

  var ALLOWED = /^(MVP|PRD|WebAudio|CSS|HTML|SVG|App|Electron|Node|npm|Windows|NSIS|ID|UI)$/i;
  function collectText(root, out) {
    if (root.nodeType === 3) { var t = root.textContent.trim(); if (t) out.push(t); return; }
    if (root.nodeType !== 1) return;
    if (root.tagName === 'SCRIPT' || root.tagName === 'STYLE') return;
    for (var i = 0; i < root.childNodes.length; i += 1) collectText(root.childNodes[i], out);
  }
  var uiRoots = [$('widget'), document.querySelector('.demo-panel'), document.querySelector('.page-head')];
  var textNodes = [];
  for (var r = 0; r < uiRoots.length; r += 1) { if (uiRoots[r]) collectText(uiRoots[r], textNodes); }
  var latin = [];
  for (var i = 0; i < textNodes.length; i += 1) {
    var stripped = textNodes[i].replace(/\\d+(?:h\\d*m?|m|s|ms)/g, ' ').replace(/\\d+\\s*\\/\\s*\\d+/g, ' ');
    var words = stripped.match(/[A-Za-z]+/g) || [];
    for (var w = 0; w < words.length; w += 1) {
      if (!ALLOWED.test(words[w])) latin.push(words[w] + ' @ "' + textNodes[i].slice(0, 28) + '"');
    }
  }
  ok('C7-ui-chinese', latin.length === 0, 'unexpected latin words: ' + JSON.stringify(latin.slice(0, 5)));
  $('btnResetAll').click();
  window.__fireTick();
  ok('C7-cn-core-copy',
     $('titleText').textContent === '准备专注' &&
     $('captionText').textContent === '准备开始' &&
     $('statsFocus').textContent.indexOf('专注') === 0 &&
     $('tipLine').textContent.indexOf('小贴士') === 0,
     $('titleText').textContent + '/' + $('captionText').textContent + '/' + $('statsFocus').textContent);
  clickAction('start');
  ok('C7-cn-running-copy', $('titleText').textContent === '专注中' && $('captionText').textContent === '专注中', $('titleText').textContent);
  $('btnResetAll').click();
  window.__fireTick();
  ok('C7-no-console-error', window.__qa.consoleErrors.length === 0, JSON.stringify(window.__qa.consoleErrors.slice(0, 3)));
  ok('C7-no-window-error', window.__qa.windowErrors.length === 0, JSON.stringify(window.__qa.windowErrors.slice(0, 3)));

  $('btnResetAll').click();
  window.__fireTick();
  clickAction('start');
  window.__advanceMs(5 * 60 * 1000);
  window.__fireTick();
  clickAction('skip');
  flushRemind();
  ok('X-stats-focus-text', $('statsFocus').textContent.indexOf('25m') >= 0, $('statsFocus').textContent);
  ok('X-stats-one-dot', filledDots() === 1, String(filledDots()));

  /* ================= P1 新增 ================= */

  $('btnResetAll').click();
  window.__fireTick();
  ok('P1-default-phase-label', $('phaseText').textContent.indexOf('休息 5 分') >= 0, $('phaseText').textContent);
  clickAction('start');
  clickAction('skip');
  flushRemind();
  ok('P1-default-shortbreak-5min', timeText() === '05:00', 'got=' + timeText());
  ok('P1-shortbreak-label', $('phaseText').textContent.indexOf('5 分') >= 0 && $('phaseText').textContent.indexOf('60') < 0, $('phaseText').textContent);
  ok('P1-no-60-in-shortbreak-ui',
     $('phaseText').textContent.indexOf('60') < 0 && $('captionText').textContent.indexOf('60') < 0,
     $('phaseText').textContent);

  /* B② P1-1 护眼：×60 下 20 秒触发 */
  $('btnResetAll').click();
  window.__fireTick();
  $('fastToggle').click();
  var oscEyeBefore = window.__qa.oscillatorCount;
  window.__advanceMsNoFire(20100);
  window.__fireTick();
  ok('P1-1-eyecare-enqueued', window.__pendingTimeouts() >= 1, 'pending=' + window.__pendingTimeouts());
  window.__advanceMs(300);
  ok('P1-1-eyecare-banner', bannerVisible() && bannerText().indexOf('护眼 20-20-20') >= 0, bannerText());
  ok('P1-1-eyecare-sound', window.__qa.oscillatorCount > oscEyeBefore, oscEyeBefore + ' -> ' + window.__qa.oscillatorCount);

  /* B③ P1-2 久坐：45 秒触发（先关护眼以隔离单类横幅） */
  $('btnResetAll').click();
  window.__fireTick();
  $('eyeToggle').click();
  var oscSedBefore = window.__qa.oscillatorCount;
  window.__advanceMsNoFire(45100);
  window.__fireTick();
  window.__advanceMs(300);
  ok('P1-2-sedentary-banner', bannerVisible() && bannerText().indexOf('久坐提醒') >= 0 && bannerText().indexOf('起身活动一下') >= 0, bannerText());
  ok('P1-2-sedentary-sound', window.__qa.oscillatorCount > oscSedBefore, oscSedBefore + ' -> ' + window.__qa.oscillatorCount);
  $('eyeToggle').click();
  $('fastToggle').click();

  /* B④ 防双音：250ms 合并窗口 */
  $('btnResetAll').click();
  window.__fireTick();
  $('fastToggle').click();
  clickAction('start');
  window.__advanceMsNoFire(20100);
  window.__fireTick();
  ok('P1-merge-pending-one', window.__pendingTimeouts() >= 1, 'pending=' + window.__pendingTimeouts());
  window.__advanceMsNoFire(4900);
  window.__fireTick();
  var oscMergeBefore = window.__qa.oscillatorCount;
  var pendingBeforeFire = window.__pendingTimeouts();
  window.__advanceMs(300);
  var oscDelta = window.__qa.oscillatorCount - oscMergeBefore;
  ok('P1-merge-single-sound', oscDelta === 1, 'oscDelta=' + oscDelta + ' (1=merged focusEnd single tone; 2=double sound bug)');
  ok('P1-merge-one-event', pendingBeforeFire >= 1 && oscDelta < 2, 'pendingBefore=' + pendingBeforeFire + ' oscDelta=' + oscDelta);
  ok('P1-merge-banner-kept', bannerVisible() && bannerText().indexOf('护眼') >= 0, bannerText());
  $('fastToggle').click();

  /* B⑤ P1-3 三主题 */
  $('btnResetAll').click();
  window.__fireTick();
  ok('P1-3-precondition-focus', widgetClass().indexOf('widget--break') < 0, widgetClass());
  var chips = $('themePicker').querySelectorAll('.theme-chip');
  function clickChip(name) {
    for (var i = 0; i < chips.length; i += 1) {
      if (chips[i].getAttribute('data-theme') === name) { chips[i].click(); return chips[i]; }
    }
    return null;
  }
  var c1 = clickChip('minimal');
  ok('P1-3-minimal-active', c1 && c1.className.indexOf('theme-chip--active') >= 0, c1 ? c1.className : 'not found');
  ok('P1-3-minimal-dataset', themeAttrs().indexOf('palette=minimal') >= 0 && themeAttrs().indexOf('scheme=dark') >= 0, themeAttrs());
  ok('P1-3-minimal-ring-white', ringStroke() === 'rgb(255, 255, 255)', ringStroke() + ' var=' + ringFocusVar());
  ok('P1-3-minimal-var', ringFocusVar() === '#ffffff', ringFocusVar());
  window.__setSystemScheme('dark');
  clickChip('tomato');
  ok('P1-3-tomato-dataset', themeAttrs().indexOf('palette=tomato') >= 0 && themeAttrs().indexOf('scheme=dark') >= 0, themeAttrs());
  ok('P1-3-tomato-dark-ring', ringStroke() === 'rgb(232, 80, 58)', ringStroke() + ' var=' + ringFocusVar());
  ok('P1-3-tomato-dark-var', ringFocusVar() === '#e8503a', ringFocusVar());
  window.__setSystemScheme('light');
  ok('P1-3-tomato-light-scheme', themeAttrs().indexOf('scheme=light') >= 0, themeAttrs());
  ok('P1-3-tomato-light-ring', ringStroke() === 'rgb(196, 67, 48)', ringStroke() + ' var=' + ringFocusVar());
  ok('P1-3-tomato-light-var', ringFocusVar() === '#c44330', ringFocusVar());
  clickChip('system');
  ok('P1-3-system-follows', themeAttrs().indexOf('palette=minimal') >= 0 && themeAttrs().indexOf('scheme=light') >= 0, themeAttrs());
  ok('P1-3-system-light-ring', ringStroke() === 'rgb(43, 43, 43)', ringStroke() + ' var=' + ringFocusVar());
  ok('P1-3-system-light-var', ringFocusVar() === '#2b2b2b', ringFocusVar());
  window.__setSystemScheme('dark');
  ok('P1-3-matchmedia-live', themeAttrs().indexOf('scheme=dark') >= 0, themeAttrs());
  clickChip('minimal');

  /* B⑥ P1-4 长休分档 */
  $('btnResetAll').click();
  window.__fireTick();
  $('tieredToggle').click();
  ok('P1-4-cycle-hidden-at-zero', cycleText() === '本组 0/4', cycleText());
  clickAction('start'); clickAction('skip'); flushRemind();
  ok('P1-4-first-is-short', timeText() === '05:00' && titleText() === '休息一下', timeText() + '/' + titleText());
  ok('P1-4-cycle-1', cycleText() === '本组 1/4', cycleText());
  clickAction('startNext'); flushRemind();
  clickAction('skip'); flushRemind();
  clickAction('startNext'); flushRemind();
  clickAction('skip'); flushRemind();
  ok('P1-4-cycle-3', cycleText() === '本组 3/4', cycleText());
  clickAction('startNext'); flushRemind();
  clickAction('skip'); flushRemind();
  ok('P1-4-longbreak-60', timeText() === '60:00', 'got=' + timeText());
  ok('P1-4-longbreak-title', titleText() === '长休中', titleText());
  ok('P1-4-cycle-4', cycleText() === '本组 4/4', cycleText());
  ok('P1-4-longbreak-label', $('phaseText').textContent.indexOf('长休 60 分') >= 0, $('phaseText').textContent);
  $('tieredToggle').click();
  ok('P1-4-cycle-hidden-off', cycleText() === '(hidden)', cycleText());

  /* B⑦ P1-6 勿扰 */
  $('btnResetAll').click();
  window.__fireTick();
  ok('P1-6-badge-hidden-default', !dndBadgeShown(), 'display=' + $('dndBadge').style.display);
  $('dndToggle').click();
  ok('P1-6-badge-shown', dndBadgeShown(), 'display=' + $('dndBadge').style.display);
  var oscDndBefore = window.__qa.oscillatorCount;
  clickAction('start');
  clickAction('skip');
  flushRemind();
  ok('P1-6-dnd-silent', window.__qa.oscillatorCount === oscDndBefore, oscDndBefore + ' -> ' + window.__qa.oscillatorCount);
  ok('P1-6-dnd-still-visual', widgetClass().indexOf('widget--break') >= 0, widgetClass());
  $('dndToggle').click();
  ok('P1-6-badge-hidden-again', !dndBadgeShown(), 'display=' + $('dndBadge').style.display);
  var oscDndOff = window.__qa.oscillatorCount;
  $('btnResetAll').click();
  window.__fireTick();
  clickAction('start');
  clickAction('skip');
  flushRemind();
  ok('P1-6-sound-returns', window.__qa.oscillatorCount > oscDndOff, oscDndOff + ' -> ' + window.__qa.oscillatorCount);

  /* 健康提醒开关 */
  $('btnResetAll').click();
  window.__fireTick();
  $('fastToggle').click();
  $('eyeToggle').click();
  window.__advanceMsNoFire(21000);
  window.__fireTick();
  window.__advanceMs(300);
  ok('P1-1-eye-off-no-banner', !bannerVisible() || bannerText().indexOf('护眼') < 0, 'banner=' + bannerText());
  $('eyeToggle').click();
  $('fastToggle').click();

  /* ================= P1-7 新增：手动收纳到侧边（预览浮层演示） ================= */
  /* 预览里窗口尺寸由 CSS 模拟：收纳 → widget 收起 + 侧边把手浮层出现；
     真机由主进程 setBounds 改窗口尺寸，此处只验交互与进度线契约。 */
  function noTrans(el) { el.style.transition = 'none'; return window.getComputedStyle(el); }
  function widgetHeight() { return noTrans(widget).height; }
  function handleVisible() { return $('dockHandle').className.indexOf('dock-handle--visible') >= 0; }
  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    return 'rgb(' + parseInt(h.slice(0, 2), 16) + ', ' + parseInt(h.slice(2, 4), 16) + ', ' + parseInt(h.slice(4, 6), 16) + ')';
  }

  $('btnResetAll').click();
  window.__fireTick();
  ok('P1-7-btn-dock-present', $('btnDock') !== null && $('btnDock').title.indexOf('收纳') >= 0, $('btnDock') ? $('btnDock').title : 'missing');
  ok('P1-7-initial-undocked', !handleVisible() && widget.className.indexOf('widget--docked') < 0, $('dockHandle').className + ' / ' + widget.className);
  ok('P1-7-initial-handle-invisible', window.getComputedStyle($('dockHandle')).opacity === '0', 'opacity=' + window.getComputedStyle($('dockHandle')).opacity);

  $('btnDock').click();
  ok('P1-7-dock-click-shows-handle', handleVisible(), $('dockHandle').className);
  ok('P1-7-dock-card-collapsed', widget.className.indexOf('widget--docked') >= 0 && widgetHeight() === '0px', widget.className + ' height=' + widgetHeight());
  var handleRect = $('dockHandle').getBoundingClientRect();
  ok('P1-7-handle-size-10x160', Math.round(handleRect.width) === 10 && Math.round(handleRect.height) === 160, Math.round(handleRect.width) + 'x' + Math.round(handleRect.height));
  /* 进出场是 opacity/transform 过渡（0.3s），getBoundingClientRect 会读到中途位移，
     故先关掉过渡再量最终几何（对应真机 setBounds 落定后的 10×160 位置） */
  noTrans($('dockHandle'));
  handleRect = $('dockHandle').getBoundingClientRect();
  /* 视口基准取 documentElement.clientWidth/Height：headless + --hide-scrollbars 下
     window.innerWidth 与实际布局视口存在偏差，不能用作贴边/居中基准 */
  var layoutVw = document.documentElement.clientWidth;
  var layoutVh = document.documentElement.clientHeight;
  ok('P1-7-handle-flush-right', Math.abs(handleRect.right - layoutVw) <= 1 && Math.abs(handleRect.top + handleRect.height / 2 - layoutVh / 2) <= 1, 'right=' + handleRect.right + '/' + layoutVw + ' top=' + handleRect.top + ' vh=' + layoutVh);
  /* CSSOM 会把 "100.00%" 序列化为 "100%"，故按数值判定 */
  ok('P1-7-progress-full-at-idle', Math.abs(parseFloat($('dockProgress').style.height) - 100) < 0.01, 'height=' + $('dockProgress').style.height);

  clickAction('start');
  window.__advanceMs(60000);
  window.__fireTick();
  var dockH1 = parseFloat($('dockProgress').style.height);
  ok('P1-7-docked-countdown-continues', timeText() === '24:00', 'got=' + timeText());
  ok('P1-7-progress-tracks-remaining', dockH1 > 90 && dockH1 < 100, 'height=' + dockH1);
  window.__advanceMs(60000);
  window.__fireTick();
  var dockH2 = parseFloat($('dockProgress').style.height);
  ok('P1-7-progress-follows-timer', dockH2 < dockH1, dockH1 + ' -> ' + dockH2);

  clickAction('skip');
  flushRemind();
  ok('P1-7-break-handle-class', $('dockHandle').className.indexOf('dock-handle--break') >= 0, $('dockHandle').className);
  $('dockProgress').style.transition = 'none';
  var progColor = window.getComputedStyle($('dockProgress')).backgroundColor;
  var breakHex = window.getComputedStyle(document.body).getPropertyValue('--ring-break').trim();
  ok('P1-7-break-progress-eyecare-green', progColor === hexToRgb(breakHex), progColor + ' vs ' + breakHex);

  var timeBeforeExpand = timeText();
  $('dockHandle').click();
  ok('P1-7-handle-click-restores', !handleVisible() && widget.className.indexOf('widget--docked') < 0, $('dockHandle').className + ' / ' + widget.className);
  ok('P1-7-card-restored-240', widgetHeight() === '240px', widgetHeight());
  ok('P1-7-expand-keeps-timer', timeText() === timeBeforeExpand, timeBeforeExpand + ' -> ' + timeText());

  $('btnDock').click();
  $('btnDock').click();
  ok('P1-7-double-dock-idempotent', handleVisible() && widget.className.indexOf('widget--docked') >= 0, $('dockHandle').className);
  $('dockHandle').click();
  $('dockHandle').click();
  ok('P1-7-double-expand-idempotent', !handleVisible() && widgetHeight() === '240px', widgetHeight());

  $('btnResetAll').click();
  window.__fireTick();

  ok('F-no-console-error-final', window.__qa.consoleErrors.length === 0, JSON.stringify(window.__qa.consoleErrors.slice(0, 3)));
  ok('F-no-window-error-final', window.__qa.windowErrors.length === 0, JSON.stringify(window.__qa.windowErrors.slice(0, 3)));

  var passed = 0, failed = 0;
  for (var i = 0; i < results.length; i += 1) { if (results[i].pass) passed += 1; else failed += 1; }
  var lines = ['QA_RESULTS_BEGIN total=' + results.length + ' passed=' + passed + ' failed=' + failed];
  for (var i = 0; i < results.length; i += 1) {
    lines.push((results[i].pass ? 'PASS' : 'FAIL') + ' | ' + results[i].name + ' | ' + results[i].detail);
  }
  lines.push('QA_RESULTS_END');
  var pre = document.createElement('pre');
  pre.id = 'qa-results';
  pre.style.whiteSpace = 'pre-wrap';
  pre.textContent = lines.join('\\n');
  document.body.appendChild(pre);
})();
</script>`;

let outHtml = html.replace(
  /<script>\s*\(function \(\) \{/,
  mockScript + '\n<script>\n      (function () {'
);
outHtml = outHtml.replace(/<\/script>\s*<\/body>/, '</script>\n' + driverScript + '\n  </body>');

if (outHtml === html) {
  console.error('FAIL: injection did not apply');
  process.exit(2);
}
if (outHtml.indexOf('QA assertion driver v2') < 0) {
  console.error('FAIL: driver not injected');
  process.exit(2);
}
writeFileSync(outPath, outHtml, 'utf-8');
console.log('WROTE', outPath);
console.log('WROTE', extractedScriptPath);
