// SaveManager.js — best stars per level, progress, star bank, and skins.
// Storage abstraction: localStorage locally, swappable to bridge.storage on
// Playgama (wobble-run pattern). Save stays well under the 500 KB budget.
const KEY = "cut_the_fuse_save_v1";

const DEFAULT_SAVE = {
    stars: {}, // levelId -> best stars (1-3)
    unlockedLevel: 1,
    starBank: 0,
    skins: {}, // payload skinId -> true (unlocked)
    selectedSkin: null,
    igniters: {}, // igniter typeId -> true (unlocked)
    selectedIgniter: null,
    bestTimes: {}, // levelId -> best clear seconds (float)
};

export class SaveManager {
    constructor(storageImpl = null) {
        this.impl = storageImpl; // { get, set } — Playgama bridge.storage if provided
        this.data = this._load();
    }

    _load() {
        try {
            if (this.impl && typeof this.impl.get === "function") {
                const raw = this.impl.get(KEY);
                if (raw) return { ...DEFAULT_SAVE, ...JSON.parse(raw) };
            }
            const raw = localStorage.getItem(KEY);
            if (raw) return { ...DEFAULT_SAVE, ...JSON.parse(raw) };
        } catch { /* corrupt save -> reset */ }
        return { ...DEFAULT_SAVE };
    }

    _save() {
        try {
            const raw = JSON.stringify(this.data);
            if (this.impl && typeof this.impl.set === "function") {
                this.impl.set(KEY, raw);
            } else {
                localStorage.setItem(KEY, raw);
            }
        } catch { /* storage unavailable (private mode etc.) */ }
    }

    // ---- stars ---------------------------------------------------------

    getStars(levelId) {
        return this.data.stars[String(levelId)] || 0;
    }

    /** Keep the best score; bank the delta in stars (net positive only). */
    setStars(levelId, stars) {
        levelId = String(levelId);
        const prev = this.data.stars[levelId] || 0;
        if (stars > prev) {
            this.data.stars[levelId] = stars;
            this.data.starBank += stars - prev;
            this._save();
        }
    }

    // ---- progression -------------------------------------------------------

    getUnlockedLevel() {
        return this.data.unlockedLevel;
    }

    setUnlockedLevel(n) {
        if (n > this.data.unlockedLevel) {
            this.data.unlockedLevel = n;
            this._save();
        }
    }

    // ---- star bank + skins -------------------------------------------------

    getStarBank() {
        return this.data.starBank;
    }

    spendStars(n) {
        if (this.data.starBank < n) return false;
        this.data.starBank -= n;
        this._save();
        return true;
    }

    isSkinUnlocked(skinId) {
        return !!this.data.skins[skinId];
    }

    unlockSkin(skinId) {
        this.data.skins[skinId] = true;
        this._save();
    }

    getSelectedSkin() {
        return this.data.selectedSkin;
    }

    setSelectedSkin(skinId) {
        this.data.selectedSkin = skinId;
        this._save();
    }

    getUnlockedSkins() {
        return Object.keys(this.data.skins);
    }

    // ---- igniter types -----------------------------------------------------

    isIgniterUnlocked(igniterId) {
        return !!this.data.igniters[igniterId];
    }

    unlockIgniter(igniterId) {
        this.data.igniters[igniterId] = true;
        this._save();
    }

    getSelectedIgniter() {
        return this.data.selectedIgniter;
    }

    setSelectedIgniter(igniterId) {
        this.data.selectedIgniter = igniterId;
        this._save();
    }

    getUnlockedIgniters() {
        return Object.keys(this.data.igniters);
    }

    // ---- speed records -----------------------------------------------------

    /** Best clear time in seconds, or null if the level has never been cleared. */
    getBestTime(levelId) {
        const t = this.data.bestTimes[String(levelId)];
        return typeof t === "number" ? t : null;
    }

    /** Store a new best clear time. Returns true if it was a new record. */
    setBestTime(levelId, seconds) {
        levelId = String(levelId);
        const prev = this.data.bestTimes[levelId];
        if (typeof seconds !== "number" || !isFinite(seconds) || seconds <= 0) return false;
        if (prev == null || seconds < prev) {
            this.data.bestTimes[levelId] = seconds;
            this._save();
            return true;
        }
        return false;
    }

    /** Add a star-bank bonus (PERFECT SNIPs). Never negative. */
    depositStars(n) {
        if (typeof n !== "number" || n <= 0) return;
        this.data.starBank += Math.floor(n);
        this._save();
    }
}
