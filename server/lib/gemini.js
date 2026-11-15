"use strict";
/* Minimal Gemini API client: File API (resumable upload) or inline video + generateContent. No SDK. */
const BASE = "https://generativelanguage.googleapis.com";
const INLINE_MAX_BYTES = 14 * 1024 * 1024; // keeps the base64 request under the 20MB inline limit

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function gfetch(url, opts, apiKey, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 120000);
  try {
    const headers = Object.assign({ "x-goog-api-key": apiKey }, (opts && opts.headers) || {});
    return await fetch(url, Object.assign({}, opts, { headers, signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

async function errorText(res) {
  let t = "";
  try { t = await res.text(); } catch (e) {}
  return `Gemini HTTP ${res.status}: ${t.slice(0, 500)}`;
}

async function uploadFile(apiKey, buf, mimeType, displayName) {
  const start = await gfetch(`${BASE}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(buf.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ file: { display_name: displayName } })
  }, apiKey, 30000);
  if (!start.ok) throw new Error(await errorText(start));
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini did not return an upload URL");
  const up = await gfetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(buf.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize"
    },
    body: buf
  }, apiKey, 180000);
  if (!up.ok) throw new Error(await errorText(up));
  const info = await up.json();
  let file = info.file;
  // Videos must finish processing (state ACTIVE) before they can be used.
  const deadline = Date.now() + 150000;
  while (file && file.state === "PROCESSING" && Date.now() < deadline) {
    await sleep(2500);
    const res = await gfetch(`${BASE}/v1beta/${file.name}`, { method: "GET" }, apiKey, 20000);
    if (!res.ok) throw new Error(await errorText(res));
    file = await res.json();
  }
  if (!file || file.state !== "ACTIVE") throw new Error("Gemini file not ready: " + (file && file.state));
  return file;
}

async function deleteFile(apiKey, name) {
  try { await gfetch(`${BASE}/v1beta/${name}`, { method: "DELETE" }, apiKey, 15000); } catch (e) { /* best effort */ }
}

/**
 * videos: [{ buf, mimeType, fps }]
 * Returns { text, usage, model }.
 */
async function generateFromVideos({ apiKey, model, videos, prompt, schema }) {
  const uploaded = [];
  try {
    const parts = [];
    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      const meta = v.fps ? { videoMetadata: { fps: v.fps } } : {};
      if (v.buf.length <= INLINE_MAX_BYTES && videos.length === 1) {
        parts.push(Object.assign({ inlineData: { mimeType: v.mimeType, data: v.buf.toString("base64") } }, meta));
      } else {
        const f = await uploadFile(apiKey, v.buf, v.mimeType, `padel-card-${Date.now()}-${i}`);
        uploaded.push(f.name);
        parts.push(Object.assign({ fileData: { mimeType: f.mimeType || v.mimeType, fileUri: f.uri } }, meta));
      }
      parts.push({ text: `(End of video ${i + 1}.)` });
    }
    parts.push({ text: prompt });
    const body = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        responseSchema: schema,
        thinkingConfig: { thinkingBudget: 2048 }
      }
    };
    let res;
    let schemaFallback = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await gfetch(`${BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }, apiKey, 240000);
      if (res.status !== 429 && res.status !== 503 && res.status !== 500) break;
      await sleep(2000 * (attempt + 1));
    }
    if (res.status === 400 && body.generationConfig.responseSchema) {
      // Some models reject parts of the schema; fall back to plain JSON mode (the prompt still demands strict JSON).
      const msg = await errorText(res);
      if (/schema|Invalid JSON payload|response_schema|responseSchema/i.test(msg)) {
        delete body.generationConfig.responseSchema;
        schemaFallback = true;
        res = await gfetch(`${BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }, apiKey, 240000);
      } else {
        const err = new Error(msg);
        err.status = 400;
        throw err;
      }
    }
    if (!res.ok) {
      const err = new Error(await errorText(res));
      err.status = res.status;
      throw err;
    }
    const json = await res.json();
    const cand = (json.candidates || [])[0];
    const text = cand && cand.content && (cand.content.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join("");
    if (!text) throw new Error("Gemini returned no text (finishReason=" + (cand && cand.finishReason) + ")");
    return { text, usage: json.usageMetadata || null, model: json.modelVersion || model, schemaFallback };
  } finally {
    uploaded.forEach((name) => deleteFile(apiKey, name));
  }
}

module.exports = { generateFromVideos, INLINE_MAX_BYTES };
