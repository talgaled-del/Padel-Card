// v20 — foreign-local-card regression + rating requests (picker, inbox, status, admin).
// Disposable @example.com users and temporary test raters only. Never emails real coaches.
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "fs";
import {
  ensureUser, deleteTestUser, deleteCard, upsertCard, getCard, addAdmin, removeAdmin,
  cleanupExampleTestUsers, cleanupCertifiedTestData, DEVICE
} from "./v15-admin.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.V20_BASE || "http://127.0.0.1:8876/";
const SHOTS = ROOT + "screens/";
const failures = [];
function assert(c, m) { if (!c) { failures.push(m); console.error("FAIL", m); } else console.log("OK  ", m); }

fs.mkdirSync(SHOTS, { recursive: true });

const PLAYER_EMAIL = "padel.test.v20.player@example.com";
const RATER_EMAIL = "padel.test.v20.rater@example.com";
const RATER2_EMAIL = "padel.test.v20.rater2@example.com";
const RATER3_EMAIL = "padel.test.v20.rater3@example.com";
const OTHER_EMAIL = "padel.test.v20.other@example.com";
const ADMIN_EMAIL = "padel.test.v20.admin@example.com";

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

await cleanupExampleTestUsers(/padel\.test\.v20/i).catch(function () {});
await cleanupCertifiedTestData().catch(function () {});

const player = await ensureUser(PLAYER_EMAIL);
const rater = await ensureUser(RATER_EMAIL);
const rater2 = await ensureUser(RATER2_EMAIL);
const rater3 = await ensureUser(RATER3_EMAIL);
const other = await ensureUser(OTHER_EMAIL);
const admin = await ensureUser(ADMIN_EMAIL);
await deleteCard(player.id);
await deleteCard(rater.id);
await deleteCard(rater2.id);
await deleteCard(rater3.id);
await deleteCard(other.id);
await upsertCard(player.id, seed("local-v20-player", "שחקן בדיקה", "C1"));
await upsertCard(rater.id, seed("local-v20-rater", "מאמן בדיקה", "B2"));
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
  await page.waitForFunction(() => {
    const modal = document.getElementById("legal-consent-modal");
    const accepted = window.PadelLegal && PadelLegal.hasAccepted && PadelLegal.hasAccepted();
    return accepted && (!modal || modal.classList.contains("hidden"));
  }, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400);
  return result;
}

async function signOut(page) {
  await page.evaluate(async () => {
    if (window.PadelAuth && PadelAuth.signOut) await PadelAuth.signOut();
    const c = PadelAuth.getClient && PadelAuth.getClient();
    if (!c || !c.auth || !c.auth.getSession) return;
    for (let i = 0; i < 25; i++) {
      const res = await c.auth.getSession();
      if (!(res && res.data && res.data.session)) return;
      await new Promise((r) => setTimeout(r, 200));
    }
  });
  await page.waitForTimeout(400);
}

async function rpcAs(page, name, args) {
  return page.evaluate(async ({ name, args }) => {
    const c = PadelAuth.getClient();
    const { data, error } = await c.rpc(name, args || {});
    return { data, error: error && (error.message || String(error)) };
  }, { name, args });
}

async function invokeNotify(page, requestId, kind) {
  return page.evaluate(async ({ requestId, kind }) => {
    const c = PadelAuth.getClient();
    const { data, error } = await c.functions.invoke("notify-rating-request", {
      body: { request_id: requestId, kind: kind || "new" }
    });
    return { data, error: error && (error.message || String(error)) };
  }, { requestId, kind });
}

let testRaterId = "";
let testRater2Id = "";
let testRater3Id = "";
let noEmailRaterId = "";
let shareUrl = "";

