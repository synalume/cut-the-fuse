// main.js — entry point: fetch levels.json, build the engine stack, wire UI.
// Cut the Fuse: Bomb Puzzle. Copyright © 2026 Synalume, LLC. All rights reserved.
import { GameLoop, STATE } from "./engine/GameLoop.js";
import { Renderer, REACTION_WORDS } from "./engine/Renderer.js";
import { InputHandler } from "./engine/InputHandler.js";
import { AudioManager } from "./engine/AudioManager.js";
import { SaveManager } from "./engine/SaveManager.js";
import { Analytics } from "./engine/Analytics.js";
import { Platform } from "./engine/Platform.js";
import { buildLevel, resolveAssets } from "./engine/LevelManager.js";
import { PAYLOAD_SKINS, IGNITER_TYPES, isSkinOwned, skinStarPrice } from "./data/skins.js";
import { todayStr, dayNumber } from "./engine/dates.js";

// Level-select gating. During playtest every level is pickable; flip to true
// for release to enforce linear unlock (must beat N to play N+1).
const LOCK_LEVELS = false;

const $ = (id) => document.getElementById(id);

// ---- core objects -------------------------------------------------------------

const canvas = $("game-canvas");
const renderer = new Renderer(canvas);
renderer.root = $("game-container");
const audio = new AudioManager();
const save = new SaveManager();
const analytics = new Analytics();
const platform = new Platform({ audio, save });

const game = new GameLoop({ canvas, renderer, audio, analytics, platform });
platform.onEvent = (name, val) => {
    if (name === "pause") game.setPaused(val);
};

const input = new InputHandler(canvas, game);

// QA hook: lets Playwright drive the loop and read game state directly.
window.__CTF__ = { game, renderer, save, REACTION_WORDS, get levels() { return levels; } };

// ---- UI elements ---------------------------------------------------------------

const levelLabel = $("level-label");
const snipsCounter = $("snips-counter");
const starDisplay = $("star-display");
const btnHint = $("btn-hint");
const btnMute = $("btn-mute");
const btnZoomIn = $("btn-zoom-in");
const btnZoomOut = $("btn-zoom-out");
const modalLose = $("modal-lose");
const modalWin = $("modal-win");
const modalDda = $("modal-dda");
const modalEnd = $("modal-end");
const modalSkins = $("modal-skins");
const modalLevels = $("modal-levels");
const modalMenu = $("modal-menu");
const levelGrid = $("level-grid");
const tutorialOverlay = $("tutorial-overlay");
const tutorialText = $("tutorial-text");
const btnTutorialNext = $("tutorial-next");
const menuStars = $("menu-stars");
const winStars = $("win-stars");
const winTime = $("win-time");
const winRecord = $("win-record");
const winPerfect = $("win-perfect");
const winPerfectCount = $("win-perfect-count");
const winScore = $("win-score");
const winBest = $("win-best");
const winStreak = $("win-streak");
const btnNext = $("btn-next");
const ddaText = $("dda-text");

let levels = [];
let levelIndex = 0;
let selectorPaused = false; // true when the level selector paused a live game
let dailyMode = false; // true while playing TODAY'S CHALLENGE

// ---- level loading -------------------------------------------------------------

/** The current loadout (payload skin + igniter) from the save. */
const loadoutOf = () => ({ payloadSkin: save.getSelectedSkin(), igniter: save.getSelectedIgniter() });

/** Story position: the first level not yet cleared. A fresh save → Level 1;
 *  a player mid-way → their current level; a fully-cleared save → Level 1
 *  (a new run). The level map handles jumping anywhere. */
function storyStartIndex() {
    for (let i = 0; i < levels.length; i++) {
        if (save.getStars(levels[i].level_id) === 0) return i;
    }
    return 0;
}

