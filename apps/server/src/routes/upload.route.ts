/**
 * Upload Route — File upload endpoints for image sharing and custom emoji.
 *
 * POST /api/upload                — general chat attachments, up to 5MB.
 * POST /api/upload/emoji          — static custom emoji images (already
 *                                   cropped client-side to 128x128), up to
 *                                   512KB.
 * POST /api/upload/emoji-animated — animated GIF custom emoji (PRD 13.13),
 *                                   uploaded as-is with no crop/resize, up
 *                                   to 2MB.
 * All three accept multipart form data with a single image file and support
 * the same dual storage backend:
 *   1. Local filesystem (default) — saves to ./uploads/
 *   2. Cloudinary CDN — activated when CLOUDINARY_* env vars are present.
 *
 * Returns { url: string, publicId?: string } on success.
 */

import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { v2 as cloudinary } from "cloudinary";

const ALLOWED_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_EMOJI_FILE_SIZE = 512 * 1024; // 512KB — generous for a 128x128 PNG
const MAX_ANIMATED_EMOJI_FILE_SIZE = 2 * 1024 * 1024; // 2MB (PRD 13.13) — uploaded as-is, no crop/resize
const ANIMATED_EMOJI_MIME_TYPES = new Set(["image/gif"]);

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

/**
 * Checks if Cloudinary is configured via environment variables.
 */
function isCloudinaryConfigured(): boolean {
    return !!(
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
    );
}

/**
 * Uploads a buffer to Cloudinary and returns the secure URL + public_id
 * (the public_id is needed later to delete the asset — see storage.service.ts).
 */
async function uploadToCloudinary(
    buffer: Buffer,
    fileName: string,
): Promise<{ url: string; publicId: string }> {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder: "reson8",
                public_id: `${randomUUID()}-${path.parse(fileName).name}`,
                resource_type: "image",
            },
            (error, result) => {
                if (error) {
                    reject(error);
                } else {
                    resolve({ url: result!.secure_url, publicId: result!.public_id });
                }
            },
        );
        stream.end(buffer);
    });
}

/**
 * Saves a buffer to local disk and returns the relative URL path.
 */
async function saveLocally(buffer: Buffer, fileName: string): Promise<string> {
    if (!existsSync(UPLOADS_DIR)) {
        mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    const safeName = `${randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const filePath = path.join(UPLOADS_DIR, safeName);

    const { Readable } = await import("node:stream");
    const readable = Readable.from(buffer);
    const writable = createWriteStream(filePath);
    await pipeline(readable, writable);

    return `/uploads/${safeName}`;
}

/**
 * Shared body for both upload routes — validates MIME type, streams the
 * file into a buffer while enforcing `maxSize`, then stores it via
 * whichever backend is configured.
 */
async function handleUpload(
    app: FastifyInstance,
    request: FastifyRequest,
    reply: FastifyReply,
    maxSize: number,
    allowedMimeTypes: Set<string> = ALLOWED_MIME_TYPES,
): Promise<void> {
    const data = await request.file();
    if (!data) {
        reply.status(400).send({ error: "No file uploaded" });
        return;
    }

    if (!allowedMimeTypes.has(data.mimetype)) {
        reply.status(400).send({
            error: `Invalid file type: ${data.mimetype}. Allowed: ${[...allowedMimeTypes].join(", ")}`,
        });
        return;
    }

    const chunks: Buffer[] = [];
    let totalSize = 0;

    for await (const chunk of data.file) {
        totalSize += chunk.length;
        if (totalSize > maxSize) {
            reply.status(413).send({
                error: `File too large. Maximum size is ${Math.round(maxSize / 1024)}KB`,
            });
            return;
        }
        chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    const originalName = data.filename || "image";

    let url: string;
    let publicId: string | undefined;

    if (isCloudinaryConfigured()) {
        app.log.info("Uploading to Cloudinary...");
        const result = await uploadToCloudinary(buffer, originalName);
        url = result.url;
        publicId = result.publicId;
    } else {
        app.log.info("Saving locally...");
        url = await saveLocally(buffer, originalName);
    }

    app.log.info({ url, size: buffer.length, mime: data.mimetype }, "File uploaded");
    reply.send({ url, publicId });
}

/**
 * Registers the upload routes on the Fastify instance.
 */
export async function registerUploadRoute(app: FastifyInstance): Promise<void> {
    app.post("/api/upload", async (request, reply) => {
        try {
            await handleUpload(app, request, reply, MAX_FILE_SIZE);
        } catch (err) {
            app.log.error({ err }, "Error in /api/upload");
            reply.status(500).send({ error: "Upload failed" });
        }
    });

    app.post("/api/upload/emoji", async (request, reply) => {
        try {
            await handleUpload(app, request, reply, MAX_EMOJI_FILE_SIZE);
        } catch (err) {
            app.log.error({ err }, "Error in /api/upload/emoji");
            reply.status(500).send({ error: "Upload failed" });
        }
    });

    // Animated custom emoji (PRD 13.13) — GIF-only, uploaded as-is with no
    // client-side crop/resize, so it gets its own (larger) size cap.
    app.post("/api/upload/emoji-animated", async (request, reply) => {
        try {
            await handleUpload(app, request, reply, MAX_ANIMATED_EMOJI_FILE_SIZE, ANIMATED_EMOJI_MIME_TYPES);
        } catch (err) {
            app.log.error({ err }, "Error in /api/upload/emoji-animated");
            reply.status(500).send({ error: "Upload failed" });
        }
    });
}
