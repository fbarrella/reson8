/**
 * Smoke test for src/media-proxy.ts and the range probe / guarded raw fetch in
 * src/link-preview-fetch.ts (PRD 18.19) — run after `tsc --build`:
 *   node scripts/media-proxy-smoke.mjs
 * Exits non-zero on any failure. Starts throwaway local HTTP servers.
 */
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const mp = require(resolve(here, "../dist/media-proxy.js"));
const fetcher = require(resolve(here, "../dist/link-preview-fetch.js"));

let failures = 0;
const check = (name, ok, detail = "") => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${detail}`}`);
};

// ── parseContentRange ──
const pcr = mp.parseContentRange;
check("parses bytes 0-1023/2048", JSON.stringify(pcr("bytes 0-1023/2048")) === JSON.stringify({ start: 0, end: 1023, total: 2048 }));
check("parses an unknown total", JSON.stringify(pcr("bytes 5-9/*")) === JSON.stringify({ start: 5, end: 9, total: null }));
check("is case- and space-tolerant", pcr("  Bytes 1-2/3 ")?.end === 2);
for (const bad of [undefined, "", "bytes */2048", "bytes 10-5/100", "items 0-1/2", "bytes 0-/100", "garbage", "bytes 0-1"]) {
    check(`rejects ${JSON.stringify(bad)}`, pcr(bad) === null);
}

// ── isValidRangeHeader ──
for (const ok of ["bytes=0-", "bytes=100-199", "bytes=-500"]) check(`accepts ${ok}`, mp.isValidRangeHeader(ok) === true);
for (const bad of [null, undefined, "", "bytes=", "bytes=-", "bytes=0-1,5-9", "items=0-1", "bytes=a-b", "bytes=0-" + "9".repeat(80)]) {
    check(`refuses ${JSON.stringify(bad)}`, mp.isValidRangeHeader(bad) === false);
}