async function loadLevel(index) {
    levelIndex = index;
    const config = levels[index];
    // Live resolution: the level's own art when pinned, else the player's
    // loadout (payload skin + igniter), else the placeholder set.
    const assets = await resolveAssets(config, renderer.hasAsset.bind(renderer), loadoutOf());
    const level = buildLevel(config, { width: renderer.width, height: renderer.height }, assets);

    // Load this level's assets (placeholder fallback handled by resolveAssets).
    renderer.loadAssets(assets.payloadAssets);
    renderer.loadAssets(assets.spawnAssets);

    game.levelMode = dailyMode ? "daily" : "story";
    game.loadLevel(level, index);
    renderer.resize();

    levelLabel.textContent = dailyMode ? "DAILY ▾" : `LEVEL ${config.level_id}`;
    updateUi();
    closeModals();
    startTutorialIfPresent(level);
    platform.gameplayStart();
}

function updateUi() {
    // Snip counter: a scissors icon per remaining cut. Spent icons dim so the
    // limited budget is visible at a glance; the whole pill turns amber on the
    // last snip and red once it's empty.
    snipsCounter.textContent = "";
    const label = document.createElement("span");
    label.className = "snips-label";
    label.textContent = "SNIPS";
    snipsCounter.appendChild(label);
    const allowed = game.level?.snipsAllowed ?? 0;
    for (let i = 0; i < allowed; i++) {
        const img = document.createElement("img");
        img.className = "snip-icon" + (i < game.snipsRemaining ? "" : " spent");
        img.src = "assets/ui/ui-icon-scissors.png";
        img.alt = "✂";
        snipsCounter.appendChild(img);
    }
    snipsCounter.classList.toggle("depleted", game.snipsRemaining <= 0);
    snipsCounter.classList.toggle("last-snip", game.snipsRemaining === 1 && allowed > 1);

    const bank = `${save.getStarBank()}`;
    starDisplay.textContent = bank;
    if (menuStars) menuStars.textContent = bank;
    btnHint.classList.toggle("active", game.hintActive);
    btnMute.classList.toggle("muted", audio.muted);
}

// Modals that pause a live game (the hub, level select, armory). Opening one
// closes every other overlay, so two modals can never stack on top of each
// other — the level-select/armory overlap bug.
const MENU_MODALS = () => [modalLevels, modalSkins, modalMenu];

function openModal(el, display = "flex") {
    // Hide every other overlay, then take the screen.
    for (const m of [modalLose, modalWin, modalDda, modalEnd, modalSkins, modalLevels, modalMenu]) {
        if (m !== el) m.style.display = "none";
    }
    tutorialOverlay.style.display = "none";
    game.tutorialActive = false; // a menu over a teaching card ends the pre-level pause
    if (game.gameState === STATE.PLAYING) {
        selectorPaused = true;
        game.setPaused(true);
    }
    el.style.display = display;
}

function closeModal(el) {
    el.style.display = "none";
    resumeIfPausedByMenu();
}

/** Unpause a live game the moment every menu modal is gone. */
function resumeIfPausedByMenu() {
    if (selectorPaused && !MENU_MODALS().some((m) => m.style.display !== "none")) {
        selectorPaused = false;
        game.setPaused(false);
    }
}

function closeModals() {
    modalLose.style.display = "none";
    modalWin.style.display = "none";
    modalDda.style.display = "none";
    modalEnd.style.display = "none";
    modalSkins.style.display = "none";
    modalLevels.style.display = "none";
    modalMenu.style.display = "none";
    tutorialOverlay.style.display = "none";
    game.tutorialActive = false;
    resumeIfPausedByMenu();
}

// ---- level selector --------------------------------------------------------------

function openLevelSelect() {
    renderLevelGrid();
    renderDailyRow();
    openModal(modalLevels, "flex");
}

function closeLevelSelect() {
    closeModal(modalLevels);
}

// ---- main menu hub ----------------------------------------------------------------

/** The hub is the home screen: PLAY resumes or starts the current level, and
 *  everything else (daily, level select, armory) opens its own modal. */
function openMenu() {
    updateUi();
    renderDailyRow(); // keep the hub daily button in sync (REPLAY after a clear)
    openModal(modalMenu, "flex");
}

function closeMenu() {
    closeModal(modalMenu);
}

$("btn-menu").addEventListener("click", openMenu);
$("btn-menu-play").addEventListener("click", () => {
    // A level is live → resume exactly where it was. Otherwise start playing.
    if (game.level && game.gameState === STATE.PLAYING) {
        closeMenu();
    } else {
        loadLevel(levelIndex);
    }
});
$("btn-menu-daily").addEventListener("click", openDaily);
$("btn-menu-levels").addEventListener("click", openLevelSelect);
$("btn-menu-armory").addEventListener("click", openArmory);

