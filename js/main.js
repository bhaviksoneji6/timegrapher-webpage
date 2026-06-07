import { AudioEngine } from './audio.js';
import { Analyzer } from './analyzer.js';
import { Trace } from './trace.js';
import { generateAndShare } from './report.js';

// ── Platform detection ────────────────────────────────────────────────────────

function detectPlatform() {
  const ua = navigator.userAgent;
  const pl = navigator.platform || '';
  if (/iPhone/.test(ua))  return 'iphone';
  if (/iPad/.test(ua))    return 'ipad';
  if (/Android/.test(ua)) return 'android';
  if (/Mac/.test(pl) || /Mac/.test(ua)) return 'mac';
  if (/Win/.test(pl) || /Win/.test(ua)) return 'windows';
  return 'unknown';
}

const PLATFORM_TIPS = {
  iphone:  'Hold the watch flat against the back of your iPhone, near the bottom.',
  ipad:    'Hold the watch against the bottom edge of your iPad near the mic.',
  android: 'Hold the watch against the back of your phone near the bottom mic.',
  mac:     'Hold the watch against the bottom edge of your Mac near the mic grille.',
  windows: 'Hold the watch against the left side of your laptop near the mic grille.',
  unknown: "Hold the watch as close to your device's microphone as possible.",
};

// ── State ─────────────────────────────────────────────────────────────────────

let state = 'ready';
let audio = null;
let lastResults = null;
let rawTickCount = 0;     // increments on every detected tick (for display)
let smoothedPeak = 0;
let lastMeterColor = 'grey';
let scopeRafId = null;

const els = {
  tip:               document.getElementById('tip'),
  startBtn:          document.getElementById('startBtn'),
  stopBtn:           document.getElementById('stopBtn'),
  stopRow:           document.getElementById('stopRow'),
  againBtn:          document.getElementById('againBtn'),
  shareBtn:          document.getElementById('shareBtn'),
  meterFill:         document.getElementById('meterFill'),
  meterStatus:       document.getElementById('meterStatus'),
  meterRow:          document.getElementById('meterRow'),
  sensitivitySlider: document.getElementById('sensitivitySlider'),
  sensitivityVal:    document.getElementById('sensitivityVal'),
  statusLabel:       document.getElementById('statusLabel'),
  bphHint:           document.getElementById('bphHint'),
  progress:          document.getElementById('progress'),
  progressFill:      document.getElementById('progressFill'),
  metrics:           document.getElementById('metrics'),
  rateVal:           document.getElementById('rateVal'),
  rateLabel:         document.getElementById('rateLabel'),
  beatVal:           document.getElementById('beatVal'),
  bphVal:            document.getElementById('bphVal'),
  traceCanvas:       document.getElementById('traceCanvas'),
  traceWrap:         document.getElementById('traceWrap'),
  scopeCanvas:       document.getElementById('scopeCanvas'),
  scopeWrap:         document.getElementById('scopeWrap'),
  tickCount:         document.getElementById('tickCount'),
  intervalDisplay:   document.getElementById('intervalDisplay'),
  readyView:         document.getElementById('readyView'),
  measureView:       document.getElementById('measureView'),
  resultsView:       document.getElementById('resultsView'),
};

const trace = new Trace(els.traceCanvas);

// ── Oscilloscope ──────────────────────────────────────────────────────────────

const tickMarkers = [];

