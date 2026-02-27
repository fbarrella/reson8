/**
 * Reson8 Client — Renderer Script
 *
 * Handles the three-pane UI:
 *   - Left pane: Channel tree with occupants
 *   - Right pane: Server event log
 *   - Bottom: Voice controls + status bar
 */

// Type declaration for the preload API
interface Reson8Api {
    connect(host: string, port: number, nickname: string): void;
    disconnect(): void;
    joinVoiceChannel(channelId: string): Promise<{ success: boolean; error?: string }>;
    leaveVoiceChannel(): void;
    toggleMute(): boolean;
    toggleDeafen(): boolean;
    createChannel(
        serverId: string,
        name: string,
        type: "TEXT" | "VOICE",
        parentId?: string | null,
    ): Promise<{ success: boolean; channelId?: string; error?: string }>;
    deleteChannel(channelId: string): Promise<{ success: boolean; error?: string }>;
    on(event: string, callback: (...args: any[]) => void): void;
}

const api = (window as any).reson8Api as Reson8Api;

// ── State ─────────────────────────────────────────────────────────────────

let isConnected = false;
let currentServerId = "";
let currentChannelId: string | null = null;
let isInVoice = false;
let isMuted = false;
let isDeafened = false;

// Store the current tree for parent selection in the modal
let currentTree: any[] = [];

// ── DOM Elements ──────────────────────────────────────────────────────────

const hostInput = document.getElementById("host") as HTMLInputElement;
const portInput = document.getElementById("port") as HTMLInputElement;
const nicknameInput = document.getElementById("nickname") as HTMLInputElement;
const btnConnect = document.getElementById("btn-connect") as HTMLButtonElement;
const btnDisconnect = document.getElementById("btn-disconnect") as HTMLButtonElement;

const channelTree = document.getElementById("channel-tree") as HTMLDivElement;
const eventLog = document.getElementById("event-log") as HTMLDivElement;

const voicePanel = document.getElementById("voice-panel") as HTMLDivElement;
const voiceChannelName = document.getElementById("voice-channel-name") as HTMLSpanElement;
const btnMute = document.getElementById("btn-mute") as HTMLButtonElement;
const btnDeafen = document.getElementById("btn-deafen") as HTMLButtonElement;
const btnLeaveVoice = document.getElementById("btn-leave-voice") as HTMLButtonElement;

const statusDot = document.getElementById("status-dot") as HTMLSpanElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;

const btnCreateChannel = document.getElementById("btn-create-channel") as HTMLButtonElement;
const createChannelModal = document.getElementById("create-channel-modal") as HTMLDivElement;
const newChannelName = document.getElementById("new-channel-name") as HTMLInputElement;
const newChannelType = document.getElementById("new-channel-type") as HTMLSelectElement;
const newChannelParent = document.getElementById("new-channel-parent") as HTMLSelectElement;
const btnModalCancel = document.getElementById("btn-modal-cancel") as HTMLButtonElement;
const btnModalCreate = document.getElementById("btn-modal-create") as HTMLButtonElement;

const deleteChannelModal = document.getElementById("delete-channel-modal") as HTMLDivElement;
const deleteChannelNameEl = document.getElementById("delete-channel-name") as HTMLElement;
const btnDeleteCancel = document.getElementById("btn-delete-cancel") as HTMLButtonElement;
const btnDeleteConfirm = document.getElementById("btn-delete-confirm") as HTMLButtonElement;

// State for pending delete
let pendingDeleteChannelId: string | null = null;

// ── Logging ───────────────────────────────────────────────────────────────

function log(message: string, type: "info" | "success" | "error" | "" = ""): void {
    const entry = document.createElement("div");
    entry.className = `log-entry ${type}`;

    const time = new Date().toLocaleTimeString();
    entry.innerHTML = `<span class="timestamp">[${time}]</span>${message}`;

    eventLog.appendChild(entry);
    eventLog.scrollTop = eventLog.scrollHeight;
}

