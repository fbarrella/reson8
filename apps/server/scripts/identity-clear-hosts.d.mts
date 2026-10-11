export function wantsYes(argv: string[]): boolean;
export function serversWithLists<T extends { authAllowedHosts?: string[] | null }>(servers: T[]): T[];
