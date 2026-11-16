// v19 — certified star ratings: badge on the card, rater sheet, admin tab.
// Disposable test users and a temporary test rater only. Never touches real accounts.
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "fs";
import {
  ensureUser, deleteTestUser, deleteCard, upsertCard, addAdmin, removeAdmin,
  cleanupExampleTestUsers, cleanupCertifiedTestData, DEVICE
} from "./v15-admin.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.BASE || "http://127.0.0.1:8875/";
const SHOTS = ROOT + "screens/";
const failures = [];
function assert(c, m) { if (!c) { failures.push(m); console.error("FAIL", m); } else console.log("OK  ", m); }

fs.mkdirSync(SHOTS, { recursive: true });

const PLAYER_EMAIL = "padel.test.v19.player@example.com";
const RATER_EMAIL = "padel.test.v19.rater@example.com";
const ADMIN_EMAIL = "padel.test.v19.admin@example.com";

function seed(id, name, levelId) {
  return {
    levelId: levelId || "C1",
    profile: {
      id: id,
      name: name,
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
}

await cleanupCertifiedTestData().catch(function () {});
const player = await ensureUser(PLAYER_EMAIL);
const rater = await ensureUser(RATER_EMAIL);
const admin = await ensureUser(ADMIN_EMAIL);
await deleteCard(player.id);
await deleteCard(rater.id);
await upsertCard(player.id, seed("local-v19-player", "שחקן בדיקה", "C1"));
await upsertCard(rater.id, seed("local-v19-rater", "מאמן בדיקה", "B2"));
await addAdmin(ADMIN_EMAIL, admin.id);
console.log("TEST USERS ready");

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
    return { data, error: error && (error.message || String(error)) };
  }, { name, args });
}

