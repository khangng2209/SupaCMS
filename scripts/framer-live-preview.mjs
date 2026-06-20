#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const root = resolve(process.env.NCE_ROOT || process.cwd());
const port = Number(process.env.PORT || 4174);
const manifest = JSON.parse(await readFile(join(root, "framer-live.json"), "utf8"));
const sourceOrigin = new URL(manifest.sourceOrigin).origin;
const prefixes = manifest.cmsRoutePrefixes || [];
const livePages = new Set(manifest.cmsPagePaths || []);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function isLiveCmsPath(pathname) {
  const normalized = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return livePages.has(normalized) || prefixes.some((prefix) => normalized.startsWith(prefix + "/"));
}

function localPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const segments = decoded.split("/").filter((segment) => segment && segment !== "." && segment !== "..");
  return join(root, ...segments);
}

function stripFramerChrome(html) {
  return html
    .replace(/<a[^>]*href\s*=\s*["'][^"']*framer\.com[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (match) => /__framer-(?:badge|toolbar|editor)|framer-badge|framer-toolbar|FramerBadge|FramerSiteControlBar|badge-container|framerbadge/i.test(match) ? "" : match)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (match) => /framer-badge|badge-container|framerbadge/i.test(match) ? "" : match)
    .replace(/<[^>]*(?:framer-badge|framerbadge|badge-container)[^>]*>[\s\S]*?<\/[^>]+>/gi, "");
}

async function readStatic(pathname) {
  const base = localPath(pathname);
  const candidates = pathname.endsWith("/")
    ? [join(base, "index.html")]
    : [base, join(base, "index.html")];

  for (const candidate of candidates) {
    if (!candidate.startsWith(root)) continue;
    try {
      if ((await stat(candidate)).isFile()) return { path: candidate, body: await readFile(candidate) };
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

async function proxyFramer(req, res, requestUrl) {
  const upstream = new URL(requestUrl.pathname + requestUrl.search, sourceOrigin);
  const headers = { accept: req.headers.accept || "text/html,application/xhtml+xml" };
  const response = await fetch(upstream, { headers, redirect: "follow" });
  let body = await response.text();
  const host = req.headers.host || "localhost:" + port;
  const localOrigin = "http://" + host;
  body = stripFramerChrome(body).replaceAll(sourceOrigin, localOrigin);

  res.writeHead(response.status, {
    "content-type": response.headers.get("content-type") || "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-nocodeexport-framer-live": "1",
    "x-nocodeexport-source": upstream.origin,
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host || "localhost:" + port;
    const requestUrl = new URL(req.url || "/", "http://" + host);
    if (isLiveCmsPath(requestUrl.pathname)) {
      await proxyFramer(req, res, requestUrl);
      return;
    }

    const file = await readStatic(requestUrl.pathname);
    if (file) {
      res.writeHead(200, {
        "content-type": mime[extname(file.path).toLowerCase()] || "application/octet-stream",
        "cache-control": "no-cache",
      });
      res.end(file.body);
      return;
    }

    const notFound = await readStatic("/404.html");
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end(notFound?.body || "404 Not Found");
  } catch (error) {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("Framer live request failed: " + (error instanceof Error ? error.message : String(error)));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`NoCodeExport Framer live preview: http://127.0.0.1:${port}`);
  console.log(`CMS detail routes: ${prefixes.join(", ") || "none"}`);
  console.log(`CMS list pages: ${[...livePages].join(", ") || "none"}`);
});