function renderLevelGrid() {
    levelGrid.innerHTML = "";
    for (let i = 0; i < levels.length; i++) {
        const id = levels[i].level_id;
        const locked = LOCK_LEVELS && id > save.getUnlockedLevel();

        const cell = document.createElement("button");
        cell.className = "level-cell";
        cell.title = locked ? `Beat level ${id - 1} to unlock` : `Play level ${id}`;
        if (locked) cell.classList.add("locked");
        if (i === levelIndex) cell.classList.add("current");

        const num = document.createElement("div");
        num.className = "num";
        num.textContent = locked ? "🔒" : String(id).padStart(2, "0");

        const earned = save.getStars(id);
        const stars = document.createElement("div");
        stars.className = "stars";
        for (let i = 0; i < 3; i++) {
            const img = document.createElement("img");
            img.src = "assets/ui/ui-icon-star.png";
            img.alt = "★";
            if (i >= earned) img.className = "dim";
            stars.appendChild(img);
        }

        const best = save.getBestTime(id);
        const time = document.createElement("div");
        time.className = "time";
        time.textContent = best != null ? `${best.toFixed(1)}s` : "";

        cell.append(num, stars, time);
        cell.addEventListener("click", () => {
            if (locked) return;
            if (dailyMode) exitDaily();
            loadLevel(i);
            closeLevelSelect();
        });
        levelGrid.appendChild(cell);
    }
}

$("level-label").addEventListener("click", openLevelSelect);
$("btn-levels-close").addEventListener("click", openMenu);

// ---- daily challenge -------------------------------------------------------------

// Deterministic pick: 37 is coprime with 120, so consecutive days cycle through
// all 120 levels with no repeats within a full cycle (same for every player).
const dailyLevelIndex = (dayNum) => (dayNum * 37) % levels.length;

function openDaily() {
    const today = todayStr();
    dailyMode = true;
    analytics.track("daily_visit", {
        date: today,
        streak: save.getDailyStreak(),
        completed: save.isDailyComplete(today),
    });
    loadLevel(dailyLevelIndex(dayNumber()));
    closeLevelSelect();
}

function exitDaily() {
    dailyMode = false;
    btnNext.innerHTML = `<img src="assets/ui/ui-icon-next.png" alt="">NEXT LEVEL`;
}

/** Refresh the daily banner (today's status + streak + best) in the level
 *  selector AND the hub button. The buttons ALWAYS re-enter the challenge —
 *  even after today's clear — so a player can replay and chase their best. */
function renderDailyRow() {
    const today = todayStr();
    const done = save.isDailyComplete(today);
    const label = done ? "🔥 REPLAY TODAY'S CHALLENGE" : "🔥 TODAY'S CHALLENGE";
    $("btn-daily").textContent = label;
    $("btn-daily").disabled = false;
    $("btn-menu-daily").textContent = label;
    const idx = dailyLevelIndex(dayNumber());
    const best = save.getBestScore(levels[idx].level_id);
    const streak = $("daily-streak");
    streak.textContent = `STREAK ${save.getDailyStreak()}`;
    if (done && best > 0) streak.textContent += ` · BEST ${best}`;
}

$("btn-daily").addEventListener("click", openDaily);

// ---- tutorial ------------------------------------------------------------------

// Each level's tutorial text shows the FIRST time that level loads in a
// session. Re-entering a level later skips it, so replays don't re-educate.
let seenTutorials = new Set();

function startTutorialIfPresent(level) {
    // The daily challenge must never spoil its own solution with a tutorial.
    if (dailyMode) return;
    if (!level.tutorial || seenTutorials.has(level.level_id)) return;
    seenTutorials.add(level.level_id);
    game.tutorialActive = true;
    tutorialText.textContent = level.tutorial.text;
    tutorialOverlay.style.display = "flex";
    btnTutorialNext.focus();
}

btnTutorialNext.addEventListener("click", () => {
    game.tutorialActive = false;
    tutorialOverlay.style.display = "none";
});

// ---- modals ---------------------------------------------------------------------

