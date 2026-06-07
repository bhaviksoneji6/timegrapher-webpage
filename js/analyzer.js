// Energy blocks are 5ms each → 200 blocks/sec
const BLOCK_MS       = 5;
const BLOCKS_PER_SEC = 1000 / BLOCK_MS;           // 200
const MIN_LAG        = Math.round(80  / BLOCK_MS); // 16  → 80ms  (covers up to 12.5 ticks/sec)
const MAX_LAG        = Math.round(500 / BLOCK_MS); // 100 → 500ms (covers down to 2 ticks/sec)
const MIN_BUFFER     = BLOCKS_PER_SEC * 2;         // 2 seconds before first autocorrelation
const MAX_BUFFER     = BLOCKS_PER_SEC * 8;         // keep 8 seconds rolling
const TARGET_TICKS   = 300;                        // ticks needed for a stable rate reading

export class Analyzer {
  constructor(onUpdate) {
    this._onUpdate   = onUpdate;
    this._ticks      = [];
    this._energy     = [];   // rolling energy envelope buffer
    this._lockedBPH  = null;
    this._lockedPeriodMs = null;
  }

  reset() {
    this._ticks          = [];
    this._energy         = [];
    this._lockedBPH      = null;
    this._lockedPeriodMs = null;
    this._onUpdate({ state: 'listening', progress: 0 });
  }

  // ── Energy-based BPH detection (called on every energy buffer from worklet) ─

  addEnergyBuffer(buffer) {
    // Append new blocks
    for (let i = 0; i < buffer.length; i++) this._energy.push(buffer[i]);
    // Trim to rolling window
    if (this._energy.length > MAX_BUFFER) {
      this._energy = this._energy.slice(this._energy.length - MAX_BUFFER);
    }

    if (this._energy.length < MIN_BUFFER) return; // not enough data yet

    const periodBlocks = this._autocorrelationPeriod(this._energy);
    if (!periodBlocks) return;

    const periodMs  = periodBlocks * BLOCK_MS;
    const ticksPerSec = 1000 / periodMs;
    const bph = Math.round(ticksPerSec * 3600);

    this._lockedBPH      = bph;
    this._lockedPeriodMs = periodMs;

    // Report BPH lock so the UI can show it even before rate is stable
    const progress = Math.min(this._ticks.length / TARGET_TICKS, 1);
    this._onUpdate({
      state: this._ticks.length >= TARGET_TICKS ? 'done' : 'measuring',
      bph,
      periodMs,
      rateSPerDay:  this._computeRate(periodMs),
      beatErrorMs:  this._computeBeatError(periodMs),
      progress,
      tickCount:    this._ticks.length,
      latestTickTime: this._ticks[this._ticks.length - 1],
      phaseError:   this._phaseError(periodMs),
      isEven:       (this._ticks.length - 1) % 2 === 0,
      lastIntervalMs: periodMs,
    });
  }

  // ── Individual tick timestamps (used for rate / beat-error precision) ────────

  addTick(time) {
    this._ticks.push(time);

    if (!this._lockedBPH || this._ticks.length < 4) return;

    const periodMs = this._lockedPeriodMs;
    const progress = Math.min(this._ticks.length / TARGET_TICKS, 1);
    const done     = this._ticks.length >= TARGET_TICKS;

    this._onUpdate({
      state: done ? 'done' : 'measuring',
      bph:         this._lockedBPH,
      periodMs,
      rateSPerDay: this._computeRate(periodMs),
      beatErrorMs: this._computeBeatError(periodMs),
      progress,
      tickCount:   this._ticks.length,
      latestTickTime: time,
      phaseError:  this._phaseError(periodMs),
      isEven:      (this._ticks.length - 1) % 2 === 0,
      lastIntervalMs: periodMs,
    });
  }

  // ── Autocorrelation ───────────────────────────────────────────────────────────

  _autocorrelationPeriod(energy) {
    const n    = energy.length;
    const mean = energy.reduce((a, b) => a + b, 0) / n;

    // Zero-mean the signal so corr = 0 for uncorrelated noise
    const e = energy.map(v => v - mean);

    const variance = e.reduce((a, v) => a + v * v, 0) / n;
    if (variance < 1e-12) return null; // silence

    let bestLag  = 0;
    let bestCorr = -Infinity;

    for (let lag = MIN_LAG; lag <= MAX_LAG; lag++) {
      let corr = 0;
      const len = n - lag;
      for (let i = 0; i < len; i++) corr += e[i] * e[i + lag];
      corr /= len;

      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag  = lag;
      }
    }

    const normCorr = bestCorr / variance;
    console.log(`[autocorr] best lag=${bestLag} (${bestLag * BLOCK_MS}ms), normCorr=${normCorr.toFixed(3)}, energy blocks=${n}`);

    if (normCorr < 0.10) return null;

    return bestLag;
  }

  // ── Rate / beat error ─────────────────────────────────────────────────────────

  _computeRate(periodMs) {
    const n = this._ticks.length;
    if (n < 8) return 0;

    const expectedInterval = periodMs / 1000;

    // Use only intervals that are within 25% of expected (filters outliers)
    const intervals = [];
    for (let i = 1; i < n; i++) {
      const iv = this._ticks[i] - this._ticks[i - 1];
      if (Math.abs(iv - expectedInterval) < expectedInterval * 0.25) {
        intervals.push(iv);
      }
    }
    if (intervals.length < 4) return 0;

    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return ((avg - expectedInterval) / expectedInterval) * 86400;
  }

  _computeBeatError(periodMs) {
    const n = this._ticks.length;
    if (n < 8) return 0;

    const expectedInterval = periodMs / 1000;
    const intervals = [];
    for (let i = 1; i < n; i++) {
      const iv = this._ticks[i] - this._ticks[i - 1];
      if (Math.abs(iv - expectedInterval) < expectedInterval * 0.25) {
        intervals.push(iv);
      }
    }
    if (intervals.length < 4) return 0;

    const even = intervals.filter((_, i) => i % 2 === 0);
    const odd  = intervals.filter((_, i) => i % 2 === 1);
    const avgEven = even.reduce((a, b) => a + b, 0) / even.length;
    const avgOdd  = odd.reduce((a, b) => a + b, 0) / odd.length;
    return Math.abs(avgEven - avgOdd) * 1000;
  }

  _phaseError(periodMs) {
    const n = this._ticks.length;
    if (n < 2) return 0;
    const expectedInterval = periodMs / 1000;
    const expectedTime     = this._ticks[0] + (n - 1) * expectedInterval;
    return (this._ticks[n - 1] - expectedTime) * 1000;
  }
}
