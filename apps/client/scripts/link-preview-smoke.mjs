/**
 * Smoke test for src/link-preview-guard.ts and src/link-preview-fetch.ts
 * (PRD 18.10) — run after `tsc --build`:
 *   node scripts/link-preview-smoke.mjs
 * Exits non-zero on any failure. Starts throwaway local HTTP servers.
 */
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const guard = require(resolve(here, "../dist/link-preview-guard.js"));
const fetcher = require(resolve(here, "../dist/link-preview-fetch.js"));
const adult = require(resolve(here, "../dist/link-preview-adult.js"));

let failures = 0;
const check = (name, ok, detail = "") => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${detail}`}`);
};
const stream = (chunks) =>
    new ReadableStream({
        start(c) {
            for (const ch of chunks) c.enqueue(typeof ch === "string" ? new TextEncoder().encode(ch) : ch);
            c.close();
        },
    });

// ── Addresses ──
for (const ip of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "127.255.255.255", "169.254.169.254", "172.16.0.1", "172.31.255.255",
    "192.0.0.5", "192.168.1.1", "198.18.0.1", "198.19.255.255", "224.0.0.1", "239.1.1.1", "240.0.0.1", "255.255.255.255",
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1",
    "64:ff9b::7f00:1", "2002:7f00:1::1", "::127.0.0.1", "garbage"]) {
    check(`${ip} is blocked`, guard.isBlockedAddress(ip) === true);
}
for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.255.255", "172.32.0.0", "100.63.255.255", "100.128.0.0", "198.17.255.255",
    "198.20.0.0", "223.255.255.255", "192.0.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::808:808"]) {
    check(`${ip} is public`, guard.isBlockedAddress(ip) === false);
}

// ── Hostnames and URLs ──
for (const h of ["localhost", "LOCALHOST", "app.localhost", "printer.local", "db.internal", "router.home.arpa", "nas", "127.0.0.1", "[::1]", "10.0.0.5", "foo.lan", "localhost."]) {
    check(`host ${h} is blocked`, guard.isBlockedHostname(h) === true);
}
for (const h of ["example.com", "www.youtube.com", "8.8.8.8", "sub.domain.example.org"]) {
    check(`host ${h} is allowed`, guard.isBlockedHostname(h) === false);
}
check("checkPreviewUrl accepts a public https URL", guard.checkPreviewUrl("https://example.com/a?b=1").ok === true);
for (const u of ["ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)", "http://user:pw@example.com/", "http://192.168.0.1/",
    "http://localhost:3000/", "http://[::1]/", "http://2130706433/", "http://0x7f.1/", "http://0177.0.0.1/", "not a url", "http://intranet/"]) {
    check(`checkPreviewUrl refuses ${u}`, guard.checkPreviewUrl(u).ok === false);
}
check("a redirect to a public URL is followed (relative too)", guard.nextRedirectUrl("https://a.example/x", "/y") === "https://a.example/y");
check("a redirect into a private address is refused", guard.nextRedirectUrl("https://a.example/x", "http://192.168.0.1/admin") === null);
check("a redirect to localhost is refused", guard.nextRedirectUrl("https://a.example/x", "http://localhost/") === null);
check("a redirect to a non-http scheme is refused", guard.nextRedirectUrl("https://a.example/x", "file:///etc/passwd") === null);

// ── Charset sniffing ──
const enc = (s) => new TextEncoder().encode(s);
check("charset from the header wins", guard.sniffCharset("text/html; charset=ISO-8859-1", enc("<meta charset=utf-8>")) === "iso-8859-1");
check("charset from <meta charset>", guard.sniffCharset("text/html", enc('<html><head><meta charset="windows-1252">')) === "windows-1252");
check("charset from http-equiv", guard.sniffCharset(null, enc('<meta http-equiv="Content-Type" content="text/html; charset=shift_jis">')) === "shift_jis");
check("charset defaults to utf-8", guard.sniffCharset(null, enc("<html>")) === "utf-8");

