// Platform.js — Playgama / Poki / YouTube Playables / portal SDK hooks.
// Build scripts inject one flag + one SDK per zip; absent flags mean the game
// runs identically on localhost with no-op fallbacks (wobble-run pattern).
const IN_PLAYGAMA = !!window.__CUT_THE_FUSE_PLAYGAMA__;
const IN_POKI = !!window.__CUT_THE_FUSE_POKI__;
const IN_PLAYABLES =
    !!window.__CUT_THE_FUSE_PLAYABLES__ ||
    (typeof ytgame !== "undefined" && !!ytgame.IN_PLAYABLES_ENV && !/localhost|127\.0\.0\.1/i.test(location.hostname));

export class Platform {
    constructor({ audio, save }) {
        this.audio = audio;
        this.save = save;
        this.pausedByHost = false;
        this.adOpen = false;
        this._pokiInitDone = false;
        this._pokiUiReady = false;
        this._pokiLoaded = false;
        this._bound = {};

        this._boot();
    }

    get isPlaygama() { return IN_PLAYGAMA; }
    get isPoki() { return IN_POKI; }
    get isPlayables() { return IN_PLAYABLES; }

    _boot() {
        if (IN_POKI && typeof PokiSDK !== "undefined") {
            this._pokiBoot();
        }
        if (IN_PLAYABLES && typeof ytgame !== "undefined" && ytgame.gameReady) {
            try { ytgame.gameReady(); } catch { /* noop */ }
        }
        if (IN_PLAYGAMA) {
            window.addEventListener("message", (e) => this._onBridgeMessage(e));
            if (typeof bridge !== "undefined" && bridge.initialize) {
                try { bridge.initialize(); } catch { /* noop */ }
            }
        }
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) this.tabHidden();
        });
    }

    // ---- Poki --------------------------------------------------------------

    _pokiBoot() {
        window.addEventListener("keydown", (ev) => {
            if (["ArrowDown", "ArrowUp", " "].includes(ev.key)) ev.preventDefault();
        });
        const inited = () => {
            this._pokiInitDone = true;
            this._pokiMaybeLoaded();
        };
        if (typeof PokiSDK === "undefined") inited();
        else PokiSDK.init().then(inited).catch(inited);
    }

    _pokiMaybeLoaded() {
        if (!IN_POKI || this._pokiLoaded || !this._pokiInitDone || !this._pokiUiReady) return;
        this._pokiLoaded = true;
        try { if (typeof PokiSDK !== "undefined") PokiSDK.gameLoadingFinished(); } catch { /* noop */ }
    }

    loadingFinished() {
        this._pokiUiReady = true;
        this._pokiMaybeLoaded();
        if (IN_PLAYABLES && typeof ytgame !== "undefined" && ytgame.gameReady) {
            try { ytgame.gameReady(); } catch { /* noop */ }
        }
    }

    // ---- gameplay / ads ------------------------------------------------------

    gameplayStart() {
        if (IN_POKI && typeof PokiSDK !== "undefined") {
            try { PokiSDK.gameplayStart(); } catch { /* noop */ }
        }
    }

    gameplayStop() {
        if (IN_POKI && typeof PokiSDK !== "undefined") {
            try { PokiSDK.gameplayStop(); } catch { /* noop */ }
        }
    }

    /** Ad at a natural break (results / level clear). */
    commercialBreak(next) {
        const go = typeof next === "function" ? next : () => {};
        if (IN_POKI && typeof PokiSDK !== "undefined") {
            this.gameplayStop();
            this.adOpen = true;
            PokiSDK.commercialBreak()
                .then(() => { this.adOpen = false; go(); })
                .catch(() => { this.adOpen = false; go(); });
        } else {
            go();
        }
    }

    /** Rewarded continue (retry a failed level). Grants only on success. */
    rewardedContinue(next) {
        this.showRewarded("continue").then((ok) => next(ok));
    }

    /** Generic rewarded ad (skin unlocks, continues). Resolves true ONLY when
     *  the player is granted the reward. Falls back to a free grant when no ad
     *  platform is wired (local dev / plain portal build). */
    async showRewarded(placement = "reward") {
        const pause = () => { this.gameplayStop(); this.adOpen = true; };
        const resume = () => { this.adOpen = false; this.gameplayStart(); };

        if (IN_POKI && typeof PokiSDK !== "undefined") {
            pause();
            try {
                const res = await PokiSDK.rewardedBreak();
                resume();
                return !!res?.success;
            } catch {
                resume();
                return false;
            }
        }

        if (IN_PLAYGAMA && typeof bridge !== "undefined") {
            // v2 advertisement module: event-driven state machine. The SDK may
            // fire 'rewarded' once; settle on the first terminal state.
            if (bridge.advertisement?.showRewarded) {
                pause();
                return await new Promise((resolve) => {
                    let settled = false;
                    let off = null;
                    const finish = (ok) => {
                        if (settled) return;
                        settled = true;
                        if (typeof off === "function") off();
                        resume();
                        resolve(ok);
                    };
                    const onState = (state) => {
                        if (state === "rewarded") finish(true);
                        else if (state === "closed" || state === "failed") finish(false);
                    };
                    try {
                        if (typeof bridge.advertisement.on === "function") {
                            off = bridge.advertisement.on("rewarded_state_changed", onState);
                        }
                        bridge.advertisement.showRewarded(placement);
                        setTimeout(() => finish(false), 60000); // never hang the reward flow
                    } catch {
                        finish(false);
                    }
                });
            }
            // v1 ads module: promise-based.
            if (bridge.ads?.showRewarded) {
                pause();
                try {
                    const res = await bridge.ads.showRewarded();
                    resume();
                    return !!res?.result;
                } catch {
                    resume();
                    return false;
                }
            }
        }

        return true; // local dev / portal: free reward
    }

    // ---- pause / mute (host veto) ----------------------------------------------

    setPaused(paused, onPause) {
        if (paused === this.pausedByHost) return;
        this.pausedByHost = paused;
        onPause(paused);
        if (paused) this.gameplayStop();
        else this.gameplayStart();
    }

    tabHidden() {
        if (this.save) this.save._save?.();
        // Host platforms handle visibility pause themselves; Poki via visibilitychange.
    }

    _onBridgeMessage(e) {
        const data = e.data;
        if (!data || typeof data !== "object") return;
        if (data.type === "pause" || data.event === "pause") {
            this.setPaused(true, (p) => this._emit("pause", p));
        } else if (data.type === "resume" || data.event === "resume") {
            this.setPaused(false, (p) => this._emit("pause", p));
        }
    }

    _emit(name, val) {
        if (this.onEvent) this.onEvent(name, val);
    }

    onEvent = null; // main.js assigns: (name, val) => game.setPaused(val)
}