function showStars(stars) {
    winStars.innerHTML = "";
    const spans = [];
    for (let i = 1; i <= 3; i++) {
        const img = document.createElement("img");
        img.src = "assets/ui/ui-icon-star.png";
        img.alt = "★";
        img.className = "dim"; // all start dim; earned ones light in sequence
        winStars.appendChild(img);
        spans.push(img);
    }
    // Star reveal: each earned star pops into the case with an ascending coin
    // chime — the Cut the Rope-style burst-into-the-slot beat. Skipped if the
    // player closes the modal mid-reveal.
    let delay = 120;
    for (let i = 0; i < stars; i++) {
        const idx = i;
        setTimeout(() => {
            if (modalWin.style.display !== "block") return;
            spans[idx].className = "pop";
            audio.play("win_star", { rate: 1.0 + idx * 0.3 });
        }, delay);
        delay += 190;
    }
}

game.onSnipsChange = () => updateUi();
// A banked gold star pulses the snip counter green so the +1 reads even when
// the count net-settles (the star refunds the snip the cut just spent).
game.onStarBanked = () => {
    snipsCounter.classList.remove("bonus");
    void snipsCounter.offsetWidth; // restart the CSS animation
    snipsCounter.classList.add("bonus");
};
game.onNoSnips = () => {
    // Shake the snips counter so running out never feels like the game stopped
    // responding. The canvas draws the "NO MORE SNIPS!" bubble as well.
    snipsCounter.classList.remove("shake");
    void snipsCounter.offsetWidth; // restart the CSS animation
    snipsCounter.classList.add("shake");
};
game.onLevelComplete = (levelId, stars, won) => {
    if (won) {
        save.setStars(levelId, stars);
        save.setUnlockedLevel(Math.min(levels.length, levelId + 1));
        // Progression unlocks: skins whose level threshold was just crossed.
        if (unlockProgressRewards() > 0) {
            starDisplay.classList.add("new-unlock");
        }
        // Speed reward: PERFECT SNIPs + multi-cut bonus stars (one per extra
        // wick sliced by a single snip) bank at level clear.
        const perfect = game.perfectSnips;
        const multi = game.multikillStars;
        const earned = perfect + multi;
        if (earned > 0) save.depositStars(earned);
        updateUi();

        // Speed record: clear time vs the level's par, plus perfect-snip count.
        const seconds = Math.round((game.clearFrames / 60) * 10) / 10;
        const isRecord = save.setBestTime(levelId, seconds);
        winTime.textContent = `TIME ${seconds.toFixed(1)}s`;
        winRecord.style.display = isRecord ? "inline-block" : "none";

        // Efficiency score: fewer snips used → higher. Fewest snips = most
        // thinking about where to cut, so it scores highest.
        const score = game.computeScore();
        const scoreRecord = save.setBestScore(levelId, score);
        winScore.textContent = `SCORE ${score}`;
        winBest.style.display = scoreRecord ? "inline-block" : "none";
        if (perfect > 0) {
            winPerfectCount.textContent = `×${perfect}`;
            winPerfect.style.display = "inline-block";
        } else {
            winPerfect.style.display = "none";
        }

        if (dailyMode) {
            // Daily win: advance the streak once per day, then land back in
            // the level selector instead of the linear ladder.
            const res = save.markDailyComplete(todayStr());
            analytics.track("daily_complete", {
                date: todayStr(),
                streak: res.streak,
                newDay: res.newDay,
            });
            winStreak.textContent = `STREAK ${res.streak}`;
            winStreak.style.display = "inline-block";
            btnNext.innerHTML = `<img src="assets/ui/ui-icon-next.png" alt="">OK`;
        } else {
            winStreak.style.display = "none";
            btnNext.innerHTML = `<img src="assets/ui/ui-icon-next.png" alt="">NEXT LEVEL`;
        }

        // Let the defuse beat land first — burst + sting + bomb hop + comic
        // word play on the canvas for ~0.75s, then the panel slides in and the
        // earned stars pop one at a time (mirrors the lose path, which waits
        // for the blast to settle before showing the retry card).
        setTimeout(() => {
            if (game.gameState !== STATE.WON) return; // level was reloaded meanwhile
            modalWin.style.display = "block";
            platform.commercialBreak();
            showStars(stars);
        }, 750);
    } else {
        // Let the blast FX + payload bounce play out before covering the canvas.
        setTimeout(() => {
            if (game.gameState !== STATE.LOST) return; // level was reloaded meanwhile
            modalLose.style.display = "block";
            // DDA offer after repeated fails.
            const threshold = game.level.dda?.failThreshold ?? 3;
            if (game.failCount >= threshold && game.ddaTier < (game.level.dda?.tierSteps?.length || 3)) {
                ddaText.textContent = `You've failed this level ${game.failCount} times. Want a little help?`;
                modalDda.style.display = "block";
            }
        }, 950);
    }
};

