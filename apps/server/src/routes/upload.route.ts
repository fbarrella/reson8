/**
 * Upload Route — File upload endpoint for image sharing.
 *
 * POST /api/upload — accepts multipart form data with a single image file.
 * Supports dual storage backend:
 *   1. Local filesystem (default) — saves to ./uploads/
 *   2. Cloudinary CDN — activated when CLOUDINARY_* env vars are present.
 *
 * Returns { url: string } on success.
 */

import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { v2 as cloudinary } from "cloudinary";

const ALLOWED_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

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
 * Registers the upload route on the Fastify instance.
 */
export async function registerUploadRoute(app: FastifyInstance): Promise<void> {
    app.post("/api/upload", async (request, reply) => {
        try {
            const data = await request.file();
            if (!data) {
                return reply.status(400).send({ error: "No file uploaded" });
            }

            // Validate MIME type
            if (!ALLOWED_MIME_TYPES.has(data.mimetype)) {
                return reply.status(400).send({
                    error: `Invalid file type: ${data.mimetype}. Allowed: ${[...ALLOWED_MIME_TYPES].join(", ")}`,
                });
            }

            // Read the file into a buffer
            const chunks: Buffer[] = [];
            let totalSize = 0;

            for await (const chunk of data.file) {
                totalSize += chunk.length;
                if (totalSize > MAX_FILE_SIZE) {
                    return reply.status(413).send({
                        error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
                    });
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
            return reply.send({ url, publicId });
        } catch (err) {
            app.log.error({ err }, "Error in /api/upload");
            return reply.status(500).send({ error: "Upload failed" });
        }
    });
}
