// Tiny static server with SPA fallback so /c/<code>, /k/<code>, /card/<id>
// and encoded-hash paths serve index.html. For local v28 verification only.
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.PORT || 8883);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json"
};

function safeJoin(urlPath) {
  let decoded = urlPath;
  try { decoded = decodeURIComponent(urlPath); } catch (err) {}
  const rel = decoded.replace(/^\/+/, "").replace(/\\/g, "/");
  const file = path.resolve(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  return file;
}

function send(res, status, body, type) {
  res.writeHead(status, { "Content-Type": type || "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url || "/", "http://127.0.0.1");
  let pathname = u.pathname || "/";
  if (pathname === "/") pathname = "/index.html";
  const file = safeJoin(pathname);
  if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
    return;
  }
  const index = path.join(root, "index.html");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  fs.createReadStream(index).pipe(res);
});

server.listen(port, "127.0.0.1", () => {
  console.log("SPA server http://127.0.0.1:" + port + "/  root=" + root);
});