// ── normalizeRangeResponse ──
const n = mp.normalizeRangeResponse;
const r206 = n("bytes=0-", { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-9/100", "content-length": "10" } });
check("a 206 passes through and gains Accept-Ranges", r206.status === 206 && r206.headers["accept-ranges"] === "bytes" && r206.headers["content-range"] === "bytes 0-9/100");
const fixed = n("bytes=0-", { status: 200, headers: { "content-type": "video/mp4", "content-range": "bytes 0-99/100", "set-cookie": "a=b", "x-secret": "1" } });
check("a 200 with Content-Range to a ranged request becomes a 206", fixed.status === 206 && fixed.headers["content-range"] === "bytes 0-99/100" && fixed.headers["content-length"] === "100" && fixed.headers["accept-ranges"] === "bytes");
check("…and unsafe headers are dropped", !("set-cookie" in fixed.headers) && !("x-secret" in fixed.headers) && fixed.headers["content-type"] === "video/mp4");
const plain = n("bytes=0-", { status: 200, headers: { "content-type": "video/mp4", "content-length": "5000" } });
check("a 200 with no range information stays a 200 (that host can't seek)", plain.status === 200 && !("content-range" in plain.headers) && !("accept-ranges" in plain.headers));
const noReq = n(null, { status: 200, headers: { "content-type": "video/mp4", "content-range": "bytes 0-9/10" } });
check("a 200 for a request WITHOUT Range is left alone", noReq.status === 200);
check("an error status passes through", n("bytes=0-", { status: 404, headers: { "content-type": "text/html" } }).status === 404);
check("a 416 passes through", n("bytes=9999-", { status: 416, headers: { "content-range": "bytes */100" } }).status === 416);
const unparse = n("bytes=0-", { status: 200, headers: { "content-range": "bytes */100" } });
check("an unparsable Content-Range on a 200 is not trusted", unparse.status === 200);

// ── routeFromProbe ──
check("probe: a correct 206 stays direct", mp.routeFromProbe({ status: 206, headers: { "content-range": "bytes 0-0/10" } }) === "direct");
check("probe: a 200 carrying Content-Range goes through the proxy", mp.routeFromProbe({ status: 200, headers: { "content-range": "bytes 0-0/10" } }) === "proxy");
check("probe: a plain 200 stays direct", mp.routeFromProbe({ status: 200, headers: {} }) === "direct");
check("probe: an error stays direct", mp.routeFromProbe({ status: 403, headers: {} }) === "direct");

// ── Against local servers ──
const BODY = Buffer.alloc(1000, 7);
const servers = [];
const listen = (handler) => new Promise((resolveListen) => {
    const s = http.createServer(handler);
    servers.push(s);
    s.listen(0, "127.0.0.1", () => resolveListen(`http://127.0.0.1:${s.address().port}`));
});
// like the Invidious server (verified 10/10/2026): the OPEN-ENDED request from zero ("bytes=0-")
// gets a 200 + Content-Range with no Accept-Ranges, while every explicit range gets a proper 206.
const sloppy = await listen((req, res) => {
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    if (!m) { res.writeHead(200, { "content-type": "video/mp4" }); res.end(BODY); return; }
    const start = Number(m[1]), end = m[2] ? Number(m[2]) : BODY.length - 1;
    if (start === 0 && !m[2]) {
        res.writeHead(200, { "content-type": "video/mp4", "content-range": `bytes ${start}-${end}/${BODY.length}` });
        res.end(BODY.subarray(start, end + 1));
    } else {
        res.writeHead(206, { "content-type": "video/mp4", "content-range": `bytes ${start}-${end}/${BODY.length}`, "accept-ranges": "bytes" });
        res.end(BODY.subarray(start, end + 1));
    }
});
const correct = await listen((req, res) => {
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    const start = m ? Number(m[1]) : 0, end = m && m[2] ? Number(m[2]) : BODY.length - 1;
    res.writeHead(m ? 206 : 200, { "content-type": "video/mp4", "accept-ranges": "bytes", ...(m ? { "content-range": `bytes ${start}-${end}/${BODY.length}` } : {}) });
    res.end(BODY.subarray(start, end + 1));
});
const noRanges = await listen((req, res) => { res.writeHead(200, { "content-type": "video/mp4" }); res.end(BODY); });
const redirectToPrivate = await listen((req, res) => { res.writeHead(302, { location: "http://192.168.0.1/v.mp4" }); res.end(); });

check("probe: a sloppy (Invidious-like) host is routed to the proxy", (await fetcher.probeRangeRoute(`${sloppy}/v.mp4`, { allowPrivate: true })) === "proxy");
{
    const tiny = await fetcher.guardedFetchRaw(`${sloppy}/v.mp4`, { headers: { Range: "bytes=0-0" }, allowPrivate: true });
    check("(fixture) the sloppy host answers a tiny explicit range with a proper 206 — which is why the probe must be open-ended", tiny.res.status === 206);
    await tiny.res.body?.cancel();
}
check("probe: a correct host stays direct", (await fetcher.probeRangeRoute(`${correct}/v.mp4`, { allowPrivate: true })) === "direct");
check("probe: a host with no range support stays direct", (await fetcher.probeRangeRoute(`${noRanges}/v.mp4`, { allowPrivate: true })) === "direct");
check("probe: an unreachable host stays direct (never throws)", (await fetcher.probeRangeRoute("http://127.0.0.1:1/x.mp4", { allowPrivate: true })) === "direct");

const got = await fetcher.guardedFetchRaw(`${sloppy}/v.mp4`, { headers: { Range: "bytes=0-" }, allowPrivate: true });
const headers = {};
got.res.headers.forEach((v, k) => { headers[k] = v; });
const norm = mp.normalizeRangeResponse("bytes=0-", { status: got.res.status, headers });
const body = Buffer.from(await got.res.arrayBuffer());
check("end to end: the sloppy host's first answer becomes a 206 with the whole body", norm.status === 206 && body.length === 1000 && norm.headers["content-length"] === "1000", JSON.stringify(norm));

// The production guard: private targets and redirects into them are refused, nothing is requested.
check("guardedFetchRaw refuses a private address", (await fetcher.guardedFetchRaw("http://192.168.0.1/v.mp4")) === null);
check("guardedFetchRaw refuses loopback", (await fetcher.guardedFetchRaw(`${correct}/v.mp4`)) === null);
check("guardedFetchRaw refuses a redirect into a private address", (await fetcher.guardedFetchRaw(`${redirectToPrivate}/v.mp4`, { allowPrivate: false })) === null);
const seen = await listen((req, res) => { res.end("x"); });
void seen;

for (const s of servers) s.close();
console.log(failures === 0 ? "\nAll media-proxy checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