// ── Connection ────────────────────────────────────────────────────────────

btnConnect.addEventListener("click", () => {
    const host = hostInput.value.trim();
    const port = parseInt(portInput.value.trim(), 10);
    const nickname = nicknameInput.value.trim() || "User";

    if (!host || !port) {
        log("Please enter server address and port", "error");
        return;
    }

    log(`Connecting to ${host}:${port} as "${nickname}"...`, "info");
    api.connect(host, port, nickname);
});

btnDisconnect.addEventListener("click", () => {
    api.disconnect();
});

// ── Channel Tree Rendering ────────────────────────────────────────────────

interface TreeNode {
    id: string;
    name: string;
    type: "TEXT" | "VOICE";
    parentId: string | null;
    children: TreeNode[];
    occupants: { userId: string; nickname: string }[];
}

function renderTree(tree: TreeNode[]): void {
    currentTree = tree;
    channelTree.innerHTML = "";

    if (tree.length === 0) {
        channelTree.innerHTML = `
            <div style="padding: 20px 12px; color: var(--text-muted); font-size: 12px; text-align: center;">
                No channels found
            </div>
        `;
        return;
    }

    for (const node of tree) {
        if (node.children.length > 0) {
            // This node has children — render as a category
            channelTree.appendChild(renderCategory(node));
        } else {
            // Leaf channel at root level
            channelTree.appendChild(renderChannel(node));
            renderOccupants(channelTree, node);
        }
    }

    updateParentSelect(tree);
}

function renderCategory(node: TreeNode): HTMLDivElement {
    const category = document.createElement("div");
    category.className = "tree-category";

    const label = document.createElement("div");
    label.className = "tree-category-label";
    label.innerHTML = `<span class="arrow">▾</span> ${escapeHtml(node.name)}`;
    label.addEventListener("click", () => {
        category.classList.toggle("collapsed");
    });
    category.appendChild(label);

    const children = document.createElement("div");
    children.className = "tree-children";

    for (const child of node.children) {
        if (child.children.length > 0) {
            children.appendChild(renderCategory(child));
        } else {
            children.appendChild(renderChannel(child));
            renderOccupants(children, child);
        }
    }

    // Also render the category itself as a joinable channel if it's a voice channel
    // (categories can also be voice channels that users can join)

    category.appendChild(children);
    return category;
}

function renderChannel(node: TreeNode): HTMLDivElement {
    const channel = document.createElement("div");
    channel.className = "tree-channel";
    if (currentChannelId === node.id) {
        channel.classList.add("active");
    }

    const isVoice = node.type === "VOICE";
    const iconClass = isVoice ? "voice" : "text";
    const icon = isVoice ? "🔊" : "💬";

    const count = node.occupants.length;
    const countBadge = count > 0 ? `<span class="ch-count">${count}</span>` : "";

    channel.innerHTML = `
        <span class="ch-icon ${iconClass}">${icon}</span>
        <span class="ch-name">${escapeHtml(node.name)}</span>
        ${countBadge}
    `;

    channel.addEventListener("click", () => handleChannelClick(node));

    // Right-click to delete
    channel.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showDeleteModal(node.id, node.name);
    });

    return channel;
}

function renderOccupants(container: HTMLElement, node: TreeNode): void {
    for (const occ of node.occupants) {
        const el = document.createElement("div");
        el.className = "tree-occupant";
        el.innerHTML = `<span class="occ-dot"></span>${escapeHtml(occ.nickname)}`;
        container.appendChild(el);
    }
}

function updateParentSelect(tree: TreeNode[]): void {
    newChannelParent.innerHTML = '<option value="">— None (root) —</option>';
    addParentOptions(tree, 0);
}

