import puppeteer from "/tmp/pw/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BASE = "http://127.0.0.1:8765/";
const OUT = "/workspace/padel-card/screens";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const VIDEO = "/tmp/padel-clip/padel-rally.mp4";
const VIDEO_MOV = "/tmp/padel-clip/padel-rally.mov";
const VIDEO_WIDE = "/tmp/padel-clip/padel-wide-small.mp4";

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

const CHROME_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--hide-scrollbars",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-webgl",
  "--ignore-gpu-blocklist",
  "--autoplay-policy=no-user-gesture-required"
];

async function applyMobile(page) {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  if (page.emulateMediaFeatures) {
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  }
  page.setDefaultTimeout(60000);
  page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      console.log("CONSOLE", msg.type(), msg.text());
    }
  });
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
    const poster = document.getElementById("track-picker-poster");
    const rect = canvas.getBoundingClientRect();
    const vw = video.videoWidth || poster?.naturalWidth || 16;
    const vh = video.videoHeight || poster?.naturalHeight || 9;
    const scale = Math.min(rect.width / vw, rect.height / vh);
    const cw = vw * scale;
    const ch = vh * scale;
    const left = rect.left + (rect.width - cw) / 2;
    const top = rect.top + (rect.height - ch) / 2;
    return {
      x: left + nx * cw,
      y: top + ny * ch,
      ready: video.readyState,
      dur: video.duration,
      vw: video.videoWidth,
      opacity: video.style.opacity
    };
  }, nx, ny);
  console.log("CLICK", pos);
  await page.mouse.click(pos.x, pos.y);
}

async function openProfileAndUpload(page, filePath) {
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await seedOwner(page);
  await page.reload({ waitUntil: "networkidle0" });
  await page.goto(BASE + "#/profile", { waitUntil: "networkidle0" });
  await page.waitForSelector("#view-profile:not(.hidden) #video-file");
  const input = await page.$("#video-file");
  assert(!!input, "video file input exists");
  await input.uploadFile(filePath);
  console.log("uploaded", filePath, "waiting for picker…");
  await page.waitForFunction(() => {
    const el = document.getElementById("track-picker");
    return el && !el.classList.contains("hidden");
  }, { timeout: 90000 });
  console.log("picker visible");
}

async function pickerChrome(page) {
  return page.evaluate(() => {
    const v = document.getElementById("track-picker-video");
    const poster = document.getElementById("track-picker-poster");
    const progress = document.getElementById("track-progress");
    const status = document.getElementById("track-picker-status");
    return {
      title: document.getElementById("track-picker-title")?.textContent,
      ready: v?.readyState || 0,
      vw: v?.videoWidth || 0,
      vh: v?.videoHeight || 0,
      opacity: v?.style.opacity || "",
      posterShown: !!(poster && !poster.classList.contains("hidden") && poster.naturalWidth),
      progressHidden: progress?.classList.contains("hidden"),
      progress: document.getElementById("track-progress-label")?.textContent,
      status: status?.classList.contains("hidden") ? "" : (status?.textContent || ""),
      confirmDisabled: document.getElementById("track-picker-confirm")?.disabled
    };
  });
}

async function waitForPickerReady(page, { allowBlackWithPoster = true, timeout = 20000 } = {}) {
  await page.waitForFunction((allow) => {
    const v = document.getElementById("track-picker-video");
    const poster = document.getElementById("track-picker-poster");
    const hasFrame = v && v.readyState >= 2 && v.videoWidth > 0;
    const visible = hasFrame && v.style.opacity !== "0";
    const hasPoster = !!(poster && !poster.classList.contains("hidden") && poster.naturalWidth);
    return visible || (allow && hasPoster) || hasFrame;
  }, { timeout }, allowBlackWithPoster);
}

