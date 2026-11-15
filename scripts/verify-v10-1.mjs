import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";

const BASE = "http://127.0.0.1:8765/";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";

const failures = [];
function assert(cond, msg) {
  if (!cond) { failures.push(msg); console.error("FAIL", msg); }
  else console.log("OK  ", msg);
}

const TINY_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

async function seed(page) {
  await page.evaluate((photo) => {
    localStorage.setItem("padelCard.v2", JSON.stringify({
      levelId: "A2",
      profile: {
        id: "local-tal-track",
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
        courts: [],
        frequency: "2-3",
        tenure: "3plus",
        style: "both",
        shots: ["volley"]
      },
      answers: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      videos: []
    }));
  }, TINY_GIF);
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: "he-IL"
});
page.on("pageerror", (err) => {
  console.log("PAGEERROR", err.message);
  failures.push("pageerror: " + err.message);
});

// Stub: metadata never arrives. The app must still upload.
await page.addInitScript(() => {
  window.__padelForceUnknownDuration = true;
});

const uploads = [];
await page.route("https://api.cloudinary.com/**", async (route) => {
  const req = route.request();
  if (req.method() !== "POST") {
    await route.continue();
    return;
  }
  uploads.push({
    url: req.url(),
    resource: /\/video\//.test(req.url()) ? "video" : "other"
  });
  // Small delay so the test can observe the immediate "מכין" state first.
  await new Promise((r) => setTimeout(r, 120));
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      secure_url: "https://res.cloudinary.com/jgreas8e/video/upload/v1/padel-card/videos/test.mp4",
      public_id: "padel-card/videos/test",
      duration: 200,
      bytes: 2048
    })
  });
});

await page.goto(BASE, { waitUntil: "networkidle" });
await seed(page);
await page.reload({ waitUntil: "networkidle" });
await page.goto(BASE + "#/profile", { waitUntil: "networkidle" });
await page.waitForSelector("#view-profile:not(.hidden) label.upload");

// Assets are served from the new versioned folder
const assetHrefs = await page.evaluate(() => ({
  scripts: [...document.querySelectorAll("script[src]")].map((el) => el.getAttribute("src")),
  css: [...document.querySelectorAll("link[rel=stylesheet]")].map((el) => el.getAttribute("href"))
}));
console.log("ASSETS", assetHrefs);
assert(assetHrefs.scripts.some((s) => s.startsWith("v10-1/")), "page loads scripts from v10-1/");
assert(assetHrefs.css.some((s) => s && s.startsWith("v10-1/")), "page loads CSS from v10-1/");

// Tap target is the file input itself; nothing covers the upload control
await page.locator('label.upload[for="video-file"]').scrollIntoViewIfNeeded();
const hit = await page.evaluate(() => {
  const label = document.querySelector('label.upload[for="video-file"]');
  const r = label.getBoundingClientRect();
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  const toast = document.getElementById("toast");
  const toastStyle = toast ? getComputedStyle(toast) : null;
  return {
    tag: el && el.tagName,
    id: el && el.id,
    type: el && el.type,
    accept: el && el.getAttribute("accept"),
    toastPointer: toastStyle && toastStyle.pointerEvents
  };
});
console.log("HIT", hit);
assert(hit.id === "video-file" && hit.type === "file", "upload tap hits the file input, got " + JSON.stringify(hit));
assert(/\.mov/.test(hit.accept || "") && /quicktime/.test(hit.accept || ""), "accept includes .mov and video/quicktime");
assert(hit.toastPointer === "none", "toast does not intercept taps");

// Choose a .mov with an empty MIME type (typical iPhone Camera Roll export)
const before = await page.evaluate(() => {
  const input = document.getElementById("video-file");
  const file = new File([new Uint8Array(2048)], "IMG_1234.mov", { type: "" });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  const wrap = document.getElementById("upload-progress");
  const label = document.getElementById("upload-progress-label");
  return {
    type: file.type,
    name: file.name,
    progressShown: !!(wrap && !wrap.classList.contains("hidden")),
    label: (label && label.textContent) || "",
    filesReset: input.value === "" || input.files.length === 0
  };
});
console.log("IMMEDIATE", before);
assert(before.type === "", "test file has empty MIME type");
assert(before.progressShown, "progress bar is shown immediately after choosing a file");
assert(/מכין את הסרטון/.test(before.label), "immediate label is מכין את הסרטון…, got " + JSON.stringify(before.label));
assert(before.filesReset, "input value is cleared so the same file can be chosen again");

// Wait until the mocked upload finishes (Cloudinary duration 200s > 3 min; must still be kept)
await page.waitForFunction(() => {
  const toast = (document.getElementById("toast") && document.getElementById("toast").textContent) || "";
  const videos = JSON.parse(localStorage.getItem("padelCard.v2") || "{}").videos || [];
  const uploading = document.querySelector(".is-uploading");
  return !uploading && videos.length > 0 && /נשמר בכרטיס|הועלה לכרטיס/.test(toast);
}, { timeout: 8000 });

// Close the track picker if it opened on the fake URL
await page.evaluate(() => {
  const skip = document.getElementById("track-picker-skip");
  const overlay = document.getElementById("track-picker");
  if (overlay && !overlay.classList.contains("hidden") && skip) skip.click();
});

const after = await page.evaluate(() => {
  const toast = document.getElementById("toast");
  const list = document.getElementById("video-list");
  const videos = JSON.parse(localStorage.getItem("padelCard.v2") || "{}").videos || [];
  return {
    toast: (toast && toast.textContent) || "",
    listHtml: (list && list.innerHTML) || "",
    videoCount: videos.length,
    duration: videos[0] && videos[0].duration,
    link: videos[0] && videos[0].link
  };
});
console.log("AFTER", after, "UPLOADS", uploads);
assert(uploads.some((u) => u.resource === "video"), "upload proceeded to Cloudinary even when metadata never loaded");
assert(after.videoCount >= 1, "video was kept on the card");
assert(after.link && after.link.includes("test.mp4"), "Cloudinary URL was stored");
assert(after.duration === 200, "duration comes from Cloudinary after upload, got " + after.duration);
assert(/3 דקות|נשמר בכרטיס|הועלה/.test(after.toast + after.listHtml), "a Hebrew status is shown after upload");

// Error path: Cloudinary "File size too large" must surface in Hebrew
uploads.length = 0;
await page.unroute("https://api.cloudinary.com/**");
await page.route("https://api.cloudinary.com/**", async (route) => {
  if (route.request().method() !== "POST") {
    await route.continue();
    return;
  }
  await route.fulfill({
    status: 400,
    contentType: "application/json",
    body: JSON.stringify({ error: { message: "File size too large. Maximum is 104857600" } })
  });
});

await page.evaluate(() => {
  const input = document.getElementById("video-file");
  const file = new File([new Uint8Array(4096)], "too-big.mp4", { type: "video/mp4" });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
});

await page.waitForFunction(() => /100MB|גדול מדי/.test((document.getElementById("toast") || {}).textContent || ""), { timeout: 5000 });
const errToast = await page.evaluate(() => (document.getElementById("toast") || {}).textContent || "");
console.log("ERR TOAST", errToast);
assert(/100MB/.test(errToast), "Cloudinary file-too-large becomes a Hebrew 100MB toast, got " + JSON.stringify(errToast));

await browser.close();

if (failures.length) {
  console.error("\n" + failures.length + " FAILURES");
  failures.forEach((f) => console.error(" -", f));
  process.exit(1);
}
console.log("\nALL V10-1 TESTS PASSED");
