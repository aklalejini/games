'use strict';
/* ============================================================
   STONEBROOK music — a gentle generative medieval-folk loop.
   Plucked melody over a slow bass and soft arpeggios,
   all synthesized with WebAudio (no audio files).
   ============================================================ */

const Music = (() => {
  let ctx = null, master = null, lp = null;
  let enabled = true, started = false;
  let timer = null, nextNoteTime = 0, step = 0;

  const TEMPO = 84;                       // bpm
  const STEP = 60 / TEMPO / 2;            // eighth notes
  // D dorian: D E F G A B C
  const SCALE = [293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25];
  // chord roots (semitone offsets vs D) per bar: Dm, F, C, Dm | Dm, Bb, F, C
  const PROG = [
    { root: 146.83, third: 174.61, fifth: 220.0 },   // Dm
    { root: 174.61, third: 220.0, fifth: 261.63 },   // F
    { root: 130.81, third: 164.81, fifth: 196.0 },   // C
    { root: 146.83, third: 174.61, fifth: 220.0 },   // Dm
    { root: 146.83, third: 174.61, fifth: 220.0 },   // Dm
    { root: 116.54, third: 146.83, fifth: 174.61 },  // Bb
    { root: 174.61, third: 220.0, fifth: 261.63 },   // F
    { root: 130.81, third: 164.81, fifth: 196.0 },   // C
  ];
  let melodyIdx = 4, rng = Math.random;

  function initCtx(audioCtx) {
    ctx = audioCtx;
    master = ctx.createGain();
    master.gain.value = 0;
    lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    master.connect(lp);
    lp.connect(ctx.destination);
  }

  function pluck(freq, t, dur, gain, type = 'triangle', detune = 0) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function bassNote(freq, t, dur, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function scheduleStep(s, t) {
    const bar = Math.floor(s / 8) % PROG.length;
    const beat = s % 8;                    // eighth-note index in the bar
    const chord = PROG[bar];
    // bass: root on 1, fifth on 5
    if (beat === 0) bassNote(chord.root / 2, t, STEP * 7, 0.30);
    if (beat === 4) bassNote(chord.fifth / 2, t, STEP * 3.5, 0.20);
    // soft arpeggio sparkle on alternating bars
    if (bar % 2 === 1 && beat >= 4 && beat < 7) {
      const tone = [chord.root, chord.third, chord.fifth][beat - 4] * 2;
      pluck(tone, t, 0.5, 0.05, 'sine');
    }
    // melody: gentle random walk on the scale
    if (beat % 2 === 0 || rng() < 0.3) {
      if (rng() < 0.68) {
        const stepMove = [-2, -1, -1, 0, 1, 1, 2][(rng() * 7) | 0];
        melodyIdx = Math.max(0, Math.min(SCALE.length * 2 - 1, melodyIdx + stepMove));
        const freq = SCALE[melodyIdx % SCALE.length] * (melodyIdx >= SCALE.length ? 2 : 1);
        pluck(freq, t, 0.42, 0.105, 'triangle', rng() * 8 - 4);
        // occasional soft echo a third below
        if (rng() < 0.18) pluck(freq * 0.8409, t + STEP / 2, 0.3, 0.045);
      }
    }
    // phrase rest: quiet last bar occasionally handled by walk naturally
  }

  function scheduler() {
    if (!ctx || !enabled) return;
    while (nextNoteTime < ctx.currentTime + 0.25) {
      scheduleStep(step, nextNoteTime);
      step++;
      nextNoteTime += STEP;
    }
  }

  function start(audioCtx) {
    if (!audioCtx) return;
    if (!ctx) initCtx(audioCtx);
    if (started) return;
    started = true;
    nextNoteTime = ctx.currentTime + 0.1;
    step = 0;
    timer = setInterval(scheduler, 100);
    if (enabled) fadeTo(0.16);
  }
  function fadeTo(v) {
    if (!ctx) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(v, ctx.currentTime, 0.4);
  }
  function setEnabled(on) {
    enabled = on;
    try { localStorage.setItem('stonebrook-music', on ? '1' : '0'); } catch (e) { }
    if (started) fadeTo(on ? 0.16 : 0);
  }
  function isEnabled() { return enabled; }
  function loadPref() {
    try { enabled = localStorage.getItem('stonebrook-music') !== '0'; } catch (e) { }
    return enabled;
  }

  return { start, setEnabled, isEnabled, loadPref };
})();
