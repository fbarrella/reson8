/**
 * Probes a server's TLS before Socket.io connects (PRD 18.3).
 *
 * Why a separate probe: the error the Socket.io/`ws` stack reports for a failed
 * WebSocket is just "websocket error" — it can't tell "this port doesn't speak
 * TLS" from "the certificate isn't trusted", and those need different answers
 * (fall back to http / ask the user whether to trust the certificate).
 *
 * Node-only (`net`/`tls`/`crypto`), no Electron import, so it is exercised
 * against real local servers in `scripts/tls-trust-smoke.mjs`.
 */

import net from "node:net";
import tls from "node:tls";
import { createHash, X509Certificate } from "node:crypto";
import type { CertInfo, ProbeResult } from "./tls-trust";

export interface ProbeOutcome {
    result: ProbeResult;
    /** PEM of the presented leaf certificate (kept in the main process; used when the user pins it). */
    certPem: string | null;
}

/** Errors that mean "the other end answered, but not with TLS". */
const NOT_TLS_CODES = new Set([
    "ERR_SSL_WRONG_VERSION_NUMBER",
    "ERR_SSL_PACKET_LENGTH_TOO_LONG",
    "ERR_SSL_HTTP_REQUEST",
    "ERR_SSL_UNKNOWN_PROTOCOL",
    "ERR_SSL_RECORD_LAYER_FAILURE",
    "EPROTO",
]);

export function certInfoFromDer(raw: Buffer): { info: CertInfo; pem: string } {
    const x509 = new X509Certificate(raw);
    const sans = (x509.subjectAltName ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const validTo = new Date(x509.validTo);
    return {
        pem: x509.toString(),
        info: {
            fingerprint256: createHash("sha256").update(raw).digest("hex"),
            subject: x509.subject.replace(/\n/g, ", "),
            issuer: x509.issuer.replace(/\n/g, ", "),
            validTo: Number.isNaN(validTo.getTime()) ? x509.validTo : validTo.toISOString(),
            sans,
        },
    };
}

export function probeServer(host: string, port: number, timeoutMs = 4000): Promise<ProbeOutcome> {
    return new Promise((resolve) => {
        let settled = false;
        let tcpConnected = false;

        const socket = tls.connect({
            host,
            port,
            // SNI must be a name, never an IP literal.
            servername: net.isIP(host) ? undefined : host,
            // We want to SEE the certificate to describe it; trust is decided by
            // `socket.authorized` and the user's pins, never by this flag.
            rejectUnauthorized: false,
            ALPNProtocols: ["http/1.1"],
        });

        const finish = (outcome: ProbeOutcome): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            resolve(outcome);
        };
        const fail = (result: ProbeResult): void => finish({ result, certPem: null });

        // TCP connected but no TLS answer in time: a plain server that just
        // sits on the bytes. Nothing connected at all: unreachable.
        const timer = setTimeout(
            () => fail(tcpConnected ? { kind: "no-tls" } : { kind: "unreachable", code: "ETIMEDOUT" }),
            timeoutMs,
        );

        socket.once("connect", () => {
            tcpConnected = true;
        });

        socket.once("secureConnect", () => {
            try {
                const peer = socket.getPeerCertificate(false);
                if (!peer || !peer.raw) return fail({ kind: "unreachable", code: "NO_CERTIFICATE" });
                const { info, pem } = certInfoFromDer(peer.raw);
                if (socket.authorized) return finish({ result: { kind: "trusted", cert: info }, certPem: pem });
                const reason = String(socket.authorizationError ?? "UNKNOWN_CERTIFICATE_ERROR");
                finish({ result: { kind: "untrusted", cert: info, reason }, certPem: pem });
            } catch {
                fail({ kind: "unreachable", code: "BAD_CERTIFICATE" });
            }
        });

        socket.once("error", (err: NodeJS.ErrnoException) => {
            const code = err.code ?? "";
            const text = err.message ?? "";
            if (
                NOT_TLS_CODES.has(code) ||
                /wrong version number|http request|packet length too long|unknown protocol/i.test(text) ||
                (tcpConnected && code === "ECONNRESET")
            ) {
                return fail({ kind: "no-tls" });
            }
            fail({ kind: "unreachable", code: code || "ERROR" });
        });
    });
}
