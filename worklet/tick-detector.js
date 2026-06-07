class TickDetectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Two-speed energy tracking for onset detection:
    // fastEnergy tracks signal over ~5ms (detects sudden spikes)
    // slowEnergy tracks signal over ~500ms (represents background floor)
    // A tick fires when fast >> slow by the sensitivity multiplier.
    // This is self-normalising and survives residual AGC on iOS.
    this._fastEnergy = 0;
    this._slowEnergy = 0;
    this._multiplier = 12;

    this._state = 'idle';
    this._peakAmplitude = 0;
    this._lockTimer = 0;
    this._releaseTimer = 0;

    this._energyAccum = 0;
    this._energyCount = 0;
    this._energyBuffer = [];

    this.port.onmessage = (e) => {
      if (e.data.type === 'sensitivity') {
        // Slider 1 (least sensitive) → multiplier 25
        // Slider 10 (most sensitive) → multiplier 5
        this._multiplier = 25 - (e.data.value - 1) * (20 / 9);
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0];
    const n = samples.length;

    const blockSamples    = Math.round(sampleRate * 0.005); // 5ms energy blocks
    const minLockSamples  = Math.round(sampleRate * 0.04);  // 40ms hard lock
    const maxReleaseSamples = Math.round(sampleRate * 0.18);

    let peakInBlock = 0;

    for (let i = 0; i < n; i++) {
      const s   = samples[i];
      const abs = Math.abs(s);
      if (abs > peakInBlock) peakInBlock = abs;

      // ── Energy envelope accumulation ──────────────────────────────────
      this._energyAccum += s * s;
      this._energyCount++;
      if (this._energyCount >= blockSamples) {
        this._energyBuffer.push(this._energyAccum / this._energyCount);
        this._energyAccum = 0;
        this._energyCount = 0;

        // Send only NEW blocks every 50 blocks (250ms), then clear the queue.
        // Sending cumulative data causes the analyzer to accumulate duplicates.
        if (this._energyBuffer.length >= 50) {
          this.port.postMessage({ type: 'energy', buffer: Float32Array.from(this._energyBuffer) });
          this._energyBuffer.length = 0;
        }
      }

      // ── Two-speed onset detection ─────────────────────────────────────
      // fastEnergy: alpha=0.01 per sample → ~100 sample / ~2ms attack
      // slowEnergy: alpha=0.0003 per sample → ~3300 sample / ~75ms decay
      // Together these form an onset detector that works even if AGC
      // normalises the absolute level, since we compare fast vs slow.
      this._fastEnergy = this._fastEnergy * 0.99  + abs * 0.01;
      this._slowEnergy = this._slowEnergy * 0.9997 + abs * 0.0003;

      if (this._state === 'idle') {
        const threshold = Math.max(
          this._slowEnergy * this._multiplier,
          0.008   // absolute floor — ignores sub-1% signals entirely
        );

        if (abs > threshold) {
          this.port.postMessage({ type: 'tick', time: currentTime + i / sampleRate });
          this._peakAmplitude = abs;
          this._state = 'locked';
          this._lockTimer = minLockSamples;
        }
      } else if (this._state === 'locked') {
        if (abs > this._peakAmplitude) this._peakAmplitude = abs;
        if (--this._lockTimer <= 0) {
          this._state = 'releasing';
          this._releaseTimer = maxReleaseSamples;
        }
      } else {
        const releaseThreshold = Math.max(
          this._peakAmplitude * 0.15,
          Math.sqrt(this._noiseFloor) * 3
        );
        if (abs < releaseThreshold || --this._releaseTimer <= 0) {
          this._state = 'idle';
          this._peakAmplitude = 0;
        }
      }
    }

    this.port.postMessage({ type: 'level', peak: peakInBlock, floor: this._slowEnergy });
    return true;
  }
}

registerProcessor('tick-detector', TickDetectorProcessor);