game.onDdaTierChanged = (tier, offer) => {
    updateUi();
    if (offer) modalDda.style.display = "block";
    else modalDda.style.display = "none";
};

$("btn-dda-accept").addEventListener("click", () => {
    modalDda.style.display = "none";
    game.acceptDda();
    updateUi();
});

$("btn-dda-decline").addEventListener("click", () => {
    modalDda.style.display = "none";
    game.declineDda();
});

// ---- retry / next ----------------------------------------------------------------

$("btn-retry").addEventListener("click", () => {
    modalLose.style.display = "none";
    game.resetLevel();
    platform.gameplayStart();
});

$("btn-next").addEventListener("click", () => {
    modalWin.style.display = "none";
    if (dailyMode) {
        // Back to the map so the streak banner + "done today" state is visible.
        exitDaily();
        openLevelSelect();
        return;
    }
    if (levelIndex + 1 < levels.length) {
        loadLevel(levelIndex + 1);
    } else {
        modalEnd.style.display = "block"; // end-of-content (YouTube requirement)
    }
});

$("btn-end-replay").addEventListener("click", () => {
    modalEnd.style.display = "none";
    loadLevel(0);
});

// ---- controls ----------------------------------------------------------------------

btnHint.addEventListener("click", () => {
    game.toggleHint();
    updateUi();
});

btnMute.addEventListener("click", () => {
    audio.toggleMute();
    updateUi();
});

btnZoomIn.addEventListener("click", () => game.changeZoom(0.2));
btnZoomOut.addEventListener("click", () => game.changeZoom(-0.2));

// Esc closes any open modal / tutorial (YouTube Playables requirement).
window.addEventListener("game:escape", () => {
    if (tutorialOverlay.style.display === "flex") {
        game.tutorialActive = false;
        tutorialOverlay.style.display = "none";
    } else if (modalLevels.style.display === "flex") {
        closeLevelSelect();
    } else if (modalWin.style.display === "block") {
        modalWin.style.display = "none";
    } else if (modalLose.style.display === "block") {
        modalLose.style.display = "none";
    } else if (modalDda.style.display === "block") {
        modalDda.style.display = "none";
    } else if (modalSkins.style.display === "block") {
        closeModal(modalSkins);
    } else if (modalMenu.style.display === "flex") {
        closeMenu();
    }
});

// ---- armory (payload skins + igniter types) ------------------------------------

let armoryTab = "payload"; // "payload" | "igniter"

const ARMORY_LISTS = { payload: PAYLOAD_SKINS, igniter: IGNITER_TYPES };
const isOwned = (kind, id) => (kind === "payload" ? save.isSkinUnlocked(id) : save.isIgniterUnlocked(id));
// A null selection means "the starter" — the first item of the list.
const isSelected = (kind, id) => {
    const sel = kind === "payload" ? save.getSelectedSkin() : save.getSelectedIgniter();
    if (sel == null) return id === ARMORY_LISTS[kind][0].id;
    return sel === id;
};
const selectItem = (kind, id) => (kind === "payload" ? save.setSelectedSkin(id) : save.setSelectedIgniter(id));
const fallbackFrame = (kind) => (kind === "payload" ? "lvl1_banana_panic.png" : "lvl1_matchstick_idle.png");

starDisplay.style.cursor = "pointer";
starDisplay.title = "Armory";
starDisplay.addEventListener("click", () => {
    starDisplay.classList.remove("new-unlock");
    openArmory();
});

function openArmory() {
    renderArmory();
    openModal(modalSkins, "block");
}

