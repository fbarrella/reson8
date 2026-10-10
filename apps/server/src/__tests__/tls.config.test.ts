import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadTlsMaterial, readTlsEnv, watchTlsFiles } from "../config/tls.config.js";

describe("readTlsEnv", () => {
    it("is off when neither variable is set", () => {
        expect(readTlsEnv({})).toBeNull();
        expect(readTlsEnv({ TLS_CERT_FILE: "  ", TLS_KEY_FILE: "" })).toBeNull();
    });

    it("returns both paths when both are set", () => {
        expect(readTlsEnv({ TLS_CERT_FILE: "/c/fullchain.pem", TLS_KEY_FILE: "/c/privkey.pem" })).toEqual({
            certFile: "/c/fullchain.pem",
            keyFile: "/c/privkey.pem",
        });
    });

    it("fails fast when only one is set (never silently serves plain HTTP)", () => {
        expect(() => readTlsEnv({ TLS_CERT_FILE: "/c/fullchain.pem" })).toThrow(/together/);
        expect(() => readTlsEnv({ TLS_KEY_FILE: "/c/privkey.pem" })).toThrow(/together/);
    });
});

// Certificates are generated with openssl at run time so no private key is
// committed; the suite skips itself where openssl isn't installed.
const hasOpenssl = spawnSync("openssl", ["version"]).status === 0;

describe.skipIf(!hasOpenssl)("loadTlsMaterial / watchTlsFiles", () => {
    let dir: string;
    const make = (name: string, cn: string): void => {
        execFileSync(
            "openssl",
            [
                "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-days", "30", "-nodes",
                "-subj", `/CN=${cn}`, "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
                "-keyout", join(dir, `${name}.key`), "-out", join(dir, `${name}.crt`),
            ],
            { stdio: "ignore" },
        );
    };

    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), "reson8-tls-"));
        make("a", "reson8-a");
        make("b", "reson8-b");
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("loads a matching pair and summarizes it", () => {
        const m = loadTlsMaterial({ certFile: join(dir, "a.crt"), keyFile: join(dir, "a.key") });
        expect(m.summary).toContain("reson8-a");
        expect(m.summary).toContain("localhost");
        expect(m.notAfter.getTime()).toBeGreaterThan(Date.now());
    });

    it("rejects a key that does not match the certificate", () => {
        expect(() => loadTlsMaterial({ certFile: join(dir, "a.crt"), keyFile: join(dir, "b.key") })).toThrow();
    });

    it("rejects a missing file", () => {
        expect(() => loadTlsMaterial({ certFile: join(dir, "nope.crt"), keyFile: join(dir, "a.key") })).toThrow();
    });

    it("reloads when the files are replaced and keeps going after a bad write", async () => {
        const files = { certFile: join(dir, "live.crt"), keyFile: join(dir, "live.key") };
        copyFileSync(join(dir, "a.crt"), files.certFile);
        copyFileSync(join(dir, "a.key"), files.keyFile);

        const reloads: string[] = [];
        const errors: string[] = [];
        const stop = watchTlsFiles(files, (m) => reloads.push(m.summary), (e) => errors.push(e.message), {
            debounceMs: 50,
        });
        const until = async (cond: () => boolean): Promise<void> => {
            for (let i = 0; i < 60 && !cond(); i++) await new Promise((r) => setTimeout(r, 50));
        };

        // a valid renewal
        copyFileSync(join(dir, "b.key"), files.keyFile);
        copyFileSync(join(dir, "b.crt"), files.certFile);
        await until(() => reloads.some((s) => s.includes("reson8-b")));
        expect(reloads.some((s) => s.includes("reson8-b"))).toBe(true);

        // a half-written / mismatched renewal is reported, not applied
        const before = reloads.length;
        writeFileSync(files.certFile, readFileSync(join(dir, "a.crt"))); // cert A, key B
        await until(() => errors.length > 0);
        expect(errors.length).toBeGreaterThan(0);
        expect(reloads.length).toBe(before);

        stop();
    });
});
