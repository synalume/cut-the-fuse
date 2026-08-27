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
        const go = typeof next === "function" ? next : () => {};
        if (IN_POKI && typeof PokiSDK !== "undefined") {
            this.gameplayStop();
            this.adOpen = true;
            PokiSDK.rewardedBreak()
                .then((res) => { this.adOpen = false; go(!!res?.success); })
                .catch(() => { this.adOpen = false; go(false); });
        } else if (IN_PLAYGAMA && typeof bridge !== "undefined" && bridge.ads) {
            this.adOpen = true;
            try {
                bridge.ads.showRewarded()
                    .then((res) => { this.adOpen = false; go(!!res?.result); })
                    .catch(() => { this.adOpen = false; go(false); });
            } catch {
                this.adOpen = false;
                go(true); // dev/portal fallback: no ad platform wired
            }
        } else {
            go(true); // local dev / portal: free continue
        }
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
