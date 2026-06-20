const manifest = {
  "version": 1,
  "sourceOrigin": "https://shy-pluto-778062.framer.app",
  "cmsRoutePrefixes": [
    "/case-studies",
    "/work"
  ],
  "cmsPagePaths": [
    "/",
    "/case-studies",
    "/sitemap.xml",
    "/work"
  ]
};

const sourceOrigin = new URL(manifest.sourceOrigin).origin;

function firstHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}

function requestOrigin(req) {
  const host = firstHeader(req.headers["x-forwarded-host"]) || req.headers.host || "";
  const proto = firstHeader(req.headers["x-forwarded-proto"]) || "https";
  return host ? proto + "://" + host : sourceOrigin;
}

function pickLivePath(req) {
  const base = "https://" + (req.headers.host || "local.invalid");
  const url = new URL(req.url || "/", base);
  const path = url.searchParams.get("path") || url.pathname;
  url.searchParams.delete("path");
  return {
    pathname: path.startsWith("/") ? path : "/" + path,
    search: url.searchParams.toString() ? "?" + url.searchParams.toString() : "",
  };
}

function stripFramerChrome(html) {
  const cleaned = html.replace(/<!--[sS]*?Made in Framer[sS]*?-->/gi, "");
  const guard = '<style id="nce-framer-chrome-guard">#__framer-editorbar-button,.framer-6jWyo,.framer-n0ccwk,.framer-v-n0ccwk,.framer-bmpgw8,.__framer-badge,[class*="framer-badge"],[id*="framer-badge"],[data-framer-badge],[href*="framer.com"][aria-label*="Made"]{display:none!important;visibility:hidden!important;pointer-events:none!important}</style>';
  return cleaned.includes("</head>") ? cleaned.replace("</head>", guard + "</head>") : cleaned;
}

export default async function handler(req, res) {
  try {
    const livePath = pickLivePath(req);
    const upstream = new URL(livePath.pathname + livePath.search, sourceOrigin);
    const response = await fetch(upstream, {
      headers: {
        accept: req.headers.accept || "text/html,application/xhtml+xml",
        "cache-control": "no-cache",
        pragma: "no-cache",
        "user-agent": req.headers["user-agent"] || "NoCodeExport-Framer-Live",
      },
      redirect: "follow",
      cache: "no-store",
    });

    const contentType = response.headers.get("content-type") || "text/html; charset=utf-8";
    let body = await response.text();
    body = stripFramerChrome(body).replaceAll(sourceOrigin, requestOrigin(req));

    res.statusCode = response.status;
    res.setHeader("content-type", contentType);
    res.setHeader("cache-control", "no-store, max-age=0, must-revalidate");
    res.setHeader("cdn-cache-control", "no-store");
    res.setHeader("vercel-cdn-cache-control", "no-store");
    res.setHeader("x-nocodeexport-framer-live", "1");
    res.setHeader("x-nocodeexport-source", upstream.origin);
    res.end(body);
  } catch (error) {
    res.statusCode = 502;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Framer live request failed: " + (error instanceof Error ? error.message : String(error)));
  }
}