function addParentOptions(nodes: TreeNode[], depth: number): void {
    for (const node of nodes) {
        const indent = "  ".repeat(depth);
        const option = document.createElement("option");
        option.value = node.id;
        option.textContent = `${indent}${node.name}`;
        newChannelParent.appendChild(option);

        if (node.children.length > 0) {
            addParentOptions(node.children, depth + 1);
        }
    }
}

// ── Channel Interaction ───────────────────────────────────────────────────

async function handleChannelClick(node: TreeNode): Promise<void> {
    if (!isConnected) return;

    if (node.type === "VOICE") {
        // If already in this voice channel, do nothing
        if (currentChannelId === node.id && isInVoice) return;

        // Leave previous voice channel first
        if (isInVoice) {
            api.leaveVoiceChannel();
            isInVoice = false;
        }

        currentChannelId = node.id;
        log(`Joining voice channel: ${node.name}...`, "info");

        const result = await api.joinVoiceChannel(node.id);
        if (result.success) {
            isInVoice = true;
            isMuted = false;
            isDeafened = false;
            updateVoiceUI(node.name);
            log(`Joined voice channel: ${node.name}`, "success");
        } else {
            log(`Failed to join voice: ${result.error}`, "error");
            currentChannelId = null;
        }
    } else {
        // Text channel — mark as active for now
        currentChannelId = node.id;
        log(`Switched to text channel: ${node.name}`, "info");
    }

    // Re-render tree to update active state
    if (currentTree.length > 0) {
        renderTree(currentTree);
    }
}

async function deleteChannel(channelId: string): Promise<void> {
    const result = await api.deleteChannel(channelId);
    if (result.success) {
        log("Channel deleted", "success");
    } else {
        log(`Failed to delete channel: ${result.error}`, "error");
    }
}

// ── Voice Controls ────────────────────────────────────────────────────────

function updateVoiceUI(channelName?: string): void {
    if (isInVoice) {
        voicePanel.classList.add("visible");
        if (channelName) {
            voiceChannelName.textContent = `Voice: ${channelName}`;
        }
        btnMute.textContent = isMuted ? "🔇 Unmute" : "🎤 Mute";
        btnMute.classList.toggle("active", isMuted);
        btnDeafen.textContent = isDeafened ? "🔇 Undeafen" : "🔊 Deafen";
        btnDeafen.classList.toggle("active", isDeafened);
    } else {
        voicePanel.classList.remove("visible");
    }
}

btnMute.addEventListener("click", () => {
    isMuted = api.toggleMute();
    updateVoiceUI();
});

btnDeafen.addEventListener("click", () => {
    isDeafened = api.toggleDeafen();
    updateVoiceUI();
});

btnLeaveVoice.addEventListener("click", () => {
    api.leaveVoiceChannel();
    isInVoice = false;
    currentChannelId = null;
    updateVoiceUI();
    log("Left voice channel", "info");
    if (currentTree.length > 0) {
        renderTree(currentTree);
    }
});

// ── Create Channel Modal ──────────────────────────────────────────────────

btnCreateChannel.addEventListener("click", () => {
    if (!isConnected) return;
    newChannelName.value = "";
    createChannelModal.classList.add("visible");
    newChannelName.focus();
});

btnModalCancel.addEventListener("click", () => {
    createChannelModal.classList.remove("visible");
});

createChannelModal.addEventListener("click", (e) => {
    if (e.target === createChannelModal) {
        createChannelModal.classList.remove("visible");
    }
});

// Prevent clicks inside modal content from closing the modal
const modalContents = document.querySelectorAll(".modal-content");
modalContents.forEach((content) => {
    content.addEventListener("click", (e) => {
        e.stopPropagation();
    });
});

btnModalCreate.addEventListener("click", async () => {
    const name = newChannelName.value.trim();
    if (!name) {
        newChannelName.focus();
        return;
    }

    const type = newChannelType.value as "TEXT" | "VOICE";
    const parentId = newChannelParent.value || null;

    const result = await api.createChannel(currentServerId, name, type, parentId);
    if (result.success) {
        log(`Channel "${name}" created`, "success");
        createChannelModal.classList.remove("visible");
    } else {
        log(`Failed to create channel: ${result.error}`, "error");
    }
});

