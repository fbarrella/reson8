/**
 * @reson8/shared-types
 *
 * Shared type definitions for the Reson8 platform.
 * Consumed by both the server and client workspaces.
 */

export * from "./socket-events.js";
export * from "./models.js";

// Explicitly export enums to ensure tsx/ESM resolves them correctly
export { PermissionFlags, ChannelType } from "./models.js";