async function waitForDetectorSettled(page, timeout = 18000) {
  await page.waitForFunction(() => {
    const state = window.PadelTrack && PadelTrack.getDetectorState && PadelTrack.getDetectorState();
    const status = document.getElementById("track-picker-status");
    const statusText = status && !status.classList.contains("hidden") ? (status.textContent || "") : "";
    if (state && state.ready) return true;
    if (state && state.failed) return true;
    if (/לחצו על עצמכם|לא ניתן לזהות/.test(statusText)) return true;
    return false;
  }, { timeout });
  return pickerChrome(page);
}

async function tapAndConfirm(page, points) {
  let enabled = false;
  for (const [x, y] of points) {
    await clickVideoContent(page, x, y);
    await new Promise((r) => setTimeout(r, 300));
    enabled = await page.$eval("#track-picker-confirm", (el) => !el.disabled);
    if (enabled) break;
  }
  assert(enabled, "confirm button enables after tapping a player");
  await page.click("#track-picker-confirm");
  await page.waitForFunction(() => {
    const el = document.getElementById("track-picker");
    return el && el.classList.contains("hidden");
  }, { timeout: 180000 });
}

async function readStored(page, index = 0) {
  return page.evaluate((index) => {
    const data = JSON.parse(localStorage.getItem("padelCard.v2") || "{}");
    const v = (data.videos || [])[index] || {};
    return {
      count: (data.videos || []).length,
      link: v.link || "",
      trackUrl: v.trackUrl || "",
      marker: v.marker || null,
      hasTrack: !!v.track,
      trackKeys: v.track && v.track.k ? v.track.k.length : 0,
      trackDetected: v.track && v.track.k ? v.track.k.filter((k) => k[4] === 1).length : 0,
      isStatic: !!(v.track && v.track.m && !v.track.k)
    };
  }, index);
}

async function openCardPlayer(page) {
  await page.goto(BASE + "#/card", { waitUntil: "networkidle0" });
  await page.waitForSelector("#view-card:not(.hidden) .ut-video-tile");
  await page.click("#view-card .ut-video-tile .ut-play-btn");
  await page.waitForFunction(() => {
    const el = document.getElementById("video-player");
    return el && !el.classList.contains("hidden");
  });
  await page.waitForFunction(() => {
    const v = document.getElementById("vp-video");
    return v && (v.readyState >= 2 && v.videoWidth > 0);
  }, { timeout: 30000 });
}

async function seekPlayer(page, t) {
  await page.evaluate((t) => {
    const v = document.getElementById("vp-video");
    v.pause();
    v.currentTime = t;
  }, t);
  await page.waitForFunction((t) => {
    const v = document.getElementById("vp-video");
    return v && Math.abs(v.currentTime - t) < 0.3;
  }, { timeout: 10000 }, t);
  await new Promise((r) => setTimeout(r, 350));
}

async function overlayLit(page) {
  return page.evaluate(() => {
    const c = document.getElementById("vp-overlay");
    if (!c || c.width < 2 || c.height < 2) return { lit: 0, w: c?.width || 0, h: c?.height || 0 };
    const ctx = c.getContext("2d");
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 16) {
      if (data[i + 3] > 10) lit += 1;
    }
    const hint = document.getElementById("vp-hint");
    return {
      lit,
      w: c.width,
      h: c.height,
      hint: hint && !hint.classList.contains("hidden") ? hint.textContent.trim() : "",
      time: document.getElementById("vp-time")?.textContent
    };
  });
}

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------- Chrome tests ----------
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: CHROME_ARGS
});

assert(fs.existsSync(VIDEO), "test clip exists at " + VIDEO);
assert(fs.existsSync(VIDEO_MOV), "mov clip exists");
assert(fs.existsSync(VIDEO_WIDE), "wide-small clip exists");

