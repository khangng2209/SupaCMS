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
  const cleaned = html.replace(/<!--[sS]*?Made in Framer[sS]*?-->/gi, "");
  const guard = '<style id="nce-framer-chrome-guard">#__framer-editorbar-button,.framer-6jWyo,.framer-n0ccwk,.framer-v-n0ccwk,.framer-bmpgw8,.__framer-badge,[class*="framer-badge"],[id*="framer-badge"],[data-framer-badge],[href*="framer.com"][aria-label*="Made"]{display:none!important;visibility:hidden!important;pointer-events:none!important}</style>';
  return cleaned.includes("</head>") ? cleaned.replace("</head>", guard + "</head>") : cleaned;
}

function rewriteSourceOrigin(body, targetOrigin) {
  const escapedSource = sourceOrigin.split("/").join("\\/");
  const escapedTarget = targetOrigin.split("/").join("\\/");
  return body
    .replaceAll(sourceOrigin, targetOrigin)
    .replaceAll(escapedSource, escapedTarget);
}

function rewriteLiveBody(body, contentType, targetOrigin) {
  const rewritten = rewriteSourceOrigin(body, targetOrigin);
  return /text\/html/i.test(contentType) ? stripFramerChrome(rewritten) : rewritten;
}

function fallbackRobots(targetOrigin) {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Sitemap: " + targetOrigin + "/sitemap.xml",
    "",
  ].join("\n");
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
  const headers = {
    accept: req.headers.accept || "text/html,application/xhtml+xml",
    "cache-control": "no-cache",
    pragma: "no-cache",
  };
  const response = await fetch(upstream, { headers, redirect: "follow", cache: "no-store" });
  const contentType = response.headers.get("content-type") || "text/html; charset=utf-8";
  let body = await response.text();
  const host = req.headers.host || "localhost:" + port;
  const localOrigin = "http://" + host;
  const upstreamFailedRobots = requestUrl.pathname === "/robots.txt" && response.status >= 400;
  if (upstreamFailedRobots) {
    body = fallbackRobots(localOrigin);
  } else {
    body = rewriteLiveBody(body, contentType, localOrigin);
  }

  res.writeHead(upstreamFailedRobots ? 200 : response.status, {
    "content-type": requestUrl.pathname === "/robots.txt" && response.status >= 400 ? "text/plain; charset=utf-8" : contentType,
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