// ── Delete Channel Modal ──────────────────────────────────────────────────

function showDeleteModal(channelId: string, channelName: string): void {
    pendingDeleteChannelId = channelId;
    deleteChannelNameEl.textContent = channelName;
    deleteChannelModal.classList.add("visible");
}

btnDeleteCancel.addEventListener("click", () => {
    deleteChannelModal.classList.remove("visible");
    pendingDeleteChannelId = null;
});

deleteChannelModal.addEventListener("click", (e) => {
    if (e.target === deleteChannelModal) {
        deleteChannelModal.classList.remove("visible");
        pendingDeleteChannelId = null;
    }
});

btnDeleteConfirm.addEventListener("click", async () => {
    if (!pendingDeleteChannelId) return;
    const channelId = pendingDeleteChannelId;
    deleteChannelModal.classList.remove("visible");
    pendingDeleteChannelId = null;
    await deleteChannel(channelId);
});

// ── Event Listeners ───────────────────────────────────────────────────────

api.on("connected", (data: { serverId: string }) => {
    isConnected = true;
    currentServerId = data.serverId;
    btnConnect.disabled = true;
    btnDisconnect.disabled = false;
    hostInput.disabled = true;
    portInput.disabled = true;
    nicknameInput.disabled = true;
    statusDot.classList.add("connected");
    statusText.textContent = `Connected as ${nicknameInput.value.trim() || "User"}`;
    log("Connected to server", "success");
});

api.on("disconnected", () => {
    isConnected = false;
    isInVoice = false;
    currentChannelId = null;
    currentServerId = "";
    currentTree = [];
    btnConnect.disabled = false;
    btnDisconnect.disabled = true;
    hostInput.disabled = false;
    portInput.disabled = false;
    nicknameInput.disabled = false;
    statusDot.classList.remove("connected");
    statusText.textContent = "Disconnected";
    updateVoiceUI();
    channelTree.innerHTML = `
        <div style="padding: 20px 12px; color: var(--text-muted); font-size: 12px; text-align: center;">
            Connect to a server to see channels
        </div>
    `;
    log("Disconnected from server", "error");
});

api.on("error", (data: { message: string }) => {
    log(`Error: ${data.message}`, "error");
});

api.on("channel-tree", (data: { serverId: string; tree: TreeNode[] }) => {
    renderTree(data.tree);
});

api.on("presence", (data: { channelId: string; occupants: any[] }) => {
    // Update occupants in the current tree
    updateOccupants(data.channelId, data.occupants);
});

api.on("user-joined", (data: { nickname: string }) => {
    log(`${data.nickname} joined the server`, "info");
});

api.on("user-left", (data: { userId: string }) => {
    log(`A user left the server`, "info");
});

api.on("channel-deleted", (data: { channelId: string }) => {
    if (currentChannelId === data.channelId) {
        currentChannelId = null;
        if (isInVoice) {
            api.leaveVoiceChannel();
            isInVoice = false;
            updateVoiceUI();
        }
        log("Your current channel was deleted", "error");
    }
});

// ── Tree Update Helpers ───────────────────────────────────────────────────

function updateOccupants(channelId: string, occupants: any[]): void {
    // Walk the tree and update occupants for the matching channel
    function walk(nodes: TreeNode[]): boolean {
        for (const node of nodes) {
            if (node.id === channelId) {
                node.occupants = occupants.map((o) => ({
                    userId: o.userId,
                    nickname: o.nickname,
                }));
                return true;
            }
            if (walk(node.children)) return true;
        }
        return false;
    }

    if (walk(currentTree)) {
        renderTree(currentTree);
    }
}

// ── Utilities ─────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}
