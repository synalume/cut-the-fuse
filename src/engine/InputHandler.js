// InputHandler.js — swipe-to-cut, two-finger/right-drag pan, wheel + button zoom.
import { clamp } from "./MathUtils.js";

const MAX_SWIPE_LENGTH = 80; // Tactical slicing: clamp the cut length.
const MIN_SWIPE_DIST = 20; // A real drag must be longer than a tap.
const PAN_DIST = 5; // Pointer movement threshold to disambiguate cut vs pan.

export class InputHandler {
    constructor(canvas, game) {
        this.canvas = canvas;
        this.game = game;
        this.renderer = game.renderer;

        this._pointers = new Map(); // pointerId -> { x, y } (screen coords)
        this._swipe = null; // { start, end } in world coords while one-finger swiping
        this._swipeTrail = null; // world-coord polyline of the finger path (for the blade slash)
        this._deniedSwipe = false; // swipe started with no snips left → deny cue on release
        this._pan = null; // { startX, startY, camX, camY, moved }
        this._rightPan = null;

        this._bind();
    }

    // ---- screen <-> world -----------------------------------------------------

    screenToWorld(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const cw = this.renderer.width;
        const ch = this.renderer.height;
        const screenX = clientX - rect.left;
        const screenY = clientY - rect.top;
        return {
            x: (screenX - cw / 2) / this.game.camera.zoom - this.game.camera.x + cw / 2,
            y: (screenY - ch / 2) / this.game.camera.zoom - this.game.camera.y + ch / 2,
        };
    }

    // ---- event wiring ----------------------------------------------------------

    _bind() {
        const canvas = this.canvas;

        canvas.addEventListener("pointerdown", (e) => this._onDown(e));
        canvas.addEventListener("pointermove", (e) => this._onMove(e));
        canvas.addEventListener("pointerup", (e) => this._onUp(e));
        canvas.addEventListener("pointercancel", (e) => this._onUp(e));
        canvas.addEventListener("wheel", (e) => this._onWheel(e), { passive: false });
        canvas.addEventListener("contextmenu", (e) => e.preventDefault());

        window.addEventListener("keydown", (e) => {
            if (e.key === "Escape") this._onEscape();
        });
    }

    _onDown(e) {
        // Right button = pan (desktop).
        if (e.button === 2) {
            this._rightPan = { startX: e.clientX, startY: e.clientY, camX: this.game.camera.x, camY: this.game.camera.y };
            e.preventDefault();
            return;
        }
        // Ignore non-primary (middle etc.).
        if (e.button !== 0 && e.pointerType === "mouse") return;

        this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        // Two pointers active -> pinch zoom + pan.
        if (this._pointers.size >= 2) {
            this._swipe = null;
            this._startPinch();
            e.preventDefault();
            return;
        }

        // One pointer -> swipe cut. Always track the gesture while playing so a
        // swipe with 0 snips still visibly reacts (denied slash + bubble on
        // release) instead of silently doing nothing. The blade preview is only
        // shown when a cut is actually possible — a misleading red slash would
        // look like a failed cut.
        if (this.game.gameState === "playing") {
            const world = this.screenToWorld(e.clientX, e.clientY);
            this._swipe = { start: { ...world }, end: { ...world } };
            this._swipeTrail = [{ ...world }];
            this._deniedSwipe = this.game.snipsRemaining <= 0;
            if (!this._deniedSwipe) {
                this.game._swipeStart = { ...world };
                this.game._swipeEnd = { ...world };
                this.game._swipeTrail = this._swipeTrail;
            }
        }
        e.preventDefault();
    }

