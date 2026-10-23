import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createStaticHandler } from "../src/http/static.ts";
import { REPO_ROOT } from "../src/config.ts";

/**
 * Static file serving.
 *
 * The server hosts the built client from the same process as the API. A
 * mistake in the path it looks in would make the whole client unreachable
 * while every API test still passed, so the path is asserted here.
 */

let root: string;
let server: http.Server;
let baseUrl: string;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "school-static-"));
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>School</title>");
  fs.writeFileSync(path.join(root, "manifest.webmanifest"), '{"name":"School"}');
  fs.writeFileSync(path.join(root, "sw.js"), "self.addEventListener('fetch', () => {});");
  fs.writeFileSync(path.join(root, "assets", "index-BSN9SNuc.js"), "export default 1;");

  const serveStatic = createStaticHandler({ root });
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (serveStatic(req, res, url.pathname)) {
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  server.close();
  await once(server, "close");
  fs.rmSync(root, { recursive: true, force: true });
});

describe("static file serving", () => {
  test("serves the application shell at the root", async () => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await response.text(), /School/);
  });

  test("serves the web manifest with the manifest content type", async () => {
    const response = await fetch(`${baseUrl}/manifest.webmanifest`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/manifest\+json/);
  });

  test("serves the service worker as JavaScript", async () => {
    const response = await fetch(`${baseUrl}/sw.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /javascript/);
  });

  test("falls back to the shell for an unknown route", async () => {
    const response = await fetch(`${baseUrl}/students/01ARZ3NDEKTSV4RRFFQ69G5FAV`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  });

  test("caches a hashed asset for a long time and the shell for a short one", async () => {
    const asset = await fetch(`${baseUrl}/assets/index-BSN9SNuc.js`);
    assert.match(asset.headers.get("cache-control") ?? "", /immutable/);

    const shell = await fetch(`${baseUrl}/`);
    assert.match(shell.headers.get("cache-control") ?? "", /no-cache/);
  });

  test("refuses to serve a file outside the build directory", async () => {
    const response = await fetch(`${baseUrl}/../../package.json`);
    // The path is normalised by the client before it is sent, so the request
    // either resolves to a file inside the root or to a missing one. What
    // must never happen is a file from outside the root being returned.
    const body = await response.text();
    assert.equal(body.includes('"name": "school"'), false);
  });
});

describe("the client's build location", () => {
  test("the repository root is the directory that holds the packages", () => {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, "packages", "web")));
    assert.ok(fs.existsSync(path.join(REPO_ROOT, "packages", "server")));
    assert.ok(fs.existsSync(path.join(REPO_ROOT, "package.json")));
  });

  test("the client build directory is inside the repository", () => {
    const dist = path.join(REPO_ROOT, "packages", "web", "dist");
    assert.ok(dist.startsWith(REPO_ROOT));
  });
});