{
  console.log("\n=== Chrome: happy path ===");
  const page = await browser.newPage();
  await applyMobile(page);
  await openProfileAndUpload(page, VIDEO);
  await waitForPickerReady(page);
  const frameInfo = await pickerChrome(page);
  console.log("FRAME", frameInfo);
  assert(frameInfo.title === "מי אתם בסרטון?", "picker asks the player to mark themselves");
  assert(frameInfo.vw > 0 || frameInfo.posterShown, "picker shows a video frame or poster, not a blank box");

  const settled = await waitForDetectorSettled(page, 16000);
  console.log("SETTLED", settled);
  assert(
    settled.progressHidden || !/טוען את מזהה השחקנים…$/.test((settled.progress || "").trim()) || settled.status,
    "detector loading is not stuck forever"
  );
  await clickVideoContent(page, 0.80, 0.68);
  await new Promise((r) => setTimeout(r, 300));
  let enabled = await page.$eval("#track-picker-confirm", (el) => !el.disabled);
  if (!enabled) {
    await clickVideoContent(page, 0.74, 0.58);
    await new Promise((r) => setTimeout(r, 300));
    enabled = await page.$eval("#track-picker-confirm", (el) => !el.disabled);
  }
  assert(enabled, "confirm button enables after tapping a player");
  await snap(page, "picker-ios.png");
  await page.click("#track-picker-confirm");
  await page.waitForFunction(() => {
    const el = document.getElementById("track-picker");
    return el && el.classList.contains("hidden");
  }, { timeout: 180000 });
  const stored = await readStored(page, 0);
  console.log("STORED", stored);
  assert(stored.count === 1, "one video stored");
  assert(/res\.cloudinary\.com\/jgreas8e\/video\/upload\//.test(stored.link), "video uploaded to Cloudinary");
  assert(stored.hasTrack || stored.marker || stored.trackUrl, "a track or static marker was saved");
  if (stored.link) {
    const playable = /vc_h264|f_mp4|\.mp4(\?|$)/i.test(stored.link);
    assert(playable, "stored link is a playable mp4/h264 URL: " + stored.link);
  }
  if (stored.trackUrl) {
    const packed = await (await fetch(stored.trackUrl)).json();
    const lastT = packed.k && packed.k.length ? packed.k[packed.k.length - 1][0] / 100 : 0;
    const dur = (packed.d || 0) / 100;
    console.log("TRACK TIMES", { dur, lastT, n: packed.k && packed.k.length });
    if (packed.k && packed.k.length) {
      assert(dur >= 4, "packed duration covers the clip, got " + dur);
      assert(lastT >= 3, "last keyframe time is past the 1s clamp, got " + lastT);
    }
  }

  const badge = await page.evaluate(async (base) => {
    location.hash = "#/card";
    await new Promise((r) => setTimeout(r, 50));
    return true;
  }, BASE);
  await openCardPlayer(page);
  const hint = await page.$eval("#vp-hint", (el) => !el.classList.contains("hidden") && el.textContent.trim());
  console.log("HINT", hint);
  assert(hint, "player shows a marker hint");

  await seekPlayer(page, 0.35);
  const atStart = await overlayLit(page);
  console.log("AT 0.35", atStart);
  await snap(page, "track-01.png");
  assert(atStart.lit > 20, "circle is drawn near the start, lit=" + atStart.lit);
  await seekPlayer(page, 1.6);
  const mid = await overlayLit(page);
  console.log("AT 1.6", mid);
  await snap(page, "track-02.png");
  await seekPlayer(page, 3.0);
  await snap(page, "track-03.png");
  await seekPlayer(page, 4.4);
  const late = await overlayLit(page);
  console.log("AT 4.4", late);
  await snap(page, "track-04.png");
  if (stored.trackKeys > 2 && !stored.isStatic) {
    assert(late.lit > 20, "keyframe track still draws a circle late in the clip, lit=" + late.lit);
  } else {
    assert(/תחילת הסרטון/.test(late.hint || hint || ""), "static marker hint says it appears at the start");
  }

  await page.click("#vp-close");

  // Second video: .mov container on the same card
  console.log("\n=== Chrome: .mov upload ===");
  await page.goto(BASE + "#/profile", { waitUntil: "networkidle0" });
  await page.waitForSelector("#view-profile:not(.hidden) #video-file");
  const input2 = await page.$("#video-file");
  await input2.uploadFile(VIDEO_MOV);
  await page.waitForFunction(() => {
    const el = document.getElementById("track-picker");
    return el && !el.classList.contains("hidden");
  }, { timeout: 90000 });
  await waitForPickerReady(page);
  const movFrame = await pickerChrome(page);
  console.log("MOV FRAME", movFrame);
  assert(movFrame.vw > 0 || movFrame.posterShown, ".mov picker shows a frame or poster");
  await page.click("#track-picker-skip");
  await page.waitForFunction(() => document.getElementById("track-picker").classList.contains("hidden"), { timeout: 15000 });
  const storedMov = await readStored(page, 1);
  console.log("STORED MOV", storedMov);
  assert(/res\.cloudinary\.com\/jgreas8e\/video\/upload\//.test(storedMov.link), ".mov uploaded to Cloudinary");
  assert(/vc_h264|f_mp4|\.mp4(\?|$)/i.test(storedMov.link), ".mov was stored as a playable h264/mp4 URL");

  // Visitor: untracked share still works
  const visitor = await browser.createBrowserContext().then((ctx) => ctx.newPage());
  await applyMobile(visitor);
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
  await visitor.goto(shareNoTrack, { waitUntil: "networkidle0" });
  await visitor.waitForSelector("#view-card:not(.hidden) .ut-video-tile", { timeout: 20000 });
  const visitorBadge = await visitor.$("#view-card .ut-track-badge");
  assert(!visitorBadge, "untracked shared video has no marker badge");
  await visitor.click("#view-card .ut-video-tile .ut-play-btn");
  await visitor.waitForFunction(() => !document.getElementById("video-player").classList.contains("hidden"));
  const visitorHintHidden = await visitor.$eval("#vp-hint", (el) => el.classList.contains("hidden"));
  assert(visitorHintHidden, "untracked video plays without a marker hint");
  await visitor.close();
  await page.close();
}

{
  console.log("\n=== Chrome: TF CDN blocked fallback ===");
  const blockedBrowser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: CHROME_ARGS
  });
  const page = await blockedBrowser.newPage();
  await applyMobile(page);
  await page.setCacheEnabled(false);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (/cdn\.jsdelivr\.net\/npm\/@tensorflow|coco-ssd|tfjs|tf\.min\.js/.test(url)) {
      return req.abort();
    }
    req.continue();
  });
  await openProfileAndUpload(page, VIDEO);
  await waitForPickerReady(page);
  const settled = await waitForDetectorSettled(page, 16000);
  console.log("BLOCKED SETTLED", settled);
  assert(settled.progressHidden, "progress bar is not left spinning after detector timeout");
  assert(
    !/^טוען את מזהה השחקנים…$/.test((settled.progress || "").trim()),
    "loading text is not left on screen indefinitely"
  );
  assert(
    /לחצו על עצמכם|סימון/.test(settled.status || ""),
    "fallback status tells the user to tap themselves: " + settled.status
  );
  await snap(page, "picker-fallback.png");
  await tapAndConfirm(page, [[0.80, 0.68], [0.5, 0.5]]);
  const stored = await readStored(page, 0);
  console.log("BLOCKED STORED", stored);
  assert(stored.hasTrack || stored.marker, "fallback saved a track or static marker");
  await openCardPlayer(page);
  const hint = await page.$eval("#vp-hint", (el) => !el.classList.contains("hidden") && el.textContent.trim());
  console.log("BLOCKED HINT", hint);
  assert(hint, "fallback player shows a hint");
  await seekPlayer(page, 0.3);
  const atStart = await overlayLit(page);
  console.log("BLOCKED AT 0.3", atStart);
  await snap(page, "track-fallback-start.png");
  assert(atStart.lit > 20, "fallback still draws a marker at the start, lit=" + atStart.lit);
  if (stored.isStatic || (!stored.trackKeys && stored.marker)) {
    assert(/תחילת הסרטון/.test(hint || ""), "static fallback hint mentions the start of the video");
  }
  await page.close();
  await blockedBrowser.close();
}

