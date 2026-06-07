# Timegrapher — Web PWA

A Progressive Web App that attempts to measure mechanical watch accuracy using the device microphone. Installable on iPhone via Safari "Add to Home Screen".

## What it does

- Listens to mechanical watch ticks via microphone
- Detects tick period via autocorrelation on energy envelope
- Reports rate (seconds/day gain or loss), beat error (ms), and BPH
- Draws a scrolling timegrapher trace (phase error over time)
- Generates a shareable PNG report

## Status

**Core signal processing: complete and correct.**
**iPhone detection: does not work — see Limitations below.**

---

## Architecture

```
index.html
├── style.css
├── manifest.json              ← PWA manifest (icons, standalone mode)
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── apple-touch-icon.png
├── worklet/
│   └── tick-detector.js      ← AudioWorklet (runs on audio thread)
└── js/
    ├── audio.js               ← Mic setup, filters, AudioWorklet wiring
    ├── analyzer.js            ← Autocorrelation, rate, beat error
    ├── trace.js               ← Timegrapher trace canvas
    ├── report.js              ← PNG report + Web Share API
    └── main.js                ← UI state machine, oscilloscope
```

### Signal processing pipeline

```
Mic (getUserMedia)
    → High-pass 200Hz + Low-pass 3000Hz (biquad filters)
    → AudioWorklet: tick-detector.js
        ├── Two-speed onset detector (fast ~2ms / slow ~75ms EMA)
        │   └── fires tick timestamp when fast >> slow × multiplier
        └── 5ms RMS energy blocks → batched every 250ms → analyzer.js
                └── Autocorrelation on energy buffer → BPH
                    └── Tick timestamps → rate (s/day) + beat error (ms)
```

---

## What worked

- Full signal processing pipeline (autocorrelation, rate, beat error, trace)
- PWA manifest — app installs on iPhone home screen with custom icon
- Web Share API — shareable PNG report on mobile
- Oscilloscope and signal meter UI
- Onset detector correctly ignores steady background noise
- Correctly identified that `autoGainControl: false` (exact constraint) disables AGC better than `{ ideal: false }` on iOS 16+

---

## What didn't work and why

### iPhone mic cannot pick up watch ticks via WebAudio API

Watch ticks are subtle mechanical transients (~0.001 amplitude on raw mic). Despite disabling AGC, noise suppression, and echo cancellation, iOS Safari's WebAudio pipeline does not provide raw enough mic access for signals this weak.

Evidence:
- Oscilloscope (blue line) is completely flat when watch is pressed against phone
- `tick amp ≈ 0.00109` for random noise; watch produces nothing measurable
- normCorr ≈ 0.000 at all times — no periodic signal detected

### Root cause — WebAudio vs AVFoundation

Native iOS timegrapher apps (Lepsi, Cyclos, etc.) use `AVAudioSession` with `.measurement` mode, which gives direct unprocessed microphone access at the OS level. WebAudio API on Safari does not expose this mode, regardless of getUserMedia constraints.

### Signal meter always green (fixed, was a separate bug)

Original meter used SNR (peak / noise floor ratio). iOS AGC normalises everything to the same level, so the ratio was always ~1.0 and the meter always showed green. Fixed by switching to absolute peak level display.

### Autocorrelation cumulative buffer bug (fixed)

AudioWorklet was sending the entire accumulated energy buffer on each batch. The analyzer kept appending, creating duplicates and corrupting the autocorrelation. Fixed by clearing `_energyBuffer.length = 0` after each send.

### High-pass filter too aggressive (fixed)

Original 1500Hz high-pass was designed for air-conducted ticks. Chassis-conducted vibration (watch pressed against phone back) is dominated by 200-800Hz mechanical resonance. Lowered to 200Hz, though it made no difference due to the fundamental limitation above.

---

## Conclusion

The web approach is architecturally sound and would likely work on a device that provides raw mic access (e.g. desktop Chrome on Windows/Linux where mic access is less restricted). On iPhone specifically, a native iOS app using AVFoundation is required.

See the companion native iOS app project: built with SwiftUI + AVFoundation, uses `AVAudioSession` with `.measurement` mode to properly disable all audio processing.