$("btn-skins-close").addEventListener("click", openMenu);

$("tab-payloads").addEventListener("click", () => {
    armoryTab = "payload";
    renderArmory();
});
$("tab-igniters").addEventListener("click", () => {
    armoryTab = "igniter";
    renderArmory();
});

/** Apply a loadout change immediately when the level hasn't started (no snip
 *  spent, no spark burning); otherwise it lands on the next level load. */
function applyLoadout() {
    const lvl = game.level;
    if (!lvl) return;
    if (game.snipsRemaining < (lvl.snipsAllowed ?? 0)) return; // mid-level
    if (game.sparks?.some((s) => s.progress > 0 || s.diedAt != null)) return;
    loadLevel(levelIndex);
}

function renderArmory() {
    $("tab-payloads").classList.toggle("active", armoryTab === "payload");
    $("tab-igniters").classList.toggle("active", armoryTab === "igniter");
    const grid = $("skin-grid");
    grid.innerHTML = "";
    const reached = save.getUnlockedLevel();

    for (const item of ARMORY_LISTS[armoryTab]) {
        const card = document.createElement("div");
        card.className = "skin-card";
        const owned = isSkinOwned(item, reached, isOwned(armoryTab, item.id));
        const selected = isSelected(armoryTab, item.id);
        card.classList.toggle("locked", !owned);
        card.classList.toggle("selected", owned && selected);

        const img = document.createElement("img");
        const firstFrame = item.assets.playing || item.assets.idle;
        img.src = `assets/${firstFrame}`;
        img.onerror = () => { img.onerror = null; img.src = `assets/${fallbackFrame(armoryTab)}`; };
        img.alt = item.name;
        // Per-skin preview scale: some art fills the shared canvas more than
        // its peers (e.g. the lighter), so shrink just the preview to match.
        if (item.artScale) {
            img.style.transform = `scale(${item.artScale})`;
            img.style.transformOrigin = "center bottom";
        }

        const name = document.createElement("div");
        name.className = "skin-name";
        name.textContent = item.name;
        const blurb = document.createElement("div");
        blurb.className = "blurb";
        blurb.textContent = item.blurb;

        const footer = document.createElement("div");
        footer.className = "skin-footer";
        if (owned) {
            const tag = document.createElement("div");
            tag.className = "selected-tag";
            tag.textContent = selected ? "Selected" : "Select";
            footer.appendChild(tag);
        } else {
            const unlock = document.createElement("div");
            unlock.className = "unlock";
            unlock.textContent = `Reach Level ${item.unlock.level}`;
            footer.appendChild(unlock);

            // Star-buy: a universal premium path (works with or without an ad
            // SDK — it's just the save's star bank). On ad-enabled portals it
            // sits next to the Watch Ad skip; on the live URL / Playables it's
            // the only skip, so the copy never claims an option we lack.
            const price = skinStarPrice(item);
            const buyBtn = document.createElement("button");
            buyBtn.className = "buy-stars";
            buyBtn.textContent = `BUY ${price}★`;
            buyBtn.classList.toggle("unaffordable", save.getStarBank() < price);
            buyBtn.addEventListener("click", (e) => {
                e?.stopPropagation?.();
                buyLockedItem(item, price);
            });
            footer.appendChild(buyBtn);

            if (item.unlock?.ad && platform.canShowRewarded) {
                const adBtn = document.createElement("button");
                adBtn.className = "watch-ad";
                adBtn.textContent = "Watch Ad";
                adBtn.addEventListener("click", async (e) => {
                    e?.stopPropagation?.();
                    adBtn.disabled = true;
                    adBtn.textContent = "Loading...";
                    const ok = await platform.showRewarded(`unlock_${armoryTab}_${item.id}`);
                    if (ok) {
                        if (armoryTab === "payload") save.unlockSkin(item.id);
                        else save.unlockIgniter(item.id);
                        selectItem(armoryTab, item.id);
                        updateUi();
                        renderArmory();
                        applyLoadout();
                    } else {
                        adBtn.disabled = false;
                        adBtn.textContent = "Watch Ad";
                    }
                });
                footer.appendChild(adBtn);
            }
        }

        card.append(img, name, blurb, footer);
        card.addEventListener("click", () => {
            if (!owned) return;
            selectItem(armoryTab, item.id);
            renderArmory();
            applyLoadout();
        });
        grid.appendChild(card);
    }
}

