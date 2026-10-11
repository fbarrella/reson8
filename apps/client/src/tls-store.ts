/**
 * What this install has decided to trust about servers' certificates, and
 * which servers it has reached over HTTPS (PRD 18.3).
 *
 * Lives in the MAIN process, in `<userData>/tls-trust.json` — never in the
 * renderer's localStorage, so the renderer can't be tricked into pinning an
 * arbitrary certificate. It has no Electron import (the caller passes the
 * file path) so it is tested in plain Node.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isFingerprint } from "./tls-trust";

export interface PinEntry {
    fingerprint256: string;
    subject: string;
    /** ISO date the pinned certificate expires. */
    validTo: string;
    /** ISO date the user trusted it. */
    pinnedAt: string;
    certPem: string;
}

export interface PinSummary extends Omit<PinEntry, "certPem"> {
    hostKey: string;
}

interface StoreShape {
    v: 1;
    pins: Record<string, PinEntry>;
    /** hostKey → ISO date last reached over HTTPS. */
    httpsHosts: Record<string, string>;
}

const MAX_HTTPS_HOSTS = 500;
const MAX_PINS = 200;
const MAX_PEM_LENGTH = 16_000;

function validPin(value: unknown): value is PinEntry {
    if (!value || typeof value !== "object") return false;
    const p = value as Record<string, unknown>;
    return (
        isFingerprint(p.fingerprint256) &&
        typeof p.subject === "string" &&
        typeof p.validTo === "string" &&
        typeof p.pinnedAt === "string" &&
        typeof p.certPem === "string" &&
        p.certPem.startsWith("-----BEGIN CERTIFICATE-----") &&
        p.certPem.length < MAX_PEM_LENGTH
    );
}

export class TlsTrustStore {
    private data: StoreShape | null = null;

    constructor(private readonly file: string) {}

    // ── pins ───────────────────────────────────────────────────────────────

    getPin(hostKey: string): PinEntry | null {
        return this.load().pins[hostKey] ?? null;
    }

    setPin(hostKey: string, entry: PinEntry): void {
        const d = this.load();
        if (!validPin(entry)) throw new Error("Invalid certificate pin");
        if (!(hostKey in d.pins) && Object.keys(d.pins).length >= MAX_PINS) {
            throw new Error("Too many trusted certificates — remove some in Settings first");
        }
        d.pins[hostKey] = entry;
        this.save();
    }

    removePin(hostKey: string): boolean {
        const d = this.load();
        if (!(hostKey in d.pins)) return false;
        delete d.pins[hostKey];
        this.save();
        return true;
    }

    listPins(): PinSummary[] {
        return Object.entries(this.load().pins)
            .map(([hostKey, { certPem: _pem, ...rest }]) => ({ hostKey, ...rest }))
            .sort((a, b) => a.hostKey.localeCompare(b.hostKey));
    }

    /**
     * Pins of any port of this hostname. The Chromium certificate hook only
     * learns the hostname, not the port — it then matches by fingerprint.
     */
    pinsForHostname(hostname: string): PinEntry[] {
        const wanted = hostname.toLowerCase().replace(/^\[|\]$/g, "");
        const out: PinEntry[] = [];
        for (const [key, pin] of Object.entries(this.load().pins)) {
            const host = key.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
            if (host === wanted) out.push(pin);
        }
        return out;
    }

    // ── HTTPS memory ───────────────────────────────────────────────────────

    rememberHttps(hostKey: string): void {
        const d = this.load();
        d.httpsHosts[hostKey] = new Date().toISOString();
        const keys = Object.keys(d.httpsHosts);
        if (keys.length > MAX_HTTPS_HOSTS) {
            // Drop the least recently used.
            keys
                .sort((a, b) => d.httpsHosts[a].localeCompare(d.httpsHosts[b]))
                .slice(0, keys.length - MAX_HTTPS_HOSTS)
                .forEach((k) => delete d.httpsHosts[k]);
        }
        this.save();
    }

    isHttpsRemembered(hostKey: string): boolean {
        return hostKey in this.load().httpsHosts;
    }

    // ── persistence ────────────────────────────────────────────────────────

    private load(): StoreShape {
        if (this.data) return this.data;
        const empty: StoreShape = { v: 1, pins: {}, httpsHosts: {} };
        try {
            if (existsSync(this.file)) {
                const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<StoreShape>;
                const pins: Record<string, PinEntry> = {};
                for (const [k, v] of Object.entries(parsed.pins ?? {})) if (validPin(v)) pins[k] = v;
                const httpsHosts: Record<string, string> = {};
                for (const [k, v] of Object.entries(parsed.httpsHosts ?? {})) if (typeof v === "string") httpsHosts[k] = v;
                this.data = { v: 1, pins, httpsHosts };
                return this.data;
            }
        } catch (err) {
            // A corrupt file must never stop the app: start empty (and keep the
            // bad file for inspection by renaming it).
            console.error("[tls] trust store unreadable, starting empty:", (err as Error).message);
            try {
                renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
            } catch {
                /* best effort */
            }
        }
        this.data = empty;
        return this.data;
    }

    private save(): void {
        if (!this.data) return;
        try {
            mkdirSync(dirname(this.file), { recursive: true });
            const tmp = `${this.file}.tmp`;
            writeFileSync(tmp, JSON.stringify(this.data, null, 2), { encoding: "utf8", mode: 0o600 });
            renameSync(tmp, this.file);
        } catch (err) {
            // The in-memory decision still applies for this session.
            console.error("[tls] couldn't save the trust store:", (err as Error).message);
        }
    }
}
