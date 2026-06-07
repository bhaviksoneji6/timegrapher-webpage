export class AudioEngine {
  constructor({ onTick, onLevel, onEnergyBuffer }) {
    this._onTick         = onTick;
    this._onLevel        = onLevel;
    this._onEnergyBuffer = onEnergyBuffer;
    this._ctx = null;
    this._stream = null;
    this._workletNode = null;
    this._analyser = null;
  }

  async start() {
    // Use exact boolean false (not {ideal:false}) to actually disable AGC and
    // noise suppression on iOS 16+. {ideal:false} is only a preference and iOS
    // Safari often ignores it, leaving AGC running which normalises everything
    // to the same level so tick transients become indistinguishable from noise.
    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 1 },
      },
    });

    this._ctx = new AudioContext();

    await this._ctx.audioWorklet.addModule('./worklet/tick-detector.js');

    const source = this._ctx.createMediaStreamSource(this._stream);

    // For chassis-conducted vibration (watch pressed against phone back),
    // the dominant energy is 200-3000Hz — mechanical resonance of the case.
    // Previous 1500Hz HP was cutting out the main watch tick frequencies.
    const hp = this._ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 200;
    hp.Q.value = 0.7;

    const lp = this._ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3000;
    lp.Q.value = 0.7;

    // AnalyserNode for oscilloscope
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = 2048;
    this._analyser.smoothingTimeConstant = 0;

    this._workletNode = new AudioWorkletNode(this._ctx, 'tick-detector');
    this._workletNode.port.onmessage = (e) => {
      if (e.data.type === 'tick')   this._onTick(e.data.time);
      if (e.data.type === 'level')  this._onLevel(e.data.peak, e.data.floor);
      if (e.data.type === 'energy') this._onEnergyBuffer(e.data.buffer);
      if (e.data.type === 'log')    console.log(e.data.msg);
    };

    source.connect(hp);
    hp.connect(lp);
    lp.connect(this._analyser);
    lp.connect(this._workletNode);
    // Not connected to destination — analysis only, no playback
  }

  setSensitivity(value) {
    if (this._workletNode) {
      this._workletNode.port.postMessage({ type: 'sensitivity', value });
    }
  }

  getWaveformData() {
    if (!this._analyser) return null;
    const buf = new Float32Array(this._analyser.fftSize);
    this._analyser.getFloatTimeDomainData(buf);
    return buf;
  }

  stop() {
    if (this._workletNode) { this._workletNode.disconnect(); this._workletNode = null; }
    if (this._analyser)    { this._analyser.disconnect();    this._analyser = null; }
    if (this._stream)      { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; }
    if (this._ctx)         { this._ctx.close(); this._ctx = null; }
  }
}