/** Unlock any payload skins / igniter types whose level threshold the player
 *  has now reached. Returns how many were newly unlocked. */
function unlockProgressRewards() {
    const reached = save.getUnlockedLevel();
    let count = 0;
    for (const s of PAYLOAD_SKINS) {
        if (s.unlock?.level && reached >= s.unlock.level && !save.isSkinUnlocked(s.id)) {
            save.unlockSkin(s.id);
            count++;
        }
    }
    for (const s of IGNITER_TYPES) {
        if (s.unlock?.level && reached >= s.unlock.level && !save.isIgniterUnlocked(s.id)) {
            save.unlockIgniter(s.id);
            count++;
        }
    }
    return count;
}

/** Star-buy a locked skin/igniter. Shakes the star counter when the balance
 *  is short; otherwise spends the stars, unlocks, selects, and applies the
 *  loadout immediately if the level hasn't started. */
function buyLockedItem(item, price) {
    if (!save.spendStars(price)) {
        starDisplay.classList.remove("shake");
        void starDisplay.offsetWidth; // restart the CSS animation
        starDisplay.classList.add("shake");
        audio.play("dud");
        return;
    }
    if (armoryTab === "payload") save.unlockSkin(item.id);
    else save.unlockIgniter(item.id);
    selectItem(armoryTab, item.id);
    updateUi();
    renderArmory();
    applyLoadout();
}

// ---- boot -----------------------------------------------------------------------------

async function boot() {
    try {
        const res = await fetch("src/data/levels.json");
        levels = await res.json();
    } catch (e) {
        console.error("Failed to load levels.json", e);
        return;
    }

    // Hydrate progress from the platform backend (Playgama bridge.storage /
    // YouTube Playables saveData) before the menu shows, so a returning player
    // sees their real star bank and unlocked level. No-op on plain builds.
    // Bridge storage must wait for Bridge initialization, so gate on it first.
    await platform.ready();
    await save.init();

    // Respect saved progress: the story resumes at the first level not yet
    // cleared (a fully-cleared save starts a new run at Level 1).
    levelIndex = storyStartIndex();

    // Warm the art cache in the background (probes which loadout files exist)
    // so the first level the player picks loads instantly instead of paying
    // six sequential downloads right when they're waiting.
    resolveAssets(levels[levelIndex], renderer.hasAsset.bind(renderer), loadoutOf());

    // Home screen first — the player picks PLAY to load their level. Loading
    // happens lazily so a returning player sees their star bank before diving in.
    updateUi();
    renderer.menuCard = $("modal-menu");
    openMenu();

    // Load baked audio cues from assets/audio/ (silently skips un-baked cues).
    audio.loadAll();

    renderer.onAssetsReady(() => {
        platform.loadingFinished();
    });

    game.start();
    window.addEventListener("resize", () => {
        renderer.resize();
    });
    // iOS Safari landscape toolbar + PWA chrome resize the VISUAL viewport
    // without always firing window resize — re-fit the game to the visible area.
    if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", () => renderer.resize());
    }
    window.addEventListener("orientationchange", () => {
        setTimeout(() => renderer.resize(), 80); // wait for the rotation to settle
    });

    // Host pause (Playgama / Playables) freezes the loop even when visible.
    // YouTube Playables forbids the Page Visibility API — its onPause/onResume
    // callbacks are the only legal pause signal there; everywhere else the
    // visibilitychange listener (with the platform's save flush) is the norm.
    if (platform.isPlayables) {
        if (typeof ytgame !== "undefined") {
            try { if (ytgame.onPause) ytgame.onPause(() => game.setPaused(true)); } catch { /* noop */ }
            try { if (ytgame.onResume) ytgame.onResume(() => game.setPaused(false)); } catch { /* noop */ }
        }
    } else {
        document.addEventListener("visibilitychange", () => {
            game.setPaused(document.hidden);
        });
    }

    if (window.__CUT_THE_FUSE_POKI__) {
        // Poki records gameplay via a hidden capture canvas; keep the main canvas visible.
    }
}

boot();
