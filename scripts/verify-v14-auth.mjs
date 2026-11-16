// v14 — login screen + real email OTP request to Supabase (no mock).
// Needs: static site :8766 (python3 -m http.server 8870 --directory /workspace/padel-card-v14 --bind 127.0.0.1)
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "fs";

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
const mobile = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: "he-IL",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
};

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
const ctx = await browser.newContext(mobile);
const page = await ctx.newPage();
page.on("pageerror", (e) => {
  pageErrors.push(e.message);
  console.log("PAGEERROR", e.message);
});
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("CONSOLEERROR", msg.text());
});

const otpReqs = [];
page.on("request", (r) => {
  const u = r.url();
  if (/supabase\.co\/auth\/v1\//.test(u)) {
    console.log("AUTH REQ", r.method(), u);
  }
});
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
await page.waitForSelector("#home-login-btn");
const boot = await page.evaluate(() => ({
  supabase: !!(window.supabase && window.supabase.createClient),
  configured: !!(window.PadelAuth && PadelAuth.isConfigured()),
  cfgUrl: window.PadelConfig && window.PadelConfig.SUPABASE_URL,
  keyPrefix: String((window.PadelConfig && window.PadelConfig.SUPABASE_ANON_KEY) || "").slice(0, 16),
  viewHome: !document.getElementById("view-home").classList.contains("hidden"),
  hiw: !!document.getElementById("hiw-title"),
  loginLabel: (document.getElementById("home-login-btn") || {}).textContent
}));
console.log("BOOT", boot);
assert(boot.supabase, "supabase-js loaded (window.supabase.createClient)");
assert(boot.configured, "PadelAuth is configured");
assert(boot.viewHome, "home is visible without login");
assert(boot.hiw, "v13 'how it works' section is present on home");
assert(/התחברות/.test(boot.loginLabel || ""), "home has a login button");
await snap(page, "home.png");

await page.click("#home-login-btn");
await page.waitForSelector("#view-login:not(.hidden)");
await page.waitForTimeout(400);
const loginUI = await page.evaluate(() => ({
  viewLogin: !document.getElementById("view-login").classList.contains("hidden"),
  methods: !document.getElementById("auth-step-methods").classList.contains("hidden"),
  otpHidden: document.getElementById("auth-step-otp").classList.contains("hidden"),
  unconfiguredHidden: document.getElementById("auth-unconfigured").classList.contains("hidden"),
  google: !!document.getElementById("auth-google"),
  email: !!document.getElementById("auth-email"),
  title: (document.querySelector("#view-login h1") || {}).textContent
}));
console.log("LOGIN UI", loginUI);
assert(loginUI.viewLogin && loginUI.methods && loginUI.otpHidden, "login methods screen is open");
assert(loginUI.unconfiguredHidden, "unconfigured banner is hidden (keys are set)");
assert(loginUI.google && loginUI.email, "Google and email controls are present");
await snap(page, "login.png");

await page.fill("#auth-email", EMAIL);
const before = otpReqs.length;
await page.click("#auth-email-submit");

// Wait for a real Supabase OTP call (or an in-page error)
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
assert(otpCalls.length >= 1 || authError, "a real OTP request was sent, or Supabase/client surfaced an error");
if (otpCalls.length) {
  console.log("OTP STATUS", otpCalls[0].status, otpCalls[0].body);
}

if (reachedOtp) {
  const otpUI = await page.evaluate(() => ({
    email: (document.getElementById("auth-otp-email") || {}).textContent,
    boxes: document.querySelectorAll(".otp-digit").length,
    firstAuto: document.querySelector('.otp-digit[data-otp-index="0"]').getAttribute("autocomplete"),
    othersAuto: [...document.querySelectorAll('.otp-digit')].slice(1).map((el) => el.getAttribute("autocomplete"))
  }));
  console.log("OTP UI", otpUI);
  assert(otpUI.boxes === 6, "six OTP boxes");
  assert(otpUI.firstAuto === "one-time-code", "first box has autocomplete=one-time-code");
  assert(otpUI.email && otpUI.email.includes("test+padel@example.com") || (otpUI.email || "").includes(EMAIL.split("@")[0]), "OTP screen shows the email");
  await snap(page, "otp.png");
} else {
  console.log("Did not reach OTP screen; capturing login-error state");
  await snap(page, "login-error.png");
  // Parent said rate-limit / invalid email is fine — do not fail the suite for that alone
  if (authError) console.log("SUPABASE/UI ERROR (acceptable if rate-limit/invalid):", authError);
}

assert(pageErrors.length === 0, "no JS page errors: " + pageErrors.join(" | "));

// Visitor shared card is not gated by login
const visitorCtx = await browser.newContext(mobile);
const visitor = await visitorCtx.newPage();
const visitorErrors = [];
visitor.on("pageerror", (e) => visitorErrors.push(e.message));
await visitor.goto(BASE + "#/demo/michal", { waitUntil: "networkidle" });
await visitor.waitForSelector("#view-card:not(.hidden) .ut-card");
const v = await visitor.evaluate(() => ({
  viewCard: !document.getElementById("view-card").classList.contains("hidden"),
  viewLogin: !document.getElementById("view-login").classList.contains("hidden"),
  name: ((document.querySelector("#card-root .ut-name") || document.querySelector("#card-root h1") || {}).textContent || "").trim()
}));
console.log("VISITOR", v);
assert(v.viewCard && !v.viewLogin, "visitor opening a shared card is not forced to log in");
assert(/מיכל/.test(v.name), "visitor sees the shared card content: " + v.name);
assert(visitorErrors.length === 0, "no JS errors on visitor card: " + visitorErrors.join(" | "));
await visitorCtx.close();

await browser.close();

const report = {
  email: EMAIL,
  reachedOtp,
  authError: authError || null,
  otpCalls: otpCalls.map((r) => ({ status: r.status, url: r.url, body: r.body })),
  pageErrors,
  shots: fs.readdirSync(SHOTS).filter((n) => /^(home|login|otp|login-error)\.png$/.test(n))
};
console.log("REPORT", JSON.stringify(report, null, 2));

if (failures.length) {
  console.error("\n" + failures.length + " FAILURES");
  failures.forEach((f) => console.error(" -", f));
  process.exit(1);
}
console.log("\nALL V14 AUTH TESTS PASSED");