async function shareUrlFromCard(page) {
  await page.goto(BASE + "#/card");
  await page.waitForSelector("#card-root .ut-card", { timeout: 20000 });
  const waHref = await page.getAttribute("#wa-share-own", "href");
  if (waHref && waHref.includes("text=")) {
    const text = decodeURIComponent(waHref.split("text=")[1] || "");
    const line = text.split("\n").pop();
    if (line && /#\/p\//.test(line)) return line;
  }
  return page.evaluate(() => {
    const a = document.getElementById("wa-share-own");
    return (a && a.href) || location.href;
  });
}

let shareUrl = "";
let testRaterId = "";

try {
  /* ---- Admin creates a temporary rater linked to the test email ---- */
  const ctxA = await browser.newContext(DEVICE);
  const pageA = await ctxA.newPage();
  pageA.on("pageerror", (e) => { failures.push("pageerror A: " + e.message); console.log("PAGEERROR A", e.message); });
  await pageA.goto(BASE);
  await signIn(pageA, admin);
  await pageA.waitForTimeout(1200);
  const added = await rpcAs(pageA, "admin_add_certified_rater", {
    p_full_name: "מאמן בדיקה",
    p_email: RATER_EMAIL
  });
  assert(!added.error && added.data && added.data.id, "admin can add a certified rater: " + (added.error || "ok"));
  testRaterId = added.data && added.data.id;
  const listed = await rpcAs(pageA, "admin_list_certified_raters");
  const names = ((listed.data) || []).map((r) => r.full_name).join(" · ");
  assert(/עמית נאור/.test(names) && /סער סימון/.test(names) && /מאמן בדיקה/.test(names),
    "admin list includes seeded raters and the test rater");
  await ctxA.close();

  /* ---- Rater sees the home badge ---- */
  const ctxR = await browser.newContext(DEVICE);
  const pageR = await ctxR.newPage();
  pageR.on("pageerror", (e) => { failures.push("pageerror R: " + e.message); console.log("PAGEERROR R", e.message); });
  await pageR.goto(BASE);
  await signIn(pageR, rater);
  await pageR.waitForTimeout(1500);
  await pageR.goto(BASE + "#/");
  await pageR.waitForSelector("#view-home:not(.hidden)", { timeout: 20000 });
  await pageR.waitForFunction(() => {
    const el = document.getElementById("home-certified-badge");
    return el && !el.classList.contains("hidden");
  }, { timeout: 15000 });
  const homeBadge = await pageR.textContent("#home-certified-badge");
  assert(/אתה מוסמך דירוג/.test(homeBadge || ""), "rater home shows the certified badge");
  await ctxR.close();

  /* ---- Player share URL ---- */
  const ctxP = await browser.newContext(DEVICE);
  const pageP = await ctxP.newPage();
  await pageP.goto(BASE);
  await signIn(pageP, player);
  await pageP.waitForTimeout(1200);
  shareUrl = await shareUrlFromCard(pageP);
  assert(/#\/p\//.test(shareUrl), "got a share URL for the player card");
  await ctxP.close();

  /* ---- Rater opens the share card, rates, screenshot sheet + badge ---- */
  const ctxR2 = await browser.newContext(DEVICE);
  const pageR2 = await ctxR2.newPage();
  pageR2.on("pageerror", (e) => { failures.push("pageerror R2: " + e.message); console.log("PAGEERROR R2", e.message); });
  await pageR2.goto(BASE);
  await signIn(pageR2, rater);
  await pageR2.waitForTimeout(1500);
  await pageR2.goto(shareUrl, { waitUntil: "networkidle" });
  await pageR2.waitForSelector("#view-card:not(.hidden) .ut-card", { timeout: 20000 });
  await pageR2.waitForSelector("#certified-rate-bar:not(.hidden) #certified-rate-btn", { timeout: 15000 });
  assert(true, "rater sees the rate-as-certified button on someone else's card");
  await pageR2.evaluate(() => document.getElementById("certified-rate-btn").click());
  await pageR2.waitForSelector("#certified-sheet:not(.hidden)", { timeout: 10000 });
  await pageR2.click('.certified-level[data-level="B2"]');
  await pageR2.fill("#certified-note", "רשת יציבה, עדיין מתקשה מהזכוכית.");
  await snap(pageR2, "v19-rater-sheet.png");
  await pageR2.click("#certified-sheet-save");
  await pageR2.waitForSelector("#certified-sheet.hidden, #certified-sheet.hidden #certified-sheet-save", { timeout: 15000 }).catch(() => {});
  await pageR2.waitForFunction(() => {
    const sheet = document.getElementById("certified-sheet");
    const star = document.querySelector("#card-root .ut-star");
    return sheet && sheet.classList.contains("hidden") && !!star;
  }, { timeout: 15000 });
  const badge = await pageR2.evaluate(() => {
    const star = document.querySelector("#card-root .ut-star");
    const hero = document.querySelector("#card-root .ut-star-badge");
    return {
      text: (star && star.innerText) || "",
      hero: (hero && hero.innerText) || ""
    };
  });
  assert(/דירוג מוסמך/.test(badge.text) && /B2/.test(badge.text) && /מאמן בדיקה/.test(badge.text),
    "card shows the gold certified row with level and rater name");
  assert(/B2/.test(badge.hero) && /מוסמך/.test(badge.hero), "hero has a certified star badge next to the photo level");
  await pageR2.evaluate(() => {
    const el = document.querySelector("#card-root .ut-star");
    if (el) el.scrollIntoView({ block: "center" });
  });
  await snap(pageR2, "v19-card-badge.png");

  /* Cannot rate own card */
  await pageR2.goto(BASE + "#/card");
  await pageR2.waitForSelector("#card-root .ut-card", { timeout: 20000 });
  const ownBar = await pageR2.evaluate(() => {
    const bar = document.getElementById("certified-rate-bar");
    return !bar || bar.classList.contains("hidden");
  });
  assert(ownBar, "rater does not see the rate button on their own card");
  await ctxR2.close();

  /* ---- Visitor sees the badge, not the rate button ---- */
  const vis = await browser.newContext(DEVICE);
  const vp = await vis.newPage();
  await vp.goto(shareUrl, { waitUntil: "networkidle" });
  await vp.waitForSelector("#view-card:not(.hidden) .ut-card", { timeout: 20000 });
  await vp.waitForSelector("#card-root .ut-star", { timeout: 15000 });
  const visitor = await vp.evaluate(() => ({
    text: (document.querySelector("#card-root .ut-star") || {}).innerText || "",
    rateHidden: !document.getElementById("certified-rate-bar") || document.getElementById("certified-rate-bar").classList.contains("hidden")
  }));
  assert(/דירוג מוסמך/.test(visitor.text) && /B2/.test(visitor.text), "visitor sees the certified rating");
  assert(visitor.rateHidden, "visitor does not see the rate button");
  await vis.close();

  /* ---- Owner also sees the badge ---- */
  const ctxOwn = await browser.newContext(DEVICE);
  const pageOwn = await ctxOwn.newPage();
  await pageOwn.goto(BASE);
  await signIn(pageOwn, player);
  await pageOwn.waitForTimeout(1200);
  await pageOwn.goto(BASE + "#/card");
  await pageOwn.waitForSelector("#card-root .ut-star", { timeout: 20000 });
  const ownText = await pageOwn.evaluate(() => (document.querySelector("#card-root .ut-star") || {}).innerText || "");
  assert(/דירוג מוסמך/.test(ownText) && /B2/.test(ownText), "owner sees the certified rating on their card");
  const ownRateHidden = await pageOwn.evaluate(() => {
    const bar = document.getElementById("certified-rate-bar");
    return !bar || bar.classList.contains("hidden");
  });
  assert(ownRateHidden, "owner does not see the rate button on their own card");
  await ctxOwn.close();

  /* ---- Self-rate RPC is rejected ---- */
  const ctxDeny = await browser.newContext(DEVICE);
  const pageDeny = await ctxDeny.newPage();
  await pageDeny.goto(BASE);
  await signIn(pageDeny, rater);
  await pageDeny.waitForTimeout(1000);
  const denied = await rpcAs(pageDeny, "upsert_certified_rating", {
    p_card_id: "local-v19-rater",
    p_level: "A1",
    p_note: null
  });
  assert(/cannot rate own card|own card/i.test(denied.error || ""), "RPC rejects rating your own card: " + (denied.error || "no error"));
  await ctxDeny.close();

  /* ---- Admin tab screenshot + delete rating ---- */
  const ctxB = await browser.newContext(DEVICE);
  const pageB = await ctxB.newPage();
  pageB.on("pageerror", (e) => { failures.push("pageerror B: " + e.message); console.log("PAGEERROR B", e.message); });
  await pageB.goto(BASE);
  await signIn(pageB, admin);
  await pageB.waitForTimeout(1200);
  await pageB.goto(BASE + "#/admin");
  await pageB.waitForSelector("#view-admin:not(.hidden)", { timeout: 20000 });
  await pageB.evaluate(() => {
    const btn = document.querySelector('[data-admin-tab="certified"]');
    if (btn) btn.click();
  });
  await pageB.waitForSelector("#admin-pane-certified:not(.hidden)", { timeout: 10000 });
  await pageB.waitForFunction(() => /מאמן בדיקה/.test((document.getElementById("admin-raters") || {}).innerText || ""), { timeout: 15000 });
  const adminText = await pageB.evaluate(() => ({
    raters: (document.getElementById("admin-raters") || {}).innerText || "",
    ratings: (document.getElementById("admin-cert-ratings") || {}).innerText || "",
    tab: (document.getElementById("admin-tab-certified") || {}).className || ""
  }));
  assert(/מאמן בדיקה/.test(adminText.raters) && /עמית נאור/.test(adminText.raters), "admin tab lists the test rater and a seeded name");
  assert(/B2/.test(adminText.ratings) && /שחקן בדיקה/.test(adminText.ratings), "admin tab shows the recent certified rating");
  await snap(pageB, "v19-admin-certified.png");

  const del = await rpcAs(pageB, "admin_delete_certified_rating", {
    p_id: (await rpcAs(pageB, "admin_list_certified_ratings")).data[0].id
  });
  assert(!del.error, "admin can delete a certified rating: " + (del.error || "ok"));
  await ctxB.close();

  const vis2 = await browser.newContext(DEVICE);
  const vp2 = await vis2.newPage();
  await vp2.goto(shareUrl, { waitUntil: "networkidle" });
  await vp2.waitForSelector("#view-card:not(.hidden) .ut-card", { timeout: 20000 });
  await vp2.waitForTimeout(1500);
  const gone = await vp2.evaluate(() => !document.querySelector("#card-root .ut-star"));
  assert(gone, "after admin deletes the rating, the share card hides the star row");
  await vis2.close();
} catch (err) {
  console.error("TEST ERROR", err);
  failures.push(String(err && err.message || err));
}

await browser.close();
try { await cleanupCertifiedTestData(); } catch (err) { console.error("certified cleanup failed"); }
try { await removeAdmin(ADMIN_EMAIL); } catch (err) {}
try { await deleteTestUser(player.id); } catch (err) { console.error("cleanup player failed"); }
try { await deleteTestUser(rater.id); } catch (err) { console.error("cleanup rater failed"); }
try { await deleteTestUser(admin.id); } catch (err) { console.error("cleanup admin failed"); }
try { await cleanupExampleTestUsers(/padel\.test\.v19/i); } catch (err) {}
console.log("TEST USERS removed");

if (failures.length) {
  console.error("\n" + failures.length + " FAILURES");
  failures.forEach((f) => console.error(" -", f));
  process.exit(1);
}
console.log("\nALL V19 CERTIFIED TESTS PASSED");
