/**
 * Storage Service — deletes previously uploaded message attachments.
 *
 * Mirrors the dual-backend split in `routes/upload.route.ts`: Cloudinary
 * assets are removed via their `public_id` (captured at upload time),
 * local-disk files are removed from `./uploads/`.
 */

import { unlink } from "node:fs/promises";
import path from "node:path";
import { v2 as cloudinary } from "cloudinary";

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

/**
 * Deletes an attachment from whichever backend stored it.
 *
 * `publicId` presence is the discriminator: it's only ever set when the
 * attachment was uploaded to Cloudinary (see `uploadToCloudinary` in
 * upload.route.ts), so its absence means the file lives on local disk.
 * Failures are swallowed (logged by the caller if desired) — a missing or
 * already-deleted file shouldn't block the message row from being deleted.
 */
export async function deleteAttachment(
    url: string,
    publicId?: string | null,
): Promise<void> {
    if (publicId) {
        cloudinary.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET,
        });
        await cloudinary.uploader
            .destroy(publicId, { resource_type: "image" })
            .catch(() => {});
        return;
    }

    if (!url.startsWith("/uploads/")) return;

    // path.basename strips any directory-traversal segments, so the
    // resolved path always stays inside UPLOADS_DIR regardless of what the
    // stored URL contains.
    const filePath = path.join(UPLOADS_DIR, path.basename(url));
    await unlink(filePath).catch(() => {});
}
