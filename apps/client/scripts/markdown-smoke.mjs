/**
 * Smoke test for src/markdown.ts (PRD 15.10) — run after `tsc --build`:
 *   node scripts/markdown-smoke.mjs
 * The client has no unit-test runner, so this exercises the pure Markdown
 * module directly from the compiled output. Exits non-zero on any failure.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { renderMessageMarkdown, markdownToPlainText, preserveWhitespaceOnlyLines } = require(resolve(here, "../dist/markdown.js"));

const emoji = new Map([
    ["party", "http://x/party.png"],
    ["my_emoji_name", "http://x/m.png"],
]);
let failures = 0;
const check = (name, ok, detail = "") => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${detail}`}`);
};
const r = (t) => renderMessageMarkdown(t, emoji);
const has = (t, s) => r(t).html.includes(s);

// ── Layout classification ──
check("plain line stays inline (no <p>)", JSON.stringify(r("hello world")) === JSON.stringify({ html: "hello world", block: false }), JSON.stringify(r("hello world")));
check("plain text with HTML chars is escaped", r("a < b & c").html === "a &lt; b &amp; c" && !r("a < b & c").block, r("a < b & c").html);
check("newline => block", r("a\nb").block && r("a\nb").html.includes("<br>"), r("a\nb").html);
check("two paragraphs => block", r("a\n\nb").block && (r("a\n\nb").html.match(/<p>/g) ?? []).length === 2);
check("bold alone stays inline", !r("**hi**").block && r("**hi**").html === "<strong>hi</strong>", r("**hi**").html);

// ── Syntax ──
check("**bold**", has("x **b** y", "<strong>b</strong>"));
check("*italic*", has("x *i* y", "<em>i</em>"));
check("_italic_", has("x _i_ y", "<em>i</em>"));
check("__underline__ => <u>, not bold", has("x __u__ y", "<u>u</u>") && !has("x __u__ y", "<strong>"), r("x __u__ y").html);
check("~~strike~~", /<(s|del)>s<\/(s|del)>/.test(r("x ~~s~~ y").html), r("x ~~s~~ y").html);
check("> quote", has("> q", "<blockquote>") && r("> q").block);
check("- list", has("- a\n- b", "<ul>") && has("- a\n- b", "<li>a</li>"), r("- a\n- b").html);
check("1. ordered list", has("1. a\n2. b", "<ol>"));
check("# titles h1-h3", has("# t", "<h1>") && has("## t", "<h2>") && has("### t", "<h3>"));
check("#### demoted: no <h4>, marker kept literally", !has("#### t", "<h4>") && r("#### t").html.includes("#### t"), r("#### t").html);
check("`inline code`", has("a `c` b", "<code>c</code>"));
check("fenced code block", has("```\nlet a = 1;\n```", "<pre><code>"), r("```\nlet a = 1;\n```").html);
check("code block content is not formatted", !has("```\n**x**\n```", "<strong>"));
check("indented text is NOT a code block", !has("    indented\n    more", "<pre>"), r("    indented\n    more").html);
check("bare URL auto-links, opens externally", /<a href="https:\/\/example\.com\/a\?b=1"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*class="msg-link"/.test(r("see https://example.com/a?b=1 ok").html) || /<a [^>]*class="msg-link"/.test(r("see https://example.com/a?b=1 ok").html), r("see https://example.com/a?b=1 ok").html);
check("bare domain does NOT link (next.js)", !has("use next.js and example.com", "<a "), r("use next.js and example.com").html);
check("email does NOT link", !has("me@example.com", "<a "));
check("ftp: / mailto: / // do NOT link", !has("ftp://a.com mailto:a@b.com //c.com", "<a "), r("ftp://a.com mailto:a@b.com //c.com").html);
check("masked link [t](url) is NOT a link with spoofed text (only the visible URL links)", !/<a [^>]*>click<\/a>/.test(r("[click](https://evil.com)").html) && has("[click](https://evil.com)", "[click]"), r("[click](https://evil.com)").html);
check("trailing punctuation not part of URL", /href="https:\/\/example\.com"/.test(r("go to https://example.com.").html), r("go to https://example.com.").html);

// ── Custom emoji ──
check("known :emoji: => <img>", has("hi :party:", 'class="custom-emoji-inline"') && has("hi :party:", 'src="http://x/party.png"'), r("hi :party:").html);
check(":emoji_with_underscores: not eaten as italics", has("a :my_emoji_name: b", "<img") && !has("a :my_emoji_name: b", "<em>"), r("a :my_emoji_name: b").html);
check("emoji inside italic sentence", has("_hello :party: there_", "<em>") && has("_hello :party: there_", "<img"), r("_hello :party: there_").html);
check("unknown :name: stays literal", r("a :nope: b").html === "a :nope: b", r("a :nope: b").html);
check("emoji with no map => literal", renderMessageMarkdown(":party:").html === ":party:");

// ── XSS / abuse vectors: all must come out inert ──
const vectors = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "<a href=\"javascript:alert(1)\">x</a>",
    "[x](javascript:alert(1))",
    "[x](data:text/html,<script>alert(1)</script>)",
    "![x](http://evil/track.png)",
    "<svg onload=alert(1)>",
    "<iframe src=//evil></iframe>",
    "javascript:alert(1)",
    "<<script>script>alert(1)<</script>/script>",
    "**<b onmouseover=alert(1)>x</b>**",
    "`<script>`",
    "> <img src=x onerror=alert(1)>",
    "- <a href=# onclick=alert(1)>x</a>",
    "<!-- c --><style>*{display:none}</style>",
    ":party:\"><script>alert(1)</script>",
];
for (const v of vectors) {
    const out = r(v).html;
    const bad = /<(script|iframe|svg|style|object|embed|b |a href="javascript)/i.test(out) || /\son\w+=/i.test(out.replace(/&[a-z]+;/g, "")) && /<[^>]*\son\w+=/i.test(out) || /<img(?![^>]*custom-emoji-inline)/i.test(out) || /href="(javascript|data|vbscript):/i.test(out);
    check(`inert: ${JSON.stringify(v).slice(0, 60)}`, !bad, out);
}

// ── Plain-text previews ──
check("plain text strips syntax and newlines", markdownToPlainText("**Hello** _there_\n\n# Title\n- one\n- two") === "Hello there Title one two", markdownToPlainText("**Hello** _there_\n\n# Title\n- one\n- two"));
check("plain text keeps code + urls", markdownToPlainText("run `npm i` at https://x.com") === "run npm i at https://x.com", markdownToPlainText("run `npm i` at https://x.com"));
check("plain text of empty", markdownToPlainText("") === "");


// ── Whitespace-only lines are blank lines (PRD 17.10) ──
const NB = " ";
const blankLines = (html) => (html.match(new RegExp(`<br>\\n${NB}(?=<br>|</p>|</li>)`, "g")) ?? []).length;
check("space line → one visible blank line", blankLines(r("Line 1\n \nLine 3").html) === 1 && r("Line 1\n \nLine 3").html.includes("Line 3"), r("Line 1\n \nLine 3").html);
check("tab-only line → blank line too", blankLines(r("a\n\t\nb").html) === 1, r("a\n\t\nb").html);
check("several spaces → still ONE blank line", blankLines(r("a\n     \nb").html) === 1, r("a\n     \nb").html);
check("two space lines → two blank lines", blankLines(r("a\n \n \nb").html) === 2, r("a\n \n \nb").html);
check("truly empty line unchanged (paragraph break)", r("a\n\nb").html === "<p>a</p>\n<p>b</p>\n", r("a\n\nb").html);
check("fenced code keeps its whitespace-only line verbatim", r("```\nx\n   \ny\n```").html.includes("x\n   \ny"), r("```\nx\n   \ny\n```").html);
check("~~~ fence too", r("~~~\nx\n  \ny\n~~~").html.includes("x\n  \ny"), r("~~~\nx\n  \ny\n~~~").html);
check("after a fence closes, a space line is a blank line again", blankLines(r("```\ncode\n```\ntext\n \nmore").html) === 1, r("```\ncode\n```\ntext\n \nmore").html);
check("a longer closing fence closes; a shorter one doesn't", preserveWhitespaceOnlyLines("````\na\n```\n \n````\n \nb") === `\`\`\`\`\na\n\`\`\`\n \n\`\`\`\`\n${NB}\nb`, JSON.stringify(preserveWhitespaceOnlyLines("````\na\n```\n \n````\n \nb")));
check("quote: the blank line stays inside the quote", /<blockquote>[\s\S]*a<br>\n <br>\nb[\s\S]*<\/blockquote>/.test(r("> a\n \n> b").html), r("> a\n \n> b").html);
check("list: stays a list", r("- a\n \n- b").html.includes("<ul>") && r("- a\n \n- b").html.includes("<li>b</li>"), r("- a\n \n- b").html);
check("plain-text preview collapses it away", markdownToPlainText("Line 1\n \nLine 3") === "Line 1 Line 3", markdownToPlainText("Line 1\n \nLine 3"));
check("no-op fast path returns the same string", preserveWhitespaceOnlyLines("no blank lines here") === "no blank lines here");
check("XSS still escaped next to a blank line", !r("<img src=x onerror=alert(1)>\n \nok").html.includes("<img"), r("<img src=x onerror=alert(1)>\n \nok").html);

console.log(failures ? `\n${failures} FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
