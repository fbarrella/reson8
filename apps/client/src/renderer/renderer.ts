/**
 * Reson8 Client — Renderer Script
 *
 * Handles the three-pane UI:
 *   - Left pane: Channel tree with occupants
 *   - Right pane: Server event log
 *   - Bottom: Voice controls + status bar
 */

interface ChatMessage {
    id: string;
    channelId: string;
    userId: string;
    nickname: string;
    content: string;
    createdAt: string;
}

interface Reson8Api {
    getInstanceId(): string;
    connect(host: string, port: number, nickname: string): Promise<void>;
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
    sendMessage(channelId: string, content: string): Promise<{ success: boolean; messageId?: string }>;
    fetchMessages(channelId: string, before?: string, limit?: number): Promise<{ success: boolean; messages?: ChatMessage[]; error?: string }>;
    getAllUsers(serverId: string): Promise<{ success: boolean; users?: any[]; error?: string }>;
    getRoles(serverId: string): Promise<{ success: boolean; roles?: any[]; error?: string }>;
    assignRole(userId: string, roleId: string, action: "add" | "remove"): Promise<{ success: boolean; error?: string }>;
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
const tabBar = document.getElementById("tab-bar") as HTMLDivElement;
const tabContentArea = document.getElementById("tab-content-area") as HTMLDivElement;
const chatInputBar = document.getElementById("chat-input-bar") as HTMLDivElement;
const chatInput = document.getElementById("chat-input") as HTMLInputElement;
const btnSend = document.getElementById("btn-send") as HTMLButtonElement;

const voicePanel = document.getElementById("voice-panel") as HTMLDivElement;
const voiceChannelName = document.getElementById("voice-channel-name") as HTMLSpanElement;
const btnMute = document.getElementById("btn-mute") as HTMLButtonElement;
const btnDeafen = document.getElementById("btn-deafen") as HTMLButtonElement;
const btnLeaveVoice = document.getElementById("btn-leave-voice") as HTMLButtonElement;

const statusDot = document.getElementById("status-dot") as HTMLSpanElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const statusInstance = document.getElementById("status-instance") as HTMLSpanElement;
const btnCopyId = document.getElementById("btn-copy-id") as HTMLButtonElement;

// Show instance ID immediately on page load
setTimeout(() => {
    const id = api.getInstanceId();
    if (id) statusInstance.textContent = `ID: ${id}`;
}, 100);

// Copy instance ID to clipboard
btnCopyId.addEventListener("click", () => {
    const id = api.getInstanceId();
    if (id) {
        // Use a hidden textarea to copy (Electron renderer doesn't support navigator.clipboard)
        const textarea = document.createElement("textarea");
        textarea.value = id;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        btnCopyId.textContent = "Copied!";
        setTimeout(() => { btnCopyId.textContent = "Copy"; }, 1500);
    }
});

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

// Admin modal
const btnServerSettings = document.getElementById("btn-server-settings") as HTMLButtonElement;
const adminModal = document.getElementById("admin-modal") as HTMLDivElement;
const adminUserList = document.getElementById("admin-user-list") as HTMLDivElement;
const btnAdminClose = document.getElementById("btn-admin-close") as HTMLButtonElement;

// State for pending delete
let pendingDeleteChannelId: string | null = null;

// State for tabs: map of channelId → { tabEl, contentEl, messagesEl }
interface ChatTab {
    channelId: string;
    channelName: string;
    tabEl: HTMLDivElement;
    contentEl: HTMLDivElement;
    messagesEl: HTMLDivElement;
    loaded: boolean;
}
const chatTabs = new Map<string, ChatTab>();
let activeTabId = "server-log"; // default active tab
let allServerRoles: any[] = []; // cached roles for the admin panel

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
        // Text channel — open (or focus) a chat tab
        openChatTab(node.id, node.name);
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

api.on("connected", (data: { serverId: string; instanceId: string }) => {
    isConnected = true;
    currentServerId = data.serverId;
    btnConnect.disabled = true;
    btnDisconnect.disabled = false;
    hostInput.disabled = true;
    portInput.disabled = true;
    nicknameInput.disabled = true;
    statusDot.classList.add("connected");
    statusText.textContent = `Connected as ${nicknameInput.value.trim() || "User"}`;
    statusText.classList.add("connected");
    statusInstance.textContent = `ID: ${data.instanceId}`;
    log("Connected to server", "success");

    // Try to show the admin settings button (will only work if user has MANAGE_ROLES)
    api.getAllUsers(data.serverId).then((res) => {
        if (res.success) {
            btnServerSettings.style.display = "";
        }
    });
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
    statusText.classList.remove("connected");
    btnServerSettings.style.display = "none";
    updateVoiceUI();
    channelTree.innerHTML = `
        <div style="padding: 20px 12px; color: var(--text-muted); font-size: 12px; text-align: center;">
            Connect to a server to see channels
        </div>
    `;
    // Close all chat tabs
    for (const [channelId] of chatTabs) {
        closeTab(channelId);
    }
    switchTab("server-log");
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

// ── Admin Panel ───────────────────────────────────────────────────────

async function openAdminPanel(): Promise<void> {
    adminModal.classList.add("visible");
    adminUserList.innerHTML = '<div class="admin-empty">Loading users...</div>';

    // Fetch roles and users concurrently
    const [rolesRes, usersRes] = await Promise.all([
        api.getRoles(currentServerId),
        api.getAllUsers(currentServerId),
    ]);

    if (!rolesRes.success || !usersRes.success) {
        adminUserList.innerHTML = '<div class="admin-empty">Failed to load data. You may not have permission.</div>';
        return;
    }

    allServerRoles = rolesRes.roles ?? [];
    renderAdminUsers(usersRes.users ?? []);
}

function renderAdminUsers(users: any[]): void {
    adminUserList.innerHTML = "";

    if (users.length === 0) {
        adminUserList.innerHTML = '<div class="admin-empty">No users found.</div>';
        return;
    }

    for (const user of users) {
        const row = document.createElement("div");
        row.className = "admin-user-row";

        const userRoleIds = new Set((user.roles ?? []).map((r: any) => r.id));

        // User info
        const infoEl = document.createElement("div");
        infoEl.className = "admin-user-info";
        infoEl.innerHTML = `
            <div class="admin-user-nickname">${escapeHtml(user.nickname)}</div>
            <div class="admin-user-id">${escapeHtml(user.id)}</div>
        `;
        row.appendChild(infoEl);

        // Role toggles
        const badgesEl = document.createElement("div");
        badgesEl.className = "admin-role-badges";

        for (const role of allServerRoles) {
            const badge = document.createElement("span");
            badge.className = `role-badge${userRoleIds.has(role.id) ? " active" : ""}`;
            badge.textContent = role.name;
            if (role.color) {
                badge.style.borderColor = role.color;
                if (userRoleIds.has(role.id)) {
                    badge.style.background = role.color;
                    badge.style.color = "#fff";
                }
            }

            badge.addEventListener("click", async () => {
                const hasRole = badge.classList.contains("active");
                const action = hasRole ? "remove" : "add";

                // Block admin from removing their own admin role
                const myId = api.getInstanceId();
                if (action === "remove" && user.id === myId && role.name === "Server Admin") {
                    log("You cannot remove your own admin role", "error");
                    return;
                }

                const result = await api.assignRole(user.id, role.id, action);
                if (result.success) {
                    // Refresh the panel
                    openAdminPanel();
                } else {
                    log(`Failed to ${action} role: ${result.error}`, "error");
                }
            });

            badgesEl.appendChild(badge);
        }

        row.appendChild(badgesEl);
        adminUserList.appendChild(row);
    }
}

btnServerSettings.addEventListener("click", () => {
    if (!isConnected) return;
    openAdminPanel();
});

btnAdminClose.addEventListener("click", () => {
    adminModal.classList.remove("visible");
});

adminModal.addEventListener("click", (e) => {
    if (e.target === adminModal) {
        adminModal.classList.remove("visible");
    }
});

// ── Tab Management ────────────────────────────────────────────────────────

function switchTab(tabId: string): void {
    activeTabId = tabId;

    // Deactivate all tabs and content
    tabBar.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tabContentArea.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));

    // Activate selected tab
    const tabEl = tabBar.querySelector(`.tab[data-tab-id="${tabId}"]`);
    const contentEl = tabContentArea.querySelector(`.tab-content[data-tab-id="${tabId}"]`);
    tabEl?.classList.add("active");
    contentEl?.classList.add("active");

    // Show/hide chat input bar
    if (tabId === "server-log") {
        chatInputBar.classList.remove("visible");
    } else {
        chatInputBar.classList.add("visible");
        chatInput.focus();
    }
}

function openChatTab(channelId: string, channelName: string): void {
    // If tab already exists, just switch to it
    if (chatTabs.has(channelId)) {
        switchTab(channelId);
        return;
    }

    // Create tab button
    const tabEl = document.createElement("div");
    tabEl.className = "tab";
    tabEl.dataset.tabId = channelId;
    tabEl.innerHTML = `💬 ${escapeHtml(channelName)} <span class="tab-close">✕</span>`;

    tabEl.addEventListener("click", (e) => {
        // Check if close button was clicked
        if ((e.target as HTMLElement).classList.contains("tab-close")) {
            closeTab(channelId);
        } else {
            switchTab(channelId);
        }
    });

    tabBar.appendChild(tabEl);

    // Create tab content
    const contentEl = document.createElement("div");
    contentEl.className = "tab-content";
    contentEl.dataset.tabId = channelId;

    const messagesEl = document.createElement("div");
    messagesEl.className = "chat-messages";
    contentEl.appendChild(messagesEl);

    tabContentArea.appendChild(contentEl);

    // Store tab state
    const chatTab: ChatTab = {
        channelId,
        channelName,
        tabEl,
        contentEl,
        messagesEl,
        loaded: false,
    };
    chatTabs.set(channelId, chatTab);

    // Switch to the new tab
    switchTab(channelId);

    // Fetch message history
    loadChatHistory(chatTab);
}

function closeTab(channelId: string): void {
    const tab = chatTabs.get(channelId);
    if (!tab) return;

    tab.tabEl.remove();
    tab.contentEl.remove();
    chatTabs.delete(channelId);

    // If this was the active tab, switch to server log
    if (activeTabId === channelId) {
        switchTab("server-log");
    }
}

async function loadChatHistory(tab: ChatTab): Promise<void> {
    if (tab.loaded) return;
    tab.loaded = true;

    const result = await api.fetchMessages(tab.channelId);
    if (result.success && result.messages) {
        for (const msg of result.messages) {
            renderChatMessage(tab, msg);
        }
    }
}

function renderChatMessage(tab: ChatTab, msg: ChatMessage): void {
    const el = document.createElement("div");
    el.className = "chat-msg";

    const time = new Date(msg.createdAt).toLocaleTimeString();
    el.innerHTML = `<span class="msg-time">${time}</span><span class="msg-nick">${escapeHtml(msg.nickname)}</span><span class="msg-text">${escapeHtml(msg.content)}</span>`;

    tab.messagesEl.appendChild(el);
    tab.messagesEl.scrollTop = tab.messagesEl.scrollHeight;
}

// ── Chat Input ────────────────────────────────────────────────────────────

async function sendChatMessage(): Promise<void> {
    const content = chatInput.value.trim();
    if (!content || activeTabId === "server-log") return;

    const channelId = activeTabId;
    chatInput.value = "";

    const result = await api.sendMessage(channelId, content);
    if (!result.success) {
        log("Failed to send message", "error");
    }
}

btnSend.addEventListener("click", () => sendChatMessage());

chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
    }
});

// ── Server Log Tab Click ──────────────────────────────────────────────────

const serverLogTab = tabBar.querySelector('.tab[data-tab-id="server-log"]');
serverLogTab?.addEventListener("click", () => switchTab("server-log"));

// ── Message Event Listener ────────────────────────────────────────────────

api.on("message", (msg: ChatMessage) => {
    const tab = chatTabs.get(msg.channelId);
    if (tab) {
        renderChatMessage(tab, msg);
    }
});
