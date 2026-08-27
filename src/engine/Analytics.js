// Analytics.js — attempts-based tuning telemetry for the retention ladder.
// Fully disabled in the YouTube Playables build (zero external calls allowed).
const DISABLED =
    !!window.__CUT_THE_FUSE_PLAYABLES__ ||
    (typeof ytgame !== "undefined" && !!ytgame.IN_PLAYABLES_ENV);

export class Analytics {
    constructor(opts = {}) {
        this.enabled = !DISABLED && opts.enabled !== false;
        this.endpoint = opts.endpoint || null; // future: POST events (self-hosted)
        this.queue = [];
    }

    track(event, payload = {}) {
        if (!this.enabled) return;
        const entry = {
            event,
            ts: Date.now(),
            session: this._sessionId,
            ...payload,
        };
        this.queue.push(entry);
        if (this.endpoint && this.queue.length >= 25) this.flush();
    }

    flush() {
        if (!this.enabled || !this.endpoint || this.queue.length === 0) return;
        const body = JSON.stringify(this.queue.splice(0));
        try {
            fetch(this.endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body,
            }).catch(() => {});
        } catch { /* noop */ }
    }
}

Analytics.prototype._sessionId = Math.random().toString(36).slice(2);