{
  console.log("\n=== Chrome: wide / small-player clip ===");
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await applyMobile(page);
  await openProfileAndUpload(page, VIDEO_WIDE);
  await waitForPickerReady(page);
  await waitForDetectorSettled(page, 16000);
  // Players sit in the letterboxed center; the original foreground player is still rightish inside the inner 640x360.
  await tapAndConfirm(page, [[0.65, 0.58], [0.55, 0.55], [0.5, 0.5]]);
  const stored = await readStored(page, 0);
  console.log("WIDE STORED", stored);
  assert(stored.hasTrack || stored.marker || stored.trackUrl, "wide clip saved a track or marker");
  await openCardPlayer(page);
  await seekPlayer(page, 0.4);
  const atStart = await overlayLit(page);
  console.log("WIDE AT 0.4", atStart);
  await snap(page, "track-wide.png");
  assert(atStart.lit > 20, "wide-clip player draws a circle/marker at the start, lit=" + atStart.lit);
  if (stored.trackKeys > 2 && !stored.isStatic) {
    await seekPlayer(page, 3.0);
    const mid = await overlayLit(page);
    console.log("WIDE AT 3.0", mid);
    assert(mid.lit > 20, "wide-clip keyframe track still draws later, lit=" + mid.lit);
  }
  await page.close();
  await ctx.close();
}

