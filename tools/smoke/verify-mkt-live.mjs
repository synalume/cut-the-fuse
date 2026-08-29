import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("https://play.cutthefuse.com/");
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const m = (sel) => document.querySelector(sel)?.content || document.querySelector(sel)?.href || null;
  return {
    title: document.title,
    theme: document.querySelector('meta[name="theme-color"]')?.content,
    icon: document.querySelector('link[rel="icon"]')?.href,
    manifest: document.querySelector('link[rel="manifest"]')?.href,
    og: document.querySelector('meta[property="og:image"]')?.content,
    ogDim: [document.querySelector('meta[property="og:image:width"]')?.content, document.querySelector('meta[property="og:image:height"]')?.content],
    canvas: !!document.querySelector("#game-canvas"),
    menu: !!document.querySelector("#modal-menu"),
    booted: !!document.querySelector("#btn-menu-play"),
  };
});
console.log(JSON.stringify(info, null, 2));

// favicon pixel check: loaded? 
const favOK = await page.evaluate(async () => {
  const img = new Image();
  img.src = "/favicon-32.png?v=ctf2";
  await img.decode();
  return img.width === 32 && img.height === 32;
});
console.log("favicon-32 decodes:", favOK);
await page.screenshot({ path: "tools/smoke/mkt-live.png" });
await browser.close();
