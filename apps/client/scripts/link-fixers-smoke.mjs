/**
 * Smoke test for src/link-fixers.ts (PRD 17.9) — run after `tsc --build`:
 *   node scripts/link-fixers-smoke.mjs
 * Exits non-zero on any failure.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { toFixerUrl, displayDomain, decodeHtmlEntities, FIXER_USER_AGENT } = require(resolve(here, "../dist/link-fixers.js"));

let failures = 0;
const check = (name, ok, detail = "") => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${detail}`}`);
};
const fx = (u) => toFixerUrl(u)?.fixerUrl ?? null;
const expect = (input, output) => check(`${input} → ${output}`, fx(input) === output, `got ${fx(input)}`);

// ── Every network ──
expect("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://koutube.com/watch?v=dQw4w9WgXcQ");
expect("https://youtube.com/shorts/dQw4w9WgXcQ", "https://koutube.com/shorts/dQw4w9WgXcQ");
expect("https://m.youtube.com/watch?v=abc&t=42s", "https://koutube.com/watch?v=abc&t=42s");
expect("https://youtu.be/dQw4w9WgXcQ?t=10", "https://koutube.com/dQw4w9WgXcQ?t=10");
expect("https://twitter.com/jack/status/20", "https://fxtwitter.com/jack/status/20");
expect("https://x.com/jack/status/20", "https://fxtwitter.com/jack/status/20");
expect("https://mobile.x.com/jack/status/20", "https://fxtwitter.com/jack/status/20");
expect("https://www.instagram.com/reel/C9xA1b2SgX5/", "https://oginstagram.com/reel/C9xA1b2SgX5/");
expect("https://www.reddit.com/r/videos/comments/1fj3h3y/", "https://vxreddit.com/r/videos/comments/1fj3h3y/");
expect("https://old.reddit.com/r/videos/comments/1fj3h3y/", "https://vxreddit.com/r/videos/comments/1fj3h3y/");
expect("https://www.twitch.tv/zackrawrr/clip/AmazonianEncouragingLyrebirdAllenHuhu", "https://fxtwitch.seria.moe/zackrawrr/clip/AmazonianEncouragingLyrebirdAllenHuhu");
expect("https://clips.twitch.tv/AmazonianEncouragingLyrebirdAllenHuhu", "https://fxtwitch.seria.moe/clip/AmazonianEncouragingLyrebirdAllenHuhu");
expect("https://bsky.app/profile/bsky.app/post/3l6oveex3ii2l", "https://vxbsky.app/profile/bsky.app/post/3l6oveex3ii2l");
expect("https://imgur.com/gallery/a8wLOzM", "https://imgurez.com/gallery/a8wLOzM");
expect("https://m.imgur.com/a8wLOzM", "https://imgurez.com/a8wLOzM");

// ── Normalization ──
expect("HTTPS://WWW.YOUTUBE.COM/watch?v=X", "https://koutube.com/watch?v=X");
expect("http://x.com/a/status/1", "https://fxtwitter.com/a/status/1");
expect("https://x.com/a/status/1#fragment", "https://fxtwitter.com/a/status/1");
expect("https://x.com:443/a/status/1", "https://fxtwitter.com/a/status/1");
check("fixerHost reported", toFixerUrl("https://x.com/a/status/1")?.fixerHost === "fxtwitter.com");
check("network name reported", toFixerUrl("https://youtu.be/x")?.network === "YouTube" && toFixerUrl("https://clips.twitch.tv/x")?.network === "Twitch");

// ── Never matched ──
for (const u of [
    "https://i.imgur.com/abc.png", // already a direct image
    "https://notyoutube.com/watch?v=x",
    "https://youtube.com.evil.net/watch?v=x",
    "https://evil.net/x.com/a/status/1",
    "https://fxtwitter.com/a/status/1", // already fixed
    "https://example.com/watch?v=x",
    "ftp://youtube.com/watch?v=x",
    "javascript:alert(1)",
    "https://user:pass@x.com/a/status/1",
    "https://www.youtube.com/", // bare homepage
    "https://x.com",
    "not a url",
    "",
]) {
    check(`no fixer for ${JSON.stringify(u)}`, fx(u) === null, `got ${fx(u)}`);
}

// ── Helpers ──
check("display domain drops www.", displayDomain("https://www.youtube.com/watch?v=1") === "youtube.com");
check("display domain of junk is undefined", displayDomain("nope") === undefined);
check("entities: named", decodeHtmlEntities("Tom &amp; Jerry &lt;3 &quot;hi&quot; it&#39;s") === `Tom & Jerry <3 "hi" it's`);
check("entities: hex + decimal, astral", decodeHtmlEntities("&#x1F441;&#xFE0E; &#128077;") === "\u{1F441}\uFE0E \u{1F44D}");
check("entities: unknown/invalid left alone", decodeHtmlEntities("&bogus; &#xD800; &#0; & plain") === "&bogus; &#xD800; &#0; & plain");
check("fixer UA carries the Discordbot token", /Discordbot\/2\.0/.test(FIXER_USER_AGENT) && /Reson8Bot/.test(FIXER_USER_AGENT));

console.log(failures === 0 ? "\nAll link-fixer checks passed." : `\n${failures} link-fixer check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
