// v18 — filming tips at video upload and in the tracking-circle picker,
// plus failure copy that mentions a moving camera / side change.
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "fs";
import {
  ensureUser, deleteTestUser, deleteCard, upsertCard, DEVICE
} from "./v15-admin.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.BASE || "http://127.0.0.1:8874/";
const VB = process.env.VIDEO_BASE || "http://127.0.0.1:18767/";
const SHOTS = ROOT + "screens/";
const failures = [];
function assert(c, m) { if (!c) { failures.push(m); console.error("FAIL", m); } else console.log("OK  ", m); }

fs.mkdirSync(SHOTS, { recursive: true });

const EMAIL = "padel.test.v18.tips@example.com";
const seed = {
  levelId: "C1",
  profile: {
    id: "local-v18-tips",
    name: "שחקן בדיקה",
    gender: "male",
    age: "28",
    hand: "right",
    side: "right",
    competitor: "no",
    hasPartner: "no",
    partnerId: null,
    photo: BASE + "avatars/alon.jpg",
    region: "center",
    courts: [],
    frequency: "2-3",
    tenure: "1-2",
    style: "social",
    shots: ["volley"]
  },
  answers: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  videos: []
};

// Source-level check: failure copy mentions the filming guidance.
const appSrc = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const serverSrc = fs.readFileSync(new URL("../server/server.js", import.meta.url), "utf8");
assert(/מצלמה זזה/.test(appSrc) && /מתחלף הצד/.test(appSrc), "tracking failure copy mentions camera/side change");
assert(/מצלמה הייתה קבועה/.test(appSrc) && /אותו צד/.test(appSrc), "AI failure copy mentions a fixed camera and staying on the same side");
assert(/מצלמה הייתה קבועה/.test(serverSrc), "API ai_failed message mentions a fixed camera");

const regular = await ensureUser(EMAIL);
await deleteCard(regular.id);
await upsertCard(regular.id, seed);
console.log("TEST USER ready");

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome-stable",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});

async function snap(page, name) {
  await page.evaluate(() => {
    const t = document.getElementById("toast");
    if (t) t.classList.remove("show");
  }).catch(() => {});
  await page.waitForTimeout(200);
  await page.screenshot({ path: SHOTS + name, timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + name);
}

try {
  const ctx = await browser.newContext(DEVICE);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures.push("pageerror: " + e.message); console.log("PAGEERROR", e.message); });
  await page.goto(BASE);
  await page.waitForFunction(() => window.PadelAuth && PadelAuth.getClient && PadelAuth.getClient());
  const signed = await page.evaluate(async ({ email, password }) => {
    const { data, error } = await PadelAuth.getClient().auth.signInWithPassword({ email, password });
    return { ok: !!(data && data.user), error: error && error.message };
  }, regular);
  assert(signed.ok, "signed in: " + (signed.error || "ok"));
  await page.waitForTimeout(1000);
  await page.goto(BASE + "#/profile");
  await page.waitForSelector("#view-profile:not(.hidden)", { timeout: 20000 });
  await page.waitForSelector("#vid-tips-profile", { timeout: 10000 });
  const tips = await page.evaluate(() => {
    const el = document.getElementById("vid-tips-profile");
    const text = (el && el.innerText) || "";
    const hidden = !el || el.classList.contains("hidden") || el.offsetParent === null && !el.getClientRects().length;
    // offsetParent can be null if inside a visible form; use bounding box
    const rect = el ? el.getBoundingClientRect() : { height: 0 };
    return {
      text,
      visible: !!(el && rect.height > 0),
      hasIcon: !!(el && el.querySelector(".vid-tips-icon svg")),
      bullets: el ? [...el.querySelectorAll("li")].map((li) => li.textContent.trim()) : []
    };
  });
  assert(tips.visible && tips.hasIcon, "upload tips box is visible with an icon");
  assert(/מעקב|דירוג/.test(tips.text) && /אותו צד/.test(tips.text), "upload tips explain why staying in position matters");
  assert(tips.bullets.some((b) => /מצלמה קבועה/.test(b)), "bullet: fixed camera");
  assert(tips.bullets.some((b) => /אותו צד/.test(b)), "bullet: same side throughout");
  assert(tips.bullets.some((b) => /נראה במלואו/.test(b)), "bullet: player fully visible");
  await page.evaluate(() => {
    const el = document.getElementById("vid-tips-profile");
    if (el) el.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(200);
  await snap(page, "v18-upload-tips.png");

  await page.evaluate((url) => {
    const el = document.getElementById("video-link");
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.value = url;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, VB + "clip1.mp4");
  await page.evaluate(() => {
    const btn = document.getElementById("add-link");
    if (btn) btn.click();
  });
  const mediaModal = page.locator("#legal-media-modal:not(.hidden)");
  if (await mediaModal.count()) {
    await page.check("#legal-media-accept");
    await page.click("#legal-media-yes");
  }
  await page.waitForFunction(() => {
    return [...document.querySelectorAll("#video-list .text-btn")]
      .some((b) => /סימון שחקן/.test(b.textContent || ""));
  }, { timeout: 15000 });
  const markCount = await page.evaluate(() =>
    [...document.querySelectorAll("#video-list .text-btn")]
      .filter((b) => /סימון שחקן/.test(b.textContent || "")).length
  );
  assert(markCount > 0, "mark-player action appears for the added clip");
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("#video-list .text-btn")]
      .find((b) => /סימון שחקן/.test(b.textContent || ""));
    if (btn) {
      btn.scrollIntoView({ block: "center" });
      btn.click();
    }
  });
  await page.waitForSelector("#track-picker:not(.hidden) #vid-tips-picker", { timeout: 20000 });
  const picker = await page.evaluate(() => {
    const el = document.getElementById("vid-tips-picker");
    const text = (el && el.innerText) || "";
    const rect = el ? el.getBoundingClientRect() : { height: 0 };
    return {
      text,
      visible: !!(el && rect.height > 0),
      hasIcon: !!(el && el.querySelector(".vid-tips-icon svg")),
      title: (document.getElementById("track-picker-title") || {}).textContent || "",
      bullets: el ? [...el.querySelectorAll("li")].map((li) => li.textContent.trim()) : []
    };
  });
  assert(picker.visible && picker.hasIcon && /מי אתם בסרטון/.test(picker.title), "tracking picker shows the tips box");
  assert(/ננעל על המיקום|אותו צד/.test(picker.text), "picker tips explain the lock-on / same-side rule");
  assert(picker.bullets.some((b) => /מצלמה קבועה/.test(b)) && picker.bullets.some((b) => /נראה במלואו/.test(b)),
    "picker has short filming bullets");
  await snap(page, "v18-track-picker-tips.png");
  await ctx.close();
} catch (err) {
  console.error("TEST ERROR", err);
  failures.push(String(err && err.message || err));
}

await browser.close();
try { await deleteTestUser(regular.id); } catch (err) { console.error("cleanup failed"); }
console.log("TEST USER removed");

if (failures.length) {
  console.error("\n" + failures.length + " FAILURES");
  failures.forEach((f) => console.error(" -", f));
  process.exit(1);
}
console.log("\nALL V18 UPLOAD-TIPS TESTS PASSED");