// ── Head reader ──
const head = "<html><head><title>T</title><meta property='og:title' content='X'></HEAD><body>" + "A".repeat(500_000);
let read = 0;
const counted = new ReadableStream({
    pull(c) {
        read += 1;
        if (read > 50) { c.close(); return; }
        c.enqueue(enc(head.slice((read - 1) * 20000, read * 20000)));
    },
});
const headText = await guard.readHtmlHead(counted, "text/html");
check("stops at </head> (case-insensitive) and returns up to it", headText.endsWith("</HEAD>") && !headText.includes("AAAA"));
check("…without reading the whole stream", read < 5, `chunks pulled: ${read}`);
const big = await guard.readHtmlHead(stream(["<html><head>", "x".repeat(2000), ...Array(200).fill("y".repeat(10_000))]), "text/html", 100_000);
check("stops at the byte cap when there is no </head>", big.length >= 100_000 && big.length < 200_000, `len=${big.length}`);
const euro = new TextEncoder().encode("<head><title>€uro ✓</title></head>");
const cut = euro.indexOf(0xe2) + 1; // split the 3-byte "€"
const split = await guard.readHtmlHead(stream([euro.slice(0, cut), euro.slice(cut)]), "text/html; charset=utf-8");
check("a multi-byte character split across chunks survives", split.includes("€uro ✓"), split);
const latin = Buffer.from("<head><title>caf\xe9</title></head>", "latin1");
check("ISO-8859-1 pages decode correctly", (await guard.readHtmlHead(stream([latin]), "text/html; charset=ISO-8859-1")).includes("café"));
check("an unknown charset label falls back to utf-8", (await guard.readHtmlHead(stream([enc("<head>ok</head>")]), "text/html; charset=no-such-charset")).includes("ok"));
check("an empty body gives an empty string", (await guard.readHtmlHead(stream([]), "text/html")) === "");

// ── Cache ──
let clock = 1000;
const lru = new guard.TtlLru(3, () => clock);
lru.set("a", 1, 100); lru.set("b", 2, 100); lru.set("c", 3, 100);
check("entries are returned before they expire", lru.get("a") === 1 && lru.get("b") === 2);
lru.set("d", 4, 100);
check("the least recently used entry is evicted at the cap", lru.get("c") === undefined && lru.get("a") === 1 && lru.get("d") === 4, `size=${lru.size}`);
clock += 101;
check("entries expire after their TTL", lru.get("a") === undefined && lru.get("d") === undefined);
lru.set("n", null, 100);
check("a cached null is distinguishable from a miss", lru.get("n") === null && lru.get("zzz") === undefined);

// ── The fetch, against local servers ──
const seen = [];
let slowBytes = 0;
const server = http.createServer((req, res) => {
    seen.push(req.url);
    const u = req.url;
    if (u === "/page") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end('<html><head><title>Hello</title><meta property="og:description" content="A &amp; B"><meta property="og:image" content="https://example.com/i.png"><meta property="og:site_name" content="Site"></head><body>hi</body></html>');
    } else if (u === "/adult") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end('<html><head><title>A</title><meta property="og:restrictions:age" content="18+"><meta property="og:image" content="https://example.com/a.png"></head></html>');
    } else if (u === "/rated") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end('<html><head><title>R</title><meta name="rating" content="adult"></head></html>');
    } else if (u === "/img.png") {
        res.writeHead(200, { "content-type": "image/png", "content-length": "67" });
        res.end(Buffer.alloc(67));
    } else if (u === "/huge.png") {
        res.writeHead(200, { "content-type": "image/png", "content-length": String(30 * 1024 * 1024) });
        res.end();
    } else if (u === "/svg") {
        res.writeHead(200, { "content-type": "image/svg+xml" });
        res.end("<svg/>");
    } else if (u === "/file.zip") {
        res.writeHead(200, { "content-type": "application/zip" });
        res.end("PK");
    } else if (u === "/redirect") {
        res.writeHead(302, { location: "/page" });
        res.end();
    } else if (u === "/loop") {
        res.writeHead(302, { location: "/loop" });
        res.end();
    } else if (u === "/to-private") {
        res.writeHead(302, { location: "http://192.168.0.1/admin" });
        res.end();
    } else if (u === "/endless") {
        res.writeHead(200, { "content-type": "text/html" });
        res.write("<html><head>");
        const t = setInterval(() => { slowBytes += 65536; res.write("z".repeat(65536)); }, 1);
        res.on("close", () => clearInterval(t));
    } else if (u === "/stalls") {
        res.writeHead(200, { "content-type": "text/html" });
        res.write("<html><head><title>Slow");
        // never finishes
    } else if (u === "/404") {
        res.writeHead(404, { "content-type": "text/html" });
        res.end("<title>nope</title>");
    } else {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html><head></head></html>");
    }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const T = { allowPrivate: true };

const page = await fetcher.fetchLinkPreviewFast(`${base}/page`, T);
check("an HTML page yields a card (title, entity-decoded description, image, site)",
    page && page.title === "Hello" && page.description === "A & B" && page.image === "https://example.com/i.png" && page.siteName === "Site", JSON.stringify(page));
