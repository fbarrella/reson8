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
    attachmentUrl?: string | null;
    createdAt: string;
}

interface DirectMessage {
    id: string;
    senderId: string;
    senderNickname: string;
    receiverId: string;
    content: string;
    attachmentUrl?: string | null;
    createdAt: string;
    readAt?: string | null;
}

interface LinkPreviewData {
    title?: string;
    description?: string;
    image?: string;
    video?: string;
    videoType?: string;
    url?: string;
    domain?: string;
    siteName?: string;
}

interface Reson8Api {
    getInstanceId(): string;
    connect(host: string, port: number | undefined, nickname: string, password?: string): Promise<void>;
    disconnect(): void;
    joinVoiceChannel(channelId: string): Promise<{ success: boolean; error?: string }>;
    leaveVoiceChannel(): void;
    toggleMute(): boolean;
    toggleDeafen(): boolean;
    setMuted(muted: boolean): void;
    createChannel(
        serverId: string,
        name: string,
        type: "TEXT" | "VOICE",
        parentId?: string | null,
    ): Promise<{ success: boolean; channelId?: string; error?: string }>;
    deleteChannel(channelId: string): Promise<{ success: boolean; error?: string }>;
    sendMessage(channelId: string, content: string, attachmentUrl?: string): Promise<{ success: boolean; messageId?: string }>;
    fetchMessages(channelId: string, before?: string, limit?: number): Promise<{ success: boolean; messages?: ChatMessage[]; error?: string }>;
    getAllUsers(serverId: string): Promise<{ success: boolean; users?: any[]; error?: string }>;
    getRoles(serverId: string): Promise<{ success: boolean; roles?: any[]; error?: string }>;
    assignRole(userId: string, roleId: string, action: "add" | "remove"): Promise<{ success: boolean; error?: string }>;
    enumerateAudioDevices(): Promise<{ inputs: { deviceId: string; label: string }[]; outputs: { deviceId: string; label: string }[] }>;
    setAudioInputDevice(deviceId: string | null): void;
    sendDirectMessage(recipientId: string, content: string, attachmentUrl?: string): Promise<{ success: boolean; messageId?: string; error?: string }>;
    fetchDirectMessages(partnerId: string, before?: string, limit?: number): Promise<{ success: boolean; messages?: DirectMessage[]; error?: string }>;
    getOnlineUsers(): Promise<{ success: boolean; users?: { userId: string; nickname: string }[]; error?: string }>;
    markDmsRead(partnerId: string): Promise<{ success: boolean; error?: string }>;
    getUnreadDmPartners(): Promise<{ success: boolean; partners?: { partnerId: string; partnerNickname: string; unreadCount: number }[]; error?: string }>;
    uploadFile(fileBuffer: ArrayBuffer, fileName: string, mimeType: string): Promise<{ url: string }>;
    downloadImage(url: string): void;
    fetchLinkPreview(url: string): Promise<LinkPreviewData | null>;
    setTrayPrefs(prefs: { minimizeToTray: boolean; closeToTray: boolean }): void;
    getTrayPrefs(): Promise<{ minimizeToTray: boolean; closeToTray: boolean }>;
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
let pttModeEnabled = localStorage.getItem("reson8-ptt-mode") === "true";

// Attachment state
let pendingAttachmentUrl: string | null = null;
let serverBaseUrl: string = "";

// Active speakers state
const activeSpeakers = new Set<string>();
const speakerHoldTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Link preview cache (renderer-side to avoid redundant IPC calls)
const linkPreviewCache = new Map<string, LinkPreviewData | null>();

// Store the current tree for parent selection in the modal
let currentTree: any[] = [];

// ── DOM Elements ──────────────────────────────────────────────────────────

const serverUrlInput = document.getElementById("server-url") as HTMLInputElement;
const nicknameInput = document.getElementById("nickname") as HTMLInputElement;
const serverPasswordInput = document.getElementById("server-password") as HTMLInputElement;
const btnConnect = document.getElementById("btn-connect") as HTMLButtonElement;
const btnDisconnect = document.getElementById("btn-disconnect") as HTMLButtonElement;
const rememberMeCheckbox = document.getElementById("remember-me") as HTMLInputElement;

const channelTree = document.getElementById("channel-tree") as HTMLDivElement;
const eventLog = document.getElementById("event-log") as HTMLDivElement;
const tabBar = document.getElementById("tab-bar") as HTMLDivElement;
const tabContentArea = document.getElementById("tab-content-area") as HTMLDivElement;
const chatInputBar = document.getElementById("chat-input-bar") as HTMLDivElement;
const chatInput = document.getElementById("chat-input") as HTMLInputElement;
const btnSend = document.getElementById("btn-send") as HTMLButtonElement;
const btnAttach = document.getElementById("btn-attach") as HTMLButtonElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const attachmentPreview = document.getElementById("attachment-preview") as HTMLDivElement;
const imageLightboxModal = document.getElementById("image-lightbox-modal") as HTMLDivElement;
const lightboxImage = document.getElementById("lightbox-image") as HTMLImageElement;
const btnLightboxDownload = document.getElementById("btn-lightbox-download") as HTMLButtonElement;

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

// ── Remember Me: auto-populate saved server info ──────────────────────────
if (localStorage.getItem("reson8-remember-me") === "true") {
    rememberMeCheckbox.checked = true;
    const savedUrl = localStorage.getItem("reson8-server-url");
    const savedNick = localStorage.getItem("reson8-nickname");
    const savedPassword = localStorage.getItem("reson8-server-password");
    if (savedUrl) serverUrlInput.value = savedUrl;
    if (savedNick) nicknameInput.value = savedNick;
    if (savedPassword) serverPasswordInput.value = savedPassword;
}

// When unchecked, immediately clear saved data
rememberMeCheckbox.addEventListener("change", () => {
    if (!rememberMeCheckbox.checked) {
        localStorage.removeItem("reson8-remember-me");
        localStorage.removeItem("reson8-server-url");
        localStorage.removeItem("reson8-nickname");
        localStorage.removeItem("reson8-server-password");
    }
});

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
const settingsTabRoles = document.getElementById("settings-tab-roles") as HTMLButtonElement;

// Audio device selects (inside settings modal voice tab)
const audioInputSelect = document.getElementById("audio-input-select") as HTMLSelectElement;
const audioOutputSelect = document.getElementById("audio-output-select") as HTMLSelectElement;
const btnSaveDevices = document.getElementById("btn-save-devices") as HTMLButtonElement;

// Online Users modal
const btnOnlineUsers = document.getElementById("btn-online-users") as HTMLButtonElement;
const onlineUsersModal = document.getElementById("online-users-modal") as HTMLDivElement;
const onlineUserList = document.getElementById("online-user-list") as HTMLDivElement;
const btnOnlineClose = document.getElementById("btn-online-close") as HTMLButtonElement;
const onlineDot = document.getElementById("online-dot") as HTMLSpanElement;

// System tray checkboxes
const chkMinimizeToTray = document.getElementById("chk-minimize-to-tray") as HTMLInputElement;
const chkCloseToTray = document.getElementById("chk-close-to-tray") as HTMLInputElement;

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

// ── Connection ──────────────────────────────────────────────────────────

function parseServerUrl(raw: string): { host: string; port: number | undefined } {
    let url = raw.trim();
    // Strip protocol if provided
    url = url.replace(/^https?:\/\//, "").replace(/^wss?:\/\//, "");
    // Remove trailing slash
    url = url.replace(/\/+$/, "");

    const parts = url.split(":");
    const host = parts[0] || "localhost";
    const port = parts[1] ? parseInt(parts[1], 10) : undefined;
    return { host, port };
}

btnConnect.addEventListener("click", () => {
    const { host, port } = parseServerUrl(serverUrlInput.value);
    const nickname = nicknameInput.value.trim() || "User";
    const password = serverPasswordInput.value || undefined;

    if (!host) {
        log("Please enter a server URL", "error");
        return;
    }

    // Persist or clear server info based on Remember Me checkbox
    if (rememberMeCheckbox.checked) {
        localStorage.setItem("reson8-remember-me", "true");
        localStorage.setItem("reson8-server-url", serverUrlInput.value.trim());
        localStorage.setItem("reson8-nickname", nickname);
        localStorage.setItem("reson8-server-password", serverPasswordInput.value);
    } else {
        localStorage.removeItem("reson8-remember-me");
        localStorage.removeItem("reson8-server-url");
        localStorage.removeItem("reson8-nickname");
        localStorage.removeItem("reson8-server-password");
    }

    log(`Connecting to ${host}${port ? `:${port}` : ""} as "${nickname}"...`, "info");
    serverBaseUrl = `http://${host}${port ? `:${port}` : ""}`;
    api.connect(host, port, nickname, password);
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
        if (activeSpeakers.has(occ.userId)) {
            el.classList.add("speaking");
        }
        el.setAttribute("data-user-id", occ.userId);
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

let isJoiningChannel = false;

async function handleChannelClick(node: TreeNode): Promise<void> {
    if (!isConnected) return;
    if (isJoiningChannel) return; // prevent rapid double-clicks

    if (node.type === "VOICE") {
        // If already in this voice channel, do nothing
        if (currentChannelId === node.id && isInVoice) return;

        isJoiningChannel = true;

        // Leave previous voice channel first
        if (isInVoice) {
            api.leaveVoiceChannel();
            isInVoice = false;
        }

        currentChannelId = node.id;
        log(`Joining voice channel: ${node.name}...`, "info");

        try {
            const result = await api.joinVoiceChannel(node.id);
            if (result.success) {
                isInVoice = true;
                isDeafened = false;

                // In PTT mode, mic starts muted (resting state) but isMuted=false
                // so PTT key can activate it. isMuted=true means "PTT locked".
                if (pttModeEnabled) {
                    api.setMuted(true);
                    isMuted = false;
                } else {
                    isMuted = false;
                }

                updateVoiceUI(node.name);
                log(`Joined voice channel: ${node.name}`, "success");
            } else {
                log(`Failed to join voice: ${result.error}`, "error");
                currentChannelId = null;
            }
        } finally {
            isJoiningChannel = false;
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
    if (pttModeEnabled) {
        // In PTT mode: mute = lock PTT (block key), unmute = unlock PTT (allow key)
        isMuted = !isMuted;
        if (isMuted) {
            api.setMuted(true); // ensure hard-muted while locked
        }
        // When unlocking (isMuted=false), mic stays muted — PTT resting state
    } else {
        isMuted = api.toggleMute();
    }
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
    serverUrlInput.disabled = true;
    nicknameInput.disabled = true;
    serverPasswordInput.disabled = true;
    statusDot.classList.add("connected");
    statusText.textContent = `Connected as ${nicknameInput.value.trim() || "User"}`;
    statusText.classList.add("connected");
    statusInstance.textContent = `ID: ${data.instanceId}`;
    log("Connected to server", "success");

    // Always show the settings button and online users button
    btnServerSettings.style.display = "";
    btnOnlineUsers.style.display = "";
    updateOnlineDot();

    // Check if user is admin to enable/disable the Roles tab
    api.getAllUsers(data.serverId).then((res) => {
        if (res.success) {
            settingsTabRoles.disabled = false;
        } else {
            settingsTabRoles.disabled = true;
        }
    });

    // Auto-open DM tabs for partners with unread messages
    api.getUnreadDmPartners().then((res) => {
        if (res.success && res.partners && res.partners.length > 0) {
            for (const p of res.partners) {
                openDmTab(p.partnerId, p.partnerNickname);
            }
        }
    });
});

api.on("disconnected", () => {
    isConnected = false;
    isInVoice = false;
    currentChannelId = null;
    currentServerId = "";
    currentTree = [];
    activeSpeakers.clear();
    for (const timer of speakerHoldTimers.values()) clearTimeout(timer);
    speakerHoldTimers.clear();
    btnConnect.disabled = false;
    btnDisconnect.disabled = true;
    serverUrlInput.disabled = false;
    nicknameInput.disabled = false;
    serverPasswordInput.disabled = false;
    statusDot.classList.remove("connected");
    statusText.textContent = "Disconnected";
    statusText.classList.remove("connected");
    btnServerSettings.style.display = "none";
    btnOnlineUsers.style.display = "none";
    onlineDot.classList.remove("active");
    updateVoiceUI();
    channelTree.innerHTML = `
        <div style="padding: 20px 12px; color: var(--text-muted); font-size: 12px; text-align: center;">
            Connect to a server to see channels
        </div>
    `;
    // Close all chat tabs (including DM tabs)
    for (const [tabId] of chatTabs) {
        closeTab(tabId);
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
    updateOnlineDot();
});

api.on("user-left", (data: { userId: string }) => {
    log(`A user left the server`, "info");
    updateOnlineDot();
});

// ── Active Speaker Indicator ──────────────────────────────────────────────

api.on("active-speakers", (data: { channelId: string; speakers: string[] }) => {
    const newSpeakers = new Set(data.speakers);

    // Users who stopped speaking: start hold timer
    for (const userId of activeSpeakers) {
        if (!newSpeakers.has(userId)) {
            // Only start a hold timer if there isn't one already
            if (!speakerHoldTimers.has(userId)) {
                const timer = setTimeout(() => {
                    activeSpeakers.delete(userId);
                    speakerHoldTimers.delete(userId);
                    // Remove .speaking class from DOM
                    const els = document.querySelectorAll(`.tree-occupant[data-user-id="${userId}"]`);
                    els.forEach((el) => el.classList.remove("speaking"));
                }, 300);
                speakerHoldTimers.set(userId, timer);
            }
        }
    }

    // Users who are speaking: add immediately (cancel any pending removal)
    for (const userId of newSpeakers) {
        const existingTimer = speakerHoldTimers.get(userId);
        if (existingTimer) {
            clearTimeout(existingTimer);
            speakerHoldTimers.delete(userId);
        }
        activeSpeakers.add(userId);
        // Add .speaking class to DOM
        const els = document.querySelectorAll(`.tree-occupant[data-user-id="${userId}"]`);
        els.forEach((el) => el.classList.add("speaking"));
    }
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

/** Build HTML for message text with clickable URL links.
 * Operates on raw (unescaped) text so the URL regex works correctly,
 * then escapes each non-URL segment independently. */
function linkifyContent(text: string): string {
    const urlRegex = /https?:\/\/[^\s<>"'`,;)\]]+/gi;
    let lastIndex = 0;
    let result = "";
    let match;

    while ((match = urlRegex.exec(text)) !== null) {
        // Escape text before the URL
        result += escapeHtml(text.slice(lastIndex, match.index));
        // Add the URL as a clickable link
        const url = match[0];
        result += `<a href="${escapeHtml(url)}" target="_blank" class="msg-link">${escapeHtml(url)}</a>`;
        lastIndex = match.index + url.length;
    }

    // Escape remaining text after last URL
    result += escapeHtml(text.slice(lastIndex));
    return result;
}

// ── Link Preview Utilities ────────────────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s<>"'`,;)\]]+/i;

function extractFirstUrl(text: string): string | null {
    const match = text.match(URL_REGEX);
    return match ? match[0] : null;
}

// Video lightbox references
const videoLightboxModal = document.getElementById("video-lightbox-modal") as HTMLDivElement;
const videoLightboxIframe = document.getElementById("video-lightbox-iframe") as HTMLIFrameElement;
const videoLightboxVideo = document.getElementById("video-lightbox-video") as HTMLVideoElement;

function openVideoLightbox(videoUrl: string, videoType?: string): void {
    if (videoType === "text/html" || videoUrl.includes("/embed/") || videoUrl.includes("player")) {
        // Iframe embed (YouTube, etc.)
        videoLightboxIframe.src = videoUrl;
        videoLightboxIframe.style.display = "block";
        videoLightboxVideo.style.display = "none";
        videoLightboxVideo.src = "";
    } else {
        // Direct video (mp4, webm, etc.)
        videoLightboxVideo.src = videoUrl;
        videoLightboxVideo.style.display = "block";
        videoLightboxIframe.style.display = "none";
        videoLightboxIframe.src = "";
    }
    videoLightboxModal.classList.add("visible");
}

function closeVideoLightbox(): void {
    videoLightboxModal.classList.remove("visible");
    videoLightboxIframe.src = "";
    videoLightboxVideo.pause();
    videoLightboxVideo.src = "";
}

videoLightboxModal.addEventListener("click", (e) => {
    if (e.target === videoLightboxModal) {
        closeVideoLightbox();
    }
});

function createPreviewCard(data: LinkPreviewData): HTMLDivElement {
    const card = document.createElement("div");
    card.className = "link-preview-card";

    // ── Text body (top) ──
    const body = document.createElement("div");
    body.className = "lpc-body";

    if (data.siteName) {
        const siteEl = document.createElement("div");
        siteEl.className = "lpc-site-name";
        siteEl.textContent = data.siteName;
        body.appendChild(siteEl);
    }

    if (data.title) {
        const titleEl = document.createElement("div");
        titleEl.className = "lpc-title";
        titleEl.textContent = data.title;
        body.appendChild(titleEl);
    }

    if (data.description) {
        const descEl = document.createElement("div");
        descEl.className = "lpc-desc";
        descEl.textContent = data.description;
        body.appendChild(descEl);
    }

    card.appendChild(body);

    // ── Media (below text) ──
    const isDirectVideo = data.video && data.videoType && data.videoType.startsWith("video/");
    const isEmbedVideo = data.video && (!data.videoType || data.videoType === "text/html");

    if (isDirectVideo) {
        // Direct video — render <video> with controls and poster
        const videoEl = document.createElement("video");
        videoEl.className = "lpc-video";
        videoEl.src = data.video!;
        videoEl.controls = true;
        if (data.image) videoEl.poster = data.image;
        videoEl.preload = "metadata";
        videoEl.addEventListener("click", (e) => e.stopPropagation());
        card.appendChild(videoEl);
    } else if (isEmbedVideo && data.image) {
        // Embed video (YouTube, etc.) — show image with play overlay
        const mediaWrap = document.createElement("div");
        mediaWrap.className = "lpc-media-wrap";

        const img = document.createElement("img");
        img.className = "lpc-image";
        img.src = data.image;
        img.alt = data.title || "Preview";
        img.loading = "lazy";
        img.addEventListener("error", () => { mediaWrap.style.display = "none"; });
        mediaWrap.appendChild(img);

        // Play button overlay
        const playBtn = document.createElement("div");
        playBtn.className = "lpc-play-overlay";
        playBtn.innerHTML = `<svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="24" fill="rgba(0,0,0,0.6)"/><polygon points="18,14 36,24 18,34" fill="white"/></svg>`;
        mediaWrap.appendChild(playBtn);

        mediaWrap.addEventListener("click", (e) => {
            e.stopPropagation();
            // Open in external browser — iframe embeds don't work in Electron (file:// origin)
            window.open(data.url!, "_blank");
        });

        card.appendChild(mediaWrap);
    } else if (data.image) {
        // Static image — full width
        const img = document.createElement("img");
        img.className = "lpc-image";
        img.src = data.image;
        img.alt = data.title || "Preview";
        img.loading = "lazy";
        img.addEventListener("error", () => { img.style.display = "none"; });
        card.appendChild(img);
    }

    // ── Domain footer ──
    if (data.domain) {
        const domainEl = document.createElement("div");
        domainEl.className = "lpc-domain";
        domainEl.textContent = data.domain;
        card.appendChild(domainEl);
    }

    // Click card (non-media areas) to open URL in external browser
    if (data.url) {
        card.addEventListener("click", () => {
            window.open(data.url!, "_blank");
        });
    }

    return card;
}

function injectLinkPreview(messageEl: HTMLElement, messagesContainer: HTMLElement, url: string): void {
    // Check renderer-side cache first
    const cached = linkPreviewCache.get(url);
    if (cached !== undefined) {
        if (cached) {
            messageEl.appendChild(createPreviewCard(cached));
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        return;
    }

    // Fetch asynchronously — don't block message rendering
    api.fetchLinkPreview(url).then((data) => {
        linkPreviewCache.set(url, data);
        if (!data) return;
        // Guard: ensure the message is still in the DOM (tab may have been closed)
        if (!messageEl.isConnected) return;
        messageEl.appendChild(createPreviewCard(data));
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }).catch(() => {
        linkPreviewCache.set(url, null);
    });
}

// ── Admin Panel (renderAdminUsers only — open/close handled by openSettingsPanel) ──

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
                    openSettingsPanel();
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

// ── DM Tab Management ─────────────────────────────────────────────────────

function openDmTab(userId: string, nickname: string): void {
    const tabKey = `dm:${userId}`;

    // If tab already exists, just switch to it
    if (chatTabs.has(tabKey)) {
        switchTab(tabKey);
        return;
    }

    // Create tab button
    const tabEl = document.createElement("div");
    tabEl.className = "tab";
    tabEl.dataset.tabId = tabKey;
    tabEl.innerHTML = `✉️ ${escapeHtml(nickname)} <span class="tab-close">✕</span>`;

    tabEl.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).classList.contains("tab-close")) {
            closeTab(tabKey);
        } else {
            switchTab(tabKey);
        }
    });

    tabBar.appendChild(tabEl);

    // Create tab content
    const contentEl = document.createElement("div");
    contentEl.className = "tab-content";
    contentEl.dataset.tabId = tabKey;

    const messagesEl = document.createElement("div");
    messagesEl.className = "chat-messages";
    contentEl.appendChild(messagesEl);

    tabContentArea.appendChild(contentEl);

    // Store tab state
    const chatTab: ChatTab = {
        channelId: tabKey,
        channelName: nickname,
        tabEl,
        contentEl,
        messagesEl,
        loaded: false,
    };
    chatTabs.set(tabKey, chatTab);

    // Switch to the new tab
    switchTab(tabKey);

    // Fetch DM history
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

    if (tab.channelId.startsWith("dm:")) {
        // DM tab — fetch direct messages
        const partnerId = tab.channelId.slice(3);
        const myId = api.getInstanceId();
        const result = await api.fetchDirectMessages(partnerId);
        if (result.success && result.messages) {
            // Find the first unread message (sent by the partner, not by us)
            const firstUnreadIndex = result.messages.findIndex(
                (msg) => msg.senderId !== myId && !msg.readAt,
            );

            for (let i = 0; i < result.messages.length; i++) {
                // Insert "Unread Messages" separator before the first unread message
                if (i === firstUnreadIndex) {
                    const separator = document.createElement("div");
                    separator.className = "unread-separator";
                    separator.innerHTML = "<span>Unread Messages</span>";
                    tab.messagesEl.appendChild(separator);
                }
                renderDmMessage(tab, result.messages[i]);
            }

            // Mark messages as read now that the tab is open
            if (firstUnreadIndex !== -1) {
                api.markDmsRead(partnerId);
            }
        }
    } else {
        // Channel tab — fetch channel messages
        const result = await api.fetchMessages(tab.channelId);
        if (result.success && result.messages) {
            for (const msg of result.messages) {
                renderChatMessage(tab, msg);
            }
        }
    }
}

function renderChatMessage(tab: ChatTab, msg: ChatMessage): void {
    const el = document.createElement("div");
    el.className = "chat-msg";

    const time = new Date(msg.createdAt).toLocaleTimeString();
    let html = `<span class="msg-time">${time}</span><span class="msg-nick">${escapeHtml(msg.nickname)}</span>`;

    if (msg.content) {
        html += `<span class="msg-text">${linkifyContent(msg.content)}</span>`;
    }

    el.innerHTML = html;

    if (msg.attachmentUrl) {
        const img = document.createElement("img");
        img.src = msg.attachmentUrl;
        img.className = "msg-image";
        img.loading = "lazy";
        img.alt = "Shared image";
        img.addEventListener("click", () => openLightbox(msg.attachmentUrl!));
        el.appendChild(img);
    }

    tab.messagesEl.appendChild(el);
    tab.messagesEl.scrollTop = tab.messagesEl.scrollHeight;

    // Async link preview injection
    if (msg.content) {
        const url = extractFirstUrl(msg.content);
        if (url) {
            injectLinkPreview(el, tab.messagesEl, url);
        }
    }
}

// ── Chat Input ────────────────────────────────────────────────────────────

async function sendChatMessage(): Promise<void> {
    const content = chatInput.value.trim();
    if ((!content && !pendingAttachmentUrl) || activeTabId === "server-log") return;

    chatInput.value = "";
    const attachmentUrl = pendingAttachmentUrl;
    clearAttachmentPreview();

    if (activeTabId.startsWith("dm:")) {
        // DM tab — send direct message
        const recipientId = activeTabId.slice(3);
        const result = await api.sendDirectMessage(recipientId, content, attachmentUrl ?? undefined);
        if (!result.success) {
            log(`Failed to send DM: ${result.error ?? "Unknown error"}`, "error");
        }
    } else {
        // Channel tab — send channel message
        const channelId = activeTabId;
        const result = await api.sendMessage(channelId, content, attachmentUrl ?? undefined);
        if (!result.success) {
            log("Failed to send message", "error");
        }
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

// ── DM Event Listener ─────────────────────────────────────────────────────

function renderDmMessage(tab: ChatTab, msg: DirectMessage): void {
    const el = document.createElement("div");
    el.className = "chat-msg";

    const time = new Date(msg.createdAt).toLocaleTimeString();
    let html = `<span class="msg-time">${time}</span><span class="msg-nick">${escapeHtml(msg.senderNickname)}</span>`;

    if (msg.content) {
        html += `<span class="msg-text">${linkifyContent(msg.content)}</span>`;
    }

    el.innerHTML = html;

    if (msg.attachmentUrl) {
        const img = document.createElement("img");
        img.src = msg.attachmentUrl;
        img.className = "msg-image";
        img.loading = "lazy";
        img.alt = "Shared image";
        img.addEventListener("click", () => openLightbox(msg.attachmentUrl!));
        el.appendChild(img);
    }

    tab.messagesEl.appendChild(el);
    tab.messagesEl.scrollTop = tab.messagesEl.scrollHeight;

    // Async link preview injection
    if (msg.content) {
        const url = extractFirstUrl(msg.content);
        if (url) {
            injectLinkPreview(el, tab.messagesEl, url);
        }
    }
}

api.on("dm-received", (msg: DirectMessage) => {
    const myId = api.getInstanceId();
    // Determine who the DM partner is (the other user)
    const partnerId = msg.senderId === myId ? msg.receiverId : msg.senderId;
    const partnerNick = msg.senderNickname; // sender nickname for display purposes
    const tabKey = `dm:${partnerId}`;

    const tab = chatTabs.get(tabKey);
    if (tab) {
        renderDmMessage(tab, msg);
        // Mark as read immediately if the message is from someone else
        if (msg.senderId !== myId) {
            api.markDmsRead(partnerId);
        }
    } else {
        // Auto-open a DM tab for incoming messages from others
        if (msg.senderId !== myId) {
            openDmTab(partnerId, partnerNick);
            // The tab's history will load via loadChatHistory, which includes this message
        }
    }
});

// ── Online Users Modal ────────────────────────────────────────────────────

btnOnlineUsers.addEventListener("click", async () => {
    if (!isConnected) return;
    onlineUsersModal.classList.add("visible");
    onlineUserList.innerHTML = '<div class="admin-empty">Loading users...</div>';

    const result = await api.getOnlineUsers();
    if (result.success && result.users) {
        renderOnlineUsers(result.users);
    } else {
        onlineUserList.innerHTML = '<div class="admin-empty">Failed to load users.</div>';
    }
});

btnOnlineClose.addEventListener("click", () => {
    onlineUsersModal.classList.remove("visible");
});

onlineUsersModal.addEventListener("click", (e) => {
    if (e.target === onlineUsersModal) {
        onlineUsersModal.classList.remove("visible");
    }
});

function renderOnlineUsers(users: { userId: string; nickname: string }[]): void {
    onlineUserList.innerHTML = "";

    if (users.length === 0) {
        onlineUserList.innerHTML = '<div class="admin-empty">No other users online.</div>';
        return;
    }

    for (const user of users) {
        const row = document.createElement("div");
        row.className = "online-user-row";

        const info = document.createElement("div");
        info.className = "online-user-info";
        info.innerHTML = `<span class="online-user-dot"></span><span class="online-user-nick">${escapeHtml(user.nickname)}</span>`;
        row.appendChild(info);

        const dmBtn = document.createElement("button");
        dmBtn.className = "btn-dm";
        dmBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> DM';
        dmBtn.addEventListener("click", () => {
            onlineUsersModal.classList.remove("visible");
            openDmTab(user.userId, user.nickname);
        });
        row.appendChild(dmBtn);

        onlineUserList.appendChild(row);
    }
}

/** Checks online user count and toggles the green dot on the Online Users button. */
async function updateOnlineDot(): Promise<void> {
    if (!isConnected) {
        onlineDot.classList.remove("active");
        return;
    }
    const result = await api.getOnlineUsers();
    if (result.success && result.users && result.users.length > 0) {
        onlineDot.classList.add("active");
    } else {
        onlineDot.classList.remove("active");
    }
}

// ── Unified Settings Modal (Tabs) ─────────────────────────────────────

let isAdminUser = false;

// Settings tab switching
const settingsTabBtns = document.querySelectorAll(".settings-tab-btn");
const settingsPanels = document.querySelectorAll(".settings-panel");

settingsTabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
        if ((btn as HTMLButtonElement).disabled) return;
        const tabId = (btn as HTMLElement).dataset.settingsTab;
        settingsTabBtns.forEach((b) => b.classList.remove("active"));
        settingsPanels.forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        document.querySelector(`.settings-panel[data-settings-panel="${tabId}"]`)?.classList.add("active");
    });
});

async function openSettingsPanel(): Promise<void> {
    adminModal.classList.add("visible");

    // Populate audio devices
    await populateAudioDevices();

    // Fetch users and roles concurrently
    const [usersRes, rolesRes] = await Promise.all([
        api.getAllUsers(currentServerId),
        api.getRoles(currentServerId),
    ]);

    isAdminUser = usersRes.success;
    settingsTabRoles.disabled = !isAdminUser;

    if (isAdminUser) {
        allServerRoles = rolesRes.roles ?? [];
        renderAdminUsers(usersRes.users ?? []);
    } else {
        adminUserList.innerHTML = '<div class="admin-empty">You don\'t have permission to manage roles.</div>';
    }
}

btnServerSettings.addEventListener("click", () => {
    if (!isConnected) return;
    openSettingsPanel();
});

btnAdminClose.addEventListener("click", () => {
    adminModal.classList.remove("visible");
    activeShortcutSlot = null;
});

adminModal.addEventListener("click", (e) => {
    if (e.target === adminModal) {
        adminModal.classList.remove("visible");
        activeShortcutSlot = null;
    }
});

// ── Audio Device Selection ─────────────────────────────────────────

let savedInputDevice = localStorage.getItem("reson8-audio-input") || "";
let savedOutputDevice = localStorage.getItem("reson8-audio-output") || "";

// Pending (staged) values — only applied on Save
let pendingInputDevice: string | null = null;
let pendingOutputDevice: string | null = null;

if (savedInputDevice) {
    api.setAudioInputDevice(savedInputDevice);
}

function updateSaveBtnVisibility(): void {
    const inputChanged = pendingInputDevice !== null && pendingInputDevice !== savedInputDevice;
    const outputChanged = pendingOutputDevice !== null && pendingOutputDevice !== savedOutputDevice;
    btnSaveDevices.style.display = inputChanged || outputChanged ? "" : "none";
}

async function populateAudioDevices(): Promise<void> {
    // Reset pending state on every panel open
    pendingInputDevice = null;
    pendingOutputDevice = null;
    btnSaveDevices.style.display = "none";

    const { inputs, outputs } = await api.enumerateAudioDevices();

    audioInputSelect.innerHTML = '<option value="">System Default</option>';
    for (const d of inputs) {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label;
        if (d.deviceId === savedInputDevice) opt.selected = true;
        audioInputSelect.appendChild(opt);
    }

    audioOutputSelect.innerHTML = '<option value="">System Default</option>';
    for (const d of outputs) {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label;
        if (d.deviceId === savedOutputDevice) opt.selected = true;
        audioOutputSelect.appendChild(opt);
    }
}

// Stage selection — do NOT apply yet
audioInputSelect.addEventListener("change", () => {
    pendingInputDevice = audioInputSelect.value;
    updateSaveBtnVisibility();
});

audioOutputSelect.addEventListener("change", () => {
    pendingOutputDevice = audioOutputSelect.value;
    updateSaveBtnVisibility();
});

// Apply staged devices on Save
btnSaveDevices.addEventListener("click", () => {
    // Apply input device
    if (pendingInputDevice !== null && pendingInputDevice !== savedInputDevice) {
        const deviceId = pendingInputDevice || null;
        api.setAudioInputDevice(deviceId);
        localStorage.setItem("reson8-audio-input", pendingInputDevice);
        savedInputDevice = pendingInputDevice;
        log(`Microphone set to: ${audioInputSelect.selectedOptions[0]?.textContent}`, "info");
    }

    // Apply output device
    if (pendingOutputDevice !== null && pendingOutputDevice !== savedOutputDevice) {
        localStorage.setItem("reson8-audio-output", pendingOutputDevice);
        savedOutputDevice = pendingOutputDevice;
        const audioEls = document.querySelectorAll("audio");
        for (const el of audioEls) {
            if ((el as any).setSinkId) {
                (el as any).setSinkId(pendingOutputDevice).catch(() => { });
            }
        }
        log(`Speaker set to: ${audioOutputSelect.selectedOptions[0]?.textContent}`, "info");
    }

    // Reset pending state
    pendingInputDevice = null;
    pendingOutputDevice = null;
    btnSaveDevices.style.display = "none";
});

// ── Multi-Key Combo Shortcuts ───────────────────────────────────────

type ShortcutSlot = "ptt" | "mute" | "deafen" | "disconnect";

interface ShortcutCombo {
    keys: Set<string>;   // Set of key codes held together
    display: string;     // Human-readable string like "CtrlLeft + ShiftLeft + KeyG"
}

const shortcuts: Record<ShortcutSlot, ShortcutCombo | null> = {
    ptt: null,
    mute: null,
    deafen: null,
    disconnect: null,
};

let activeShortcutSlot: ShortcutSlot | null = null;
let recordingKeys = new Set<string>();
const heldKeys = new Set<string>();

const shortcutInputs: Record<ShortcutSlot, HTMLInputElement> = {
    ptt: document.getElementById("shortcut-ptt") as HTMLInputElement,
    mute: document.getElementById("shortcut-mute") as HTMLInputElement,
    deafen: document.getElementById("shortcut-deafen") as HTMLInputElement,
    disconnect: document.getElementById("shortcut-disconnect") as HTMLInputElement,
};

// Convert key code to readable name
function keyCodeToLabel(code: string): string {
    const map: Record<string, string> = {
        ControlLeft: "L-Ctrl", ControlRight: "R-Ctrl",
        ShiftLeft: "L-Shift", ShiftRight: "R-Shift",
        AltLeft: "L-Alt", AltRight: "R-Alt",
        MetaLeft: "L-Meta", MetaRight: "R-Meta",
        Space: "Space", Backquote: "`",
    };
    if (map[code]) return map[code];
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    return code;
}

function comboToDisplay(keys: Set<string>): string {
    return [...keys].map(keyCodeToLabel).join(" + ");
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const k of a) {
        if (!b.has(k)) return false;
    }
    return true;
}

// Load saved shortcuts
for (const slot of Object.keys(shortcuts) as ShortcutSlot[]) {
    const saved = localStorage.getItem(`reson8-shortcut-${slot}`);
    if (saved) {
        try {
            const keys = new Set<string>(JSON.parse(saved));
            shortcuts[slot] = { keys, display: comboToDisplay(keys) };
            shortcutInputs[slot].value = shortcuts[slot]!.display;
        } catch { /* ignore corrupt data */ }
    }
}

// Set / Clear buttons
document.querySelectorAll("[data-shortcut-set]").forEach((btn) => {
    btn.addEventListener("click", () => {
        const slot = (btn as HTMLElement).dataset.shortcutSet as ShortcutSlot;
        activeShortcutSlot = slot;
        recordingKeys.clear();
        shortcutInputs[slot].value = "Press keys...";
        shortcutInputs[slot].classList.add("listening");
    });
});

document.querySelectorAll("[data-shortcut-clear]").forEach((btn) => {
    btn.addEventListener("click", () => {
        const slot = (btn as HTMLElement).dataset.shortcutClear as ShortcutSlot;
        shortcuts[slot] = null;
        shortcutInputs[slot].value = "";
        shortcutInputs[slot].classList.remove("listening");
        localStorage.removeItem(`reson8-shortcut-${slot}`);
        log(`Shortcut for ${slot} cleared`, "info");
    });
});

// Record combo: accumulate keys on keydown, finalize on keyup
document.addEventListener("keydown", (e) => {
    if (activeShortcutSlot) {
        e.preventDefault();
        e.stopPropagation();
        recordingKeys.add(e.code);
        shortcutInputs[activeShortcutSlot].value = comboToDisplay(recordingKeys);
        return;
    }

    // Track held keys for shortcut matching
    heldKeys.add(e.code);

    // Check shortcuts (skip PTT which uses press/release)
    if (!e.repeat) {
        if (shortcuts.mute && setsEqual(heldKeys, shortcuts.mute.keys)) {
            if (pttModeEnabled) {
                isMuted = !isMuted;
                if (isMuted) {
                    api.setMuted(true);
                }
            } else {
                isMuted = api.toggleMute();
            }
            updateVoiceUI();
        }
        if (shortcuts.deafen && setsEqual(heldKeys, shortcuts.deafen.keys)) {
            isDeafened = api.toggleDeafen();
            updateVoiceUI();
        }
        if (shortcuts.disconnect && setsEqual(heldKeys, shortcuts.disconnect.keys)) {
            api.leaveVoiceChannel();
            isInVoice = false;
            currentChannelId = null;
            updateVoiceUI();
            log("Disconnected from voice (shortcut)", "info");
        }
        // PTT keydown → unmute (only in PTT mode, and only if not locked/muted)
        if (shortcuts.ptt && setsEqual(heldKeys, shortcuts.ptt.keys) && pttModeEnabled && isInVoice && !isMuted) {
            api.setMuted(false);
            updateVoiceUI();
        }
    }
});

document.addEventListener("keyup", (e) => {
    if (activeShortcutSlot) {
        // Finalize the combo on first keyup
        const slot = activeShortcutSlot;
        const combo: ShortcutCombo = {
            keys: new Set(recordingKeys),
            display: comboToDisplay(recordingKeys),
        };
        shortcuts[slot] = combo;
        shortcutInputs[slot].value = combo.display;
        shortcutInputs[slot].classList.remove("listening");
        localStorage.setItem(`reson8-shortcut-${slot}`, JSON.stringify([...combo.keys]));
        log(`Shortcut for ${slot} set to: ${combo.display}`, "success");
        activeShortcutSlot = null;
        recordingKeys.clear();
        return;
    }

    // PTT keyup → mute (only in PTT mode)
    if (shortcuts.ptt && heldKeys.has(e.code)) {
        // Check if releasing breaks the combo
        const wasMatching = setsEqual(heldKeys, shortcuts.ptt.keys);
        heldKeys.delete(e.code);
        if (wasMatching && pttModeEnabled && isInVoice && !isMuted) {
            api.setMuted(true);
            updateVoiceUI();
        }
    } else {
        heldKeys.delete(e.code);
    }
});

// Global PTT from main process
api.on("ptt-pressed", () => {
    if (shortcuts.ptt && pttModeEnabled && isInVoice && !isMuted) {
        api.setMuted(false);
        updateVoiceUI();
    }
});

api.on("ptt-released", () => {
    if (shortcuts.ptt && pttModeEnabled && isInVoice && !isMuted) {
        api.setMuted(true);
        updateVoiceUI();
    }
});

// ── PTT Mode Toggle ───────────────────────────────────────────────────

const btnVoiceActivation = document.getElementById("btn-voice-activation") as HTMLButtonElement;
const btnPttMode = document.getElementById("btn-ptt-mode") as HTMLButtonElement;

function updatePttModeUI(): void {
    if (pttModeEnabled) {
        btnPttMode.style.borderColor = "var(--accent)";
        btnPttMode.style.color = "var(--accent)";
        btnVoiceActivation.style.borderColor = "var(--border)";
        btnVoiceActivation.style.color = "var(--text-secondary)";
    } else {
        btnVoiceActivation.style.borderColor = "var(--accent)";
        btnVoiceActivation.style.color = "var(--accent)";
        btnPttMode.style.borderColor = "var(--border)";
        btnPttMode.style.color = "var(--text-secondary)";
    }
}

// Set initial UI state
updatePttModeUI();

btnVoiceActivation.addEventListener("click", () => {
    pttModeEnabled = false;
    localStorage.setItem("reson8-ptt-mode", "false");
    updatePttModeUI();
    // If currently in voice, unmute mic so it streams immediately
    if (isInVoice) {
        api.setMuted(false);
        isMuted = false;
        updateVoiceUI();
    }
    log("Voice input mode: Voice Activation", "info");
});

btnPttMode.addEventListener("click", () => {
    pttModeEnabled = true;
    localStorage.setItem("reson8-ptt-mode", "true");
    updatePttModeUI();
    // If currently in voice, mute mic (PTT resting state) but don't lock
    if (isInVoice) {
        api.setMuted(true);
        isMuted = false; // not locked, PTT key works
        updateVoiceUI();
    }
    log("Voice input mode: Push-To-Talk", "info");
});

// ── Attachment / File Upload ──────────────────────────────────────────────

btnAttach.addEventListener("click", () => {
    fileInput.click();
});

fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.value = ""; // reset for re-selection
    await handleFileUpload(file);
});

// Clipboard paste handler — detect pasted images
chatInput.addEventListener("paste", async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
        if (item.type.startsWith("image/")) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) {
                await handleFileUpload(file);
            }
            return;
        }
    }
});

