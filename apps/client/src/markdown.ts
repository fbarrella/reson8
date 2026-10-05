/**
 * Chat Markdown rendering (PRD 15.10).
 *
 * A PURE module — no Electron/DOM imports — so it can be exercised in plain
 * Node (see `scripts/markdown-smoke.mjs`). `preload.ts` imports it and exposes
 * it to the renderer, which is a plain `<script>` with no bundler and so
 * cannot `import` markdown-it itself.
 *
 * Dialect: Discord-style. `**bold**`, `*italic*` / `_italic_`, `__underline__`,
 * `~~strike~~`, `> quote`, lists, `#`-`###` titles, `inline code`, fenced code
 * blocks, and bare http(s) URLs auto-linked. Deliberately NOT supported:
 * raw HTML, images, tables, horizontal rules, setext headings, indented code
 * blocks, reference links, `h4`+ (rendered as plain paragraphs), and masked
 * links `[text](url)` (the link text could spoof the real destination —
 * only visible URLs become links).
 */

import MarkdownIt from "markdown-it";

export interface RenderedMessage {
    /** Safe-by-construction HTML (the renderer still allow-list sanitizes it). */
    html: string;
    /** False for a single plain line with no block syntax — those keep the
     *  original inline `[time] nick text` layout; anything else is a block. */
    block: boolean;
}

/** Approved custom emoji, `name -> image URL`, supplied per render via `env`. */
export type CustomEmojiMap = Map<string, string>;

interface RenderEnv {
    emoji?: CustomEmojiMap;
}

const md = new MarkdownIt({
    html: false, // never pass raw HTML through
    linkify: true,
    breaks: true, // a single newline is a line break, like Discord
    typographer: false,
});

// Syntax this chat doesn't support (see the module comment for why).
md.disable(["image", "table", "hr", "reference", "lheading", "html_block", "html_inline", "link", "code"]);

// Only explicit http(s) URLs auto-link — not bare domains ("next.js"), emails,
// or other schemes. The renderer-side sanitizer also drops non-http(s) hrefs.
md.linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false });
md.linkify.add("ftp:", null);
md.linkify.add("mailto:", null);
md.linkify.add("//", null);

// ── `__underline__` ─────────────────────────────────────────────────────
// markdown-it parses `__x__` as `strong` with `markup === "__"`; render that
// form as <u> and leave `**x**` as <strong>.
md.renderer.rules.strong_open = (tokens, idx) => (tokens[idx].markup === "__" ? "<u>" : "<strong>");
md.renderer.rules.strong_close = (tokens, idx) => (tokens[idx].markup === "__" ? "</u>" : "</strong>");

// ── Links: always open in the system browser, never navigate the app ────
const defaultLinkOpen =
    md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel", "noopener noreferrer");
    tokens[idx].attrSet("class", "msg-link");
    return defaultLinkOpen(tokens, idx, options, env, self);
};

// ── Headings: only h1–h3; deeper ones become plain paragraphs ───────────
md.core.ruler.push("reson8_clamp_headings", (state) => {
    let demoting = false;
    let demotedMarkup = "";
    for (const token of state.tokens) {
        if (token.type === "heading_open" && /^h[4-6]$/.test(token.tag)) {
            demotedMarkup = token.markup;
            token.type = "paragraph_open";
            token.tag = "p";
            token.markup = "";
            demoting = true;
        } else if (token.type === "inline" && demoting && demotedMarkup) {
            // Show the "####" literally rather than silently dropping it.
            const prefix = new state.Token("text", "", 0);
            prefix.content = `${demotedMarkup} `;
            token.children = [prefix, ...(token.children ?? [])];
            demotedMarkup = "";
        } else if (token.type === "heading_close" && demoting) {
            token.type = "paragraph_close";
            token.tag = "p";
            token.markup = "";
            demoting = false;
        }
    }
});

// ── Custom emoji `:name:` ───────────────────────────────────────────────
// Registered BEFORE `emphasis` so a name containing underscores
// (`:my_emoji_name:`, legal in this app) isn't eaten as italics. Unknown
// names return false and so stay literal text, as before.
const EMOJI_TOKEN = /^:([a-zA-Z0-9_]{2,32}):/;
md.inline.ruler.before("emphasis", "reson8_emoji", (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x3a /* : */) return false;
    const match = EMOJI_TOKEN.exec(state.src.slice(state.pos, state.pos + 34));
    if (!match) return false;
    const url = (state.env as RenderEnv).emoji?.get(match[1]);
    if (!url) return false;
    if (!silent) {
        const token = state.push("reson8_emoji", "img", 0);
        token.content = match[1];
        token.attrSet("src", url);
    }
    state.pos += match[0].length;
    return true;
});
md.renderer.rules.reson8_emoji = (tokens, idx) => {
    const token = tokens[idx];
    const src = md.utils.escapeHtml(token.attrGet("src") ?? "");
    const token_text = md.utils.escapeHtml(`:${token.content}:`);
    return `<img src="${src}" alt="${token_text}" title="${token_text}" class="custom-emoji-inline">`;
};

/** Renders a chat message's Markdown. */
export function renderMessageMarkdown(text: string, emoji?: CustomEmojiMap): RenderedMessage {
    const env: RenderEnv = { emoji };
    const tokens = md.parse(text, env);

    // A lone paragraph with no line breaks is just a line of text: render
    // only its inline content (no wrapping <p>) so it keeps flowing inline
    // after the nickname exactly as plain messages always have.
    if (
        tokens.length === 3 &&
        tokens[0].type === "paragraph_open" &&
        tokens[1].type === "inline" &&
        !(tokens[1].children ?? []).some((c) => c.type === "softbreak" || c.type === "hardbreak")
    ) {
        return { html: md.renderer.renderInline(tokens[1].children ?? [], md.options, env), block: false };
    }
    return { html: md.renderer.render(tokens, md.options, env), block: true };
}

/**
 * Flattens a message to one line of plain text — for previews (e.g. the
 * pinned-message bar) that must never show `**`/`#` syntax or line breaks.
 */
export function markdownToPlainText(text: string): string {
    const parts: string[] = [];
    for (const token of md.parse(text, {})) {
        if (token.type === "fence") {
            parts.push(token.content);
        } else if (token.type === "inline") {
            for (const child of token.children ?? []) {
                if (child.type === "text" || child.type === "code_inline") parts.push(child.content);
                else if (child.type === "reson8_emoji") parts.push(`:${child.content}:`);
                else if (child.type === "softbreak" || child.type === "hardbreak") parts.push(" ");
            }
            parts.push(" ");
        }
    }
    return parts.join("").replace(/\s+/g, " ").trim();
}