const direct = await fetcher.fetchLinkPreviewFast(`${base}/img.png`, T);
check("an image link becomes a direct-image preview", direct && direct.kind === "image" && direct.image === `${base}/img.png`, JSON.stringify(direct));
check("an image over 20 MB is not previewed", (await fetcher.fetchLinkPreviewFast(`${base}/huge.png`, T)) === null);
check("an SVG is not a direct image (and is not HTML)", (await fetcher.fetchLinkPreviewFast(`${base}/svg`, T)) === fetcher.NOT_HTML);
check("a zip is NOT_HTML (never escalates to the browser window)", (await fetcher.fetchLinkPreviewFast(`${base}/file.zip`, T)) === fetcher.NOT_HTML);
const redirected = await fetcher.fetchLinkPreviewFast(`${base}/redirect`, T);
check("a relative redirect is followed", redirected && redirected.title === "Hello", JSON.stringify(redirected));
check("a redirect loop ends in null", (await fetcher.fetchLinkPreviewFast(`${base}/loop`, T)) === null);
check("a 404 is null", (await fetcher.fetchLinkPreviewFast(`${base}/404`, T)) === null);
const t0 = Date.now();
const endless = await fetcher.fetchLinkPreviewFast(`${base}/endless`, { ...T, deadlineMs: 3000 });
const took = Date.now() - t0;
check("an endless body stops at the 1 MB cap, fast, not after the deadline", endless === null && took < 2500 && slowBytes < 8 * 1024 * 1024, `took=${took}ms bytes=${slowBytes}`);
const t1 = Date.now();
const stalled = await fetcher.fetchLinkPreviewFast(`${base}/stalls`, { ...T, deadlineMs: 1200 });
check("a body that stalls is cut by the overall deadline", stalled === null && Date.now() - t1 < 2500, `took=${Date.now() - t1}ms`);

// The production guard: the same local server must receive NOTHING.
seen.length = 0;
const guarded = [
    await fetcher.fetchLinkPreviewFast(`${base}/page`),
    await fetcher.fetchLinkPreviewFast(`http://localhost:${server.address().port}/page`),
    await fetcher.fetchLinkPreviewFast("http://192.168.0.1/"),
    await fetcher.fetchLinkPreviewFast("http://[::1]/"),
    await fetcher.fetchLinkPreviewFast("http://169.254.169.254/latest/meta-data/"),
];
check("private/local targets are refused", guarded.every((g) => g === null), JSON.stringify(guarded));
check("…and the local listener saw no request at all", seen.length === 0, JSON.stringify(seen));
// A public NAME that resolves to loopback (nip.io-style) can't be exercised offline; the guarded lookup is tested directly:
await new Promise((resolve) => {
    guard.guardedLookup("localhost", {}, (err) => {
        check("the guarded DNS lookup refuses a name that resolves to loopback", !!err && err.code === "ERR_BLOCKED_ADDRESS", String(err));
        resolve();
    });
});
await new Promise((resolve) => {
    guard.guardedLookup("localhost", { all: true }, (err) => {
        check("…also in the all:true form", !!err && err.code === "ERR_BLOCKED_ADDRESS");
        resolve();
    });
});

// ── Adult detection (PRD 18.11) ──
const det = (ogTags, metaByName = {}) => adult.detectAdult({ ogTags, metaByName });
check("og:restrictions:age 18+ is adult", det({ "og:restrictions:age": "18+" }) === true);
check("og:restrictions:age 21 is adult", det({ "og:restrictions:age": "21" }) === true);
check("og:restrictions:age 13+ is not", det({ "og:restrictions:age": "13+" }) === false);
check("an unreadable age value is not adult", det({ "og:restrictions:age": "mature" }) === false);
for (const r of ["adult", "Adult", "MATURE", "restricted", "RTA-5042-1996-1400-1577-RTA", "general, adult", " adult "]) {
    check(`rating "${r}" is adult`, det({}, { rating: r }) === true);
}
for (const r of ["general", "safe for kids", "14 years", ""]) check(`rating "${r}" is not adult`, det({}, { rating: r }) === false);
check("no signals is not adult", det({}) === false);
const named = adult.extractNamedMeta('<meta NAME="Rating" content="adult"><meta content="x" name="keywords"><meta content="RTA-5042-1996-1400-1577-RTA" name="rating">', ["rating"]);
check("extractNamedMeta reads both attribute orders, case-insensitively, only wanted names", named.rating === "RTA-5042-1996-1400-1577-RTA" && !("keywords" in named), JSON.stringify(named));
const adultPage = await fetcher.fetchLinkPreviewFast(`${base}/adult`, T);
check("a page with og:restrictions:age 18+ comes back with adult: true", adultPage && adultPage.adult === true, JSON.stringify(adultPage));
const ratedPage = await fetcher.fetchLinkPreviewFast(`${base}/rated`, T);
check("a page with <meta name=rating content=adult> comes back with adult: true", ratedPage && ratedPage.adult === true, JSON.stringify(ratedPage));
check("a normal page has no adult flag", page && !("adult" in page));

server.close();
console.log(failures === 0 ? "\nAll link-preview checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
