(function (global) {
  var MODEL = null;
  var loading = null;
  var detectorFailed = false;
  var detectorStatus = "idle";
  var TF_SRC = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
  var COCO_SRC = "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js";
  var DEFAULT_INTERVAL = 0.28;
  var HOLD_SEC = 4;
  var DEFAULT_R = 0.12;
  var DETECT_MAX = 640;
  var DETECTOR_TIMEOUT_MS = 14000;
  var PERSON_SCORE = 0.28;
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
    var ctx = c.getContext("2d");
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
    return detectOnCanvas(model, full).then(function (boxes) {
      var small = !boxes.length || boxes.every(function (b) { return b.h < 0.22 && b.w < 0.2; });
      var wide = vw >= 800;
      var needTiles = boxes.length < 3 || (wide && small);
      if (!needTiles) return boxes;
      var cols = vw >= 800 ? 2 : 1;
      var rows = vh >= 500 ? 2 : 1;
      if (cols * rows === 1) return boxes;
      var overlap = 0.22;
      var tileW = vw / (cols - (cols - 1) * overlap);
      var tileH = vh / (rows - (rows - 1) * overlap);
      var jobs = [];
      var meta = [];
      var r, c, sx, sy, sw, sh, canvas;
      for (r = 0; r < rows; r++) {
        for (c = 0; c < cols; c++) {
          sx = Math.max(0, Math.round(c * tileW * (1 - overlap)));
          sy = Math.max(0, Math.round(r * tileH * (1 - overlap)));
          sw = Math.min(tileW, vw - sx);
          sh = Math.min(tileH, vh - sy);
          canvas = cropSource(video, sx, sy, sw, sh, DETECT_MAX);
          jobs.push(runDetect(model, canvas));
          meta.push({ sx: sx, sy: sy, sw: sw, sh: sh, cw: canvas.width, ch: canvas.height, canvas: canvas });
        }
      }
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
      if (!template && startBox) template = makeTemplate(frame, startBox);
      var detectPromise = useDetect ? detectPeople(video).catch(function () { return []; }) : Promise.resolve([]);
      return detectPromise.then(function (boxes) {
        var tmpl = template ? matchTemplate(frame, template, pred.x, pred.y, 0.16) : null;
        if (tmpl) pred = boxCenter(tmpl);
        else if (boxes && boxes.length && startBox) {
          var m = matchBox(startBox, boxes, step, null);
          if (m) pred = boxCenter(m);
        }
        samples.push({ t: actual, boxes: boxes || [], tmpl: tmpl, tainted: false });
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
    if (!samples.length) return [];
    var closest = 0;
    var bestDt = Infinity;
    var i;
    for (i = 0; i < samples.length; i++) {
      var dt = Math.abs(samples[i].t - t0);
      if (dt < bestDt) {
        bestDt = dt;
        closest = i;
      }
    }
    var sample0 = samples[closest];
    var boxes0 = sample0.boxes || [];
    var current = matchBox(startBox, boxes0, 0, null) || sample0.tmpl || startBox;
    var keyframes = [];
    var vel = { x: 0, y: 0 };
    var misses = 0;

    function emit(sample, box, held) {
      var pt = pointFromBox(box, aspect);
      keyframes.push({ t: sample.t, x: pt.x, y: pt.y, r: pt.r, c: held ? 0 : 1, box: box });
    }

    emit(samples[closest], current, false);

    function acceptTemplate(prevBox, tmpl) {
      if (!tmpl) return null;
      var pc = boxCenter(prevBox);
      var tc = boxCenter(tmpl);
      var dist = Math.hypot(tc.x - pc.x, tc.y - pc.y);
      if (dist > 0.24) return null;
      return tmpl;
    }

    function walk(from, to, dir) {
      var prevBox = current;
      var prevT = samples[from].t;
      var prevVel = { x: vel.x * dir, y: vel.y * dir };
      var idx;
      for (idx = from + dir; dir > 0 ? idx <= to : idx >= to; idx += dir) {
        var sample = samples[idx];
        var dt = Math.abs(sample.t - prevT) || DEFAULT_INTERVAL;
        var matched = matchBox(prevBox, sample.boxes || [], dt, prevVel);
        if (!matched) matched = acceptTemplate(prevBox, sample.tmpl);
        if (matched) {
          var pc = boxCenter(prevBox);
          var mc = boxCenter(matched);
          prevVel = { x: (mc.x - pc.x) / dt, y: (mc.y - pc.y) / dt };
          prevBox = matched;
          prevT = sample.t;
          misses = 0;
          emit(sample, matched, false);
        } else {
          misses += 1;
          if (misses <= 2) {
            var held = {
              x: prevBox.x + prevVel.x * dt * 0.4,
              y: prevBox.y + prevVel.y * dt * 0.4,
              w: prevBox.w,
              h: prevBox.h,
              color: prevBox.color
            };
            prevVel = { x: prevVel.x * 0.4, y: prevVel.y * 0.4 };
            prevBox = held;
            prevT = sample.t;
            emit(sample, held, true);
          } else {
            emit(sample, prevBox, true);
            prevT = sample.t;
          }
        }
      }
    }

    var startBoxRef = current;
    walk(closest, samples.length - 1, 1);
    current = startBoxRef;
    vel = { x: 0, y: 0 };
    misses = 0;
    walk(closest, 0, -1);

    keyframes.sort(function (a, b) { return a.t - b.t; });
    return keyframes;
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
      var keys = associate(samples, startBox, t0, aspect);
      var detected = 0;
      var i;
      for (i = 0; i < keys.length; i++) if (keys[i].c) detected += 1;
      var duration = video.duration || (keys.length ? keys[keys.length - 1].t : 0);
      return {
        v: 1,
        duration: duration,
        aspect: aspect,
        hold: HOLD_SEC,
        detected: detected,
        samples: samples.length,
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
      return { v: 1, d: q(track.duration || 0, 100), h: q(track.hold || HOLD_SEC, 100), m: [q(track.m[0], 1000, true), q(track.m[1], 1000, true), q(track.m[2], 1000, true)] };
    }
    var keys = track.k || [];
    var packed = {
      v: 1,
      d: q(track.duration || 0, 100),
      a: q(track.aspect || 0.56, 1000, true),
      h: q(track.hold || HOLD_SEC, 100),
      k: keys.map(function (k) {
        return [q(k.t, 100), q(k.x, 1000, true), q(k.y, 1000, true), q(k.r, 1000, true), k.c ? 1 : 0];
      })
    };
    return packed;
  }

  function unpack(obj) {
    if (!obj) return null;
    if (typeof obj === "string") {
      try { obj = JSON.parse(obj); } catch (err) { return null; }
    }
    if (obj.m && !obj.k) {
      return {
        v: 1,
        duration: (obj.d || 0) / 100,
        hold: (obj.h || HOLD_SEC * 100) / 100,
        m: [(obj.m[0] || 0) / 1000, (obj.m[1] || 0) / 1000, (obj.m[2] || DEFAULT_R * 1000) / 1000],
        k: []
      };
    }
    var keys = (obj.k || []).map(function (k) {
      return { t: (k[0] || 0) / 100, x: (k[1] || 0) / 1000, y: (k[2] || 0) / 1000, r: (k[3] || 0) / 1000, c: k[4] ? 1 : 0 };
    });
    return {
      v: 1,
      duration: (obj.d || 0) / 100,
      aspect: (obj.a || 560) / 1000,
      hold: (obj.h || HOLD_SEC * 100) / 100,
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
    fetchTrack: fetchTrack,
    isCanvasTainted: isCanvasTainted,
    getDetectorState: getDetectorState,
    HOLD_SEC: HOLD_SEC,
    DETECT_MAX: DETECT_MAX
  };
})(window);