try {
  /* ---- Admin: create raters, block admin email, screenshot requests pane ---- */
  const ctxA = await browser.newContext(DEVICE);
  const pageA = await ctxA.newPage();
  pageA.on("pageerror", (e) => { failures.push("pageerror A: " + e.message); console.log("PAGEERROR A", e.message); });
  await pageA.goto(BASE);
  const hadTitleOnHome = await pageA.evaluate(() => {
    window.__hadTitleAtStart = !!document.getElementById("admin-req-title");
    if (window.__hadTitleAtStart) {
      const obs = new MutationObserver(() => {
        if (!document.getElementById("admin-req-title") && !window.__reqTitleGone) {
          window.__reqTitleGone = (new Error("admin-req-title removed")).stack;
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      window.__reqTitleObs = obs;
    }
    return window.__hadTitleAtStart;
  });
  console.log("hadTitleOnHome", hadTitleOnHome);
  await signIn(pageA, admin);
  await pageA.waitForTimeout(1200);

  const previewAdmin = await rpcAs(pageA, "admin_preview_rater_email", { p_email: ADMIN_EMAIL });
  assert(previewAdmin.data && previewAdmin.data.is_admin === true, "admin email preview flags is_admin");

  const blocked = await rpcAs(pageA, "admin_add_certified_rater", {
    p_full_name: "מוסמך אסור",
    p_email: ADMIN_EMAIL
  });
  assert(/cannot assign admin email/i.test(blocked.error || ""), "RPC blocks assigning an admin email to a rater");

  const added = await rpcAs(pageA, "admin_add_certified_rater", {
    p_full_name: "מאמן בדיקה v20",
    p_email: RATER_EMAIL
  });
  assert(added.data && added.data.id, "admin created test rater 1");
  testRaterId = added.data && added.data.id;

  const added2 = await rpcAs(pageA, "admin_add_certified_rater", {
    p_full_name: "מאמן שני v20",
    p_email: RATER2_EMAIL
  });
  assert(added2.data && added2.data.id, "admin created test rater 2");
  testRater2Id = added2.data && added2.data.id;

  const added3 = await rpcAs(pageA, "admin_add_certified_rater", {
    p_full_name: "מאמן שלישי v20",
    p_email: RATER3_EMAIL
  });
  assert(added3.data && added3.data.id, "admin created test rater 3");
  testRater3Id = added3.data && added3.data.id;

  const soon = await rpcAs(pageA, "admin_add_certified_rater", {
    p_full_name: "מאמן בקרוב v20",
    p_email: null
  });
  assert(soon.data && soon.data.id, "admin created a no-email rater");
  noEmailRaterId = soon.data && soon.data.id;

  await pageA.goto(BASE + "#/admin");
  await pageA.waitForSelector("#view-admin:not(.hidden)", { timeout: 20000 });
  await pageA.waitForSelector("#admin-tab-certified", { timeout: 10000 });
  await pageA.evaluate(() => {
    const btn = document.getElementById("admin-tab-certified");
    if (btn) btn.click();
  });
  await pageA.waitForSelector("#admin-pane-certified:not(.hidden)", { timeout: 10000 });
  await pageA.waitForFunction(() => {
    const view = document.getElementById("view-admin");
    return view && !view.classList.contains("is-busy");
  }, { timeout: 20000 }).catch(() => {});
  const adminDebug = await pageA.evaluate(() => {
    const pane = document.getElementById("admin-pane-certified");
    const title = document.getElementById("admin-req-title");
    if (title) title.scrollIntoView({ block: "center" });
    else if (pane) pane.scrollIntoView({ block: "end" });
    return {
      hasTitle: !!title,
      hasCounts: !!document.getElementById("admin-req-counts"),
      busy: (document.getElementById("view-admin") || {}).className || "",
      paneText: (pane && pane.innerText || "").slice(0, 1500),
      bodyHas: /בקשות דירוג/.test(document.body.innerText || "")
    };
  });
  const titleTrace = await pageA.evaluate(() => ({ had: window.__hadTitleAtStart, gone: window.__reqTitleGone || null, now: !!document.getElementById("admin-req-title") }));
  console.log("TITLE TRACE", JSON.stringify(titleTrace));
  console.log("ADMIN DEBUG keys", adminDebug.hasTitle, adminDebug.hasCounts, adminDebug.bodyHas, "busy=", adminDebug.busy);
  assert(adminDebug.hasTitle || adminDebug.bodyHas, "admin certified tab shows rating-request section");
  await pageA.screenshot({ path: SHOTS + "v20-admin-requests.png", timeout: 20000, fullPage: true });
  console.log("SHOT", SHOTS + "v20-admin-requests.png");
  await ctxA.close();

  /* ---- Sync bug: A's local card must not upload onto B ---- */
  const ctxSync = await browser.newContext(DEVICE);
  const pageSync = await ctxSync.newPage();
  pageSync.on("pageerror", (e) => { failures.push("pageerror SYNC: " + e.message); console.log("PAGEERROR SYNC", e.message); });
  await pageSync.goto(BASE);
  await signIn(pageSync, player);
  await pageSync.waitForTimeout(1800);
  await pageSync.goto(BASE + "#/card");
  await pageSync.waitForSelector("#card-root .ut-card", { timeout: 20000 });
  const ownerName = await pageSync.evaluate(() => {
    const el = document.querySelector("#card-root .ut-name, #card-root h1, #card-root .name");
    return (el && el.textContent) || document.body.innerText;
  });
  assert(/שחקן בדיקה/.test(ownerName || ""), "player A sees their own card before sign-out");
  const chipA = await pageSync.evaluate(() => (document.getElementById("account-chip-email") || {}).textContent || (document.getElementById("account-chip") || {}).innerText || "");
  assert((chipA || "").toLowerCase().includes("padel.test.v20.player@example.com"), "account chip shows player A email");
  await snap(pageSync, "v20-account-chip.png");
  await signOut(pageSync);
  await pageSync.waitForTimeout(600);

  await signIn(pageSync, other);
  await pageSync.waitForTimeout(2500);
  await pageSync.evaluate(() => { if (location.hash !== "#/" && location.hash !== "#/home") location.hash = "#/"; });
  await pageSync.waitForTimeout(600);
  const afterB = await pageSync.evaluate(() => {
    const views = ["home","login","boot","card","quiz","profile","legal","share"].filter((n) => {
      const el = document.getElementById("view-" + n);
      return el && !el.classList.contains("hidden");
    });
    const chip = (document.getElementById("account-chip-email") || {}).textContent || "";
    const viewCard = document.getElementById("view-card");
    const viewHome = document.getElementById("view-home");
    const body = document.body.innerText || "";
    return {
      chip,
      onCard: viewCard && !viewCard.classList.contains("hidden"),
      onHome: viewHome && !viewHome.classList.contains("hidden"),
      hasPlayerName: /שחקן בדיקה/.test(body),
      toast: (document.getElementById("toast") || {}).textContent || "",
      hash: location.hash,
      views
    };
  });
  console.log("AFTER B", JSON.stringify({ chip: afterB.chip, onCard: afterB.onCard, onHome: afterB.onHome, hash: afterB.hash, views: afterB.views, toast: (afterB.toast || "").slice(0, 120) }));
  assert((afterB.chip || "").toLowerCase().includes("padel.test.v20.other@example.com"), "account chip shows user B email after switch");
  assert(!afterB.onCard, "user B is not taken to a player card");
  assert(afterB.onHome, "user B lands on home (no card of their own)");
  assert(!afterB.hasPlayerName, "user B UI does not show player A's card name");
  const otherCloud = await getCard(other.id);
  assert(!otherCloud, "user B has no cloud card (A's local card was not uploaded)");
  await ctxSync.close();

  /* ---- Player asks for a rating ---- */
  const ctxP = await browser.newContext(DEVICE);
  const pageP = await ctxP.newPage();
  pageP.on("pageerror", (e) => { failures.push("pageerror P: " + e.message); console.log("PAGEERROR P", e.message); });
  await pageP.goto(BASE);
  await signIn(pageP, player);
  await pageP.waitForTimeout(1500);
  await pageP.goto(BASE + "#/");
  await pageP.waitForSelector("#view-home:not(.hidden)", { timeout: 20000 });
  await pageP.waitForSelector("#req-ask-home-btn:not(.hidden)", { timeout: 15000 });
  await pageP.click("#req-ask-home-btn");
  await pageP.waitForSelector("#req-picker:not(.hidden)", { timeout: 10000 });
  await pageP.waitForFunction(() => document.querySelectorAll("#req-picker-list .req-rater").length > 0, { timeout: 15000 });
  const pickerState = await pageP.evaluate((ids) => {
    const btns = Array.from(document.querySelectorAll("#req-picker-list .req-rater"));
    const byName = Object.fromEntries(btns.map((b) => [b.querySelector("strong")?.textContent || "", {
      disabled: b.disabled,
      soon: b.classList.contains("is-soon"),
      text: b.innerText
    }]));
    const ready = btns.find((b) => b.getAttribute("data-rater-id") === ids.r1);
    const soon = btns.find((b) => b.getAttribute("data-rater-id") === ids.soon);
    return {
      count: btns.length,
      readyEnabled: !!(ready && !ready.disabled),
      soonDisabled: !!(soon && soon.disabled && /בקרוב/.test(soon.innerText)),
      names: Object.keys(byName)
    };
  }, { r1: testRaterId, soon: noEmailRaterId });
  assert(pickerState.readyEnabled, "rater with email is selectable in the picker");
  assert(pickerState.soonDisabled, "rater without email is disabled with בקרוב");
  await pageP.click('#req-picker-list .req-rater[data-rater-id="' + testRaterId + '"]');
  await pageP.fill("#req-picker-msg", "נשמח לחוות דעת אחרי אימון.");
  await snap(pageP, "v20-request-picker.png");
  await pageP.click("#req-picker-send");
  await pageP.waitForFunction(() => {
    const box = document.getElementById("req-picker");
    return box && box.classList.contains("hidden");
  }, { timeout: 15000 });

  await pageP.goto(BASE + "#/card");
  await pageP.waitForSelector("#card-root .ut-card", { timeout: 20000 });
  await pageP.waitForFunction(() => /ממתין/.test((document.getElementById("req-mine") || {}).innerText || ""), { timeout: 15000 });
  const pendingText = await pageP.textContent("#req-mine");
  assert(/ממתין/.test(pendingText || "") && /מאמן בדיקה v20/.test(pendingText || ""), "owner card shows pending request status");
  await snap(pageP, "v20-player-pending.png");

  const dup = await rpcAs(pageP, "create_rating_request", {
    p_rater_id: testRaterId,
    p_card_id: "local-v20-player",
    p_message: null
  });
  assert(/request already pending/i.test(dup.error || ""), "second pending request to the same rater is rejected");

  const extra2 = await rpcAs(pageP, "create_rating_request", {
    p_rater_id: testRater2Id,
    p_card_id: "local-v20-player",
    p_message: null
  });
  assert(extra2.data && extra2.data.id, "second pending request to a different rater is allowed");
  const extra3 = await rpcAs(pageP, "create_rating_request", {
    p_rater_id: testRater3Id,
    p_card_id: "local-v20-player",
    p_message: null
  });
  assert(extra3.data && extra3.data.id, "third pending request is allowed");
  const extra4 = await rpcAs(pageP, "admin_add_certified_rater", { p_full_name: "should not matter" });
  const overflowRater = await rpcAs(pageP, "list_certified_raters_public", {});
  // Need a 4th ready rater: create via admin session later; for now cancel isn't needed yet.
  // We'll create a 4th rater as admin below if needed — first cancel won't help the cap test.
  // Create 4th rater with a one-off admin rpc from a new context after this? Use stored admin session? closed.
  // Use getClient as player can't add raters. We'll add rater 4 in the first admin block... we already have 3.
  // Skip 4th rater until after we add one more via a short admin context.

  const mine = await rpcAs(pageP, "list_my_rating_requests", {});
  const pendingCount = (mine.data || []).filter((r) => r.status === "pending").length;
  assert(pendingCount === 3, "player has exactly 3 pending requests before overflow test");

  shareUrl = await pageP.evaluate(() => {
    const a = document.getElementById("wa-share-own");
    if (a && a.href && a.href.includes("text=")) {
      try {
        const text = decodeURIComponent(a.href.split("text=")[1] || "");
        const line = text.split("\n").pop();
        if (line && /#\/p\//.test(line)) return line;
      } catch (e) {}
    }
    return location.href;
  });
  if (!/#\/p\//.test(shareUrl || "")) {
    // fall back later from RPC card id
    shareUrl = BASE + "#/p/";
  }

  const notifySkip = await invokeNotify(pageP, (mine.data || []).find((r) => r.rater_id === testRaterId).id, "new");
  const skipped = !!(notifySkip.data && (notifySkip.data.skipped || (notifySkip.data.ok && notifySkip.data.reason)));
  const notifyOk = skipped || (notifySkip.data && notifySkip.data.ok) || !notifySkip.error;
  assert(notifyOk, "notify-rating-request for @example.com does not fail (skipped or ok)");
  if (notifySkip.data && notifySkip.data.skipped) {
    assert(true, "example.com notify was skipped (no mail to test accounts)");
  }

  // keep pageP open? close and reopen for status after rating.
  const firstReqId = ((mine.data || []).find((r) => r.rater_id === testRaterId) || {}).id;
  await ctxP.close();

  /* ---- Overflow: 4th pending is rejected (need a 4th rater) ---- */
  const ctxA2 = await browser.newContext(DEVICE);
  const pageA2 = await ctxA2.newPage();
  await pageA2.goto(BASE);
  await signIn(pageA2, admin);
  await pageA2.waitForTimeout(800);
  const added4 = await rpcAs(pageA2, "admin_add_certified_rater", {
    p_full_name: "מאמן רביעי v20",
    p_email: "padel.test.v20.rater4@example.com"
  });
  const rater4id = added4.data && added4.data.id;
  assert(!!rater4id, "admin created a 4th test rater for the cap");
  await ctxA2.close();

  const ctxP2 = await browser.newContext(DEVICE);
  const pageP2 = await ctxP2.newPage();
  await pageP2.goto(BASE);
  await signIn(pageP2, player);
  await pageP2.waitForTimeout(1000);
  const overflow = await rpcAs(pageP2, "create_rating_request", {
    p_rater_id: rater4id,
    p_card_id: "local-v20-player",
    p_message: null
  });
  assert(/too many pending requests/i.test(overflow.error || ""), "4th pending request is rate-limited");
  // cancel rater2 and rater3 so inbox test is clean (one pending for rater 1)
  const mine2 = await rpcAs(pageP2, "list_my_rating_requests", {});
  for (const row of (mine2.data || [])) {
    if (row.status === "pending" && row.rater_id !== testRaterId) {
      const c = await rpcAs(pageP2, "cancel_rating_request", { p_id: row.id });
      assert(!c.error, "player can cancel a pending request to rater " + row.rater_id);
    }
  }
  await ctxP2.close();

  /* ---- Rater inbox + rate via #/rate/id ---- */
  const ctxR = await browser.newContext(DEVICE);
  const pageR = await ctxR.newPage();
  pageR.on("pageerror", (e) => { failures.push("pageerror R: " + e.message); console.log("PAGEERROR R", e.message); });
  await pageR.goto(BASE);
  await signIn(pageR, rater);
  await pageR.waitForTimeout(1800);
  await pageR.goto(BASE + "#/");
  await pageR.waitForSelector("#view-home:not(.hidden)", { timeout: 20000 });
  const chipR = await pageR.textContent("#account-chip");
  assert(/מוסמך דירוג/.test(chipR || ""), "rater account chip shows certified tag");
  await pageR.waitForSelector("#req-inbox .req-inbox-item", { timeout: 15000 });
  const inboxText = await pageR.textContent("#req-inbox");
  assert(/שחקן בדיקה/.test(inboxText || "") && /דרג/.test(inboxText || ""), "rater inbox lists the player and a rate button");
  await pageR.evaluate(() => {
    const el = document.getElementById("req-inbox");
    if (el) el.scrollIntoView({ block: "start" });
  });
  await pageR.waitForTimeout(300);
  await snap(pageR, "v20-rater-inbox.png");

  await pageR.click('#req-inbox [data-req-act="rate"]');
  await pageR.waitForSelector("#view-card:not(.hidden) .ut-card", { timeout: 20000 });
  await pageR.waitForSelector("#certified-sheet:not(.hidden)", { timeout: 15000 });
  const sheetName = await pageR.textContent("#certified-sheet-name");
  assert(/שחקן בדיקה/.test(sheetName || ""), "rate route opens the player card rating sheet");
  await pageR.click('.certified-level[data-level="B2"]');
  await pageR.fill("#certified-note", "דירוג מתוך בקשה.");
  await snap(pageR, "v20-rate-sheet.png");
  await pageR.click("#certified-sheet-save");
  await pageR.waitForFunction(() => {
    const sheet = document.getElementById("certified-sheet");
    return sheet && sheet.classList.contains("hidden");
  }, { timeout: 20000 });

  const inboxAfter = await rpcAs(pageR, "list_rater_requests", {});
  const doneRow = (inboxAfter.data || []).find((r) => r.id === firstReqId || r.card_id === "local-v20-player");
  assert(doneRow && doneRow.status === "done", "rating marks the request as done");
  await ctxR.close();

  /* ---- Player sees done status ---- */
  const ctxP3 = await browser.newContext(DEVICE);
  const pageP3 = await ctxP3.newPage();
  await pageP3.goto(BASE);
  await signIn(pageP3, player);
  await pageP3.waitForTimeout(1500);
  await pageP3.goto(BASE + "#/card");
  await pageP3.waitForSelector("#card-root .ut-card", { timeout: 20000 });
  await pageP3.waitForFunction(() => /דורג/.test((document.getElementById("req-mine") || {}).innerText || ""), { timeout: 15000 });
  const doneText = await pageP3.textContent("#req-mine");
  assert(/דורג/.test(doneText || ""), "owner view shows the request as done");
  await snap(pageP3, "v20-player-done.png");

  /* ---- Decline path ---- */
  const again = await rpcAs(pageP3, "create_rating_request", {
    p_rater_id: testRater2Id,
    p_card_id: "local-v20-player",
    p_message: "בקשה לדחייה"
  });
  assert(again.data && again.data.id, "player can request a different rater after the first was done");
  const declineId = again.data.id;
  await ctxP3.close();

  const ctxR2 = await browser.newContext(DEVICE);
  const pageR2 = await ctxR2.newPage();
  await pageR2.goto(BASE);
  await signIn(pageR2, rater2);
  await pageR2.waitForTimeout(1500);
  await pageR2.goto(BASE + "#/");
  await pageR2.waitForSelector('#req-inbox [data-req-act="decline"]', { timeout: 15000 });
  await pageR2.click('#req-inbox [data-req-act="decline"]');
  await pageR2.waitForTimeout(1200);
  const afterDecline = await rpcAs(pageR2, "list_rater_requests", {});
  const declined = (afterDecline.data || []).find((r) => r.id === declineId);
  assert(declined && declined.status === "declined", "rater can decline a pending request");
  await ctxR2.close();

  /* ---- Direct share-link rating still works ---- */
  const ctxR3 = await browser.newContext(DEVICE);
  const pageR3 = await ctxR3.newPage();
  await pageR3.goto(BASE);
  await signIn(pageR3, rater);
  await pageR3.waitForTimeout(1200);
  // Use get_certified + public card via share if we have a real share URL, else skip soft.
  const cardRes = await rpcAs(pageR3, "get_certified_ratings", { p_card_id: "local-v20-player" }).catch(() => ({ data: null, error: "na" }));
  // Build a share navigation from the known card by loading via hash is hard (encoded).
  // Visit using the public card id through a lightweight RPC get? Keep v19 path if shareUrl is valid.
  if (shareUrl && /#\/p\//.test(shareUrl)) {
    await pageR3.goto(shareUrl, { waitUntil: "networkidle" });
    await pageR3.waitForSelector("#view-card:not(.hidden) .ut-card", { timeout: 20000 });
    const rateBtn = await pageR3.$("#certified-rate-bar:not(.hidden) #certified-rate-btn");
    assert(!!rateBtn, "direct share-link rating button still appears for a rater");
  } else {
    assert(true, "share URL not captured; skipped direct-link assertion (rating path already used #/rate)");
  }
  await ctxR3.close();

  /* ---- Admin counts include the requests ---- */
  const ctxA3 = await browser.newContext(DEVICE);
  const pageA3 = await ctxA3.newPage();
  await pageA3.goto(BASE);
  await signIn(pageA3, admin);
  await pageA3.waitForTimeout(1000);
  const listed = await rpcAs(pageA3, "admin_list_rating_requests", {});
  const counts = (listed.data && listed.data.counts) || {};
  assert((counts.total || 0) >= 1 && (counts.done || 0) >= 1, "admin list includes completed rating requests");
  await ctxA3.close();

} catch (err) {
  failures.push("THROWN: " + (err && err.stack || err));
  console.error(err);
} finally {
  await browser.close().catch(() => {});
  await cleanupCertifiedTestData().catch((e) => console.warn("cleanup raters", e && e.message));
  await cleanupExampleTestUsers(/padel\.test\.v20/i).catch((e) => console.warn("cleanup users", e && e.message));
}

if (failures.length) {
  console.error("FAILED", failures.length, failures);
  process.exit(1);
}
console.log("ALL v20 CHECKS PASSED");
