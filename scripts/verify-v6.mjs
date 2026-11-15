import puppeteer from "/tmp/pw/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:8765/";
const OUT = "/workspace/padel-card/screens";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const PHOTO = "/tmp/padel-large-photo.jpg";

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

function publicIdFromUrl(url) {
  if (!url) return "";
  const marker = "/image/upload/";
  const i = url.indexOf(marker);
  if (i < 0) return "";
  let rest = url.slice(i + marker.length).split("?")[0];
  rest = rest.replace(/^v\d+\//, "");
  rest = rest.replace(/\.[a-z0-9]+$/i, "");
  return rest;
}

const pageErrors = [];

async function inspect(page) {
  return page.evaluate(() => {
    const vis = (el) => !!(el && !el.classList.contains("hidden") && el.offsetParent !== null);
    const visibleRoot = document.querySelector(".view:not(.hidden)") || document.body;
    const img = visibleRoot.querySelector(".ut-hero-img");
    const box = img ? img.getBoundingClientRect() : null;
    const prompt = document.getElementById("photo-quality-prompt");
    const stored = JSON.parse(localStorage.getItem("padelCard.v2") || "{}");
    return {
      view: visibleRoot.id || "",
      viewCard: vis(document.getElementById("view-card")),
      ownerBar: vis(document.getElementById("owner-actions")),
      copyOwn: vis(document.getElementById("copy-own-link")),
      localActions: vis(document.getElementById("local-card-actions")),
      prompt: !!(prompt && vis(prompt)),
      promptText: prompt ? (prompt.innerText || "").replace(/\s+/g, " ").trim() : "",
      name: document.querySelector(".ut-id h1")?.textContent.trim() || "",
      toast: document.getElementById("toast")?.textContent.trim() || "",
      progressLabel: document.getElementById("photo-upload-progress-label")?.textContent || "",
      cardProgress: document.getElementById("card-photo-upload-progress-label")?.textContent || "",
      photo: img ? {
        src: img.currentSrc || img.src || "",
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        complete: img.complete,
        displayW: box.width,
        displayH: box.height
      } : null,
      storedPhoto: (stored.profile && stored.profile.photo) || stored.photo || ""
    };
  });
}

async function waitForPhoto(page, timeout = 25000) {
  await page.waitForFunction(() => {
    const img = document.querySelector("#view-card:not(.hidden) .ut-hero-img");
    const hero = document.querySelector("#view-card:not(.hidden) .ut-hero");
    return !!(img && img.complete && img.naturalWidth > 0 && hero && hero.classList.contains("is-ready"));
  }, { timeout });
}

async function snapViewport(page, name) {
  await page.evaluate(() => document.getElementById("toast")?.classList.remove("show"));
  await page.mouse.move(0, 0);
  await new Promise((r) => setTimeout(r, 250));
  const dest = path.join(OUT, name);
  await page.screenshot({ path: dest, fullPage: false });
  console.log("SNAP", dest);
  return dest;
}

async function newMobilePage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  page.setDefaultTimeout(40000);
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push("console: " + msg.text());
  });
  return page;
}

async function seedOwnerWithLegacyPhoto(page, photo) {
  await page.evaluate((photo) => {
    const profile = {
      id: "local-tal-test",
      name: "טל גלעד",
      gender: "male",
      age: "36",
      hand: "right",
      side: "right",
      competitor: "no",
      hasPartner: "no",
      partnerId: null,
      photo,
      region: "center",
      courts: ["הוד השרון"],
      frequency: "2-3",
      tenure: "2plus",
      style: "both",
      shots: ["smash"]
    };
    const payload = {
      levelId: "A2",
      profile,
      answers: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      videos: []
    };
    localStorage.setItem("padelCard.v2", JSON.stringify(payload));
  }, photo);
}

async function makeLegacyDataUrl(page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 220;
    canvas.height = 220;
    const ctx = canvas.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 220, 220);
    g.addColorStop(0, "#4a6a50");
    g.addColorStop(1, "#1a2a20");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 220, 220);
    ctx.fillStyle = "#d8c4a8";
    ctx.beginPath();
    ctx.arc(110, 88, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2a3a30";
    ctx.fillRect(60, 140, 100, 70);
    return canvas.toDataURL("image/jpeg", 0.55);
  });
}

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const stat = fs.statSync(PHOTO);
console.log("TEST PHOTO", PHOTO, stat.size, "bytes", (stat.size / 1024 / 1024).toFixed(2), "MB");
assert(stat.size >= 6 * 1024 * 1024, "test JPEG is at least ~6MB, got " + stat.size);
assert(stat.size <= 12 * 1024 * 1024, "test JPEG is under 12MB so the old limit wouldn't be the only issue, got " + stat.size);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"]
});