async function handleFileUpload(file: File): Promise<void> {
    if (!isConnected) {
        log("Not connected — cannot upload", "error");
        return;
    }

    // Validate file type
    if (!file.type.startsWith("image/")) {
        log("Only image files are supported", "error");
        return;
    }

    // Validate size (5MB)
    if (file.size > 5 * 1024 * 1024) {
        log("Image too large (max 5MB)", "error");
        return;
    }

    try {
        log(`Uploading ${file.name}...`, "info");
        const buffer = await file.arrayBuffer();
        const result = await api.uploadFile(buffer, file.name, file.type);
        pendingAttachmentUrl = result.url;
        showAttachmentPreview(file.name);
        log(`Image ready to send: ${file.name}`, "success");
    } catch (err: any) {
        log(`Upload failed: ${err.message}`, "error");
    }
}

function showAttachmentPreview(fileName: string): void {
    attachmentPreview.innerHTML = `
        <span class="attachment-name">📎 ${escapeHtml(fileName)}</span>
        <button class="attachment-remove" id="btn-remove-attachment">✕</button>
    `;
    attachmentPreview.style.display = "flex";
    document.getElementById("btn-remove-attachment")?.addEventListener("click", clearAttachmentPreview);
}

function clearAttachmentPreview(): void {
    pendingAttachmentUrl = null;
    attachmentPreview.style.display = "none";
    attachmentPreview.innerHTML = "";
}

