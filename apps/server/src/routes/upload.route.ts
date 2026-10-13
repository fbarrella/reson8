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
 * POST /api/upload/channel-icon   — custom text-channel tree icons (PRD
 *                                   14.7), already cropped client-side to
 *                                   128x128, up to 512KB.
 * POST /api/upload/server-icon   — the server's icon (PRD 19 A2), up to 1MB.
 *                                   Admin-only, token required, and the file
 *                                   is validated by its real bytes.
 * All five accept multipart form data with a single image file and support
 * the same dual storage backend:
 *   1. Local filesystem (default) — saves to ./uploads/
 *   2. Cloudinary CDN — activated when CLOUDINARY_* env vars are present.
 *
 * Returns { url, publicId?, uploadId } on success. `uploadId` is the stored-file
 * ledger id (PRD 16.8): attach the upload to a message/emoji/icon by sending
 * that id over the socket. Local-disk `url`s are the host-independent path
 * ("/uploads/<file>"); clients resolve them against the server address.
 *
 * Every route checks the file's real bytes (PRD 19 A10): a PNG/JPEG/GIF/WebP
 * whose type equals the declared MIME type, stored under the sniffed extension.
 *
 * Authorization: send `Authorization: Bearer <token>` with a token from the
 * socket's REQUEST_UPLOAD_TOKEN. The upload is then recorded as owned by that
 * user and only they can attach it. Requests with no header (clients older
 * than v2.5.0) are accepted while ALLOW_TOKENLESS_UPLOADS is true, recorded
 * ownerless; a header with an unknown/expired token is always a 401.
 */

import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { StoredFileKind } from "@prisma/client";
import { v2 as cloudinary } from "cloudinary";
import { ALLOW_TOKENLESS_UPLOADS } from "../config/upload.config.js";
import { extractBearerToken, recordStoredFile, resolveUploadTokenOwner } from "../services/stored-file.service.js";
import { deleteAttachment } from "../services/storage.service.js";
import { getUserPermissions, isAdmin } from "../services/permissions.service.js";
import { validateImageBytes, validateServerIcon } from "../services/image-sniff.js";

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

const MAX_SERVER_ICON_FILE_SIZE = 1024 * 1024; // 1MB (PRD 19 A2)

/** Opt-in extras for one route; the other routes pass none and behave exactly as before. */
interface UploadOptions {
    allowedMimeTypes?: Set<string>;
    /** The upload must be attributed to a user (a bearer token); a tokenless request is a 401. */
    requireToken?: boolean;
    /** Runs right after authentication, BEFORE the body is read. A returned refusal ends the request. */
    authorize?: (ownerId: string) => Promise<{ status: number; error: string } | null>;
    /**
     * Runs on the buffered bytes. `fileName` replaces the client's file name
     * for storage. Defaults to validateImageBytes (PRD 19 A10): EVERY route
     * checks the real bytes; the server icon passes its stricter rule.
     */
    validate?: (
        buffer: Buffer,
        declaredMime: string,
        originalName: string,
    ) => { ok: true; fileName: string } | { ok: false; error: string };
}

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
 * Resolves who is uploading from the bearer token, or replies 401 and
 * returns null. Runs BEFORE the multipart body is read, so an unauthorized
 * request never gets as far as buffering a file.
 */
async function authenticateUpload(
    app: FastifyInstance,
    request: FastifyRequest,
    reply: FastifyReply,
): Promise<{ ownerId: string | null } | null> {
    if (request.headers.authorization !== undefined) {
        const token = extractBearerToken(request.headers.authorization);
        const userId = token ? await resolveUploadTokenOwner(app.redis, token) : null;
        if (!userId) {
            reply.status(401).send({ error: "Upload session expired" });
            return null;
        }
        return { ownerId: userId };
    }
    if (!ALLOW_TOKENLESS_UPLOADS) {
        reply.status(401).send({ error: "Upload token required" });
        return null;
    }
    return { ownerId: null };
}

/**
 * Shared body for all upload routes — authenticates, validates MIME type,
 * streams the file into a buffer while enforcing `maxSize`, stores it via
 * whichever backend is configured, then records it in the stored-file ledger.
 */
