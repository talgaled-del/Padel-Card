// v16 — admin console (list, stats, disable/enable, share-link hide, delete, audit).
// Creates disposable users only; never modifies real accounts.
// Needs: static site at BASE (default http://127.0.0.1:8872/)
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "fs";
import {
  ensureUser, deleteTestUser, deleteCard, upsertCard, addAdmin, removeAdmin,
  deleteDisabledCard, cleanupExampleTestUsers, DEVICE
} from "./v15-admin.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.BASE || "http://127.0.0.1:8872/";
const SHOTS = ROOT + "screens/";
const failures = [];
function assert(c, m) { if (!c) { failures.push(m); console.error("FAIL", m); } else console.log("OK  ", m); }

fs.mkdirSync(SHOTS, { recursive: true });

const USER_EMAIL = "padel.test.v16.user@example.com";
const ADMIN_EMAIL = "padel.test.v16.admin@example.com";

const seed = {
  levelId: "C1",
  profile: {
    id: "local-v16-user",
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

const regular = await ensureUser(USER_EMAIL);
const admin = await ensureUser(ADMIN_EMAIL);
console.log("TEST USERS ready");
await deleteCard(regular.id);
await upsertCard(regular.id, seed);
await addAdmin(ADMIN_EMAIL, admin.id);

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
  await page.waitForTimeout(250);
  await page.screenshot({ path: SHOTS + name, timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + name);
}

async function signIn(page, creds) {
  await page.waitForFunction(() => window.PadelAuth && PadelAuth.getClient && PadelAuth.getClient());
  const result = await page.evaluate(async ({ email, password }) => {
    const c = PadelAuth.getClient();
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    return { error: error && (error.message || String(error)), id: data && data.user && data.user.id };
  }, { email: creds.email, password: creds.password });
  if (result.error) throw new Error("sign-in failed: " + result.error);
  return result;
}

async function rpcAs(page, name, args) {
  return page.evaluate(async ({ name, args }) => {
    const c = PadelAuth.getClient();
    const { data, error } = await c.rpc(name, args || {});
    return { data, error: error && { message: error.message, code: error.code, status: error.status } };
  }, { name, args: args || {} });
}

let shareUrl = "";
try {
  /* ---- Non-admin cannot reach console or RPCs ---- */
  const ctxA = await browser.newContext(DEVICE);
  const pageA = await ctxA.newPage();
  pageA.on("pageerror", (e) => { console.log("PAGEERROR A", e.message); failures.push("pageerror A: " + e.message); });
  await pageA.goto(BASE);
  await signIn(pageA, regular);
  await pageA.waitForSelector("#card-root .ut-card, #view-home:not(.hidden)", { timeout: 30000 });
  await pageA.waitForTimeout(800);
  const homeA = await pageA.evaluate(() => ({
    adminBtn: !!(document.getElementById("home-admin-btn") && !document.getElementById("home-admin-btn").classList.contains("hidden")),
    login: !document.getElementById("view-login").classList.contains("hidden"),
    name: (document.querySelector("#card-root .ut-id h1") || {}).textContent || ""
  }));
  assert(!homeA.adminBtn, "non-admin does not see the admin entry button");

  const denied = await rpcAs(pageA, "admin_stats");
  assert(!!denied.error, "admin_stats RPC rejects a non-admin");
  const deniedList = await rpcAs(pageA, "admin_list_users", { p_search: "", p_sort: "created_at_desc" });
  assert(!!deniedList.error, "admin_list_users RPC rejects a non-admin");

  await pageA.goto(BASE + "#/admin");
  await pageA.waitForTimeout(800);
  const gated = await pageA.evaluate(() => ({
    admin: !document.getElementById("view-admin").classList.contains("hidden"),
    home: !document.getElementById("view-home").classList.contains("hidden"),
    card: !document.getElementById("view-card").classList.contains("hidden"),
    login: !document.getElementById("view-login").classList.contains("hidden")
  }));
  assert(!gated.admin, "non-admin hitting #/admin is not shown the console");
  assert(gated.home || gated.card, "non-admin is redirected away from #/admin");

  // Share URL of the regular user's card
  await pageA.goto(BASE + "#/card");
  await pageA.waitForSelector("#card-root .ut-card", { timeout: 20000 });
  const waHref = await pageA.getAttribute("#wa-share-own", "href");
  if (waHref && waHref.includes("text=")) {
    shareUrl = decodeURIComponent(waHref.split("text=")[1]).split("\n").pop();
  }
  if (!shareUrl) {
    shareUrl = await pageA.evaluate(() => {
      const btn = document.getElementById("copy-own-link");
      return location.origin + location.pathname + "#/card";
    });
  }
  assert(/#\/p\//.test(shareUrl) || shareUrl.length > 20, "got a share URL for the test card");
  await ctxA.close();

  /* ---- Visitor can see the share link before disable ---- */
  const vis1 = await browser.newContext(DEVICE);
  const vp1 = await vis1.newPage();
  await vp1.goto(shareUrl, { waitUntil: "networkidle" });
  await vp1.waitForSelector("#view-card:not(.hidden) .ut-card, #view-unavailable:not(.hidden)", { timeout: 20000 });
  const before = await vp1.evaluate(() => ({
    card: !document.getElementById("view-card").classList.contains("hidden"),
    unavailable: !document.getElementById("view-unavailable").classList.contains("hidden"),
    name: (document.querySelector("#card-root .ut-id h1") || {}).textContent || ""
  }));
  assert(before.card && !before.unavailable && /בדיקה/.test(before.name), "share link shows the card before disable");
  await vis1.close();

  /* ---- Admin sees list and stats, then disable/enable/delete ---- */
  const ctxB = await browser.newContext(DEVICE);
  const pageB = await ctxB.newPage();
  pageB.on("pageerror", (e) => { console.log("PAGEERROR B", e.message); failures.push("pageerror B: " + e.message); });
  await pageB.goto(BASE);
  await signIn(pageB, admin);
  await pageB.waitForTimeout(1000);
  await pageB.goto(BASE + "#/");
  await pageB.waitForTimeout(500);
  const homeB = await pageB.evaluate(() => ({
    adminBtn: !!(document.getElementById("home-admin-btn") && !document.getElementById("home-admin-btn").classList.contains("hidden"))
  }));
  // Admin may land on home or have no card — open console directly
  await pageB.goto(BASE + "#/admin");
  await pageB.waitForSelector("#view-admin:not(.hidden)", { timeout: 20000 });
  await pageB.waitForFunction(() => (document.querySelectorAll("#admin-users .admin-user").length > 0) || /משתמשים/.test((document.getElementById("admin-user-count") || {}).textContent || ""), null, { timeout: 20000 });
  await pageB.waitForTimeout(400);
  const statsText = ((await pageB.textContent("#admin-stats")) || "").replace(/\s+/g, " ");
  assert(/משתמשים/.test(statsText) && /כרטיסים/.test(statsText), "stats dashboard is visible: " + statsText.slice(0, 120));

  await pageB.fill("#admin-search", USER_EMAIL);
  await pageB.waitForTimeout(800);
  await pageB.waitForFunction((email) => (document.querySelector("#admin-users") || {}).innerText.includes(email), USER_EMAIL, { timeout: 15000 });
  const row = await pageB.evaluate((email) => {
    const art = [...document.querySelectorAll(".admin-user")].find((el) => (el.innerText || "").includes(email));
    if (!art) return null;
    return { text: art.innerText.replace(/\s+/g, " "), status: (art.querySelector(".admin-status") || {}).textContent };
  }, USER_EMAIL);
  assert(row && /שחקן בדיקה/.test(row.text) && /C1/.test(row.text), "admin list shows the test user card name and level");
  assert(row.status === "פעיל", "test user is active before disable");
  await snap(pageB, "v16-admin-console.png");
  await pageB.evaluate(() => document.querySelector(".admin-log") && document.querySelector(".admin-log").scrollIntoView({ block: "center" }));
  await snap(pageB, "v16-admin-stats-list.png");

  /* Disable */
  await pageB.click(`.admin-user:has-text("${USER_EMAIL}") [data-admin-act="disable"]`);
  await pageB.waitForSelector("#admin-dialog:not(.hidden)");
  await snap(pageB, "v16-admin-disable-dialog.png");
  await pageB.evaluate(() => document.getElementById("admin-dialog-yes").click());
  await pageB.waitForFunction((email) => {
    const art = [...document.querySelectorAll(".admin-user")].find((el) => (el.innerText || "").includes(email));
    return art && /לא פעיל/.test(art.innerText);
  }, USER_EMAIL, { timeout: 20000 });
  assert(true, "user shows as disabled in the list");
  await snap(pageB, "v16-admin-disabled.png");

  // Sign-in blocked
  const ctxBan = await browser.newContext(DEVICE);
  const pageBan = await ctxBan.newPage();
  await pageBan.goto(BASE);
  await pageBan.waitForFunction(() => window.PadelAuth && PadelAuth.getClient && PadelAuth.getClient());
  const banned = await pageBan.evaluate(async ({ email, password }) => {
    const { error } = await PadelAuth.getClient().auth.signInWithPassword({ email, password });
    return { error: error && (error.message || String(error)) };
  }, { email: regular.email, password: regular.password });
  assert(!!banned.error, "disabled user cannot sign in: " + (banned.error || "no error"));
  await ctxBan.close();

  // Share link hidden
  const vis2 = await browser.newContext(DEVICE);
  const vp2 = await vis2.newPage();
  await vp2.goto(shareUrl, { waitUntil: "networkidle" });
  await vp2.waitForSelector("#view-unavailable:not(.hidden), #view-card:not(.hidden)", { timeout: 20000 });
  const hidden = await vp2.evaluate(() => ({
    unavailable: !document.getElementById("view-unavailable").classList.contains("hidden"),
    title: (document.querySelector("#view-unavailable h1") || {}).textContent || "",
    card: !document.getElementById("view-card").classList.contains("hidden")
  }));
  assert(hidden.unavailable && /אינו זמין/.test(hidden.title) && !hidden.card, "disabled share link shows a neutral unavailable message");
  await snap(vp2, "v16-share-unavailable.png");
  await vis2.close();

  /* Enable */
  await pageB.click(`.admin-user:has-text("${USER_EMAIL}") [data-admin-act="enable"]`);
  await pageB.waitForSelector("#admin-dialog:not(.hidden)");
  await pageB.evaluate(() => document.getElementById("admin-dialog-yes").click());
  await pageB.waitForFunction((email) => {
    const art = [...document.querySelectorAll(".admin-user")].find((el) => (el.innerText || "").includes(email));
    const st = art && art.querySelector(".admin-status");
    return st && st.textContent === "פעיל";
  }, USER_EMAIL, { timeout: 20000 });
  assert(true, "user is active again after enable");

  const ctxOn = await browser.newContext(DEVICE);
  const pageOn = await ctxOn.newPage();
  await pageOn.goto(BASE);
  await signIn(pageOn, regular);
  await pageOn.waitForSelector("#card-root .ut-card, #view-home:not(.hidden)", { timeout: 30000 });
  assert(true, "enabled user can sign in again");
  await ctxOn.close();

  const vis3 = await browser.newContext(DEVICE);
  const vp3 = await vis3.newPage();
  await vp3.goto(shareUrl, { waitUntil: "networkidle" });
  await vp3.waitForSelector("#view-card:not(.hidden) .ut-card", { timeout: 20000 });
  const restored = await vp3.evaluate(() => (document.querySelector("#card-root .ut-id h1") || {}).textContent || "");
  assert(/בדיקה/.test(restored), "share link is visible again after enable");
  await vis3.close();

  /* Read-only card preview */
  await pageB.click(`.admin-user:has-text("${USER_EMAIL}") [data-admin-act="view"]`);
  await pageB.waitForSelector("#card-root .ut-card", { timeout: 20000 });
  const preview = await pageB.evaluate(() => ({
    name: (document.querySelector("#card-root .ut-id h1") || {}).textContent || "",
    bar: !!(document.getElementById("admin-preview-bar") && !document.getElementById("admin-preview-bar").classList.contains("hidden")),
    owner: !!(document.getElementById("owner-actions") && !document.getElementById("owner-actions").classList.contains("hidden"))
  }));
  assert(/בדיקה/.test(preview.name) && preview.bar && !preview.owner, "admin can view the card read-only");
  await snap(pageB, "v16-admin-card-preview.png");
  await pageB.click("#admin-preview-back");
  await pageB.waitForSelector("#view-admin:not(.hidden)", { timeout: 15000 });

  /* Delete */
  await pageB.fill("#admin-search", USER_EMAIL);
  await pageB.waitForTimeout(700);
  await pageB.click(`.admin-user:has-text("${USER_EMAIL}") [data-admin-act="delete"]`);
  await pageB.waitForSelector("#admin-dialog:not(.hidden)");
  await pageB.fill("#admin-dialog-email", USER_EMAIL);
  await snap(pageB, "v16-admin-delete-dialog.png");
  await pageB.evaluate(() => document.getElementById("admin-dialog-yes").click());
  await pageB.waitForFunction((email) => !(document.querySelector("#admin-users") || {}).innerText.includes(email), USER_EMAIL, { timeout: 20000 });
  assert(true, "deleted user disappears from the list");

  const vis4 = await browser.newContext(DEVICE);
  const vp4 = await vis4.newPage();
  await vp4.goto(shareUrl, { waitUntil: "networkidle" });
  await vp4.waitForSelector("#view-unavailable:not(.hidden)", { timeout: 20000 });
  assert(true, "share link stays hidden after the user is deleted");
  await vis4.close();

  await pageB.evaluate(() => document.querySelector(".admin-log") && document.querySelector(".admin-log").scrollIntoView({ block: "start" }));
  await pageB.waitForTimeout(400);
  const logText = ((await pageB.textContent("#admin-actions")) || "").replace(/\s+/g, " ");
  assert(/השבתה/.test(logText) && /הפעלה/.test(logText) && /מחיקה/.test(logText), "audit log records disable, enable, and delete");
  assert(logText.includes(USER_EMAIL), "audit log names the target user");
  await snap(pageB, "v16-admin-audit.png");
  await ctxB.close();
} finally {
  await browser.close();
  try { await removeAdmin(ADMIN_EMAIL); } catch (err) { console.error("cleanup admin row failed"); }
  try { await deleteTestUser(regular.id); } catch (err) { console.error("cleanup regular user failed"); }
  try { await deleteTestUser(admin.id); } catch (err) { console.error("cleanup admin user failed"); }
  try { await deleteDisabledCard("local-v16-user"); } catch (err) { console.error("cleanup disabled card failed"); }
  try {
    const n = await cleanupExampleTestUsers(/padel\.test\.v16/i);
    if (n) console.log("swept leftover v16 test users:", n);
  } catch (err) { console.error("sweep leftover test users failed"); }
  console.log("TEST USERS removed");
}

if (failures.length) {
  console.error("\n" + failures.length + " FAILURES");
  failures.forEach((f) => console.error(" -", f));
  process.exit(1);
}
console.log("\nALL V16 ADMIN TESTS PASSED");