// ── Lightbox ───────────────────────────────────────────────────────────

function openLightbox(imageUrl: string): void {
    lightboxImage.src = imageUrl;
    imageLightboxModal.classList.add("visible");
}

imageLightboxModal.addEventListener("click", (e) => {
    if (e.target === imageLightboxModal) {
        imageLightboxModal.classList.remove("visible");
        lightboxImage.src = "";
    }
});

btnLightboxDownload.addEventListener("click", () => {
    const url = lightboxImage.src;
    if (url) {
        api.downloadImage(url);
    }
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && imageLightboxModal.classList.contains("visible")) {
        imageLightboxModal.classList.remove("visible");
        lightboxImage.src = "";
    }
    if (e.key === "Escape" && videoLightboxModal.classList.contains("visible")) {
        closeVideoLightbox();
    }
});

// ── System Tray Preferences ───────────────────────────────────────────────

// Initialize tray prefs from localStorage and sync to main process
{
    const savedMinToTray = localStorage.getItem("reson8-minimize-to-tray") === "true";
    const savedCloseToTray = localStorage.getItem("reson8-close-to-tray") === "true";
    chkMinimizeToTray.checked = savedMinToTray;
    chkCloseToTray.checked = savedCloseToTray;
    api.setTrayPrefs({ minimizeToTray: savedMinToTray, closeToTray: savedCloseToTray });
}

chkMinimizeToTray.addEventListener("change", () => {
    localStorage.setItem("reson8-minimize-to-tray", String(chkMinimizeToTray.checked));
    api.setTrayPrefs({
        minimizeToTray: chkMinimizeToTray.checked,
        closeToTray: chkCloseToTray.checked,
    });
});

chkCloseToTray.addEventListener("change", () => {
    localStorage.setItem("reson8-close-to-tray", String(chkCloseToTray.checked));
    api.setTrayPrefs({
        minimizeToTray: chkMinimizeToTray.checked,
        closeToTray: chkCloseToTray.checked,
    });
});
