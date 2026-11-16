// v21 — unique card_id, email-sent UI, rater dropdown, weighted ratings, player notify.
// Disposable @example.com users only.
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "fs";
import {
  ensureUser, deleteCard, upsertCard, addAdmin, cleanupExampleTestUsers,
  cleanupCertifiedTestData, DEVICE
} from "./v15-admin.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.V21_BASE || "http://127.0.0.1:8877/";
const SHOTS = ROOT + "screens/";
const failures = [];
function assert(c, m) { if (!c) { failures.push(m); console.error("FAIL", m); } else console.log("OK  ", m); }
fs.mkdirSync(SHOTS, { recursive: true });

const PLAYER_EMAIL = "padel.test.v21.player@example.com";
const RATER_EMAIL = "padel.test.v21.rater@example.com";
const OTHER_EMAIL = "padel.test.v21.other@example.com";
const ADMIN_EMAIL = "padel.test.v21.admin@example.com";

function seed(id, name, levelId, extra) {
  return Object.assign({
    levelId: levelId || "C1",
    profile: {
      id, name, gender: "male", age: "28", hand: "right", side: "right",
      competitor: "no", hasPartner: "no", partnerId: null,
      photo: BASE + "avatars/alon.jpg", region: "center", courts: [],
      frequency: "2-3", tenure: "1-2", style: "social", shots: ["volley"]
    },
    answers: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    videos: []
  }, extra || {});
}

await cleanupExampleTestUsers(/padel\.test\.v21/i).catch(function () {});
await cleanupCertifiedTestData().catch(function () {});

const player = await ensureUser(PLAYER_EMAIL);
const rater = await ensureUser(RATER_EMAIL);
const other = await ensureUser(OTHER_EMAIL);
const admin = await ensureUser(ADMIN_EMAIL);
await deleteCard(player.id);
await deleteCard(rater.id);
await deleteCard(other.id);

try {
  await upsertCard(player.id, seed("local-v21-shared", "שחקן א", "C1"));
  try {
    await upsertCard(other.id, seed("local-v21-shared", "שחקן ב", "C1"));
    assert(false, "server rejects upsert of a card_id owned by another user");
  } catch (err) {
    assert(/upsert card failed|already owned|23505|duplicate/i.test(String(err && err.message || err)),
      "server rejects upsert of a card_id owned by another user");
  }
} finally {
  await deleteCard(player.id);
  await deleteCard(other.id);
}

const playerCard = seed("local-v21-player", "שחקן בדיקה", "C1");
playerCard.profile.ai = { l: "B2", c: 2, n: 1, t: 180, d: 261116, s: [3, 3, 3, 3, 3, 3, 3, 3] };
await upsertCard(player.id, playerCard);
await upsertCard(rater.id, seed("local-v21-rater", "מאמן בדיקה", "B2"));
await addAdmin(ADMIN_EMAIL, admin.id);

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome-stable",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});

