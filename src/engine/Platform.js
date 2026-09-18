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
        this._bridgeReady = null; // resolves once Playgama Bridge is initialized
        this._playgamaInitialized = false; // gate for every bridge.* module read
        this._gameReadySent = false;
        this._gameplaySent = null; // last gameplay_started/stopped state sent
        this._pendingAdNext = null; // level-transition callback to fire when an ad closes
        this.levelNo = null; // current level number, for platform messages
        this.language = "en"; // platform.language read after Bridge init
        this._boot();
    }

    get isPlaygama() { return IN_PLAYGAMA; }
    get isPoki() { return IN_POKI; }
    get isPlayables() { return IN_PLAYABLES; }

    /** True only when the armory may offer Watch Ad unlocks (Poki / Playgama
     *  portal builds). The live URL build has no ad SDK and the YouTube
     *  Playables build keeps the armory progression-only (only the X-ray hint
     *  refill uses rewarded ads there, per the MediaCube review) — so the
     *  armory never offers a Watch button on those. */
    get canShowRewarded() {
        return IN_POKI || IN_PLAYGAMA;
    }

    /** YouTube Playables ad APIs (official ytgame.ads namespace — the ONLY
     *  legal ad path on Playables; off-platform SDKs are prohibited). */
    get hasPlayablesAds() {
        return (
            IN_PLAYABLES &&
            typeof ytgame !== "undefined" &&
            !!ytgame.ads &&
            typeof ytgame.ads.requestInterstitialAd === "function" &&
            typeof ytgame.ads.requestRewardedAd === "function"
        );
    }

    _boot() {
        if (IN_POKI && typeof PokiSDK !== "undefined") {
            this._pokiBoot();
        }
        if (IN_PLAYABLES && typeof ytgame !== "undefined" && ytgame.game?.gameReady) {
            // Readiness is signaled from main.js on the first painted frame
            // (signalFirstFrameReady → signalGameReady), with loadingFinished()
            // as an idempotent backstop; nothing to do at boot beyond grabbing
            // the callbacks for pause/resume.
        }
        if (IN_PLAYGAMA) {
            window.addEventListener("message", (e) => this._onBridgeMessage(e));
            // Every Bridge module (platform / storage / advertisement / player)
            // is a getter gated behind initialize(): reading ANY of them before
            // the promise resolves makes the SDK log
            //   "Before using the SDK you must initialize it"
            // and hand back undefined. So nothing in this class may touch
            // bridge.* directly — it all goes through _bridgeReady below.
            this._bridgeReady = this._initPlaygama();
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

    /** Bind the Bridge global, initialize it, then wire host signals.
     *
     *  Ordering is mandatory (Playgama doc step 1: "Wait for Bridge
     *  initialization before calling any SDK API"). The script is a classic
     *  <script src> so the global normally exists by the time this module
     *  evaluates, but a slow CDN or a cache miss can still land us first —
     *  hence the bounded wait. If the global never appears we give up after
     *  the timeout so a blocked CDN can't hang boot (the game stays playable,
     *  just without portal storage/ads).
     *
     *  Resolving only once init has settled also protects the SAVE path:
     *  main.js awaits platform.ready() before save.init(), so storage is never
     *  detected while bridge.storage is still undefined (which would silently
     *  drop every write as "portal build, backend not ready"). */
    async _initPlaygama() {
        const b = await this._waitForBridge();
        if (!b) return;
        try {
            await b.initialize();
        } catch { /* Bridge still usable via mocks / QA tool */ }
        // Only treat the bridge as usable if its modules actually came up. A
        // rejected init leaves every module getter undefined (and logging) in
        // the real SDK, so binding against them would just produce the very
        // "Before using the SDK you must initialize it" noise we're removing.
        // `isInitialized` is a plain getter (not module-gated), so reading it is
        // always safe; bridges that don't expose it are assumed usable.
        const usable = typeof b.isInitialized === "boolean" ? b.isInitialized : true;
        if (!usable) return;
        this._playgamaInitialized = true;
        this.language = b.platform?.language || this.language;
        // Safe now: every module getter below is past the init gate.
        this._bindPlaygamaHostEvents();
        this._bindPlaygamaAdEvents();
        this._applyPlaygamaAudioState();
    }

    /** Poll for the Bridge global (it may still be downloading). Bounded. */
    _waitForBridge(timeoutMs = 15000) {
        return new Promise((resolve) => {
            const started = Date.now();
            const tick = () => {
                const b = typeof window !== "undefined" ? window.bridge : null;
                if (b && typeof b.initialize === "function") { resolve(b); return; }
                if (Date.now() - started >= timeoutMs) { resolve(null); return; }
                setTimeout(tick, 50);
            };
            tick();
        });
    }

    /** Send a Bridge platform message (game_ready / gameplay_started /
     *  level_completed …). Queued behind _bridgeReady, so it can be called at
     *  ANY point in boot without tripping the SDK's init guard. The SDK
     *  rejects a duplicate game_ready, so the rejection is swallowed. */
    _say(message, payload) {
        if (!IN_PLAYGAMA) return;
        const send = () => {
            if (!this._playgamaInitialized) return;
            if (typeof bridge === "undefined" || !bridge.platform) return;
            if (typeof bridge.platform.sendMessage !== "function") return;
            try {
                const res = bridge.platform.sendMessage(message, payload);
                if (res && typeof res.then === "function") res.catch(() => { /* deduped by SDK */ });
            } catch { /* noop */ }
        };
        if (this._bridgeReady) this._bridgeReady.then(send, send);
        else send();
    }

    /** Bridge message constant, falling back to the literal so we still send the
     *  documented string if the SDK's enum isn't readable. */
    _msg(name, fallback) {
        const M = typeof bridge !== "undefined" ? bridge.PLATFORM_MESSAGE : null;
        return (M && M[name]) || fallback;
    }

    /** The portal hides its loading screen and starts analytics on this. It also
     *  ARMS INTERSTITIALS: the Bridge's ad module records the game_ready
     *  timestamp and refuses to show ANY interstitial until
     *  `initialInterstitialDelay` seconds after it (failing before it ever
     *  reaches the platform). So this must fire exactly once, and reliably —
     *  sending it is a precondition for the level-complete ad to exist at all. */
    _sendGameReady() {
        if (!IN_PLAYGAMA || this._gameReadySent) return;
        this._gameReadySent = true;
        this._say(this._msg("GAME_READY", "game_ready"));
    }

    /** gameplay_started / gameplay_stopped, deduped (the Bridge forwards each to
     *  the platform's analytics, and setPaused can call these repeatedly). */
    _sendGameplay(started) {
        if (!IN_PLAYGAMA || this._gameplaySent === started) return;
        this._gameplaySent = started;
        this._say(started
            ? this._msg("GAMEPLAY_STARTED", "gameplay_started")
            : this._msg("GAMEPLAY_STOPPED", "gameplay_stopped"));
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
        if (!this._playgamaInitialized) return; // never touch bridge.* pre-init
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
        if (!this._playgamaInitialized) return;
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
        // Guarded on our own flag, not on `bridge.platform` — reading that getter
        // before initialize() resolves is exactly what makes the SDK log
        // "Before using the SDK you must initialize it".
        if (!this._playgamaInitialized) return;
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
            // Backstop only — the normal flow signals both from the first
            // painted frame in main.js (firstFrameReady MUST NOT wait for the
            // background art/audio warm: the cert suite times out while assets
            // still stream on slow connections). Idempotent + order-safe.
            this.signalFirstFrameReady();
            this.signalGameReady();
        }
        if (IN_PLAYGAMA) {
            // Playgama required message once the first playable frame is up —
            // platforms use it to hide their loading screen + start analytics.
            // Deduped + queued behind Bridge init on purpose: onAssetsReady fires
            // on EVERY asset batch (and synchronously when nothing is pending),
            // and the real SDK rejects a second game_ready. It also ARMS
            // interstitials — the ad module timestamps this message and refuses
            // to show an interstitial until initialInterstitialDelay has passed
            // since it, so game_ready must land exactly once.
            this._sendGameReady();
        }
    }

    /** YouTube Playables lifecycle, phase 1: the first frame has rendered.
     *  Signaled from the first rAF paint in main.js, NOT after assets finish.
     *  Idempotent — later calls (e.g. loadingFinished backstop) are no-ops.
     *  Real SDK shape: ytgame.game.firstFrameReady() (NOT top-level — Big
     *  Fluff passes the cert suite with this namespace). If the game
     *  namespace isn't present yet the flag stays clear so a later path
     *  (loadingFinished) retries. */
    signalFirstFrameReady() {
        if (this._ffrSent) return;
        const fn = IN_PLAYABLES && typeof ytgame !== "undefined" ? ytgame.game?.firstFrameReady : null;
        if (typeof fn !== "function") return; // SDK / game namespace not ready — retry later
        this._ffrSent = true;
        try { fn.call(ytgame.game); } catch { /* noop */ }
    }

    /** YouTube Playables lifecycle, phase 2: the game is interactable. The
     *  main menu renders and accepts input once openMenu() runs (level art
     *  loads lazily on PLAY). Idempotent. Real SDK shape:
     *  ytgame.game.gameReady(). */
    signalGameReady() {
        if (this._grSent) return;
        const fn = IN_PLAYABLES && typeof ytgame !== "undefined" ? ytgame.game?.gameReady : null;
        if (typeof fn !== "function") return; // SDK / game namespace not ready — retry later
        this._grSent = true;
        try { fn.call(ytgame.game); } catch { /* noop */ }
    }

    // ---- gameplay / ads ------------------------------------------------------

    gameplayStart() {
        if (IN_POKI && typeof PokiSDK !== "undefined") {
            try { PokiSDK.gameplayStart(); } catch { /* noop */ }
        }
        // Playgama wants GAMEPLAY_STARTED/STOPPED for its session analytics and
        // ad-pacing decisions. Deduped inside (setPaused can fire it repeatedly).
        this._sendGameplay(true);
    }

    gameplayStop() {
        if (IN_POKI && typeof PokiSDK !== "undefined") {
            try { PokiSDK.gameplayStop(); } catch { /* noop */ }
        }
        this._sendGameplay(false);
    }

    /** Ad at a natural break (results / level clear). */
    commercialBreak(next) {
        const go = typeof next === "function" ? next : () => {};
        if (IN_PLAYABLES && this.hasPlayablesAds) {
            // YouTube Playables: interstitial at the level-clear results panel.
            // The loop is frozen + UI locked for the ad's duration (the emit-
            // pause path in main.js), then everything resumes.
            this.playablesInterstitial("level_complete").then(go, go);
            return;
        }
        if (IN_PLAYGAMA) {
            // Tell the portal the level finished BEFORE requesting the ad — the
            // placement id below is the one modelled in playgama-bridge-config.json
            // ("level_completed", matching bridge.PLATFORM_MESSAGE.LEVEL_COMPLETED).
            // Passing the long-standing typo "level_complete" sent an undeclared
            // placement the platform didn't recognise.
            this._say(this._msg("LEVEL_COMPLETED", "level_completed"), this.levelNo != null ? { level: String(this.levelNo) } : undefined);
            this.gameplayStop();
            const show = () => {
                if (!this._playgamaInitialized) return false;
                if (typeof bridge === "undefined" || !bridge.advertisement) return false;
                if (typeof bridge.advertisement.showInterstitial !== "function") return false;
                this.adOpen = true;
                this._pendingAdNext = go;
                try {
                    // Settle on the promise OR the state event — whichever lands
                    // first; _settleAd() is idempotent for the other.
                    const res = bridge.advertisement.showInterstitial("level_completed");
                    if (res && typeof res.then === "function") res.then(() => this._settleAd(), () => this._settleAd());
                    return true;
                } catch { return false; }
            };
            (this._bridgeReady || Promise.resolve()).then(() => {
                // If the ad API isn't usable, never swallow the transition — the
                // player still gets their win panel / next level.
                if (!show()) { this.adOpen = false; this._pendingAdNext = null; this.gameplayStart(); go(); }
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

    /** YouTube Playables interstitial at a natural breakpoint (level clear,
     *  leaving a live level, starting a fresh level). Resolves true when an ad
     *  ran. No-ops (resolved false) on non-Playables builds, while an ad is
     *  already open, or during a host pause. Level-START ads are gated by a
     *  short re-arm window so a win-panel ad + immediate NEXT don't stack two
     *  ads on one transition; YouTube also frequency-caps server-side.
     *
     *  Per the Playables guidance, an interstitial is treated like a pause
     *  signal: freeze the sim + audio and lock the UI for its duration (via
     *  the emit-pause path), then resume. */
    playablesInterstitial(reason = "transition") {
        if (!this.hasPlayablesAds) return Promise.resolve(false);
        if (this.adOpen || this.pausedByHost) return Promise.resolve(false);
        if (reason === "level_start" && this._lastAdAt && performance.now() - this._lastAdAt < 45000) {
            return Promise.resolve(false); // just showed one at the win panel
        }
        this._lastAdAt = performance.now();
        this.adOpen = true;
        this._emit("pause", true); // main.js: freeze loop + audio + lock UI
        let done = false;
        // Never let a hung SDK leave the UI locked — 60s fail-safe.
        const t = setTimeout(() => finish(), 60000);
        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(t);
            this.adOpen = false;
            this._emit("pause", false); // main.js: resume (unless a menu is open)
        };
        try {
            return Promise.race([
                Promise.resolve(ytgame.ads.requestInterstitialAd())
                    .then(() => { finish(); return true; })
                    .catch(() => { finish(); return false; }),
                new Promise((res) => setTimeout(() => { finish(); res(false); }, 60000)),
            ]);
        } catch {
            finish();
            return Promise.resolve(false);
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

        if (IN_PLAYABLES && this.hasPlayablesAds) {
            // YouTube Playables rewarded ad. requestRewardedAd(rewardId)
            // resolves true only when the viewer earned the reward. Freeze the
            // loop + audio + lock the UI for the ad (emit-pause path), exactly
            // like the host-pause contract. 60s fail-safe so a hung SDK can
            // never leave the UI locked.
            this.adOpen = true;
            this._emit("pause", true);
            let done = false;
            const finish = (granted) => {
                if (done) return;
                done = true;
                this.adOpen = false;
                this._emit("pause", false);
                return granted;
            };
            try {
                return await Promise.race([
                    Promise.resolve(ytgame.ads.requestRewardedAd(placement || "reward"))
                        .then((earned) => finish(!!earned))
                        .catch(() => finish(false)),
                    new Promise((res) => setTimeout(() => res(finish(false)), 60000)),
                ]);
            } catch {
                return finish(false);
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
