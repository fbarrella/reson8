#!/usr/bin/env node
/**
 * Recovery for the allowed-names list (PRD 18.5).
 *
 * Settings → Server lets an admin list the host names a signed sign-in may be
 * addressed to (relay protection). The server refuses to save a list that
 * excludes the admin's own session — but if a list was saved that nobody can
 * use any more (the domain changed, the server moved), nobody can open the
 * Settings tab to fix it. This clears the stored list.
 *
 *   npm run identity:clear-hosts              # shows the lists, asks before clearing
 *   npm run identity:clear-hosts -- --yes     # clears without asking
 *   docker compose exec reson8-server npm run identity:clear-hosts -- --yes
 *
 * The server keeps the list in memory, so RESTART it afterwards. (An
 * AUTH_ALLOWED_HOSTS environment variable is not touched: it always wins —
 * unset or edit it yourself.)
 */

import "dotenv/config";
import readline from "node:readline/promises";
import { pathToFileURL } from "node:url";

/** True when the arguments ask to skip the confirmation. */
export function wantsYes(argv) {
    return argv.includes("--yes") || argv.includes("-y");
}

/** The servers that actually have a list to clear. */
export function serversWithLists(servers) {
    return servers.filter((s) => Array.isArray(s.authAllowedHosts) && s.authAllowedHosts.length > 0);
}

async function main() {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
        const servers = await prisma.server.findMany({ select: { id: true, name: true, authAllowedHosts: true } });
        const withLists = serversWithLists(servers);

        if (withLists.length === 0) {
            console.log("No allowed-names list is stored — nothing to clear.");
            return;
        }
        for (const s of withLists) {
            console.log(`${s.name} (${s.id}): ${s.authAllowedHosts.join(", ")}`);
        }

        if (!wantsYes(process.argv.slice(2))) {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            const answer = (await rl.question("Clear the stored list(s)? [y/N] ")).trim().toLowerCase();
            rl.close();
            if (answer !== "y" && answer !== "yes") {
                console.log("Left as it was.");
                return;
            }
        }

        const result = await prisma.server.updateMany({ data: { authAllowedHosts: [] } });
        console.log(`Cleared (${result.count} server record(s)). Restart the Reson8 server for it to take effect.`);
        if (process.env.AUTH_ALLOWED_HOSTS?.trim()) {
            console.log("Note: AUTH_ALLOWED_HOSTS is set in this environment and still applies.");
        }
    } finally {
        await prisma.$disconnect();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((err) => {
        console.error("Failed:", err instanceof Error ? err.message : err);
        process.exit(1);
    });
}
