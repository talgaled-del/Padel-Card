// v17 — legal pages, login consent checkbox, existing-user modal, media consent.
// Disposable test users only. Never modifies real accounts.
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "fs";
import {
  ensureUser, deleteTestUser, clearLegalAcceptance, setLegalAcceptance, DEVICE
} from "./v15-admin.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.BASE || "http://127.0.0.1:8873/";
const SHOTS = ROOT + "screens/";
const failures = [];
function assert(c, m) { if (!c) { failures.push(m); console.error("FAIL", m); } else console.log("OK  ", m); }

fs.mkdirSync(SHOTS, { recursive: true });

const EMAIL = "padel.test.v17.legal@example.com";
const user = await ensureUser(EMAIL);
await clearLegalAcceptance(user.id);
console.log("TEST USER ready (no legal acceptance)");

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

  /* Legal pages are public */
  for (const [route, title, heading] of [
    ["terms", "תנאי שימוש", "השירות ניתן כיום בחינם"],
    ["privacy", "מדיניות פרטיות", "תיקון מס׳ 13"],
    ["copyright", "זכויות יוצרים וקניין רוחני", "הודעת נגד"]
  ]) {
    await page.goto(BASE + "#/" + route, { waitUntil: "networkidle" });
    await page.waitForSelector("#view-legal:not(.hidden) .legal-article", { timeout: 15000 });
    const info = await page.evaluate(() => ({
      h1: (document.querySelector("#view-legal h1") || {}).textContent || "",
      text: (document.querySelector("#view-legal") || {}).innerText || "",
      version: (document.querySelector(".legal-version") || {}).textContent || "",
      footer: !document.getElementById("site-footer").classList.contains("hidden"),
      login: !document.getElementById("view-login").classList.contains("hidden")
    }));
    assert(info.h1 === title, route + " page title: " + info.h1);
    assert(info.text.includes(heading), route + " contains expected section text");
    assert(/גרסה 1/.test(info.version) && /16 בנובמבר 2026/.test(info.version), route + " has version line: " + info.version);
    assert(info.footer && !info.login, route + " is public and shows the site footer");
    await snap(page, "v17-" + route + ".png");
  }

  /* Footer links from login */
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("#view-login:not(.hidden)", { timeout: 15000 });
  const loginFoot = await page.evaluate(() => ({
    footer: !document.getElementById("site-footer").classList.contains("hidden"),
    copy: (document.querySelector(".site-copy") || {}).textContent || "",
    checkbox: !!document.getElementById("auth-legal-accept"),
    label: (document.getElementById("auth-legal-label") || {}).innerText || ""
  }));
  assert(loginFoot.footer && /© 2026 Padel Card/.test(loginFoot.copy) && /כל הזכויות שמורות/.test(loginFoot.copy),
    "login footer has the copyright line: " + loginFoot.copy);
  assert(loginFoot.checkbox && /קראתי ואני מסכים/.test(loginFoot.label), "login consent checkbox is visible");
  await snap(page, "v17-login-consent.png");

  /* Cannot start email login without ticking */
  await page.fill("#auth-email", EMAIL);
  await page.click("#auth-email-submit");
  await page.waitForTimeout(400);
  const blocked = await page.evaluate(() => {
    const err = document.getElementById("auth-error");
    return (err && !err.classList.contains("hidden")) ? (err.textContent || "") : "";
  });
  assert(/תנאי השימוש|מדיניות הפרטיות/.test(blocked), "email login is blocked without consent: " + blocked);

  /* Footer link opens terms */
  await page.click(".site-legal-nav a[href='#/terms']");
  await page.waitForSelector("#view-legal:not(.hidden) h1", { timeout: 10000 });
  assert((await page.textContent("#view-legal h1")) === "תנאי שימוש", "footer terms link opens the terms page");

  /* Share card shows a tiny legal line */
  await page.goto(BASE + "#/demo/michal", { waitUntil: "networkidle" });
  await page.waitForSelector("#view-card:not(.hidden) .ut-card, #card-root .ut-card", { timeout: 15000 });
  const shareLine = await page.evaluate(() => {
    const el = document.getElementById("share-legal");
    return {
      visible: !!(el && !el.classList.contains("hidden")),
      text: (el && el.innerText) || "",
      footerHidden: document.getElementById("site-footer").classList.contains("hidden")
    };
  });
  assert(shareLine.visible && /תנאי שימוש/.test(shareLine.text) && /מדיניות פרטיות/.test(shareLine.text),
    "public share card has a terms/privacy line");
  assert(shareLine.footerHidden, "full site footer is not shown on a public share card");
  await snap(page, "v17-share-legal-line.png");

  /* Existing user without acceptance sees the modal after sign-in */
  await page.goto(BASE);
  await page.waitForFunction(() => window.PadelAuth && PadelAuth.getClient && PadelAuth.getClient());
  const signed = await page.evaluate(async ({ email, password }) => {
    const { data, error } = await PadelAuth.getClient().auth.signInWithPassword({ email, password });
    return { ok: !!(data && data.user), error: error && error.message };
  }, user);
  assert(signed.ok, "test user signed in: " + (signed.error || "ok"));
  await page.waitForSelector("#legal-consent-modal:not(.hidden)", { timeout: 20000 });
  const modal = await page.evaluate(() => ({
    title: (document.getElementById("legal-consent-title") || {}).textContent || "",
    text: (document.getElementById("legal-consent-modal") || {}).innerText || ""
  }));
  assert(/אישור תנאי השימוש/.test(modal.title) && /קראתי ואני מסכים/.test(modal.text),
    "existing user sees the one-time consent modal");
  await snap(page, "v17-consent-modal.png");

  /* Opening terms from the modal, then coming back */
  await page.click("#legal-consent-modal a[href='#/terms']");
  await page.waitForSelector("#view-legal:not(.hidden)", { timeout: 10000 });
  const fromModal = await page.evaluate(() => ({
    modalHidden: document.getElementById("legal-consent-modal").classList.contains("hidden"),
    bar: !document.getElementById("legal-pending-bar").classList.contains("hidden"),
    title: (document.querySelector("#view-legal h1") || {}).textContent || ""
  }));
  assert(fromModal.modalHidden && fromModal.bar && fromModal.title === "תנאי שימוש",
    "modal hides while reading terms, with a return bar");

  await page.click("#legal-pending-back");
  await page.waitForSelector("#legal-consent-modal:not(.hidden)", { timeout: 10000 });
  await page.check("#legal-modal-accept");
  await page.click("#legal-consent-form button[type=submit]");
  await page.waitForFunction(() => document.getElementById("legal-consent-modal").classList.contains("hidden"), { timeout: 15000 });
  assert(true, "accepting the modal stores consent and dismisses it");

  assert(true, "modal acceptance path finished");
  await ctx.close();
} catch (err) {
  console.error("TEST ERROR", err);
  failures.push(String(err && err.message || err));
}

