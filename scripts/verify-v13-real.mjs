// v13 — one REAL per-video analysis through the card UI (server WITHOUT MOCK_AI, GEMINI_API_KEY set).
// cd server && EXTRA_VIDEO_HOSTS=127.0.0.1:18767 PORT=8787 node server.js
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "fs";
const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.BASE || "http://127.0.0.1:8765/";
const VB = process.env.VIDEO_BASE || "http://127.0.0.1:18767/";
const TRACK = JSON.parse(fs.readFileSync("/workspace/padel-test/new-track.json", "utf8"));
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "he-IL" });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const reqs = [];
let response = null;
page.on("request", (r) => { if (r.url().endsWith("/api/ai-rating") && r.method() === "POST") reqs.push(JSON.parse(r.postData()).perVideo); });
page.on("response", async (r) => { if (r.url().endsWith("/api/ai-rating") && r.request().method() === "POST") { try { response = await r.json(); } catch (e) {} } });
await page.goto(BASE);
await page.evaluate(({ VB, TRACK, BASE }) => localStorage.setItem("padelCard.v2", JSON.stringify({
  levelId: "B2",
  profile: { id: "local-tal-real13", name: "טל גלעד", gender: "male", age: "36", hand: "right", side: "right", competitor: "no", hasPartner: "no", partnerId: null, photo: BASE + "avatars/alon.jpg", region: "center", courts: [], frequency: "2-3", tenure: "3plus", style: "both", shots: ["volley"] },
  answers: [], videos: [{ id: "vid-1", name: "IMG_4121.MOV", link: VB + "clip1.mp4", poster: VB + "poster1.jpg", duration: 29.56, bytes: 2767965, trackUrl: "", marker: null, track: TRACK }]
})), { VB, TRACK, BASE });
await page.goto(BASE + "#/card");
await page.reload();
await page.waitForSelector("#ai-rate-btn");
const t0 = Date.now();
await page.click("#ai-rate-btn");
await page.waitForTimeout(20000);
await page.evaluate(() => document.getElementById("ai-run").scrollIntoView({ block: "center" }));
await page.screenshot({ path: ROOT + "screens/v13-real-progress.png" });
const midPct = await page.textContent("#ai-run-pct");
await page.waitForSelector("#ai-run.is-finished", { timeout: 300000 });
const ms = Date.now() - t0;
await page.waitForTimeout(1200);
const dialog = await page.$("#level-dialog");
let dialogText = null;
if (dialog) {
  dialogText = (await page.textContent(".lvl-dialog-text")).trim();
  await page.screenshot({ path: ROOT + "screens/v13-real-dialog.png" });
  await page.click("#level-dialog-no");
  await page.waitForTimeout(400);
}
await page.evaluate(() => document.getElementById("toast").classList.remove("show"));
await page.evaluate(() => document.querySelector("#card-root .ut-ai").scrollIntoView({ block: "start" }));
await page.waitForTimeout(400);
await page.screenshot({ path: ROOT + "screens/v13-real-expanded.png" });
console.log(JSON.stringify({ ms, midPct, requests: reqs.length, perVideo: reqs, dialogText, badge: (await page.textContent("#card-root .ut-hero .ut-badge b")).trim(), response, errors }, null, 2));
await browser.close();
