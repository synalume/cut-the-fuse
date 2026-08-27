// Level Editor — drag nodes/chokepoints, tune fuses, live-test, export.
import { buildLevel } from "../../src/engine/LevelManager.js";
import { GameLoop, STATE } from "../../src/engine/GameLoop.js";
import { getBezierXY, distToSegment } from "../../src/engine/MathUtils.js";

const $ = (id) => document.getElementById(id);
const canvas = $("editor-canvas");
const ctx = canvas.getContext("2d");

const LEVELS_URL = "../../src/data/levels.json";

let levels = [];
let idx = 0;
let config = null; // working copy of the current level config
let level = null; // built runtime level
let mode = "edit"; // edit | test
let game = null; // GameLoop instance in test mode

let dragTarget = null; // { kind: 'payload'|'spawn'|'intersection', key }
let dragOffset = null;

const cx = () => canvas.width / 2;
const cy = () => canvas.height / 2;

// ---- level loading ----------------------------------------------------------

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

async function loadLevels() {
    const res = await fetch(LEVELS_URL);
    levels = await res.json();
    const select = $("level-select");
    select.innerHTML = "";
    levels.forEach((l, i) => {
        const opt = document.createElement("option");
        opt.value = i;
        opt.textContent = `Level ${l.level_id}`;
        select.appendChild(opt);
    });
    select.value = 0;
    select.addEventListener("change", () => { idx = Number(select.value); openLevel(); });
    openLevel();
}

function openLevel() {
    config = deepClone(levels[idx]);
    $("level-select").value = idx;
    $("snips").value = config.snipsAllowed;
    rebuild();
    renderFuseList();
    setMode("edit");
}

function rebuild() {
    level = buildLevel(config, { width: canvas.width, height: canvas.height });
}

function configFromLevel() {
    // Serialize the current editor state (config is the source of truth).
    return {
        level_id: config.level_id,
        snipsAllowed: Number($("snips").value) || 1,
        payload: { ...config.payload },
        spawns: config.spawns.map((s) => ({ ...s })),
        intersections: config.intersections.map((i) => ({ ...i })),
        fuses: config.fuses.map((f) => {
            const out = { start: f.start, end: f.end, speed: f.speed, delayFrames: f.delayFrames };
            if (f.routeThrough) out.routeThrough = f.routeThrough;
            return out;
        }),
    };
}

// ---- drawing ----------------------------------------------------------------

function resize() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    if (level) rebuild();
    draw();
}
window.addEventListener("resize", resize);

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";

    const g = mode === "test" && game ? game : level;

    // Fuses (orange) + burnt (dark).
    for (const fuse of g.fuses) {
        const p0 = fuse.startNode, p3 = fuse.endNode;
        ctx.beginPath();
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#d97706";
        ctx.moveTo(p0.x, p0.y);
        ctx.bezierCurveTo(fuse.cp1.x, fuse.cp1.y, fuse.cp2.x, fuse.cp2.y, p3.x, p3.y);
        ctx.stroke();

        if (fuse.burntProgress > 0) {
            ctx.beginPath();
            ctx.strokeStyle = "#292524";
            ctx.moveTo(p0.x, p0.y);
            for (let t = 0; t <= fuse.burntProgress; t += 0.02) {
                const pt = getBezierXY(t, p0, fuse.cp1, fuse.cp2, p3);
                ctx.lineTo(pt.x, pt.y);
            }
            ctx.stroke();
        }
    }

    // Cuts (punch holes) — only meaningful in test mode.
    if (mode === "test" && g.cuts.length) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.lineWidth = 14;
        ctx.beginPath();
        for (const cut of g.cuts) {
            const dx = Math.cos(cut.angle) * 18, dy = Math.sin(cut.angle) * 18;
            ctx.moveTo(cut.x - dx, cut.y - dy);
            ctx.lineTo(cut.x + dx, cut.y + dy);
        }
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
    }

    // Chokepoints (crosshairs).
    for (const it of Object.values(level.intersectionMap)) {
        ctx.beginPath();
        ctx.arc(it.x, it.y, 10, 0, Math.PI * 2);
        ctx.strokeStyle = mode === "edit" && dragTarget?.key === it.id ? "#dc2626" : "#1c1917";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(it.x - 14, it.y); ctx.lineTo(it.x + 14, it.y);
        ctx.moveTo(it.x, it.y - 14); ctx.lineTo(it.x, it.y + 14);
        ctx.stroke();
        ctx.fillStyle = "#1c1917";
        ctx.fillText(it.id, it.x + 16, it.y - 14);
    }

    // Payload node.
    const payload = level.nodeMap[config.payload.id];
    ctx.beginPath();
    ctx.arc(payload.x, payload.y, 18, 0, Math.PI * 2);
    ctx.fillStyle = mode === "edit" && dragTarget?.kind === "payload" ? "#dc2626" : "#ef4444";
    ctx.fill();
    ctx.strokeStyle = "#1c1917"; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = "#1c1917"; ctx.font = "bold 10px Courier New";
    ctx.fillText("BOMB", payload.x - 20, payload.y - 24);

    // Spawn nodes.
    for (const node of level.nodes.filter((n) => n.type === "spawn")) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 12, 0, Math.PI * 2);
        ctx.fillStyle = mode === "edit" && dragTarget?.key === node.id ? "#dc2626" : "#f97316";
        ctx.fill();
        ctx.strokeStyle = "#1c1917"; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = "#1c1917";
        ctx.fillText(node.id, node.x - 14, node.y - 18);
    }

    // Sparks + particles (test mode).
    if (mode === "test") {
        for (const spark of g.sparks) {
            if (!spark.active) continue;
            if (g.frameCount < spark.delay) continue;
            const fuse = g.fuses[spark.fuseIndex];
            const pos = getBezierXY(spark.progress, fuse.startNode, fuse.cp1, fuse.cp2, fuse.endNode);
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
            ctx.fillStyle = "#fef08a";
            ctx.fill();
            ctx.strokeStyle = "#1c1917"; ctx.lineWidth = 2; ctx.stroke();
        }
        for (const p of g.particles) {
            ctx.fillStyle = p.color;
            ctx.globalAlpha = p.life;
            ctx.fillRect(p.x, p.y, p.size, p.size);
            ctx.globalAlpha = 1;
        }
    }
}

