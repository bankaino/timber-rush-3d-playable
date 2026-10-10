// live/audio.js — procedural sound (WebAudio, zero asset bytes) driven by the sim event bus S.ev.
// index.html calls AUDIO.tick(state) once per frame in play mode; the context starts on the first user gesture
// (autoplay policy) and AUDIO.mute(bool) is wired to ad-network viewability / audio-volume callbacks.
(function () {
  let ac = null, out = null, eng = null, last = -1, muted = false, lastCut = 0, lastCoin = 0;
  const start = () => {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    ac = new C(); out = ac.createGain(); out.gain.value = muted ? 0 : 0.55; out.connect(ac.destination);
    // engine: two detuned saws through a low-pass, pitch follows speed
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; const g = ac.createGain(); g.gain.value = 0;
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(); o1.type = o2.type = 'sawtooth'; o1.frequency.value = 48; o2.frequency.value = 49.5;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(out); o1.start(); o2.start(); eng = { o1, o2, g, f };
  };
  addEventListener('pointerdown', start, { capture: true }); addEventListener('keydown', start, { capture: true });
  let nbuf = null;
  const noise = () => { if (nbuf) return nbuf; nbuf = ac.createBuffer(1, ac.sampleRate * 0.6, ac.sampleRate); const d = nbuf.getChannelData(0);
    let s = 12345; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; } return nbuf; };
  const env = (node, t0, a, peak, dur) => { const g = ac.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); node.connect(g); g.connect(out); return g; };
  const tone = (freq, t0, dur, type = 'sine', peak = 0.2, slide = 0) => { const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t0 + dur); env(o, t0, 0.005, peak, dur); o.start(t0); o.stop(t0 + dur + 0.05); };
  const burst = (t0, dur, f0, f1, peak, q = 1.2, type = 'bandpass') => { const s = ac.createBufferSource(); s.buffer = noise(); const f = ac.createBiquadFilter();
    f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur); s.connect(f); env(f, t0, 0.004, peak, dur); s.start(t0); s.stop(t0 + dur + 0.05); };
  const SFX = {
    cut: (t0) => { burst(t0, 0.09, 2600, 900, 0.16, 2.5); tone(110, t0 + 0.02, 0.12, 'triangle', 0.12, 0.6); },
    coin: (t0) => { tone(1320, t0, 0.07, 'square', 0.035); tone(1980, t0 + 0.05, 0.09, 'square', 0.03); },
    pay: (t0) => tone(700 + 300 * Math.random(), t0, 0.06, 'triangle', 0.08, 1.4),
    upgrade: (t0) => [523, 659, 784, 1047].forEach((f, i) => tone(f, t0 + i * 0.075, 0.22, 'square', 0.07)),
    bump: (t0) => { tone(90, t0, 0.25, 'sine', 0.4, 0.5); burst(t0, 0.15, 800, 200, 0.2); },
    smash: (t0) => { burst(t0, 0.9, 1800, 60, 0.6, 0.7, 'lowpass'); tone(70, t0, 0.6, 'sine', 0.5, 0.4); [784, 988, 1175].forEach((f, i) => tone(f, t0 + 0.25 + i * 0.08, 0.25, 'square', 0.06)); },
    rival: (t0) => { tone(330, t0, 0.18, 'sawtooth', 0.09); tone(262, t0 + 0.2, 0.3, 'sawtooth', 0.09); },
    end: (t0) => [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, t0 + i * 0.09, 0.3, 'triangle', 0.12)),
  };
  window.AUDIO = {
    mute: (m) => { muted = m; if (out) out.gain.value = m ? 0 : 0.55; },
    tick: (S) => {
      if (!ac || !S) return; const now = ac.currentTime;
      if (S.t < last) last = -1;                                           // restart / replay
      for (const e of S.ev) { if (e.t <= last) continue;
        if (e.k === 'cut') { if (e.who === 'p' && now - lastCut > 0.06) { SFX.cut(now); lastCut = now; } continue; }
        if (SFX[e.k]) SFX[e.k](now); }
      // coins land in the pill 0.7 s after their tree falls: one pling per landing, throttled
      for (const e of S.ev) if (e.k === 'cut' && e.coin && e.t + 0.7 > last && e.t + 0.7 <= S.t && now - lastCoin > 0.07) { SFX.coin(now); lastCoin = now; break; }
      last = S.t;
      const v = S.p ? Math.min(1, S.p.v / 330) : 0, on = S.end < 0 ? 1 : 0;
      eng.g.gain.setTargetAtTime((0.035 + 0.05 * v) * on, now, 0.08); eng.o1.frequency.setTargetAtTime(44 + 40 * v, now, 0.1); eng.o2.frequency.setTargetAtTime(45.5 + 41 * v, now, 0.1);
      eng.f.frequency.setTargetAtTime(300 + 500 * v, now, 0.1);
    },
  };
})();
