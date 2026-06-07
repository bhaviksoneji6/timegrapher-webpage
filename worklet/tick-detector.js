class TickDetectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._noiseFloor = 0.0001;
    this._multiplier = 3.5;

    // Individual tick detection (used for rate/beat-error once BPH is known)
    this._state = 'idle';
    this._peakAmplitude = 0;
    this._lockTimer = 0;
    this._releaseTimer = 0;

    // Energy envelope: 5ms blocks → 200 blocks/sec
    // Autocorrelation on this finds the tick period without threshold detection
    this._energyAccum = 0;
    this._energyCount = 0;
    this._energyBuffer = [];  // rolling buffer sent to main thread

    this.port.onmessage = (e) => {
      if (e.data.type === 'sensitivity') {
        this._multiplier = 7.0 - (e.data.value - 1) * (5.5 / 9);
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

      // ── Individual tick detection (adaptive refractory) ───────────────
      if (this._state === 'idle') {
        this._noiseFloor = this._noiseFloor * 0.9998 + abs * abs * 0.0002;
        const threshold = Math.sqrt(this._noiseFloor) * this._multiplier;

        if (abs > threshold && abs > 0.0001) {
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

    this.port.postMessage({ type: 'level', peak: peakInBlock, floor: Math.sqrt(this._noiseFloor) });
    return true;
  }
}

registerProcessor('tick-detector', TickDetectorProcessor);
