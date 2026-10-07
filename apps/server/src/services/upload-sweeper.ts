/**
 * Unclaimed-upload sweeper (PRD 16.9).
 *
 * Files are uploaded the moment a user picks them, long before a message,
 * emoji or icon uses them, so some are never used (the app was closed, the
 * user changed their mind and the immediate discard didn't reach us…). This
 * deletes any upload still unclaimed after UNCLAIMED_UPLOAD_TTL_MS, hourly.
 * It is only a safety net: DISCARD_UPLOAD handles the common cases at once.
 */

import type { FastifyInstance } from "fastify";
import {
    UNCLAIMED_UPLOAD_TTL_MS,
    UPLOAD_SWEEP_FIRST_RUN_DELAY_MS,
    UPLOAD_SWEEP_INTERVAL_MS,
} from "../config/upload.config.js";
import { sweepUnclaimedUploads } from "./stored-file.service.js";

export function startUploadSweeper(app: FastifyInstance): void {
    let running = false;

    const run = async (): Promise<void> => {
        if (running) return; // never overlap two sweeps
        running = true;
        try {
            const { swept } = await sweepUnclaimedUploads(app.prisma, {
                olderThan: new Date(Date.now() - UNCLAIMED_UPLOAD_TTL_MS),
            });
            if (swept > 0) app.log.info({ swept }, "Swept unclaimed uploads");
        } catch (err) {
            app.log.error({ err }, "Unclaimed-upload sweep failed");
        } finally {
            running = false;
        }
    };

    // unref(): a pending sweep must never keep the process alive on shutdown.
    const first = setTimeout(run, UPLOAD_SWEEP_FIRST_RUN_DELAY_MS);
    const timer = setInterval(run, UPLOAD_SWEEP_INTERVAL_MS);
    first.unref();
    timer.unref();

    app.addHook("onClose", async () => {
        clearTimeout(first);
        clearInterval(timer);
    });
}
