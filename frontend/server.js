const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const path = require("path");
const fs = require("fs");

const dev = false;
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const MIME = {
  ".css":   "text/css; charset=utf-8",
  ".js":    "application/javascript; charset=utf-8",
  ".mjs":   "application/javascript; charset=utf-8",
  ".json":  "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff":  "font/woff",
  ".ttf":   "font/ttf",
  ".svg":   "image/svg+xml",
  ".png":   "image/png",
  ".jpg":   "image/jpeg",
  ".jpeg":  "image/jpeg",
  ".ico":   "image/x-icon",
  ".webp":  "image/webp",
};

const STATIC_DIR = path.join(__dirname, ".next", "static");
const PUBLIC_DIR = path.join(__dirname, "public");

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";

  fs.stat(filePath, (err, stat) => {
    if (err) return false;

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": stat.size,
    });
    fs.createReadStream(filePath).pipe(res);
    return true;
  });
  return true;
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    const { pathname } = parsedUrl;

    // Serve /_next/static/ directly with correct MIME types
    if (pathname.startsWith("/_next/static/")) {
      const relativePath = pathname.replace("/_next/static/", "");
      const filePath = path.join(STATIC_DIR, relativePath);

      fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME[ext] || "application/octet-stream";

        res.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Length": stat.size,
        });
        fs.createReadStream(filePath).pipe(res);
      });
      return;
    }

    // Let Next.js handle everything else
    handle(req, res, parsedUrl);
  }).listen(port, hostname, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
