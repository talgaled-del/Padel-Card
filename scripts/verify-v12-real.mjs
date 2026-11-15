// v12 — one REAL AI Rating through the card UI (server running WITHOUT MOCK_AI, GEMINI_API_KEY set).
// cd server && EXTRA_VIDEO_HOSTS=127.0.0.1:18767 PORT=8787 node server.js
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "fs";
const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.BASE || "http://127.0.0.1:8765/";
const VIDEO_BASE = process.env.VIDEO_BASE || "http://127.0.0.1:18767/";
const TRACK = JSON.parse(fs.readFileSync(process.env.TRACK || "/workspace/padel-test/new-track.json", "utf8"));
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome-stable", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "he-IL",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(BASE);
await page.evaluate(({ photo, video, track, poster }) => {
  localStorage.setItem("padelCard.v2", JSON.stringify({
    levelId: "B2",
    profile: { id: "local-tal-ai-real", name: "טל גלעד", gender: "male", age: "36", hand: "right", side: "right", competitor: "no", hasPartner: "no", partnerId: null, photo, region: "center", courts: [], frequency: "2-3", tenure: "3plus", style: "both", shots: ["volley"] },
    answers: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
    videos: [{ id: "vid-1", name: "משחק", link: video, poster, duration: 29.56, bytes: 2767965, trackUrl: "", marker: null, track }]
  }));
}, { photo: BASE + "avatars/alon.jpg", video: VIDEO_BASE + "tal-pushit.mp4", track: TRACK, poster: VIDEO_BASE + "frames/raw-0.png" });
await page.goto(BASE + "#/card");
await page.reload();
await page.waitForSelector("#ai-rate-btn");
let response = null;
page.on("response", async (r) => { if (r.url().endsWith("/api/ai-rating") && r.request().method() === "POST") { try { response = await r.json(); } catch (e) {} } });
const t0 = Date.now();
await page.click("#ai-rate-btn");
await page.waitForSelector("#card-root .ut-ai, #toast.show", { timeout: 300000 });
await page.waitForSelector("#card-root .ut-ai", { timeout: 5000 }).catch(() => {});
const ms = Date.now() - t0;
const ok = !!(await page.$("#card-root .ut-ai"));
console.log(JSON.stringify({ ok, ms, toast: await page.textContent("#toast"), response, errors }, null, 2));
if (ok) {
  await page.evaluate(() => document.getElementById("toast").classList.remove("show"));
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector("#card-root .ut-ai").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: ROOT + "screens/v12-real-expanded.png" });
}
await browser.close();
process.exit(ok && !errors.length ? 0 : 1);