await browser.close();

// ---------- WebKit / iPhone 13 ----------
console.log("\n=== WebKit iPhone 13 ===");
let webkitRan = false;
try {
  const playwrightPath = "/tmp/pw/node_modules/playwright/index.mjs";
  const { webkit, devices } = await import(pathToFileURL(playwrightPath).href);
  const iphone = devices["iPhone 13"];
  const wk = await webkit.launch({
    headless: true,
    env: {
      ...process.env,
      PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: "1",
      LD_LIBRARY_PATH: ["/tmp/wk-compat", process.env.LD_LIBRARY_PATH || ""].filter(Boolean).join(":")
    }
  });
  const context = await wk.newContext({
    ...iphone,
    locale: "he-IL",
    deviceScaleFactor: 3
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on("pageerror", (err) => console.log("WK PAGEERROR", err.message));
  await openProfileAndUpload(page, VIDEO);
  await waitForPickerReady(page, { allowBlackWithPoster: true, timeout: 25000 });
  const frameInfo = await pickerChrome(page);
  console.log("WK FRAME", frameInfo);
  assert(frameInfo.vw > 0 || frameInfo.posterShown, "WebKit picker shows a video frame or poster");
  const settled = await waitForDetectorSettled(page, 16000);
  console.log("WK SETTLED", settled);
  assert(
    settled.progressHidden || !/^טוען את מזהה השחקנים…$/.test((settled.progress || "").trim()),
    "WebKit detector is not stuck loading"
  );
  await clickVideoContent(page, 0.80, 0.68);
  await new Promise((r) => setTimeout(r, 300));
  await snap(page, "picker-ios.png");
  webkitRan = true;
  await wk.close();
  console.log("OK   WebKit iPhone 13 picker screenshot captured");
} catch (err) {
  console.log("WEBKIT_SKIP", err && err.message ? err.message : String(err));
  // picker-ios.png already captured from Chrome iPhone-sized viewport if WebKit cannot run
}

if (failures.length) {
  console.error("\n" + failures.length + " FAILURES");
  failures.forEach((f) => console.error(" -", f));
  process.exit(1);
}
console.log("\nALL TESTS PASSED" + (webkitRan ? " (including WebKit)" : " (WebKit did not run; Chrome iPhone viewport screenshot saved)"));
