(function (global) {
  var MODEL = null;
  var loading = null;
  var detectorFailed = false;
  var detectorStatus = "idle";
  var TF_SRC = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
  var COCO_SRC = "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js";
  var DEFAULT_INTERVAL = 0.2;
  var TRACK_VERSION = 2;
  var HOLD_SEC = 4;
  var DEFAULT_R = 0.12;
  var DETECT_MAX = 640;
  var DETECTOR_TIMEOUT_MS = 14000;
  var PERSON_SCORE = 0.2;
  var TMPL_SIZE = 32;

  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error(label || "timeout"));
      }, ms);
      promise.then(function (value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      }, function (err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function loadScript(src, ms) {
    return new Promise(function (resolve, reject) {
      if (src.indexOf("tf.min") >= 0 && global.tf) return resolve();
      if (src.indexOf("coco-ssd") >= 0 && global.cocoSsd) return resolve();
      var existing = document.querySelector('script[data-padel-src="' + src + '"]');
      var finish = function (err) {
        if (err) reject(err);
        else resolve();
      };
      if (existing) {
        if (existing.getAttribute("data-padel-loaded") === "1") return resolve();
        existing.addEventListener("load", function () { finish(); });
        existing.addEventListener("error", function () { finish(new Error("script")); });
        setTimeout(function () { finish(new Error("script-timeout")); }, ms || 10000);
        return;
      }
      var el = document.createElement("script");
      el.src = src;
      el.async = true;
      el.setAttribute("data-padel-src", src);
      el.onload = function () {
        el.setAttribute("data-padel-loaded", "1");
        finish();
      };
      el.onerror = function () { finish(new Error("script")); };
      document.head.appendChild(el);
      setTimeout(function () { finish(new Error("script-timeout")); }, ms || 10000);
    });
  }

  function setStatus(onStatus, text, state) {
    detectorStatus = state || detectorStatus;
    if (onStatus) onStatus(text, detectorStatus);
  }

  function tryBackend(name, ms) {
    if (!global.tf || !tf.setBackend) return Promise.reject(new Error("tf"));
    return withTimeout(
      tf.setBackend(name).then(function (ok) {
        if (!ok) throw new Error("backend-false");
        return tf.ready();
      }),
      ms || 4000,
      "backend-" + name
    );
  }

  function loadModel(base) {
    if (!global.cocoSsd) throw new Error("coco");
    return cocoSsd.load({ base: base });
  }

  function loadDetector(onStatus) {
    if (MODEL) return Promise.resolve(MODEL);
    if (detectorFailed && !loading) {
      return Promise.reject(new Error("detector-unavailable"));
    }
    if (loading) return loading;
    setStatus(onStatus, "טוען את מזהה השחקנים…", "loading");
    var started = Date.now();
    loading = withTimeout(
      loadScript(TF_SRC, 10000).then(function () {
        setStatus(onStatus, "מכין את מנוע הזיהוי…", "loading");
        if (global.tf && tf.ready) return withTimeout(tf.ready(), 4000, "tf-ready");
      }).then(function () {
        return tryBackend("webgl", 4000).catch(function () {
          return tryBackend("cpu", 4000);
        });
      }).then(function () {
        setStatus(onStatus, "טוען את מודל הזיהוי…", "loading");
        return loadScript(COCO_SRC, 10000);
      }).then(function () {
        var remain = Math.max(4000, DETECTOR_TIMEOUT_MS - (Date.now() - started));
        var backend = (global.tf && tf.getBackend && tf.getBackend()) || "cpu";
        var first = backend === "webgl" ? "mobilenet_v2" : "lite_mobilenet_v2";
        var second = first === "mobilenet_v2" ? "lite_mobilenet_v2" : "mobilenet_v2";
        setStatus(onStatus, "טוען את מודל הזיהוי…", "loading");
        return withTimeout(loadModel(first), Math.min(remain, 9000), "model-" + first).catch(function () {
          remain = Math.max(3500, DETECTOR_TIMEOUT_MS - (Date.now() - started));
          return withTimeout(loadModel(second), remain, "model-" + second);
        });
      }).then(function (model) {
        MODEL = model;
        detectorFailed = false;
        detectorStatus = "ready";
        setStatus(onStatus, "", "ready");
        return model;
      }),
      DETECTOR_TIMEOUT_MS,
      "detector-timeout"
    ).catch(function (err) {
      loading = null;
      MODEL = null;
      detectorFailed = true;
      detectorStatus = "failed";
      setStatus(onStatus, "", "failed");
      throw err;
    });
    return loading;
  }

  function getDetectorState() {
    return {
      status: detectorStatus,
      ready: !!MODEL,
      failed: detectorFailed
    };
  }

  function isCanvasTainted(canvas) {
    if (!canvas || !canvas.getContext) return false;
    try {
      canvas.getContext("2d").getImageData(0, 0, 1, 1);
      return false;
    } catch (err) {
      return true;
    }
  }

  function sourceSize(source) {
    return {
      w: source.videoWidth || source.naturalWidth || source.width || 1,
      h: source.videoHeight || source.naturalHeight || source.height || 1
    };
  }

  function meanColor(source, x, y, w, h) {
    try {
      var sw = source.width || source.videoWidth || 0;
      var sh = source.height || source.videoHeight || 0;
      if (!sw || !sh) return null;
      var canvas = source;
      if (!source.getContext) {
        canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        canvas.getContext("2d").drawImage(source, 0, 0, sw, sh);
      }
      if (isCanvasTainted(canvas)) return null;
      var ctx = canvas.getContext("2d");
      var sx = Math.max(0, Math.round(x + w * 0.25));
      var sy = Math.max(0, Math.round(y + h * 0.15));
      var cw = Math.max(1, Math.round(w * 0.5));
      var ch = Math.max(1, Math.round(h * 0.5));
      if (sx + cw > sw) cw = Math.max(1, sw - sx);
      if (sy + ch > sh) ch = Math.max(1, sh - sy);
      var img = ctx.getImageData(sx, sy, cw, ch);
      var r = 0, g = 0, b = 0, n = img.data.length / 4;
      var i;
      for (i = 0; i < img.data.length; i += 4) {
        r += img.data[i];
        g += img.data[i + 1];
        b += img.data[i + 2];
      }
      return n ? { r: r / n, g: g / n, b: b / n } : null;
    } catch (err) {
      return null;
    }
  }

  function colorDist(a, c) {
    if (!a || !c) return 0.5;
    return Math.min(1, Math.hypot(a.r - c.r, a.g - c.g, a.b - c.b) / 260);
  }

  function grabFrame(video, maxW) {
    var vw = video.videoWidth || video.width || 1;
    var vh = video.videoHeight || video.height || 1;
    var w = Math.min(maxW || DETECT_MAX, vw);
    w = Math.max(320, w);
    if (vw < w) w = vw;
    var h = Math.max(1, Math.round(vh * (w / vw)));
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    return c;
  }

  function cropSource(source, sx, sy, sw, sh, maxEdge) {
    var scale = Math.min(1, (maxEdge || DETECT_MAX) / Math.max(sw, sh));
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(sw * scale));
    c.height = Math.max(1, Math.round(sh * scale));
    c.getContext("2d").drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  function runDetect(model, canvas) {
    return model.detect(canvas, 12).then(function (preds) {
      return (preds || []).filter(function (p) {
        return p.class === "person" && p.score >= PERSON_SCORE;
      });
    });
  }

  function predToBox(p, size, source) {
    var b = p.bbox;
    return {
      x: b[0] / size.w,
      y: b[1] / size.h,
      w: b[2] / size.w,
      h: b[3] / size.h,
      score: p.score,
      color: meanColor(source, b[0], b[1], b[2], b[3])
    };
  }

  function filterBoxes(boxes) {
    return (boxes || []).filter(function (b) {
      return b.w > 0.01 && b.h > 0.018 && b.w < 0.95 && b.h < 0.98;
    });
  }

  function mergeBoxes(boxes) {
    var list = (boxes || []).slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    var out = [];
    var i, j;
    for (i = 0; i < list.length; i++) {
      var keep = true;
      for (j = 0; j < out.length; j++) {
        if (iou(list[i], out[j]) >= 0.45) {
          keep = false;
          break;
        }
      }
      if (keep) out.push(list[i]);
    }
    return filterBoxes(out);
  }

  function detectOnCanvas(model, canvas) {
    return runDetect(model, canvas).then(function (preds) {
      var size = { w: canvas.width, h: canvas.height };
      return filterBoxes(preds.map(function (p) { return predToBox(p, size, canvas); }));
    });
  }

  function detectFromVideo(model, video) {
    var vw = video.videoWidth || 1;
    var vh = video.videoHeight || 1;
    var full = grabFrame(video, DETECT_MAX);
    if (isCanvasTainted(full)) {
      var err = new Error("tainted");
      err.code = "tainted";
      return Promise.reject(err);
    }
    function pushCrop(jobs, meta, sx, sy, sw, sh, maxEdge) {
      sx = Math.max(0, Math.round(sx));
      sy = Math.max(0, Math.round(sy));
      sw = Math.max(8, Math.round(Math.min(sw, vw - sx)));
      sh = Math.max(8, Math.round(Math.min(sh, vh - sy)));
      var canvas = cropSource(video, sx, sy, sw, sh, maxEdge || DETECT_MAX);
      jobs.push(runDetect(model, canvas));
      meta.push({ sx: sx, sy: sy, sw: sw, sh: sh, cw: canvas.width, ch: canvas.height, canvas: canvas });
    }
    return detectOnCanvas(model, full).then(function (boxes) {
      var small = !boxes.length || boxes.every(function (b) { return b.h < 0.22 && b.w < 0.2; });
      var wide = vw >= 800;
      var jobs = [];
      var meta = [];
      // Near-court crop: mesh-covered near players are large in this region
      // but tiny in the full 640px pass, so run a dedicated higher-res crop.
      pushCrop(jobs, meta, vw * 0.08, vh * 0.08, vw * 0.84, vh * 0.62, 800);
      var needTiles = boxes.length < 4 || (wide && small);
      if (needTiles && vw >= 700) {
        var cols = 2;
        var rows = vh >= 500 ? 2 : 1;
        var overlap = 0.22;
        var tileW = vw / (cols - (cols - 1) * overlap);
        var tileH = vh / (rows - (rows - 1) * overlap);
        var r, c;
        for (r = 0; r < rows; r++) {
          for (c = 0; c < cols; c++) {
            pushCrop(
              jobs,
              meta,
              c * tileW * (1 - overlap),
              r * tileH * (1 - overlap),
              tileW,
              tileH,
              DETECT_MAX
            );
          }
        }
      }
      if (!jobs.length) return boxes;
      return Promise.all(jobs).then(function (results) {
        var all = boxes.slice();
        results.forEach(function (preds, i) {
          var m = meta[i];
          (preds || []).forEach(function (p) {
            var b = p.bbox;
            var x = m.sx + (b[0] / m.cw) * m.sw;
            var y = m.sy + (b[1] / m.ch) * m.sh;
            var w = (b[2] / m.cw) * m.sw;
            var h = (b[3] / m.ch) * m.sh;
            all.push({
              x: x / vw,
              y: y / vh,
              w: w / vw,
              h: h / vh,
              score: p.score,
              color: meanColor(m.canvas, b[0], b[1], b[2], b[3])
            });
          });
        });
        return mergeBoxes(all);
      });
    });
  }

  function detectPeople(source) {
    if (detectorFailed && !MODEL) return Promise.resolve([]);
    return loadDetector().then(function (model) {
      if (!model) return [];
      if (source && source.videoWidth) return detectFromVideo(model, source);
      return detectOnCanvas(model, source);
    }).catch(function (err) {
      if (err && err.code === "tainted") throw err;
      return [];
    });
  }

  function makeTemplate(frame, box) {
    if (!frame || !box || isCanvasTainted(frame)) return null;
    var fw = frame.width;
    var fh = frame.height;
    var x = (box.x || 0) * fw;
    var y = (box.y || 0) * fh;
    var w = Math.max(8, (box.w || 0.08) * fw);
    var h = Math.max(8, (box.h || 0.08) * fh);
    var sx = Math.max(0, Math.round(x + w * 0.18));
    var sy = Math.max(0, Math.round(y + h * 0.12));
    var sw = Math.max(8, Math.round(w * 0.64));
    var sh = Math.max(8, Math.round(h * 0.7));
    if (sx + sw > fw) sw = Math.max(8, fw - sx);
    if (sy + sh > fh) sh = Math.max(8, fh - sy);
    var c = document.createElement("canvas");
    c.width = TMPL_SIZE;
    c.height = TMPL_SIZE;
    c.getContext("2d").drawImage(frame, sx, sy, sw, sh, 0, 0, TMPL_SIZE, TMPL_SIZE);
    return { canvas: c, w: sw / fw, h: sh / fh, color: meanColor(frame, sx, sy, sw, sh) };
  }

  function matchTemplate(frame, tmpl, cx, cy, searchR) {
    if (!frame || !tmpl || !tmpl.canvas || isCanvasTainted(frame)) return null;
    var fw = frame.width;
    var fh = frame.height;
    var tw = Math.max(8, Math.round((tmpl.w || 0.08) * fw));
    var th = Math.max(8, Math.round((tmpl.h || 0.1) * fh));
    var radius = (searchR || 0.14) * fw;
    var steps = 7;
    var best = null;
    var bestSad = Infinity;
    var tdata;
    try { tdata = tmpl.canvas.getContext("2d").getImageData(0, 0, TMPL_SIZE, TMPL_SIZE).data; }
    catch (err) { return null; }
    var tmp = document.createElement("canvas");
    tmp.width = TMPL_SIZE;
    tmp.height = TMPL_SIZE;
    var tctx = tmp.getContext("2d");
    var iy, ix, px, py, d, sad, i, mean;
    for (iy = 0; iy < steps; iy++) {
      for (ix = 0; ix < steps; ix++) {
        px = (cx * fw) + ((ix / (steps - 1)) - 0.5) * 2 * radius - tw / 2;
        py = (cy * fh) + ((iy / (steps - 1)) - 0.5) * 2 * radius * (fh / fw) - th / 2;
        px = Math.max(0, Math.min(fw - tw, px));
        py = Math.max(0, Math.min(fh - th, py));
        tctx.drawImage(frame, px, py, tw, th, 0, 0, TMPL_SIZE, TMPL_SIZE);
        try { d = tctx.getImageData(0, 0, TMPL_SIZE, TMPL_SIZE).data; }
        catch (err) { return null; }
        sad = 0;
        for (i = 0; i < d.length; i += 4) {
          sad += Math.abs(d[i] - tdata[i]) + Math.abs(d[i + 1] - tdata[i + 1]) + Math.abs(d[i + 2] - tdata[i + 2]);
        }
        if (sad < bestSad) {
          bestSad = sad;
          best = { x: px / fw, y: py / fh, w: tw / fw, h: th / fh };
        }
      }
    }
    mean = bestSad / (TMPL_SIZE * TMPL_SIZE * 3);
    if (!best || mean > 58) return null;
    best.color = meanColor(frame, best.x * fw, best.y * fh, best.w * fw, best.h * fh);
    best.score = Math.max(0, 1 - mean / 58);
    return best;
  }

  function boxCenter(b) {
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }

  function boxRadius(b, aspect) {
    var ah = aspect || 9 / 16;
    return 0.5 * Math.sqrt(b.w * b.w + (b.h * ah) * (b.h * ah)) * 1.1;
  }

  function pointFromBox(b, aspect) {
    var c = boxCenter(b);
    return { x: c.x, y: c.y - b.h * 0.06, r: Math.max(0.04, boxRadius(b, aspect)), box: b };
  }

  function iou(a, b) {
    var x1 = Math.max(a.x, b.x);
    var y1 = Math.max(a.y, b.y);
    var x2 = Math.min(a.x + a.w, b.x + b.w);
    var y2 = Math.min(a.y + a.h, b.y + b.h);
    var inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    var union = a.w * a.h + b.w * b.h - inter;
    return union > 0 ? inter / union : 0;
  }

  var UNMATCHED_COST = 3.2;
  var HIST_BINS = 64;

  function zeros(n) {
    var a = [];
    var i;
    for (i = 0; i < n; i++) a[i] = 0;
    return a;
  }

  function regionAppearance(frame, box, y0, y1, xPad) {
    if (!frame || !box || isCanvasTainted(frame)) return null;
    var fw = frame.width;
    var fh = frame.height;
    var x = Math.max(0, Math.round(box.x * fw));
    var y = Math.max(0, Math.round(box.y * fh));
    var w = Math.max(4, Math.round(box.w * fw));
    var h = Math.max(4, Math.round(box.h * fh));
    var sx = Math.max(0, Math.round(x + w * (xPad || 0.18)));
    var sw = Math.max(4, Math.round(w * (1 - 2 * (xPad || 0.18))));
    var sy = Math.max(0, Math.round(y + h * y0));
    var sh = Math.max(4, Math.round(h * (y1 - y0)));
    if (sx + sw > fw) sw = Math.max(4, fw - sx);
    if (sy + sh > fh) sh = Math.max(4, fh - sy);
    if (sw < 2 || sh < 2) return null;
    var data;
    try { data = frame.getContext("2d").getImageData(sx, sy, sw, sh).data; }
    catch (err) { return null; }
    var hist = zeros(HIST_BINS);
    var rgb = [0, 0, 0];
    var n = 0;
    var i, r, g, b, lum;
    for (i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 16) continue;
      r = data[i]; g = data[i + 1]; b = data[i + 2];
      // Skip the blue court so clothing dominates the histogram.
      if (b > r + 28 && b > g + 18 && b > 90) continue;
      lum = 0.3 * r + 0.59 * g + 0.11 * b;
      if (lum < 12 || lum > 250) continue;
      rgb[0] += r; rgb[1] += g; rgb[2] += b;
      n += 1;
      hist[((r >> 6) << 4) + ((g >> 6) << 2) + (b >> 6)] += 1;
    }
    if (!n) return { hist: hist, mean: [0, 0, 0], n: 0 };
    for (i = 0; i < HIST_BINS; i++) hist[i] /= n;
    return { hist: hist, mean: [rgb[0] / n, rgb[1] / n, rgb[2] / n], n: n };
  }

  function appearanceOf(frame, box) {
    if (!frame || !box) return null;
    return {
      torso: regionAppearance(frame, box, 0.16, 0.52, 0.18),
      shorts: regionAppearance(frame, box, 0.48, 0.82, 0.2)
    };
  }

  function histL1(a, b) {
    if (!a || !b) return 1;
    var s = 0;
    var i;
    for (i = 0; i < a.length; i++) s += Math.abs((a[i] || 0) - (b[i] || 0));
    return s / 2;
  }

  function meanDist(a, b) {
    if (!a || !b) return 1;
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 441;
  }

  function appearDist(a, b) {
    if (!a || !b) return 0.55;
    var td = a.torso && b.torso ? 0.45 * histL1(a.torso.hist, b.torso.hist) + 0.2 * meanDist(a.torso.mean, b.torso.mean) : 0.35;
    var sd = a.shorts && b.shorts ? 0.22 * histL1(a.shorts.hist, b.shorts.hist) + 0.13 * meanDist(a.shorts.mean, b.shorts.mean) : 0.2;
    return td + sd;
  }

  function mixHist(h1, h2, a) {
    if (!h1) return h2;
    if (!h2) return h1;
    var out = [];
    var i;
    for (i = 0; i < h1.length; i++) out[i] = h1[i] * (1 - a) + h2[i] * a;
    return out;
  }

  function mixMean(m1, m2, a) {
    if (!m1) return m2;
    if (!m2) return m1;
    return [m1[0] * (1 - a) + m2[0] * a, m1[1] * (1 - a) + m2[1] * a, m1[2] * (1 - a) + m2[2] * a];
  }

  function mixAppear(oldA, neu, a) {
    if (!oldA) return neu;
    if (!neu) return oldA;
    function mixPart(p1, p2) {
      if (!p1) return p2;
      if (!p2) return p1;
      return { hist: mixHist(p1.hist, p2.hist, a), mean: mixMean(p1.mean, p2.mean, a), n: p2.n || p1.n };
    }
    return { torso: mixPart(oldA.torso, neu.torso), shorts: mixPart(oldA.shorts, neu.shorts) };
  }

  function locateByAppearance(frame, appear, box, pred, court, searchR) {
    if (!frame || !appear || !box || isCanvasTainted(frame)) return null;
    var radius = searchR || 0.2;
    var scales = [1, 1.22, 0.84];
    var steps = Math.max(7, Math.min(13, Math.round(radius / 0.028) + 5));
    var best = null;
    var bestCost = 0.32;
    var si, iy, ix, scale, w, h, cx, cy, b, ap, cost, dist;
    var predX = pred && pred.x != null ? pred.x : boxCenter(box).x;
    var predY = pred && pred.y != null ? pred.y : boxCenter(box).y;
    var half = court && court.half ? court.half : (court ? sideOf(box, court) : "near");
    for (si = 0; si < scales.length; si++) {
      scale = scales[si];
      w = box.w * scale;
      h = box.h * scale;
      for (iy = 0; iy < steps; iy++) {
        for (ix = 0; ix < steps; ix++) {
          cx = predX + ((ix / (steps - 1)) - 0.5) * 2 * radius;
          cy = predY + ((iy / (steps - 1)) - 0.5) * 2 * radius * 0.85;
          if (cx < w * 0.4 || cx > 1 - w * 0.4 || cy < h * 0.35 || cy > 1 - h * 0.2) continue;
          b = { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
          if (court && sideOf(b, court) !== half) continue;
          ap = appearanceOf(frame, b);
          if (!ap) continue;
          var pix = ((ap.torso && ap.torso.n) || 0) + ((ap.shorts && ap.shorts.n) || 0);
          if (pix < 50) continue;
          dist = Math.hypot(cx - predX, cy - predY);
          cost = appearDist(appear, ap) + 0.12 * (dist / Math.max(radius, 0.08));
          if (cost < bestCost) {
            bestCost = cost;
            best = b;
            best.appear = ap;
            best.score = Math.max(0, 1 - cost);
          }
        }
      }
    }
    return best;
  }

  function enrichBoxes(frame, boxes) {
    (boxes || []).forEach(function (b) {
      if (!b.appear) b.appear = appearanceOf(frame, b);
    });
    return boxes || [];
  }

  function footY(b) {
    return (b.y || 0) + (b.h || 0);
  }

  function nearScore(b) {
    // Near players sit lower in the frame and have much bigger boxes.
    return footY(b) + (b.h || 0) * 0.85;
  }

  function estimateCourt(boxes, startBox) {
    var list = (boxes || []).slice();
    if (startBox && list.indexOf(startBox) === -1) list.push(startBox);
    list.sort(function (a, b) { return nearScore(b) - nearScore(a); });
    var start = startBox || list[0];
    var netY;
    var nearH;
    var half;
    if (list.length >= 4) {
      var near = list.slice(0, 2);
      var far = list.slice(list.length - 2);
      var nearFoot = (footY(near[0]) + footY(near[1])) / 2;
      var farFoot = (footY(far[0]) + footY(far[1])) / 2;
      netY = (nearFoot + farFoot) / 2;
      nearH = (near[0].h + near[1].h) / 2;
    } else if (list.length >= 2) {
      netY = (footY(list[0]) + footY(list[list.length - 1])) / 2;
      nearH = list[0].h;
    } else if (start) {
      // Large marked box is a near player: net sits above mid-body, below the head.
      netY = start.h >= 0.15
        ? footY(start) - start.h * 0.42
        : start.y + start.h * 0.22;
      nearH = start.h;
    } else {
      netY = 0.42;
      nearH = 0.2;
    }
    half = start ? (footY(start) >= netY - 0.02 ? "near" : "far") : "near";
    // If the marked box is clearly large, trust "near".
    if (start && start.h >= 0.16) half = "near";
    if (start && start.h <= 0.11 && footY(start) < netY) half = "far";
    return { netY: netY, half: half, nearH: nearH || (start && start.h) || 0.2 };
  }

  function sideOf(box, court) {
    if (!box || !court) return "near";
    var foot = footY(box);
    var cy = box.y + box.h / 2;
    if (foot < court.netY - 0.05) return "far";
    if (foot > court.netY + 0.04) return "near";
    if (court.nearH) {
      if (box.h < court.nearH * 0.62) return "far";
      if (box.h > court.nearH * 0.82) return "near";
    }
    return cy >= court.netY ? "near" : "far";
  }

  function snapStart(startBox, boxes, court) {
    if (!startBox) return (boxes && boxes[0]) || null;
    var c0 = boxCenter(startBox);
    var startHalf = court ? sideOf(startBox, court) : null;
    var best = null;
    var bestD = Infinity;
    var i, b, c, ratio, d;
    for (i = 0; i < (boxes || []).length; i++) {
      b = boxes[i];
      if (startHalf && sideOf(b, court) !== startHalf) continue;
      ratio = b.h / Math.max(0.001, startBox.h);
      if (ratio < 0.6 || ratio > 1.6) continue;
      c = boxCenter(b);
      d = Math.hypot(c.x - c0.x, c.y - c0.y);
      if (d < 0.12 && d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best || startBox;
  }

  function passesGates(track, det, dt, court) {
    if (!track || !det) return false;
    if (sideOf(det, court) !== track.half) return false;
    var lastH = Math.max(0.001, track.box.h);
    var ratio = det.h / lastH;
    if (ratio < 0.6 || ratio > 1.6) return false;
    var initH = Math.max(0.001, track.initH || lastH);
    var initRatio = det.h / initH;
    if (initRatio < 0.5 || initRatio > 1.85) return false;
    var predX = track.cx + track.vx * dt;
    var predY = track.cy + track.vy * dt;
    var c = boxCenter(det);
    var dist = Math.hypot(c.x - predX, c.y - predY);
    var maxDist = Math.max(0.07, lastH * 2.2) * Math.max(dt, 0.05) + 0.03;
    var misses = track.misses || 0;
    if (misses >= 5) maxDist += Math.min(0.45, (misses - 4) * 0.05);
    // After ~2s lost, re-acquire anywhere on the same half if size (and appearance) fit.
    if (misses < 10 && dist > maxDist) return false;
    if (misses >= 8 && track.appear && det.appear && appearDist(track.appear, det.appear) > 0.4) return false;
    return true;
  }

  function pairCost(track, det, dt, court) {
    if (!passesGates(track, det, dt, court)) return 99;
    var predX = track.cx + track.vx * dt;
    var predY = track.cy + track.vy * dt;
    var c = boxCenter(det);
    var dist = Math.hypot(c.x - predX, c.y - predY);
    var sizePen = Math.abs(1 - det.h / Math.max(0.001, track.box.h));
    var ad = appearDist(track.appear, det.appear);
    return (dist / Math.max(0.04, track.box.h)) * 0.48 + sizePen * 0.2 + ad * 0.32;
  }

  function minCostAssign(cost) {
    var n = cost.length;
    var m = n && cost[0] ? cost[0].length : 0;
    var bestMap = [];
    var best = Infinity;
    var used = zeros(m);
    var map = [];
    var i;
    for (i = 0; i < n; i++) map[i] = -1;

    function rec(t, acc) {
      if (acc >= best) return;
      if (t === n) {
        best = acc;
        bestMap = map.slice();
        return;
      }
      var d;
      var matched = false;
      for (d = 0; d < m; d++) {
        if (used[d] || cost[t][d] >= 90) continue;
        used[d] = 1;
        map[t] = d;
        rec(t + 1, acc + cost[t][d]);
        used[d] = 0;
        map[t] = -1;
        matched = true;
      }
      map[t] = -1;
      rec(t + 1, acc + UNMATCHED_COST);
    }
    rec(0, 0);
    return bestMap.length ? bestMap : map;
  }

  function makeTrack(box, court, isTarget) {
    var c = boxCenter(box);
    return {
      box: box,
      cx: c.x,
      cy: c.y,
      vx: 0,
      vy: 0,
      initH: box.h,
      half: sideOf(box, court),
      appear: box.appear || null,
      target: !!isTarget,
      misses: 0
    };
  }

  function seedTracks(boxes, startBox, court) {
    var list = (boxes || []).slice();
    var target = startBox ? (snapStart(startBox, list, court) || startBox) : (list[0] || startBox);
    if (target && list.indexOf(target) === -1) list = [target].concat(list);
    list.sort(function (a, b) { return nearScore(b) - nearScore(a); });
    // Keep at most 4 people, always including the marked one.
    var picked = [];
    var i;
    if (target) picked.push(target);
    for (i = 0; i < list.length && picked.length < 4; i++) {
      if (picked.indexOf(list[i]) === -1) picked.push(list[i]);
    }
    return picked.map(function (b) {
      return makeTrack(b, court, b === target);
    });
  }

  function updateTrack(track, det, dt, court) {
    var prev = boxCenter(track.box);
    var c = boxCenter(det);
    var smooth = 0.35;
    track.vx = (1 - smooth) * track.vx + smooth * ((c.x - prev.x) / Math.max(dt, 0.05));
    track.vy = (1 - smooth) * track.vy + smooth * ((c.y - prev.y) / Math.max(dt, 0.05));
    // Clamp velocity so a bad frame cannot sling the predictor over the net.
    var vmax = Math.max(0.15, track.box.h * 2.5);
    if (Math.hypot(track.vx, track.vy) > vmax) {
      var s = vmax / Math.hypot(track.vx, track.vy);
      track.vx *= s;
      track.vy *= s;
    }
    track.box = det;
    track.cx = c.x;
    track.cy = c.y;
    track.misses = 0;
    if (det.appear) track.appear = mixAppear(track.appear, det.appear, 0.08);
  }

  function holdTrack(track, dt) {
    var decay = 0.45;
    track.vx *= decay;
    track.vy *= decay;
    track.cx += track.vx * dt * 0.3;
    track.cy += track.vy * dt * 0.3;
    track.box = {
      x: track.cx - track.box.w / 2,
      y: track.cy - track.box.h / 2,
      w: track.box.w,
      h: track.box.h,
      color: track.box.color,
      appear: track.appear
    };
    track.misses += 1;
  }


  function matchBox(prev, boxes, dt, vel) {
    if (!prev || !boxes || !boxes.length) return null;
    var cx = prev.x + prev.w / 2 + (vel ? vel.x * dt : 0);
    var cy = prev.y + prev.h / 2 + (vel ? vel.y * dt : 0);
    var pred = { x: cx - prev.w / 2, y: cy - prev.h / 2, w: prev.w, h: prev.h };
    var prevArea = Math.max(0.0001, prev.w * prev.h);
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      var c = boxCenter(b);
      var dist = Math.hypot(c.x - cx, c.y - cy);
      var area = Math.max(0.0001, b.w * b.h);
      var sizeRatio = Math.min(prevArea, area) / Math.max(prevArea, area);
      if (dist > 0.22) continue;
      if (sizeRatio < 0.32 && dist > 0.08) continue;
      var score = 0.32 * iou(pred, b) + 0.26 * Math.max(0, 1 - dist / 0.22) + 0.26 * sizeRatio + 0.16 * (1 - colorDist(prev.color, b.color));
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
    if (best && bestScore >= 0.28) return best;
    return null;
  }

  function seekTo(video, t) {
    return new Promise(function (resolve) {
      var duration = video.duration;
      var target = Number(t) || 0;
      if (isFinite(duration) && duration > 0) {
        target = Math.max(0, Math.min(target, Math.max(0, duration - 0.04)));
      } else {
        target = Math.max(0, target);
      }
      if (video.readyState >= 2 && Math.abs((video.currentTime || 0) - target) < 0.04) {
        resolve(video.currentTime || target);
        return;
      }
      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        video.removeEventListener("seeked", finish);
        video.removeEventListener("error", finish);
        resolve(video.currentTime || target);
      };
      video.addEventListener("seeked", finish);
      video.addEventListener("error", finish);
      try {
        video.currentTime = target;
      } catch (err) {
        finish();
        return;
      }
      setTimeout(finish, 1200);
    });
  }

  function playTo(video, t) {
    return new Promise(function (resolve) {
      var target = Math.max(0, t || 0);
      var duration = video.duration;
      if (isFinite(duration) && duration > 0) target = Math.min(target, Math.max(0, duration - 0.04));
      if (video.readyState >= 2 && video.currentTime >= target - 0.04) {
        try { video.pause(); } catch (err) {}
        resolve(video.currentTime);
        return;
      }
      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        video.removeEventListener("timeupdate", onTick);
        video.removeEventListener("ended", onEnd);
        try { video.pause(); } catch (err) {}
        resolve(video.currentTime || target);
      };
      var onTick = function () {
        if (video.currentTime >= target - 0.03) finish();
      };
      var onEnd = function () { finish(); };
      video.addEventListener("timeupdate", onTick);
      video.addEventListener("ended", onEnd);
      video.muted = true;
      video.playbackRate = 1;
      var play = video.play();
      if (play && play.catch) play.catch(function () { finish(); });
      setTimeout(finish, 6000);
    });
  }


  function collectDetections(video, interval, onProgress, shouldCancel, opts) {
    opts = opts || {};
    var duration = isFinite(video.duration) ? video.duration : 0;
    var step = interval || DEFAULT_INTERVAL;
    var samples = [];
    var startBox = opts.startBox || null;
    var template = null;
    var pred = startBox ? boxCenter(startBox) : { x: 0.5, y: 0.5 };
    var useDetect = !!MODEL && !detectorFailed;
    var courtHint = startBox ? estimateCourt([], startBox) : null;
    if (startBox && courtHint) courtHint.half = sideOf(startBox, courtHint);
    var targetAppear = startBox && startBox.appear ? startBox.appear : null;
    var visualMisses = 0;
    video.muted = true;
    video.pause();
    function capture(actual) {
      if (shouldCancel && shouldCancel()) return Promise.resolve(samples);
      var frame = grabFrame(video, DETECT_MAX);
      var tainted = isCanvasTainted(frame);
      if (tainted) {
        samples.push({ t: actual, boxes: [], tmpl: null, tainted: true });
        return Promise.resolve(samples);
      }
      if (startBox && !startBox.appear) {
        startBox.appear = appearanceOf(frame, startBox);
        if (startBox.appear && !targetAppear) targetAppear = startBox.appear;
      }
      if (!template && startBox) template = makeTemplate(frame, startBox);
      var detectPromise = useDetect ? detectPeople(video).catch(function () { return []; }) : Promise.resolve([]);
      return detectPromise.then(function (boxes) {
        boxes = enrichBoxes(frame, boxes || []);
        var searchR = Math.min(0.5, 0.14 + visualMisses * 0.06);
        var tmpl = template ? matchTemplate(frame, template, pred.x, pred.y, Math.min(searchR, 0.36)) : null;
        var visual = null;
        if ((!tmpl || (tmpl.score || 0) < 0.5) && targetAppear && startBox) {
          visual = locateByAppearance(frame, targetAppear, startBox, pred, courtHint, searchR);
        }
        function isStrongLocal(hit) {
          if (!hit) return false;
          if (hit.appear) {
            var pix = ((hit.appear.torso && hit.appear.torso.n) || 0) + ((hit.appear.shorts && hit.appear.shorts.n) || 0);
            if (pix < 50) return false;
          }
          return (hit.score || 0) >= 0.55;
        }
        var local = (visual && tmpl)
          ? ((visual.score || 0) >= (tmpl.score || 0) ? visual : tmpl)
          : (visual || tmpl);
        if (local && !isStrongLocal(local)) local = null;
        if (local) {
          pred = boxCenter(local);
          visualMisses = 0;
          if (local.appear) targetAppear = mixAppear(targetAppear, local.appear, 0.06);
        } else if (boxes && boxes.length && startBox && courtHint) {
          var snapped = snapStart(startBox, boxes, courtHint);
          if (snapped && snapped !== startBox) {
            pred = boxCenter(snapped);
            visualMisses = 0;
            local = snapped;
          } else {
            visualMisses += 1;
          }
        } else {
          visualMisses += 1;
        }
        samples.push({ t: actual, boxes: boxes || [], tmpl: local, tainted: false });
        if (onProgress) {
          var ratio = duration ? Math.min(1, (actual + step) / duration) : 0;
          onProgress(ratio, samples.length);
        }
        if (!duration) duration = video.duration || 0;
        if (!duration) return samples;
        var nextT = actual + step;
        if (nextT > duration - 0.02) {
          if (Math.abs(actual - duration) > 0.12) {
            return playTo(video, duration - 0.04).then(capture);
          }
          return samples;
        }
        return playTo(video, nextT).then(capture);
      });
    }
    return seekTo(video, 0).then(function (actual) {
      if (actual > 0.15) return playTo(video, 0).then(capture);
      return capture(actual);
    });
  }

  function associate(samples, startBox, t0, aspect) {
    if (!samples.length) return { keys: [], court: null, startBox: startBox };
    var closest = 0;
    var bestDt = Infinity;
    var i;
    for (i = 0; i < samples.length; i++) {
      var dt0 = Math.abs(samples[i].t - t0);
      if (dt0 < bestDt) {
        bestDt = dt0;
        closest = i;
      }
    }
    var sample0 = samples[closest];
    var boxes0 = (sample0.boxes || []).slice();
    if (sample0.tmpl) boxes0 = boxes0.concat([sample0.tmpl]);
    var courtGuess = estimateCourt(boxes0, startBox);
    var seedBox = snapStart(startBox, boxes0, courtGuess) || startBox || sample0.tmpl;
    if (!seedBox) seedBox = startBox;
    var court = estimateCourt(boxes0, seedBox);
    if (seedBox) court.half = sideOf(seedBox, court);
    var tracks = seedTracks(boxes0, seedBox, court);
    var target = null;
    for (i = 0; i < tracks.length; i++) if (tracks[i].target) target = tracks[i];
    if (!target && tracks.length) {
      tracks[0].target = true;
      target = tracks[0];
    }
    var keyframes = [];

    function emit(sample, box, held) {
      var pt = pointFromBox(box, aspect);
      keyframes.push({ t: sample.t, x: pt.x, y: pt.y, r: pt.r, c: held ? 0 : 1, box: box });
    }

    function stepTracks(sample, prevT) {
      var dt = Math.abs(sample.t - prevT) || DEFAULT_INTERVAL;
      var dets = (sample.boxes || []).slice();
      if (sample.tmpl) dets.push(sample.tmpl);
      var cost = tracks.map(function (tr) {
        return dets.map(function (det) { return pairCost(tr, det, dt, court); });
      });
      var assign = cost.length ? minCostAssign(cost) : [];
      var used = {};
      var t;
      for (t = 0; t < tracks.length; t++) {
        var di = assign[t];
        var tr = tracks[t];
        if (typeof di === "number" && di >= 0 && !used[di] && dets[di] && cost[t][di] < 90) {
          used[di] = true;
          updateTrack(tr, dets[di], dt, court);
        } else {
          // Never re-acquire a leftover detection that fails half/size/motion gates.
          holdTrack(tr, dt);
        }
      }
    }

    if (target) emit(sample0, target.box, false);

    function cloneTracks(list) {
      return list.map(function (tr) {
        return {
          box: tr.box,
          cx: tr.cx,
          cy: tr.cy,
          vx: 0,
          vy: 0,
          initH: tr.initH,
          half: tr.half,
          appear: tr.appear,
          target: tr.target,
          misses: 0
        };
      });
    }

    function walk(from, to, dir) {
      var prevT = samples[from].t;
      var idx;
      for (idx = from + dir; dir > 0 ? idx <= to : idx >= to; idx += dir) {
        var sample = samples[idx];
        stepTracks(sample, prevT);
        prevT = sample.t;
        var tgt = null;
        var t;
        for (t = 0; t < tracks.length; t++) if (tracks[t].target) tgt = tracks[t];
        if (tgt) emit(sample, tgt.box, tgt.misses > 0);
      }
    }

    var origin = cloneTracks(tracks);
    tracks = cloneTracks(origin);
    walk(closest, samples.length - 1, 1);
    tracks = cloneTracks(origin);
    walk(closest, 0, -1);

    keyframes.sort(function (a, b) { return a.t - b.t; });
    return { keys: keyframes, court: court, startBox: seedBox };
  }

  function videoAspect(video) {
    var w = video.videoWidth || 16;
    var h = video.videoHeight || 9;
    return h / w;
  }

  function trackPlayer(video, startBox, opts) {
    opts = opts || {};
    var interval = opts.interval || DEFAULT_INTERVAL;
    var aspect = videoAspect(video);
    var t0 = typeof opts.t0 === "number" ? opts.t0 : (video.currentTime || 0);
    var ready = MODEL ? Promise.resolve(MODEL) : loadDetector().catch(function () { return null; });
    return ready.then(function () {
      return collectDetections(video, interval, opts.onProgress, opts.shouldCancel, { startBox: startBox });
    }).then(function (samples) {
      if (opts.shouldCancel && opts.shouldCancel()) return null;
      if (samples.length && samples[0].tainted) {
        var err = new Error("tainted");
        err.code = "tainted";
        throw err;
      }
      var assoc = associate(samples, startBox, t0, aspect);
      var keys = assoc.keys || assoc;
      var detected = 0;
      var i;
      for (i = 0; i < keys.length; i++) if (keys[i].c) detected += 1;
      var duration = video.duration || (keys.length ? keys[keys.length - 1].t : 0);
      return {
        v: TRACK_VERSION,
        duration: duration,
        aspect: aspect,
        hold: HOLD_SEC,
        detected: detected,
        samples: samples.length,
        startBox: assoc.startBox || startBox,
        t0: t0,
        court: assoc.court || null,
        k: keys
      };
    });
  }

  function q(n, scale, clamp) {
    var v = Math.round((Number(n) || 0) * scale);
    if (clamp) return Math.max(0, Math.min(scale, v));
    return Math.max(0, v);
  }

  function pack(track) {
    if (!track) return null;
    if (track.m && !track.k) {
      return { v: track.v || TRACK_VERSION, d: q(track.duration || 0, 100), h: q(track.hold || HOLD_SEC, 100), m: [q(track.m[0], 1000, true), q(track.m[1], 1000, true), q(track.m[2], 1000, true)] };
    }
    var keys = track.k || [];
    var packed = {
      v: track.v || TRACK_VERSION,
      d: q(track.duration || 0, 100),
      a: q(track.aspect || 0.56, 1000, true),
      h: q(track.hold || HOLD_SEC, 100),
      k: keys.map(function (k) {
        return [q(k.t, 100), q(k.x, 1000, true), q(k.y, 1000, true), q(k.r, 1000, true), k.c ? 1 : 0];
      })
    };
    if (track.startBox) {
      packed.s = [
        q(track.startBox.x, 1000, true),
        q(track.startBox.y, 1000, true),
        q(track.startBox.w, 1000, true),
        q(track.startBox.h, 1000, true)
      ];
    }
    if (typeof track.t0 === "number") packed.t0 = q(track.t0, 100);
    if (track.court && typeof track.court.netY === "number") packed.n = q(track.court.netY, 1000, true);
    return packed;
  }

  function unpack(obj) {
    if (!obj) return null;
    if (typeof obj === "string") {
      try { obj = JSON.parse(obj); } catch (err) { return null; }
    }
    if (obj.m && !obj.k) {
      return {
        v: obj.v || 1,
        duration: (obj.d || 0) / 100,
        hold: (obj.h || HOLD_SEC * 100) / 100,
        m: [(obj.m[0] || 0) / 1000, (obj.m[1] || 0) / 1000, (obj.m[2] || DEFAULT_R * 1000) / 1000],
        k: []
      };
    }
    var keys = (obj.k || []).map(function (k) {
      return { t: (k[0] || 0) / 100, x: (k[1] || 0) / 1000, y: (k[2] || 0) / 1000, r: (k[3] || 0) / 1000, c: k[4] ? 1 : 0 };
    });
    var startBox = null;
    if (obj.s && obj.s.length >= 4) {
      startBox = { x: (obj.s[0] || 0) / 1000, y: (obj.s[1] || 0) / 1000, w: (obj.s[2] || 0) / 1000, h: (obj.s[3] || 0) / 1000 };
    }
    return {
      v: obj.v || 1,
      duration: (obj.d || 0) / 100,
      aspect: (obj.a || 560) / 1000,
      hold: (obj.h || HOLD_SEC * 100) / 100,
      startBox: startBox,
      t0: typeof obj.t0 === "number" ? obj.t0 / 100 : 0,
      court: typeof obj.n === "number" ? { netY: obj.n / 1000 } : null,
      k: keys
    };
  }

  function staticTrack(x, y, r, holdSec, duration) {
    return {
      v: 1,
      duration: duration || 0,
      hold: typeof holdSec === "number" ? holdSec : HOLD_SEC,
      m: [x, y, r || DEFAULT_R],
      k: []
    };
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }


  function atTime(track, time) {
    if (!track) return null;
    var t = Math.max(0, time || 0);
    if (track.m && (!track.k || !track.k.length)) {
      var hold = typeof track.hold === "number" ? track.hold : HOLD_SEC;
      if (t > hold) return { x: track.m[0], y: track.m[1], r: track.m[2], visible: false, fade: 0, static: true };
      var fade = t > hold - 0.6 ? Math.max(0, (hold - t) / 0.6) : 1;
      return { x: track.m[0], y: track.m[1], r: track.m[2], visible: true, fade: fade, static: true };
    }
    var keys = track.k || [];
    if (!keys.length) return null;
    if (t <= keys[0].t) {
      return { x: keys[0].x, y: keys[0].y, r: keys[0].r, visible: true, fade: keys[0].c ? 1 : 0.75, static: false };
    }
    var last = keys[keys.length - 1];
    if (t >= last.t) {
      return { x: last.x, y: last.y, r: last.r, visible: true, fade: last.c ? 1 : 0.7, static: false };
    }
    var lo = 0;
    var hi = keys.length - 1;
    while (lo + 1 < hi) {
      var mid = (lo + hi) >> 1;
      if (keys[mid].t <= t) lo = mid;
      else hi = mid;
    }
    var a = keys[lo];
    var b = keys[hi];
    var span = Math.max(0.0001, b.t - a.t);
    var u = (t - a.t) / span;
    var held = !(a.c && b.c);
    var fade = held ? 0.75 : 1;
    return {
      x: lerp(a.x, b.x, u),
      y: lerp(a.y, b.y, u),
      r: lerp(a.r, b.r, u),
      visible: true,
      fade: fade,
      static: false
    };
  }

  function pickBoxAtPoint(boxes, x, y, aspect) {
    var i;
    var inside = [];
    for (i = 0; i < (boxes || []).length; i++) {
      var b = boxes[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) inside.push(b);
    }
    if (inside.length) {
      inside.sort(function (a, b) { return a.w * a.h - b.w * b.h; });
      return inside[0];
    }
    var best = null;
    var bestD = Infinity;
    for (i = 0; i < (boxes || []).length; i++) {
      var c = boxCenter(boxes[i]);
      var d = Math.hypot(c.x - x, c.y - y);
      if (d < bestD) {
        bestD = d;
        best = boxes[i];
      }
    }
    if (best && bestD <= 0.14) return best;
    return null;
  }

  function defaultRadius() {
    return DEFAULT_R;
  }


  function startBoxFromTrack(track) {
    if (!track) return null;
    if (track.startBox && track.startBox.w > 0 && track.startBox.h > 0) return track.startBox;
    var keys = track.k || [];
    if (!keys.length) {
      if (track.m && track.m.length >= 2) {
        var rs = track.m[2] || DEFAULT_R;
        return { x: Math.max(0, track.m[0] - rs), y: Math.max(0, track.m[1] - rs), w: rs * 2, h: rs * 2 };
      }
      return null;
    }
    var k = keys[0];
    var aspect = track.aspect || 0.56;
    var r = Math.max(0.05, k.r || DEFAULT_R);
    var kRatio = 2.4;
    var factor = 0.55 * Math.sqrt(1 + (kRatio * aspect) * (kRatio * aspect));
    var w = r / Math.max(0.2, factor);
    var h = w * kRatio;
    var cy = k.y + h * 0.06;
    return {
      x: Math.max(0, k.x - w / 2),
      y: Math.max(0, cy - h / 2),
      w: w,
      h: h
    };
  }

  function isCurrentTrack(track) {
    return !!(track && (track.v || 1) >= TRACK_VERSION);
  }

  function isUsefulTrack(track) {
    if (!track) return false;
    if (track.m && (!track.k || !track.k.length)) return true;
    var keys = track.k || [];
    if (keys.length < 2) return false;
    var detected = 0;
    var i;
    for (i = 0; i < keys.length; i++) if (keys[i].c) detected += 1;
    if (detected >= 2) return true;
    return keys.length >= 4;
  }

  function fetchTrack(url) {
    if (!url) return Promise.resolve(null);
    return fetch(url, { mode: "cors" }).then(function (res) {
      if (!res.ok) throw new Error("track-http");
      return res.json();
    }).then(function (json) {
      return unpack(json) || json;
    });
  }


  global.PadelTrack = {
    loadDetector: loadDetector,
    detectPeople: detectPeople,
    seekTo: seekTo,
    grabFrame: grabFrame,
    trackPlayer: trackPlayer,
    pack: pack,
    unpack: unpack,
    staticTrack: staticTrack,
    atTime: atTime,
    pickBoxAtPoint: pickBoxAtPoint,
    pointFromBox: pointFromBox,
    boxCenter: boxCenter,
    defaultRadius: defaultRadius,
    isUsefulTrack: isUsefulTrack,
    isCurrentTrack: isCurrentTrack,
    startBoxFromTrack: startBoxFromTrack,
    TRACK_VERSION: TRACK_VERSION,
    fetchTrack: fetchTrack,
    isCanvasTainted: isCanvasTainted,
    getDetectorState: getDetectorState,
    HOLD_SEC: HOLD_SEC,
    DETECT_MAX: DETECT_MAX
  };
})(window);
