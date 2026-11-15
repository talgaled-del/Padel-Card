import puppeteer from "/tmp/pw/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:8765/";
const OUT = "/workspace/padel-card/screens";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const PHOTO = "/tmp/padel-sharp-photo.jpg";

fs.mkdirSync(OUT, { recursive: true });

const failures = [];
function assert(cond, msg) {
  if (!cond) {
    failures.push(msg);
    console.error("FAIL", msg);
  } else {
    console.log("OK  ", msg);
  }
}

function visCheck() {
  return `(() => {
    const vis = (el) => !!(el && !el.classList.contains("hidden") && el.offsetParent !== null);
    const visibleRoot = document.querySelector(".view:not(.hidden)") || document.body;
    const text = (visibleRoot.innerText || "").replace(/\\s+/g, " ");
    const img = visibleRoot.querySelector(".ut-hero-img");
    const box = img ? img.getBoundingClientRect() : null;
    return {
      view: visibleRoot.id || "",
      viewCard: vis(document.getElementById("view-card")),
      ownerBar: vis(document.getElementById("owner-actions")),
      copyOwn: vis(document.getElementById("copy-own-link")),
      localActions: vis(document.getElementById("local-card-actions")),
      fallback: vis(document.getElementById("link-fallback")),
      toast: document.getElementById("toast")?.textContent.trim() || "",
      toastShown: document.getElementById("toast")?.classList.contains("show") || false,
      name: document.querySelector(".ut-id h1")?.textContent.trim() || "",
      photo: img ? {
        src: img.currentSrc || img.src || "",
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        complete: img.complete,
        displayW: box.width,
        displayH: box.height
      } : null,
      storedPhoto: (JSON.parse(localStorage.getItem("padelCard.v2") || "{}").profile || {}).photo || "",
      text
    };
  })()`;
}

async function inspect(page) {
  return page.evaluate(new Function("return " + visCheck()));
}

async function waitForPhoto(page, timeout = 25000) {
  await page.waitForFunction(() => {
    const img = document.querySelector("#view-card:not(.hidden) .ut-hero-img");
    const hero = document.querySelector("#view-card:not(.hidden) .ut-hero");
    return !!(img && img.complete && img.naturalWidth > 0 && hero && hero.classList.contains("is-ready"));
  }, { timeout });
}

async function snap(page, name) {
  await page.evaluate(() => document.getElementById("toast")?.classList.remove("show"));
  await page.mouse.move(0, 0);
  await new Promise((r) => setTimeout(r, 200));
  const dest = path.join(OUT, name);
  await page.screenshot({ path: dest, fullPage: true });
  console.log("SNAP", dest);
  return dest;
}

function hookClipboard(page, { fail = false } = {}) {
  return page.evaluate((fail) => {
    window.__copied = null;
    window.__clipboardCalls = 0;
    if (!navigator.clipboard) {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {} });
    }
    navigator.clipboard.writeText = (text) => {
      window.__clipboardCalls += 1;
      if (fail) return Promise.reject(new Error("clipboard-blocked"));
      window.__copied = text;
      return Promise.resolve();
    };
  }, fail);
}

function hookExecFail(page) {
  return page.evaluate(() => {
    window.__execCalls = 0;
    const orig = document.execCommand.bind(document);
    document.execCommand = (cmd, ...rest) => {
      window.__execCalls += 1;
      if (cmd === "copy") return false;
      return orig(cmd, ...rest);
    };
  });
}

async function newMobilePage(browser, { dpr = 3 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  page.setDefaultTimeout(30000);
  return page;
}

async function completeQuiz(page) {
  await page.waitForSelector("#view-quiz:not(.hidden) .option");
  const total = await page.evaluate(() => window.PadelQuiz.QUESTIONS.length);
  for (let i = 0; i < total; i++) {
    await page.waitForSelector("#view-quiz:not(.hidden) .option");
    const step = await page.$eval("#quiz-step", (el) => el.textContent.trim());
    const options = await page.$$("#view-quiz:not(.hidden) .option");
    assert(options.length >= 3, "quiz question " + (i + 1) + " has options");
    await options[Math.min(2, options.length - 1)].click();
    if (i < total - 1) {
      await page.waitForFunction((prev) => {
        const el = document.getElementById("quiz-step");
        return el && el.textContent.trim() !== prev;
      }, {}, step);
    }
  }
  await page.waitForSelector("#view-result:not(.hidden) #goto-profile");
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"]
});

const context = browser.defaultBrowserContext();
await context.overridePermissions("http://127.0.0.1:8765", ["clipboard-read", "clipboard-write"]);

const pageErrors = [];