// ---- edit interactions --------------------------------------------------------

function pickTarget(wx, wy) {
    const payload = level.nodeMap[config.payload.id];
    if (Math.hypot(wx - payload.x, wy - payload.y) < 24) return { kind: "payload" };
    for (const node of level.nodes.filter((n) => n.type === "spawn")) {
        if (Math.hypot(wx - node.x, wy - node.y) < 20) return { kind: "spawn", key: node.id };
    }
    for (const it of Object.values(level.intersectionMap)) {
        if (Math.hypot(wx - it.x, wy - it.y) < 20) return { kind: "intersection", key: it.id };
    }
    return null;
}

let pointer = null;

canvas.addEventListener("pointerdown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const wx = e.clientX - rect.left;
    const wy = e.clientY - rect.top;

    if (mode === "edit") {
        dragTarget = pickTarget(wx, wy);
        if (dragTarget) {
            dragOffset = { x: wx, y: wy };
            canvas.setPointerCapture(e.pointerId);
            pointer = { x: wx, y: wy };
        }
    } else {
        // TEST mode: start a swipe cut.
        pointer = { x: wx, y: wy };
        if (game) {
            game._swipeStart = { x: wx, y: wy };
            game._swipeEnd = { x: wx, y: wy };
        }
    }
    draw();
});

canvas.addEventListener("pointermove", (e) => {
    if (!pointer) return;
    const rect = canvas.getBoundingClientRect();
    const wx = e.clientX - rect.left;
    const wy = e.clientY - rect.top;

    if (mode === "edit" && dragTarget) {
        const dx = wx - dragOffset.x;
        const dy = wy - dragOffset.y;
        if (dragTarget.kind === "payload") {
            config.payload.x += dx;
            config.payload.y += dy;
        } else if (dragTarget.kind === "spawn") {
            const node = config.spawns.find((n) => n.id === dragTarget.key);
            node.x += dx;
            node.y += dy;
        } else if (dragTarget.kind === "intersection") {
            const it = config.intersections.find((n) => n.id === dragTarget.key);
            it.x += dx;
            it.y += dy;
        }
        dragOffset = { x: wx, y: wy };
        rebuild();
    } else if (mode === "test" && game && game.gameState === STATE.PLAYING) {
        game._swipeEnd = { x: wx, y: wy };
        game._swipeStart = game._swipeStart || { x: wx, y: wy };
    }
    draw();
});

canvas.addEventListener("pointerup", (e) => {
    if (mode === "edit") {
        dragTarget = null;
        pointer = null;
    } else if (game) {
        const start = game._swipeStart;
        const end = game._swipeEnd;
        delete game._swipeStart;
        delete game._swipeEnd;
        if (start && end && Math.hypot(end.x - start.x, end.y - start.y) > 15) {
            game.tryCut(start, end);
        }
        pointer = null;
        refreshStatus();
    }
    draw();
});

canvas.addEventListener("wheel", (e) => {
    if (mode === "test" && game) {
        e.preventDefault();
        game.changeZoom(e.deltaY > 0 ? -0.1 : 0.1);
    }
});

// ---- test mode ---------------------------------------------------------------

function setMode(m) {
    mode = m;
    $("btn-edit").classList.toggle("active", m === "edit");
    $("btn-test").classList.toggle("active", m === "test");
    $("mode-hint").textContent = m === "edit" ? "EDIT MODE — drag nodes" : "TEST MODE — swipe to cut";
    if (m === "test") {
        startTest();
    } else {
        if (game) { game.stop(); game = null; }
        rebuild();
        draw();
    }
}