async function handleUpload(
    app: FastifyInstance,
    request: FastifyRequest,
    reply: FastifyReply,
    maxSize: number,
    kind: StoredFileKind,
    options: UploadOptions = {},
): Promise<void> {
    const allowedMimeTypes = options.allowedMimeTypes ?? ALLOWED_MIME_TYPES;
    const auth = await authenticateUpload(app, request, reply);
    if (!auth) return;

    if (options.requireToken && !auth.ownerId) {
        reply.status(401).send({ error: "Upload token required" });
        return;
    }
    if (options.authorize && auth.ownerId) {
        const refusal = await options.authorize(auth.ownerId);
        if (refusal) {
            reply.status(refusal.status).send({ error: refusal.error });
            return;
        }
    }

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
    // PRD 19 A10: the stored name and extension come from the SNIFFED type,
    // never from the client (a request used to be able to store x.html as an
    // "image" under the public /uploads/ path).
    const validate = options.validate ?? validateImageBytes;
    const verdict = validate(buffer, data.mimetype, data.filename || "image");
    if (!verdict.ok) {
        reply.status(400).send({ error: verdict.error });
        return;
    }
    const originalName = verdict.fileName;

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

    // Record the file in the ledger. If that fails the file would be an
    // untracked orphan, so remove it before surfacing the error.
    let uploadId: string;
    try {
        ({ id: uploadId } = await recordStoredFile(app.prisma, { url, publicId, kind, ownerId: auth.ownerId }));
    } catch (err) {
        await deleteAttachment(url, publicId).catch(() => {});
        throw err;
    }

    app.log.info({ url, size: buffer.length, mime: data.mimetype, kind, uploadId }, "File uploaded");
    reply.send({ url, publicId, uploadId });
}

/**
 * Registers the upload routes on the Fastify instance.
 */
export async function registerUploadRoute(app: FastifyInstance): Promise<void> {
    app.post("/api/upload", async (request, reply) => {
        try {
            await handleUpload(app, request, reply, MAX_FILE_SIZE, "MESSAGE_ATTACHMENT");
        } catch (err) {
            app.log.error({ err }, "Error in /api/upload");
            reply.status(500).send({ error: "Upload failed" });
        }
    });

    app.post("/api/upload/emoji", async (request, reply) => {
        try {
            await handleUpload(app, request, reply, MAX_EMOJI_FILE_SIZE, "CUSTOM_EMOJI");
        } catch (err) {
            app.log.error({ err }, "Error in /api/upload/emoji");
            reply.status(500).send({ error: "Upload failed" });
        }
    });

    // Animated custom emoji (PRD 13.13) — GIF-only, uploaded as-is with no
    // client-side crop/resize, so it gets its own (larger) size cap.
    app.post("/api/upload/emoji-animated", async (request, reply) => {
        try {
            await handleUpload(app, request, reply, MAX_ANIMATED_EMOJI_FILE_SIZE, "CUSTOM_EMOJI", {
                allowedMimeTypes: ANIMATED_EMOJI_MIME_TYPES,
            });
        } catch (err) {
            app.log.error({ err }, "Error in /api/upload/emoji-animated");
            reply.status(500).send({ error: "Upload failed" });
        }
    });

    // Custom text-channel icon (PRD 14.7) — already cropped client-side to
    // 128x128 just like /api/upload/emoji, sharing its 512KB cap. No
    // approval-queue gating here (unlike custom emoji): channel icons are
    // admin-only via the UPDATE_CHANNEL socket event's own MANAGE_CHANNELS
    // check, so this endpoint only needs to accept and store the file.
    app.post("/api/upload/channel-icon", async (request, reply) => {
        try {
            await handleUpload(app, request, reply, MAX_EMOJI_FILE_SIZE, "CHANNEL_ICON");
        } catch (err) {
            app.log.error({ err }, "Error in /api/upload/channel-icon");
            reply.status(500).send({ error: "Upload failed" });
        }
    });

    // Server icon (PRD 19 A2). Unlike the routes above this one checks WHO is
    // uploading before reading the body (ADMIN only, token required) and the
    // file's real bytes after it; the stored name is built from the sniffed
    // type, never from the client's file name. The claim in
    // UPDATE_SERVER_SETTINGS checks the owner again.
    app.post("/api/upload/server-icon", async (request, reply) => {
        try {
            await handleUpload(app, request, reply, MAX_SERVER_ICON_FILE_SIZE, "SERVER_ICON", {
                requireToken: true,
                authorize: async (ownerId) => {
                    const perms = await getUserPermissions(app.prisma, ownerId, app.serverId);
                    return isAdmin(perms) ? null : { status: 403, error: "Only a server admin can change the server icon" };
                },
                validate: (buffer, declaredMime) => validateServerIcon(buffer, declaredMime),
            });
        } catch (err) {
            app.log.error({ err }, "Error in /api/upload/server-icon");
            reply.status(500).send({ error: "Upload failed" });
        }
    });
}
