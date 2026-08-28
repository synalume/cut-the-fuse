// SaveManager.js — best stars per level, progress, star bank, skins, and the
// daily-challenge streak.
// Storage abstraction: localStorage locally, swappable to bridge.storage on
// Playgama (wobble-run pattern). Save stays well under the 500 KB budget.
import { yesterdayOf } from "./dates.js";
const KEY = "cut_the_fuse_save_v1";

/** Fresh defaults per instance — `_load` must NOT spread a module-level object,
 *  or every instance shares the same nested maps (stars/skins/dailyCompleted)
 *  and mutations leak across instances. */
const freshDefaults = () => ({
    stars: {}, // levelId -> best stars (1-3)
    unlockedLevel: 1,
    starBank: 0,
    skins: {}, // payload skinId -> true (unlocked)
    selectedSkin: null,
    igniters: {}, // igniter typeId -> true (unlocked)
    selectedIgniter: null,
    bestTimes: {}, // levelId -> best clear seconds (float)
    bestScores: {}, // levelId -> best efficiency score (int)
    dailyStreak: 0, // consecutive days with a completed daily challenge
    lastDailyDay: null, // "YYYY-MM-DD" of the last completed daily
    dailyCompleted: {}, // "YYYY-MM-DD" -> true
});

export class SaveManager {
    constructor(storageImpl = null) {
        this.impl = storageImpl; // { get, set } — Playgama bridge.storage if provided
        this.data = this._load();
    }

    _load() {
        try {
            if (this.impl && typeof this.impl.get === "function") {
                const raw = this.impl.get(KEY);
                if (raw) return { ...freshDefaults(), ...JSON.parse(raw) };
            }
            const raw = localStorage.getItem(KEY);
            if (raw) return { ...freshDefaults(), ...JSON.parse(raw) };
        } catch { /* corrupt save -> reset */ }
        return freshDefaults();
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

    // ---- efficiency score ------------------------------------------------------

    /** Best efficiency score, or 0 if never recorded. */
    getBestScore(levelId) {
        return this.data.bestScores[String(levelId)] || 0;
    }

    /** Store a new best efficiency score. Returns true if it was a new best. */
    setBestScore(levelId, score) {
        levelId = String(levelId);
        const prev = this.data.bestScores[levelId] || 0;
        if (typeof score === "number" && isFinite(score) && score > prev) {
            this.data.bestScores[levelId] = Math.floor(score);
            this._save();
            return true;
        }
        return false;
    }

    // ---- daily challenge ---------------------------------------------------

    getDailyStreak() {
        return this.data.dailyStreak || 0;
    }

    isDailyComplete(dateStr) {
        return !!this.data.dailyCompleted[dateStr];
    }

    /** Mark a day's daily challenge complete, maintaining the streak.
     *  Streak = consecutive days ending today; a gap resets to 1.
     *  Returns { streak, newDay } — newDay is false when already done. */
    markDailyComplete(dateStr) {
        if (this.data.dailyCompleted[dateStr]) {
            return { streak: this.data.dailyStreak || 0, newDay: false };
        }
        this.data.dailyCompleted[dateStr] = true;
        this.data.dailyStreak =
            this.data.lastDailyDay === yesterdayOf(dateStr) ? (this.data.dailyStreak || 0) + 1 : 1;
        this.data.lastDailyDay = dateStr;
        this._save();
        return { streak: this.data.dailyStreak, newDay: true };
    }
}
