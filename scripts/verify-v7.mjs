import puppeteer from "/tmp/pw/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:8765/";
const OUT = "/workspace/padel-card/screens";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const VIDEO = "/tmp/padel-clip/padel-rally.mp4";

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

async function newMobilePage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  page.setDefaultTimeout(60000);
  page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      console.log("CONSOLE", msg.type(), msg.text());
    }
  });
  return page;
}

async function seedOwner(page) {
  await page.evaluate(() => {
    const profile = {
      id: "local-tal-track",
      name: "טל גלעד",
      gender: "male",
      age: "36",
      hand: "right",
      side: "right",
      competitor: "no",
      hasPartner: "no",
      partnerId: null,
      photo: null,
      region: "center",
      courts: [],
      frequency: "2-3",
      tenure: "2plus",
      style: "both",
      shots: ["smash"]
    };
    localStorage.setItem("padelCard.v2", JSON.stringify({
      levelId: "A2",
      profile,
      answers: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      videos: []
    }));
  });
}

async function snap(page, name) {
  await page.evaluate(() => document.getElementById("toast")?.classList.remove("show"));
  const dest = path.join(OUT, name);
  await page.screenshot({ path: dest, fullPage: false });
  console.log("SNAP", dest);
  return dest;
}

async function clickVideoContent(page, nx, ny) {
  const pos = await page.evaluate((nx, ny) => {
    const canvas = document.getElementById("track-picker-canvas");
    const video = document.getElementById("track-picker-video");
    const rect = canvas.getBoundingClientRect();
    const vw = video.videoWidth || 16;
    const vh = video.videoHeight || 9;
    const scale = Math.min(rect.width / vw, rect.height / vh);
    const cw = vw * scale;
    const ch = vh * scale;
    const left = rect.left + (rect.width - cw) / 2;
    const top = rect.top + (rect.height - ch) / 2;
    return { x: left + nx * cw, y: top + ny * ch, ready: video.readyState, dur: video.duration };
  }, nx, ny);
  console.log("CLICK", pos);
  await page.mouse.click(pos.x, pos.y);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--autoplay-policy=no-user-gesture-required"
  ]
});

const page = await newMobilePage(browser);
await page.goto(BASE, { waitUntil: "networkidle0" });
await seedOwner(page);
await page.reload({ waitUntil: "networkidle0" });
await page.goto(BASE + "#/profile", { waitUntil: "networkidle0" });
await page.waitForSelector("#view-profile:not(.hidden) #video-file");

assert(fs.existsSync(VIDEO), "test clip exists at " + VIDEO);
const input = await page.$("#video-file");
assert(!!input, "video file input exists");
await input.uploadFile(VIDEO);
console.log("uploaded file, waiting for picker…");

await page.waitForFunction(() => {
  const el = document.getElementById("track-picker");
  return el && !el.classList.contains("hidden");
}, { timeout: 90000 });
console.log("picker visible");

await page.waitForFunction(() => {
  const v = document.getElementById("track-picker-video");
  return v && v.readyState >= 2 && v.videoWidth > 0;
}, { timeout: 20000 });

// Give the detector a chance to load and draw boxes, but don't require it.
await new Promise((r) => setTimeout(r, 6000));
const detectInfo = await page.evaluate(() => ({
  title: document.getElementById("track-picker-title")?.textContent,
  progress: document.getElementById("track-progress-label")?.textContent,
  progressHidden: document.getElementById("track-progress")?.classList.contains("hidden"),
  confirmDisabled: document.getElementById("track-picker-confirm")?.disabled,
  canvas: !!document.getElementById("track-picker-canvas")
}));
console.log("DETECT INFO", detectInfo);
assert(detectInfo.title === "מי אתם בסרטון?", "picker asks the player to mark themselves");

// Foreground player in this clip is typically right-of-center, lower half.
await clickVideoContent(page, 0.80, 0.68);
await new Promise((r) => setTimeout(r, 300));
let enabled = await page.$eval("#track-picker-confirm", (el) => !el.disabled);
if (!enabled) {
  console.log("first tap missed, trying a second point");
  await clickVideoContent(page, 0.74, 0.58);
  await new Promise((r) => setTimeout(r, 300));
  enabled = await page.$eval("#track-picker-confirm", (el) => !el.disabled);
}
assert(enabled, "confirm button enables after tapping a player");
await snap(page, "track-picker.png");

await page.click("#track-picker-confirm");
console.log("tracking started, waiting…");

await page.waitForFunction(() => {
  const el = document.getElementById("track-picker");
  return el && el.classList.contains("hidden");
}, { timeout: 180000 });