// Re-do media prompt cleanly in a fresh signed-in page if needed
try {
  const ctx2 = await browser.newContext(DEVICE);
  const page2 = await ctx2.newPage();
  await page2.goto(BASE);
  await page2.waitForFunction(() => window.PadelAuth && PadelAuth.getClient && PadelAuth.getClient());
  const signed2 = await page2.evaluate(async ({ email, password }) => {
    const { data, error } = await PadelAuth.getClient().auth.signInWithPassword({ email, password });
    return { ok: !!(data && data.user), error: error && error.message };
  }, user);
  assert(signed2.ok, "re-signin for media test: " + (signed2.error || "ok"));
  await page2.waitForFunction(() => window.PadelLegal && PadelLegal.hasAccepted && PadelLegal.hasAccepted(), { timeout: 15000 });
  const flags = await page2.evaluate(() => ({
    modal: !document.getElementById("legal-consent-modal").classList.contains("hidden"),
    accepted: window.PadelLegal && PadelLegal.hasAccepted && PadelLegal.hasAccepted()
  }));
  assert(flags.accepted && !flags.modal, "accepted user does not see the terms modal again");

  await page2.evaluate(() => { PadelLegal.promptMediaConsent(); });
  await page2.waitForSelector("#legal-media-modal:not(.hidden)", { timeout: 10000 });
  await snap(page2, "v17-media-consent.png");
  await page2.check("#legal-media-accept");
  await page2.click("#legal-media-yes");
  await page2.waitForFunction(() => document.getElementById("legal-media-modal").classList.contains("hidden"), { timeout: 15000 });
  const mediaOk = await page2.evaluate(() => PadelLegal.hasMediaConsent());
  assert(mediaOk, "media consent is stored after the checkbox");
  await ctx2.close();
} catch (err) {
  console.error("MEDIA TEST ERROR", err);
  failures.push(String(err && err.message || err));
}

await browser.close();
try { await deleteTestUser(user.id); } catch (err) { console.error("cleanup failed"); }
console.log("TEST USER removed");

if (failures.length) {
  console.error("\n" + failures.length + " FAILURES");
  failures.forEach((f) => console.error(" -", f));
  process.exit(1);
}
console.log("\nALL V17 LEGAL TESTS PASSED");
