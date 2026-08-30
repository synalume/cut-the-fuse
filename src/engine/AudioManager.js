// AudioManager.js — plays baked MP3/WAV files with per-hit humanization.
// Falls back to a WebAudio synth snip until approved takes are baked in
// (placeholder-first audio, mirroring the art pipeline).
const AUDIO_PREFIX = "assets/audio/";

// Cue registry. `file` is filled at runtime when a baked take exists.
// `gain` is the per-cue level in the mix (1.0 = baked loudness, -3 dB peak).
// Quiet cues (dud/blast) duck under the action so they don't drown the snip.
const CUES = {
    ignite: { file: "ignite.mp3", synth: null, gain: 1.0 },
    snip: { file: "snip.mp3", synth: "snip", gain: 1.0 },
    dud: { file: "dud.mp3", synth: null, gain: 0.1 },
    blast: { file: "blast.mp3", synth: null, gain: 0.5 },
    win_star: { file: "win_star.mp3", synth: null, gain: 0.55 },
    // Unbaked: file stays null so loadAll skips the 404 — the synth fallback
    // plays until a take is approved and the filename is filled in.
    win: { file: null, synth: "win", gain: 0.7 },
    // Blaze-out fast-forward: a quick rising whoosh when the win is sealed and
    // the remaining burn sweeps to a stop.
    blaze: { file: null, synth: "blaze", gain: 0.5 },
    wick_crackle: { file: "wick_crackle.wav", loop: true, synth: null, gain: 0.5 },
};

export class AudioManager {
    constructor() {
        this.ctx = null;
        this.muted = false;      // the in-game mute toggle
        this.hostMuted = false;  // platform veto (Playgama / Playables)
        this.hostPaused = false; // platform pause suspends the whole context
        this.master = null;      // single gain all output feeds — mute ducks it
        this._buffers = {};
        this._loops = {};
        this._lastPlay = {}; // cueId -> timestamp for rate limiting
    }

