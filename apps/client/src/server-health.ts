/**
 * Saved-server latency probe (PRD 20 W1) — the pure half: which URL to ask.
 * The main process does the request through the default session.
 */
import { parseServerAddress, hostKey } from "./tls-trust";

export function healthProbeUrl(
    address: string,
    knowsHttps: (hostKey: string) => boolean,
): string | null {
    const parsed = parseServerAddress(address);
    if (!parsed.ok) return null;
    const { scheme, host, port } = parsed.value;
    const httpsKey = hostKey(host, port ?? 443);
    const useHttps = scheme === "https" || (scheme === null && knowsHttps(httpsKey));
    const finalScheme = useHttps ? "https" : "http";
    const h = host.includes(":") ? `[${host}]` : host;
    const p = port ?? (useHttps ? 443 : 80);
    const defaultPort = useHttps ? 443 : 80;
    return `${finalScheme}://${h}${p === defaultPort ? "" : `:${p}`}/health`;
}