const publicIds = [];

// ---------- 1. Legacy data-URL prompt on the owner's card ----------
const page = await newMobilePage(browser);
await page.goto(BASE, { waitUntil: "networkidle0" });
const legacyPhoto = await makeLegacyDataUrl(page);
assert(legacyPhoto.startsWith("data:image/jpeg"), "legacy fixture is a JPEG data URL");
await seedOwnerWithLegacyPhoto(page, legacyPhoto);
await page.reload({ waitUntil: "networkidle0" });
await page.goto(BASE + "#/card", { waitUntil: "networkidle0" });
await page.waitForSelector("#view-card:not(.hidden) .ut-card");
await waitForPhoto(page);
await page.evaluate(() => document.fonts && document.fonts.ready);
await new Promise((r) => setTimeout(r, 400));

const legacy = await inspect(page);
console.log("LEGACY", JSON.stringify({ ...legacy, storedPhoto: (legacy.storedPhoto || "").slice(0, 60) }, null, 2));
assert(legacy.viewCard, "owner is on the card view");
assert(legacy.name === "טל גלעד", "owner card shows the seeded name, got " + legacy.name);
assert(legacy.prompt, "owner with a data-URL photo sees the re-upload prompt");
assert(legacy.promptText.includes("התמונה ישנה ובאיכות נמוכה"), "prompt has the Hebrew copy, got " + legacy.promptText);
assert(legacy.promptText.includes("העלה מחדש לתמונה חדה"), "prompt asks the owner to re-upload");
assert(await page.$("#card-photo-file"), "prompt has an upload file input");
assert(legacy.photo && (legacy.photo.src || "").startsWith("data:"), "hero is still the legacy data URL before re-upload");

await snapViewport(page, "reupload-prompt.png");

// ---------- 2. Upload the large JPEG through the card file input ----------
const cardInput = await page.$("#card-photo-file");
assert(!!cardInput, "card photo file input exists");

const progressSeen = [];
await page.exposeFunction("reportProgress", (label) => progressSeen.push(label));
await page.evaluate(() => {
  const hook = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const obs = new MutationObserver(() => window.reportProgress(el.textContent || ""));
    obs.observe(el, { characterData: true, childList: true, subtree: true });
  };
  hook("card-photo-upload-progress-label");
  hook("photo-upload-progress-label");
});

await cardInput.uploadFile(PHOTO);

await page.waitForFunction(() => {
  const stored = JSON.parse(localStorage.getItem("padelCard.v2") || "{}");
  const photo = (stored.profile && stored.profile.photo) || "";
  const img = document.querySelector("#view-card:not(.hidden) .ut-hero-img");
  const prompt = document.getElementById("photo-quality-prompt");
  return /^https:\/\/res\.cloudinary\.com\//.test(photo)
    && img && img.complete && img.naturalWidth >= 1200
    && (img.currentSrc || img.src || "").includes("w_1290")
    && !prompt;
}, { timeout: 60000 });

const afterUpload = await inspect(page);
console.log("AFTER UPLOAD", JSON.stringify({
  ...afterUpload,
  storedPhoto: afterUpload.storedPhoto,
  progressSeen
}, null, 2));