    ensureCtx() {
        if (!this.ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) this.ctx = new AC();
            if (this.ctx) {
                this.master = this.ctx.createGain();
                this.master.gain.value = 1.0;
                this.master.connect(this.ctx.destination);
            }
        }
        // iOS starts suspended and often stays that way until a real start()
        // runs inside a user gesture — resume lazily here, but never while the
        // host holds the context paused (that would defeat a platform pause).
        if (this.ctx && this.ctx.state === "suspended" && !this.hostPaused) {
            try { this.ctx.resume(); } catch { /* noop */ }
        }
        this.applyMute();
        return this.ctx;
    }

    async loadBaked(cueId, url) {
        try {
            const res = await fetch(url);
            const buf = await res.arrayBuffer();
            const ctx = this.ensureCtx();
            if (!ctx) return;
            const audioBuf = await ctx.decodeAudioData(buf);
            this._buffers[cueId] = audioBuf;
        } catch {
            this._buffers[cueId] = null;
        }
    }

    /** Load every baked cue from assets/audio/, silently skipping any that aren't
     *  baked yet (placeholder-first: the game stays quiet until a cue is approved
     *  and wired in). Cues whose `file` is still null are never fetched, so an
     *  unbaked synth-only cue doesn't 404 in the console. */
    async loadAll() {
        await Promise.allSettled(
            Object.entries(CUES)
                .filter(([, cue]) => cue.file)
                .map(([cueId, cue]) => this.loadBaked(cueId, AUDIO_PREFIX + cue.file))
        );
    }

    hasBaked(cueId) {
        return !!this._buffers[cueId];
    }

    // ---- public API ------------------------------------------------------------

    /** Effective mute = in-game toggle OR platform veto. Both feed one master
     *  gain, so muting cuts EVERYTHING already playing — not just future plays.
     *  (The platform's setting is a veto the in-game control cannot lift.) */
    applyMute() {
        const muted = this.muted || this.hostMuted;
        if (muted) this._stopAllLoops();
        if (!this.ctx || !this.master) return; // applied when ensureCtx builds master
        const target = muted ? 0 : 1.0;
        const t = this.ctx.currentTime;
        const param = this.master.gain;
        param.cancelScheduledValues(t);
        // A suspended (or not-yet-running) context can't ramp reliably — pin.
        if (this.ctx.state !== "running") {
            param.value = target;
            return;
        }
        const cur = Number.isFinite(param.value) ? param.value : target;
        if (target === 0) {
            // Mute must be instant — a QA sampler can measure output right away.
            param.value = 0;
        } else {
            param.setValueAtTime(cur, t);
            param.linearRampToValueAtTime(1.0, t + 0.12);
        }
    }

    setMuted(m) {
        this.muted = !!m;
        this.applyMute();
    }

    setHostMuted(m) {
        this.hostMuted = !!m;
        this.applyMute();
    }

    toggleMute() {
        this.setMuted(!this.muted);
        return this.muted;
    }

    /** Host pause: freeze the whole audio graph. Big-fluff pattern — a pause
     *  signal must silence sound, not just the game loop. */
    suspend() {
        this.hostPaused = true;
        if (this.ctx && this.ctx.state === "running") {
            try { this.ctx.suspend(); } catch { /* noop */ }
        }
    }

    resume() {
        this.hostPaused = false;
        if (!this.ctx) return;
        if (this.ctx.state !== "suspended") {
            this.applyMute();
            return;
        }
        const p = this.ctx.resume();
        if (p && typeof p.then === "function") p.then(() => this.applyMute()).catch(() => {});
    }

    /** Play a one-shot cue (ignite / snip / dud / blast / win).
     *  opts.rate overrides the playback pitch (e.g. ascending star chimes). */
    play(cueId, opts = {}) {
        if (this.muted || this.hostMuted) return;
        const cue = CUES[cueId];
        if (!cue) return;

        // Rate limit rapid triggers (e.g. snip spam, crackle ticks).
        const now = performance.now();
        if (this._lastPlay[cueId] && now - this._lastPlay[cueId] < 60) return;
        this._lastPlay[cueId] = now;

        try {
            if (this._buffers[cueId]) {
                this._playBuffer(cueId, this._buffers[cueId], cue.loop, opts.rate);
            } else if (cue.synth === "snip") {
                this._synthSnip();
            } else if (cue.synth === "win") {
                this._synthWin();
            } else if (cue.synth === "blaze") {
                this._synthBlaze();
            }
        } catch (err) {
            // An audio glitch must never take the game down with it — the loop
            // keeps running even if a synth call throws on some browser.
            console.warn("[audio] cue failed:", cueId, err);
        }
    }

    /** Start a looping cue (e.g. wick_crackle). */
    startLoop(cueId) {
        if (this.muted || this.hostMuted) return;
        const cue = CUES[cueId];
        if (!cue || !cue.loop) return;
        if (this._buffers[cueId] && !this._loops[cueId]) {
            this._playBuffer(cueId, this._buffers[cueId], true);
        }
    }

    stopLoop(cueId) {
        const node = this._loops[cueId];
        if (node) {
            try { node.stop(); } catch { /* noop */ }
            delete this._loops[cueId];
        }
    }

    stopAllLoops() {
        this._stopAllLoops();
    }

    // ---- internals ---------------------------------------------------------------

    _stopAllLoops() {
        for (const id of Object.keys(this._loops)) this.stopLoop(id);
    }

    _playBuffer(cueId, buffer, loop, rateOverride) {
        const ctx = this.ensureCtx();
        if (!ctx) return;

        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = !!loop;

        const gain = ctx.createGain();
        // Per-cue mix level, then humanization drift so one take reads as hand-played.
        const cueGain = (CUES[cueId] && CUES[cueId].gain) ?? 1.0;
        gain.gain.value = cueGain * (0.9 + Math.random() * 0.2);

        if (!loop) {
            // Per-hit pitch drift 0.86-1.08 (big-fluff pattern), or a caller-
            // specified rate (e.g. ascending star chimes) which is used as-is.
            src.playbackRate.value = rateOverride ?? (0.86 + Math.random() * 0.22);
        }

        src.connect(gain).connect(this.master || ctx.destination);
        src.start();

        if (loop) {
            this._loops[cueId] = src;
        }
    }

    /** Prototype synth snip (dev fallback until baked snip.mp3 is approved). */
    _synthSnip() {
        const ctx = this.ensureCtx();
        if (!ctx) return;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);

        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

        osc.connect(gain);
        gain.connect(this.master || ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.1);
    }

    /** Prototype win sting (dev fallback until baked win.mp3 is approved): a
     *  short ascending fanfare — three rising notes into a high sparkle, ~0.6s.
     *  The level-clear beat should land, not drag, so it stays a sting. */
    _synthWin() {
        const ctx = this.ensureCtx();
        if (!ctx) return;

        const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
        const t0 = ctx.currentTime;
        for (let i = 0; i < notes.length; i++) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "triangle";
            osc.frequency.setValueAtTime(notes[i], t0 + i * 0.08);
            gain.gain.setValueAtTime(0, t0 + i * 0.08);
            gain.gain.linearRampToValueAtTime(0.2, t0 + i * 0.08 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.08 + 0.32);
            osc.connect(gain);
            gain.connect(this.master || ctx.destination);
            osc.start(t0 + i * 0.08);
            osc.stop(t0 + i * 0.08 + 0.34);
        }
        // A quick octave sparkle rides on top of the last note for the "ding!".
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(2093, t0 + 0.32);
        gain.gain.setValueAtTime(0, t0 + 0.32);
        gain.gain.linearRampToValueAtTime(0.08, t0 + 0.34);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
        osc.connect(gain);
        gain.connect(this.master || ctx.destination);
        osc.start(t0 + 0.32);
        osc.stop(t0 + 0.52);
    }

    /** Blaze-out fast-forward whoosh: filtered noise swells and sweeps up as
     *  the sealed win burns to a stop (~0.45s, bright but brief). */
    _synthBlaze() {
        const ctx = this.ensureCtx();
        if (!ctx) return;
        const t0 = ctx.currentTime;
        const dur = 0.45;

        const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            const p = i / data.length;
            data[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * p);
        }
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.Q.value = 1.1;
        filter.frequency.setValueAtTime(500, t0);
        filter.frequency.exponentialRampToValueAtTime(3400, t0 + dur);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.55, t0 + 0.07);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.master || ctx.destination);
        src.start(t0);
        src.stop(t0 + dur);
    }
}