// ---------- Full real flow: quiz → profile → photo upload → card ----------
const page = await newMobilePage(browser);
page.on("pageerror", (err) => pageErrors.push("flow: " + err));
page.on("console", (msg) => {
  if (msg.type() === "error") pageErrors.push("console: " + msg.text());
});

await page.goto(BASE, { waitUntil: "networkidle0" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle0" });

await page.click("#start-quiz");
await completeQuiz(page);
await page.click("#goto-profile");
await page.waitForSelector("#view-profile:not(.hidden) #name");

await page.type("#name", "טל בדיקה");
await page.type("#age", "29");
await page.click('input[name="gender"][value="male"]');
await page.click('input[name="hand"][value="right"]');
await page.click('input[name="side"][value="left"]');
await page.click('input[name="competitor"][value="no"]');
await page.select("#region", "telaviv");
await page.click('input[name="frequency"][value="2-3"]');
await page.click('input[name="tenure"][value="1-2"]');
await page.click('input[name="style"][value="both"]');
await page.click('input[name="hasPartner"][value="no"]');

const photoInput = await page.$("#photo-file");
assert(!!photoInput, "photo file input exists");
await photoInput.uploadFile(PHOTO);

await page.waitForFunction(() => {
  const img = document.getElementById("photo-img");
  const src = img && (img.currentSrc || img.src) || "";
  return !!img && img.complete && img.naturalWidth > 0 && (src.includes("res.cloudinary.com") || src.startsWith("data:image"));
}, { timeout: 30000 });

const preview = await page.evaluate(() => {
  const img = document.getElementById("photo-img");
  return { src: img.currentSrc || img.src, w: img.naturalWidth, h: img.naturalHeight };
});
console.log("PREVIEW", preview.src.slice(0, 160), preview.w, preview.h);
assert(preview.src.includes("res.cloudinary.com") && preview.src.includes("/image/upload/"), "preview uses a Cloudinary image URL");
assert(/f_auto,q_auto,c_fill,g_face,w_384,h_384/.test(preview.src), "preview URL has f_auto,q_auto,c_fill,g_face thumb transform, got " + preview.src);
assert(preview.w >= 384 && preview.h >= 384, "preview bitmap is at least 384px, got " + preview.w + "x" + preview.h);

await hookClipboard(page);
await page.click("#profile-form button[type='submit']");
await page.waitForSelector("#view-card:not(.hidden) .ut-card");
await waitForPhoto(page);
await page.evaluate(() => document.fonts && document.fonts.ready);
await new Promise((r) => setTimeout(r, 400));

const owner = await inspect(page);
console.log("OWNER", JSON.stringify({ ...owner, text: undefined, storedPhoto: (owner.storedPhoto || "").slice(0, 120) }, null, 2));
assert(owner.viewCard, "owner is on card view after the real quiz→profile flow");
assert(owner.name === "טל בדיקה", "owner card shows the entered name, got " + owner.name);
assert(owner.ownerBar && owner.copyOwn, "owner sees העתק קישור after creating a card");
assert(owner.localActions, "owner sees local edit actions on the live card");
assert(owner.photo, "hero photo is present");
assert(owner.photo.src.includes("res.cloudinary.com"), "hero src is a Cloudinary URL");
assert(/f_auto,q_auto,c_fill,g_face,w_1290,h_1200/.test(owner.photo.src), "hero URL uses 3x display transform, got " + owner.photo.src);
assert(owner.photo.naturalWidth >= 1200 && owner.photo.naturalHeight >= 1100, "hero natural size is crisp (≥1200px), got " + owner.photo.naturalWidth + "x" + owner.photo.naturalHeight);
assert(owner.photo.displayW >= 350 && owner.photo.displayH >= 350, "hero is displayed at card size");
assert(/^https:\/\/res\.cloudinary\.com\/jgreas8e\/image\/upload\/v\d+\//.test(owner.storedPhoto) && !/f_auto/.test(owner.storedPhoto), "localStorage stores the raw Cloudinary URL without transforms");

await snap(page, "photo-sharp.png");

// Copy link — clipboard API success path
await hookClipboard(page);
await page.click("#copy-own-link");
await page.waitForFunction(() => document.getElementById("toast")?.classList.contains("show"));
const copied = await page.evaluate(() => ({
  toast: document.getElementById("toast")?.textContent.trim() || "",
  url: window.__copied || "",
  calls: window.__clipboardCalls || 0
}));
console.log("COPY", copied.toast, copied.url.slice(0, 100), "len=" + copied.url.length);
assert(copied.toast === "הקישור הועתק", "toast says הקישור הועתק, got " + copied.toast);
assert(copied.calls >= 1, "clipboard.writeText was called from the click handler");
assert(/#\/p\//.test(copied.url), "copied URL is a single card share link");
assert(copied.url.length < 4000, "copied URL is short now that the photo is a Cloudinary URL, len=" + copied.url.length);

const payload = await page.evaluate((url) => {
  const hash = url.split("#")[1] || "";
  const rawPart = hash.split("/").filter(Boolean)[1];
  const pad = rawPart.length % 4 === 0 ? "" : "=".repeat(4 - (rawPart.length % 4));
  const b64 = rawPart.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}, copied.url);
console.log("PAYLOAD photo", (payload.ph || "").slice(0, 140));
assert(payload.n === "טל בדיקה", "share payload has the player name");
assert(/^https:\/\/res\.cloudinary\.com\//.test(payload.ph || ""), "share payload embeds the Cloudinary photo URL");
assert(!String(payload.ph || "").startsWith("data:"), "share payload does not embed a data URL");

// Owner opening their own shared link still sees copy
await page.goto(copied.url, { waitUntil: "networkidle0" });
await page.waitForSelector("#view-card:not(.hidden) .ut-card");
await waitForPhoto(page);
const ownLink = await inspect(page);
assert(ownLink.copyOwn && ownLink.ownerBar, "owner opening their shared link still sees copy");
assert(!ownLink.localActions, "snapshot link does not show live edit actions");
assert(/w_1290,h_1200/.test(ownLink.photo.src), "shared-link hero still uses the sharp transform");

// Clipboard rejection — sync fallback should still succeed in Chromium
const failPage = await newMobilePage(browser);
failPage.on("pageerror", (err) => pageErrors.push("fail: " + err));
await failPage.goto(BASE, { waitUntil: "networkidle0" });
await failPage.evaluate(() => {
  // keep the already-saved card from the same origin? this is a new page, storage is shared per origin in same context? 
  // Puppeteer pages share the default context, so localStorage persists. Good.
});
await failPage.goto(BASE + "#/card", { waitUntil: "networkidle0" });
await failPage.waitForSelector("#view-card:not(.hidden) #copy-own-link");
await hookClipboard(failPage, { fail: true });
await failPage.click("#copy-own-link");
await failPage.waitForFunction(() => document.getElementById("toast")?.classList.contains("show") || document.getElementById("link-fallback") && !document.getElementById("link-fallback").classList.contains("hidden"));
const afterFail = await failPage.evaluate(() => ({
  toast: document.getElementById("toast")?.textContent.trim() || "",
  toastShown: document.getElementById("toast")?.classList.contains("show") || false,
  fallback: !document.getElementById("link-fallback").classList.contains("hidden"),
  fallbackValue: document.getElementById("link-fallback-input")?.value || "",
  calls: window.__clipboardCalls || 0
}));
console.log("COPY FAIL PATH", afterFail);
assert(afterFail.calls >= 1, "fail path still called writeText synchronously in the click handler");
assert(afterFail.toast === "הקישור הועתק" || afterFail.fallback, "when clipboard rejects, sync fallback copies or the manual prompt appears");

// Both clipboard and execCommand fail → manual reveal
const revealPage = await newMobilePage(browser);
revealPage.on("pageerror", (err) => pageErrors.push("reveal: " + err));
await revealPage.goto(BASE + "#/card", { waitUntil: "networkidle0" });
await revealPage.waitForSelector("#view-card:not(.hidden) #copy-own-link");
await hookClipboard(revealPage, { fail: true });
await hookExecFail(revealPage);
await revealPage.evaluate(() => { try { delete navigator.share; } catch (e) { navigator.share = undefined; } });
await revealPage.click("#copy-own-link");
await revealPage.waitForFunction(() => !document.getElementById("link-fallback").classList.contains("hidden"));
const revealed = await revealPage.evaluate(() => ({
  shown: !document.getElementById("link-fallback").classList.contains("hidden"),
  value: document.getElementById("link-fallback-input")?.value || ""
}));
console.log("REVEAL", revealed.shown, revealed.value.slice(0, 80));
assert(revealed.shown && /#\/p\//.test(revealed.value), "final fallback shows a selectable share link");
await revealPage.click("#link-fallback-close");
await revealPage.waitForFunction(() => document.getElementById("link-fallback").classList.contains("hidden"));

// Organizer / visitor does not see copy
const organizer = await newMobilePage(browser);
organizer.on("pageerror", (err) => pageErrors.push("organizer: " + err));
await organizer.goto(BASE, { waitUntil: "networkidle0" });
await organizer.evaluate(() => localStorage.clear());
await organizer.reload({ waitUntil: "networkidle0" });
await organizer.goto(copied.url, { waitUntil: "networkidle0" });
await organizer.waitForSelector("#view-card:not(.hidden) .ut-card");
await waitForPhoto(organizer);
const org = await inspect(organizer);
assert(org.name === "טל בדיקה", "organizer sees the created card");
assert(!org.ownerBar && !org.copyOwn && !org.localActions, "organizer does not see copy/owner controls");
assert(/w_1290,h_1200/.test(org.photo.src), "organizer also gets the sharp Cloudinary transform");
assert(org.photo.naturalWidth >= 1200, "organizer hero is sharp");

// Old data-URL cards still render
const stalePhoto = await organizer.evaluate(() => {
  const canvas = document.createElement("canvas");
  canvas.width = 220;
  canvas.height = 220;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1a3a30";
  ctx.fillRect(0, 0, 220, 220);
  ctx.fillStyle = "#c8ff3c";
  ctx.font = "bold 64px sans-serif";
  ctx.fillText("ישן", 40, 130);
  return canvas.toDataURL("image/jpeg", 0.6);
});
const staleUrl = await organizer.evaluate((photo) => {
  function toBase64Url(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  const raw = {
    id: "stale-old-photo",
    n: "דני ישן",
    g: "male",
    a: 33,
    h: "right",
    s: "right",
    c: "yes",
    lv: "B1",
    sc: 34,
    v: [],
    hp: "no",
    z: "haifa",
    ph: photo
  };
  return location.origin + location.pathname + "#/p/" + toBase64Url(JSON.stringify(raw));
}, stalePhoto);
await organizer.goto(staleUrl, { waitUntil: "networkidle0" });
await organizer.waitForSelector("#view-card:not(.hidden) .ut-hero-img");
await waitForPhoto(organizer);
const stale = await inspect(organizer);
assert(stale.name === "דני ישן", "old data-URL card still opens");
assert(stale.photo && stale.photo.src.startsWith("data:image"), "old data-URL photo still displays");
assert(stale.photo.naturalWidth === 220, "old 220px photo keeps its original pixels");
assert(!stale.copyOwn, "old link from someone else has no copy button");

// Fallback compress path when Cloudinary is blocked — still sharp locally
const fallback = await newMobilePage(browser);
fallback.on("pageerror", (err) => pageErrors.push("compress: " + err));
await fallback.goto(BASE, { waitUntil: "networkidle0" });
await fallback.evaluate(() => localStorage.clear());
await fallback.setRequestInterception(true);
fallback.on("request", (req) => {
  if (req.url().includes("api.cloudinary.com") && req.url().includes("/image/upload")) {
    req.abort("failed");
  } else {
    req.continue();
  }
});
await fallback.reload({ waitUntil: "networkidle0" });
await fallback.click("#start-quiz");
await completeQuiz(fallback);
await fallback.click("#goto-profile");
await fallback.waitForSelector("#view-profile:not(.hidden) #name");
await fallback.type("#name", "מאיה גיבוי");
await fallback.type("#age", "31");
await fallback.click('input[name="gender"][value="female"]');
await fallback.click('input[name="hand"][value="right"]');
await fallback.click('input[name="side"][value="either"]');
await fallback.click('input[name="competitor"][value="no"]');
await fallback.click('input[name="hasPartner"][value="no"]');
await (await fallback.$("#photo-file")).uploadFile(PHOTO);
await fallback.waitForFunction(() => {
  const img = document.getElementById("photo-img");
  return !!(img && (img.currentSrc || img.src || "").startsWith("data:image"));
}, { timeout: 30000 });
await fallback.click("#profile-form button[type='submit']");
await fallback.waitForSelector("#view-card:not(.hidden) .ut-hero-img");
await waitForPhoto(fallback);
const fb = await inspect(fallback);
console.log("FALLBACK PHOTO", fb.photo);
assert(fb.copyOwn, "fallback-compress owner still sees copy");
assert(fb.photo && fb.photo.src.startsWith("data:image"), "Cloudinary failure falls back to a data URL");
assert(fb.photo.naturalWidth >= 1000, "fallback data URL is high-resolution, not 220px, got " + (fb.photo && fb.photo.naturalWidth));

if (pageErrors.length) {
  console.error("PAGE ERRORS", pageErrors);
  // Cloudinary abort may log a console error; allow "Failed to load" type errors from the blocked upload
  const unexpected = pageErrors.filter((e) => !/photo upload failed|net::ERR_FAILED|Failed to load|abort/i.test(String(e)));
  if (unexpected.length) failures.push("page errors: " + unexpected.join(" | "));
}

await browser.close();

if (failures.length) {
  console.error("\n" + failures.length + " failure(s):\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
