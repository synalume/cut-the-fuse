// SaveManager.js — best stars per level, progress, star bank, and skins.
// Storage abstraction: localStorage locally, swappable to bridge.storage on
// Playgama (wobble-run pattern). Save stays well under the 500 KB budget.
const KEY = "cut_the_fuse_save_v1";

const DEFAULT_SAVE = {
    stars: {}, // levelId -> best stars (1-3)
    unlockedLevel: 1,
    starBank: 0,
    skins: {}, // skinId -> true (unlocked)
    selectedSkin: null,
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
}
