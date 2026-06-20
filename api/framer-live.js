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
  return html
    .replace(/<a[^>]*href\s*=\s*["'][^"']*framer\.com[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (match) => /__framer-(?:badge|toolbar|editor)|framer-badge|framer-toolbar|FramerBadge|FramerSiteControlBar|badge-container|framerbadge/i.test(match) ? "" : match)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (match) => /framer-badge|badge-container|framerbadge/i.test(match) ? "" : match)
    .replace(/<[^>]*(?:framer-badge|framerbadge|badge-container)[^>]*>[\s\S]*?<\/[^>]+>/gi, "");
}

export default async function handler(req, res) {
  try {
    const livePath = pickLivePath(req);
    const upstream = new URL(livePath.pathname + livePath.search, sourceOrigin);
    const response = await fetch(upstream, {
      headers: {
        accept: req.headers.accept || "text/html,application/xhtml+xml",
        "user-agent": req.headers["user-agent"] || "NoCodeExport-Framer-Live",
      },
      redirect: "follow",
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