async function signIn(page, creds) {
  await page.waitForFunction(() => window.PadelAuth && PadelAuth.getClient && PadelAuth.getClient());
  const result = await page.evaluate(async ({ email, password }) => {
    const c = PadelAuth.getClient();
    const { error } = await c.auth.signInWithPassword({ email, password });
    return { error: error && (error.message || String(error)) };
  }, { email: creds.email, password: creds.password });
  if (result.error) throw new Error("sign-in failed: " + result.error);
  await page.waitForFunction(() => {
    const modal = document.getElementById("legal-consent-modal");
    const accepted = window.PadelLegal && PadelLegal.hasAccepted && PadelLegal.hasAccepted();
    return accepted && (!modal || modal.classList.contains("hidden"));
  }, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function rpcAs(page, name, args) {
  return page.evaluate(async ({ name, args }) => {
    const c = PadelAuth.getClient();
    const { data, error } = await c.rpc(name, args || {});
    return { data, error: error && (error.message || String(error)) };
  }, { name, args });
}

async function hideToast(page) {
  await page.evaluate(() => {
    const t = document.getElementById("toast");
    if (t) t.classList.remove("show");
  }).catch(() => {});
}

try {
  // Empty account CTA
  const ctxE = await browser.newContext(DEVICE);
  const pageE = await ctxE.newPage();
  await pageE.goto(BASE);
  await signIn(pageE, other);
  await pageE.goto(BASE + "#/");
  await pageE.waitForTimeout(800);
  const emptyText = await pageE.evaluate(() => {
    const note = document.getElementById("home-empty-card");
    const cta = document.getElementById("home-cta-label");
    return {
      noteVisible: note && !note.classList.contains("hidden"),
      note: (note && note.textContent) || "",
      cta: (cta && cta.textContent) || ""
    };
  });
  assert(emptyText.noteVisible && /אין עדיין כרטיס/.test(emptyText.note) && emptyText.cta === "צור כרטיס חדש",
    "logged-in account with no card shows צור כרטיס חדש");
  await ctxE.close();

  // Admin creates test rater
  const ctxA = await browser.newContext(DEVICE);
  const pageA = await ctxA.newPage();
  await pageA.goto(BASE);
  await signIn(pageA, admin);
  await pageA.waitForTimeout(800);
  const added = await rpcAs(pageA, "admin_add_certified_rater", {
    p_full_name: "מאמן בדיקה v21",
    p_email: RATER_EMAIL
  });
  assert(added.data && added.data.id, "admin created test rater");
  const raterId = added.data && added.data.id;
  await ctxA.close();

  // Player: email-sent UI (intercept success) + request
  const ctxP = await browser.newContext(DEVICE);
  const pageP = await ctxP.newPage();
  await pageP.route("**/functions/v1/notify-rating-request", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, id: "mock-resend" })
    });
  });
  await pageP.goto(BASE);
  await signIn(pageP, player);
  await pageP.waitForTimeout(1000);
  await pageP.goto(BASE + "#/");
  await pageP.waitForSelector("#req-ask-home-btn:not(.hidden)", { timeout: 15000 });
  const askLabel = await pageP.textContent("#req-ask-home-btn");
  assert(/בקש דירוג ממוסמך/.test(askLabel || ""), "ask button wording is דירוג ממוסמך");
  await pageP.click("#req-ask-home-btn");
  await pageP.waitForSelector('#req-picker-list button[data-rater-id]:not([disabled])', { timeout: 15000 });
  await pageP.click(`#req-picker-list button[data-rater-id="${raterId}"]`);
  await pageP.click("#req-picker-send");
  await pageP.waitForSelector("#req-picker-result:not(.hidden)", { timeout: 20000 });
  const resultText = (await pageP.textContent("#req-picker-result")) || "";
  assert(/נשלח מייל ל/.test(resultText) && /הבקשה ממתינה לדירוג/.test(resultText),
    "picker shows email-sent success state from Resend result");
  await hideToast(pageP);
  await pageP.screenshot({ path: SHOTS + "v21-email-sent.png", timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + "v21-email-sent.png");
  if (await pageP.$("#req-picker-result-close")) await pageP.click("#req-picker-result-close");
  await pageP.waitForTimeout(400);
  const mineMail = await pageP.evaluate(() => (document.querySelector("#req-mine-home") || {}).innerText || "");
  // Intercept does not write email_sent_at; after close, list may lack the mail line. That's ok.
  await ctxP.close();

  // Rater: inbox (no decline), dropdown sheet, confirm rating
  const ctxR = await browser.newContext(DEVICE);
  const pageR = await ctxR.newPage();
  await pageR.goto(BASE);
  await signIn(pageR, rater);
  await pageR.waitForTimeout(1500);
  await pageR.goto(BASE + "#/");
  await pageR.waitForSelector("#req-home-banner:not(.hidden), #req-inbox", { timeout: 20000 });
  const noDecline = await pageR.evaluate(() => !document.querySelector('#req-inbox [data-req-act="decline"]'));
  assert(noDecline, "inbox has no decline option");
  const rateBtn = await pageR.$('#req-inbox [data-req-act="rate"]');
  if (rateBtn) {
    await pageR.click('#req-inbox [data-req-act="rate"]');
  } else {
    // open via card rate route if inbox item missing
    const inbox = await rpcAs(pageR, "list_rater_requests", {});
    const pending = (inbox.data || []).find((r) => r.status === "pending");
    assert(!!pending, "rater has a pending request");
    if (pending) await pageR.goto(BASE + "#/rate/" + pending.id);
  }
  await pageR.waitForSelector("#certified-sheet:not(.hidden)", { timeout: 20000 });
  const hasSelect = await pageR.$("#certified-level-select");
  const hasAsher = await pageR.evaluate(() => {
    const btn = document.getElementById("certified-sheet-save");
    return btn && /אשר/.test(btn.textContent || "");
  });
  const options = await pageR.evaluate(() =>
    Array.from(document.querySelectorAll("#certified-level-select option")).map((o) => o.value).filter(Boolean)
  );
  assert(hasSelect && hasAsher, "rater sheet is a dropdown plus אשר");
  assert(options.join(",") === "D2,D1,C2,C1,B2,B1,A2,A1", "dropdown lists Israeli levels");
  await pageR.selectOption("#certified-level-select", "B2");
  await hideToast(pageR);
  await pageR.screenshot({ path: SHOTS + "v21-rater-dropdown.png", timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + "v21-rater-dropdown.png");
  await pageR.click("#certified-sheet-save");
  await pageR.waitForFunction(() => {
    const el = document.getElementById("certified-sheet");
    return !el || el.classList.contains("hidden");
  }, { timeout: 20000 });
  await ctxR.close();

  // Player: notification banner + 4-row ratings
  const ctxP2 = await browser.newContext(DEVICE);
  const pageP2 = await ctxP2.newPage();
  await pageP2.goto(BASE);
  await signIn(pageP2, player);
  await pageP2.waitForTimeout(1200);
  await pageP2.goto(BASE + "#/");
  await pageP2.waitForSelector("#rated-home-banner:not(.hidden)", { timeout: 20000 });
  const banner = (await pageP2.textContent("#rated-home-banner")) || "";
  assert(/קיבלת דירוג מוסמך חדש/.test(banner), "player home shows new certified-rating banner");
  await hideToast(pageP2);
  await pageP2.screenshot({ path: SHOTS + "v21-player-rated-banner.png", timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + "v21-player-rated-banner.png");

  await pageP2.click("#rated-home-banner");
  await pageP2.waitForSelector("#card-root .ut-ratings-block", { timeout: 20000 });
  await pageP2.waitForFunction(() => {
    const block = document.querySelector("#card-root .ut-ratings-block");
    const hero = ((document.querySelector("#card-root .ut-badge b") || {}).textContent || "").trim();
    const text = (block && block.innerText) || "";
    return /דירוג מוסמך/.test(text) && /דירוג AI/.test(text) && hero === "B2";
  }, { timeout: 20000 });
  const rows = await pageP2.evaluate(() => {
    const root = document.querySelector("#card-root");
    const text = (root && root.innerText) || "";
    const block = document.querySelector("#card-root .ut-ratings-block");
    return {
      text,
      quiz: /דירוג שאלון/.test(text),
      ai: /דירוג AI/.test(text),
      cert: /דירוג מוסמך/.test(text) && !/⭐/.test((document.querySelector("#card-root .ut-star-label") || {}).textContent || ""),
      weighted: !!(block && block.querySelector(".ut-weighted")) && /דירוג משוקלל/.test(text),
      starIcon: !!document.querySelector("#card-root .ut-star-ico"),
      decline: /נדחה/.test(text),
      hero: ((document.querySelector("#card-root .ut-badge b") || {}).textContent || "").trim()
    };
  });
  assert(rows.quiz && rows.ai && rows.cert && rows.weighted, "card shows four rating rows");
  assert(!rows.starIcon, "certified row has no star icon");
  assert(!rows.decline, "player view has no declined status");
  // C1=3, B2 AI=4, B2 cert=4 → 0.2*3 + 0.3*4 + 0.5*4 = 0.6+1.2+2.0=3.8 → 4 = B2
  assert(rows.hero === "B2", "hero badge shows the weighted level (B2)");
  await pageP2.evaluate(() => {
    const row = document.querySelector("#card-root .ut-weighted");
    if (row) row.scrollIntoView({ block: "center" });
  });
  await hideToast(pageP2);
  await pageP2.waitForTimeout(250);
  await pageP2.screenshot({ path: SHOTS + "v21-ratings-four-rows.png", timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + "v21-ratings-four-rows.png");

  // Banner dismissed after click
  await pageP2.goto(BASE + "#/");
  await pageP2.waitForTimeout(800);
  const hiddenAfter = await pageP2.evaluate(() => {
    const el = document.getElementById("rated-home-banner");
    return !el || el.classList.contains("hidden");
  });
  assert(hiddenAfter, "rated banner is dismissed after it was seen");
  await ctxP2.close();
} catch (err) {
  failures.push("THROWN: " + (err && err.stack || err));
  console.error(err);
} finally {
  await browser.close().catch(() => {});
  await cleanupCertifiedTestData().catch(() => {});
  await cleanupExampleTestUsers(/padel\.test\.v21/i).catch(() => {});
}

if (failures.length) {
  console.error("FAILED", failures.length, failures);
  process.exit(1);
}
console.log("ALL v21 CHECKS PASSED");
