import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// Favicon render check via document
await page.goto("http://localhost:8080/");
await page.waitForTimeout(1500);

// grab computed styles and link tags
const links = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return { href: el.href, sizes: el.getAttribute("sizes") };
  };
  return {
    icon32: pick('link[rel="icon"][sizes="32x32"]'),
    manifest: pick('link[rel="manifest"]'),
    apple: pick('link[rel="apple-touch-icon"]'),
    theme: document.querySelector('meta[name="theme-color"]')?.content,
    ogImage: document.querySelector('meta[property="og:image"]')?.content,
    title: document.title,
  };
});
console.log(JSON.stringify(links, null, 2));

// verify game booted
const booted = await page.evaluate(() => !!document.querySelector("#game-canvas"));
console.log("game-canvas present:", booted);
const menu = await page.evaluate(() => !!document.querySelector("#modal-menu"));
console.log("menu modal present:", menu);

await page.screenshot({ path: "tools/smoke/mkt-favicon-check.png" });
await browser.close();