const stored = await page.evaluate(() => {
  const data = JSON.parse(localStorage.getItem("padelCard.v2") || "{}");
  const v = (data.videos || [])[0] || {};
  return {
    count: (data.videos || []).length,
    link: v.link || "",
    trackUrl: v.trackUrl || "",
    marker: v.marker || null,
    hasTrack: !!v.track,
    trackKeys: v.track && v.track.k ? v.track.k.length : 0,
    trackDetected: v.track && v.track.k ? v.track.k.filter((k) => k[4] === 1).length : 0
  };
});
console.log("STORED", stored);
assert(stored.count === 1, "one video stored");
assert(/res\.cloudinary\.com\/jgreas8e\/video\/upload\//.test(stored.link), "video uploaded to Cloudinary");
assert(stored.hasTrack || stored.marker || stored.trackUrl, "a track or static marker was saved");
if (stored.trackUrl) {
  const packed = await (await fetch(stored.trackUrl)).json();
  const lastT = packed.k && packed.k.length ? packed.k[packed.k.length - 1][0] / 100 : 0;
  const dur = (packed.d || 0) / 100;
  const times = (packed.k || []).map((k) => +(k[0] / 100).toFixed(2));
  console.log("TRACK TIMES", { dur, lastT, times });
  assert(dur >= 4, "packed duration covers the clip, got " + dur);
  assert(lastT >= 3, "last keyframe time is past the 1s clamp, got " + lastT);
}

// Open the live card and play
await page.goto(BASE + "#/card", { waitUntil: "networkidle0" });
await page.waitForSelector("#view-card:not(.hidden) .ut-video-tile");
const badge = await page.$eval("#view-card .ut-video-tile", (el) => el.getAttribute("data-has-track") === "1");
assert(badge, "card tile is marked as having a player track");
await page.click("#view-card .ut-video-tile .ut-play-btn");
await page.waitForFunction(() => {
  const el = document.getElementById("video-player");
  return el && !el.classList.contains("hidden");
});
await page.waitForFunction(() => {
  const v = document.getElementById("vp-video");
  return v && v.readyState >= 2 && v.videoWidth > 0;
}, { timeout: 30000 });

const hint = await page.$eval("#vp-hint", (el) => !el.classList.contains("hidden") && el.textContent.trim());
console.log("HINT", hint);
assert(hint, "player shows the marker hint");

async function seekAndSnap(t, name) {
  await page.evaluate((t) => {
    const v = document.getElementById("vp-video");
    v.pause();
    v.currentTime = t;
  }, t);
  await page.waitForFunction((t) => {
    const v = document.getElementById("vp-video");
    const time = document.getElementById("vp-time")?.textContent || "";
    return v && Math.abs(v.currentTime - t) < 0.25 && time !== "0:00 / 0:00";
  }, { timeout: 10000 }, t);
  await new Promise((r) => setTimeout(r, 350));
  const chrome = await page.evaluate(() => document.getElementById("vp-time")?.textContent);
  console.log("AT", t, chrome);
  await page.evaluate(() => {
    const canvas = document.getElementById("vp-overlay");
    return canvas && canvas.width > 0;
  });
  await snap(page, name);
}

await seekAndSnap(0.35, "track-01.png");
await seekAndSnap(1.6, "track-02.png");
await seekAndSnap(3.0, "track-03.png");
await seekAndSnap(4.4, "track-04.png");

// Circle should have been drawn (non-empty canvas) at mid-clip if tracking worked
const painted = await page.evaluate(() => {
  const c = document.getElementById("vp-overlay");
  const ctx = c.getContext("2d");
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  let lit = 0;
  for (let i = 0; i < data.length; i += 16) {
    if (data[i + 3] > 10) lit += 1;
  }
  return { lit, w: c.width, h: c.height };
});
console.log("OVERLAY PIXELS", painted);
assert(painted.lit > 20, "overlay canvas has a visible circle, lit=" + painted.lit);

await page.click("#vp-close");
await page.waitForFunction(() => document.getElementById("video-player").classList.contains("hidden"));

// Existing video without a track still opens the in-page player (no hint)
const visitor = await browser.createBrowserContext().then((ctx) => ctx.newPage());
await visitor.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
visitor.setDefaultTimeout(40000);

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
assert(!!stored.link, "have a Cloudinary video URL to share without a track");
const shareNoTrack = BASE + "#/p/" + toBase64Url(JSON.stringify({
  id: "visitor-no-track",
  n: "דני ישן",
  g: "male",
  a: 33,
  h: "right",
  s: "right",
  c: "yes",
  lv: "B1",
  sc: 34,
  hp: "no",
  v: [stored.link]
}));
console.log("VISITOR URL len", shareNoTrack.length);
await visitor.goto(shareNoTrack, { waitUntil: "networkidle0" });
await visitor.waitForSelector("#view-card:not(.hidden) .ut-video-tile", { timeout: 20000 });
const visitorBadge = await visitor.$("#view-card .ut-track-badge");
assert(!visitorBadge, "untracked shared video has no marker badge");
await visitor.click("#view-card .ut-video-tile .ut-play-btn");
await visitor.waitForFunction(() => !document.getElementById("video-player").classList.contains("hidden"));
const visitorHintHidden = await visitor.$eval("#vp-hint", (el) => el.classList.contains("hidden"));
assert(visitorHintHidden, "untracked video plays without a marker hint");
await visitor.click("#vp-close");

await browser.close();

if (failures.length) {
  console.error("\n" + failures.length + " FAILURES");
  failures.forEach((f) => console.error(" -", f));
  process.exit(1);
}
console.log("\nALL TESTS PASSED");
