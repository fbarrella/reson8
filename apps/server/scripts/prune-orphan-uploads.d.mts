export function extractUploadBasename(url: unknown): string | null;
export interface UploadFileInfo {
    name: string;
    size: number;
    mtimeMs: number;
}
export function findOrphanFiles(input: {
    files: UploadFileInfo[];
    referenced: ReadonlySet<string>;
    minAgeMs: number;
    now: number;
}): UploadFileInfo[];
export function formatBytes(n: number): string;
