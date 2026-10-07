#!/usr/bin/env node
/**
 * One-time prune of orphaned local-disk uploads (PRD 16.9).
 *
 * Before the stored-file ledger, a picked image that was removed or never
 * sent, a cancelled emoji/icon upload, and the files of deleted channels were
 * never deleted. This lists the files in ./uploads that NOTHING references
 * and (with --apply) deletes them.
 *
 *   npm run uploads:prune                       # dry run: lists, deletes nothing
 *   npm run uploads:prune -- --apply            # actually delete
 *   npm run uploads:prune -- --min-age-hours=48 # only files untouched this long (default 24)
 *   npm run uploads:prune -- --dir=/path/to/uploads
 *   docker compose exec server npm run uploads:prune
 *
 * A file is KEPT if its name appears in the stored-file ledger (claimed or
 * not — the hourly sweeper handles unclaimed ones), is referenced by a
 * message, DM, custom emoji or channel icon in ANY URL form (relative or the
 * old absolute form), or was modified within the minimum age (an in-flight
 * upload). Cloudinary assets are never touched — see the README.
 */

import "dotenv/config";
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const UPLOAD_URL_RE = /\/uploads\/([^/?#]+)/;

/** The file name of a local-disk upload URL in any form ("/uploads/x.png", "http://h:9800/uploads/x.png"), or null. */
export function extractUploadBasename(url) {
    if (typeof url !== "string") return null;
    const match = UPLOAD_URL_RE.exec(url);
    return match ? match[1] : null;
}

/** Files that are unreferenced, not hidden (.gitkeep…), and older than `minAgeMs`. */
export function findOrphanFiles({ files, referenced, minAgeMs, now }) {
    return files.filter((f) => !f.name.startsWith(".") && !referenced.has(f.name) && now - f.mtimeMs >= minAgeMs);
}

export function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function parseArgs(argv) {
    const opts = { apply: false, minAgeHours: 24, dir: path.resolve(process.cwd(), "uploads") };
    for (const arg of argv) {
        if (arg === "--apply") opts.apply = true;
        else if (arg.startsWith("--min-age-hours=")) {
            const n = Number(arg.split("=")[1]);
            if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${arg}`);
            opts.minAgeHours = n;
        } else if (arg.startsWith("--dir=")) opts.dir = path.resolve(arg.split("=")[1]);
        else throw new Error(`Unknown argument: ${arg}`);
    }
    return opts;
}

async function main() {
    let opts;
    try {
        opts = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(`${err.message}\nUsage: npm run uploads:prune -- [--apply] [--min-age-hours=N] [--dir=PATH]`);
        process.exit(2);
    }
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();

    try {
        // Every URL anything could still reference. `attachments` (multi-image
        // messages, PRD 16.10) is included automatically once that table exists.
        const [{ exists }] = await prisma.$queryRaw`SELECT to_regclass('public.attachments') IS NOT NULL AS "exists"`;
        const urls = await prisma.$queryRaw`
            SELECT "url" AS "u" FROM "stored_files"
            UNION SELECT "attachmentUrl" FROM "messages" WHERE "attachmentUrl" IS NOT NULL
            UNION SELECT "attachmentUrl" FROM "direct_messages" WHERE "attachmentUrl" IS NOT NULL
            UNION SELECT "imageUrl" FROM "custom_emojis"
            UNION SELECT "iconUrl" FROM "channels" WHERE "iconUrl" IS NOT NULL`;
        const extra = exists ? await prisma.$queryRaw`SELECT "url" AS "u" FROM "attachments"` : [];

        const referenced = new Set();
        for (const row of [...urls, ...extra]) {
            const name = extractUploadBasename(row.u);
            if (name) referenced.add(name);
        }

        let entries;
        try {
            entries = await readdir(opts.dir, { withFileTypes: true });
        } catch (err) {
            if (err.code === "ENOENT") {
                console.log(`No uploads directory at ${opts.dir} — nothing to prune.`);
                return;
            }
            throw err;
        }

        const files = [];
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            const s = await stat(path.join(opts.dir, entry.name));
            files.push({ name: entry.name, size: s.size, mtimeMs: s.mtimeMs });
        }

        const orphans = findOrphanFiles({ files, referenced, minAgeMs: opts.minAgeHours * 3600 * 1000, now: Date.now() });
        const total = orphans.reduce((sum, f) => sum + f.size, 0);

        console.log(`Scanned ${files.length} file(s) in ${opts.dir}; ${referenced.size} referenced name(s) in the database.`);
        for (const f of orphans) console.log(`  orphan  ${f.name}  (${formatBytes(f.size)})`);
        console.log(`${orphans.length} orphaned file(s), ${formatBytes(total)}${opts.minAgeHours > 0 ? ` (untouched for ${opts.minAgeHours}h+)` : ""}.`);

        if (!opts.apply) {
            if (orphans.length > 0) console.log("Dry run — nothing was deleted. Re-run with --apply to delete these files.");
        } else {
            let deleted = 0;
            for (const f of orphans) {
                try {
                    await unlink(path.join(opts.dir, f.name));
                    deleted++;
                } catch (err) {
                    console.error(`  failed to delete ${f.name}: ${err.message}`);
                }
            }
            console.log(`Deleted ${deleted} of ${orphans.length} file(s).`);
        }

        if (process.env.CLOUDINARY_CLOUD_NAME) {
            console.log("Note: Cloudinary assets are not touched by this script (see the README).");
        }
    } finally {
        await prisma.$disconnect();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
