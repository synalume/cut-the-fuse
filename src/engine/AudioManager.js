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
    wick_crackle: { file: "wick_crackle.wav", loop: true, synth: null, gain: 0.5 },
};

export class AudioManager {
    constructor() {
        this.ctx = null;
        this.muted = false;
        this.hostMuted = false;
        this._buffers = {};
        this._loops = {};
        this._lastPlay = {}; // cueId -> timestamp for rate limiting
    }

    ensureCtx() {
        if (!this.ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) this.ctx = new AC();
        }
        if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
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
     *  and wired in). */
    async loadAll() {
        await Promise.allSettled(
            Object.entries(CUES).map(([cueId, cue]) => this.loadBaked(cueId, AUDIO_PREFIX + cue.file))
        );
    }

    hasBaked(cueId) {
        return !!this._buffers[cueId];
    }

    // ---- public API ------------------------------------------------------------

    setMuted(m) {
        this.muted = !!m;
        if (this.muted || this.hostMuted) this._stopAllLoops();
    }

    setHostMuted(m) {
        this.hostMuted = !!m;
        if (this.muted || this.hostMuted) this._stopAllLoops();
    }

    toggleMute() {
        this.setMuted(!this.muted);
        return this.muted;
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

        if (this._buffers[cueId]) {
            this._playBuffer(cueId, this._buffers[cueId], cue.loop, opts.rate);
        } else if (cue.synth === "snip") {
            this._synthSnip();
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

        src.connect(gain).connect(ctx.destination);
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
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.1);
    }
}
