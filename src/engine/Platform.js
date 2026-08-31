// Platform.js — Playgama / Poki / YouTube Playables / portal SDK hooks.
// Build scripts inject one flag + one SDK per zip; absent flags mean the game
// runs identically on localhost with no-op fallbacks (wobble-run pattern).
const IN_PLAYGAMA = !!window.__CUT_THE_FUSE_PLAYGAMA__;
const IN_POKI = !!window.__CUT_THE_FUSE_POKI__;
const IN_PLAYABLES =
    !!window.__CUT_THE_FUSE_PLAYABLES__ ||
    (typeof ytgame !== "undefined" && !!ytgame.IN_PLAYABLES_ENV && !/localhost|127\.0\.0\.1/i.test(location.hostname));

export class Platform {
    constructor({ audio, save, canvas }) {
        this.audio = audio;
        this.save = save;
        this.canvas = canvas || null;
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
            // Host pause/mute must bind even if bridge.initialize() is slow —
            // the QA tool's qa_tool platform can emit signals while init is
            // pending. Idempotent, so the post-init pass just fills the gap
            // when the modules weren't ready yet at boot.
            this._bindPlaygamaHostEvents();
            if (typeof bridge !== "undefined" && bridge.initialize) {
                try {
                    this._bridgeReady = bridge.initialize()
                        .then(() => {
                            this.language = bridge.platform?.language || this.language;
                            this._bindPlaygamaHostEvents();
                            this._bindPlaygamaAdEvents();
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
                else if (IN_PLAYGAMA) this._applyPlaygamaAudioState();
            });
        }
    }

    /** Resolves once Playgama Bridge is initialized — Bridge SDK calls (storage,
     *  ads, platform reads) must all wait for it. Resolves immediately on plain
     *  builds and non-Playgama platforms. */
    ready() {
        return this._bridgeReady || Promise.resolve();
    }

    /** Bridge v2: bind pause + audio-state host signals. Both are moderation
     *  requirements — the game must never play sound while muted by the host.
     *  Binds platform.on when available, falling back to bridge.on (the QA
     *  tool's qa_tool platform can expose events without full init). Idempotent. */
    _bindPlaygamaHostEvents() {
        if (this._playgamaHostBound) return;
        if (typeof bridge === "undefined") return;
        const pauseEvt = bridge.EVENT_NAME?.PAUSE_STATE_CHANGED || "pause_state_changed";
        const audioEvt = bridge.EVENT_NAME?.AUDIO_STATE_CHANGED || "audio_state_changed";
        const onPause = (isPaused) => this.setPaused(!!isPaused, (p) => this._emit("pause", p));
        const onAudio = (enabled) => {
            if (typeof enabled !== "boolean") return;
            this.audio?.setHostMuted?.(!enabled);
        };
        try {
            if (bridge.platform && typeof bridge.platform.on === "function") {
                bridge.platform.on(pauseEvt, onPause);
                bridge.platform.on(audioEvt, onAudio);
                this._playgamaHostBound = true;
                return;
            }
        } catch { /* noop */ }
        try {
            if (typeof bridge.on === "function") {
                bridge.on(pauseEvt, onPause);
                bridge.on(audioEvt, onAudio);
                this._playgamaHostBound = true;
            }
        } catch { /* noop */ }
    }

    /** Bridge v2: interstitial lifecycle. bridge.advertisement only exists once
     *  init resolves, so this always runs after _bridgeReady settles. */
    _bindPlaygamaAdEvents() {
        if (this._playgamaAdBound) return;
        if (typeof bridge === "undefined" || !bridge.advertisement) return;
        try {
            const on = bridge.advertisement.on?.bind(bridge.advertisement);
            if (typeof on !== "function") return;
            const intEvt = bridge.EVENT_NAME?.INTERSTITIAL_STATE_CHANGED || "interstitial_state_changed";
            on(intEvt, (state) => {
                if (state === "opened") { this.gameplayStop(); this.adOpen = true; }
                else if (state === "closed" || state === "failed") this._settleAd();
            });
            this._playgamaAdBound = true;
        } catch { /* noop */ }
    }

    /** Bridge v2: apply the CURRENT host audio state (the event only fires on
     *  later changes, so the initial value must be applied manually). Re-read
     *  after init and whenever the iframe regains focus. */
    _applyPlaygamaAudioState() {
        if (typeof bridge === "undefined" || !bridge.platform) return;
        try {
            const en = bridge.platform.isAudioEnabled;
            if (typeof en === "boolean") this.audio?.setHostMuted?.(!en);
        } catch { /* noop */ }
    }

    // ---- Poki --------------------------------------------------------------

    _pokiBoot() {
        window.addEventListener("keydown", (ev) => {
            if (["ArrowDown", "ArrowUp", " "].includes(ev.key)) ev.preventDefault();
        });
        const inited = () => {
            this._pokiInitDone = true;
            this._pokiBindPlaytestCapture();
            this._pokiMaybeLoaded();
        };
        if (typeof PokiSDK === "undefined") inited();
        else PokiSDK.init().then(inited).catch(inited);
    }

    /** Poki's playtest recorder uses canvas.captureStream() — it records the
     *  canvas' pixels only. HTML/DOM overlays (controls, tutorial, modals) are
     *  invisible unless we opt in, and the recorder must be told WHICH canvas to
     *  track. Without this the playtest videos show a black canvas with none of
     *  the UI. Re-bind after every canvas buffer realloc (resize changes
     *  canvas.width/height, which detaches the stream). Idempotent. */
    pokiBindPlaytestCapture(canvas) {
        if (!IN_POKI || typeof PokiSDK === "undefined") return;
        const target = canvas || this.canvas;
        if (!target) return;
        try {
            if (typeof PokiSDK.playtestSetCanvas === "function") {
                PokiSDK.playtestSetCanvas(target);
            }
            if (typeof PokiSDK.playtestCaptureHtmlOn === "function") {
                PokiSDK.playtestCaptureHtmlOn();
            }
        } catch { /* noop */ }
    }

    _pokiBindPlaytestCapture() {
        this.pokiBindPlaytestCapture();
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
        if (paused) {
            this.gameplayStop();
            // A host pause must silence the game too — freeze the audio graph
            // (big-fluff pattern), not just the simulation loop.
            this.audio?.suspend?.();
        } else {
            this.audio?.resume?.();
            this.gameplayStart();
        }
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