    _onMove(e) {
        // Right-drag pan.
        if (this._rightPan) {
            this.game.camera.x = this._rightPan.camX + (e.clientX - this._rightPan.startX) / this.game.camera.zoom;
            this.game.camera.y = this._rightPan.camY + (e.clientY - this._rightPan.startY) / this.game.camera.zoom;
            return;
        }

        if (!this._pointers.has(e.pointerId)) return;
        const prev = this._pointers.get(e.pointerId);
        this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        // Pan mode (2+ pointers): pinch to zoom around the finger midpoint,
        // and drag the two fingers together to pan.
        if (this._pan) {
            const pts = [...this._pointers.values()];
            if (pts.length >= 2) {
                const midX = (pts[0].x + pts[1].x) / 2;
                const midY = (pts[0].y + pts[1].y) / 2;
                const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
                if (!this._pan.moved && Math.hypot(midX - this._pan.startX, midY - this._pan.startY) > PAN_DIST) {
                    this._pan.moved = true;
                }
                if (this._pan.moved) {
                    const zoom = clamp(this._pan.startZoom * (dist / this._pan.startDist), 0.3, 3);
                    this.game.camera.zoom = zoom;
                    this.game.camera.x = this._pan.camX + (midX - this._pan.startX) / zoom;
                    this.game.camera.y = this._pan.camY + (midY - this._pan.startY) / zoom;
                }
            } else if (!this._pan.moved && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > PAN_DIST) {
                this._pan.moved = true;
            }
            return;
        }

        // Swipe cut update (clamp length).
        if (this._swipe) {
            const world = this.screenToWorld(e.clientX, e.clientY);
            const dx = world.x - this._swipe.start.x;
            const dy = world.y - this._swipe.start.y;
            const dist = Math.hypot(dx, dy);
            if (dist > MAX_SWIPE_LENGTH) {
                this._swipe.end = {
                    x: this._swipe.start.x + (dx / dist) * MAX_SWIPE_LENGTH,
                    y: this._swipe.start.y + (dy / dist) * MAX_SWIPE_LENGTH,
                };
            } else {
                this._swipe.end = { ...world };
            }
            this.game._swipeStart = { ...this._swipe.start };
            this.game._swipeEnd = { ...this._swipe.end };
            // Record the finger path (thinned to ~6px so the trail stays light).
            if (this._swipeTrail) {
                const last = this._swipeTrail[this._swipeTrail.length - 1];
                if (Math.hypot(world.x - last.x, world.y - last.y) > 6) {
                    this._swipeTrail.push({ ...world });
                    if (this._swipeTrail.length > 40) this._swipeTrail.shift();
                    this.game._swipeTrail = this._swipeTrail;
                }
            }
        }
    }

    _onUp(e) {
        if (this._rightPan && (e.button === 2 || e.pointerType !== "mouse")) {
            this._rightPan = null;
            return;
        }
        if (e.button === 2) return;

        this._pointers.delete(e.pointerId);

        // Pan ended.
        if (this._pan && this._pointers.size < 2) {
            this._pan = null;
            this._clearSwipePreview();
            return;
        }

        // Complete a swipe cut.
        if (this._swipe && this._pointers.size === 0) {
            const { start, end } = this._swipe;
            const trail = this._swipeTrail;
            this._swipe = null;
            this._swipeTrail = null;
            this._clearSwipePreview();

            const dist = Math.hypot(end.x - start.x, end.y - start.y);
            if (dist > MIN_SWIPE_DIST) {
                if (this._deniedSwipe) this.game.notifyNoSnips(start, end);
                else this.game.tryCut(start, end, trail);
            }
            this._deniedSwipe = false;
        }
    }

    _onWheel(e) {
        e.preventDefault();
        this.game.changeZoom(e.deltaY > 0 ? -0.1 : 0.1);
    }

    _onEscape() {
        // Close any open modal / tutorial (YouTube Playables requirement).
        const event = new CustomEvent("game:escape");
        window.dispatchEvent(event);
    }

    _startPinch() {
        const pts = [...this._pointers.values()];
        const startDist = pts.length >= 2
            ? Math.max(1, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y))
            : 1;
        this._pan = {
            startX: this._averageX(),
            startY: this._averageY(),
            camX: this.game.camera.x,
            camY: this.game.camera.y,
            startZoom: this.game.camera.zoom,
            startDist,
            moved: false,
        };
        this._swipe = null;
        this._swipeTrail = null;
        this._deniedSwipe = false;
        this._clearSwipePreview();
    }

    _averageX() {
        let sum = 0;
        let n = 0;
        this._pointers.forEach((p) => { sum += p.x; n++; });
        return n ? sum / n : 0;
    }

    _averageY() {
        let sum = 0;
        let n = 0;
        this._pointers.forEach((p) => { sum += p.y; n++; });
        return n ? sum / n : 0;
    }

    _clearSwipePreview() {
        delete this.game._swipeStart;
        delete this.game._swipeEnd;
        delete this.game._swipeTrail;
    }
}

export { clamp };
