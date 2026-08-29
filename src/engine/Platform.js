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
        this._bridgeReady = null; // resolves once Playgama Bridge is initialized
        this._pendingAdNext = null; // level-transition callback to fire when an ad closes
        this.language = "en"; // platform.language read after Bridge init
        this._boot();
    }

    get isPlaygama() { return IN_PLAYGAMA; }
    get isPoki() { return IN_POKI; }
    get isPlayables() { return IN_PLAYABLES; }

    /** True only when a rewarded-ad SDK is actually wired (Poki / Playgama
     *  portal builds). The live URL build has no ad SDK, so the armory unlocks
     *  purely by progression (levels/stars) and never offers a Watch Ad button. */
    get canShowRewarded() {
        return IN_POKI || IN_PLAYGAMA;
    }

    _boot() {
        if (IN_POKI && typeof PokiSDK !== "undefined") {
            this._pokiBoot();
        }
        if (IN_PLAYABLES && typeof ytgame !== "undefined" && ytgame.gameReady) {
            // Readiness is signaled from loadingFinished() (firstFrameReady →
            // gameReady) once the first playable frame exists; nothing to do at
            // boot beyond grabbing the callbacks for pause/resume.
        }
        if (IN_PLAYGAMA) {
            window.addEventListener("message", (e) => this._onBridgeMessage(e));
            if (typeof bridge !== "undefined" && bridge.initialize) {
                try {
                    this._bridgeReady = bridge.initialize()
                        .then(() => {
                            this._subscribePlaygamaEvents();
                            this._applyPlaygamaAudioState();
                        })
                        .catch(() => { /* Bridge still usable via mocks */ });
                } catch { /* noop */ }
            }
        }
        // YouTube Playables forbids the Page Visibility API — its onPause /
        // onResume callbacks (wired in main.js) replace this listener there.
        if (!IN_PLAYABLES) {
            document.addEventListener("visibilitychange", () => {
                if (document.hidden) this.tabHidden();
            });
        }
    }

    /** Resolves once Playgama Bridge is initialized — Bridge SDK calls (storage,
     *  ads, platform reads) must all wait for it. Resolves immediately on plain
     *  builds and non-Playgama platforms. */
    ready() {
        return this._bridgeReady || Promise.resolve();
    }

    /** Bridge v2: await init, then wire pause + audio-state events (both are
     *  moderation requirements — the game must never play sound in the
     *  background) and record the platform language for localization. */
    _subscribePlaygamaEvents() {
        if (typeof bridge === "undefined" || !bridge.platform) return;
        try { this.language = bridge.platform.language || this.language; } catch { /* noop */ }
        try {
            const on = bridge.platform.on?.bind(bridge.platform) || (() => {});
            const pauseEvt = bridge.EVENT_NAME?.PAUSE_STATE_CHANGED || "pause_state_changed";
            on(pauseEvt, (isPaused) => this.setPaused(!!isPaused, (p) => this._emit("pause", p)));
            const audioEvt = bridge.EVENT_NAME?.AUDIO_STATE_CHANGED || "audio_state_changed";
            on(audioEvt, (isEnabled) => this.audio?.setHostMuted?.(!isEnabled));
            // Interstitial lifecycle: stop the game while the ad is open, then
            // resume and continue the level-transition flow exactly when it
            // closes (the showInterstitial promise settles the same moment).
            const intEvt = bridge.EVENT_NAME?.INTERSTITIAL_STATE_CHANGED || "interstitial_state_changed";
            on(intEvt, (state) => {
                if (state === "opened") { this.gameplayStop(); this.adOpen = true; }
                else if (state === "closed" || state === "failed") this._settleAd();
            });
        } catch { /* noop */ }
    }

    /** Bridge v2: apply the CURRENT host audio state on start (the event only
     *  fires on later changes, so the initial value must be applied manually). */
    _applyPlaygamaAudioState() {
        if (typeof bridge === "undefined" || !bridge.platform) return;
        try {
            if (typeof bridge.platform.isAudioEnabled === "boolean") {
                this.audio?.setHostMuted?.(!bridge.platform.isAudioEnabled);
            }
        } catch { /* noop */ }
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
        if (IN_PLAYABLES && typeof ytgame !== "undefined") {
            // Playables lifecycle: firstFrameReady MUST precede gameReady —
            // first signals frames are rendering, gameReady says the menu is
            // interactable (the menu IS the first frame here; there's no
            // separate loading screen).
            try { if (ytgame.firstFrameReady) ytgame.firstFrameReady(); } catch { /* noop */ }
            try { if (ytgame.gameReady) ytgame.gameReady(); } catch { /* noop */ }
        }
        if (IN_PLAYGAMA && typeof bridge !== "undefined" && bridge.platform?.sendMessage) {
            // Playgama required message once the first playable frame is up —
            // platforms use it to hide their loading screen + start analytics.
            (this._bridgeReady || Promise.resolve()).then(() => {
                try { bridge.platform.sendMessage("game_ready"); } catch { /* noop */ }
            });
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
        if (IN_PLAYGAMA && typeof bridge !== "undefined" && bridge.advertisement?.showInterstitial) {
            (this._bridgeReady || Promise.resolve()).then(() => {
                this.gameplayStop();
                this.adOpen = true;
                this._pendingAdNext = go;
                try {
                    // Settle on the promise OR the state event — whichever lands
                    // first; _settleAd() is idempotent for the other.
                    Promise.resolve(bridge.advertisement.showInterstitial("level_complete"))
                        .then(() => this._settleAd())
                        .catch(() => this._settleAd());
                } catch { this._settleAd(); }
            });
            return;
        }
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

    /** Resume after a Playgama interstitial closes; fires the level-transition
     *  callback at most once. */
    _settleAd() {
        const next = this._pendingAdNext;
        this._pendingAdNext = null;
        if (!next) return;
        this.adOpen = false;
        this.gameplayStart();
        next();
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
            // Bridge init must resolve before any advertisement call.
            await (this._bridgeReady || Promise.resolve());
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
