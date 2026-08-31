// Boot the Cut the Fuse Poki bundle and verify the playtest recorder helpers
// get wired (playtestSetCanvas + playtestCaptureHtmlOn). Intercepts the Poki
// SDK script with a logging mock so call capture is deterministic.
// Usage: node tools/smoke/verify-poki-capture.mjs <url>
import { chromium } from "/Users/frankzhou/Projects/cut-the-fuse/node_modules/playwright/index.mjs";

const url = process.argv[2] || "http://localhost:8096";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (msg) => {
  if (msg.type() === "error" && !msg.text().includes("Failed to load resource")
      && !msg.text().includes("Cross-Origin-Opener-Policy")
      && !msg.text().includes("AudioContext")) {
    errors.push("console: " + msg.text());
  }
});

// Serve a logging mock for the Poki SDK script instead of the real CDN file.
const mockSdk = `(function () {
  window.__pokiCalls = [];
  window.PokiSDK = {
    init: function () { window.__pokiCalls.push("init"); return Promise.resolve(); },
    setDebug: function () {},
    setLogging: function () {},
    gameLoadingFinished: function () { window.__pokiCalls.push("gameLoadingFinished"); },
    gameplayStart: function () { window.__pokiCalls.push("gameplayStart"); },
    gameplayStop: function () { window.__pokiCalls.push("gameplayStop"); },
    commercialBreak: function () { window.__pokiCalls.push("commercialBreak"); return Promise.resolve(); },
    rewardedBreak: function () { window.__pokiCalls.push("rewardedBreak"); return Promise.resolve({ success: false }); },
    playtestSetCanvas: function (c) { window.__pokiCalls.push("playtestSetCanvas:" + (c && c.id)); },
    playtestCaptureHtmlOn: function () { window.__pokiCalls.push("playtestCaptureHtmlOn"); },
    playtestCaptureHtmlOff: function () {},
    playtestCaptureHtmlOnce: function () {},
    playtestCaptureHtmlForce: function () {},
    movePill: function () {},
    getLanguage: function () { return "en"; },
    getURLParam: function () { return null; },
    getDeviceInfo: function () { return {}; },
    isAdBlocked: function () { return false; },
    measure: function () {}
  };
})();`;
await page.route("**/game-cdn.poki.com/scripts/v2/poki-sdk.js", (route) =>
  route.fulfill({ status: 200, contentType: "application/javascript", body: mockSdk })
);

const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(3500);

// Exercise the resize re-bind path (the recorder must be re-pointed after the
// backing store is reallocated on resize/orientation change).
await page.evaluate(() => window.dispatchEvent(new Event("resize")));
await page.waitForTimeout(500);

const state = await page.evaluate(() => {
  const c = document.querySelector("canvas#game-canvas");
  return {
    calls: window.__pokiCalls || [],
    canvasId: c ? c.id : "none",
    canvasSize: c ? `${c.width}x${c.height}` : "none",
    bootErr: window.__bootErr || null,
  };
});

const failures = [];
const check = (name, cond, extra = "") => {
  if (!cond) failures.push(name);
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
};

const calls = state.calls.join(",");
check(`HTTP ${resp && resp.status()}`, resp && resp.status() === 200);
check("game canvas mounted", state.canvasId === "game-canvas");
check("PokiSDK.init called", calls.includes("init"), calls || "no calls captured");
check("playtestSetCanvas called with #game-canvas", calls.includes("playtestSetCanvas:game-canvas"), calls || "no calls captured");
check("playtestCaptureHtmlOn called (DOM UI visible in recordings)", calls.includes("playtestCaptureHtmlOn"), calls || "no calls captured");
check("gameLoadingFinished fired", calls.includes("gameLoadingFinished"), calls || "no calls captured");
check("canvas backing store exists (not 0x0)", !state.canvasSize.startsWith("0x") && state.canvasSize !== "none", state.canvasSize);
check("no boot errors", !state.bootErr, state.bootErr || "clean");
check("no page/console errors", errors.length === 0, errors.slice(0, 3).join(" | ") || "clean");

console.log(`\nPOKI CAPTURE BOOT ${failures.length ? "FAIL" : "PASS"}`);
await browser.close();
process.exit(failures.length ? 1 : 0);