function startTest() {
    // Sync config from the canvas (drag edits) before building the test level.
    config = configFromLevel();
    const testLevel = buildLevel(config, { width: canvas.width, height: canvas.height });
    game = new GameLoop({ canvas, renderer: { computeFitCamera: () => ({ x: 0, y: 0, zoom: 1 }) }, audio: null });
    game.loadLevel(testLevel, idx);
    game.start();
    requestAnimationFrame(function loop() {
        if (!game || mode !== "test") return;
        draw();
        requestAnimationFrame(loop);
    });
}

function refreshStatus() {
    if (!game) return;
    const s = game.gameState;
    $("status").textContent =
        s === STATE.WON ? `WON! ${game.computeStars()} stars (${game.snipsRemaining} snips left)` :
        s === STATE.LOST ? "KABOOM — spark reached the bomb" :
        `playing… snips: ${game.snipsRemaining} / ${game.sparks.filter((x) => x.active).length} sparks`;
}

// ---- fuse list ----------------------------------------------------------------

function renderFuseList() {
    const list = $("fuse-list");
    list.innerHTML = "";
    level.fuses.forEach((fuse, i) => {
        const card = document.createElement("div");
        card.className = "fuse-card";
        card.innerHTML = `
            <b>${fuse.start} → ${fuse.end}</b>
            <div class="row">
                <label>speed</label><input type="number" step="0.0001" min="0.0001" max="0.005" value="${fuse.speed}" data-i="${i}" data-field="speed">
                <label>delay</label><input type="number" step="10" min="0" value="${fuse.delayFrames}" data-i="${i}" data-field="delayFrames">
            </div>
            <div class="row">
                <label>route</label>
                <select data-i="${i}" data-field="routeThrough">
                    <option value="">direct</option>
                    ${Object.keys(level.intersectionMap).map((id) => `<option value="${id}" ${fuse.routeThrough === id ? "selected" : ""}>${id}</option>`).join("")}
                </select>
            </div>`;
        list.appendChild(card);
    });
}

$("fuse-list").addEventListener("change", (e) => {
    const field = e.target.dataset.field;
    const i = Number(e.target.dataset.i);
    const fuse = level.fuses[i];
    const cfgFuse = config.fuses[i];
    if (field === "speed") {
        fuse.speed = cfgFuse.speed = Number(e.target.value) || fuse.speed;
    } else if (field === "delayFrames") {
        fuse.delayFrames = cfgFuse.delayFrames = Number(e.target.value) || 0;
    } else if (field === "routeThrough") {
        fuse.routeThrough = cfgFuse.routeThrough = e.target.value || undefined;
        rebuild(); // geometry changes
    }
    draw();
});

// ---- sidebar buttons ------------------------------------------------------------

$("btn-prev").addEventListener("click", () => { idx = Math.max(0, idx - 1); openLevel(); });
$("btn-next").addEventListener("click", () => { idx = Math.min(levels.length - 1, idx + 1); openLevel(); });
$("btn-edit").addEventListener("click", () => setMode("edit"));
$("btn-test").addEventListener("click", () => setMode("test"));
$("btn-reset").addEventListener("click", () => openLevel());
$("snips").addEventListener("change", () => { config.snipsAllowed = Number($("snips").value) || 1; rebuild(); draw(); });

$("btn-add-spawn").addEventListener("click", () => {
    const n = level.nodes.filter((x) => x.type === "spawn").length + 1;
    config.spawns.push({ id: `s${n}`, x: Math.round(Math.random() * 200 - 100), y: Math.round(Math.random() * 200 - 100) });
    levels[idx] = config;
    openLevel();
});

$("btn-add-intersection").addEventListener("click", () => {
    const n = Object.keys(level.intersectionMap).length + 1;
    config.intersections.push({ id: `cut${n}`, x: Math.round(Math.random() * 200 - 100), y: Math.round(Math.random() * 200 - 100) });
    levels[idx] = config;
    openLevel();
});

$("btn-export").addEventListener("click", async () => {
    const out = configFromLevel();
    out.fuses.forEach((f) => { if (!f.routeThrough) delete f.routeThrough; });
    const res = await fetch("/api/dev-write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: "src/data/levels.json", contents: JSON.stringify(levels.map((l) => (l.level_id === out.level_id ? out : l)), null, 2) }),
    });
    const json = await res.json();
    $("status").textContent = json.ok ? "Saved to src/data/levels.json ✓" : `Save failed: ${json.error}`;
});

// ---- boot ---------------------------------------------------------------------

async function boot() {
    resize();
    await loadLevels();
    requestAnimationFrame(function loop() {
        draw();
        requestAnimationFrame(loop);
    });
}

boot();
