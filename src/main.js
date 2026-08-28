// main.js — entry point: fetch levels.json, build the engine stack, wire UI.
import { GameLoop, STATE } from "./engine/GameLoop.js";
import { Renderer } from "./engine/Renderer.js";
import { InputHandler } from "./engine/InputHandler.js";
import { AudioManager } from "./engine/AudioManager.js";
import { SaveManager } from "./engine/SaveManager.js";
import { Analytics } from "./engine/Analytics.js";
import { Platform } from "./engine/Platform.js";
import { buildLevel, resolveAssets } from "./engine/LevelManager.js";

// Level-select gating. During playtest every level is pickable; flip to true
// for release to enforce linear unlock (must beat N to play N+1).
const LOCK_LEVELS = false;

const $ = (id) => document.getElementById(id);

// ---- core objects -------------------------------------------------------------

const canvas = $("game-canvas");
const renderer = new Renderer(canvas);
const audio = new AudioManager();
const save = new SaveManager();
const analytics = new Analytics();
const platform = new Platform({ audio, save });

const game = new GameLoop({ canvas, renderer, audio, analytics, platform });
platform.onEvent = (name, val) => {
    if (name === "pause") game.setPaused(val);
};

const input = new InputHandler(canvas, game);

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
const levelGrid = $("level-grid");
const tutorialOverlay = $("tutorial-overlay");
const tutorialText = $("tutorial-text");
const btnTutorialNext = $("tutorial-next");
const winStars = $("win-stars");
const ddaText = $("dda-text");

let levels = [];
let levelIndex = 0;
let selectorPaused = false; // true when the level selector paused a live game

// ---- level loading -------------------------------------------------------------

async function loadLevel(index) {
    levelIndex = index;
    const config = levels[index];
    // Live resolution: use the level's own art when it exists, otherwise the
    // placeholder set (banana bomb + matchstick) for every level.
    const assets = await resolveAssets(config, renderer.hasAsset.bind(renderer));
    const level = buildLevel(config, { width: renderer.width, height: renderer.height }, assets);

    // Load this level's assets (placeholder fallback handled by resolveAssets).
    renderer.loadAssets(assets.payloadAssets);
    renderer.loadAssets(assets.spawnAssets);

    game.loadLevel(level, index);
    renderer.resize();

    levelLabel.textContent = `LEVEL ${config.level_id}`;
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

    starDisplay.textContent = `${save.getStarBank()}`;
    btnHint.classList.toggle("active", game.hintActive);
    btnMute.classList.toggle("muted", audio.muted);
}

function closeModals() {
    modalLose.style.display = "none";
    modalWin.style.display = "none";
    modalDda.style.display = "none";
    modalEnd.style.display = "none";
    modalSkins.style.display = "none";
    modalLevels.style.display = "none";
    tutorialOverlay.style.display = "none";
}

// ---- level selector --------------------------------------------------------------

function openLevelSelect() {
    renderLevelGrid();
    modalLevels.style.display = "flex";
    // Freeze a live game while the map is open; the win/lose modals stay as-is.
    if (game.gameState === STATE.PLAYING) {
        selectorPaused = true;
        game.setPaused(true);
    }
}

function closeLevelSelect() {
    modalLevels.style.display = "none";
    if (selectorPaused) {
        selectorPaused = false;
        game.setPaused(false);
    }
}

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
        stars.textContent = "★".repeat(earned) + "☆".repeat(3 - earned);

        cell.append(num, stars);
        cell.addEventListener("click", () => {
            if (locked) return;
            loadLevel(i);
            closeLevelSelect();
        });
        levelGrid.appendChild(cell);
    }
}

$("level-label").addEventListener("click", openLevelSelect);
$("btn-levels-close").addEventListener("click", closeLevelSelect);

// ---- tutorial ------------------------------------------------------------------

function startTutorialIfPresent(level) {
    if (!level.tutorial || levelIndex !== 0) return;
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
    // Wobble Run-style star reveal: each earned star lights with an ascending
    // coin chime. Skipped if the player closes the modal mid-reveal.
    let delay = 120;
    for (let i = 0; i < stars; i++) {
        const idx = i;
        setTimeout(() => {
            if (modalWin.style.display !== "block") return;
            spans[idx].className = "";
            audio.play("win_star", { rate: 1.0 + idx * 0.3 });
        }, delay);
        delay += 190;
    }
}

game.onSnipsChange = () => updateUi();
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
        updateUi();
        showStars(stars);
        modalWin.style.display = "block";
        platform.commercialBreak();
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
        modalSkins.style.display = "none";
    }
});

// ---- skin screen (star bank -> bomb/matchstick swaps) --------------------------------

const SKIN_COST = { bomb: 0, matchstick: 0 }; // v1: skins cost 0 stars, unlock by completion
starDisplay.style.cursor = "pointer";
starDisplay.title = "Armory";
starDisplay.addEventListener("click", () => {
    renderSkins();
    modalSkins.style.display = "block";
});

$("btn-skins-close").addEventListener("click", () => {
    modalSkins.style.display = "none";
});

function renderSkins() {
    const grid = $("skin-grid");
    grid.innerHTML = "";
    const skins = [
        { id: "banana", label: "Bananabomb", file: "lvl1_banana_panic.png", stars: 0 },
        { id: "dynamite", label: "Dynamite", file: "lvl1_banana_win.png", stars: 25 },
        { id: "orb", label: "Mystery Orb", file: "lvl1_banana_fail.png", stars: 50 },
    ];
    for (const skin of skins) {
        const card = document.createElement("div");
        card.className = "skin-card";
        const unlocked = skin.stars === 0 || save.isSkinUnlocked(skin.id);
        card.classList.toggle("locked", !unlocked);
        card.classList.toggle("selected", save.getSelectedSkin() === skin.id);

        const img = document.createElement("img");
        img.src = `assets/${skin.file}`;
        const label = document.createElement("div");
        label.textContent = skin.label;
        const cost = document.createElement("div");
        cost.className = "cost";
        cost.textContent = unlocked ? (save.getSelectedSkin() === skin.id ? "SELECTED" : "Owned") : `★ ${skin.stars}`;

        card.append(img, label, cost);
        card.addEventListener("click", () => {
            if (!unlocked) {
                if (save.getStarBank() >= skin.stars) {
                    save.spendStars(skin.stars);
                    save.unlockSkin(skin.id);
                    save.setSelectedSkin(skin.id);
                    updateUi();
                    renderSkins();
                }
                return;
            }
            save.setSelectedSkin(skin.id);
            renderSkins();
        });
        grid.appendChild(card);
    }
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

    // Respect saved progress: resume at the furthest unlocked level.
    const startIndex = Math.min(levels.length - 1, save.getUnlockedLevel() - 1 || 0);
    await loadLevel(startIndex);

    // Load baked audio cues from assets/audio/ (silently skips un-baked cues).
    audio.loadAll();

    renderer.onAssetsReady(() => {
        platform.loadingFinished();
    });

    game.start();
    window.addEventListener("resize", () => {
        renderer.resize();
    });

    // Host pause (Playgama / Playables) freezes the loop even when visible.
    document.addEventListener("visibilitychange", () => {
        game.setPaused(document.hidden);
    });

    if (window.__CUT_THE_FUSE_POKI__) {
        // Poki records gameplay via a hidden capture canvas; keep the main canvas visible.
    }
}

boot();