assert(/^https:\/\/res\.cloudinary\.com\/jgreas8e\/image\/upload\//.test(afterUpload.storedPhoto), "localStorage stores a Cloudinary image URL");
assert(/padel-card\/photos\//.test(afterUpload.storedPhoto), "upload landed in folder padel-card/photos, got " + afterUpload.storedPhoto);
assert(!/f_auto|w_1290/.test(afterUpload.storedPhoto), "stored URL is the raw Cloudinary URL without display transforms");
assert(afterUpload.photo && /w_1290/.test(afterUpload.photo.src), "hero renders a Cloudinary URL with w_1290, got " + (afterUpload.photo && afterUpload.photo.src));
assert(/f_auto,q_auto,c_fill,g_face,w_1290,h_1200/.test(afterUpload.photo.src), "hero uses the 3x display transform");
assert(afterUpload.photo.naturalWidth >= 1200, "hero natural width is crisp, got " + afterUpload.photo.naturalWidth);
assert(!afterUpload.prompt, "re-upload prompt is gone after a successful Cloudinary upload");
assert(progressSeen.some((s) => /מכין את התמונה|מעלה תמונה/.test(s)), "visible progress mentioned preparing or uploading, got " + JSON.stringify(progressSeen));

const id1 = publicIdFromUrl(afterUpload.storedPhoto);
assert(id1.indexOf("padel-card/photos/") === 0, "public_id is under padel-card/photos, got " + id1);
publicIds.push(id1);
console.log("PUBLIC_ID_CARD_INPUT", id1);

// ---------- 3. Profile-form path with the same large JPEG (fresh profile) ----------
const formPage = await newMobilePage(browser);
await formPage.goto(BASE, { waitUntil: "networkidle0" });
await formPage.evaluate(() => localStorage.clear());
await seedOwnerWithLegacyPhoto(formPage, "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==");
await formPage.reload({ waitUntil: "networkidle0" });
await formPage.goto(BASE + "#/profile", { waitUntil: "networkidle0" });
await formPage.waitForSelector("#view-profile:not(.hidden) #photo-file");

const formInput = await formPage.$("#photo-file");
assert(!!formInput, "profile photo file input exists");
await formInput.uploadFile(PHOTO);
await formPage.waitForFunction(() => {
  const img = document.getElementById("photo-img");
  const src = (img && (img.currentSrc || img.src)) || "";
  const stored = JSON.parse(localStorage.getItem("padelCard.v2") || "{}");
  const photo = (stored.profile && stored.profile.photo) || "";
  return src.includes("res.cloudinary.com") && /^https:\/\/res\.cloudinary\.com\//.test(photo);
}, { timeout: 60000 });

const formStored = await formPage.evaluate(() => {
  const stored = JSON.parse(localStorage.getItem("padelCard.v2") || "{}");
  const img = document.getElementById("photo-img");
  return {
    photo: (stored.profile && stored.profile.photo) || "",
    preview: (img && (img.currentSrc || img.src)) || ""
  };
});
console.log("FORM UPLOAD", formStored.photo, formStored.preview.slice(0, 160));
assert(/padel-card\/photos\//.test(formStored.photo), "profile-form upload also landed in padel-card/photos");
assert(/w_384/.test(formStored.preview), "profile preview uses the thumb transform");
const id2 = publicIdFromUrl(formStored.photo);
publicIds.push(id2);
console.log("PUBLIC_ID_FORM_INPUT", id2);
assert(id2 !== id1, "second upload created a distinct public_id");

await formPage.goto(BASE + "#/card", { waitUntil: "networkidle0" });
await waitForPhoto(formPage);
const formCard = await inspect(formPage);
assert(/w_1290/.test(formCard.photo.src), "after profile-form upload, the card hero uses w_1290");
assert(!formCard.prompt, "sharp Cloudinary photo does not show the re-upload prompt");

// ---------- 4. Non-owner never sees the prompt, even with a data-URL photo ----------
const visitor = await newMobilePage(browser);
await visitor.goto(BASE, { waitUntil: "networkidle0" });
await visitor.evaluate(() => localStorage.clear());
const staleUrl = BASE + "#/p/" + toBase64Url(JSON.stringify({
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
  z: "north",
  ph: legacyPhoto
}));
await visitor.goto(staleUrl, { waitUntil: "networkidle0" });
await visitor.waitForSelector("#view-card:not(.hidden) .ut-hero-img");
await waitForPhoto(visitor);
const org = await inspect(visitor);
console.log("VISITOR", { prompt: org.prompt, name: org.name, ownerBar: org.ownerBar });
assert(org.name === "דני ישן", "visitor sees the shared card");
assert(!org.prompt, "non-owner does not see the re-upload prompt");
assert(!org.ownerBar && !org.copyOwn, "non-owner does not see owner controls");

// ---------- 5. Cache-busting query strings are present ----------
const assets = await page.evaluate(() => ({
  scripts: [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")),
  styles: [...document.querySelectorAll("link[rel='stylesheet']")].map((s) => s.getAttribute("href"))
}));
console.log("ASSETS", assets);
["app.js", "quiz.js", "players.js"].forEach((name) => {
  assert(assets.scripts.some((s) => s === name + "?v=6"), name + " has ?v=6 cache buster, got " + assets.scripts.join(", "));
});
["styles.css", "cards.css"].forEach((name) => {
  assert(assets.styles.some((s) => s === name + "?v=6"), name + " has ?v=6 cache buster, got " + assets.styles.join(", "));
});

await browser.close();

console.log("\nPUBLIC_IDS");
publicIds.forEach((id) => console.log(" -", id));

if (pageErrors.length) {
  console.log("PAGE_ERRORS");
  pageErrors.forEach((e) => console.log(" ", e));
}

if (failures.length) {
  console.error("\n" + failures.length + " FAILURES");
  failures.forEach((f) => console.error(" -", f));
  process.exit(1);
}
console.log("\nALL TESTS PASSED");
