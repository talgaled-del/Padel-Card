// v15 — logged-out home is the login screen; visitor share/demo links stay open.
// Needs: static site at BASE (default http://127.0.0.1:8870/)
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "fs";
import { DEVICE } from "./v15-admin.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.BASE || "http://127.0.0.1:8870/";
const EMAIL = process.env.OTP_EMAIL || "test+padel@example.com";
const SHOTS = ROOT + "screens/";
const failures = [];
function assert(c, m) { if (!c) { failures.push(m); console.error("FAIL", m); } else console.log("OK  ", m); }

fs.mkdirSync(SHOTS, { recursive: true });

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
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + name, timeout: 20000 });
  console.log("SHOT", SHOTS + name);
}

const pageErrors = [];
const ctx = await browser.newContext(DEVICE);
const page = await ctx.newPage();
page.on("pageerror", (e) => { pageErrors.push(e.message); console.log("PAGEERROR", e.message); });

const otpReqs = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!/supabase\.co\/auth\/v1\//.test(u)) return;
  let body = null;
  try { body = await r.text(); } catch (e) { body = "(unreadable)"; }
  const rec = { url: u, status: r.status(), method: r.request().method(), body: String(body).slice(0, 800) };
  otpReqs.push(rec);
  console.log("AUTH RES", rec.method, rec.status, rec.url, rec.body);
});

await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForSelector("#view-login:not(.hidden)");
const boot = await page.evaluate(() => ({
  supabase: !!(window.supabase && window.supabase.createClient),
  configured: !!(window.PadelAuth && PadelAuth.isConfigured()),
  viewLogin: !document.getElementById("view-login").classList.contains("hidden"),
  viewHome: !document.getElementById("view-home").classList.contains("hidden"),
  viewCard: !document.getElementById("view-card").classList.contains("hidden"),
  lede: (document.querySelector("#view-login .lede") || {}).textContent || "",
  unconfiguredHidden: document.getElementById("auth-unconfigured").classList.contains("hidden"),
  google: !!document.getElementById("auth-google"),
  email: !!document.getElementById("auth-email"),
  hiw: document.querySelectorAll("#view-login:not(.hidden) .hiw-list li").length
}));
console.log("BOOT", boot);
assert(boot.supabase, "supabase-js loaded");
assert(boot.configured, "PadelAuth is configured");
assert(boot.viewLogin && !boot.viewHome && !boot.viewCard, "logged-out home shows the login screen, not the card or editor");
assert(/התחברו כדי ליצור ולשמור את כרטיס השחקן שלכם/.test(boot.lede), "login copy is present: " + boot.lede.trim());
assert(boot.unconfiguredHidden, "unconfigured banner is hidden (keys are set)");
assert(boot.google && boot.email, "Google and email controls are present");
assert(boot.hiw === 5, "how-it-works steps appear on the login screen");
await snap(page, "v15-login.png");

await page.fill("#auth-email", EMAIL);
await page.click("#auth-email-submit");
let reachedOtp = false;
try {
  await page.waitForFunction(() => {
    const otp = document.getElementById("auth-step-otp");
    const err = document.getElementById("auth-error");
    const otpVisible = otp && !otp.classList.contains("hidden");
    const errVisible = err && !err.classList.contains("hidden") && (err.textContent || "").trim();
    return otpVisible || errVisible;
  }, { timeout: 25000 });
} catch (e) {
  console.log("WAIT TIMEOUT for OTP result");
}
reachedOtp = await page.evaluate(() => {
  const otp = document.getElementById("auth-step-otp");
  return !!(otp && !otp.classList.contains("hidden"));
});
const authError = await page.evaluate(() => {
  const err = document.getElementById("auth-error");
  return (err && !err.classList.contains("hidden")) ? (err.textContent || "").trim() : "";
});
const otpCalls = otpReqs.filter((r) => /\/auth\/v1\/otp\b/.test(r.url) && r.method === "POST");
console.log("OTP OUTCOME", { reachedOtp, authError, otpCalls: otpCalls.length, pageErrors });
assert(otpCalls.length >= 1 || authError, "a real OTP request was sent, or an error was shown");
if (reachedOtp) {
  const boxes = await page.evaluate(() => document.querySelectorAll(".otp-digit").length);
  assert(boxes === 6, "six OTP boxes");
  await snap(page, "v15-otp.png");
} else {
  await snap(page, "v15-login-error.png");
  if (authError) console.log("SUPABASE/UI ERROR (acceptable if rate-limit/invalid):", authError);
}
assert(pageErrors.length === 0, "no JS page errors: " + pageErrors.join(" | "));

// Visitor demo card (no login)
const visitorCtx = await browser.newContext(DEVICE);
const visitor = await visitorCtx.newPage();
const visitorErrors = [];
visitor.on("pageerror", (e) => visitorErrors.push(e.message));
await visitor.goto(BASE + "#/demo/michal", { waitUntil: "networkidle" });
await visitor.waitForSelector("#view-card:not(.hidden) .ut-card");
const v = await visitor.evaluate(() => ({
  viewCard: !document.getElementById("view-card").classList.contains("hidden"),
  viewLogin: !document.getElementById("view-login").classList.contains("hidden"),
  name: ((document.querySelector("#card-root .ut-name") || document.querySelector("#card-root h1") || {}).textContent || "").trim(),
  quiz: (document.querySelector("#card-root .ut-rating-line") || {}).textContent || "",
  ai: (document.querySelector("#card-root .ut-ai-line") || {}).textContent || "",
  owner: document.getElementById("owner-actions") && !document.getElementById("owner-actions").classList.contains("hidden")
}));
console.log("VISITOR DEMO", v);
assert(v.viewCard && !v.viewLogin, "visitor opening a demo card is not forced to log in");
assert(/מיכל/.test(v.name), "visitor sees the shared card content: " + v.name);
assert(!v.owner, "visitor does not see owner edit actions on a demo card");
assert(visitorErrors.length === 0, "no JS errors on visitor card: " + visitorErrors.join(" | "));
await snap(visitor, "v15-visitor-demo.png");
await visitorCtx.close();

// Gated owner routes
const gateCtx = await browser.newContext(DEVICE);
const gate = await gateCtx.newPage();
await gate.goto(BASE + "#/quiz", { waitUntil: "networkidle" });
await gate.waitForSelector("#view-login:not(.hidden)");
const gated = await gate.evaluate(() => ({
  login: !document.getElementById("view-login").classList.contains("hidden"),
  quiz: !document.getElementById("view-quiz").classList.contains("hidden")
}));
assert(gated.login && !gated.quiz, "logged-out /#/quiz is gated by the login screen");
await gateCtx.close();

await browser.close();
if (failures.length) {
  console.error("\n" + failures.length + " FAILURES");
  failures.forEach((f) => console.error(" -", f));
  process.exit(1);
}
console.log("\nALL V15 AUTH GATE TESTS PASSED");
