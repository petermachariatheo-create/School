import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Static file serving for the built client application.
 *
 * In production the server hosts the PWA itself, so the whole product runs
 * from one process on one port — which matters on a school network where
 * port forwarding and extra machines are a liability.
 */

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export interface StaticHandlerOptions {
  readonly root: string;
  /** Directory that must exist for static serving to be enabled. */
  readonly indexFile?: string;
}

/**
 * Serve a file from the client build.
 *
 * Returns `false` when the request is not for a static asset, so that the
 * caller can fall through to the API routes.
 */
export function createStaticHandler(options: StaticHandlerOptions) {
  const root = path.resolve(options.root);

  return function serveStatic(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): boolean {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return false;
    }
    if (!fs.existsSync(root)) {
      return false;
    }

    const relative = pathname === "/" ? "/index.html" : pathname;
    const resolved = path.resolve(root, `.${relative}`);

    // Refuse to serve anything outside the build directory.
    if (!resolved.startsWith(root)) {
      return false;
    }

    let target = resolved;
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      // Single-page application fallback: unknown routes render the shell.
      target = path.join(root, "index.html");
      if (!fs.existsSync(target)) {
        return false;
      }
    }

    const extension = path.extname(target).toLowerCase();
    const contentType = CONTENT_TYPES[extension] ?? "application/octet-stream";
    // Vite emits hashed names such as `index-BSN9SNuc.js`: a dash separator
    // and a base64-style hash, not the dot-and-hex form of older bundlers.
    const isHashedAsset = /[-.][A-Za-z0-9_-]{8,}\.(js|css|woff2|png|svg)$/.test(
      path.basename(target),
    );
    const cacheControl = isHashedAsset
      ? "public, max-age=31536000, immutable"
      : extension === ".html"
        ? "no-cache"
        : "public, max-age=3600";

    const body = fs.readFileSync(target);
    res.writeHead(200, {
      "content-type": contentType,
      "content-length": body.length,
      "cache-control": cacheControl,
    });
    if (req.method === "HEAD") {
      res.end();
    } else {
      res.end(body);
    }
    return true;
  };
}
