/**
 * Optional native TLS (PRD 18.2): `TLS_CERT_FILE` + `TLS_KEY_FILE` make the
 * server speak HTTPS/WSS itself, for LANs and self-signed setups. Internet-
 * facing servers should normally sit behind a reverse proxy instead (see the
 * README's "Encryption" section and docker-compose.caddy.yml).
 *
 * Nothing here ever falls back to plain HTTP once TLS was requested: a server
 * its admin believes is encrypted must not silently start unencrypted.
 */

import { readFileSync, watch, type FSWatcher } from "node:fs";
import { X509Certificate } from "node:crypto";
import { createSecureContext } from "node:tls";
import { basename, dirname } from "node:path";

export interface TlsFiles {
    certFile: string;
    keyFile: string;
}

export interface TlsMaterial {
    key: Buffer;
    cert: Buffer;
    /** One line for the startup/renewal log: subject, names, expiry. */
    summary: string;
    notAfter: Date;
}

/**
 * `null` = TLS off. Throws (a startup error) when only one of the two
 * variables is set, because that is always a configuration mistake.
 */
export function readTlsEnv(env: NodeJS.ProcessEnv = process.env): TlsFiles | null {
    const certFile = env.TLS_CERT_FILE?.trim();
    const keyFile = env.TLS_KEY_FILE?.trim();
    if (!certFile && !keyFile) return null;
    if (!certFile || !keyFile) {
        throw new Error("TLS_CERT_FILE and TLS_KEY_FILE must be set together (only one of them is set)");
    }
    return { certFile, keyFile };
}

/**
 * Reads and validates the pair. A key that doesn't match the certificate is
 * rejected here (`createSecureContext` throws), so a half-renewed or wrong
 * pair can never replace a working one.
 */
export function loadTlsMaterial(files: TlsFiles): TlsMaterial {
    const key = readFileSync(files.keyFile);
    const cert = readFileSync(files.certFile);
    createSecureContext({ key, cert });

    const x509 = new X509Certificate(cert); // the first (leaf) certificate of the file
    const subject = x509.subject.replace(/\n/g, ", ");
    const names = x509.subjectAltName ? `, names ${x509.subjectAltName}` : "";
    const notAfter = new Date(x509.validTo);
    return { key, cert, notAfter, summary: `${subject}${names}, expires ${notAfter.toISOString().slice(0, 10)}` };
}

const DEBOUNCE_MS = 1000;
const SAFETY_RELOAD_MS = 12 * 60 * 60 * 1000;

/**
 * Re-reads the certificate when its files change, so certbot/acme.sh renewals
 * need no restart. Watches the DIRECTORIES (renewals replace files or swap
 * symlinks, which a watch on the file itself misses), debounces the burst of
 * events a renewal produces, and re-reads both files together. A failed
 * reload is reported and the previous certificate stays in use.
 *
 * Returns a function that stops watching.
 */
export function watchTlsFiles(
    files: TlsFiles,
    onReload: (material: TlsMaterial) => void,
    onError: (err: Error) => void,
    opts: { debounceMs?: number; safetyReloadMs?: number } = {},
): () => void {
    const wanted = new Set([basename(files.certFile), basename(files.keyFile)]);
    let timer: ReturnType<typeof setTimeout> | null = null;

    const reload = (): void => {
        timer = null;
        try {
            onReload(loadTlsMaterial(files));
        } catch (err) {
            onError(err as Error);
        }
    };
    const schedule = (): void => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(reload, opts.debounceMs ?? DEBOUNCE_MS);
    };

    const watchers: FSWatcher[] = [];
    for (const dir of new Set([dirname(files.certFile), dirname(files.keyFile)])) {
        try {
            watchers.push(
                watch(dir, { persistent: false }, (_event, filename) => {
                    if (!filename || wanted.has(filename.toString())) schedule();
                }),
            );
        } catch (err) {
            onError(err as Error);
        }
    }

    const safety = setInterval(schedule, opts.safetyReloadMs ?? SAFETY_RELOAD_MS);
    safety.unref();

    return () => {
        if (timer) clearTimeout(timer);
        clearInterval(safety);
        for (const w of watchers) w.close();
    };
}
