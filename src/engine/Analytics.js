// Analytics.js — attempts-based tuning telemetry for the retention ladder.
// Fully disabled in the YouTube Playables build (zero external calls allowed).
const DISABLED =
    !!window.__CUT_THE_FUSE_PLAYABLES__ ||
    (typeof ytgame !== "undefined" && !!ytgame.IN_PLAYABLES_ENV);

// Self-hosted collector endpoint. Resolve order:
//   1. explicit opts.endpoint (main.js can inject)
//   2. ?analytics=<url> query param (per-build opt-in for portals)
//   3. window.__CTF_ANALYTICS_ENDPOINT__ (injected by a launcher page)
//   4. DEFAULT_ENDPOINT constant
// Leave null to run fully offline — events still queue in memory.
const DEFAULT_ENDPOINT = null;

// Heartbeat so a long session reports even if the tab is killed without a
// visibility/beacon event.
const FLUSH_INTERVAL_MS = 15000;

function resolveEndpoint(explicit) {
    if (explicit) return explicit;
    if (typeof window !== "undefined") {
        try {
            const q = new URLSearchParams(window.location.search).get("analytics");
            if (q) return q;
        } catch { /* noop */ }
        if (window.__CTF_ANALYTICS_ENDPOINT__) return window.__CTF_ANALYTICS_ENDPOINT__;
    }
    return DEFAULT_ENDPOINT;
}

export class Analytics {
    constructor(opts = {}) {
        this.enabled = !DISABLED && opts.enabled !== false;
        this.endpoint = resolveEndpoint(opts.endpoint);
        this.queue = [];
        this._boundFlush = () => this.flush();
        this._boundUnload = () => this.flush(true);
        this._onVis = () => {
            if (document.hidden) this.flush();
        };

        if (this.enabled) {
            this._flushTimer = setInterval(this._boundFlush, FLUSH_INTERVAL_MS);
            document.addEventListener("visibilitychange", this._onVis);
            window.addEventListener("beforeunload", this._boundUnload);
            this.track("session_start", {
                tz: new Date().getTimezoneOffset(),
                ua: (navigator.userAgent || "").slice(0, 120),
            });
        }
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
        if (this.queue.length >= 25) this.flush();
    }

    /** POST the queued events to the collector. `beacon` uses sendBeacon so
     *  the payload survives page unload. */
    flush(beacon = false) {
        if (!this.enabled || !this.endpoint || this.queue.length === 0) return;
        const body = JSON.stringify(this.queue.splice(0));
        try {
            if (beacon && navigator.sendBeacon) {
                navigator.sendBeacon(this.endpoint, new Blob([body], { type: "application/json" }));
            } else {
                fetch(this.endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body,
                    keepalive: true,
                }).catch(() => {});
            }
        } catch { /* noop */ }
    }
}

Analytics.prototype._sessionId = Math.random().toString(36).slice(2);