function drawScope() {
  const canvas = els.scopeCanvas;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  if (canvas.width !== Math.round(rect.width * dpr)) {
    canvas.width  = Math.round(rect.width  * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.scale(dpr, dpr);
  }

  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  const data = audio ? audio.getWaveformData() : null;

  if (data) {
    ctx.beginPath();
    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth = 1.5;
    const step = w / data.length;
    for (let i = 0; i < data.length; i++) {
      const x = i * step;
      const y = h / 2 - data[i] * (h * 2.5);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Centre reference line
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  // Orange flash at right edge on each detected tick
  for (let i = tickMarkers.length - 1; i >= 0; i--) {
    const m = tickMarkers[i];
    m.age--;
    if (m.age <= 0) { tickMarkers.splice(i, 1); continue; }
    ctx.globalAlpha = m.age / 20;
    ctx.fillStyle = '#ff9f4a';
    ctx.fillRect(w - 6, 0, 6, h);
    ctx.globalAlpha = 1;
  }

  scopeRafId = requestAnimationFrame(drawScope);
}

function flashTick() { tickMarkers.push({ age: 20 }); }

// ── Analyzer ──────────────────────────────────────────────────────────────────

const analyzer = new Analyzer((update) => {
  if (update.state === 'listening') return;

  // Update interval display
  if (update.lastIntervalMs) {
    const ms  = Math.round(update.lastIntervalMs);
    const bph = update.bph ? update.bph.toLocaleString() : '…';
    els.intervalDisplay.textContent = `~${ms} ms · ${bph} BPH`;
  }

  // BPH locked — hide the hint and show metrics
  els.bphHint.hidden = true;
  els.metrics.hidden = false;
  els.traceWrap.hidden = false;

  showMetrics(update);
  lastResults = update;

  if (update.latestTickTime !== undefined) {
    trace.addPoint(performance.now() / 1000, update.phaseError, update.isEven);
  }

  if (update.state === 'done' && (state === 'measuring' || state === 'listening')) {
    enterResults();
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  els.tip.textContent = PLATFORM_TIPS[detectPlatform()];

  els.startBtn.addEventListener('click', enterListening);
  els.stopBtn.addEventListener('click', handleStop);
  els.againBtn.addEventListener('click', enterReady);
  els.shareBtn.addEventListener('click', () => {
    if (lastResults) generateAndShare(lastResults, trace.snapshot());
  });

  els.sensitivitySlider.addEventListener('input', () => {
    const v = parseInt(els.sensitivitySlider.value, 10);
    els.sensitivityVal.textContent = v;
    if (audio) audio.setSensitivity(v);
  });

  enterReady();
}

// ── State transitions ─────────────────────────────────────────────────────────

function enterReady() {
  state = 'ready';
  stopScope();
  if (audio) { audio.stop(); audio = null; }
  analyzer.reset();
  trace.reset();
  lastResults = null;
  rawTickCount = 0;
  smoothedPeak = 0;
  lastMeterColor = 'grey';
  els.intervalDisplay.textContent = '';

  els.readyView.hidden      = false;
  els.measureView.hidden    = true;
}

async function enterListening() {
  state = 'listening';
  rawTickCount = 0;

  els.readyView.hidden      = false;
  els.readyView.hidden      = true;
  els.measureView.hidden    = false;
  els.scopeWrap.hidden      = false;
  els.meterRow.hidden       = false;
  els.metrics.hidden        = true;
  els.traceWrap.hidden      = true;
  els.statusLabel.hidden    = false;
  els.bphHint.hidden        = true;
  els.progress.hidden       = true;
  els.stopRow.hidden        = false;
  els.resultsView.hidden    = true;

  updateTickCountDisplay();
  setStatus('Listening… hold watch close to mic (needs ~3s to lock)');

  try {
    audio = new AudioEngine({
      onTick: (t) => {
        state = 'measuring';
        rawTickCount++;
        updateTickCountDisplay();
        flashTick();
        analyzer.addTick(t);
      },
      onLevel:        (peak, floor) => updateMeter(peak, floor),
      onEnergyBuffer: (buf)         => analyzer.addEnergyBuffer(buf),
    });
    await audio.start();
    audio.setSensitivity(parseInt(els.sensitivitySlider.value, 10));
    startScope();
  } catch {
    enterReady();
    alert('Microphone access denied. Please allow mic access and try again.');
  }
}

function handleStop() {
  if (lastResults) {
    // We have partial results — show them
    enterResults();
  } else {
    enterReady();
  }
}

function enterResults() {
  state = 'results';
  stopScope();
  if (audio) { audio.stop(); audio = null; }
  trace.freeze();

  els.scopeWrap.hidden      = true;
  els.meterRow.hidden       = true;
  els.metrics.hidden        = false;
  els.traceWrap.hidden      = false;
  els.statusLabel.hidden    = true;
  els.bphHint.hidden        = true;
  els.progress.hidden       = true;
  els.stopRow.hidden        = true;
  els.resultsView.hidden    = false;

  if (lastResults) showMetrics(lastResults);
}

// ── Scope lifecycle ───────────────────────────────────────────────────────────

function startScope() {
  if (scopeRafId) cancelAnimationFrame(scopeRafId);
  scopeRafId = requestAnimationFrame(drawScope);
}

function stopScope() {
  if (scopeRafId) { cancelAnimationFrame(scopeRafId); scopeRafId = null; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function updateTickCountDisplay() {
  els.tickCount.textContent = `${rawTickCount} tick${rawTickCount !== 1 ? 's' : ''}`;
}

function setStatus(text) {
  els.statusLabel.textContent = text;
}

function showMetrics(update) {
  if (state !== 'results') {
    els.progress.hidden = false;
    els.progressFill.style.width = (update.progress * 100) + '%';
    setStatus(`Measuring… ${Math.round(update.progress * 100)}%`);
  }

  const rate = update.rateSPerDay;
  const sign = rate >= 0 ? '+' : '';
  els.rateVal.textContent   = sign + rate.toFixed(1);
  els.rateVal.style.color   = rateColor(rate);
  els.rateLabel.textContent = (rate >= 0 ? 'gaining' : 'losing') + ' s/day';

  els.beatVal.textContent   = update.beatErrorMs.toFixed(1);
  els.beatVal.style.color   = beatColor(update.beatErrorMs);
  els.bphVal.textContent    = update.bph.toLocaleString();
}

function updateMeter(peak, floor) {
  smoothedPeak = peak > smoothedPeak
    ? peak * 0.6 + smoothedPeak * 0.4
    : peak * 0.05 + smoothedPeak * 0.95;

  const snr   = floor > 0 ? smoothedPeak / (floor * 4) : 0;
  const level = Math.min(snr, 1);

  let color;
  if (smoothedPeak > 0.85) color = 'red';
  else if (level > 0.25)   color = 'green';
  else                     color = 'yellow';

  els.meterFill.style.width   = (level * 100) + '%';
  els.meterFill.dataset.color = color;

  if (color !== lastMeterColor) {
    lastMeterColor = color;
    const map = {
      grey:   '',
      green:  'Signal OK',
      yellow: 'Weak — hold watch closer or raise sensitivity',
      red:    'Too loud — lower sensitivity or move watch away',
    };
    els.meterStatus.textContent = map[color] || '';
  }
}

function rateColor(r) {
  const a = Math.abs(r);
  if (a <= 5)  return '#4caf50';
  if (a <= 15) return '#ff9f4a';
  return '#f44336';
}

function beatColor(ms) {
  if (ms <= 1.0) return '#4caf50';
  if (ms <= 2.0) return '#ff9f4a';
  return '#f44336';
}

init();
