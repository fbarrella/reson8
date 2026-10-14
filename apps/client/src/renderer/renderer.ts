/**
 * Reson8 Client — Renderer Script
 *
 * Handles the three-pane UI:
 *   - Left pane: Channel tree with occupants
 *   - Right pane: Server event log
 *   - Bottom: Voice controls + status bar
 */

/** One emoji's reactions on a message (mirrors shared-types' IReactionSummary).
 *  `users` (PRD 15.11) carries reactor nicknames, aligned with `userIds`; it is
 *  absent when talking to a server that predates it. */
interface ReactionSummary {
    emoji: string;
    count: number;
    userIds: string[];
    users?: Array<{ userId: string; nickname: string }>;
}

/** Result of an upload (PRD 16.8): `uploadId` is the server's ledger id, which the server claims when the file is used. */
interface UploadResult {
    url: string;
    publicId?: string;
    uploadId?: string;
}

/** The message a reply answers, as the server describes it (PRD 16.11). `deleted` = the original no longer exists. */
interface ReplyPreview {
    id: string;
    deleted: boolean;
    userId?: string;
    nickname?: string;
    content?: string;
    hasAttachments?: boolean;
}

/**
 * Tells the server to throw away an upload that never got used (PRD 16.9).
 * Fire-and-forget on purpose: it must never block or fail the UI, and the
 * server's hourly sweep catches anything this misses.
 */
function discardUpload(uploadId: string | null | undefined): void {
    if (!uploadId) return;
    api.discardUpload(uploadId).catch(() => {});
}

interface ChatMessage {
    id: string;
    channelId: string;
    userId: string;
    nickname: string;
    /** Author's current avatar URL (PRD 17.2); undefined from a pre-v2.6.0 server. */
    avatarUrl?: string | null;
    content: string;
    /** Set when this message is a reply (PRD 16.11). */
    replyTo?: ReplyPreview | null;
    /** The message's images, in order (PRD 16.10). */
    attachments?: { url: string }[];
    /** @deprecated The first image's URL — only used when `attachments` is absent (an older server). */
    attachmentUrl?: string | null;
    createdAt: string;
    editedAt?: string | null;
    reactions?: ReactionSummary[];
}

interface PinnedMessage {
    id: string;
    content: string;
    authorNickname: string;
    createdAt: string;
}

/** The profile card's data (PRD 17.3) — mirrors shared-types' IUserProfile. */
interface UserProfile {
    userId: string;
    nickname: string;
    avatarUrl: string | null;
    memberSince: string;
    roles: { id: string; name: string; color: string | null; powerLevel: number }[];
    isOnline: boolean;
}

/** One row of the DM directory (PRD 19 A7) — mirrors shared-types' IDmDirectoryEntry. */
interface DmDirectoryEntry {
    userId: string;
    nickname: string;
    avatarUrl: string | null;
    isOnline: boolean;
    /** `text` is RAW message text: render with markdownToPlainText, never as HTML. */
    lastMessage?: { text: string; hasAttachments: boolean; at: string; fromMe: boolean };
    unreadCount: number;
}

/** Member-visible server facts (PRD 19 A1) — mirrors shared-types' IServerSummary. */
interface ServerSummary {
    name: string;
    memberCount: number;
    onlineCount: number;
    admins: { userId: string; nickname: string; isOnline: boolean; avatarUrl: string | null }[];
    features: {
        nudge: boolean;
        screenShare: boolean;
        requireApproval: boolean;
        requireInvite: boolean;
        requireSignedIdentity: boolean;
    };
    iconUrl?: string | null;
}

interface DirectMessage {
    id: string;
    senderId: string;
    senderNickname: string;
    /** Sender's current avatar URL (PRD 17.2); undefined from a pre-v2.6.0 server. */
    senderAvatarUrl?: string | null;
    receiverId: string;
    content: string;
    /** Set when this DM is a reply (PRD 16.11). */
    replyTo?: ReplyPreview | null;
    /** The message's images, in order (PRD 16.10). */
    attachments?: { url: string }[];
    /** @deprecated The first image's URL — only used when `attachments` is absent (an older server). */
    attachmentUrl?: string | null;
    createdAt: string;
    readAt?: string | null;
    reactions?: ReactionSummary[];
}

interface CustomEmoji {
    id: string;
    serverId: string;
    name: string;
    imageUrl: string;
    uploadedBy: string;
    uploadedByNickname?: string;
    status: "PENDING" | "APPROVED";
    createdAt: string;
    isAnimated?: boolean;
}

interface LinkPreviewData {
    /** Absent = a normal page card; "image" = the link itself is an image (PRD 18.10). */
    kind?: "page" | "image";
    /** The site marks this as adult content (PRD 18.11). */
    adult?: boolean;
    /** The media's declared size, to reserve its box before it loads (PRD 18.12). */
    mediaWidth?: number;
    mediaHeight?: number;
    title?: string;
    description?: string;
    image?: string;
    video?: string;
    videoType?: string;
    url?: string;
    domain?: string;
    siteName?: string;
}

// ── Emoji Data ────────────────────────────────────────────────────────────

interface EmojiEntry {
    emoji: string;
    name: string;
    keywords: string[];
    category: string;
}

const EMOJI_CATEGORIES = [
    "Smileys & Emotion",
    "People & Body",
    "Animals & Nature",
    "Food & Drink",
    "Activities",
    "Travel & Places",
    "Objects",
    "Symbols",
    "Flags",
] as const;

const EMOJI_CATEGORY_ICONS: Record<string, string> = {
    "Smileys & Emotion": "😀",
    "People & Body": "👋",
    "Animals & Nature": "🐻",
    "Food & Drink": "🍕",
    "Activities": "⚽",
    "Travel & Places": "✈️",
    "Objects": "💡",
    "Symbols": "❤️",
    "Flags": "🏁",
};

const EMOJI_DATA: EmojiEntry[] = [
    // ── Smileys & Emotion ──
    { emoji: "😀", name: "grinning face", keywords: ["happy", "smile", "grin"], category: "Smileys & Emotion" },
    { emoji: "😃", name: "grinning face with big eyes", keywords: ["happy", "smile", "joy"], category: "Smileys & Emotion" },
    { emoji: "😄", name: "grinning face with smiling eyes", keywords: ["happy", "smile", "joy"], category: "Smileys & Emotion" },
    { emoji: "😁", name: "beaming face", keywords: ["happy", "grin", "teeth"], category: "Smileys & Emotion" },
    { emoji: "😆", name: "grinning squinting face", keywords: ["laugh", "happy", "lol"], category: "Smileys & Emotion" },
    { emoji: "😅", name: "grinning face with sweat", keywords: ["nervous", "laugh", "hot"], category: "Smileys & Emotion" },
    { emoji: "🤣", name: "rolling on the floor laughing", keywords: ["laugh", "lol", "funny", "rofl"], category: "Smileys & Emotion" },
    { emoji: "😂", name: "face with tears of joy", keywords: ["laugh", "cry", "funny", "lol"], category: "Smileys & Emotion" },
    { emoji: "🙂", name: "slightly smiling face", keywords: ["smile", "ok"], category: "Smileys & Emotion" },
    { emoji: "😊", name: "smiling face with smiling eyes", keywords: ["happy", "blush", "smile"], category: "Smileys & Emotion" },
    { emoji: "😇", name: "smiling face with halo", keywords: ["angel", "innocent", "blessed"], category: "Smileys & Emotion" },
    { emoji: "🥰", name: "smiling face with hearts", keywords: ["love", "adore", "crush"], category: "Smileys & Emotion" },
    { emoji: "😍", name: "heart eyes", keywords: ["love", "crush", "beautiful"], category: "Smileys & Emotion" },
    { emoji: "🤩", name: "star struck", keywords: ["excited", "wow", "star"], category: "Smileys & Emotion" },
    { emoji: "😘", name: "face blowing a kiss", keywords: ["love", "kiss", "flirt"], category: "Smileys & Emotion" },
    { emoji: "😗", name: "kissing face", keywords: ["kiss"], category: "Smileys & Emotion" },
    { emoji: "😚", name: "kissing face closed eyes", keywords: ["kiss", "love"], category: "Smileys & Emotion" },
    { emoji: "😋", name: "face savoring food", keywords: ["yummy", "delicious", "tongue"], category: "Smileys & Emotion" },
    { emoji: "😛", name: "face with tongue", keywords: ["tongue", "playful"], category: "Smileys & Emotion" },
    { emoji: "😜", name: "winking face with tongue", keywords: ["tongue", "wink", "playful"], category: "Smileys & Emotion" },
    { emoji: "🤪", name: "zany face", keywords: ["crazy", "wild", "goofy"], category: "Smileys & Emotion" },
    { emoji: "😝", name: "squinting face with tongue", keywords: ["tongue", "playful", "prank"], category: "Smileys & Emotion" },
    { emoji: "🤑", name: "money mouth face", keywords: ["money", "rich", "dollar"], category: "Smileys & Emotion" },
    { emoji: "🤗", name: "hugging face", keywords: ["hug", "love", "warm"], category: "Smileys & Emotion" },
    { emoji: "🤭", name: "face with hand over mouth", keywords: ["oops", "giggle", "shy"], category: "Smileys & Emotion" },
    { emoji: "🤫", name: "shushing face", keywords: ["quiet", "shh", "secret"], category: "Smileys & Emotion" },
    { emoji: "🤔", name: "thinking face", keywords: ["think", "hmm", "wonder"], category: "Smileys & Emotion" },
    { emoji: "🤐", name: "zipper mouth", keywords: ["quiet", "sealed", "secret"], category: "Smileys & Emotion" },
    { emoji: "😐", name: "neutral face", keywords: ["meh", "blank", "indifferent"], category: "Smileys & Emotion" },
    { emoji: "😑", name: "expressionless face", keywords: ["blank", "meh"], category: "Smileys & Emotion" },
    { emoji: "😶", name: "face without mouth", keywords: ["silent", "speechless"], category: "Smileys & Emotion" },
    { emoji: "😏", name: "smirking face", keywords: ["smirk", "flirt", "sly"], category: "Smileys & Emotion" },
    { emoji: "😒", name: "unamused face", keywords: ["bored", "meh", "unimpressed"], category: "Smileys & Emotion" },
    { emoji: "🙄", name: "face with rolling eyes", keywords: ["eyeroll", "whatever", "annoyed"], category: "Smileys & Emotion" },
    { emoji: "😬", name: "grimacing face", keywords: ["awkward", "nervous", "yikes"], category: "Smileys & Emotion" },
    { emoji: "😮‍💨", name: "face exhaling", keywords: ["sigh", "relief", "tired"], category: "Smileys & Emotion" },
    { emoji: "🤥", name: "lying face", keywords: ["lie", "pinocchio"], category: "Smileys & Emotion" },
    { emoji: "😌", name: "relieved face", keywords: ["calm", "peaceful", "content"], category: "Smileys & Emotion" },
    { emoji: "😔", name: "pensive face", keywords: ["sad", "thoughtful"], category: "Smileys & Emotion" },
    { emoji: "😪", name: "sleepy face", keywords: ["tired", "sleep"], category: "Smileys & Emotion" },
    { emoji: "🤤", name: "drooling face", keywords: ["drool", "yummy", "hungry"], category: "Smileys & Emotion" },
    { emoji: "😴", name: "sleeping face", keywords: ["sleep", "zzz", "tired"], category: "Smileys & Emotion" },
    { emoji: "😷", name: "face with medical mask", keywords: ["sick", "mask", "covid"], category: "Smileys & Emotion" },
    { emoji: "🤒", name: "face with thermometer", keywords: ["sick", "fever", "ill"], category: "Smileys & Emotion" },
    { emoji: "🤕", name: "face with bandage", keywords: ["hurt", "injured"], category: "Smileys & Emotion" },
    { emoji: "🤢", name: "nauseated face", keywords: ["sick", "nausea", "green"], category: "Smileys & Emotion" },
    { emoji: "🤮", name: "vomiting face", keywords: ["sick", "puke", "barf"], category: "Smileys & Emotion" },
    { emoji: "🥵", name: "hot face", keywords: ["hot", "sweat", "heat"], category: "Smileys & Emotion" },
    { emoji: "🥶", name: "cold face", keywords: ["cold", "freeze", "ice"], category: "Smileys & Emotion" },
    { emoji: "🥴", name: "woozy face", keywords: ["dizzy", "drunk", "tipsy"], category: "Smileys & Emotion" },
    { emoji: "😵", name: "face with crossed-out eyes", keywords: ["dizzy", "dead", "knocked out"], category: "Smileys & Emotion" },
    { emoji: "🤯", name: "exploding head", keywords: ["mind blown", "shock", "wow"], category: "Smileys & Emotion" },
    { emoji: "🥳", name: "partying face", keywords: ["party", "celebrate", "birthday"], category: "Smileys & Emotion" },
    { emoji: "🥸", name: "disguised face", keywords: ["disguise", "incognito"], category: "Smileys & Emotion" },
    { emoji: "😎", name: "smiling face with sunglasses", keywords: ["cool", "sunglasses", "chill"], category: "Smileys & Emotion" },
    { emoji: "🤓", name: "nerd face", keywords: ["nerd", "geek", "glasses"], category: "Smileys & Emotion" },
    { emoji: "🧐", name: "face with monocle", keywords: ["inspect", "curious", "classy"], category: "Smileys & Emotion" },
    { emoji: "😕", name: "confused face", keywords: ["confused", "puzzled"], category: "Smileys & Emotion" },
    { emoji: "😟", name: "worried face", keywords: ["worried", "nervous", "concern"], category: "Smileys & Emotion" },
    { emoji: "🙁", name: "slightly frowning face", keywords: ["sad", "disappointed"], category: "Smileys & Emotion" },
    { emoji: "😮", name: "face with open mouth", keywords: ["surprise", "shock", "wow"], category: "Smileys & Emotion" },
    { emoji: "😯", name: "hushed face", keywords: ["surprised", "shocked"], category: "Smileys & Emotion" },
    { emoji: "😲", name: "astonished face", keywords: ["shocked", "amazed", "wow"], category: "Smileys & Emotion" },
    { emoji: "😳", name: "flushed face", keywords: ["embarrassed", "blush", "shy"], category: "Smileys & Emotion" },
    { emoji: "🥺", name: "pleading face", keywords: ["please", "puppy eyes", "beg"], category: "Smileys & Emotion" },
    { emoji: "😦", name: "frowning face with open mouth", keywords: ["sad", "surprise"], category: "Smileys & Emotion" },
    { emoji: "😧", name: "anguished face", keywords: ["anguish", "pain", "shocked"], category: "Smileys & Emotion" },
    { emoji: "😨", name: "fearful face", keywords: ["scared", "fear", "shock"], category: "Smileys & Emotion" },
    { emoji: "😰", name: "anxious face with sweat", keywords: ["anxious", "nervous", "sweat"], category: "Smileys & Emotion" },
    { emoji: "😥", name: "sad but relieved face", keywords: ["sad", "relief", "phew"], category: "Smileys & Emotion" },
    { emoji: "😢", name: "crying face", keywords: ["cry", "sad", "tear"], category: "Smileys & Emotion" },
    { emoji: "😭", name: "loudly crying face", keywords: ["cry", "sob", "sad", "bawl"], category: "Smileys & Emotion" },
    { emoji: "😱", name: "face screaming in fear", keywords: ["scream", "horror", "scared"], category: "Smileys & Emotion" },
    { emoji: "😖", name: "confounded face", keywords: ["frustrated", "confused"], category: "Smileys & Emotion" },
    { emoji: "😣", name: "persevering face", keywords: ["struggle", "frustrated"], category: "Smileys & Emotion" },
    { emoji: "😞", name: "disappointed face", keywords: ["sad", "disappointed"], category: "Smileys & Emotion" },
    { emoji: "😓", name: "downcast face with sweat", keywords: ["sad", "tired", "sweat"], category: "Smileys & Emotion" },
    { emoji: "😩", name: "weary face", keywords: ["tired", "exhausted", "fed up"], category: "Smileys & Emotion" },
    { emoji: "😫", name: "tired face", keywords: ["exhausted", "frustrated"], category: "Smileys & Emotion" },
    { emoji: "🥱", name: "yawning face", keywords: ["yawn", "tired", "bored"], category: "Smileys & Emotion" },
    { emoji: "😤", name: "face with steam from nose", keywords: ["angry", "frustrated", "triumph"], category: "Smileys & Emotion" },
    { emoji: "😡", name: "pouting face", keywords: ["angry", "rage", "mad"], category: "Smileys & Emotion" },
    { emoji: "😠", name: "angry face", keywords: ["angry", "mad", "annoyed"], category: "Smileys & Emotion" },
    { emoji: "🤬", name: "face with symbols on mouth", keywords: ["swear", "curse", "angry"], category: "Smileys & Emotion" },
    { emoji: "💀", name: "skull", keywords: ["dead", "death", "skeleton"], category: "Smileys & Emotion" },
    { emoji: "👻", name: "ghost", keywords: ["halloween", "spooky", "boo"], category: "Smileys & Emotion" },
    { emoji: "👽", name: "alien", keywords: ["ufo", "space", "extraterrestrial"], category: "Smileys & Emotion" },
    { emoji: "🤖", name: "robot", keywords: ["bot", "machine", "android"], category: "Smileys & Emotion" },
    { emoji: "💩", name: "pile of poo", keywords: ["poop", "shit", "crap"], category: "Smileys & Emotion" },
    { emoji: "😈", name: "smiling face with horns", keywords: ["devil", "evil", "naughty"], category: "Smileys & Emotion" },
    { emoji: "👿", name: "angry face with horns", keywords: ["devil", "angry", "evil"], category: "Smileys & Emotion" },
    { emoji: "🤡", name: "clown face", keywords: ["clown", "circus", "funny"], category: "Smileys & Emotion" },
    { emoji: "💋", name: "kiss mark", keywords: ["kiss", "lips", "love"], category: "Smileys & Emotion" },
    { emoji: "💯", name: "hundred points", keywords: ["100", "perfect", "score"], category: "Smileys & Emotion" },
    { emoji: "💥", name: "collision", keywords: ["boom", "explosion", "bang"], category: "Smileys & Emotion" },
    { emoji: "💫", name: "dizzy", keywords: ["star", "sparkle", "dizzy"], category: "Smileys & Emotion" },
    { emoji: "💦", name: "sweat droplets", keywords: ["sweat", "water", "splashing"], category: "Smileys & Emotion" },
    { emoji: "❤️", name: "red heart", keywords: ["love", "heart", "valentine"], category: "Smileys & Emotion" },
    { emoji: "🧡", name: "orange heart", keywords: ["love", "heart"], category: "Smileys & Emotion" },
    { emoji: "💛", name: "yellow heart", keywords: ["love", "heart"], category: "Smileys & Emotion" },
    { emoji: "💚", name: "green heart", keywords: ["love", "heart"], category: "Smileys & Emotion" },
    { emoji: "💙", name: "blue heart", keywords: ["love", "heart"], category: "Smileys & Emotion" },
    { emoji: "💜", name: "purple heart", keywords: ["love", "heart"], category: "Smileys & Emotion" },
    { emoji: "🖤", name: "black heart", keywords: ["love", "heart", "dark"], category: "Smileys & Emotion" },
    { emoji: "🤍", name: "white heart", keywords: ["love", "heart", "pure"], category: "Smileys & Emotion" },
    { emoji: "💔", name: "broken heart", keywords: ["heartbreak", "sad", "love"], category: "Smileys & Emotion" },
    { emoji: "🔥", name: "fire", keywords: ["flame", "hot", "lit", "burn"], category: "Smileys & Emotion" },
    { emoji: "⭐", name: "star", keywords: ["star", "favorite", "gold"], category: "Smileys & Emotion" },
    { emoji: "🌟", name: "glowing star", keywords: ["sparkle", "shine", "star"], category: "Smileys & Emotion" },
    { emoji: "✨", name: "sparkles", keywords: ["sparkle", "shine", "magic", "clean"], category: "Smileys & Emotion" },
    // ── People & Body ──
    { emoji: "👋", name: "waving hand", keywords: ["hello", "bye", "wave", "hi"], category: "People & Body" },
    { emoji: "🤚", name: "raised back of hand", keywords: ["hand", "stop"], category: "People & Body" },
    { emoji: "✋", name: "raised hand", keywords: ["stop", "high five", "hand"], category: "People & Body" },
    { emoji: "🖖", name: "vulcan salute", keywords: ["spock", "star trek"], category: "People & Body" },
    { emoji: "👌", name: "ok hand", keywords: ["ok", "perfect", "nice"], category: "People & Body" },
    { emoji: "🤌", name: "pinched fingers", keywords: ["italian", "chef", "what"], category: "People & Body" },
    { emoji: "✌️", name: "victory hand", keywords: ["peace", "v", "two"], category: "People & Body" },
    { emoji: "🤞", name: "crossed fingers", keywords: ["luck", "hope", "fingers crossed"], category: "People & Body" },
    { emoji: "🤟", name: "love you gesture", keywords: ["love", "ily", "rock"], category: "People & Body" },
    { emoji: "🤘", name: "sign of the horns", keywords: ["rock", "metal", "horns"], category: "People & Body" },
    { emoji: "🤙", name: "call me hand", keywords: ["call", "shaka", "hang loose"], category: "People & Body" },
    { emoji: "👈", name: "backhand index pointing left", keywords: ["left", "point", "direction"], category: "People & Body" },
    { emoji: "👉", name: "backhand index pointing right", keywords: ["right", "point", "direction"], category: "People & Body" },
    { emoji: "👆", name: "backhand index pointing up", keywords: ["up", "point"], category: "People & Body" },
    { emoji: "👇", name: "backhand index pointing down", keywords: ["down", "point"], category: "People & Body" },
    { emoji: "☝️", name: "index pointing up", keywords: ["up", "point", "one"], category: "People & Body" },
    { emoji: "👍", name: "thumbs up", keywords: ["like", "approve", "yes", "good", "+1"], category: "People & Body" },
    { emoji: "👎", name: "thumbs down", keywords: ["dislike", "no", "bad", "-1"], category: "People & Body" },
    { emoji: "✊", name: "raised fist", keywords: ["fist", "power", "punch"], category: "People & Body" },
    { emoji: "👊", name: "oncoming fist", keywords: ["punch", "fist bump"], category: "People & Body" },
    { emoji: "🤛", name: "left-facing fist", keywords: ["fist bump"], category: "People & Body" },
    { emoji: "🤜", name: "right-facing fist", keywords: ["fist bump"], category: "People & Body" },
    { emoji: "👏", name: "clapping hands", keywords: ["clap", "applause", "bravo"], category: "People & Body" },
    { emoji: "🙌", name: "raising hands", keywords: ["celebrate", "hooray", "praise"], category: "People & Body" },
    { emoji: "👐", name: "open hands", keywords: ["hands", "open"], category: "People & Body" },
    { emoji: "🤲", name: "palms up together", keywords: ["prayer", "hands"], category: "People & Body" },
    { emoji: "🤝", name: "handshake", keywords: ["agreement", "deal", "meeting"], category: "People & Body" },
    { emoji: "🙏", name: "folded hands", keywords: ["pray", "please", "thank you", "namaste"], category: "People & Body" },
    { emoji: "💪", name: "flexed biceps", keywords: ["strong", "muscle", "arm", "flex"], category: "People & Body" },
    { emoji: "🦾", name: "mechanical arm", keywords: ["robot", "prosthetic", "strong"], category: "People & Body" },
    { emoji: "👀", name: "eyes", keywords: ["look", "see", "watch", "stare"], category: "People & Body" },
    { emoji: "👁️", name: "eye", keywords: ["look", "see"], category: "People & Body" },
    { emoji: "👅", name: "tongue", keywords: ["lick", "taste"], category: "People & Body" },
    { emoji: "👄", name: "mouth", keywords: ["lips", "kiss"], category: "People & Body" },
    { emoji: "🧠", name: "brain", keywords: ["smart", "think", "mind"], category: "People & Body" },
    { emoji: "🫡", name: "saluting face", keywords: ["salute", "respect", "yes sir"], category: "People & Body" },
    { emoji: "🫠", name: "melting face", keywords: ["melt", "hot", "embarrassed"], category: "People & Body" },
    { emoji: "🫣", name: "face with peeking eye", keywords: ["peek", "shy", "scared"], category: "People & Body" },
    { emoji: "🫶", name: "heart hands", keywords: ["love", "heart", "hands"], category: "People & Body" },
    // ── Animals & Nature ──
    { emoji: "🐶", name: "dog face", keywords: ["dog", "puppy", "pet"], category: "Animals & Nature" },
    { emoji: "🐱", name: "cat face", keywords: ["cat", "kitten", "pet"], category: "Animals & Nature" },
    { emoji: "🐭", name: "mouse face", keywords: ["mouse", "rodent"], category: "Animals & Nature" },
    { emoji: "🐹", name: "hamster", keywords: ["hamster", "pet"], category: "Animals & Nature" },
    { emoji: "🐰", name: "rabbit face", keywords: ["rabbit", "bunny"], category: "Animals & Nature" },
    { emoji: "🦊", name: "fox", keywords: ["fox", "cunning"], category: "Animals & Nature" },
    { emoji: "🐻", name: "bear", keywords: ["bear", "teddy"], category: "Animals & Nature" },
    { emoji: "🐼", name: "panda", keywords: ["panda", "bear"], category: "Animals & Nature" },
    { emoji: "🐨", name: "koala", keywords: ["koala", "australia"], category: "Animals & Nature" },
    { emoji: "🐯", name: "tiger face", keywords: ["tiger", "cat"], category: "Animals & Nature" },
    { emoji: "🦁", name: "lion", keywords: ["lion", "king"], category: "Animals & Nature" },
    { emoji: "🐮", name: "cow face", keywords: ["cow", "moo"], category: "Animals & Nature" },
    { emoji: "🐷", name: "pig face", keywords: ["pig", "oink"], category: "Animals & Nature" },
    { emoji: "🐸", name: "frog", keywords: ["frog", "toad", "kermit"], category: "Animals & Nature" },
    { emoji: "🐵", name: "monkey face", keywords: ["monkey", "ape"], category: "Animals & Nature" },
    { emoji: "🙈", name: "see-no-evil monkey", keywords: ["monkey", "hide", "shy"], category: "Animals & Nature" },
    { emoji: "🙉", name: "hear-no-evil monkey", keywords: ["monkey", "ignore"], category: "Animals & Nature" },
    { emoji: "🙊", name: "speak-no-evil monkey", keywords: ["monkey", "oops", "secret"], category: "Animals & Nature" },
    { emoji: "🐔", name: "chicken", keywords: ["chicken", "bird", "hen"], category: "Animals & Nature" },
    { emoji: "🐧", name: "penguin", keywords: ["penguin", "bird", "cold"], category: "Animals & Nature" },
    { emoji: "🦅", name: "eagle", keywords: ["eagle", "bird", "freedom"], category: "Animals & Nature" },
    { emoji: "🦆", name: "duck", keywords: ["duck", "bird", "quack"], category: "Animals & Nature" },
    { emoji: "🦉", name: "owl", keywords: ["owl", "wise", "night"], category: "Animals & Nature" },
    { emoji: "🐝", name: "honeybee", keywords: ["bee", "honey", "buzz"], category: "Animals & Nature" },
    { emoji: "🐛", name: "bug", keywords: ["bug", "insect"], category: "Animals & Nature" },
    { emoji: "🦋", name: "butterfly", keywords: ["butterfly", "pretty", "nature"], category: "Animals & Nature" },
    { emoji: "🐌", name: "snail", keywords: ["snail", "slow"], category: "Animals & Nature" },
    { emoji: "🐙", name: "octopus", keywords: ["octopus", "sea"], category: "Animals & Nature" },
    { emoji: "🐬", name: "dolphin", keywords: ["dolphin", "sea", "ocean"], category: "Animals & Nature" },
    { emoji: "🐳", name: "spouting whale", keywords: ["whale", "ocean"], category: "Animals & Nature" },
    { emoji: "🦈", name: "shark", keywords: ["shark", "ocean", "danger"], category: "Animals & Nature" },
    { emoji: "🐊", name: "crocodile", keywords: ["crocodile", "alligator"], category: "Animals & Nature" },
    { emoji: "🐍", name: "snake", keywords: ["snake", "reptile"], category: "Animals & Nature" },
    { emoji: "🦖", name: "t-rex", keywords: ["dinosaur", "trex", "jurassic"], category: "Animals & Nature" },
    { emoji: "🦕", name: "sauropod", keywords: ["dinosaur", "brontosaurus"], category: "Animals & Nature" },
    { emoji: "🌲", name: "evergreen tree", keywords: ["tree", "nature", "pine", "forest"], category: "Animals & Nature" },
    { emoji: "🌸", name: "cherry blossom", keywords: ["flower", "spring", "sakura"], category: "Animals & Nature" },
    { emoji: "🌹", name: "rose", keywords: ["flower", "love", "romance"], category: "Animals & Nature" },
    { emoji: "🌻", name: "sunflower", keywords: ["flower", "sun", "nature"], category: "Animals & Nature" },
    { emoji: "🍀", name: "four leaf clover", keywords: ["luck", "clover", "irish"], category: "Animals & Nature" },
    { emoji: "🌈", name: "rainbow", keywords: ["rainbow", "pride", "colorful"], category: "Animals & Nature" },
    // ── Food & Drink ──
    { emoji: "🍎", name: "red apple", keywords: ["apple", "fruit"], category: "Food & Drink" },
    { emoji: "🍊", name: "tangerine", keywords: ["orange", "fruit", "citrus"], category: "Food & Drink" },
    { emoji: "🍋", name: "lemon", keywords: ["lemon", "citrus", "sour"], category: "Food & Drink" },
    { emoji: "🍌", name: "banana", keywords: ["banana", "fruit"], category: "Food & Drink" },
    { emoji: "🍉", name: "watermelon", keywords: ["watermelon", "fruit", "summer"], category: "Food & Drink" },
    { emoji: "🍇", name: "grapes", keywords: ["grapes", "fruit", "wine"], category: "Food & Drink" },
    { emoji: "🍓", name: "strawberry", keywords: ["strawberry", "fruit", "berry"], category: "Food & Drink" },
    { emoji: "🫐", name: "blueberries", keywords: ["blueberry", "fruit", "berry"], category: "Food & Drink" },
    { emoji: "🍑", name: "peach", keywords: ["peach", "fruit", "butt"], category: "Food & Drink" },
    { emoji: "🥑", name: "avocado", keywords: ["avocado", "guacamole"], category: "Food & Drink" },
    { emoji: "🍕", name: "pizza", keywords: ["pizza", "food", "slice"], category: "Food & Drink" },
    { emoji: "🍔", name: "hamburger", keywords: ["burger", "food", "fast food"], category: "Food & Drink" },
    { emoji: "🍟", name: "french fries", keywords: ["fries", "food", "chips"], category: "Food & Drink" },
    { emoji: "🌭", name: "hot dog", keywords: ["hotdog", "food", "sausage"], category: "Food & Drink" },
    { emoji: "🍿", name: "popcorn", keywords: ["popcorn", "movie", "snack"], category: "Food & Drink" },
    { emoji: "🧁", name: "cupcake", keywords: ["cupcake", "dessert", "sweet"], category: "Food & Drink" },
    { emoji: "🍰", name: "shortcake", keywords: ["cake", "dessert", "sweet"], category: "Food & Drink" },
    { emoji: "🎂", name: "birthday cake", keywords: ["cake", "birthday", "party"], category: "Food & Drink" },
    { emoji: "🍩", name: "doughnut", keywords: ["donut", "dessert", "sweet"], category: "Food & Drink" },
    { emoji: "🍪", name: "cookie", keywords: ["cookie", "snack", "sweet"], category: "Food & Drink" },
    { emoji: "🍫", name: "chocolate bar", keywords: ["chocolate", "candy", "sweet"], category: "Food & Drink" },
    { emoji: "🍬", name: "candy", keywords: ["candy", "sweet"], category: "Food & Drink" },
    { emoji: "☕", name: "hot beverage", keywords: ["coffee", "tea", "hot", "drink"], category: "Food & Drink" },
    { emoji: "🍵", name: "teacup", keywords: ["tea", "drink", "green tea"], category: "Food & Drink" },
    { emoji: "🧃", name: "beverage box", keywords: ["juice", "drink", "box"], category: "Food & Drink" },
    { emoji: "🍺", name: "beer mug", keywords: ["beer", "drink", "alcohol"], category: "Food & Drink" },
    { emoji: "🍻", name: "clinking beer mugs", keywords: ["beer", "cheers", "drink"], category: "Food & Drink" },
    { emoji: "🥂", name: "clinking glasses", keywords: ["champagne", "cheers", "toast"], category: "Food & Drink" },
    { emoji: "🍷", name: "wine glass", keywords: ["wine", "drink", "red"], category: "Food & Drink" },
    { emoji: "🥤", name: "cup with straw", keywords: ["soda", "drink", "beverage"], category: "Food & Drink" },
    { emoji: "🧊", name: "ice", keywords: ["ice", "cube", "cold"], category: "Food & Drink" },
    // ── Activities ──
    { emoji: "⚽", name: "soccer ball", keywords: ["soccer", "football", "sport"], category: "Activities" },
    { emoji: "🏀", name: "basketball", keywords: ["basketball", "sport", "nba"], category: "Activities" },
    { emoji: "🏈", name: "american football", keywords: ["football", "sport", "nfl"], category: "Activities" },
    { emoji: "⚾", name: "baseball", keywords: ["baseball", "sport"], category: "Activities" },
    { emoji: "🥎", name: "softball", keywords: ["softball", "sport"], category: "Activities" },
    { emoji: "🎾", name: "tennis", keywords: ["tennis", "sport", "ball"], category: "Activities" },
    { emoji: "🏐", name: "volleyball", keywords: ["volleyball", "sport"], category: "Activities" },
    { emoji: "🎱", name: "pool 8 ball", keywords: ["billiards", "pool", "8ball"], category: "Activities" },
    { emoji: "🏓", name: "ping pong", keywords: ["table tennis", "ping pong"], category: "Activities" },
    { emoji: "🎯", name: "bullseye", keywords: ["target", "dart", "goal"], category: "Activities" },
    { emoji: "🎮", name: "video game", keywords: ["game", "controller", "gaming", "play"], category: "Activities" },
    { emoji: "🕹️", name: "joystick", keywords: ["game", "arcade", "retro"], category: "Activities" },
    { emoji: "🎲", name: "game die", keywords: ["dice", "game", "random", "luck"], category: "Activities" },
    { emoji: "🧩", name: "puzzle piece", keywords: ["puzzle", "jigsaw"], category: "Activities" },
    { emoji: "♟️", name: "chess pawn", keywords: ["chess", "game", "strategy"], category: "Activities" },
    { emoji: "🎭", name: "performing arts", keywords: ["theater", "drama", "masks"], category: "Activities" },
    { emoji: "🎨", name: "artist palette", keywords: ["art", "paint", "draw"], category: "Activities" },
    { emoji: "🎬", name: "clapper board", keywords: ["movie", "film", "cinema"], category: "Activities" },
    { emoji: "🎤", name: "microphone", keywords: ["mic", "karaoke", "sing"], category: "Activities" },
    { emoji: "🎧", name: "headphone", keywords: ["headphones", "music", "listen"], category: "Activities" },
    { emoji: "🎵", name: "musical note", keywords: ["music", "note", "song"], category: "Activities" },
    { emoji: "🎶", name: "musical notes", keywords: ["music", "notes", "song", "melody"], category: "Activities" },
    { emoji: "🎸", name: "guitar", keywords: ["guitar", "music", "rock"], category: "Activities" },
    { emoji: "🎹", name: "musical keyboard", keywords: ["piano", "keyboard", "music"], category: "Activities" },
    { emoji: "🥁", name: "drum", keywords: ["drum", "music", "beat"], category: "Activities" },
    { emoji: "🏆", name: "trophy", keywords: ["trophy", "win", "champion", "award"], category: "Activities" },
    { emoji: "🥇", name: "1st place medal", keywords: ["gold", "medal", "first", "winner"], category: "Activities" },
    { emoji: "🥈", name: "2nd place medal", keywords: ["silver", "medal", "second"], category: "Activities" },
    { emoji: "🥉", name: "3rd place medal", keywords: ["bronze", "medal", "third"], category: "Activities" },
    { emoji: "🎪", name: "circus tent", keywords: ["circus", "tent", "carnival"], category: "Activities" },
    // ── Travel & Places ──
    { emoji: "🚗", name: "automobile", keywords: ["car", "drive", "vehicle"], category: "Travel & Places" },
    { emoji: "🚕", name: "taxi", keywords: ["taxi", "cab", "car"], category: "Travel & Places" },
    { emoji: "🚙", name: "sport utility vehicle", keywords: ["suv", "car"], category: "Travel & Places" },
    { emoji: "🚌", name: "bus", keywords: ["bus", "transport"], category: "Travel & Places" },
    { emoji: "🚎", name: "trolleybus", keywords: ["bus", "trolley"], category: "Travel & Places" },
    { emoji: "🏎️", name: "racing car", keywords: ["race", "car", "fast", "f1"], category: "Travel & Places" },
    { emoji: "🚓", name: "police car", keywords: ["police", "car", "cop"], category: "Travel & Places" },
    { emoji: "🚑", name: "ambulance", keywords: ["ambulance", "emergency", "hospital"], category: "Travel & Places" },
    { emoji: "🚒", name: "fire engine", keywords: ["fire truck", "emergency"], category: "Travel & Places" },
    { emoji: "✈️", name: "airplane", keywords: ["plane", "fly", "travel", "flight"], category: "Travel & Places" },
    { emoji: "🚀", name: "rocket", keywords: ["rocket", "space", "launch", "nasa"], category: "Travel & Places" },
    { emoji: "🛸", name: "flying saucer", keywords: ["ufo", "alien", "spaceship"], category: "Travel & Places" },
    { emoji: "🚁", name: "helicopter", keywords: ["helicopter", "chopper"], category: "Travel & Places" },
    { emoji: "🛳️", name: "passenger ship", keywords: ["ship", "cruise", "boat"], category: "Travel & Places" },
    { emoji: "⛵", name: "sailboat", keywords: ["boat", "sail", "sea"], category: "Travel & Places" },
    { emoji: "🏠", name: "house", keywords: ["house", "home", "building"], category: "Travel & Places" },
    { emoji: "🏢", name: "office building", keywords: ["office", "building", "work"], category: "Travel & Places" },
    { emoji: "🏥", name: "hospital", keywords: ["hospital", "health", "building"], category: "Travel & Places" },
    { emoji: "🏫", name: "school", keywords: ["school", "education", "building"], category: "Travel & Places" },
    { emoji: "⛪", name: "church", keywords: ["church", "religion", "building"], category: "Travel & Places" },
    { emoji: "🗽", name: "statue of liberty", keywords: ["liberty", "new york", "usa"], category: "Travel & Places" },
    { emoji: "🗼", name: "tokyo tower", keywords: ["tokyo", "japan", "tower"], category: "Travel & Places" },
    { emoji: "🌍", name: "globe europe africa", keywords: ["earth", "world", "globe"], category: "Travel & Places" },
    { emoji: "🌎", name: "globe americas", keywords: ["earth", "world", "globe"], category: "Travel & Places" },
    { emoji: "🌏", name: "globe asia australia", keywords: ["earth", "world", "globe"], category: "Travel & Places" },
    { emoji: "🌙", name: "crescent moon", keywords: ["moon", "night", "sleep"], category: "Travel & Places" },
    { emoji: "☀️", name: "sun", keywords: ["sun", "bright", "day", "sunny"], category: "Travel & Places" },
    { emoji: "⛅", name: "sun behind cloud", keywords: ["cloud", "weather", "partly cloudy"], category: "Travel & Places" },
    { emoji: "🌧️", name: "cloud with rain", keywords: ["rain", "weather", "cloud"], category: "Travel & Places" },
    { emoji: "⛈️", name: "cloud with lightning and rain", keywords: ["storm", "thunder", "weather"], category: "Travel & Places" },
    { emoji: "❄️", name: "snowflake", keywords: ["snow", "cold", "winter", "ice"], category: "Travel & Places" },
    // ── Objects ──
    { emoji: "⌚", name: "watch", keywords: ["watch", "time", "clock"], category: "Objects" },
    { emoji: "📱", name: "mobile phone", keywords: ["phone", "mobile", "cell", "iphone"], category: "Objects" },
    { emoji: "💻", name: "laptop", keywords: ["computer", "laptop", "mac", "pc"], category: "Objects" },
    { emoji: "⌨️", name: "keyboard", keywords: ["keyboard", "type", "computer"], category: "Objects" },
    { emoji: "🖥️", name: "desktop computer", keywords: ["computer", "monitor", "desktop"], category: "Objects" },
    { emoji: "🖨️", name: "printer", keywords: ["printer", "print", "paper"], category: "Objects" },
    { emoji: "🖱️", name: "computer mouse", keywords: ["mouse", "click", "computer"], category: "Objects" },
    { emoji: "💾", name: "floppy disk", keywords: ["save", "floppy", "disk", "retro"], category: "Objects" },
    { emoji: "💿", name: "optical disk", keywords: ["cd", "disk", "dvd"], category: "Objects" },
    { emoji: "📷", name: "camera", keywords: ["camera", "photo", "picture"], category: "Objects" },
    { emoji: "📹", name: "video camera", keywords: ["video", "camera", "record"], category: "Objects" },
    { emoji: "🎥", name: "movie camera", keywords: ["movie", "film", "camera"], category: "Objects" },
    { emoji: "📺", name: "television", keywords: ["tv", "television", "screen"], category: "Objects" },
    { emoji: "📻", name: "radio", keywords: ["radio", "music"], category: "Objects" },
    { emoji: "🔔", name: "bell", keywords: ["bell", "notification", "alert"], category: "Objects" },
    { emoji: "🔕", name: "bell with slash", keywords: ["mute", "silent", "no bell"], category: "Objects" },
    { emoji: "📢", name: "loudspeaker", keywords: ["speaker", "announce", "loud"], category: "Objects" },
    { emoji: "💡", name: "light bulb", keywords: ["idea", "bulb", "light"], category: "Objects" },
    { emoji: "🔦", name: "flashlight", keywords: ["flashlight", "torch", "light"], category: "Objects" },
    { emoji: "🔧", name: "wrench", keywords: ["tool", "wrench", "fix"], category: "Objects" },
    { emoji: "🔨", name: "hammer", keywords: ["tool", "hammer", "build"], category: "Objects" },
    { emoji: "⚙️", name: "gear", keywords: ["settings", "gear", "cog"], category: "Objects" },
    { emoji: "🔗", name: "link", keywords: ["link", "chain", "url"], category: "Objects" },
    { emoji: "📎", name: "paperclip", keywords: ["paperclip", "attach", "clip"], category: "Objects" },
    { emoji: "🔒", name: "locked", keywords: ["lock", "security", "private"], category: "Objects" },
    { emoji: "🔓", name: "unlocked", keywords: ["unlock", "open", "security"], category: "Objects" },
    { emoji: "🔑", name: "key", keywords: ["key", "password", "lock"], category: "Objects" },
    { emoji: "📝", name: "memo", keywords: ["note", "write", "memo", "pencil"], category: "Objects" },
    { emoji: "📁", name: "file folder", keywords: ["folder", "file", "directory"], category: "Objects" },
    { emoji: "📂", name: "open file folder", keywords: ["folder", "file", "open"], category: "Objects" },
    { emoji: "📅", name: "calendar", keywords: ["calendar", "date", "schedule"], category: "Objects" },
    { emoji: "📌", name: "pushpin", keywords: ["pin", "location", "pushpin"], category: "Objects" },
    { emoji: "📍", name: "round pushpin", keywords: ["pin", "location"], category: "Objects" },
    { emoji: "✏️", name: "pencil", keywords: ["pencil", "write", "edit"], category: "Objects" },
    { emoji: "🎁", name: "wrapped gift", keywords: ["gift", "present", "birthday"], category: "Objects" },
    { emoji: "🎈", name: "balloon", keywords: ["balloon", "party", "celebration"], category: "Objects" },
    { emoji: "🎉", name: "party popper", keywords: ["party", "celebrate", "tada", "congratulations"], category: "Objects" },
    { emoji: "🎊", name: "confetti ball", keywords: ["confetti", "party", "celebrate"], category: "Objects" },
    // ── Symbols ──
    { emoji: "✅", name: "check mark button", keywords: ["check", "done", "yes", "correct"], category: "Symbols" },
    { emoji: "❌", name: "cross mark", keywords: ["no", "wrong", "delete", "x"], category: "Symbols" },
    { emoji: "❓", name: "question mark", keywords: ["question", "what", "help"], category: "Symbols" },
    { emoji: "❗", name: "exclamation mark", keywords: ["exclamation", "important", "alert"], category: "Symbols" },
    { emoji: "‼️", name: "double exclamation mark", keywords: ["exclamation", "important"], category: "Symbols" },
    { emoji: "⁉️", name: "exclamation question mark", keywords: ["surprise", "what"], category: "Symbols" },
    { emoji: "💤", name: "zzz", keywords: ["sleep", "tired", "zzz"], category: "Symbols" },
    { emoji: "💬", name: "speech balloon", keywords: ["chat", "message", "talk", "speech"], category: "Symbols" },
    { emoji: "💭", name: "thought balloon", keywords: ["think", "thought", "bubble"], category: "Symbols" },
    { emoji: "🔴", name: "red circle", keywords: ["red", "circle", "dot"], category: "Symbols" },
    { emoji: "🟠", name: "orange circle", keywords: ["orange", "circle"], category: "Symbols" },
    { emoji: "🟡", name: "yellow circle", keywords: ["yellow", "circle"], category: "Symbols" },
    { emoji: "🟢", name: "green circle", keywords: ["green", "circle", "online"], category: "Symbols" },
    { emoji: "🔵", name: "blue circle", keywords: ["blue", "circle"], category: "Symbols" },
    { emoji: "🟣", name: "purple circle", keywords: ["purple", "circle"], category: "Symbols" },
    { emoji: "⚫", name: "black circle", keywords: ["black", "circle"], category: "Symbols" },
    { emoji: "⚪", name: "white circle", keywords: ["white", "circle"], category: "Symbols" },
    { emoji: "➕", name: "plus", keywords: ["plus", "add", "math"], category: "Symbols" },
    { emoji: "➖", name: "minus", keywords: ["minus", "subtract", "math"], category: "Symbols" },
    { emoji: "➗", name: "divide", keywords: ["divide", "math"], category: "Symbols" },
    { emoji: "✖️", name: "multiply", keywords: ["multiply", "math", "times"], category: "Symbols" },
    { emoji: "♻️", name: "recycling symbol", keywords: ["recycle", "environment", "green"], category: "Symbols" },
    { emoji: "⚠️", name: "warning", keywords: ["warning", "caution", "alert"], category: "Symbols" },
    { emoji: "🚫", name: "prohibited", keywords: ["no", "forbidden", "ban", "stop"], category: "Symbols" },
    { emoji: "🔞", name: "no one under eighteen", keywords: ["18", "adult", "nsfw"], category: "Symbols" },
    { emoji: "ℹ️", name: "information", keywords: ["info", "information", "help"], category: "Symbols" },
    { emoji: "🆗", name: "ok button", keywords: ["ok", "yes", "agree"], category: "Symbols" },
    { emoji: "🆕", name: "new button", keywords: ["new", "fresh"], category: "Symbols" },
    { emoji: "🆙", name: "up button", keywords: ["up", "level up"], category: "Symbols" },
    { emoji: "🔝", name: "top arrow", keywords: ["top", "up", "first"], category: "Symbols" },
    { emoji: "🏧", name: "atm sign", keywords: ["atm", "money", "bank"], category: "Symbols" },
    { emoji: "♾️", name: "infinity", keywords: ["infinity", "forever", "loop"], category: "Symbols" },
    // ── Flags ──
    { emoji: "🏁", name: "chequered flag", keywords: ["race", "finish", "checkered"], category: "Flags" },
    { emoji: "🚩", name: "triangular flag", keywords: ["flag", "red flag", "warning"], category: "Flags" },
    { emoji: "🎌", name: "crossed flags", keywords: ["flags", "japan", "celebration"], category: "Flags" },
    { emoji: "🏴", name: "black flag", keywords: ["flag", "black", "pirate"], category: "Flags" },
    { emoji: "🏳️", name: "white flag", keywords: ["flag", "white", "surrender", "peace"], category: "Flags" },
    { emoji: "🏳️‍🌈", name: "rainbow flag", keywords: ["pride", "lgbtq", "rainbow", "gay"], category: "Flags" },
    { emoji: "🏴‍☠️", name: "pirate flag", keywords: ["pirate", "skull", "jolly roger"], category: "Flags" },
    { emoji: "🇺🇸", name: "flag united states", keywords: ["usa", "america", "us"], category: "Flags" },
    { emoji: "🇬🇧", name: "flag united kingdom", keywords: ["uk", "britain", "england"], category: "Flags" },
    { emoji: "🇨🇦", name: "flag canada", keywords: ["canada", "maple"], category: "Flags" },
    { emoji: "🇦🇺", name: "flag australia", keywords: ["australia"], category: "Flags" },
    { emoji: "🇩🇪", name: "flag germany", keywords: ["germany", "deutschland"], category: "Flags" },
    { emoji: "🇫🇷", name: "flag france", keywords: ["france", "french"], category: "Flags" },
    { emoji: "🇪🇸", name: "flag spain", keywords: ["spain", "spanish"], category: "Flags" },
    { emoji: "🇮🇹", name: "flag italy", keywords: ["italy", "italian"], category: "Flags" },
    { emoji: "🇧🇷", name: "flag brazil", keywords: ["brazil", "brazilian"], category: "Flags" },
    { emoji: "🇯🇵", name: "flag japan", keywords: ["japan", "japanese"], category: "Flags" },
    { emoji: "🇰🇷", name: "flag south korea", keywords: ["korea", "korean"], category: "Flags" },
    { emoji: "🇮🇳", name: "flag india", keywords: ["india", "indian"], category: "Flags" },
    { emoji: "🇲🇽", name: "flag mexico", keywords: ["mexico", "mexican"], category: "Flags" },
    { emoji: "🇦🇷", name: "flag argentina", keywords: ["argentina"], category: "Flags" },

    // ── Gap-fill: commonly-expected default emoji missing from the set above (PRD 4.9) ──
    // ── Smileys & Emotion ──
    { emoji: "😉", name: "winking face", keywords: ["wink", "flirt"], category: "Smileys & Emotion" },
    { emoji: "🙃", name: "upside-down face", keywords: ["silly", "sarcasm"], category: "Smileys & Emotion" },
    { emoji: "☺️", name: "smiling face", keywords: ["smile", "happy", "relaxed"], category: "Smileys & Emotion" },
    { emoji: "😙", name: "kissing face with smiling eyes", keywords: ["kiss", "affection"], category: "Smileys & Emotion" },
    { emoji: "🤨", name: "face with raised eyebrow", keywords: ["skeptical", "suspicious", "distrust"], category: "Smileys & Emotion" },
    { emoji: "🤧", name: "sneezing face", keywords: ["sick", "sneeze", "gesundheit"], category: "Smileys & Emotion" },
    { emoji: "🤠", name: "cowboy hat face", keywords: ["cowboy", "cowgirl", "hat"], category: "Smileys & Emotion" },
    { emoji: "🥲", name: "smiling face with tear", keywords: ["bittersweet", "proud", "touched"], category: "Smileys & Emotion" },
    { emoji: "🥹", name: "face holding back tears", keywords: ["touched", "proud", "emotional"], category: "Smileys & Emotion" },
    { emoji: "😵‍💫", name: "face with spiral eyes", keywords: ["dizzy", "confused"], category: "Smileys & Emotion" },
    { emoji: "🫥", name: "dotted line face", keywords: ["invisible", "shy", "blend in"], category: "Smileys & Emotion" },

    // ── People & Body ──
    { emoji: "🤦", name: "person facepalming", keywords: ["facepalm", "disbelief"], category: "People & Body" },
    { emoji: "🤷", name: "person shrugging", keywords: ["shrug", "idk", "unknown"], category: "People & Body" },
    { emoji: "💃", name: "woman dancing", keywords: ["dance", "party"], category: "People & Body" },
    { emoji: "🕺", name: "man dancing", keywords: ["dance", "party"], category: "People & Body" },
    { emoji: "🚶", name: "person walking", keywords: ["walk", "pedestrian"], category: "People & Body" },
    { emoji: "🏃", name: "person running", keywords: ["run", "race", "jog"], category: "People & Body" },
    { emoji: "👶", name: "baby", keywords: ["infant", "newborn"], category: "People & Body" },
    { emoji: "🧒", name: "child", keywords: ["kid"], category: "People & Body" },
    { emoji: "👦", name: "boy", keywords: ["child", "kid"], category: "People & Body" },
    { emoji: "👧", name: "girl", keywords: ["child", "kid"], category: "People & Body" },
    { emoji: "👨", name: "man", keywords: ["adult"], category: "People & Body" },
    { emoji: "👩", name: "woman", keywords: ["adult"], category: "People & Body" },
    { emoji: "👴", name: "old man", keywords: ["elder", "senior"], category: "People & Body" },
    { emoji: "👵", name: "old woman", keywords: ["elder", "senior"], category: "People & Body" },
    { emoji: "🙋", name: "person raising hand", keywords: ["question", "volunteer"], category: "People & Body" },
    { emoji: "💁", name: "person tipping hand", keywords: ["information", "sassy"], category: "People & Body" },
    { emoji: "🙇", name: "person bowing", keywords: ["sorry", "respect", "apology"], category: "People & Body" },
    { emoji: "🧑‍💻", name: "technologist", keywords: ["coder", "developer", "programmer"], category: "People & Body" },
    { emoji: "👣", name: "footprints", keywords: ["tracks", "steps"], category: "People & Body" },

    // ── Animals & Nature ──
    { emoji: "🦄", name: "unicorn", keywords: ["mythical", "fantasy"], category: "Animals & Nature" },
    { emoji: "🐺", name: "wolf", keywords: ["animal"], category: "Animals & Nature" },
    { emoji: "🐴", name: "horse face", keywords: ["animal", "pony"], category: "Animals & Nature" },
    { emoji: "🐢", name: "turtle", keywords: ["slow", "animal"], category: "Animals & Nature" },
    { emoji: "🦀", name: "crab", keywords: ["animal", "seafood"], category: "Animals & Nature" },
    { emoji: "🐟", name: "fish", keywords: ["animal", "seafood"], category: "Animals & Nature" },
    { emoji: "🐠", name: "tropical fish", keywords: ["animal", "aquarium"], category: "Animals & Nature" },
    { emoji: "🕷️", name: "spider", keywords: ["bug", "creepy"], category: "Animals & Nature" },
    { emoji: "🦂", name: "scorpion", keywords: ["bug", "zodiac"], category: "Animals & Nature" },
    { emoji: "🦇", name: "bat", keywords: ["animal", "vampire", "night"], category: "Animals & Nature" },
    { emoji: "🐣", name: "hatching chick", keywords: ["bird", "baby", "new"], category: "Animals & Nature" },
    { emoji: "🌴", name: "palm tree", keywords: ["tropical", "beach"], category: "Animals & Nature" },
    { emoji: "🌵", name: "cactus", keywords: ["desert", "plant"], category: "Animals & Nature" },
    { emoji: "🍁", name: "maple leaf", keywords: ["autumn", "fall", "canada"], category: "Animals & Nature" },
    { emoji: "🍂", name: "fallen leaves", keywords: ["autumn", "fall"], category: "Animals & Nature" },
    { emoji: "🌱", name: "seedling", keywords: ["plant", "growth", "new"], category: "Animals & Nature" },
    { emoji: "🌷", name: "tulip", keywords: ["flower", "spring"], category: "Animals & Nature" },
    { emoji: "💐", name: "bouquet", keywords: ["flowers", "gift"], category: "Animals & Nature" },
    { emoji: "🌼", name: "blossom", keywords: ["flower"], category: "Animals & Nature" },

    // ── Food & Drink ──
    { emoji: "🍒", name: "cherries", keywords: ["fruit"], category: "Food & Drink" },
    { emoji: "🍅", name: "tomato", keywords: ["vegetable", "fruit"], category: "Food & Drink" },
    { emoji: "🥕", name: "carrot", keywords: ["vegetable"], category: "Food & Drink" },
    { emoji: "🌽", name: "corn", keywords: ["vegetable"], category: "Food & Drink" },
    { emoji: "🥦", name: "broccoli", keywords: ["vegetable"], category: "Food & Drink" },
    { emoji: "🧀", name: "cheese wedge", keywords: ["dairy"], category: "Food & Drink" },
    { emoji: "🥓", name: "bacon", keywords: ["meat", "breakfast"], category: "Food & Drink" },
    { emoji: "🍞", name: "bread", keywords: ["loaf", "bakery"], category: "Food & Drink" },
    { emoji: "🥐", name: "croissant", keywords: ["bakery", "breakfast"], category: "Food & Drink" },
    { emoji: "🥪", name: "sandwich", keywords: ["lunch"], category: "Food & Drink" },
    { emoji: "🌮", name: "taco", keywords: ["mexican"], category: "Food & Drink" },
    { emoji: "🌯", name: "burrito", keywords: ["mexican", "wrap"], category: "Food & Drink" },
    { emoji: "🍝", name: "spaghetti", keywords: ["pasta", "italian"], category: "Food & Drink" },
    { emoji: "🍜", name: "steaming bowl", keywords: ["ramen", "noodles", "soup"], category: "Food & Drink" },
    { emoji: "🍣", name: "sushi", keywords: ["japanese", "seafood"], category: "Food & Drink" },
    { emoji: "🍦", name: "soft ice cream", keywords: ["dessert", "sweet"], category: "Food & Drink" },
    { emoji: "🍨", name: "ice cream", keywords: ["dessert", "sweet"], category: "Food & Drink" },
    { emoji: "🍭", name: "lollipop", keywords: ["candy", "sweet"], category: "Food & Drink" },
    { emoji: "🍯", name: "honey pot", keywords: ["sweet", "bees"], category: "Food & Drink" },
    { emoji: "🥛", name: "glass of milk", keywords: ["drink", "dairy"], category: "Food & Drink" },
    { emoji: "🍸", name: "cocktail glass", keywords: ["drink", "alcohol"], category: "Food & Drink" },
    { emoji: "🥃", name: "tumbler glass", keywords: ["whisky", "drink", "alcohol"], category: "Food & Drink" },
    { emoji: "🍾", name: "bottle with popping cork", keywords: ["champagne", "celebration"], category: "Food & Drink" },

    // ── Activities ──
    { emoji: "🏸", name: "badminton", keywords: ["sport", "racquet"], category: "Activities" },
    { emoji: "🏒", name: "ice hockey", keywords: ["sport"], category: "Activities" },
    { emoji: "🏏", name: "cricket game", keywords: ["sport"], category: "Activities" },
    { emoji: "🥊", name: "boxing glove", keywords: ["sport", "fight"], category: "Activities" },
    { emoji: "⛳", name: "flag in hole", keywords: ["golf", "sport"], category: "Activities" },
    { emoji: "🎳", name: "bowling", keywords: ["sport", "strike"], category: "Activities" },
    { emoji: "🎣", name: "fishing pole", keywords: ["fish", "hobby"], category: "Activities" },
    { emoji: "🎿", name: "skis", keywords: ["winter", "sport"], category: "Activities" },
    { emoji: "🏂", name: "snowboarder", keywords: ["winter", "sport"], category: "Activities" },
    { emoji: "🏋️", name: "person lifting weights", keywords: ["gym", "workout"], category: "Activities" },
    { emoji: "🚴", name: "person biking", keywords: ["cycling", "sport"], category: "Activities" },
    { emoji: "🎖️", name: "military medal", keywords: ["award", "honor"], category: "Activities" },
    { emoji: "🎫", name: "ticket", keywords: ["event", "admission"], category: "Activities" },

    // ── Travel & Places ──
    { emoji: "🚲", name: "bicycle", keywords: ["bike", "cycling"], category: "Travel & Places" },
    { emoji: "🏍️", name: "motorcycle", keywords: ["bike", "motorbike"], category: "Travel & Places" },
    { emoji: "🚂", name: "locomotive", keywords: ["train"], category: "Travel & Places" },
    { emoji: "🚦", name: "vertical traffic light", keywords: ["stop", "go", "signal"], category: "Travel & Places" },
    { emoji: "⛽", name: "fuel pump", keywords: ["gas", "station"], category: "Travel & Places" },
    { emoji: "🗺️", name: "world map", keywords: ["travel", "geography"], category: "Travel & Places" },
    { emoji: "🧭", name: "compass", keywords: ["navigation", "direction"], category: "Travel & Places" },
    { emoji: "⛰️", name: "mountain", keywords: ["nature", "hike"], category: "Travel & Places" },
    { emoji: "🏖️", name: "beach with umbrella", keywords: ["vacation", "sand"], category: "Travel & Places" },
    { emoji: "🌋", name: "volcano", keywords: ["nature", "eruption"], category: "Travel & Places" },
    { emoji: "🏰", name: "castle", keywords: ["fairytale", "building"], category: "Travel & Places" },
    { emoji: "🎡", name: "ferris wheel", keywords: ["carnival", "fair"], category: "Travel & Places" },
    { emoji: "🎢", name: "roller coaster", keywords: ["amusement", "park"], category: "Travel & Places" },
    { emoji: "🌅", name: "sunrise", keywords: ["morning", "dawn"], category: "Travel & Places" },
    { emoji: "🎆", name: "fireworks", keywords: ["celebration", "night"], category: "Travel & Places" },
    { emoji: "🌊", name: "water wave", keywords: ["ocean", "sea", "surf"], category: "Travel & Places" },
    { emoji: "⚡", name: "high voltage", keywords: ["lightning", "bolt", "electric"], category: "Travel & Places" },
    { emoji: "☔", name: "umbrella with rain drops", keywords: ["rain", "weather"], category: "Travel & Places" },
    { emoji: "⛄", name: "snowman without snow", keywords: ["winter", "cold"], category: "Travel & Places" },
    { emoji: "🌡️", name: "thermometer", keywords: ["temperature", "weather"], category: "Travel & Places" },

    // ── Objects ──
    { emoji: "📚", name: "books", keywords: ["read", "study", "library"], category: "Objects" },
    { emoji: "✂️", name: "scissors", keywords: ["cut", "craft"], category: "Objects" },
    { emoji: "🗑️", name: "wastebasket", keywords: ["trash", "delete"], category: "Objects" },
    { emoji: "🛒", name: "shopping cart", keywords: ["shopping", "store"], category: "Objects" },
    { emoji: "💰", name: "money bag", keywords: ["cash", "rich"], category: "Objects" },
    { emoji: "💵", name: "dollar banknote", keywords: ["money", "cash"], category: "Objects" },
    { emoji: "💳", name: "credit card", keywords: ["payment", "money"], category: "Objects" },
    { emoji: "👑", name: "crown", keywords: ["king", "queen", "royalty"], category: "Objects" },
    { emoji: "💎", name: "gem stone", keywords: ["diamond", "jewel"], category: "Objects" },
    { emoji: "🕶️", name: "sunglasses", keywords: ["cool", "shades"], category: "Objects" },
    { emoji: "👓", name: "glasses", keywords: ["eyewear", "nerd"], category: "Objects" },
    { emoji: "👔", name: "necktie", keywords: ["clothing", "formal"], category: "Objects" },
    { emoji: "👕", name: "t-shirt", keywords: ["clothing", "shirt"], category: "Objects" },
    { emoji: "👗", name: "dress", keywords: ["clothing"], category: "Objects" },
    { emoji: "👟", name: "running shoe", keywords: ["sneaker", "clothing"], category: "Objects" },
    { emoji: "🎩", name: "top hat", keywords: ["formal", "magic"], category: "Objects" },
    { emoji: "🧢", name: "billed cap", keywords: ["hat", "clothing"], category: "Objects" },
    { emoji: "💄", name: "lipstick", keywords: ["makeup", "beauty"], category: "Objects" },
    { emoji: "💍", name: "ring", keywords: ["jewelry", "engagement", "wedding"], category: "Objects" },
    { emoji: "🛏️", name: "bed", keywords: ["sleep", "furniture"], category: "Objects" },
    { emoji: "🪑", name: "chair", keywords: ["furniture", "seat"], category: "Objects" },
    { emoji: "🧸", name: "teddy bear", keywords: ["toy", "cute"], category: "Objects" },
    { emoji: "💊", name: "pill", keywords: ["medicine", "health"], category: "Objects" },
    { emoji: "💉", name: "syringe", keywords: ["medicine", "injection", "vaccine"], category: "Objects" },

    // ── Symbols ──
    { emoji: "💲", name: "heavy dollar sign", keywords: ["money", "currency"], category: "Symbols" },
    { emoji: "#️⃣", name: "keycap hash", keywords: ["hashtag", "number"], category: "Symbols" },
    { emoji: "✔️", name: "check mark", keywords: ["done", "yes", "correct"], category: "Symbols" },
    { emoji: "☑️", name: "check box with check", keywords: ["done", "selected"], category: "Symbols" },
    { emoji: "🔀", name: "shuffle tracks button", keywords: ["random", "music"], category: "Symbols" },
    { emoji: "🔁", name: "repeat button", keywords: ["loop", "again"], category: "Symbols" },
    { emoji: "⏯️", name: "play or pause button", keywords: ["media", "video"], category: "Symbols" },
    { emoji: "⏹️", name: "stop button", keywords: ["media", "video"], category: "Symbols" },
    { emoji: "⬆️", name: "up arrow", keywords: ["direction", "north"], category: "Symbols" },
    { emoji: "⬇️", name: "down arrow", keywords: ["direction", "south"], category: "Symbols" },
    { emoji: "⬅️", name: "left arrow", keywords: ["direction", "back", "west"], category: "Symbols" },
    { emoji: "➡️", name: "right arrow", keywords: ["direction", "next", "east"], category: "Symbols" },
    { emoji: "🔄", name: "counterclockwise arrows button", keywords: ["refresh", "reload", "sync"], category: "Symbols" },
    { emoji: "🔢", name: "input numbers", keywords: ["1234", "digits"], category: "Symbols" },
    { emoji: "💠", name: "diamond with a dot", keywords: ["shape"], category: "Symbols" },
    { emoji: "🔘", name: "radio button", keywords: ["select", "option"], category: "Symbols" },
    { emoji: "⬛", name: "black large square", keywords: ["shape", "square"], category: "Symbols" },
    { emoji: "⬜", name: "white large square", keywords: ["shape", "square"], category: "Symbols" },
    { emoji: "🟥", name: "red square", keywords: ["shape", "color"], category: "Symbols" },
    { emoji: "🟩", name: "green square", keywords: ["shape", "color"], category: "Symbols" },
    { emoji: "🟦", name: "blue square", keywords: ["shape", "color"], category: "Symbols" },
    { emoji: "💞", name: "revolving hearts", keywords: ["love", "affection"], category: "Symbols" },
    { emoji: "💕", name: "two hearts", keywords: ["love", "affection"], category: "Symbols" },
    { emoji: "💓", name: "beating heart", keywords: ["love", "pulse"], category: "Symbols" },
    { emoji: "💗", name: "growing heart", keywords: ["love", "excited"], category: "Symbols" },
    { emoji: "💖", name: "sparkling heart", keywords: ["love", "shiny"], category: "Symbols" },
    { emoji: "💘", name: "heart with arrow", keywords: ["love", "cupid", "crush"], category: "Symbols" },
    { emoji: "❤️‍🔥", name: "heart on fire", keywords: ["love", "passion", "burning"], category: "Symbols" },

    // ── Flags ──
    { emoji: "🇨🇳", name: "flag china", keywords: ["china", "chinese"], category: "Flags" },
    { emoji: "🇷🇺", name: "flag russia", keywords: ["russia", "russian"], category: "Flags" },
    { emoji: "🇵🇹", name: "flag portugal", keywords: ["portugal", "portuguese"], category: "Flags" },
    { emoji: "🇳🇱", name: "flag netherlands", keywords: ["netherlands", "dutch", "holland"], category: "Flags" },
    { emoji: "🇸🇪", name: "flag sweden", keywords: ["sweden", "swedish"], category: "Flags" },
    { emoji: "🇨🇭", name: "flag switzerland", keywords: ["switzerland", "swiss"], category: "Flags" },
    { emoji: "🇵🇱", name: "flag poland", keywords: ["poland", "polish"], category: "Flags" },
    { emoji: "🇹🇷", name: "flag turkey", keywords: ["turkey", "turkish"], category: "Flags" },
    { emoji: "🇿🇦", name: "flag south africa", keywords: ["south africa"], category: "Flags" },
    { emoji: "🇺🇦", name: "flag ukraine", keywords: ["ukraine", "ukrainian"], category: "Flags" },
    { emoji: "🇵🇭", name: "flag philippines", keywords: ["philippines", "filipino"], category: "Flags" },
    { emoji: "🇮🇩", name: "flag indonesia", keywords: ["indonesia", "indonesian"], category: "Flags" },
    { emoji: "🇻🇳", name: "flag vietnam", keywords: ["vietnam", "vietnamese"], category: "Flags" },
    { emoji: "🇹🇭", name: "flag thailand", keywords: ["thailand", "thai"], category: "Flags" },
    { emoji: "🇮🇪", name: "flag ireland", keywords: ["ireland", "irish"], category: "Flags" },
    { emoji: "🇳🇴", name: "flag norway", keywords: ["norway", "norwegian"], category: "Flags" },
    { emoji: "🇩🇰", name: "flag denmark", keywords: ["denmark", "danish"], category: "Flags" },
    { emoji: "🇬🇷", name: "flag greece", keywords: ["greece", "greek"], category: "Flags" },
    { emoji: "🇪🇬", name: "flag egypt", keywords: ["egypt", "egyptian"], category: "Flags" },
    { emoji: "🇳🇬", name: "flag nigeria", keywords: ["nigeria", "nigerian"], category: "Flags" },
    { emoji: "🇮🇱", name: "flag israel", keywords: ["israel", "israeli"], category: "Flags" },
    { emoji: "🇳🇿", name: "flag new zealand", keywords: ["new zealand", "kiwi"], category: "Flags" },
];

/** Mirror of IIdentityEvent (shared-types) — the renderer can't import it (PRD 18.4). */
interface IdentityLogEvent {
    id: string;
    userId: string;
    nickname: string;
    currentNickname?: string;
    kind: "BOUND" | "RESET" | "REFUSED";
    reason: string | null;
    fingerprint: string | null;
    address: string | null;
    host: string | null;
    actorId: string | null;
    actorNickname?: string | null;
    createdAt: string;
    privileged?: boolean;
}

// ── Encrypted connections (PRD 18.3) — mirrors of tls-trust.ts (the renderer is a
// plain script and can't import it; the pure functions arrive through the preload).
interface TlsCertInfo {
    fingerprint256: string;
    subject: string;
    issuer: string;
    validTo: string;
    sans: string[];
}
type TlsProbeResult =
    | { kind: "trusted"; cert: TlsCertInfo }
    | { kind: "untrusted"; cert: TlsCertInfo; reason: string }
    | { kind: "no-tls" }
    | { kind: "unreachable"; code: string };
type TlsSchemeDecision =
    | { action: "connect"; scheme: "https"; pinned: boolean }
    | { action: "connect"; scheme: "http"; warn: true }
    | { action: "ask-trust"; cert: TlsCertInfo }
    | { action: "pin-mismatch"; cert: TlsCertInfo; pinnedFingerprint: string }
    | { action: "error"; message: string };
interface TlsServerAddress {
    scheme: "https" | "http" | null;
    host: string;
    port: number | undefined;
}
interface TlsPinSummary {
    hostKey: string;
    fingerprint256: string;
    subject: string;
    validTo: string;
    pinnedAt: string;
}

interface Reson8Api {
    readonly platform: string;
    readonly isLinuxWayland: boolean;
    getInstanceId(): string;
    isExistingInstall(): Promise<boolean>;
    connect(
        address: { scheme: "https" | "http"; host: string; port?: number; pinned?: boolean },
        nickname: string,
        password?: string,
        inviteCode?: string,
        savedServerId?: string,
    ): Promise<void>;
    getServerBaseUrl(): string;
    /** Saved server passwords (PRD 19 C1) — the plaintext is never readable here. */
    savedPassword: {
        available(): Promise<boolean>;
        set(id: string, password: string): Promise<{ stored: boolean }>;
        delete(id: string): Promise<void>;
        has(id: string): Promise<boolean>;
    };
    tls: {
        parseServerAddress(raw: string): { ok: true; value: TlsServerAddress } | { ok: false; error: string };
        decideScheme(input: {
            explicit: "https" | "http" | null;
            probe: TlsProbeResult | null;
            pinnedFingerprint: string | null;
            httpsRemembered: boolean;
        }): TlsSchemeDecision;
        formatFingerprint(hex: string): string;
        hostKey(host: string, port: number): string;
        probe(
            host: string,
            port: number,
        ): Promise<
            | { error: string }
            | { result: TlsProbeResult; pinnedFingerprint: string | null; httpsRemembered: boolean }
        >;
        trustCertificate(host: string, port: number, fingerprint256: string): Promise<{ ok: boolean; error?: string }>;
        listTrusted(): Promise<TlsPinSummary[]>;
        removeTrust(hostKey: string): Promise<boolean>;
    };
    disconnect(): void;
    joinVoiceChannel(channelId: string): Promise<{ success: boolean; error?: string }>;
    leaveVoiceChannel(): void;
    toggleMute(): boolean;
    toggleDeafen(): { isMuted: boolean; isDeafened: boolean };
    setMuted(muted: boolean): void;
    setVoiceState(isMuted: boolean, isDeafened: boolean): void;
    setScreenShareState(isSharingScreen: boolean, streamName?: string): void;
    setLocalUserVolume(userId: string, percent: number): void;
    setLocalUserMute(userId: string, muted: boolean): void;
    getLocalUserVolume(userId: string): number;
    getLocalUserMute(userId: string): boolean;
    setGlobalVoiceVolume(percent: number): void;
    setMicVolume(percent: number): void;
    setNoiseCancelEnabled(enabled: boolean): Promise<void>;
    setNoiseCancelStrength(level: number): void;
    setSelfHearEnabled(enabled: boolean): void;
    setSelfHearVolume(percent: number): void;
    checkForUpdates(): Promise<{ status: "available" | "not-available" | "error"; message?: string }>;
    downloadUpdate(): Promise<void>;
    quitAndInstall(): void;
    getAppVersion(): Promise<string>;
    fetchReleaseNotes(version: string): Promise<{ name: string; bodyHtml: string; htmlUrl: string; publishedAt?: string } | null>;
    createChannel(
        serverId: string,
        name: string,
        type: "TEXT" | "VOICE",
        parentId?: string | null,
        isNsfw?: boolean,
    ): Promise<{ success: boolean; channelId?: string; error?: string }>;
    updateChannel(
        channelId: string,
        changes: {
            name?: string;
            position?: number;
            isNsfw?: boolean;
            iconEmoji?: string | null;
            iconUrl?: string | null;
            iconPublicId?: string | null;
            iconUploadId?: string;
        },
    ): Promise<{ success: boolean; error?: string }>;
    reorderChannels(
        parentId: string | null,
        orderedChannelIds: string[],
    ): Promise<{ success: boolean; error?: string }>;
    moveChannel(channelId: string, newParentId: string | null): Promise<{ success: boolean; error?: string }>;
    deleteChannel(channelId: string, children?: "keep" | "delete"): Promise<{ success: boolean; error?: string; deletedChannelIds?: string[] }>;
    sendMessage(channelId: string, content: string, attachments?: UploadResult[], replyToId?: string): Promise<{ success: boolean; messageId?: string; error?: string }>;
    deleteMessage(messageId: string): Promise<{ success: boolean; error?: string }>;
    editMessage(messageId: string, content: string): Promise<{ success: boolean; error?: string }>;
    fetchMessages(channelId: string, before?: string, limit?: number, aroundMessageId?: string, after?: string): Promise<{ success: boolean; messages?: ChatMessage[]; pinnedMessage?: PinnedMessage | null; hasMoreBefore?: boolean; hasMoreAfter?: boolean; error?: string }>;
    pinMessage(channelId: string, messageId: string): Promise<{ success: boolean; error?: string }>;
    unpinMessage(channelId: string): Promise<{ success: boolean; error?: string }>;
    markChannelRead(channelId: string): Promise<{ success: boolean }>;
    getAllUsers(serverId: string): Promise<{ success: boolean; users?: any[]; error?: string }>;
    getRoles(serverId: string): Promise<{ success: boolean; roles?: any[]; error?: string }>;
    assignRole(userId: string, roleId: string, action: "add" | "remove"): Promise<{ success: boolean; error?: string }>;
    enumerateAudioDevices(): Promise<{ inputs: { deviceId: string; label: string }[]; outputs: { deviceId: string; label: string }[] }>;
    setAudioInputDevice(deviceId: string | null): void;
    sendDirectMessage(recipientId: string, content: string, attachments?: UploadResult[], replyToId?: string): Promise<{ success: boolean; messageId?: string; error?: string }>;
    deleteDirectMessage(dmId: string): Promise<{ success: boolean; error?: string }>;
    fetchDirectMessages(partnerId: string, before?: string, limit?: number, aroundMessageId?: string, after?: string): Promise<{ success: boolean; messages?: DirectMessage[]; hasMoreBefore?: boolean; hasMoreAfter?: boolean; error?: string }>;
    getOnlineUsers(): Promise<{ success: boolean; users?: { userId: string; nickname: string; isOnline: boolean }[]; error?: string }>;
    markDmsRead(partnerId: string): Promise<{ success: boolean; error?: string }>;
    getUnreadDmPartners(): Promise<{ success: boolean; partners?: { partnerId: string; partnerNickname: string; unreadCount: number }[]; error?: string }>;
    kickUser(userId: string, channelId: string): Promise<{ success: boolean; error?: string }>;
    banUser(
        userId: string,
        addressBan?: "none" | "exact" | "range",
    ): Promise<{ success: boolean; error?: string; warning?: string; addressBanned?: string }>;
    getBannedAddresses(): Promise<{
        success: boolean;
        addresses?: { id: string; cidr: string; nickname: string | null; linkedUserId: string | null; createdAt: string }[];
        error?: string;
    }>;
    unbanAddress(id: string): Promise<{ success: boolean; error?: string }>;
    createInvite(opts: {
        label?: string;
        expiresInHours?: number | null;
        maxUses?: number | null;
    }): Promise<{ success: boolean; code?: string; invite?: InviteRow; error?: string }>;
    getInvites(): Promise<{ success: boolean; invites?: InviteRow[]; error?: string }>;
    revokeInvite(id: string): Promise<{ success: boolean; error?: string }>;
    getPendingApprovals(): Promise<{
        success: boolean;
        requests?: {
            userId: string;
            nickname: string;
            fingerprint: string;
            address: string | null;
            host: string | null;
            requestedAt: string;
            lastSeenAt: string;
            online: boolean;
        }[];
        error?: string;
    }>;
    approveUser(userId: string): Promise<{ success: boolean; error?: string }>;
    rejectUser(
        userId: string,
        opts?: { ban?: boolean; addressBan?: "none" | "exact" | "range" },
    ): Promise<{ success: boolean; error?: string; warning?: string }>;
    unbanUser(userId: string): Promise<{ success: boolean; error?: string }>;
    getBannedUsers(): Promise<{ success: boolean; users?: { userId: string; nickname: string; bannedAt: string; bannedByNickname?: string | null; address?: string | null }[]; error?: string }>;
    probeServerLatency(address: string): Promise<{ ms: number | null }>;
    getWindowProcessNames(ids: string[]): Promise<Record<string, string>>;
    uploadFile(fileBuffer: ArrayBuffer, fileName: string, mimeType: string): Promise<UploadResult>;
    downloadImage(url: string): void;
    setCustomEmojis(list: Array<{ name: string; imageUrl: string }>): void;
    renderMarkdown(text: string): { html: string; block: boolean };
    /** Semver-aware comparison from app-version.ts (PRD 19 R0); null = unparseable. */
    version: { compare(a: string, b: string): number | null };
    avatar: {
        isPlausibleEmail(email: string): boolean;
        selectionFor(provider: "libravatar" | "gravatar", email: string): { provider: "libravatar" | "gravatar"; hash: string };
        previewUrl(selection: { provider: "libravatar" | "gravatar"; hash: string }, fallback: "wavatar" | "404"): string;
        defaultUrl(userId: string): string;
        withSize(url: string, px: number): string;
    };
    setAvatarSelection(selection: { provider: "libravatar" | "gravatar"; hash: string } | null): void;
    getIdentityFingerprint(): Promise<string>;
    identity: {
        getStatus(): Promise<
            | { state: "ok"; storage: "encrypted" | "file" | "ephemeral"; fingerprint: string; canBackup: boolean }
            | { state: "locked"; storage: "encrypted"; canBackup: boolean }
        >;
        exportBackup(passphrase: string): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
        pickBackup(): Promise<{ ok: boolean; token?: string; fileName?: string; canceled?: boolean; error?: string }>;
        decryptBackup(
            token: string,
            passphrase: string,
        ): Promise<{
            ok: boolean;
            error?: string;
            code?: string;
            fingerprint?: string;
            instanceId?: string;
            createdAt?: string;
            currentFingerprint?: string | null;
            currentInstanceId?: string;
        }>;
        applyBackup(token: string): Promise<{ ok: boolean; error?: string }>;
        createNew(): Promise<{ ok: boolean; error?: string }>;
    };
    resetIdentityKey(userId: string): Promise<{ success: boolean; error?: string }>;
    getUserProfile(userId: string): Promise<{
        success: boolean;
        profile?: UserProfile;
        unsupported?: boolean;
        error?: string;
    }>;
    setAvatar(selection: { provider: "libravatar" | "gravatar"; hash: string } | null): Promise<{
        success: boolean;
        avatarUrl?: string | null;
        unsupported?: boolean;
        error?: string;
    }>;
    markdownToPlainText(text: string): string;
    openExternal(url: string): Promise<{ success: boolean; error?: string }>;
    copyText(text: string): Promise<boolean>;
    fetchImageBytes(url: string): Promise<{ success: boolean; bytes?: Uint8Array; error?: string }>;
    copyPngToClipboard(bytes: Uint8Array): Promise<boolean>;
    fetchLinkPreview(url: string): Promise<LinkPreviewData | null>;
    setTrayPrefs(prefs: { minimizeToTray: boolean; closeToTray: boolean }): void;
    getTrayPrefs(): Promise<{ minimizeToTray: boolean; closeToTray: boolean }>;
    isWindowFocused(): Promise<boolean>;
    flashWindow(): void;
    setMicSensitivity(enabled: boolean, threshold: number): void;
    setMicThreshold(threshold: number): void;
    startMicPreview(): Promise<void>;
    stopMicPreview(): void;
    getMicLevel(): number;
    getLatency(): number;
    getClockOffset(): number;
    toggleReaction(messageId: string, emoji: string, isDm: boolean): Promise<{ success: boolean; error?: string }>;
    uploadEmojiFile(fileBuffer: ArrayBuffer, fileName: string, mimeType: string): Promise<UploadResult>;
    uploadAnimatedEmojiFile(fileBuffer: ArrayBuffer, fileName: string, mimeType: string): Promise<UploadResult>;
    uploadChannelIcon(fileBuffer: ArrayBuffer, fileName: string, mimeType: string): Promise<UploadResult>;
    uploadServerIcon(fileBuffer: ArrayBuffer, fileName: string, mimeType: string): Promise<UploadResult>;
    discardUpload(uploadId: string): Promise<{ success: boolean; error?: string }>;
    createCustomEmoji(name: string, image: UploadResult, isAnimated?: boolean): Promise<{ success: boolean; emojiId?: string; error?: string }>;
    getApprovedEmojis(): Promise<{ success: boolean; emojis?: CustomEmoji[]; error?: string }>;
    getPendingEmojis(): Promise<{ success: boolean; emojis?: CustomEmoji[]; error?: string }>;
    reviewCustomEmoji(emojiId: string, decision: "APPROVED" | "REJECTED"): Promise<{ success: boolean; error?: string }>;
    deleteCustomEmoji(emojiId: string): Promise<{ success: boolean; error?: string }>;
    nudgeUser(targetUserId: string): Promise<{ success: boolean; error?: string }>;
    getServerSettings(): Promise<{
        success: boolean;
        nudgeEnabled?: boolean;
        screenShareEnabled?: boolean;
        name?: string;
        maxMessageLength?: number;
        version?: string;
        /** The server icon (PRD 19 A2); null = none, absent = an older server. */
        iconUrl?: string | null;
        /** ADMIN callers only (PRD 18.4). */
        requireSignedIdentity?: boolean;
        requireSignedIdentityLockedByEnv?: boolean;
        unprotectedActiveUsers?: number;
        /** ADMIN callers only (PRD 18.8). */
        requireApproval?: boolean;
        /** ADMIN callers only (PRD 18.9). */
        requireInvite?: boolean;
        /** ADMIN callers only (PRD 18.5). */
        authAllowedHosts?: string[];
        authAllowedHostsLockedByEnv?: boolean;
        observedAuthHosts?: { host: string; joins: number; lastSeen: string | null }[];
        error?: string;
    }>;
    /** null on an error/timeout (a v2.7.0 server doesn't know the event) — PRD 19 A1. */
    getServerSummary(): Promise<ServerSummary | null>;
    /** Median round trip of `samples` pings, or null (PRD 19 C4). */
    measureLatency(samples?: number): Promise<number | null>;
    /** null on an error/timeout (an older server) — PRD 19 A7. */
    getDmDirectory(): Promise<DmDirectoryEntry[] | null>;
    updateServerSettings(
        settings: {
            nudgeEnabled?: boolean;
            screenShareEnabled?: boolean;
            maxMessageLength?: number;
            requireSignedIdentity?: boolean;
            authAllowedHosts?: string[];
            requireApproval?: boolean;
            requireInvite?: boolean;
            /** PRD 19 A2: an upload id sets/replaces the icon, null removes it. */
            iconUploadId?: string | null;
        },
    ): Promise<{ success: boolean; error?: string }>;
    getIdentityEvents(payload: {
        userId?: string;
        before?: string;
        limit?: number;
    }): Promise<{ success: boolean; events?: IdentityLogEvent[]; hasMore?: boolean; error?: string }>;
    getDesktopSources(): Promise<{
        success: boolean;
        sources?: Array<{
            id: string;
            name: string;
            thumbnail: string;
            appIcon: string | null;
            sourceType: "screen" | "window";
        }>;
        error?: string;
    }>;
    resolvePidForWindowSourceId(sourceId: string): Promise<number | undefined>;
    platformSupportsAudioCapture(): Promise<boolean>;
    startAppAudioCapture(
        pid: number | undefined,
        processName: string | undefined,
    ): Promise<{ success: boolean; error?: string }>;
    stopAppAudioCapture(): Promise<void>;
    stopScreenShare(): Promise<void>;
    startScreenShareVideo(chromeMediaSourceId: string): Promise<{ success: boolean; error?: string; errorCode?: "SCREEN_SHARE_LIMIT" }>;
    startScreenShareViaSystemPicker(): Promise<{
        errorCode?: "SCREEN_SHARE_LIMIT";
        success: boolean;
        label?: string;
        sourceType?: "screen" | "window";
        error?: string;
    }>;
    pickAudioAppToShare(): Promise<string | null>;
    openScreenShareViewer(
        targetUserId: string,
        nickname: string,
        channelId: string,
        roomName?: string,
    ): Promise<{ success: boolean; windowId?: number; error?: string }>;
    focusViewerWindow(windowId: number): Promise<boolean>;
    /** The integrated title bar (PRD 19 R7). */
    windowChrome: {
        get(): Promise<{ integrated: boolean; systemTitleBarSaved: boolean; platform: string; maximized: boolean; fullscreen: boolean }>;
        setSystemTitleBar(flag: boolean): Promise<{ saved: boolean; restartNeeded: boolean }>;
        relaunch(): Promise<boolean>;
    };
    closeViewerWindow(windowId: number): Promise<boolean>;
    /** The in-app stream stage (PRD 19 C10): one viewer socket in the preload, video placed into a container by id. */
    stage: {
        watch(targetUserId: string, channelId: string, containerId: string): Promise<{ success: boolean; streamName?: string; error?: string }>;
        stop(targetUserId?: string): Promise<void>;
        isWatching(targetUserId?: string): boolean;
        setVolume(percent: number, targetUserId?: string): void;
        setMuted(muted: boolean, targetUserId?: string): void;
        qualityHeight(targetUserId: string): number | null;
    };
    on(event: string, callback: (...args: any[]) => void): void;
}

const api = (window as any).reson8Api as Reson8Api;

// ── Sound Alerts ──────────────────────────────────────────────────────────

const SoundAlert = {
    _cache: new Map<string, HTMLAudioElement>(),

    _getAudio(filename: string): HTMLAudioElement {
        if (!this._cache.has(filename)) {
            const audio = document.createElement("audio");
            audio.src = `../../assets/sound-alerts/${filename}`;
            audio.preload = "auto";
            this._cache.set(filename, audio);
        }
        return this._cache.get(filename)!;
    },

    play(filename: string): void {
        if (soundAlertsMuted) return;
        const audio = this._getAudio(filename);
        audio.volume = (filename === "nudge.mp3" ? nudgeVolume : alertVolume) / 100;
        audio.currentTime = 0;
        audio.play().catch(() => {}); // Ignore autoplay restrictions
    },
};

// ── State ─────────────────────────────────────────────────────────────────

let isConnected = false;
let currentServerId = "";
let currentChannelId: string | null = null;
let isInVoice = false;
let isMuted = false;
let isDeafened = false;
let pttModeEnabled = localStorage.getItem("reson8-ptt-mode") === "true";

// Attachment state (PRD 16.10): the composer's pending images. Global, not per
// tab — a picked image survives switching tabs, as it always has.
interface PendingAttachment {
    id: string;
    file: File;
    /** Local preview, kept alive for the card and its viewer until the card is removed or the message is sent. */
    objectUrl: string;
    status: "uploading" | "ready" | "failed";
    /** An upload has been started (a queued card is "uploading" but not started yet). */
    started: boolean;
    /** Removed by the user; if its upload is still in flight it is discarded when it resolves. */
    removed?: boolean;
    error?: string;
    /** The server's upload-ledger id (PRD 16.8) — what the server claims on send. */
    uploadId?: string;
    /** Only used as the legacy fallback for a pre-v2.5.0 server that has no upload ids. */
    url?: string;
    publicId?: string;
}
let pendingAttachments: PendingAttachment[] = [];
// Reply mode (PRD 16.11): the message each conversation's draft is answering.
// Keyed by tab id, so a draft reply belongs to the conversation it was started
// in — switching tabs hides the bar, coming back restores it.
const replyTargets = new Map<string, { messageId: string; nickname: string }>();

// Active speakers state
const activeSpeakers = new Set<string>();
const speakerHoldTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Track previous occupants per voice channel for join/leave sound detection
let previousOccupantIds: Set<string> = new Set();
// Track which occupants were sharing their screen, for start/stop sharing
// sound detection (PRD 13.16) — reset alongside previousOccupantIds
// everywhere that gets reset, since both describe the same voice channel.
let previousSharingIds: Set<string> = new Set();
function sharingIdsOf(occupants: { userId: string; isSharingScreen?: boolean }[]): Set<string> {
    return new Set(occupants.filter((o) => o.isSharingScreen).map((o) => o.userId));
}

// Suppress presence-based join/leave sounds after a kick (avoids double sound)
let suppressNextPresenceSound = false;

// Mic sensitivity / noise gate state
let micSensitivityEnabled = localStorage.getItem("reson8-mic-sensitivity-enabled") === "true";
let micLevelAnimId: number | null = null;

// Link preview cache (renderer-side to avoid redundant IPC calls). Bounded and
// expiring (PRD 18.10): a failure is retried after a while, and a signed video
// URL from a link fixer can't outlive its signature. The same rules as main's.
class TtlCache<V> {
    private readonly entries = new Map<string, { value: V; expiresAt: number }>();
    constructor(private readonly max: number) {}

    get(key: string): V | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt <= Date.now()) {
            this.entries.delete(key);
            return undefined;
        }
        this.entries.delete(key);
        this.entries.set(key, entry); // refresh recency
        return entry.value;
    }

    set(key: string, value: V, ttlMs: number): void {
        this.entries.delete(key);
        this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
        while (this.entries.size > this.max) {
            this.entries.delete(this.entries.keys().next().value as string);
        }
    }
}

const LINK_PREVIEW_TTL_MS = { success: 6 * 60 * 60 * 1000, video: 30 * 60 * 1000, failure: 10 * 60 * 1000 };
const linkPreviewCache = new TtlCache<LinkPreviewData | null>(300);

function cacheLinkPreview(url: string, data: LinkPreviewData | null): void {
    const ttl = !data
        ? LINK_PREVIEW_TTL_MS.failure
        : data.video
          ? LINK_PREVIEW_TTL_MS.video
          : LINK_PREVIEW_TTL_MS.success;
    linkPreviewCache.set(url, data, ttl);
}

// Voice session timers: channelId → ISO startedAt
const sessionTimers = new Map<string, string>();

// Text channels with unread messages (PRD 4.13). Seeded from the server's
// per-user hasUnread flag at join time, then kept live client-side: every
// MESSAGE_RECEIVED for a channel that isn't the active tab adds to this set
// (no server round-trip needed, since MESSAGE_RECEIVED already broadcasts
// server-wide regardless of which tabs are open); opening a channel's tab
// clears it and persists the read cursor via MARK_CHANNEL_READ.
//
// PRD 19 B1: counts, not just flags. `-1` = unread with the number unknown
// (an older server only sends `hasUnread`) and is shown as a dot. Counts are
// not decremented when a message is deleted (accepted; the server's own count
// is also taken at join time only).
const unreadChannelCounts = new Map<string, number>();
/** Partner id -> unread DM count, for conversations with messages you haven't actually
 *  seen (PRD 18.13). A DM counts as read only when its tab is active AND the window is
 *  focused. `-1` as above. */
const unreadDmCounts = new Map<string, number>();

/** Unread messages in a channel (0 = read, -1 = unread but unknown). */
function channelUnread(channelId: string): number {
    return unreadChannelCounts.get(channelId) ?? 0;
}
function hasChannelUnread(channelId: string): boolean {
    return unreadChannelCounts.has(channelId);
}
function dmUnread(partnerId: string): number {
    return unreadDmCounts.get(partnerId) ?? 0;
}
function hasDmUnread(partnerId: string): boolean {
    return unreadDmCounts.has(partnerId);
}
/** Adds one to a count map, leaving an unknown (-1) count as it is. */
function bumpCount(map: Map<string, number>, id: string): void {
    const n = map.get(id);
    map.set(id, n === undefined ? 1 : n < 0 ? n : n + 1);
}
/** "•" for unknown, "99+" from 100, else the number. */
function formatUnreadCount(n: number): string {
    return n < 0 ? "\u2022" : n >= 100 ? "99+" : String(n);
}
/** Creates or updates the count pill inside `host` (after the name), or removes it for 0. */
function setUnreadPill(host: Element, n: number, pillClass: string, after: string): void {
    let pill = host.querySelector(`.${pillClass}`) as HTMLElement | null;
    if (n === 0) {
        pill?.remove();
        return;
    }
    if (!pill) {
        pill = document.createElement("span");
        pill.className = `${pillClass} count-pill`; // the shared badge look (PRD 19 F4)
        const anchor = host.querySelector(after);
        if (anchor) anchor.after(pill);
        else host.appendChild(pill);
    }
    pill.textContent = formatUnreadCount(n);
}

// Approved custom server emoji, cached for the picker's "+" tab and for
// resolving :name: tokens in message content / reaction pills. Refreshed on
// (re)connect, updated live via the CUSTOM_EMOJI_APPROVED broadcast.
let customEmojis: CustomEmoji[] = [];

// Nudge (PRD 4.14). Server-wide toggle, refreshed on (re)connect and kept
// live via SERVER_SETTINGS_UPDATED. The cooldown map here is a client-side
// mirror purely for disabling the button / showing a countdown — the server
// enforces the real 30s-per-(sender,target) cooldown authoritatively.
let serverNudgeEnabled = true;
const NUDGE_COOLDOWN_MS = 30 * 1000;
const lastNudgeSentAt = new Map<string, number>();

// Screen Share (PRD 12.9). `serverScreenShareEnabled` mirrors the
// `serverNudgeEnabled` pattern above — refreshed on (re)connect and kept
// live via SERVER_SETTINGS_UPDATED (PRD 12.14). This is a UX convenience
// only (disables the button); the server independently refuses to let
// anyone actually watch a share while the toggle is off.
let serverScreenShareEnabled = true;
let isSharingScreen = false;
/**
 * Admin-configurable cap on a single message's length (Phase 12 sub-phase
 * item 4) — mirrors the `serverNudgeEnabled`/`serverScreenShareEnabled`
 * pattern above: refreshed on (re)connect, kept live via
 * SERVER_SETTINGS_UPDATED. Applied to `chatInput.maxLength` as a UX
 * convenience only; the server independently enforces the real limit on
 * SEND_MESSAGE/EDIT_MESSAGE/SEND_DIRECT_MESSAGE regardless of what this
 * client sends.
 */
let serverMaxMessageLength = 4000;
/** The connect being shown on the welcome screen (PRD 19 R1); declared early because log() reads it. */
let connectFlow: ConnectFlow | null = null;
/** The currently-connected server's display name, once fetched via getServerSettings() — null until then / after disconnect. */
let connectedServerName: string | null = null;
let connectedNickname = "";

// ── Own permissions (PRD 19 A8) ──────────────────────────────────────────
/**
 * Mirrors PermissionFlags in packages/shared-types/src/models.ts (the renderer
 * is a classic script and cannot import it). Keep the numbers in step.
 */
const PERM = {
    CONNECT: 1n,
    SPEAK: 2n,
    SEND_MESSAGES: 4n,
    CREATE_CHANNEL: 8n,
    MANAGE_CHANNELS: 16n,
    MANAGE_ROLES: 32n,
    KICK_USER: 64n,
    BAN_USER: 128n,
    ADMIN: 256n,
    MANAGE_EMOJIS: 512n,
} as const;

/** The user's aggregated permissions on the connected server; null = unknown (an older server, or not connected). */
let myPermissions: bigint | null = null;

function setMyPermissions(value: string | undefined): void {
    try {
        myPermissions = typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : null;
    } catch {
        myPermissions = null;
    }
}

/**
 * Whether the user holds `flag` (ADMIN holds everything). `null` while the
 * permissions are unknown — callers must treat that as "don't hide anything
 * based on this" (the server still decides).
 */
function hasPerm(flag: bigint): boolean | null {
    if (myPermissions === null) return null;
    return (myPermissions & PERM.ADMIN) !== 0n || (myPermissions & flag) !== 0n;
}

// ── Server summary (PRD 19 A1) ───────────────────────────────────────────
// Member-visible server facts for the header and About. Null until fetched,
// after disconnect, and on a v2.7.0 server (which has no GET_SERVER_SUMMARY).
let serverSummary: ServerSummary | null = null;
/** Online count from the last GET_ONLINE_USERS read — the old-server fallback for getOnlineCountForDisplay(). */
let lastOnlineUsersCount: number | null = null;
let serverSummaryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The ONE online count the header and About both show: the summary's
 * (members with access only) or, on an old server, the online entries of the
 * last user list. 0 until either has arrived.
 */
function getOnlineCountForDisplay(): number {
    if (serverSummary) return serverSummary.onlineCount;
    return lastOnlineUsersCount ?? 0;
}

/** Re-reads the summary, coalescing bursts (joins/leaves/settings) into one request 2 s after the last trigger. */
function refreshServerSummary(): void {
    if (serverSummaryTimer) clearTimeout(serverSummaryTimer);
    serverSummaryTimer = setTimeout(async () => {
        serverSummaryTimer = null;
        if (!isConnected) return;
        const serverIdAtRequest = currentServerId;
        const summary = await api.getServerSummary();
        // A disconnect or a switch to another server while the request was in
        // flight must not leave the old server's facts behind.
        if (!isConnected || currentServerId !== serverIdAtRequest) return;
        serverSummary = summary;
        renderServerHeader(); // PRD 19 C3: the online count and the icon
        renderServerIconRow(); // PRD 19 C5
        if (aboutModal.classList.contains("visible")) renderAboutServer(); // PRD 19 C4: stays live while open
    }, 2000);
}

/** Forgets the summary and any pending refresh (disconnect). */
function clearServerSummary(): void {
    if (serverSummaryTimer) clearTimeout(serverSummaryTimer);
    serverSummaryTimer = null;
    serverSummary = null;
    lastOnlineUsersCount = null;
}

/**
 * Composes the OS window title bar text — "Reson8" (or "Reson8 -
 * [ServerName]" once known) with a 🔴 prefix while actively screen
 * sharing. The two concerns (server name, live-sharing indicator) update
 * independently and at different times, so this is the single place that
 * combines them rather than each call site clobbering the other's part of
 * the string.
 */
function updateWindowTitle(): void {
    try {
        renderServerPill(); // PRD 19 C2: the title-bar pill follows the same inputs
        renderServerHeader(); // PRD 19 C3
    } catch {
        /* called before the saved-servers state exists (script start-up) */
    }
    const base = connectedServerName ? `Reson8 - ${connectedServerName}` : "Reson8";
    document.title = isSharingScreen ? `🔴 ${base}` : base;
}

function formatDuration(ms: number): string {
    // Defense in depth against residual clock skew (the offset applied by
    // callers is a single round-trip estimate, not a full NTP sync) — a
    // session timer should never visibly count from a negative number
    // (PRD 11.2).
    const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Current time corrected for client↔server clock skew (PRD 11.2) — use
 *  this instead of a raw Date.now() whenever diffing against a
 *  server-issued timestamp like sessionStartedAt. */
function correctedNow(): number {
    return Date.now() + api.getClockOffset();
}

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
const chatComposer = document.getElementById("chat-composer") as HTMLDivElement;
const replyBar = document.getElementById("reply-bar") as HTMLDivElement;
const replyBarNick = document.getElementById("reply-bar-nick") as HTMLElement;
const btnReplyCancel = document.getElementById("btn-reply-cancel") as HTMLButtonElement;
const rightPane = document.getElementById("right-pane") as HTMLDivElement;
const chatDropOverlay = document.getElementById("chat-drop-overlay") as HTMLDivElement;
const chatInput = document.getElementById("chat-input") as HTMLTextAreaElement;

// Emoji autocomplete (PRD 16.7). Declared up here, not beside its logic: it
// is closed from switchTab()/sendChatMessage(), which can run before the
// section further down has been evaluated.
const emojiAutocompleteEl = document.getElementById("emoji-autocomplete") as HTMLDivElement;
const emojiAcHeader = document.getElementById("emoji-ac-header") as HTMLDivElement;
const emojiAcList = document.getElementById("emoji-ac-list") as HTMLDivElement;
interface EmojiAcItem {
    /** What gets inserted: the emoji character, or `:name:` for a custom emoji. */
    insert: string;
    /** Shown to the right: always `:name:`. */
    label: string;
    emoji?: string;
    imageUrl?: string;
}
let emojiAcOpen = false;
let emojiAcItems: EmojiAcItem[] = [];
let emojiAcActive = 0;
let emojiAcColonIndex = 0; // index of the ":" that opened the card
let emojiAcQuery = "";
/** The textarea the card currently serves — the composer, or a message's
 *  edit box (PRD 17.11). Set when an attached textarea gains focus. */
let emojiAcTarget: HTMLTextAreaElement | null = null;
/** What to run after an insertion in the current target (the composer
 *  re-sizes itself; the edit box needs nothing). */
let emojiAcAfterInsert: (() => void) | null = null;
const btnSend = document.getElementById("btn-send") as HTMLButtonElement;
const btnAttach = document.getElementById("btn-attach") as HTMLButtonElement;
const btnEmoji = document.getElementById("btn-emoji") as HTMLButtonElement;
const emojiPicker = document.getElementById("emoji-picker") as HTMLDivElement;
const emojiSearch = document.getElementById("emoji-search") as HTMLInputElement;
const emojiCategoryTabs = document.getElementById("emoji-category-tabs") as HTMLDivElement;
const emojiTabsBar = document.getElementById("emoji-tabs-bar") as HTMLDivElement;
const emojiCustomTabSlot = document.getElementById("emoji-custom-tab-slot") as HTMLDivElement;
const emojiGridContainer = document.getElementById("emoji-grid-container") as HTMLDivElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const attachmentTray = document.getElementById("attachment-tray") as HTMLDivElement;
const imageLightboxModal = document.getElementById("image-lightbox-modal") as HTMLDivElement;
const lightboxImage = document.getElementById("lightbox-image") as HTMLImageElement;
const btnLightboxDownload = document.getElementById("btn-lightbox-download") as HTMLButtonElement;
const btnLightboxClose = document.getElementById("btn-lightbox-close") as HTMLButtonElement;

const voicePanel = document.getElementById("voice-panel") as HTMLDivElement;
const voiceChannelName = document.getElementById("voice-channel-name") as HTMLSpanElement;
const voiceDockLatency = document.getElementById("voice-dock-latency") as HTMLSpanElement;
const btnInputDevices = document.getElementById("btn-input-devices") as HTMLButtonElement;
const btnOutputDevices = document.getElementById("btn-output-devices") as HTMLButtonElement;
const btnMute = document.getElementById("btn-mute") as HTMLButtonElement;
const btnDeafen = document.getElementById("btn-deafen") as HTMLButtonElement;
const btnShareScreen = document.getElementById("btn-share-screen") as HTMLButtonElement;
const btnLeaveVoice = document.getElementById("btn-leave-voice") as HTMLButtonElement;
const screenShareAlertBanner = document.getElementById("screen-share-alert-banner") as HTMLDivElement;
const btnStopShareAlert = document.getElementById("btn-stop-share-alert") as HTMLButtonElement;

const statusDot = document.getElementById("status-dot") as HTMLSpanElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const statusLatency = document.getElementById("status-latency") as HTMLSpanElement;
const statusInstance = document.getElementById("status-instance") as HTMLSpanElement;
const btnCopyId = document.getElementById("btn-copy-id") as HTMLButtonElement;

// Show instance ID immediately on page load
setTimeout(() => {
    const id = api.getInstanceId();
    if (id) statusInstance.textContent = `ID: ${id}`;
}, 100);

// ── Remember Me: auto-populate saved server info ──────────────────────────
// Saved servers replace the single remembered server (PRD 19 C1): see the "Saved servers" section.


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
const deleteChannelTailEl = document.getElementById("delete-channel-tail") as HTMLElement;
const deleteChannelAffectedEl = document.getElementById("delete-channel-affected") as HTMLElement;
const btnDeleteCancel = document.getElementById("btn-delete-cancel") as HTMLButtonElement;
const btnDeleteConfirm = document.getElementById("btn-delete-confirm") as HTMLButtonElement;

// Admin modal
const btnServerSettings = document.getElementById("btn-server-settings") as HTMLButtonElement;
const adminModal = document.getElementById("admin-modal") as HTMLDivElement;
const adminUserList = document.getElementById("admin-user-list") as HTMLDivElement;
const btnAdminClose = document.getElementById("btn-admin-close") as HTMLButtonElement;
const settingsTabRoles = document.getElementById("settings-tab-roles") as HTMLButtonElement;
const settingsTabEmojis = document.getElementById("settings-tab-emojis") as HTMLButtonElement;
const emojiPendingList = document.getElementById("emoji-pending-list") as HTMLDivElement;
const settingsTabServer = document.getElementById("settings-tab-server") as HTMLButtonElement;
const chkNudgeEnabled = document.getElementById("chk-nudge-enabled") as HTMLInputElement;
const chkScreenShareEnabled = document.getElementById("chk-screen-share-enabled") as HTMLInputElement;
const inputMaxMessageLength = document.getElementById("input-max-message-length") as HTMLInputElement;
const btnSaveMaxMessageLength = document.getElementById("btn-save-max-message-length") as HTMLButtonElement;

// About tab (PRD 10.1)
const aboutVersion = document.getElementById("about-version") as HTMLDivElement;
const btnCheckUpdates = document.getElementById("btn-check-updates") as HTMLButtonElement;
const updateRowTitle = document.getElementById("update-row-title") as HTMLElement;
const updateRowNew = document.getElementById("update-row-new") as HTMLElement;
const updateRowNote = document.getElementById("update-row-note") as HTMLElement;
const updateRowBar = document.getElementById("update-row-bar") as HTMLElement;
const updateRowBarFill = document.getElementById("update-row-bar-fill") as HTMLElement;
const updateRowIcon = document.getElementById("update-row-icon") as HTMLElement;
const btnUpdateRowNotes = document.getElementById("btn-update-row-notes") as HTMLButtonElement;

// Update modal (PRD 10.1)
const updateCard = document.getElementById("update-card") as HTMLDivElement;
const updateCardTitle = document.getElementById("update-card-title") as HTMLDivElement;
const updateCardNote = document.getElementById("update-card-note") as HTMLDivElement;
const updateCardBarFill = document.getElementById("update-card-bar-fill") as HTMLDivElement;
const updateCardPct = document.getElementById("update-card-pct") as HTMLSpanElement;
const updateCardError = document.getElementById("update-card-error") as HTMLDivElement;
const updateCardCall = document.getElementById("update-card-call") as HTMLDivElement;
const updateCardRoom = document.getElementById("update-card-room") as HTMLElement;
const btnUpdateNow = document.getElementById("btn-update-now") as HTMLButtonElement;
const btnUpdateLater = document.getElementById("btn-update-later") as HTMLButtonElement;
const btnUpdateNotes = document.getElementById("btn-update-notes") as HTMLButtonElement;
const btnUpdateNext = document.getElementById("btn-update-next") as HTMLButtonElement;
const btnUpdateRestart = document.getElementById("btn-update-restart") as HTMLButtonElement;
const btnUpdateHide = document.getElementById("btn-update-hide") as HTMLButtonElement;
const btnUpdateClose = document.getElementById("btn-update-close") as HTMLButtonElement;
/** Set by the update section below; called when the voice state changes (declared here so an early call is safe). */
let updateCardVoiceHook: (() => void) | null = null;

const whatsNewModal = document.getElementById("whats-new-modal") as HTMLDivElement;
const whatsNewTitle = document.getElementById("whats-new-title") as HTMLHeadingElement;
const whatsNewBody = document.getElementById("whats-new-body") as HTMLDivElement;
const whatsNewKicker = document.getElementById("whats-new-kicker") as HTMLElement;
const whatsNewDate = document.getElementById("whats-new-date") as HTMLElement;
const whatsNewFootNote = document.getElementById("whats-new-foot-note") as HTMLElement;
const btnWhatsNewGithub = document.getElementById("btn-whats-new-github") as HTMLButtonElement;
const btnWhatsNewDismiss = document.getElementById("btn-whats-new-dismiss") as HTMLButtonElement;

const versionMismatchModal = document.getElementById("version-mismatch-modal") as HTMLDivElement;
const versionMismatchMessage = document.getElementById("version-mismatch-message") as HTMLParagraphElement;
const btnVersionMismatchDismiss = document.getElementById("btn-version-mismatch-dismiss") as HTMLButtonElement;
const btnVersionMismatchReleases = document.getElementById("btn-version-mismatch-releases") as HTMLButtonElement;

// Audio device selects (inside settings modal voice tab)
const audioInputSelect = document.getElementById("audio-input-select") as HTMLSelectElement;
const audioOutputSelect = document.getElementById("audio-output-select") as HTMLSelectElement;
const btnSaveDevices = document.getElementById("btn-save-devices") as HTMLButtonElement;

// Online Users modal
const toastContainer = document.getElementById("toast-container") as HTMLDivElement;

// System tray checkboxes
const chkMinimizeToTray = document.getElementById("chk-minimize-to-tray") as HTMLInputElement;
const chkCloseToTray = document.getElementById("chk-close-to-tray") as HTMLInputElement;

// Sound alerts mute checkbox
const chkMuteAlerts = document.getElementById("chk-mute-alerts") as HTMLInputElement;
let soundAlertsMuted = localStorage.getItem("reson8-mute-alerts") === "true";

// Audio tab volume sliders (PRD 10.2) — nudge / general alerts / voice chat,
// each 0-100%, client-local via localStorage.
let nudgeVolume = Number(localStorage.getItem("reson8-nudge-volume") ?? "100");
let alertVolume = Number(localStorage.getItem("reson8-alert-volume") ?? "100");
let voiceVolume = Number(localStorage.getItem("reson8-voice-volume") ?? "100");
// Mic input volume (PRD 13.3; 0-300% since PRD 17.4) — scales the outgoing
// mic signal itself (not local playback), lives in the Voice & Shortcuts tab
// alongside the noise gate rather than the Audio tab's other volume sliders.
// Clamped on load so a corrupt stored value can't become a NaN gain.
const MIC_VOLUME_MAX_PERCENT = 300;
let micVolume = (() => {
    const stored = Number(localStorage.getItem("reson8-mic-volume") ?? "100");
    return Number.isFinite(stored) ? Math.max(0, Math.min(MIC_VOLUME_MAX_PERCENT, stored)) : 100;
})();
// AI noise cancelling (PRD 13.1) — off by default (a real CPU/latency cost),
// persisted like the noise gate's own enabled flag.
let noiseCancelEnabled = localStorage.getItem("reson8-noise-cancel-enabled") === "true";
// Noise cancelling strength (PRD 14.12) — 0-100, was hardcoded to 100 (max)
// which caused a quiet/paused voice to fade toward silence; 60 is a more
// moderate default.
let noiseCancelStrength = Number(localStorage.getItem("reson8-noise-cancel-strength") ?? "60");
// Self-hear mic monitor (PRD 14.10) — deliberately NOT persisted across
// restarts like the other voice settings above; this is a momentary
// tuning/preview aid, not a standing preference, so it always starts off.
// The playback volume is a genuine preference though, so that alone persists.
let selfHearEnabled = false;
let selfHearVolume = Number(localStorage.getItem("reson8-self-hear-volume") ?? "100");
/** True only when enabling self-hear had to deafen (it wasn't already
 *  deafened going in) — so disabling it later undoes only what it itself
 *  forced, mirroring `_deafenAutoMuted`'s own remember/restore pattern. */
let selfHearForcedDeafen = false;
const audioNudgeVolumeSlider = document.getElementById("audio-nudge-volume-slider") as HTMLInputElement;
const audioNudgeVolumeValue = document.getElementById("audio-nudge-volume-value") as HTMLSpanElement;
const audioAlertVolumeSlider = document.getElementById("audio-alert-volume-slider") as HTMLInputElement;
const audioAlertVolumeValue = document.getElementById("audio-alert-volume-value") as HTMLSpanElement;
const audioVoiceVolumeSlider = document.getElementById("audio-voice-volume-slider") as HTMLInputElement;
const audioVoiceVolumeValue = document.getElementById("audio-voice-volume-value") as HTMLSpanElement;

// Apply the saved global voice volume before the user ever joins a channel.
api.setGlobalVoiceVolume(voiceVolume);

// Mic sensitivity DOM refs
const chkMicSensitivity = document.getElementById("chk-mic-sensitivity") as HTMLInputElement;
const micSensitivitySlider = document.getElementById("mic-sensitivity-slider") as HTMLInputElement;
const micSensitivityValue = document.getElementById("mic-sensitivity-value") as HTMLSpanElement;
const micLevelBar = document.getElementById("mic-level-bar") as HTMLDivElement;
const micSensitivitySection = document.getElementById("mic-sensitivity-section") as HTMLDivElement;
const micVolumeSlider = document.getElementById("mic-volume-slider") as HTMLInputElement;
const micVolumeValue = document.getElementById("mic-volume-value") as HTMLSpanElement;
const chkNoiseCancel = document.getElementById("chk-noise-cancel") as HTMLInputElement;
const noiseCancelStrengthSlider = document.getElementById("noise-cancel-strength-slider") as HTMLInputElement;
const noiseCancelStrengthValue = document.getElementById("noise-cancel-strength-value") as HTMLSpanElement;
const chkSelfHear = document.getElementById("chk-self-hear") as HTMLInputElement;
const selfHearVolumeSlider = document.getElementById("self-hear-volume-slider") as HTMLInputElement;
const selfHearVolumeValue = document.getElementById("self-hear-volume-value") as HTMLSpanElement;
const selfHearBanner = document.getElementById("self-hear-banner") as HTMLDivElement;
const btnStopSelfHear = document.getElementById("btn-stop-self-hear") as HTMLButtonElement;

// Apply the saved mic volume before the user ever joins a channel (mirrors
// setGlobalVoiceVolume above — a no-op until a VoiceService instance
// exists, but consistent with that precedent; the value is re-applied
// after each join below since joinVoiceChannel() constructs a fresh
// VoiceService instance per session).
api.setMicVolume(micVolume);

// State for pending delete
let pendingDeleteChannelId: string | null = null;

// ── Rename Channel Modal (PRD 4.5) ──────────────────────────────────────────
const renameChannelModal = document.getElementById("rename-channel-modal") as HTMLDivElement;
const renameChannelInput = document.getElementById("rename-channel-input") as HTMLInputElement;
const btnRenameCancel = document.getElementById("btn-rename-cancel") as HTMLButtonElement;
const btnRenameConfirm = document.getElementById("btn-rename-confirm") as HTMLButtonElement;
let pendingRenameChannelId: string | null = null;

// ── Move Channel Modal (PRD 14.5) ───────────────────────────────────────────
const moveChannelModal = document.getElementById("move-channel-modal") as HTMLDivElement;
const moveChannelSelect = document.getElementById("move-channel-select") as HTMLSelectElement;
const btnMoveCancel = document.getElementById("btn-move-cancel") as HTMLButtonElement;
const btnMoveConfirm = document.getElementById("btn-move-confirm") as HTMLButtonElement;
let pendingMoveChannelId: string | null = null;

// ── NSFW Channel Confirmation Modal (PRD 4.7) ───────────────────────────────
const nsfwConfirmModal = document.getElementById("nsfw-confirm-modal") as HTMLDivElement;
const nsfwConfirmChannelName = document.getElementById("nsfw-confirm-channel-name") as HTMLElement;
const btnNsfwCancel = document.getElementById("btn-nsfw-cancel") as HTMLButtonElement;
const btnNsfwConfirm = document.getElementById("btn-nsfw-confirm") as HTMLButtonElement;
const chkNsfwDontWarn = document.getElementById("chk-nsfw-dont-warn") as HTMLInputElement;
const chkNsfwWarn = document.getElementById("chk-nsfw-warn") as HTMLInputElement;
const chkNsfwBlur = document.getElementById("chk-nsfw-blur") as HTMLInputElement;
let pendingNsfwChannel: TreeNode | null = null;

// "Don't warn me again" (PRD 16.1): one global per-install preference, stored
// under a reson8-* key like every other client preference. Anything other
// than an explicit "true" dismissal means warn — the safe default, also used
// when storage is unavailable.
const NSFW_WARNING_DISMISSED_KEY = "reson8-nsfw-warning-dismissed";

function isNsfwWarningEnabled(): boolean {
    try {
        return localStorage.getItem(NSFW_WARNING_DISMISSED_KEY) !== "true";
    } catch {
        return true;
    }
}

function setNsfwWarningEnabled(enabled: boolean): void {
    try {
        if (enabled) localStorage.removeItem(NSFW_WARNING_DISMISSED_KEY);
        else localStorage.setItem(NSFW_WARNING_DISMISSED_KEY, "true");
    } catch {
        /* storage unavailable — the preference just won't persist */
    }
}

// "Blur images in NSFW channels" (PRD 16.2): per-user, on by default. Only an
// explicit "false" turns it off; also falls back to on if storage is unavailable.
const NSFW_BLUR_KEY = "reson8-nsfw-blur-images";

function isNsfwBlurEnabled(): boolean {
    try {
        return localStorage.getItem(NSFW_BLUR_KEY) !== "false";
    } catch {
        return true;
    }
}

function setNsfwBlurEnabled(enabled: boolean): void {
    try {
        localStorage.setItem(NSFW_BLUR_KEY, String(enabled));
    } catch {
        /* storage unavailable — the preference just won't persist */
    }
    applyNsfwBlurPreference();
}

/** Pure CSS switch — see `body.nsfw-blur-off` in index.html. Applies live to every rendered message. */
function applyNsfwBlurPreference(): void {
    document.body.classList.toggle("nsfw-blur-off", !isNsfwBlurEnabled());
}

// ── "Show link previews" (PRD 18.10) ────────────────────────────────────────
// Per-user, on by default; only an explicit "false" turns it off. Off means NO
// request is made at all — each preview makes this computer contact the linked
// website, which can see its IP address.
const LINK_PREVIEWS_KEY = "reson8-link-previews";

function isLinkPreviewsEnabled(): boolean {
    try {
        return localStorage.getItem(LINK_PREVIEWS_KEY) !== "false";
    } catch {
        return true;
    }
}

function setLinkPreviewsEnabled(enabled: boolean): void {
    try {
        localStorage.setItem(LINK_PREVIEWS_KEY, String(enabled));
    } catch {
        /* storage unavailable — the preference just won't persist */
    }
    applyLinkPreviewPreference();
}

/** Hides cards already rendered, live — see `body.link-previews-off` in index.html. */
function applyLinkPreviewPreference(): void {
    document.body.classList.toggle("link-previews-off", !isLinkPreviewsEnabled());
}

// ── Blur link previews (PRD 18.11) ──────────────────────────────────────────
// Two independent per-user switches, both on by default (only "false" turns
// one off): previews in NSFW channels, and previews the SITE marks as adult
// (in any channel and in DMs). Pure CSS on body classes, so they apply live.
const LP_NSFW_BLUR_KEY = "reson8-lp-nsfw-blur";
const LP_ADULT_BLUR_KEY = "reson8-lp-adult-blur";

function readBoolPref(key: string): boolean {
    try {
        return localStorage.getItem(key) !== "false";
    } catch {
        return true;
    }
}

function writeBoolPref(key: string, value: boolean): void {
    try {
        localStorage.setItem(key, String(value));
    } catch {
        /* storage unavailable — the preference just won't persist */
    }
}

function applyLinkPreviewBlurPreferences(): void {
    document.body.classList.toggle("lp-nsfw-blur-off", !readBoolPref(LP_NSFW_BLUR_KEY));
    document.body.classList.toggle("lp-adult-blur-off", !readBoolPref(LP_ADULT_BLUR_KEY));
}

/** Marks a channel tab as NSFW from the CURRENT tree, so a flag change updates open previews live. */
function syncTabNsfwClass(channelId: string): void {
    const tab = chatTabs.get(channelId);
    if (!tab) return;
    const node = findChannelNodeById(currentTree as TreeNode[], channelId);
    tab.contentEl.classList.toggle("tab-nsfw", !!node?.isNsfw);
}

// ── Avatars (PRD 17.1) ──────────────────────────────────────────────────────
// A user's avatar is a Libravatar/Gravatar URL the SERVER built from the
// { provider, hash } the user chose; users without one get a generated
// Libravatar "wavatar" keyed by sha256(userId). Every avatar on screen is one
// `.avatar` element carrying `data-avatar-user-id`, so a change (or the
// external-avatars switch) is re-applied with refreshAvatars().

type AvatarProvider = "libravatar" | "gravatar";
interface AvatarSelection {
    provider: AvatarProvider;
    hash: string;
}

const AVATAR_PROVIDER_KEY = "reson8-avatar-provider";
const AVATAR_EMAIL_KEY = "reson8-avatar-email";
const AVATARS_EXTERNAL_KEY = "reson8-avatars-external";

function readAvatarPrefs(): { provider: AvatarProvider; email: string } {
    try {
        const provider = localStorage.getItem(AVATAR_PROVIDER_KEY) === "gravatar" ? "gravatar" : "libravatar";
        return { provider, email: localStorage.getItem(AVATAR_EMAIL_KEY) ?? "" };
    } catch {
        return { provider: "libravatar", email: "" };
    }
}

function writeAvatarPrefs(provider: AvatarProvider, email: string): void {
    try {
        localStorage.setItem(AVATAR_PROVIDER_KEY, provider);
        if (email) localStorage.setItem(AVATAR_EMAIL_KEY, email);
        else localStorage.removeItem(AVATAR_EMAIL_KEY);
    } catch {
        /* storage unavailable — the preference just won't persist */
    }
}

/** What the server is told: `null` (default avatar) unless a usable email is saved. */
function currentAvatarSelection(): AvatarSelection | null {
    const { provider, email } = readAvatarPrefs();
    return email && api.avatar.isPlausibleEmail(email) ? api.avatar.selectionFor(provider, email) : null;
}

/** "Load avatars from Libravatar/Gravatar" — on unless explicitly "false". */
function areExternalAvatarsEnabled(): boolean {
    try {
        return localStorage.getItem(AVATARS_EXTERNAL_KEY) !== "false";
    } catch {
        return true;
    }
}

function setExternalAvatarsEnabled(enabled: boolean): void {
    try {
        if (enabled) localStorage.removeItem(AVATARS_EXTERNAL_KEY);
        else localStorage.setItem(AVATARS_EXTERNAL_KEY, "false");
    } catch {
        /* storage unavailable — the preference just won't persist */
    }
    refreshAvatars();
}

/** userId → the avatar URL the server stored (`null` = default avatar). Absent = not known yet. */
const avatarUrlCache = new Map<string, string | null>();

/** Records a DTO's avatar URL; `undefined` (an older server) leaves the cache alone. */
function rememberAvatarUrl(userId: string, avatarUrl: string | null | undefined): void {
    if (avatarUrl !== undefined) avatarUrlCache.set(userId, avatarUrl);
}

/** Up to two letters from the nickname's words — code points, so an emoji is never split. */
function avatarInitials(nickname: string): string {
    const words = nickname.trim().split(/\s+/).filter(Boolean);
    const letters = words.length > 1
        ? [Array.from(words[0])[0], Array.from(words[words.length - 1])[0]]
        : Array.from(words[0] ?? "").slice(0, 1);
    return letters.join("").toUpperCase() || "?";
}

/** A stable background per user (same color on every client), dark enough for white text. */
function avatarColor(userId: string): string {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
    return `hsl(${Math.abs(hash) % 360} 45% 38%)`;
}

/** The URLs to try, in order, for a user's avatar at a CSS size. */
function avatarCandidates(userId: string, cssPx: number): string[] {
    const px = cssPx * 2; // HiDPI
    const stored = avatarUrlCache.get(userId);
    const fallback = api.avatar.withSize(api.avatar.defaultUrl(userId), px);
    return stored ? [api.avatar.withSize(stored, px), fallback] : [fallback];
}

/**
 * (Re)fills an `.avatar` element: initials always sit underneath, and an image
 * fades in over them once it loads. On an error it tries the next candidate;
 * when none is left the initials simply stay — never a broken-image icon.
 * `candidates` overrides the cache (the Settings preview).
 */
function applyAvatar(el: HTMLElement, candidates?: string[]): void {
    const userId = el.dataset.avatarUserId ?? "";
    const nickname = el.dataset.avatarNick ?? "";
    const cssPx = Number(el.dataset.avatarPx) || 40;
    el.style.setProperty("--avatar-bg", avatarColor(userId));

    const initials = document.createElement("span");
    initials.className = "avatar-initials";
    initials.textContent = avatarInitials(nickname);
    el.replaceChildren(initials);

    if (!areExternalAvatarsEnabled()) return;

    const urls = candidates ?? avatarCandidates(userId, cssPx);
    if (urls.length === 0) return;

    const img = document.createElement("img");
    img.width = cssPx;
    img.height = cssPx;
    img.alt = "";
    img.decoding = "async";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.draggable = false;
    let index = 0;
    img.addEventListener("load", () => img.classList.add("loaded"));
    img.addEventListener("error", () => {
        index++;
        if (index < urls.length) img.src = urls[index];
        else img.remove();
    });
    img.src = urls[0];
    el.appendChild(img);
}

/** A new avatar element for a user, sized in CSS pixels. */
function createAvatarElement(userId: string, nickname: string, cssPx: number): HTMLSpanElement {
    const el = document.createElement("span");
    el.className = "avatar";
    el.dataset.avatarUserId = userId;
    el.dataset.avatarNick = nickname;
    el.dataset.avatarPx = String(cssPx);
    el.style.width = `${cssPx}px`;
    el.style.height = `${cssPx}px`;
    el.style.fontSize = `${Math.round(cssPx * 0.38)}px`;
    applyAvatar(el);
    return el;
}

/** Re-applies every rendered avatar (of one user, or all of them). */
function refreshAvatars(userId?: string): void {
    document.querySelectorAll<HTMLElement>(".avatar[data-avatar-user-id]").forEach((el) => {
        if (el.dataset.avatarPreview) return; // the Settings preview manages itself
        if (userId === undefined || el.dataset.avatarUserId === userId) applyAvatar(el);
    });
}

// ── Pin-Replace Confirmation Modal (PRD 11.5) ───────────────────────────────
const pinReplaceConfirmModal = document.getElementById("pin-replace-confirm-modal") as HTMLDivElement;
const btnPinReplaceCancel = document.getElementById("btn-pin-replace-cancel") as HTMLButtonElement;
const btnPinReplaceConfirm = document.getElementById("btn-pin-replace-confirm") as HTMLButtonElement;

// ── Screen Share Selection Modal (PRD 12.10) ────────────────────────────────
const screenShareModal = document.getElementById("screen-share-modal") as HTMLDivElement;
const sourceShareGroups = document.getElementById("source-share-groups") as HTMLDivElement;
const sourceShareAudioCheckbox = document.getElementById("source-share-audio-checkbox") as HTMLInputElement;
const sourceShareAudioDesc = document.getElementById("source-share-audio-desc") as HTMLSpanElement;
const btnScreenShareCancel = document.getElementById("btn-screen-share-cancel") as HTMLButtonElement;
const btnScreenShareStart = document.getElementById("btn-screen-share-start") as HTMLButtonElement;
const sourceShareNameInput = document.getElementById("source-share-name-input") as HTMLInputElement;

// ── Screen Share Custom Name Modal (Linux/Wayland bypass) ───────────────────
const streamNameModal = document.getElementById("stream-name-modal") as HTMLDivElement;
const streamNameInput = document.getElementById("stream-name-input") as HTMLInputElement;
const btnStreamNameCancel = document.getElementById("btn-stream-name-cancel") as HTMLButtonElement;
const btnStreamNameConfirm = document.getElementById("btn-stream-name-confirm") as HTMLButtonElement;

type DesktopSource = {
    id: string;
    name: string;
    thumbnail: string;
    appIcon: string | null;
    sourceType: "screen" | "window";
};
let selectedShareSource: DesktopSource | null = null;
let shareSources: DesktopSource[] = [];
let shareTab: "screen" | "window" = "screen";
let shareProcessNames: Record<string, string> = {};

// ── Watch Screen Share Confirmation Modal (PRD 12.13) ───────────────────────
const watchShareConfirmModal = document.getElementById("watch-share-confirm-modal") as HTMLDivElement;
const watchShareConfirmNickname = document.getElementById("watch-share-confirm-nickname") as HTMLElement;
const btnWatchShareCancel = document.getElementById("btn-watch-share-cancel") as HTMLButtonElement;
const btnWatchShareConfirm = document.getElementById("btn-watch-share-confirm") as HTMLButtonElement;
let pendingWatchShare: { userId: string; nickname: string; channelId: string } | null = null;

const newChannelNsfwRow = document.getElementById("new-channel-nsfw-row") as HTMLDivElement;
const newChannelNsfw = document.getElementById("new-channel-nsfw") as HTMLInputElement;

// ── Delete Message Confirmation Modal (PRD 4.10) ────────────────────────────
const deleteMessageModal = document.getElementById("delete-message-modal") as HTMLDivElement;
const btnDeleteMessageCancel = document.getElementById("btn-delete-message-cancel") as HTMLButtonElement;
const btnDeleteMessageConfirm = document.getElementById("btn-delete-message-confirm") as HTMLButtonElement;
let pendingDeleteMessage: { msgId: string; isDm: boolean } | null = null;

// ── Custom Emoji Upload / Crop Modal (PRD 4.8) ──────────────────────────────
const emojiUploadModal = document.getElementById("emoji-upload-modal") as HTMLDivElement;
const emojiUploadStepSelect = document.getElementById("emoji-upload-step-select") as HTMLDivElement;
const emojiUploadStepCrop = document.getElementById("emoji-upload-step-crop") as HTMLDivElement;
const emojiFileInput = document.getElementById("emoji-file-input") as HTMLInputElement;
const btnEmojiChooseFile = document.getElementById("btn-emoji-choose-file") as HTMLButtonElement;
const btnEmojiUploadCancelSelect = document.getElementById("btn-emoji-upload-cancel-select") as HTMLButtonElement;
const emojiCropViewport = document.getElementById("emoji-crop-viewport") as HTMLDivElement;
const emojiCropImg = document.getElementById("emoji-crop-img") as HTMLImageElement;
const emojiCropZoom = document.getElementById("emoji-crop-zoom") as HTMLInputElement;
const emojiNameInput = document.getElementById("emoji-name-input") as HTMLInputElement;
const btnEmojiUploadCancel = document.getElementById("btn-emoji-upload-cancel") as HTMLButtonElement;
const btnEmojiUploadConfirm = document.getElementById("btn-emoji-upload-confirm") as HTMLButtonElement;

const EMOJI_CROP_VIEWPORT_SIZE = 220;
const EMOJI_MAX_UPLOAD_SIZE = 500 * 1024; // 500KB, pre-crop

// ── Animated Custom Emoji Upload Modal (PRD 13.13) ──────────────────────────
// No crop tool — a GIF's frames can't be cropped through a static canvas
// without losing the animation, so this uploads the file as-is.
const emojiUploadAnimatedModal = document.getElementById("emoji-upload-animated-modal") as HTMLDivElement;
const emojiAnimatedFileInput = document.getElementById("emoji-animated-file-input") as HTMLInputElement;
const btnEmojiAnimatedChooseFile = document.getElementById("btn-emoji-animated-choose-file") as HTMLButtonElement;
const emojiAnimatedPreviewWrap = document.getElementById("emoji-animated-preview-wrap") as HTMLDivElement;
const emojiAnimatedPreviewImg = document.getElementById("emoji-animated-preview-img") as HTMLImageElement;
const emojiAnimatedNameInput = document.getElementById("emoji-animated-name-input") as HTMLInputElement;
const btnEmojiAnimatedUploadCancel = document.getElementById("btn-emoji-animated-upload-cancel") as HTMLButtonElement;
const btnEmojiAnimatedUploadConfirm = document.getElementById("btn-emoji-animated-upload-confirm") as HTMLButtonElement;

const ANIMATED_EMOJI_MAX_UPLOAD_SIZE = 2 * 1024 * 1024; // 2MB, uploaded as-is
let emojiAnimatedFile: File | null = null;
let emojiAnimatedPreviewObjectUrl: string | null = null;

// ── Channel Icon Modal (PRD 14.7, text channels only) ───────────────────────
const channelIconModal = document.getElementById("channel-icon-modal") as HTMLDivElement;
const channelIconStepSelect = document.getElementById("channel-icon-step-select") as HTMLDivElement;
const channelIconStepEmoji = document.getElementById("channel-icon-step-emoji") as HTMLDivElement;
const channelIconStepCrop = document.getElementById("channel-icon-step-crop") as HTMLDivElement;
const channelIconEmojiGrid = document.getElementById("channel-icon-emoji-grid") as HTMLDivElement;
const channelIconFileInput = document.getElementById("channel-icon-file-input") as HTMLInputElement;
const btnChannelIconChooseEmoji = document.getElementById("btn-channel-icon-choose-emoji") as HTMLButtonElement;
const btnChannelIconChooseImage = document.getElementById("btn-channel-icon-choose-image") as HTMLButtonElement;
const btnChannelIconReset = document.getElementById("btn-channel-icon-reset") as HTMLButtonElement;
const btnChannelIconCancelSelect = document.getElementById("btn-channel-icon-cancel-select") as HTMLButtonElement;
const btnChannelIconBackFromEmoji = document.getElementById("btn-channel-icon-back-from-emoji") as HTMLButtonElement;
const channelIconCropViewport = document.getElementById("channel-icon-crop-viewport") as HTMLDivElement;
const channelIconCropImg = document.getElementById("channel-icon-crop-img") as HTMLImageElement;
const channelIconCropZoom = document.getElementById("channel-icon-crop-zoom") as HTMLInputElement;
const btnChannelIconUploadCancel = document.getElementById("btn-channel-icon-upload-cancel") as HTMLButtonElement;
const btnChannelIconUploadConfirm = document.getElementById("btn-channel-icon-upload-confirm") as HTMLButtonElement;

/**
 * The "cover + pan + zoom" square cropper (PRD 19 C5) — extracted from the
 * channel-icon dialog so the server-icon dialog shares ONE implementation.
 * Elements are passed in; nothing here knows about channels or servers.
 */
class IconCropper {
    private naturalW = 0;
    private naturalH = 0;
    private baseScale = 1;
    private zoomFactor = 1;
    private offsetX = 0;
    private offsetY = 0;
    private objectUrl: string | null = null;
    private dragging = false;
    private dragStart = { x: 0, y: 0, offsetX: 0, offsetY: 0 };

    constructor(
        private readonly viewport: HTMLElement,
        private readonly img: HTMLImageElement,
        private readonly zoom: HTMLInputElement,
        private readonly size: number,
        /** Called once an image has loaded and is ready to crop. */
        private readonly onReady: () => void,
        /** Called on every pan/zoom (previews). */
        private readonly onChange: () => void = () => {},
    ) {
        img.addEventListener("load", () => this.handleLoad());
        viewport.addEventListener("mousedown", (e) => {
            this.dragging = true;
            viewport.classList.add("dragging");
            this.dragStart = { x: e.clientX, y: e.clientY, offsetX: this.offsetX, offsetY: this.offsetY };
            e.preventDefault();
        });
        document.addEventListener("mousemove", (e) => {
            if (!this.dragging) return;
            this.offsetX = this.dragStart.offsetX + (e.clientX - this.dragStart.x);
            this.offsetY = this.dragStart.offsetY + (e.clientY - this.dragStart.y);
            this.clamp();
            this.apply();
        });
        document.addEventListener("mouseup", () => {
            if (this.dragging) {
                this.dragging = false;
                viewport.classList.remove("dragging");
            }
        });
        zoom.addEventListener("input", () => {
            this.zoomFactor = parseFloat(zoom.value);
            this.clamp();
            this.apply();
        });
    }

    /** Starts cropping `file` (the caller has already validated type and size). */
    loadFile(file: Blob): void {
        if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = URL.createObjectURL(file);
        this.img.src = this.objectUrl;
    }

    /** Forgets the image (dialog closed). */
    clear(): void {
        if (this.objectUrl) {
            URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = null;
        }
        this.img.removeAttribute("src");
        this.naturalW = 0;
        this.naturalH = 0;
    }

    isReady(): boolean {
        return this.naturalW > 0 && this.naturalH > 0;
    }

    /** The cropped square as a canvas of `outSize` x `outSize`. */
    toCanvas(outSize: number): HTMLCanvasElement {
        const scale = this.baseScale * this.zoomFactor;
        const canvas = document.createElement("canvas");
        canvas.width = outSize;
        canvas.height = outSize;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas not supported");
        ctx.drawImage(this.img, -this.offsetX / scale, -this.offsetY / scale, this.size / scale, this.size / scale, 0, 0, outSize, outSize);
        return canvas;
    }

    /** The cropped square encoded as `mime` (null if the browser could not encode it). */
    toBlob(outSize: number, mime: string, quality?: number): Promise<Blob | null> {
        const canvas = this.toCanvas(outSize);
        return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
    }

    private handleLoad(): void {
        this.naturalW = this.img.naturalWidth;
        this.naturalH = this.img.naturalHeight;
        if (!this.naturalW || !this.naturalH) return;
        this.baseScale = Math.max(this.size / this.naturalW, this.size / this.naturalH);
        this.zoomFactor = 1;
        this.zoom.value = "1";
        this.offsetX = (this.size - this.naturalW * this.baseScale) / 2;
        this.offsetY = (this.size - this.naturalH * this.baseScale) / 2;
        this.apply();
        this.onReady();
    }

    private apply(): void {
        const scale = this.baseScale * this.zoomFactor;
        this.img.style.width = `${this.naturalW}px`;
        this.img.style.height = `${this.naturalH}px`;
        this.img.style.transform = `translate(${this.offsetX}px, ${this.offsetY}px) scale(${scale})`;
        this.onChange();
    }

    /** Keeps the image fully covering the viewport — offsets can't drift so far that a gap would show. */
    private clamp(): void {
        const scale = this.baseScale * this.zoomFactor;
        const minX = this.size - this.naturalW * scale;
        const minY = this.size - this.naturalH * scale;
        this.offsetX = Math.min(0, Math.max(minX, this.offsetX));
        this.offsetY = Math.min(0, Math.max(minY, this.offsetY));
    }
}

const CHANNEL_ICON_CROP_VIEWPORT_SIZE = 220;
const CHANNEL_ICON_MAX_UPLOAD_SIZE = 512 * 1024; // 512KB, pre-crop (PRD 14.7's own cap, not the emoji one)
const CHANNEL_ICON_ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

let pendingChannelIconId: string | null = null;

// The channel-icon dialog's cropper: the shared IconCropper (PRD 19 C5) — it no
// longer carries a private copy of the crop code.
const channelCropper = new IconCropper(
    channelIconCropViewport,
    channelIconCropImg,
    channelIconCropZoom,
    CHANNEL_ICON_CROP_VIEWPORT_SIZE,
    () => {
        channelIconStepSelect.style.display = "none";
        channelIconStepCrop.style.display = "block";
    },
);

// State for the crop tool
let emojiCropNaturalWidth = 0;
let emojiCropNaturalHeight = 0;
let emojiCropBaseScale = 1; // scale at zoom=1 that makes the image fully cover the viewport
let emojiCropZoomFactor = 1;
let emojiCropOffsetX = 0;
let emojiCropOffsetY = 0;
let emojiCropObjectUrl: string | null = null;
let emojiCropDragging = false;
let emojiCropDragStart = { x: 0, y: 0, offsetX: 0, offsetY: 0 };

// State for tabs: map of channelId → { tabEl, contentEl, messagesEl }
interface ChatTab {
    channelId: string;
    channelName: string;
    tabEl: HTMLDivElement;
    contentEl: HTMLDivElement;
    messagesEl: HTMLDivElement;
    loaded: boolean;
    /** Undefined for DM tabs — pinning is text-channel only (PRD 11.5). */
    pinBarEl?: HTMLDivElement;
    pinnedMessageId: string | null;
    /** Local-date key (`YYYY-MM-DD`) of the last message rendered into this
     *  tab — drives the date-section dividers (PRD 13.6). Undefined until
     *  the first message renders; reset to undefined wherever `messagesEl`
     *  is cleared and re-rendered from scratch. */
    lastRenderedDateKey?: string;
    /** Pinned to the very top of `messagesEl` at all times (PRD 14.2) — the
     *  `IntersectionObserver` target that triggers loading the next older
     *  page when scrolled into view. Also doubles as the "Loading older
     *  messages…" indicator via its `.loading` class/text content. */
    topSentinelEl: HTMLDivElement;
    scrollObserver?: IntersectionObserver;
    /** `createdAt` of the oldest message currently rendered — the cursor
     *  passed as `before` on the next "load older" fetch. */
    oldestLoadedTimestamp?: string;
    /** Day-key (`YYYY-M-D`) of the oldest currently-rendered message — the
     *  seed for the prepend path's date-divider lookback (PRD 14.2). */
    oldestRenderedDateKey?: string;
    /** Optimistic: true until a "load older" fetch returns fewer than a
     *  full page, at which point real history is known to be exhausted. */
    hasMoreOlder: boolean;
    /** Guards against overlapping "load older" fetches from rapid scroll. */
    loadingOlder: boolean;
    /** True once the initial page has actually finished loading — guards
     *  the `IntersectionObserver` from firing a premature "load older"
     *  fetch before `oldestLoadedTimestamp`/`hasMoreOlder` are real. */
    initialLoadDone: boolean;
    /** Always the last child of `messagesEl` (PRD 14.3) — the
     *  `IntersectionObserver` target that shows/hides the floating
     *  "Jump to Most Recent Message" button. */
    bottomSentinelEl: HTMLDivElement;
    jumpToRecentBtn: HTMLButtonElement;
    /** False only after `jumpToMessage` loads a window that might not
     *  reach the channel's true latest message — set back to true once a
     *  live message arrives or a fresh latest-page fetch confirms it (PRD
     *  14.3). Everywhere else (initial load, normal live appends) the last
     *  rendered message is by definition the true latest, so this stays
     *  true throughout ordinary use. */
    atTrueLatest: boolean;
    /** `createdAt` of the newest message rendered — the cursor passed as
     *  `after` when scrolling down from a jump window loads newer pages
     *  (PRD 17.8). */
    newestLoadedTimestamp?: string;
    /** Guards against overlapping "load newer" fetches (PRD 17.8). */
    loadingNewer: boolean;
    /** True while jumpToMessage() builds and lands on a window: both
     *  sentinels' loaders stand down, so a prepend can't cancel the scroll
     *  to the target (PRD 17.8). */
    jumpInProgress: boolean;
    /** Whether size changes (previews, images, emoji) should keep the view on
     *  the bottom (PRD 18.12). Updated ONLY by user-driven scrolls and by the
     *  code that deliberately positions the view; read when a size change
     *  actually happens, never captured earlier. */
    followBottom: boolean;
    /** > 0 while code (not the user) is moving the scroll position, so the
     *  scroll listener doesn't mistake it for the user leaving the bottom. */
    programmaticScroll: number;
    /** > 0 while a smooth scroll runs: the keeper must not fight it. */
    smoothScrolling: number;
    /** The first visible message body and its offset from the viewport top,
     *  restored after layout changes while the user is reading history. */
    anchor: { el: HTMLElement; top: number } | null;
    /** A jump target kept centred until the user takes over (PRD 17.8/18.12). */
    holdTarget: { el: HTMLElement; until: number } | null;
    resizeObserver?: ResizeObserver;
    mutationObserver?: MutationObserver;
    /** Text channel vs DM (PRD 17.5). */
    kind: "channel" | "dm";
    /** "preview" = replaced by the next conversation opened; "kept" = stays
     *  open and is remembered across restarts (PRD 17.5; DM tabs too since
     *  PRD 19 B4). */
    mode?: "preview" | "kept";
}
const chatTabs = new Map<string, ChatTab>();

// ── Preview tabs & "Keep Tab Open" (PRD 17.5) ────────────────────────────────
// Clicking a text channel opens it in THE preview tab (at most one), which the
// next channel replaces in place. "Keep Tab Open" makes a tab permanent and
// remembers it per server (`reson8-kept-tabs`, same shape and try/catch
// discipline as `reson8-muted-channels`). Since PRD 19 B4 DM tabs follow the
// same rules (ids `dm:<userId>` in the same store).

/** The single preview tab, if any. */
let previewTabId: string | null = null;
/** Kept tabs are restored once per connection, after the first channel tree. */
let keptTabsRestored = false;
/**
 * Kept DM tab ids read from the store that have not been opened yet (PRD 19
 * B4): they can only be restored once DM data (the directory) has arrived, and
 * until then — or for a person who is currently not listed — they must stay in
 * the store, so persistKeptTabs() writes them back.
 */
let pendingKeptDmIds = new Set<string>();
/**
 * The server the kept list belongs to — taken from the channel tree's own
 * payload, because the first CHANNEL_TREE_UPDATE arrives DURING the join,
 * before the "connected" event sets currentServerId (the muted-channels store
 * does the same, PRD 16.4).
 */
let keptTabsServerId: string | null = null;

const KEPT_TABS_KEY = "reson8-kept-tabs";

function readKeptTabsStore(): Record<string, string[]> {
    try {
        const parsed = JSON.parse(localStorage.getItem(KEPT_TABS_KEY) ?? "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const clean: Record<string, string[]> = {};
        for (const [serverId, ids] of Object.entries(parsed)) {
            if (Array.isArray(ids)) clean[serverId] = ids.filter((id): id is string => typeof id === "string");
        }
        return clean;
    } catch {
        return {}; // missing, malformed or storage unavailable — treat as empty
    }
}

/** Writes the current server's kept channels, in tab-bar order. */
function persistKeptTabs(): void {
    if (!keptTabsServerId) return;
    const ids = Array.from(tabBar.querySelectorAll<HTMLElement>(".tab.kept"))
        .map((el) => el.dataset.tabId ?? "")
        .filter((id) => chatTabs.has(id));
    // Kept DMs not restored yet stay remembered (PRD 19 B4).
    for (const pending of pendingKeptDmIds) if (!ids.includes(pending)) ids.push(pending);
    try {
        const store = readKeptTabsStore();
        if (ids.length > 0) store[keptTabsServerId] = ids;
        else delete store[keptTabsServerId];
        localStorage.setItem(KEPT_TABS_KEY, JSON.stringify(store));
    } catch {
        /* storage unavailable — kept tabs just won't be remembered */
    }
}

// ── Tab bar overflow (PRD 19 C8) ──────────────────────────────────────────────
// Tabs that don't fit collapse into an "{n} more ▾" button. Measuring happens
// in ONE place (layoutTabBar), real offsetWidths cached per element; it changes
// only `display` (the .tab-hidden class) and `order`, never a width, so the
// observer that triggers it cannot feed itself. Hidden tabs stay in the DOM
// with their content and scroll keeper, and the kept-tabs order is the DOM
// order, which this never touches.

const tabOverflowBtn = document.getElementById("tab-overflow") as HTMLButtonElement;
const tabOverflowLabel = document.getElementById("tab-overflow-label") as HTMLElement;
const tabOverflowDot = document.getElementById("tab-overflow-dot") as HTMLElement;
const tabWidthCache = new WeakMap<HTMLElement, number>();
let tabOverflowButtonWidth = 0;
let tabOverflowQueued = false;
/** Counts layout passes (a no-layout-loop check reads it). */
let tabOverflowRuns = 0;

function invalidateTabWidth(el: HTMLElement): void {
    tabWidthCache.delete(el);
    scheduleTabOverflow();
}

function scheduleTabOverflow(): void {
    if (tabOverflowQueued) return;
    tabOverflowQueued = true;
    requestAnimationFrame(() => {
        tabOverflowQueued = false;
        layoutTabBar();
    });
}

function layoutTabBar(): void {
    tabOverflowRuns++;
    const tabs = Array.from(tabBar.querySelectorAll<HTMLElement>(".tab"));
    // Not displayed yet (the welcome screen hides #main): every width would read 0
    // and be cached. The observer fires again when the bar gets a size.
    if (tabs.length === 0 || tabBar.clientWidth === 0) return;

    // Real widths for anything not measured yet (un-hidden first so a hidden
    // tab has one). One layout read after all the class changes.
    const unmeasured = tabs.filter((t) => !tabWidthCache.has(t));
    for (const t of unmeasured) t.classList.remove("tab-hidden");
    if (!tabOverflowButtonWidth) {
        tabOverflowLabel.textContent = "99 more";
        tabOverflowBtn.style.display = "";
    }
    for (const t of unmeasured) tabWidthCache.set(t, t.offsetWidth);
    if (!tabOverflowButtonWidth) {
        tabOverflowButtonWidth = tabOverflowBtn.offsetWidth + 12; // + its margins
        tabOverflowBtn.style.display = "none";
    }

    const widths = tabs.map((t) => tabWidthCache.get(t) ?? 0);
    const avail = tabBar.clientWidth;
    const total = widths.reduce((a, b) => a + b, 0);
    const fitsAll = total <= avail;

    const visible = new Set<number>();
    const order: number[] = tabs.map((_, i) => i * 2);
    if (fitsAll) {
        tabs.forEach((_, i) => visible.add(i));
    } else {
        const room = avail - tabOverflowButtonWidth;
        const activeIdx = tabs.findIndex((t) => t.classList.contains("active"));
        let used = 0;
        let lastFitted = -1;
        if (activeIdx >= 0) {
            used += widths[activeIdx];
            visible.add(activeIdx);
        }
        for (let i = 0; i < tabs.length; i++) {
            if (i === activeIdx) {
                lastFitted = i;
                continue;
            }
            if (used + widths[i] > room) break;
            used += widths[i];
            visible.add(i);
            lastFitted = i;
        }
        // An active tab beyond the ones that fit takes the slot after the last one that fits.
        if (activeIdx > lastFitted) order[activeIdx] = lastFitted * 2 + 1;
    }

    let hiddenUnread = false;
    let hiddenCount = 0;
    tabs.forEach((t, i) => {
        const hide = !visible.has(i);
        t.classList.toggle("tab-hidden", hide);
        t.style.order = fitsAll ? "" : hide ? "" : String(order[i]);
        if (hide) {
            hiddenCount++;
            if (t.classList.contains("has-unread")) hiddenUnread = true;
        }
    });

    tabOverflowBtn.style.display = hiddenCount > 0 ? "" : "none";
    tabOverflowLabel.textContent = `${hiddenCount} more`;
    tabOverflowDot.style.display = hiddenUnread ? "" : "none";
    if (hiddenCount === 0) closeTabOverflowMenu();
    else if (tabOverflowMenuEl) buildTabOverflowMenu();
}

let tabOverflowMenuEl: HTMLDivElement | null = null;

function closeTabOverflowMenu(): void {
    tabOverflowMenuEl?.remove();
    tabOverflowMenuEl = null;
    tabOverflowBtn.setAttribute("aria-expanded", "false");
}

/** (Re)fills the dropdown from the tabs that are currently hidden. Labels are text only. */
function buildTabOverflowMenu(): void {
    if (!tabOverflowMenuEl) return;
    const menu = tabOverflowMenuEl;
    menu.replaceChildren();
    const heading = document.createElement("div");
    heading.className = "menu-heading tab-overflow-heading";
    heading.textContent = "Open tabs that don't fit";
    menu.appendChild(heading);

    const hidden = Array.from(tabBar.querySelectorAll<HTMLElement>(".tab.tab-hidden"));
    for (const tabEl of hidden) {
        const id = tabEl.dataset.tabId ?? "";
        const row = document.createElement("div");
        row.className = "tab-overflow-row";
        row.setAttribute("role", "menuitem");
        if (tabEl.classList.contains("preview")) row.classList.add("is-preview");
        if (tabEl.classList.contains("has-unread")) row.classList.add("has-unread");

        const icon = document.createElement("span");
        icon.className = "tab-overflow-icon";
        const srcIcon = tabEl.querySelector(".tab-icon");
        if (srcIcon) icon.innerHTML = srcIcon.innerHTML; // our own markup (emoji or a Phosphor <i>), never user text
        row.appendChild(icon);

        const label = document.createElement("span");
        label.className = "tab-overflow-label";
        label.textContent = tabEl.querySelector(".tab-label")?.textContent ?? tabEl.textContent?.trim() ?? id;
        row.appendChild(label);

        if (tabEl.classList.contains("kept")) {
            const kept = document.createElement("span");
            kept.className = "tab-overflow-kept";
            kept.innerHTML = TAB_KEPT_ICON_SVG;
            row.appendChild(kept);
        }
        if (tabEl.classList.contains("has-unread")) {
            const pill = document.createElement("span");
            pill.className = "count-pill";
            pill.textContent = tabEl.querySelector(".tab-unread-count")?.textContent ?? "";
            row.appendChild(pill);
        }
        if (id !== "server-log") {
            const close = document.createElement("span");
            close.className = "tab-overflow-close";
            close.setAttribute("role", "button");
            close.setAttribute("aria-label", "Close tab");
            close.textContent = "✕";
            close.addEventListener("click", (e) => {
                e.stopPropagation();
                closeTab(id, { reason: "user" });
                layoutTabBar(); // the list reflects it at once
            });
            row.appendChild(close);
        }
        row.addEventListener("click", () => {
            closeTabOverflowMenu();
            switchTab(id);
        });
        menu.appendChild(row);
    }
}

function openTabOverflowMenu(): void {
    if (tabOverflowMenuEl) {
        closeTabOverflowMenu();
        return;
    }
    closeMenu(); // one popover at a time
    const menu = document.createElement("div");
    menu.className = "tab-overflow-menu";
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);
    tabOverflowMenuEl = menu;
    buildTabOverflowMenu();
    const rect = tabOverflowBtn.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.right - 260, window.innerWidth - 268));
    menu.style.left = `${left}px`;
    menu.style.top = `${rect.bottom + 6}px`;
    tabOverflowBtn.setAttribute("aria-expanded", "true");
}

tabOverflowBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openTabOverflowMenu();
});
document.addEventListener("pointerdown", (e) => {
    if (!tabOverflowMenuEl) return;
    const target = e.target as Node;
    if (tabOverflowMenuEl.contains(target) || tabOverflowBtn.contains(target)) return;
    closeTabOverflowMenu();
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && tabOverflowMenuEl) closeTabOverflowMenu();
});
new ResizeObserver(() => layoutTabBar()).observe(tabBar);
window.addEventListener("resize", () => scheduleTabOverflow());

const TAB_KEPT_ICON_SVG =
    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>`;

/**
 * Fills a tab element with its structured parts (PRD 17.5), so a rename only
 * touches `.tab-label` and the kept icon / unread dot survive it.
 */
function fillTabElement(tabEl: HTMLElement, icon: string, name: string): void {
    tabEl.innerHTML =
        `<span class="tab-icon" aria-hidden="true">${icon}</span>` +
        `<span class="tab-kept-icon">${TAB_KEPT_ICON_SVG}</span>` +
        `<span class="tab-label"></span>` +
        `<span class="tab-unread-count count-pill" aria-hidden="true"></span>` +
        `<span class="tab-close" role="button" aria-label="Close tab">✕</span>`;
    (tabEl.querySelector(".tab-label") as HTMLElement).textContent = name;
}

/**
 * Unread indicator on an open, unfocused channel tab (PRD 17.6) — kept or
 * preview alike, never for a muted channel. Derived from the same state the
 * tree uses (`unreadChannelCounts` + `isChannelMuted`), so the two can't
 * disagree. DM tabs are out of scope (DMs are marked read on arrival).
 */
function refreshTabUnread(channelId: string): void {
    const tab = chatTabs.get(channelId);
    if (!tab) return;
    if (tab.kind === "dm") {
        // PRD 18.13. No mute for DMs. A tab you're looking at in a focused window is read.
        const partnerId = channelId.slice(3);
        const showDm = hasDmUnread(partnerId) && !(activeTabId === channelId && document.hasFocus());
        paintTabUnread(tab, showDm ? dmUnread(partnerId) : 0);
        scheduleDmSidebarRender(); // PRD 19 C7: the row's pill and the rail total
        return;
    }
    if (tab.kind !== "channel") return;
    setTabMuted(tab, isChannelMuted(channelId)); // PRD 19 B2
    const show = hasChannelUnread(channelId) && !isChannelMuted(channelId) && activeTabId !== channelId;
    paintTabUnread(tab, show ? channelUnread(channelId) : 0);
}

/**
 * Bell-with-a-slash for a muted channel (PRD 19 B2), a vendored Phosphor
 * glyph (F2).
 */
const BELL_SLASH_ICON_HTML = `<i class="ph ph-bell-slash" aria-hidden="true"></i>`;

/** Adds or removes the bell-slash inside `host`, right after `afterSelector` (or at the end). */
function setMutedIcon(host: Element, muted: boolean, iconClass: string, afterSelector: string): void {
    const existing = host.querySelector(`.${iconClass}`);
    if (!muted) {
        existing?.remove();
        return;
    }
    if (existing) return;
    const icon = document.createElement("span");
    icon.className = iconClass;
    icon.title = "Muted";
    icon.setAttribute("aria-label", "Muted");
    icon.innerHTML = BELL_SLASH_ICON_HTML;
    const anchor = host.querySelector(afterSelector);
    if (anchor) anchor.after(icon);
    else host.appendChild(icon);
}

/** A muted channel's tab is faded, carries the bell-slash and never a badge (PRD 19 B2). */
function setTabMuted(tab: ChatTab, muted: boolean): void {
    invalidateTabWidth(tab.tabEl); // PRD 19 C8
    tab.tabEl.classList.toggle("muted", muted);
    setMutedIcon(tab.tabEl, muted, "tab-muted-icon", ".tab-label");
}

/** Shows `n` unread (0 = none, -1 = unknown) on a tab: class, number and aria-label. */
function paintTabUnread(tab: ChatTab, n: number): void {
    const shown = n !== 0;
    invalidateTabWidth(tab.tabEl); // PRD 19 C8: the badge and the bolder label change the width
    tab.tabEl.classList.toggle("has-unread", shown);
    const pill = tab.tabEl.querySelector(".tab-unread-count");
    if (pill) pill.textContent = shown ? formatUnreadCount(n) : "";
    if (!shown) tab.tabEl.removeAttribute("aria-label");
    else if (n < 0) tab.tabEl.setAttribute("aria-label", `${tab.channelName} (unread)`);
    else tab.tabEl.setAttribute("aria-label", `${tab.channelName} (${n} unread)`);
}

/**
 * Marks a DM conversation read — but only when it is really being looked at:
 * its tab is active and the window has focus (PRD 18.13). `document.hasFocus()`
 * is synchronous and correct here (the async `api.isWindowFocused()` would
 * reintroduce ordering bugs). One server call per actual view.
 */
function markDmTabRead(tab: ChatTab, opts: { hadUnreadOnPage?: boolean } = {}): void {
    if (tab.kind !== "dm") return;
    if (activeTabId !== tab.channelId || !document.hasFocus()) return;
    // Not seen yet: a tab that is active only because it was just created (its
    // history is still loading) hasn't shown anything — reading it now would
    // mark messages read that were never rendered. The load path calls with
    // `hadUnreadOnPage` once the page IS rendered.
    if (!tab.initialLoadDone && !opts.hadUnreadOnPage) return;
    const partnerId = tab.channelId.slice(3);
    if (!hasDmUnread(partnerId) && !opts.hadUnreadOnPage) return;
    unreadDmCounts.delete(partnerId);
    refreshTabUnread(tab.channelId);
    api.markDmsRead(partnerId);
}

/** Applies a channel tab's mode to its element (classes + tooltip). */
function renderTabMode(tab: ChatTab): void {
    invalidateTabWidth(tab.tabEl); // PRD 19 C8: the pin icon, italics and a renamed label change the width
    const kept = tab.mode === "kept";
    tab.tabEl.classList.toggle("kept", kept);
    tab.tabEl.classList.toggle("preview", tab.mode === "preview");
    tab.tabEl.title = kept
        ? `${tab.channelName} — kept open`
        : `${tab.channelName} — preview: opening another conversation replaces this tab. Double-click or right-click → Keep open to keep it.`;
}
/** Initial + "load older" page size for both channel and DM history (PRD 14.2). */
const CHAT_PAGE_SIZE = 20;
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
    if (type === "error" && connectFlow && connectFlow.state === "running") {
        const tmp = document.createElement("div");
        tmp.innerHTML = message;
        connectFlow.lastError = (tmp.textContent ?? "").replace(/^Error:\s*/, "");
    }

    // While the welcome screen is showing there is no Server Log to read: mirror
    // connect progress and errors into its status line (text only).
    if (!isConnected && !document.body.classList.contains("is-approving") && message) {
        const tmp = document.createElement("div");
        tmp.innerHTML = message;
        welcomeStatus(tmp.textContent ?? "", type === "error" ? "error" : type === "success" ? "success" : "");
    }
}

/** Shows a transient toast in the top-right corner (used by Nudge; general-purpose otherwise). */
function showToast(message: string, durationMs = 4000): void {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = message;
    toastContainer.appendChild(toast);

    // Force a reflow so the "visible" transition actually animates in.
    requestAnimationFrame(() => toast.classList.add("visible"));

    setTimeout(() => {
        toast.classList.remove("visible");
        toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    }, durationMs);
}

// ── Connection ──────────────────────────────────────────────────────────

/** `host` or `host:port` for messages — IPv6 literals bracketed like in a URL. */
function displayAddress(host: string, port?: number): string {
    const h = host.includes(":") ? `[${host}]` : host;
    return port ? `${h}:${port}` : h;
}

/** The connection being made / made — what the status bar and the warning banner describe. */
let currentConnection: { scheme: "https" | "http"; host: string; port: number | undefined; pinned: boolean } | null = null;
let connectInProgress = false;
/** Whether the running connect was started with a typed password (a refusal then means "wrong"). */
let connectFlowHadPassword = false;

async function startConnect(): Promise<void> {
    if (connectInProgress || isConnected) return;

    const parsed = api.tls.parseServerAddress(serverUrlInput.value);
    if (!parsed.ok) {
        log(parsed.error, "error");
        return;
    }
    const address = parsed.value;
    const nickname = nicknameInput.value.trim() || "User";
    const password = serverPasswordInput.value || undefined;
    // Only sent when typed; never remembered (a code is single-purpose, PRD 18.9).
    const inviteCode = inviteCodeInput.value.trim() || undefined;

    welcomeStatus("", "");
    const hadPasswordTyped = !!password;
    beginConnectFlow(serverUrlInput.value.trim(), nickname); // PRD 19 R1
    connectFlowHadPassword = hadPasswordTyped;

    connectInProgress = true;
    btnConnect.disabled = true; // the probe can take a few seconds
    try {
        const target = await resolveConnectionTarget(address);
        if (!target) {
            // Refused (the reason was logged) or cancelled by the user (back to the form).
            if (connectFlow?.lastError) failConnectFlow(connectFlow.lastError);
            else showWelcomeForm();
            return;
        }
        if (connectFlow) {
            connectFlow.steps.resolve = "done";
            connectFlow.insecure = target.scheme === "http";
            connectFlow.steps.secure = target.scheme === "https" ? "done" : "warn";
            connectFlow.steps.signin = "active";
            renderConnectCard();
        }

        currentConnection = target;
        const shown = displayAddress(target.host, target.port);
        log(
            `Connecting to ${shown} ${target.scheme === "https" ? "over HTTPS" : "(not encrypted)"} as "${nickname}"...`,
            "info",
        );
        // A typed password always wins; otherwise a saved server's stored one is
        // read by the preload from the main process at join time (PRD 19 C1).
        const savedId = !password && selectedSavedServerId && savedServerById(selectedSavedServerId)?.hasPassword
            ? selectedSavedServerId
            : undefined;
        await api.connect(target, nickname, password, inviteCode, savedId);
    } finally {
        connectInProgress = false;
        if (!isConnected) btnConnect.disabled = false;
    }
}

/**
 * Decides HOW to connect (PRD 18.3): probes the server's TLS, applies the
 * pure `decideScheme()` rules, and asks the user when an unknown certificate
 * needs a decision. Returns null when the attempt should stop.
 */
async function resolveConnectionTarget(
    address: TlsServerAddress,
): Promise<{ scheme: "https" | "http"; host: string; port: number | undefined; pinned: boolean } | null> {
    const { host, port } = address;
    // Typing http:// is an explicit choice: no probe, connect as asked.
    if (address.scheme === "http") return { scheme: "http", host, port, pinned: false };

    const probePort = port ?? 443;
    log(`Checking ${displayAddress(host, port)} for an encrypted connection...`, "info");
    const reply = await api.tls.probe(host, probePort);
    if ("error" in reply) {
        log(reply.error, "error");
        return null;
    }

    // No scheme and no port was plain http on port 80 before 2.7.0. If nothing
    // on 443 speaks TLS, keep doing that — unless this server was reached over
    // HTTPS before, which must never silently downgrade.
    if (
        address.scheme === null &&
        port === undefined &&
        (reply.result.kind === "no-tls" || reply.result.kind === "unreachable") &&
        !reply.httpsRemembered
    ) {
        return { scheme: "http", host, port: undefined, pinned: false };
    }

    const decision = api.tls.decideScheme({
        explicit: address.scheme,
        probe: reply.result,
        pinnedFingerprint: reply.pinnedFingerprint,
        httpsRemembered: reply.httpsRemembered,
    });

    switch (decision.action) {
        case "connect":
            return { scheme: decision.scheme, host, port, pinned: decision.scheme === "https" && decision.pinned };

        case "ask-trust": {
            const trusted = await askToTrustCertificate(host, probePort, decision.cert, reply.result);
            if (!trusted) {
                log("Connection cancelled — the server's certificate was not trusted", "info");
                return null;
            }
            const pinned = await api.tls.trustCertificate(host, probePort, decision.cert.fingerprint256);
            if (!pinned.ok) {
                log(pinned.error ?? "Couldn't store the trusted certificate", "error");
                return null;
            }
            log(`Trusted the certificate of ${displayAddress(host, port)} (${api.tls.formatFingerprint(decision.cert.fingerprint256).slice(0, 23)}…)`, "success");
            return { scheme: "https", host, port, pinned: true };
        }

        case "pin-mismatch":
            log(`The certificate of ${displayAddress(host, port)} changed — not connecting`, "error");
            await showCertificateChanged(host, probePort, decision.pinnedFingerprint, decision.cert.fingerprint256);
            return null;

        case "error":
            log(decision.message, "error");
            return null;
    }
}

// ── Certificate modals (PRD 18.3) ─────────────────────────────────────────
const tlsTrustModal = document.getElementById("tls-trust-modal") as HTMLDivElement;
const tlsChangedModal = document.getElementById("tls-changed-modal") as HTMLDivElement;
let tlsTrustResolver: ((trusted: boolean) => void) | null = null;
let tlsChangedResolver: (() => void) | null = null;
let tlsTrustFingerprint = "";

function describeCertificateReason(reason: string): string {
    switch (reason) {
        case "DEPTH_ZERO_SELF_SIGNED_CERT":
        case "SELF_SIGNED_CERT_IN_CHAIN":
            return "it is self-signed";
        case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
        case "UNABLE_TO_GET_ISSUER_CERT_LOCALLY":
            return "its issuer is unknown";
        case "CERT_HAS_EXPIRED":
            return "it has expired";
        case "ERR_TLS_CERT_ALTNAME_INVALID":
            return "it was issued for a different name";
        default:
            return "it can't be verified";
    }
}

function askToTrustCertificate(host: string, port: number, cert: TlsCertInfo, probe: TlsProbeResult): Promise<boolean> {
    const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
    el("tls-trust-host").textContent = displayAddress(host, port);
    el("tls-trust-reason").textContent = describeCertificateReason(probe.kind === "untrusted" ? probe.reason : "");
    el("tls-trust-subject").textContent = cert.subject || "(none)";
    el("tls-trust-names").textContent = cert.sans.length ? cert.sans.join(", ") : "(none)";
    el("tls-trust-expiry").textContent = new Date(cert.validTo).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
    el("tls-trust-fingerprint").textContent = api.tls.formatFingerprint(cert.fingerprint256);
    tlsTrustFingerprint = api.tls.formatFingerprint(cert.fingerprint256);
    tlsTrustModal.classList.add("visible");
    (document.getElementById("btn-tls-trust-cancel") as HTMLButtonElement).focus(); // the safe default
    return new Promise((resolve) => {
        tlsTrustResolver = resolve;
    });
}

function closeTlsTrustModal(trusted: boolean): void {
    tlsTrustModal.classList.remove("visible");
    const resolve = tlsTrustResolver;
    tlsTrustResolver = null;
    resolve?.(trusted);
}

function showCertificateChanged(host: string, port: number, pinned: string, seen: string): Promise<void> {
    (document.getElementById("tls-changed-host") as HTMLElement).textContent = displayAddress(host, port);
    (document.getElementById("tls-changed-old") as HTMLElement).textContent = api.tls.formatFingerprint(pinned);
    (document.getElementById("tls-changed-new") as HTMLElement).textContent = api.tls.formatFingerprint(seen);
    tlsChangedModal.classList.add("visible");
    return new Promise((resolve) => {
        tlsChangedResolver = resolve;
    });
}

function closeTlsChangedModal(): void {
    tlsChangedModal.classList.remove("visible");
    const resolve = tlsChangedResolver;
    tlsChangedResolver = null;
    resolve?.();
}

document.getElementById("btn-tls-trust-confirm")!.addEventListener("click", () => closeTlsTrustModal(true));
document.getElementById("btn-tls-trust-cancel")!.addEventListener("click", () => closeTlsTrustModal(false));
document.getElementById("btn-tls-trust-copy")!.addEventListener("click", () => {
    api.copyText(tlsTrustFingerprint).then((ok) => showToast(ok ? "Fingerprint copied" : "Couldn't copy the fingerprint"));
});
document.getElementById("btn-tls-changed-close")!.addEventListener("click", closeTlsChangedModal);
tlsTrustModal.addEventListener("click", (e) => {
    if (e.target === tlsTrustModal) closeTlsTrustModal(false);
});
tlsChangedModal.addEventListener("click", (e) => {
    if (e.target === tlsChangedModal) closeTlsChangedModal();
});
document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (tlsTrustModal.classList.contains("visible")) closeTlsTrustModal(false);
    else if (tlsChangedModal.classList.contains("visible")) closeTlsChangedModal();
});

// ── Status-bar lock + "not encrypted" warning (PRD 18.3) ──────────────────
const connSecurityEl = document.getElementById("conn-security") as HTMLSpanElement;
const tlsWarningBanner = document.getElementById("tls-warning-banner") as HTMLDivElement;
const TLS_HTTP_WARNING_KEY = "reson8-tls-http-warning-dismissed";
const LOCK_CLOSED_SVG =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
const LOCK_OPEN_SVG =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>';

function readDismissedHttpWarnings(): string[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(TLS_HTTP_WARNING_KEY) ?? "[]");
        return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch {
        return [];
    }
}

function dismissHttpWarningFor(key: string): void {
    try {
        const list = readDismissedHttpWarnings().filter((k) => k !== key);
        list.push(key);
        localStorage.setItem(TLS_HTTP_WARNING_KEY, JSON.stringify(list.slice(-100)));
    } catch {
        /* the warning just shows again next time */
    }
}

function renderConnectionSecurity(): void {
    const c = currentConnection;
    if (!isConnected || !c) {
        connSecurityEl.hidden = true;
        tlsWarningBanner.classList.remove("visible");
        return;
    }
    connSecurityEl.hidden = false;
    connSecurityEl.classList.toggle("secure", c.scheme === "https");
    connSecurityEl.classList.toggle("insecure", c.scheme === "http");
    if (c.scheme === "https") {
        connSecurityEl.innerHTML = LOCK_CLOSED_SVG + "<span>Encrypted</span>";
        connSecurityEl.title = c.pinned
            ? "Encrypted connection. The server's certificate is self-signed and you chose to trust it."
            : "Encrypted connection (HTTPS)";
        tlsWarningBanner.classList.remove("visible");
        return;
    }
    connSecurityEl.innerHTML = LOCK_OPEN_SVG + "<span>Not encrypted</span>";
    connSecurityEl.title = "This connection is not encrypted: anyone on the network path can read your messages.";

    const key = api.tls.hostKey(c.host, c.port ?? 80);
    if (!readDismissedHttpWarnings().includes(key)) {
        (document.getElementById("tls-warning-text") as HTMLElement).textContent =
            `The connection to ${c.host} isn't encrypted — messages, direct messages and files can be read by anyone ` +
            `on the network between you and the server. Ask its owner to enable HTTPS.`;
        tlsWarningBanner.classList.add("visible");
    }
}

document.getElementById("btn-tls-warning-close")!.addEventListener("click", () => {
    tlsWarningBanner.classList.remove("visible");
});
document.getElementById("btn-tls-warning-dismiss")!.addEventListener("click", () => {
    if (currentConnection) dismissHttpWarningFor(api.tls.hostKey(currentConnection.host, currentConnection.port ?? 80));
    tlsWarningBanner.classList.remove("visible");
});

// ── Settings → Application → Trusted certificates (PRD 18.3) ──────────────
async function renderTrustedCertificates(): Promise<void> {
    const list = document.getElementById("tls-trusted-list") as HTMLDivElement;
    let pins: TlsPinSummary[] = [];
    try {
        pins = await api.tls.listTrusted();
    } catch {
        /* an empty list is a safe rendering */
    }
    list.textContent = "";
    if (pins.length === 0) {
        const empty = document.createElement("div");
        empty.className = "tls-trusted-empty";
        empty.textContent = "No self-signed certificates trusted.";
        list.appendChild(empty);
        return;
    }
    for (const pin of pins) {
        const row = document.createElement("div");
        row.className = "tls-trusted-row";
        const info = document.createElement("div");
        info.className = "tls-trusted-info";
        const host = document.createElement("div");
        host.className = "tls-trusted-host";
        host.textContent = pin.hostKey;
        const meta = document.createElement("div");
        meta.className = "tls-trusted-meta";
        const fp = api.tls.formatFingerprint(pin.fingerprint256);
        const fmt = (iso: string): string => {
            const d = new Date(iso);
            return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
        };
        meta.textContent = `${fp.slice(0, 23)}… · trusted ${fmt(pin.pinnedAt)} · expires ${fmt(pin.validTo)}`;
        info.append(host, meta);
        const remove = document.createElement("button");
        remove.className = "btn btn-cancel";
        remove.textContent = "Remove";
        remove.addEventListener("click", async () => {
            await api.tls.removeTrust(pin.hostKey);
            void renderTrustedCertificates();
        });
        row.append(info, remove);
        list.appendChild(row);
    }
}

btnConnect.addEventListener("click", () => {
    void startConnect();
});

// ── Connect progress and failure (PRD 19 R1, frames 3a/3b) ───────────────────
// While a connect runs, the form is replaced by a card listing the steps the
// client really goes through: the TLS probe (resolving + encrypted), the join
// (signing in) and the first tree (syncing). A failure keeps the card with the
// reason, two hints and Try again / Edit details. Nothing about HOW we connect
// changes; this only shows it. One exception, by design: a first connect that
// can't reach the server stops retrying (it used to retry forever behind an
// error line) — Try again starts it over.

type ConnectStepState = "pending" | "active" | "done" | "failed" | "warn";
interface ConnectFlow {
    address: string;
    nickname: string;
    steps: { resolve: ConnectStepState; secure: ConnectStepState; signin: ConnectStepState; sync: ConnectStepState };
    insecure: boolean;
    state: "running" | "failed" | "password";
    lastError: string;
}

const connectCard = document.getElementById("connect-card") as HTMLDivElement;
const welcomeForm = document.getElementById("welcome-form") as HTMLDivElement;

function showWelcomeForm(): void {
    connectFlow = null;
    connectCard.style.display = "none";
    welcomeForm.style.display = "";
    renderServerPill();
}

function renderConnectCard(): void {
    const f = connectFlow;
    if (!f) {
        showWelcomeForm();
        return;
    }
    welcomeForm.style.display = "none";
    connectCard.style.display = "";
    const failed = f.state === "failed";
    connectCard.classList.toggle("failed", failed);
    const signinFailed = f.steps.signin === "failed";
    (document.getElementById("connect-card-title") as HTMLElement).textContent = failed
        ? signinFailed
            ? `Couldn't sign in to ${f.address}`
            : `Couldn't reach ${f.address}`
        : `Connecting to ${f.address}`;
    (document.getElementById("connect-card-sub") as HTMLElement).textContent = failed ? f.lastError : "";
    (document.getElementById("connect-card-icon") as HTMLElement).className = failed
        ? "ph ph-plugs connect-card-icon"
        : "ph ph-plugs-connected connect-card-icon";

    const icon: Record<ConnectStepState, string> = {
        pending: "ph-circle",
        active: "ph-circle-notch spinning",
        done: "ph-check-circle",
        failed: "ph-x-circle",
        warn: "ph-lock-simple-open",
    };
    const rows: [ConnectStepState, string][] = [
        [f.steps.resolve, "Resolving address"],
        [f.steps.secure, f.insecure ? "Not encrypted" : "Encrypted"],
        [f.steps.signin, f.state === "password" ? `Signing in as ${f.nickname} — password required` : `Signing in as ${f.nickname}`],
        [f.steps.sync, "Syncing channels"],
    ];
    const list = document.getElementById("connect-steps") as HTMLElement;
    list.replaceChildren();
    for (const [state, label] of rows) {
        const li = document.createElement("li");
        li.className = state;
        const i = document.createElement("i");
        i.className = `ph ${f.state === "password" && label.startsWith("Signing") ? "ph-lock-simple" : icon[state]}`;
        i.setAttribute("aria-hidden", "true");
        const span = document.createElement("span");
        span.textContent = label;
        li.append(i, span);
        list.appendChild(li);
    }
    // The hints only help when the server couldn't be reached at all.
    (document.getElementById("connect-hints") as HTMLElement).style.display = failed && !signinFailed ? "" : "none";
    (document.getElementById("btn-connect-retry") as HTMLElement).style.display = failed ? "" : "none";
    (document.getElementById("btn-connect-edit") as HTMLElement).style.display = failed ? "" : "none";
    (document.getElementById("btn-connect-cancel") as HTMLElement).style.display = failed ? "none" : "";
    renderServerPill();
}

function beginConnectFlow(address: string, nickname: string): void {
    connectFlow = {
        address,
        nickname,
        steps: { resolve: "active", secure: "pending", signin: "pending", sync: "pending" },
        insecure: false,
        state: "running",
        lastError: "",
    };
    renderConnectCard();
}

/** The flow failed at the step currently running. */
function failConnectFlow(message: string): void {
    const f = connectFlow;
    if (!f) return;
    f.state = "failed";
    f.lastError = message || f.lastError || "The connection failed.";
    const order: (keyof ConnectFlow["steps"])[] = ["resolve", "secure", "signin", "sync"];
    const running = order.find((k) => f.steps[k] === "active") ?? "resolve";
    f.steps[running] = "failed";
    renderConnectCard();
}

/** The title-bar pill while not connected: what the connect is doing (frames 3a/3b). */
function connectPillText(): { text: string; failed: boolean } | null {
    if (!connectFlow) return null;
    if (connectFlow.state === "failed") return { text: "Connection failed", failed: true };
    if (connectFlow.state === "password") return { text: "Waiting for password", failed: false };
    return { text: "Connecting…", failed: false };
}

document.getElementById("btn-connect-retry")?.addEventListener("click", () => {
    showWelcomeForm();
    void startConnect();
});
document.getElementById("btn-connect-edit")?.addEventListener("click", () => {
    showWelcomeForm();
    serverUrlInput.focus();
    serverUrlInput.select();
});
document.getElementById("btn-connect-cancel")?.addEventListener("click", () => {
    api.disconnect();
    showWelcomeForm();
});

// Password required (frame 3b): the join was refused for its password.
const passwordModal = document.getElementById("password-modal") as HTMLDivElement;
const passwordModalInput = document.getElementById("password-modal-input") as HTMLInputElement;
const btnPasswordJoin = document.getElementById("btn-password-join") as HTMLButtonElement;

function askForServerPassword(wrong: boolean): void {
    const f = connectFlow;
    if (!f) return;
    f.state = "password";
    f.steps.signin = "active";
    renderConnectCard();
    (document.getElementById("password-modal-host") as HTMLElement).textContent = f.address;
    (document.getElementById("password-modal-nick") as HTMLElement).textContent = f.nickname;
    (document.getElementById("password-modal-error") as HTMLElement).textContent = wrong ? "That password wasn't accepted." : "";
    (document.getElementById("password-modal-remember") as HTMLInputElement).checked = rememberMeCheckbox.checked;
    passwordModalInput.value = "";
    btnPasswordJoin.disabled = true;
    passwordModal.classList.add("visible");
    passwordModalInput.focus();
}

function closePasswordModal(): void {
    passwordModal.classList.remove("visible");
}

passwordModalInput.addEventListener("input", () => {
    btnPasswordJoin.disabled = passwordModalInput.value.length === 0;
});
passwordModalInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !btnPasswordJoin.disabled) btnPasswordJoin.click();
    if (e.key === "Escape") document.getElementById("btn-password-cancel")?.click();
});
btnPasswordJoin.addEventListener("click", () => {
    serverPasswordInput.value = passwordModalInput.value;
    // Remembering the password means remembering the server it belongs to.
    if ((document.getElementById("password-modal-remember") as HTMLInputElement).checked) rememberMeCheckbox.checked = true;
    closePasswordModal();
    showWelcomeForm();
    void startConnect();
});
document.getElementById("btn-password-cancel")?.addEventListener("click", () => {
    closePasswordModal();
    showWelcomeForm();
});

btnDisconnect.addEventListener("click", () => {
    api.disconnect();
});

// ── Saved servers, the welcome screen and the rail (PRD 19 C1) ───────────────
// `reson8-saved-servers` replaces the single remembered server. Passwords are
// NEVER stored here: they live in the main process (safeStorage); an entry only
// says `hasPassword`. The address is stored EXACTLY as typed (identityHostOf()
// signs it without the scheme, and AUTH_ALLOWED_HOSTS matches on it) — never
// re-serialised from a parsed host/port.

interface SavedServer {
    id: string;
    address: string;
    name: string;
    nickname: string;
    iconUrl?: string | null;
    iconThumb?: string | null;
    hasPassword?: boolean;
    lastConnected: number;
}

const SAVED_SERVERS_KEY = "reson8-saved-servers";
const MAX_SAVED_SERVERS = 50;
const MAX_THUMB_CHARS = 32 * 1024;
let savedServers: SavedServer[] = [];
/** The saved entry the NEXT connect belongs to (picked from the list, the rail or Edit). */
let selectedSavedServerId: string | null = null;
/** The saved entry the CURRENT connection belongs to (null: connected without Remember). */
let activeSavedServerId: string | null = null;
/** Set when the user picked another server while connected: connect once disconnected. */
let pendingSwitchSavedId: string | null = null;

function savedServerById(id: string): SavedServer | undefined {
    return savedServers.find((s) => s.id === id);
}

function readSavedServers(): SavedServer[] {
    try {
        const raw = JSON.parse(localStorage.getItem(SAVED_SERVERS_KEY) ?? "[]");
        if (!Array.isArray(raw)) return [];
        const out: SavedServer[] = [];
        for (const e of raw) {
            if (!e || typeof e !== "object") continue;
            const o = e as Record<string, unknown>;
            if (typeof o.id !== "string" || typeof o.address !== "string" || typeof o.nickname !== "string") continue;
            out.push({
                id: o.id,
                address: o.address,
                nickname: o.nickname,
                name: typeof o.name === "string" && o.name ? o.name : o.address,
                iconUrl: typeof o.iconUrl === "string" ? o.iconUrl : null,
                iconThumb: typeof o.iconThumb === "string" && o.iconThumb.length <= MAX_THUMB_CHARS ? o.iconThumb : null,
                hasPassword: o.hasPassword === true,
                lastConnected: typeof o.lastConnected === "number" ? o.lastConnected : 0,
            });
        }
        return out.sort((a, b) => b.lastConnected - a.lastConnected).slice(0, MAX_SAVED_SERVERS);
    } catch {
        return [];
    }
}

function writeSavedServers(): void {
    savedServers.sort((a, b) => b.lastConnected - a.lastConnected);
    if (savedServers.length > MAX_SAVED_SERVERS) {
        // Entries cut by the cap lose their stored password too.
        for (const dropped of savedServers.slice(MAX_SAVED_SERVERS)) void api.savedPassword.delete(dropped.id);
        savedServers = savedServers.slice(0, MAX_SAVED_SERVERS);
    }
    try {
        localStorage.setItem(SAVED_SERVERS_KEY, JSON.stringify(savedServers));
    } catch {
        /* storage unavailable (or full): the list simply is not remembered */
    }
}

/** The host a name falls back to: the address without a scheme. */
function addressToHostLabel(address: string): string {
    return address.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "");
}

/** "just now", "5 minutes ago", "3 days ago". */
function relativeTime(ms: number): string {
    if (!ms) return "never";
    const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (sec < 45) return "just now";
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
    const day = Math.round(hr / 24);
    if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
    return new Date(ms).toLocaleDateString();
}

/** Up to two initials of a server name. */
function serverInitials(name: string): string {
    const words = name.trim().split(/[\s._-]+/).filter(Boolean);
    const letters = words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
    return letters.toUpperCase();
}

/**
 * The ONE place a server's avatar is drawn (PRD 19 C1/C5): its icon when there
 * is one (a thumbnail data URL or a resolved URL), else the initials on
 * `--color-accent-900`. The initials stay underneath, so a broken image falls
 * back to them.
 */
function serverAvatarElement(name: string, imageUrl: string | null | undefined, size: number): HTMLElement {
    const el = document.createElement("span");
    el.className = "server-avatar";
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.fontSize = `${Math.max(10, Math.round(size * 0.38))}px`;
    el.textContent = serverInitials(name);
    if (imageUrl) {
        const img = document.createElement("img");
        img.alt = "";
        img.addEventListener("error", () => img.remove());
        img.src = imageUrl;
        el.appendChild(img);
    }
    return el;
}

function welcomeStatus(text: string, kind: "" | "error" | "success"): void {
    const el = document.getElementById("welcome-status");
    if (!el) return;
    el.textContent = text;
    el.className = kind;
}

/** Fills the form from a saved entry (the next connect then belongs to it). */
function fillFormFromSaved(entry: SavedServer): void {
    serverUrlInput.value = entry.address;
    nicknameInput.value = entry.nickname;
    serverPasswordInput.value = ""; // a stored password is used by the preload, never shown
    rememberMeCheckbox.checked = true;
    selectedSavedServerId = entry.id;
    serverPasswordInput.placeholder = entry.hasPassword ? "Saved password" : "Optional";
}

function connectSavedServer(id: string): void {
    const entry = savedServerById(id);
    if (!entry) return;
    if (isConnected || connectInProgress) {
        if (activeSavedServerId === id && isConnected) return; // already there
        // Switching: the full disconnect path, then connect once it has finished.
        pendingSwitchSavedId = id;
        api.disconnect();
        return;
    }
    fillFormFromSaved(entry);
    void startConnect();
}

function removeSavedServer(id: string): void {
    savedServers = savedServers.filter((s) => s.id !== id);
    void api.savedPassword.delete(id);
    if (selectedSavedServerId === id) selectedSavedServerId = null;
    writeSavedServers();
    renderSavedServers();
}

/** Last probe result per saved address (PRD 20 W1): number = ms, null = offline, undefined = not yet. */
const savedLatency = new Map<string, number | null>();
let savedProbeTimer: ReturnType<typeof setInterval> | null = null;

function paintSavedPing(el: HTMLElement, value: number | null | undefined): void {
    el.classList.remove("good", "warn", "bad", "offline");
    if (value === undefined) {
        el.textContent = "";
        return;
    }
    if (value === null) {
        el.textContent = "Offline";
        el.classList.add("offline");
        return;
    }
    el.textContent = `${value} ms`;
    el.classList.add(value <= 80 ? "good" : value <= 150 ? "warn" : "bad");
}

function probeSavedServers(): void {
    if (isConnected || connectInProgress) return;
    for (const entry of savedServers) {
        void api.probeServerLatency(entry.address).then(({ ms }) => {
            savedLatency.set(entry.address, ms);
            document.querySelectorAll<HTMLElement>(".saved-row-ping").forEach((el) => {
                if (el.dataset.address === entry.address) paintSavedPing(el, ms);
            });
        });
    }
}

/** Probes now and every 60 s while the welcome screen is up; stops once connected. */
function startSavedServerProbes(): void {
    probeSavedServers();
    if (savedProbeTimer === null) savedProbeTimer = setInterval(probeSavedServers, 60_000);
}

function stopSavedServerProbes(): void {
    if (savedProbeTimer !== null) clearInterval(savedProbeTimer);
    savedProbeTimer = null;
}

function renderSavedServers(): void {
    // The welcome list
    const list = document.getElementById("saved-server-list") as HTMLElement;
    const empty = document.getElementById("saved-server-empty") as HTMLElement;
    list.textContent = "";
    empty.style.display = savedServers.length === 0 ? "" : "none";
    (document.getElementById("saved-server-label") as HTMLElement).style.display = savedServers.length === 0 ? "none" : "";
    // "Welcome back" once there is something to come back to (frames 2a/2b).
    (document.getElementById("welcome-title") as HTMLElement).textContent =
        savedServers.length > 0 ? "Welcome back" : "Welcome to Reson8";
    (document.getElementById("welcome-lead") as HTMLElement).textContent =
        savedServers.length > 0
            ? "Pick a saved server or connect somewhere new."
            : "Connect to any Reson8 server — the official one, a friend's, or one you host yourself.";
    for (const entry of savedServers) {
        const row = document.createElement("div");
        row.className = "saved-row";
        row.setAttribute("role", "button");
        row.tabIndex = 0;
        row.appendChild(serverAvatarElement(entry.name, entry.iconThumb ?? entry.iconUrl, 40));

        const main = document.createElement("div");
        main.className = "saved-row-main";
        const name = document.createElement("div");
        name.className = "saved-row-name";
        name.textContent = entry.name;
        const addr = document.createElement("div");
        addr.className = "saved-row-address";
        addr.textContent = entry.address;
        main.append(name, addr);

        // "as {nickname} · Last connected …" on the right, then Connect and a ⋯ menu
        // (Edit / Remove) — the frame (2b) shows only Connect (PRD 19 R1).
        const meta = document.createElement("div");
        meta.className = "saved-row-meta";
        const metaWhen = document.createElement("div");
        metaWhen.textContent = `as ${entry.nickname} · Last connected ${relativeTime(entry.lastConnected)}`;
        const metaPing = document.createElement("div");
        metaPing.className = "saved-row-ping";
        metaPing.dataset.address = entry.address;
        paintSavedPing(metaPing, savedLatency.get(entry.address));
        meta.append(metaWhen, metaPing);

        const actions = document.createElement("div");
        actions.className = "saved-row-actions";
        const connect = document.createElement("button");
        connect.className = "btn btn-secondary";
        connect.textContent = "Connect";
        connect.addEventListener("click", (e) => {
            e.stopPropagation();
            connectSavedServer(entry.id);
        });
        const more = document.createElement("button");
        more.className = "btn-icon saved-row-more";
        more.title = "More";
        more.setAttribute("aria-label", `More options for ${entry.name}`);
        more.innerHTML = `<i class="ph ph-dots-three" aria-hidden="true"></i>`;
        const openRowMenu = (x: number, y: number): void =>
            openMenu(
                [
                    {
                        label: "Edit details",
                        icon: "ph-pencil-simple",
                        onClick: () => {
                            showWelcomeForm();
                            fillFormFromSaved(entry);
                            serverUrlInput.focus();
                        },
                    },
                    { divider: true },
                    { label: "Remove", icon: "ph-trash", danger: true, onClick: () => removeSavedServer(entry.id) },
                ],
                x,
                y,
                { anchor: more },
            );
        more.addEventListener("click", (e) => {
            e.stopPropagation();
            const r = more.getBoundingClientRect();
            openRowMenu(Math.max(8, r.right - 200), r.bottom + 4);
        });
        row.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            openRowMenu(e.clientX, e.clientY);
        });
        actions.append(connect, more);

        row.append(main, meta, actions);
        row.addEventListener("click", () => connectSavedServer(entry.id));
        row.addEventListener("keydown", (e) => {
            if (e.key === "Enter") connectSavedServer(entry.id);
        });
        list.appendChild(row);
    }

    // The rail tiles
    const rail = document.getElementById("rail-server-list") as HTMLElement;
    rail.textContent = "";
    for (const entry of savedServers) {
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "rail-tile" + (isConnected && activeSavedServerId === entry.id ? " active" : "");
        tile.title = `${entry.name} — ${entry.address}`;
        tile.setAttribute("aria-label", entry.name);
        tile.appendChild(serverAvatarElement(entry.name, entry.iconThumb ?? entry.iconUrl, 36));
        tile.addEventListener("click", () => connectSavedServer(entry.id));
        rail.appendChild(tile);
    }
}

/** An image URL -> an 80x80 PNG data URL (PRD 19 C1/Q7), or null on any failure / over the size cap. */
async function makeIconThumbnail(url: string): Promise<string | null> {
    try {
        const res = await api.fetchImageBytes(url);
        if (!res.success || !res.bytes) return null;
        const bitmap = await createImageBitmap(new Blob([res.bytes as BlobPart]));
        const canvas = document.createElement("canvas");
        canvas.width = 80;
        canvas.height = 80;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        // cover-fit, centred
        const side = Math.min(bitmap.width, bitmap.height);
        ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 80, 80);
        bitmap.close();
        const data = canvas.toDataURL("image/png");
        return data.length <= MAX_THUMB_CHARS ? data : null;
    } catch {
        return null;
    }
}

/** Writes the connected server's name and icon into its saved entry (PRD 19 C1 step 7). */
async function refreshSavedServerMeta(name: string | null | undefined, iconUrl: string | null | undefined): Promise<void> {
    if (!activeSavedServerId) return;
    const entry = savedServerById(activeSavedServerId);
    if (!entry) return;
    let changed = false;
    if (name && entry.name !== name) {
        entry.name = name;
        changed = true;
    }
    if (iconUrl === null && (entry.iconUrl || entry.iconThumb)) {
        entry.iconUrl = null;
        entry.iconThumb = null;
        changed = true;
    } else if (iconUrl && iconUrl !== entry.iconUrl) {
        entry.iconUrl = iconUrl;
        changed = true;
        const thumb = await makeIconThumbnail(iconUrl);
        if (thumb) entry.iconThumb = thumb; // on failure the old thumbnail stays
    }
    if (changed) {
        writeSavedServers();
        renderSavedServers();
    }
}

/** On `connected`: save/update the entry when Remember is ticked (so a failed connect never creates one). */
function onSavedServerConnected(): void {
    const address = serverUrlInput.value.trim();
    const nickname = nicknameInput.value.trim() || "User";
    activeSavedServerId = null;
    if (rememberMeCheckbox.checked && address) {
        let entry = selectedSavedServerId ? savedServerById(selectedSavedServerId) : undefined;
        entry ??= savedServers.find((s) => s.address === address && s.nickname === nickname);
        if (entry) {
            entry.address = address; // an Edit may have changed them
            entry.nickname = nickname;
        } else {
            entry = {
                id: crypto.randomUUID(),
                address,
                name: addressToHostLabel(address),
                nickname,
                iconUrl: null,
                iconThumb: null,
                hasPassword: false,
                lastConnected: Date.now(),
            };
            savedServers.push(entry);
        }
        entry.lastConnected = Date.now();
        activeSavedServerId = entry.id;
        selectedSavedServerId = entry.id;
        const typed = serverPasswordInput.value;
        if (typed) {
            const id = entry.id;
            void api.savedPassword.set(id, typed).then((res) => {
                const e = savedServerById(id);
                if (e) {
                    e.hasPassword = res.stored;
                    writeSavedServers();
                }
                if (!res.stored) {
                    showToast(
                        "This computer cannot store the password securely, so it was not saved. You'll be asked for it next time.",
                        7000,
                    );
                }
            });
        }
        writeSavedServers();
    } else if (selectedSavedServerId && savedServerById(selectedSavedServerId)) {
        // Connected from the saved list without touching Remember: it is still that entry.
        const entry = savedServerById(selectedSavedServerId)!;
        entry.lastConnected = Date.now();
        activeSavedServerId = entry.id;
        writeSavedServers();
    }
    welcomeStatus("", "");
    renderSavedServers();
}

function onSavedServerDisconnected(): void {
    activeSavedServerId = null;
    renderSavedServers();
    const next = pendingSwitchSavedId;
    pendingSwitchSavedId = null;
    if (next) setTimeout(() => connectSavedServer(next), 50); // after the disconnect fully settled
}

// ── Title-bar server pill and switcher (PRD 19 C2) ───────────────────────────

/** Reflects the connection in the pill: "Not connected", or the server's name with a green dot. */
function renderServerPill(): void {
    const text = document.getElementById("server-pill-text");
    const dot = document.getElementById("server-pill-dot");
    if (!text || !dot) return;
    const saved = activeSavedServerId ? savedServerById(activeSavedServerId) : undefined;
    const flow = isConnected ? null : connectPillText(); // PRD 19 R1: what a connect is doing
    if (isConnected) {
        text.textContent = currentConnection
            ? displayAddress(currentConnection.host, currentConnection.port)
            : connectedServerName || saved?.name || "Connected";
    } else {
        text.textContent = flow?.text ?? "Not connected";
    }
    const user = document.getElementById("server-pill-user");
    const nick = document.getElementById("server-pill-nick");
    if (user && nick) {
        user.hidden = !isConnected;
        nick.textContent = isConnected ? connectedNickname : "";
    }
    const pill = document.getElementById("server-pill");
    if (pill) pill.title = isConnected ? `${connectedServerName ?? ""} — ${text.textContent} as ${connectedNickname}`.replace(/^ — /, "") : "";
    dot.classList.toggle("connected", isConnected);
    dot.classList.toggle("failed", !!flow?.failed);
}

/** The popover under the pill: saved servers (active ticked), Disconnect, Add a server… */
function openServerSwitcher(): void {
    const pill = document.getElementById("server-pill") as HTMLElement;
    const rect = pill.getBoundingClientRect();
    const items: MenuItem[] = [];
    if (savedServers.length > 0) {
        items.push({ heading: "Servers" });
        for (const entry of savedServers) {
            items.push({
                label: entry.name,
                sublabel: entry.address,
                avatar: { name: entry.name, url: entry.iconThumb ?? entry.iconUrl },
                checked: isConnected && activeSavedServerId === entry.id,
                onClick: () => connectSavedServer(entry.id),
            });
        }
        items.push({ divider: true });
    }
    if (isConnected) {
        items.push({ label: "Disconnect", icon: "ph-plugs", danger: true, onClick: () => api.disconnect() });
    }
    items.push({
        label: "Add a server…",
        icon: "ph-plus",
        onClick: () => (document.getElementById("rail-add") as HTMLButtonElement).click(),
    });
    openMenu(items, rect.left + rect.width / 2, rect.bottom + 6, { anchor: pill, align: "center", minWidth: rect.width });
}

// ── Server header and its menu (PRD 19 C3) ───────────────────────────────────

/** The server's icon URL as the client may use it: the live summary's, else the saved entry's. */
function currentServerIcon(): string | null {
    if (serverSummary?.iconUrl) return serverSummary.iconUrl;
    const saved = activeSavedServerId ? savedServerById(activeSavedServerId) : undefined;
    return saved?.iconThumb ?? saved?.iconUrl ?? null;
}

/** Icon (or initials), name and "{host} · {N} online" in the sidebar header. */
function renderServerHeader(): void {
    const avatarSlot = document.getElementById("header-avatar");
    const nameEl = document.getElementById("header-name");
    const subEl = document.getElementById("header-sub");
    const caret = document.getElementById("header-caret") as HTMLButtonElement | null;
    if (!avatarSlot || !nameEl || !subEl || !caret) return;

    if (!isConnected) {
        avatarSlot.replaceChildren(serverAvatarElement("Reson8", null, 38));
        nameEl.textContent = "Reson8";
        subEl.textContent = "Not connected";
        caret.disabled = true;
        return;
    }
    const saved = activeSavedServerId ? savedServerById(activeSavedServerId) : undefined;
    const name = connectedServerName || saved?.name || (currentConnection ? currentConnection.host : "Server");
    avatarSlot.replaceChildren(serverAvatarElement(name, currentServerIcon(), 38));
    nameEl.textContent = name;
    const host = currentConnection ? displayAddress(currentConnection.host, currentConnection.port) : "";
    subEl.textContent = `${host ? host + " · " : ""}${getOnlineCountForDisplay()} online`;
    caret.disabled = false;
}

/** Which Settings pages the user can reach (PRD 19 C3, decision D3): any of these four rights. */
function canSeeServerSettings(): boolean {
    const flags = [PERM.ADMIN, PERM.MANAGE_ROLES, PERM.BAN_USER, PERM.MANAGE_EMOJIS];
    const answers = flags.map((f) => hasPerm(f));
    if (answers.every((a) => a === null)) return true; // an older server: today's behaviour (the pages gate themselves)
    return answers.some((a) => a === true);
}

/**
 * Settings has two modes (PRD 19 R3): "client" (the gear — this device's own
 * pages) and "server" (the header menu — the server's pages). The tab buttons
 * of the other mode are hidden by CSS; if the active page belongs to the
 * other mode, the first page of this one is shown.
 */
function setSettingsMode(mode: "client" | "server"): void {
    adminModal.dataset.mode = mode;
    const serverName = connectedServerName ?? "This server";
    (document.getElementById("settings-nav-title") as HTMLElement).textContent = mode === "server" ? serverName : "Settings";
    (document.getElementById("settings-nav-sub") as HTMLElement).textContent =
        mode === "server" ? "Server settings" : "Saved on this device. Server options live in the server menu.";
    (document.getElementById("settings-nav-avatar") as HTMLElement).replaceChildren(
        ...(mode === "server" ? [serverAvatarElement(serverName, currentServerIcon(), 36)] : []),
    );
    const active = document.querySelector<HTMLElement>(".settings-tab-btn.active");
    const inMode = (b: Element | null): boolean => b?.closest(".settings-nav-group")?.getAttribute("data-nav-mode") === mode;
    if (!inMode(active)) {
        const first = Array.from(document.querySelectorAll<HTMLButtonElement>(`.settings-nav-group[data-nav-mode="${mode}"] .settings-tab-btn`))
            .find((b) => b.style.display !== "none");
        if (first) first.click();
        else showSettingsPanelOnly(mode === "server" ? "server-none" : "voice");
    }
}

/** Shows one panel with no tab button active (the server-mode empty state). */
function showSettingsPanelOnly(key: string): void {
    document.querySelectorAll(".settings-tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".settings-panel").forEach((p) => p.classList.remove("active"));
    document.querySelector(`.settings-panel[data-settings-panel="${key}"]`)?.classList.add("active");
}

/** The gear: this device's settings. */
function openClientSettings(page?: string): void {
    setSettingsMode("client");
    void openSettingsPanel();
    if (page) (document.querySelector(`.settings-tab-btn[data-settings-tab="${page}"]`) as HTMLButtonElement | null)?.click();
}

/** Opens Settings on the first server page the user may use. */
function openServerSettings(): void {
    setSettingsMode("server");
    void openSettingsPanel();
    for (const id of ["settings-tab-server", "settings-tab-roles", "settings-tab-joining", "settings-tab-bans", "settings-tab-emojis"]) {
        const btn = document.getElementById(id) as HTMLButtonElement | null;
        if (btn && btn.style.display !== "none") {
            btn.click();
            return;
        }
    }
}

function openServerHeaderMenu(): void {
    const caret = document.getElementById("header-caret") as HTMLElement;
    const rect = caret.getBoundingClientRect();
    const items: MenuItem[] = [];
    items.push({
        label: `About ${connectedServerName ?? "server"}`,
        icon: "ph-info",
        onClick: () => void openAboutServer(),
    });
    items.push({
        label: "Copy server address",
        icon: "ph-copy",
        onClick: () => {
            const saved = activeSavedServerId ? savedServerById(activeSavedServerId) : undefined;
            const address = saved?.address ?? serverUrlInput.value.trim();
            void api.copyText(address).then((ok) => showToast(ok ? "Server address copied" : "Couldn't copy the address"));
        },
    });

    const canCreate = hasPerm(PERM.CREATE_CHANNEL);
    const showSettings = canSeeServerSettings();
    if (canCreate !== false || showSettings) items.push({ divider: true });
    if (canCreate !== false) {
        items.push({ label: "Create channel", icon: "ph-plus-circle", onClick: () => btnCreateChannel.click() });
    }
    if (showSettings) {
        items.push({
            label: "Server settings",
            icon: "ph-sliders",
            hint: pendingApprovals.length > 0 ? String(pendingApprovals.length) : undefined,
            onClick: () => openServerSettings(),
        });
    }
    openMenu(items, Math.max(8, rect.right - 220), rect.bottom + 6, { anchor: caret });
}

// ── About {server} (PRD 19 C4) ───────────────────────────────────────────────

const aboutModal = document.getElementById("about-server-modal") as HTMLDivElement;
/** The old-server fallback: what GET_SERVER_SETTINGS says (name, Nudge, Screen sharing). */
let aboutFallback: { name?: string; nudge?: boolean; screenShare?: boolean } | null = null;

/** Bars for a latency: < 40 ms Excellent (4), < 90 Good (3), < 160 Slow (2), otherwise 1. */
function latencyBars(ms: number): { bars: number; label: string } {
    if (ms < 40) return { bars: 4, label: "Excellent" };
    if (ms < 90) return { bars: 3, label: "Good" };
    if (ms < 160) return { bars: 2, label: "Slow" };
    return { bars: 1, label: "Poor" };
}

function renderAboutLatency(ms: number | null): void {
    const text = document.getElementById("about-latency") as HTMLElement;
    const note = document.getElementById("about-latency-note") as HTMLElement;
    const bars = Array.from(document.querySelectorAll<HTMLElement>("#about-bars i"));
    if (ms === null) {
        text.textContent = "—";
        note.textContent = "No answer";
        bars.forEach((b) => b.classList.remove("on"));
        return;
    }
    const q = latencyBars(ms);
    text.textContent = `${ms} ms`;
    note.textContent = q.label;
    bars.forEach((b, i) => b.classList.toggle("on", i < q.bars));
}

async function measureAboutLatency(): Promise<void> {
    const btn = document.getElementById("btn-about-latency") as HTMLButtonElement;
    if (btn.classList.contains("spinning")) return;
    btn.classList.add("spinning");
    btn.disabled = true;
    try {
        renderAboutLatency(await api.measureLatency(3));
    } finally {
        btn.classList.remove("spinning");
        btn.disabled = false;
    }
}

/** Builds the dialog's content from the current summary (or the old-server fallback). Text only. */
function renderAboutServer(): void {
    const sum = serverSummary;
    const saved = activeSavedServerId ? savedServerById(activeSavedServerId) : undefined;
    const name = sum?.name ?? aboutFallback?.name ?? connectedServerName ?? saved?.name ?? "Server";
    (document.getElementById("about-server-name") as HTMLElement).textContent = name;
    (document.getElementById("about-server-avatar") as HTMLElement).replaceChildren(
        serverAvatarElement(name, currentServerIcon(), 48),
    );
    const address = saved?.address ?? serverUrlInput.value.trim();
    (document.getElementById("about-server-address") as HTMLElement).textContent = address;

    (document.getElementById("about-connection") as HTMLElement).textContent =
        currentConnection?.scheme === "https" ? "Encrypted" : "Not encrypted";

    // People + Admins need the summary; an older server only gets the notice.
    const peopleCard = document.getElementById("about-people-card") as HTMLElement;
    const adminsSection = document.getElementById("about-admins-section") as HTMLElement;
    const oldNote = document.getElementById("about-old-note") as HTMLElement;
    if (sum) {
        peopleCard.style.display = "";
        adminsSection.style.display = "";
        oldNote.style.display = "none";
        const online = getOnlineCountForDisplay();
        (document.getElementById("about-people") as HTMLElement).textContent = `${online} online of ${sum.memberCount}`;
        (document.getElementById("about-people-fill") as HTMLElement).style.width =
            `${sum.memberCount > 0 ? Math.min(100, Math.round((online / sum.memberCount) * 100)) : 0}%`;

        const chips = document.getElementById("about-admins") as HTMLElement;
        chips.textContent = "";
        const myId = api.getInstanceId();
        for (const admin of sum.admins) {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "about-chip";
            chip.appendChild(createAvatarElement(admin.userId, admin.nickname, 26));
            const label = document.createElement("span");
            label.textContent = admin.userId === myId ? `${admin.nickname} (you)` : admin.nickname;
            const dot = document.createElement("span");
            dot.className = "about-online-dot" + (admin.isOnline ? " on" : "");
            chip.append(label, dot);
            chip.addEventListener("click", () => {
                closeAboutServer();
                openUserProfile(admin.userId, admin.nickname, null);
            });
            chips.appendChild(chip);
        }
        if (sum.admins.length === 0) chips.textContent = "No admins listed";
    } else {
        peopleCard.style.display = "none";
        adminsSection.style.display = "none";
        oldNote.style.display = "";
    }

    // Features: always five rows; an older server cannot say the join gates.
    const f = sum?.features;
    const rows: [string, boolean | null][] = [
        ["Nudge", f ? f.nudge : aboutFallback?.nudge ?? null],
        ["Screen sharing", f ? f.screenShare : aboutFallback?.screenShare ?? null],
        ["Approval to join", f ? f.requireApproval : null],
        ["Invite code required", f ? f.requireInvite : null],
        ["Signed identity required", f ? f.requireSignedIdentity : null],
    ];
    const list = document.getElementById("about-features") as HTMLElement;
    list.textContent = "";
    let on = 0;
    for (const [label, value] of rows) {
        const row = document.createElement("div");
        row.className = "about-feature-row";
        const l = document.createElement("span");
        l.textContent = label;
        const st = document.createElement("span");
        st.className = "state" + (value ? " on" : "");
        st.textContent = value === null ? "Unknown" : value ? "On" : "Off";
        row.append(l, st);
        list.appendChild(row);
        if (value) on++;
    }
    (document.getElementById("about-features-count") as HTMLElement).textContent = `${on} of ${rows.length} on`;
}

function closeAboutServer(): void {
    aboutModal.classList.remove("visible");
}

async function openAboutServer(): Promise<void> {
    if (!isConnected) return;
    aboutModal.classList.add("visible");
    renderAboutLatency(null);
    (document.getElementById("about-latency") as HTMLElement).textContent = "…";
    renderAboutServer();
    // Fresh data every time it opens (the 2 s debounce must not make About stale).
    const fresh = await api.getServerSummary();
    if (fresh) serverSummary = fresh;
    if (!fresh) {
        const settings = await api.getServerSettings();
        if (settings.success) {
            aboutFallback = { name: settings.name, nudge: settings.nudgeEnabled, screenShare: settings.screenShareEnabled };
        }
    }
    if (aboutModal.classList.contains("visible")) renderAboutServer();
    void measureAboutLatency();
}

document.getElementById("btn-about-close")?.addEventListener("click", closeAboutServer);
aboutModal.addEventListener("click", (e) => {
    if (e.target === aboutModal) closeAboutServer();
});
document.getElementById("btn-about-latency")?.addEventListener("click", () => void measureAboutLatency());
document.getElementById("btn-about-copy")?.addEventListener("click", () => {
    const address = (document.getElementById("about-server-address") as HTMLElement).textContent ?? "";
    void api.copyText(address).then((ok) => showToast(ok ? "Server address copied" : "Couldn't copy the address"));
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && aboutModal.classList.contains("visible") && !openMenuState) closeAboutServer();
});

/** One-time move of the single remembered server (v2.7.0 and older) into the list. */
function migrateLegacyRememberedServer(): void {
    try {
        if (localStorage.getItem("reson8-remember-me") !== "true") return;
        const url = localStorage.getItem("reson8-server-url");
        const nick = localStorage.getItem("reson8-nickname");
        const pw = localStorage.getItem("reson8-server-password");
        // The plaintext keys are removed whatever happens next.
        for (const k of ["reson8-remember-me", "reson8-server-url", "reson8-nickname", "reson8-server-password"]) {
            localStorage.removeItem(k);
        }
        if (!url) return;
        const entry: SavedServer = {
            id: crypto.randomUUID(),
            address: url,
            name: addressToHostLabel(url),
            nickname: nick || "User",
            hasPassword: false,
            lastConnected: Date.now(),
        };
        savedServers.push(entry);
        writeSavedServers();
        if (pw) {
            void api.savedPassword.set(entry.id, pw).then((res) => {
                if (res.stored) {
                    entry.hasPassword = true;
                    writeSavedServers();
                } else {
                    showToast(
                        "Your saved server password couldn't be stored securely and was removed. You'll be asked for it next time.",
                        9000,
                    );
                }
            });
        }
    } catch {
        /* nothing to migrate */
    }
}

function initSavedServers(): void {
    savedServers = readSavedServers();
    migrateLegacyRememberedServer();
    renderSavedServers();
    startSavedServerProbes(); // PRD 20 W1
    // Pre-fill the form from the most recent entry (what "Remember" used to do).
    const latest = savedServers[0];
    if (latest) fillFormFromSaved(latest);
    // Editing the address or nickname makes it a different target than the picked entry.
    for (const input of [serverUrlInput, nicknameInput]) {
        input.addEventListener("input", () => {
            const picked = selectedSavedServerId ? savedServerById(selectedSavedServerId) : undefined;
            if (picked && (picked.address !== serverUrlInput.value.trim() || picked.nickname !== nicknameInput.value.trim())) {
                // Keep the entry (an Edit updates it on connect) but stop using its stored password.
                serverPasswordInput.placeholder = "Password (optional)";
            }
        });
    }
    // Enter in the form connects.
    for (const input of [serverUrlInput, nicknameInput, serverPasswordInput, document.getElementById("invite-code") as HTMLInputElement]) {
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") void startConnect();
        });
    }
    document.getElementById("server-pill")?.addEventListener("click", () => openServerSwitcher());
    document.getElementById("header-caret")?.addEventListener("click", () => openServerHeaderMenu());
    renderServerHeader();
    document.getElementById("rail-add")?.addEventListener("click", () => {
        if (isConnected) {
            // Adding another server: disconnect first, then land on the empty form.
            selectedSavedServerId = null;
            serverUrlInput.value = "";
            serverPasswordInput.value = "";
            rememberMeCheckbox.checked = true;
            api.disconnect();
        } else {
            selectedSavedServerId = null;
            serverUrlInput.value = "";
            serverPasswordInput.value = "";
            rememberMeCheckbox.checked = true;
        }
        setTimeout(() => serverUrlInput.focus(), 0);
    });
}

initSavedServers();

// ── Channel Tree Rendering ────────────────────────────────────────────────

interface TreeNode {
    id: string;
    name: string;
    type: "TEXT" | "VOICE";
    parentId: string | null;
    isNsfw?: boolean;
    hasUnread?: boolean;
    /** PRD 19 A5/B1: capped unread count from the join-time tree (absent from an older server). */
    unreadCount?: number;
    /** Custom tree icon (PRD 14.7, text channels only) — mutually
     *  exclusive with `iconUrl`; falls back to the default 💬 icon when
     *  both are null/undefined. */
    iconEmoji?: string | null;
    iconUrl?: string | null;
    children: TreeNode[];
    occupants: { userId: string; nickname: string; isMuted?: boolean; isDeafened?: boolean; isSharingScreen?: boolean }[];
    /** Voice rooms: the user limit, null/absent = unlimited (PRD 19 C9's "{n} / {cap}"). */
    maxUsers?: number | null;
    /** Voice rooms (PRD 19 A3): when the running session began (ISO); absent for an empty room or an older server. */
    sessionStartedAt?: string;
}

function findChannelNodeById(nodes: TreeNode[], id: string): TreeNode | null {
    for (const node of nodes) {
        if (node.id === id) return node;
        if (node.children.length > 0) {
            const found = findChannelNodeById(node.children, id);
            if (found) return found;
        }
    }
    return null;
}

function renderTree(tree: TreeNode[]): void {
    currentTree = tree;
    for (const channelId of chatTabs.keys()) syncTabNsfwClass(channelId); // PRD 18.11
    channelTree.innerHTML = "";

    if (tree.length === 0) {
        channelTree.innerHTML = `
            <div style="padding: 20px 12px; color: var(--color-neutral-500); font-size: 12px; text-align: center;">
                No channels found
            </div>
        `;
        return;
    }

    for (const node of tree) {
        if (node.children.length > 0) {
            // This node has children — render as a category
            channelTree.appendChild(renderCategory(node, tree));
        } else {
            // Leaf channel at root level
            channelTree.appendChild(renderChannel(node, tree));
            renderOccupants(channelTree, node);
        }
    }

    updateParentSelect(tree);
}

// Currently-dragged channel/category ID (PRD 4.6, admin-only sibling reordering).
let draggedChannelId: string | null = null;

/**
 * Wires HTML5 drag-and-drop reordering onto a channel-tree row. `siblings` is
 * the exact array `node` belongs to (the `tree` array for root nodes, or a
 * category's `children` array) — dropping onto another row in the same array
 * reorders the whole array and persists it via REORDER_CHANNELS. Admin-only;
 * a no-op for everyone else so non-admins see no drag affordance at all.
 */
function attachChannelDragHandlers(el: HTMLElement, node: TreeNode, siblings: TreeNode[]): void {
    if (!isAdminUser) return;

    el.classList.add("draggable-channel");
    el.draggable = true;

    el.addEventListener("dragstart", (e) => {
        draggedChannelId = node.id;
        e.dataTransfer?.setData("text/plain", node.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });

    el.addEventListener("dragover", (e) => {
        if (!draggedChannelId || draggedChannelId === node.id) return;
        if (!siblings.some((s) => s.id === draggedChannelId)) return;
        e.preventDefault();
        el.classList.add("drag-over");
    });

    el.addEventListener("dragleave", () => {
        el.classList.remove("drag-over");
    });

    el.addEventListener("drop", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.remove("drag-over");

        const draggedId = draggedChannelId;
        draggedChannelId = null;
        if (!draggedId || draggedId === node.id) return;
        if (!siblings.some((s) => s.id === draggedId)) return;

        const orderedIds = siblings.map((s) => s.id).filter((id) => id !== draggedId);
        const insertIdx = orderedIds.indexOf(node.id);
        orderedIds.splice(insertIdx === -1 ? orderedIds.length : insertIdx, 0, draggedId);

        const result = await api.reorderChannels(node.parentId, orderedIds);
        if (!result.success) {
            log(`Failed to reorder channels: ${result.error}`, "error");
            if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
        }
    });

    el.addEventListener("dragend", () => {
        draggedChannelId = null;
        document.querySelectorAll(".drag-over").forEach((n) => n.classList.remove("drag-over"));
    });
}

/** Categories the user collapsed, for this session (PRD 19 C6). */
const collapsedCategoryIds = new Set<string>();

function renderCategory(node: TreeNode, siblings: TreeNode[]): HTMLDivElement {
    const category = document.createElement("div");
    category.className = "tree-category";

    // Every parent shows the same "Category" badge, whatever it started as
    // (PRD 18.15). A voice channel that gains a child stays non-joinable (PRD
    // 14.6) and a text parent's label only toggles collapse — the tooltip says
    // which of the two it is.
    const badgeTitle =
        node.type === "VOICE"
            ? "A voice channel with sub-channels can't be joined directly"
            : "A text channel with sub-channels works as a category: clicking it expands or collapses it, and its own chat isn't opened from the tree";
    const badge = `<span class="category-badge" title="${escapeHtml(badgeTitle)}">Category</span>`;

    const label = document.createElement("div");
    label.className = "tree-category-label";
    label.innerHTML = `<span class="arrow">▾</span> ${escapeHtml(node.name)}${badge}`;
    // A rebuilt tree (a rename, a presence change) must not re-expand what the
    // user collapsed, so the state lives in a set keyed by channel id (PRD 19 C6).
    if (collapsedCategoryIds.has(node.id)) category.classList.add("collapsed");
    label.addEventListener("click", () => {
        const collapsed = category.classList.toggle("collapsed");
        if (collapsed) collapsedCategoryIds.add(node.id);
        else collapsedCategoryIds.delete(node.id);
    });
    attachChannelDragHandlers(label, node, siblings);
    attachCategoryContextMenu(label, node);
    category.appendChild(label);

    const children = document.createElement("div");
    children.className = "tree-children";

    for (const child of node.children) {
        if (child.children.length > 0) {
            children.appendChild(renderCategory(child, node.children));
        } else {
            children.appendChild(renderChannel(child, node.children));
            renderOccupants(children, child);
        }
    }

    category.appendChild(children);
    return category;
}

// ── Muted text channels (PRD 16.4) ─────────────────────────────────────────
// A purely local, per-user preference — no server round trip, no permission.
// Stored as { [serverId]: channelId[] } so connecting to another Reson8
// server never mixes lists. Unread state keeps being tracked while muted
// (unreadChannelCounts / the server's read cursor are untouched); muting only
// suppresses how it's painted, so unmuting reveals what arrived meanwhile.
const MUTED_CHANNELS_KEY = "reson8-muted-channels";
let mutedChannelIds = new Set<string>();
let mutedChannelsServerId: string | null = null;

function readMutedChannelsStore(): Record<string, string[]> {
    try {
        const parsed = JSON.parse(localStorage.getItem(MUTED_CHANNELS_KEY) ?? "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const clean: Record<string, string[]> = {};
        for (const [serverId, ids] of Object.entries(parsed)) {
            if (Array.isArray(ids)) clean[serverId] = ids.filter((id): id is string => typeof id === "string");
        }
        return clean;
    } catch {
        return {}; // missing, malformed or storage unavailable — treat as empty
    }
}

function persistMutedChannels(): void {
    if (!mutedChannelsServerId) return;
    try {
        const store = readMutedChannelsStore();
        if (mutedChannelIds.size > 0) store[mutedChannelsServerId] = [...mutedChannelIds];
        else delete store[mutedChannelsServerId];
        localStorage.setItem(MUTED_CHANNELS_KEY, JSON.stringify(store));
    } catch {
        /* storage unavailable — the mute just won't persist */
    }
}

/** Loads the current server's muted set once per server (idempotent). */
function ensureMutedChannelsLoaded(serverId: string): void {
    if (mutedChannelsServerId === serverId) return;
    mutedChannelsServerId = serverId;
    mutedChannelIds = new Set(readMutedChannelsStore()[serverId] ?? []);
}

/** Drops muted ids whose channel no longer exists, so deleted channels don't accumulate. */
function pruneMutedChannels(tree: TreeNode[]): void {
    if (tree.length === 0 || mutedChannelIds.size === 0) return; // an empty tree is a transient state, never prune on it
    const existing = new Set<string>();
    const walk = (nodes: TreeNode[]): void => {
        for (const n of nodes) {
            existing.add(n.id);
            walk(n.children);
        }
    };
    walk(tree);
    let changed = false;
    for (const id of [...mutedChannelIds]) {
        if (!existing.has(id)) {
            mutedChannelIds.delete(id);
            changed = true;
        }
    }
    if (changed) persistMutedChannels();
}

function isChannelMuted(channelId: string): boolean {
    return mutedChannelIds.has(channelId);
}

function setChannelMuted(channelId: string, muted: boolean): void {
    if (muted) mutedChannelIds.add(channelId);
    else mutedChannelIds.delete(channelId);
    persistMutedChannels();
    applyChannelMuteState(channelId);
}

/** Targeted DOM update (no renderTree(), which would reset collapsed categories). */
function applyChannelMuteState(channelId: string): void {
    refreshTabUnread(channelId); // muting hides the tab's dot too; unmuting reveals it (PRD 17.6)
    const el = channelTree.querySelector(`.tree-channel[data-channel-id="${CSS.escape(channelId)}"]`);
    if (!el) return;
    const muted = isChannelMuted(channelId);
    el.classList.toggle("muted", muted);
    setMutedIcon(el, muted, "ch-muted-icon", ".ch-name"); // PRD 19 B2

    const showUnread = hasChannelUnread(channelId) && !muted;
    el.classList.toggle("unread", showUnread);
    // The count keeps counting while muted; unmuting shows it again (PRD 19 B1/B2).
    setUnreadPill(el, showUnread ? channelUnread(channelId) : 0, "unread-count", ".ch-name");
}

/** Muted eye shown at the right of the text channel whose tab is being viewed (PRD 16.3). */
function createViewingIcon(): HTMLSpanElement {
    const icon = document.createElement("span");
    icon.className = "ch-viewing-icon";
    icon.title = "You're viewing this channel";
    icon.setAttribute("aria-label", "Currently viewing");
    icon.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    return icon;
}

/**
 * Moves the "viewing" highlight + eye to the row of the active chat tab
 * (PRD 16.3). A targeted DOM update, not renderTree(): a full re-render
 * would lose collapsed-category state (same reason markChannelUnread()
 * avoids it). Only text-channel rows carry data-channel-id, so the Server
 * Log and DM tabs simply match nothing and clear the highlight.
 */
function updateViewingIndicator(): void {
    channelTree.querySelectorAll(".tree-channel.viewing").forEach((el) => {
        el.classList.remove("viewing");
        el.querySelector(".ch-viewing-icon")?.remove();
    });
    const row = channelTree.querySelector(`.tree-channel[data-channel-id="${CSS.escape(activeTabId)}"]`);
    if (!row) return;
    row.classList.add("viewing");
    row.appendChild(createViewingIcon());
}

function renderChannel(node: TreeNode, siblings: TreeNode[]): HTMLDivElement {
    const channel = document.createElement("div");
    channel.className = "tree-channel";
    if (currentChannelId === node.id) {
        channel.classList.add("active");
    }

    const isVoice = node.type === "VOICE";
    const iconClass = isVoice ? "voice" : "text";

    // Custom text-channel icon (PRD 14.7): an uploaded image takes priority
    // over a custom emoji, which takes priority over the default 💬 — the
    // two are mutually exclusive server-side, so at most one is ever set.
    let icon = isVoice ? "🔊" : "💬";
    let iconIsImage = false;
    if (!isVoice) {
        if (node.iconUrl) {
            icon = node.iconUrl;
            iconIsImage = true;
        } else if (node.iconEmoji) {
            icon = node.iconEmoji;
        }
    }
    const iconHtml = iconIsImage
        ? `<span class="ch-icon ${iconClass} custom-image"><img src="${escapeHtml(icon)}" alt=""></span>`
        : `<span class="ch-icon ${iconClass}">${icon}</span>`;

    const count = node.occupants.length;
    // Count pill (PRD 19 B10): a person icon before the number and a tooltip.
    // A vendored Phosphor glyph (F2).
    const countBadge =
        count > 0
            ? `<span class="ch-count" title="${count === 1 ? "1 person connected" : `${count} people connected`}">` +
              `<i class="ph ph-user ch-count-icon" aria-hidden="true"></i>${count}</span>`
            : "";

    // Session timer badge for active voice sessions. Text is computed
    // synchronously here (not left blank for the setInterval tick below to
    // fill in) so a full renderTree() re-render — e.g. triggered by the
    // sender's own mute/deafen toggle — never blinks the timer to empty.
    let timerBadge = "";
    if (isVoice && sessionTimers.has(node.id)) {
        const startedAt = sessionTimers.get(node.id)!;
        const elapsed = formatDuration(correctedNow() - new Date(startedAt).getTime());
        timerBadge = `<span class="session-timer" data-session-channel="${node.id}">${elapsed}</span>`;
    }

    const nsfwBadge = node.isNsfw ? `<span class="nsfw-badge">NSFW</span>` : "";

    // Unread indicator (text channels only) — seed from the server's
    // per-user flag (only trustworthy on the initial join-time tree, see
    // IChannelTreeNode.hasUnread), then let it persist across re-renders
    // via unreadChannelCounts until the tab is opened.
    if (!isVoice) {
        channel.dataset.channelId = node.id;
        // PRD 19 B1: seed only when there is no entry yet (a re-render must not
        // reset a count that was already incremented live): the server's number,
        // or -1 (unknown) from an older server that only sends the flag.
        if (!hasChannelUnread(node.id) && node.id !== activeTabId) {
            if (node.unreadCount !== undefined && node.unreadCount > 0) unreadChannelCounts.set(node.id, node.unreadCount);
            else if (node.hasUnread) unreadChannelCounts.set(node.id, -1);
        }
        // A muted channel (PRD 16.4) is faded and never paints unread visuals,
        // though the count above keeps tracking it.
        if (isChannelMuted(node.id)) channel.classList.add("muted");
        else if (hasChannelUnread(node.id)) channel.classList.add("unread");
    }
    const unreadDot = !isVoice && hasChannelUnread(node.id) && !isChannelMuted(node.id)
        ? `<span class="unread-count count-pill">${formatUnreadCount(channelUnread(node.id))}</span>`
        : "";

    channel.innerHTML = `
        ${iconHtml}
        <span class="ch-name">${escapeHtml(node.name)}</span>
        ${unreadDot}
        ${nsfwBadge}
        ${timerBadge}
        ${countBadge}
    `;

    if (!isVoice && isChannelMuted(node.id)) setMutedIcon(channel, true, "ch-muted-icon", ".ch-name"); // PRD 19 B2

    // Viewing highlight (PRD 16.3) — appended last so it sits at the far right.
    if (!isVoice && node.id === activeTabId) {
        channel.classList.add("viewing");
        channel.appendChild(createViewingIcon());
    }

    channel.addEventListener("click", () => handleChannelClick(node));
    attachChannelDragHandlers(channel, node, siblings);
    attachChannelContextMenu(channel, node, !isVoice);

    return channel;
}

/**
 * Right-click → Rename / Toggle NSFW (text only) / Delete. Shared by
 * regular channel rows (`renderChannel`) and category/parent rows
 * (`renderCategory`, PRD 14.6) — a category previously had no context menu
 * attached at all once a channel gained a child, even though rename
 * already worked unconditionally server-side via `UPDATE_CHANNEL`.
 * Permission gating is server-side only (same as before this extraction) —
 * the menu is shown to everyone and a rejected action surfaces via the
 * existing "insufficient_perms.mp3" pattern.
 */
function attachChannelContextMenu(el: HTMLElement, node: TreeNode, canMute = false): void {
    const isVoice = node.type === "VOICE";

    el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Who may manage channels (PRD 19 B6): `null` = unknown (an older
        // server) -> today's behaviour, the items show and the server refuses;
        // `false` -> the whole group is absent. Rebuilt on every open, so
        // PERMISSIONS_CHANGED needs no re-render.
        const showManage = hasPerm(PERM.MANAGE_CHANNELS) !== false;
        if (!canMute && !showManage) {
            closeMenu(); // a member on a voice/category row: no empty menu
            return;
        }

        const items: MenuItem[] = [];

        // Keep open and Mute are personal and only offered on an openable text
        // channel (PRD 16.4, 17.5) — never voice channels or category rows.
        if (canMute) {
            const isKept = chatTabs.get(node.id)?.mode === "kept";
            items.push({
                label: isKept ? "Stop keeping open" : "Keep open",
                icon: "ph-bookmark-simple",
                onClick: () => setTabKept(node.id, !isKept),
            });
            const muted = isChannelMuted(node.id);
            items.push({
                label: muted ? "Unmute channel" : "Mute channel",
                icon: muted ? "ph-bell" : "ph-bell-slash",
                onClick: () => setChannelMuted(node.id, !muted),
            });
        }

        if (showManage) {
            if (items.length > 0) items.push({ divider: true });
            items.push({ heading: "Manage channel" });
            items.push({ label: "Rename…", icon: "ph-pencil-simple", onClick: () => showRenameModal(node.id, node.name) });
            if (!isVoice) {
                items.push({ label: "Set icon…", icon: "ph-image", onClick: () => showChannelIconModal(node.id) });
            }
            items.push({ label: "Move to category…", icon: "ph-folder", onClick: () => showMoveModal(node.id, node.name) });
            if (!isVoice) {
                items.push({
                    label: `${node.isNsfw ? "Unmark" : "Mark"} as NSFW`,
                    icon: "ph-prohibit",
                    onClick: async () => {
                        const result = await api.updateChannel(node.id, { isNsfw: !node.isNsfw });
                        if (!result.success) {
                            log(`Failed to update channel: ${result.error}`, "error");
                            if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
                        }
                    },
                });
            }
            items.push({ divider: true });
            items.push({
                label: "Delete channel…",
                icon: "ph-trash",
                danger: true,
                onClick: () => showDeleteModal(node.id, node.name),
            });
        }

        openMenu(items, e.clientX, e.clientY, { anchor: el });
    });
}

// ── Category menu and dialogs (PRD 19 C6) ────────────────────────────────────

/** Right-click on a category row: Manage category › Rename… / Delete…, for channel managers only. */
function attachCategoryContextMenu(el: HTMLElement, node: TreeNode): void {
    el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // `null` = an older server that can't say: show it and let the server refuse (as B6 does).
        if (hasPerm(PERM.MANAGE_CHANNELS) === false) {
            closeMenu();
            return;
        }
        openMenu(
            [
                { heading: "Manage category" },
                { label: "Rename category…", icon: "ph-pencil-simple", onClick: () => openRenameCategory(node.id) },
                { divider: true },
                { label: "Delete category…", icon: "ph-trash", danger: true, onClick: () => openDeleteCategory(node.id) },
            ],
            e.clientX,
            e.clientY,
            { anchor: el },
        );
    });
}

const renameCategoryModal = document.getElementById("rename-category-modal") as HTMLDivElement;
const renameCategoryInput = document.getElementById("rename-category-input") as HTMLInputElement;
const renameCategoryError = document.getElementById("rename-category-error") as HTMLDivElement;
const btnRenameCategoryConfirm = document.getElementById("btn-rename-category-confirm") as HTMLButtonElement;
let renameCategoryId: string | null = null;
let renameCategoryOriginal = "";

/** The names of every other category (nodes with children), lower-cased. */
function otherCategoryNames(exceptId: string): Set<string> {
    const names = new Set<string>();
    const walk = (nodes: TreeNode[]): void => {
        for (const n of nodes) {
            if (n.children.length > 0 && n.id !== exceptId) names.add(n.name.trim().toLowerCase());
            walk(n.children);
        }
    };
    walk(currentTree);
    return names;
}

/** Returns the inline error for the current input, or "" when it can be saved. */
function validateRenameCategory(): string {
    const name = renameCategoryInput.value.trim();
    if (!name) return "Give the category a name.";
    if (renameCategoryId && otherCategoryNames(renameCategoryId).has(name.toLowerCase())) {
        return "Another category is already called that.";
    }
    return "";
}

function refreshRenameCategory(): void {
    const error = validateRenameCategory();
    renameCategoryError.textContent = error;
    btnRenameCategoryConfirm.disabled = !!error || renameCategoryInput.value.trim() === renameCategoryOriginal;
}

function closeRenameCategory(): void {
    renameCategoryModal.classList.remove("visible");
    renameCategoryId = null;
}

function openRenameCategory(categoryId: string): void {
    const node = findChannelNodeById(currentTree, categoryId);
    if (!node) return;
    renameCategoryId = categoryId;
    renameCategoryOriginal = node.name;
    renameCategoryInput.value = node.name;
    refreshRenameCategory();
    renameCategoryError.textContent = ""; // no complaint before the user has typed anything
    renameCategoryModal.classList.add("visible");
    renameCategoryInput.focus();
    renameCategoryInput.select();
}

async function submitRenameCategory(): Promise<void> {
    if (!renameCategoryId || btnRenameCategoryConfirm.disabled) return;
    const id = renameCategoryId;
    const name = renameCategoryInput.value.trim();
    btnRenameCategoryConfirm.disabled = true;
    const result = await api.updateChannel(id, { name });
    if (result.success) {
        closeRenameCategory();
        return;
    }
    renameCategoryError.textContent = result.error ?? "The category couldn't be renamed.";
    if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
    btnRenameCategoryConfirm.disabled = false;
}

renameCategoryInput.addEventListener("input", refreshRenameCategory);
renameCategoryInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        void submitRenameCategory();
    } else if (e.key === "Escape") {
        e.preventDefault();
        closeRenameCategory();
    }
});
btnRenameCategoryConfirm.addEventListener("click", () => void submitRenameCategory());
document.getElementById("btn-rename-category-cancel")?.addEventListener("click", closeRenameCategory);
renameCategoryModal.addEventListener("click", (e) => {
    if (e.target === renameCategoryModal) closeRenameCategory();
});

const deleteCategoryModal = document.getElementById("delete-category-modal") as HTMLDivElement;
const btnDeleteCategoryConfirm = document.getElementById("btn-delete-category-confirm") as HTMLButtonElement;
let deleteCategoryId: string | null = null;

/** Every descendant of a node (not the node itself), as one flat list. */
function descendantsOf(node: TreeNode): TreeNode[] {
    const out: TreeNode[] = [];
    const walk = (n: TreeNode): void => {
        for (const c of n.children) {
            out.push(c);
            walk(c);
        }
    };
    walk(node);
    return out;
}

function deleteCategoryMode(): "keep" | "delete" {
    const checked = deleteCategoryModal.querySelector<HTMLInputElement>('input[name="delete-category-mode"]:checked');
    return checked?.value === "delete" ? "delete" : "keep";
}

/** Rebuilds the counts, the voice warning and the confirm label from the live tree. */
function refreshDeleteCategory(): void {
    const node = deleteCategoryId ? findChannelNodeById(currentTree, deleteCategoryId) : null;
    if (!node) {
        // The category vanished (someone else deleted it): nothing left to confirm.
        deleteCategoryModal.classList.remove("visible");
        deleteCategoryId = null;
        return;
    }
    const all = descendantsOf(node);
    const text = all.filter((c) => c.type === "TEXT").length;
    const voice = all.filter((c) => c.type === "VOICE").length;
    const oldServer = serverSummary === null;

    (document.getElementById("delete-category-title") as HTMLElement).textContent = `Delete ${node.name}?`;
    const summary = document.getElementById("delete-category-summary") as HTMLElement;
    if (all.length === 0) {
        summary.textContent = "The category is empty, so nothing else changes.";
    } else {
        const t = `${text} text ${text === 1 ? "channel" : "channels"}`;
        const v = `${voice} voice ${voice === 1 ? "channel" : "channels"}`;
        summary.textContent = `It holds ${t} and ${v}. Choose what happens to them.`;
    }
    (document.getElementById("delete-category-options") as HTMLElement).style.display = all.length === 0 ? "none" : "";
    // An older server has no "delete the subtree" mode, so the option isn't offered.
    (document.getElementById("delete-category-card-delete") as HTMLElement).style.display = oldServer ? "none" : "";
    (document.getElementById("delete-category-old-note") as HTMLElement).style.display = oldServer && all.length > 0 ? "" : "none";
    if (oldServer) {
        const keep = deleteCategoryModal.querySelector<HTMLInputElement>('input[value="keep"]');
        if (keep) keep.checked = true;
    }

    const mode = all.length === 0 ? "keep" : deleteCategoryMode();
    document.getElementById("delete-category-card-keep")?.classList.toggle("selected", mode === "keep");
    document.getElementById("delete-category-card-delete")?.classList.toggle("selected", mode === "delete");

    const voicePeople = all.reduce((sum, c) => sum + (c.type === "VOICE" ? c.occupants.length : 0), 0);
    const voiceNote = document.getElementById("delete-category-voice") as HTMLElement;
    if (voicePeople > 0 && all.length > 0) {
        voiceNote.textContent =
            `${voicePeople} ${voicePeople === 1 ? "person is" : "people are"} in its voice channels right now and will be disconnected. ` +
            `This only applies if the channels are deleted.`;
        voiceNote.style.display = "";
    } else {
        voiceNote.style.display = "none";
    }

    btnDeleteCategoryConfirm.textContent =
        mode === "delete" && all.length > 0 ? `Delete category and ${all.length} ${all.length === 1 ? "channel" : "channels"}` : "Delete category";
}

async function openDeleteCategory(categoryId: string): Promise<void> {
    if (!findChannelNodeById(currentTree, categoryId)) return;
    // A summary that is still missing right after connect would wrongly look like an older server.
    if (serverSummary === null && isConnected) {
        const fresh = await api.getServerSummary();
        if (fresh) serverSummary = fresh;
    }
    deleteCategoryId = categoryId;
    const keep = deleteCategoryModal.querySelector<HTMLInputElement>('input[value="keep"]');
    if (keep) keep.checked = true;
    refreshDeleteCategory();
    deleteCategoryModal.classList.add("visible");
}

function closeDeleteCategory(): void {
    deleteCategoryModal.classList.remove("visible");
    deleteCategoryId = null;
}

deleteCategoryModal.addEventListener("change", () => refreshDeleteCategory());
document.getElementById("btn-delete-category-cancel")?.addEventListener("click", closeDeleteCategory);
deleteCategoryModal.addEventListener("click", (e) => {
    if (e.target === deleteCategoryModal) closeDeleteCategory();
});
deleteCategoryModal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDeleteCategory();
});
btnDeleteCategoryConfirm.addEventListener("click", async () => {
    if (!deleteCategoryId) return;
    const id = deleteCategoryId;
    const node = findChannelNodeById(currentTree, id);
    const hasChildren = !!node && node.children.length > 0;
    const mode = hasChildren ? deleteCategoryMode() : undefined;
    btnDeleteCategoryConfirm.disabled = true;
    const result = await api.deleteChannel(id, serverSummary === null ? undefined : mode);
    btnDeleteCategoryConfirm.disabled = false;
    if (result.success) {
        closeDeleteCategory();
        log("Category deleted", "success");
        SoundAlert.play("channel_deleted.mp3");
    } else {
        log(`Failed to delete category: ${result.error}`, "error");
        if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
        closeDeleteCategory();
    }
});

// Inline SVGs shown next to an occupant's name when they've muted or deafened
// themselves, so it doesn't look like they're simply ignoring everyone else.
const OCC_MUTED_ICON =
    `<svg class="occ-voice-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" style="stroke: var(--color-live)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" title="Muted"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2M19 10v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
const OCC_DEAFENED_ICON =
    `<svg class="occ-voice-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" style="stroke: var(--color-live)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" title="Deafened"><line x1="1" y1="1" x2="23" y2="23"/><path d="M3 18v-6a9 9 0 0 1 15.34-6.36M21 12v2.5"/><path d="M21 16v2a2 2 0 0 1-2 2h-1"/><path d="M3 18v2a2 2 0 0 0 2 2h1v-4H4a1 1 0 0 0-1 1z"/></svg>`;
// Same mic-slash shape as OCC_MUTED_ICON but in the muted text colour (PRD 19
// B9: it was the accent) — shown only to this client when they've locally muted
// the occupant (PRD 4.1/4.2's "Mute Locally"), distinct from the red
// server-broadcast mute icon since only the local viewer sees this one.
const OCC_LOCALLY_MUTED_ICON =
    `<i class="ph ph-microphone-slash occ-voice-icon" title="Muted for you only" aria-hidden="true"></i>`;

// Client-local (never sent to the server) per-remote-user volume/mute overrides —
// see PRD 4.1/4.2. Persisted per target userId so a preference sticks across
// restarts and applies the next time you're in a channel with that person.
function getSavedLocalVolume(userId: string): number {
    const raw = localStorage.getItem(`reson8-local-volume-${userId}`);
    const parsed = raw !== null ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) ? Math.max(0, Math.min(200, parsed)) : 100;
}

function setSavedLocalVolume(userId: string, percent: number): void {
    localStorage.setItem(`reson8-local-volume-${userId}`, String(percent));
}

function getSavedLocalMute(userId: string): boolean {
    return localStorage.getItem(`reson8-local-mute-${userId}`) === "1";
}

function setSavedLocalMute(userId: string, muted: boolean): void {
    localStorage.setItem(`reson8-local-mute-${userId}`, muted ? "1" : "0");
}

// ── Menu builder (PRD 19 F3) ─────────────────────────────────────────────────
// ONE menu implementation for every context menu: channel, tab and occupant
// menus all describe themselves as MenuItem[] and call openMenu(). Every label,
// hint and heading is set with textContent.

type MenuItem =
    | {
          label: string;
          /** A Phosphor class, e.g. "ph-bell-slash". */
          icon?: string;
          onClick: () => void;
          hint?: string;
          danger?: boolean;
          disabled?: boolean;
          /** A second line under the label (monospace) — the server switcher's address. */
          sublabel?: string;
          /** A leading server-style avatar instead of an icon (PRD 19 C2). */
          avatar?: { name: string; url?: string | null };
          /** A trailing tick (the active entry). */
          checked?: boolean;
      }
    | { heading: string }
    | { divider: true }
    | {
          slider: {
              label: string;
              min: number;
              max: number;
              step: number;
              value: number;
              ticks?: number[];
              format?: (v: number) => string;
              /** Live, while dragging. */
              onInput: (v: number) => void;
              /** On release. */
              onChange: (v: number) => void;
          };
      };

interface OpenMenuState {
    el: HTMLElement;
    anchor?: HTMLElement;
    returnFocusTo?: HTMLElement;
    teardown: () => void;
}
let openMenuState: OpenMenuState | null = null;
const MENU_EDGE_MARGIN = 8;

/** Closes the open menu (if any), removes the anchor ring and returns focus. */
function closeMenu(): void {
    const state = openMenuState;
    if (!state) return;
    openMenuState = null;
    state.teardown();
    state.el.remove();
    state.anchor?.classList.remove("menu-open");
    const target = state.returnFocusTo ?? state.anchor;
    if (target && typeof target.focus === "function" && target.isConnected) target.focus({ preventScroll: true });
}

/**
 * Opens a menu at (x, y), clamped to the window with an 8 px margin (flipping
 * left/up when there is no room). One at a time: it closes any open menu first.
 * Closes on an outside pointerdown, Escape, window blur, scroll and resize.
 * Up/Down/Home/End move between enabled items; Enter/Space activate; Left/Right
 * adjust a slider.
 */
function openMenu(
    items: MenuItem[],
    x: number,
    y: number,
    opts: { anchor?: HTMLElement; returnFocusTo?: HTMLElement; placement?: "below" | "above"; align?: "start" | "center"; minWidth?: number } = {},
): void {
    closeMenu();
    if (items.length === 0) return;

    const menu = document.createElement("div");
    menu.className = "menu";
    menu.setAttribute("role", "menu");
    menu.tabIndex = -1;

    for (const item of items) {
        if ("divider" in item) {
            const d = document.createElement("div");
            d.className = "menu-divider";
            d.setAttribute("role", "presentation");
            menu.appendChild(d);
        } else if ("heading" in item) {
            const hd = document.createElement("div");
            hd.className = "menu-heading";
            hd.setAttribute("role", "presentation");
            hd.textContent = item.heading;
            menu.appendChild(hd);
        } else if ("slider" in item) {
            const cfg = item.slider;
            const fmt = cfg.format ?? ((v: number) => String(v));
            const row = document.createElement("div");
            row.className = "menu-slider";
            row.setAttribute("role", "presentation");
            const head = document.createElement("div");
            head.className = "menu-slider-head";
            const lab = document.createElement("span");
            lab.textContent = cfg.label;
            const readout = document.createElement("span");
            readout.className = "menu-slider-value";
            readout.textContent = fmt(cfg.value);
            head.append(lab, readout);
            const input = document.createElement("input");
            input.type = "range";
            input.className = "menu-slider-input";
            input.min = String(cfg.min);
            input.max = String(cfg.max);
            input.step = String(cfg.step);
            input.value = String(cfg.value);
            input.setAttribute("aria-label", cfg.label);
            input.addEventListener("input", () => {
                const v = Number(input.value);
                readout.textContent = fmt(v);
                cfg.onInput(v);
            });
            input.addEventListener("change", () => cfg.onChange(Number(input.value)));
            row.append(head, input);
            if (cfg.ticks && cfg.ticks.length > 0) {
                const ticks = document.createElement("div");
                ticks.className = "menu-slider-ticks";
                for (const t of cfg.ticks) {
                    const tick = document.createElement("span");
                    tick.textContent = fmt(t);
                    ticks.appendChild(tick);
                }
                row.appendChild(ticks);
            }
            menu.appendChild(row);
        } else {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "menu-item" + (item.danger ? " danger" : "");
            btn.setAttribute("role", "menuitem");
            btn.tabIndex = -1;
            if (item.avatar) {
                btn.classList.add("has-avatar");
                btn.appendChild(serverAvatarElement(item.avatar.name, item.avatar.url, 30));
            } else if (item.icon) {
                const ic = document.createElement("i");
                ic.className = `ph ${item.icon} menu-item-icon`;
                ic.setAttribute("aria-hidden", "true");
                btn.appendChild(ic);
            }
            const lab = document.createElement("span");
            lab.className = "menu-item-label";
            lab.textContent = item.label;
            if (item.sublabel) {
                const text = document.createElement("span");
                text.className = "menu-item-text";
                const sub = document.createElement("span");
                sub.className = "menu-item-sub";
                sub.textContent = item.sublabel;
                text.append(lab, sub);
                btn.appendChild(text);
            } else {
                btn.appendChild(lab);
            }
            if (item.checked) {
                const tick = document.createElement("i");
                tick.className = "ph ph-check menu-item-check";
                tick.setAttribute("aria-hidden", "true");
                btn.appendChild(tick);
            }
            if (item.hint) {
                const hint = document.createElement("span");
                hint.className = "menu-item-hint";
                hint.textContent = item.hint;
                btn.appendChild(hint);
            }
            if (item.disabled) {
                btn.disabled = true;
                btn.setAttribute("aria-disabled", "true");
            }
            btn.addEventListener("click", () => {
                if (item.disabled) return;
                closeMenu();
                item.onClick();
            });
            menu.appendChild(btn);
        }
    }

    // Positioned after rendering, measured, then clamped (flip before clamp).
    menu.style.left = "0px";
    menu.style.top = "0px";
    if (opts.minWidth) {
        // The .menu CSS caps at 280 px; a wide anchor (the server pill) lifts the cap with it.
        menu.style.minWidth = `${Math.max(190, Math.round(opts.minWidth))}px`; // never below the .menu CSS minimum
        menu.style.maxWidth = `${Math.max(280, Math.round(opts.minWidth))}px`;
    }
    menu.style.visibility = "hidden";
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    // align "center": x is the anchor's horizontal centre and the menu is centred on it.
    let left = opts.align === "center" ? x - rect.width / 2 : x;
    // "above": y is the anchor's top edge; the menu's bottom sits 6 px above it.
    let top = opts.placement === "above" ? y - rect.height - 6 : y;
    if (opts.align !== "center" && left + rect.width > window.innerWidth - MENU_EDGE_MARGIN) left = x - rect.width;
    if (top + rect.height > window.innerHeight - MENU_EDGE_MARGIN) top = y - rect.height;
    left = Math.max(MENU_EDGE_MARGIN, Math.min(left, window.innerWidth - rect.width - MENU_EDGE_MARGIN));
    top = Math.max(MENU_EDGE_MARGIN, Math.min(top, window.innerHeight - rect.height - MENU_EDGE_MARGIN));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = "";

    opts.anchor?.classList.add("menu-open");

    const focusables = (): HTMLElement[] =>
        Array.from(menu.querySelectorAll<HTMLElement>("button.menu-item:not(:disabled), input.menu-slider-input"));
    const onPointerDown = (e: PointerEvent): void => {
        if (menu.contains(e.target as Node)) return;
        const anchor = opts.anchor;
        closeMenu();
        // A press on the control that opened the menu is a "close": swallow the click
        // that follows it, or the control's own handler would open the menu again.
        if (anchor && anchor.contains(e.target as Node)) {
            const swallow = (ev: Event): void => {
                ev.stopPropagation();
                ev.preventDefault();
                cleanup();
            };
            const cleanup = (): void => {
                document.removeEventListener("click", swallow, true);
                clearTimeout(timer);
            };
            const timer = window.setTimeout(cleanup, 600);
            document.addEventListener("click", swallow, true);
        }
    };
    const onKeyDown = (e: KeyboardEvent): void => {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            closeMenu();
            return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
        const list = focusables();
        if (list.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        const current = list.indexOf(document.activeElement as HTMLElement);
        let next: number;
        if (e.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % list.length;
        else if (e.key === "ArrowUp") next = current < 0 ? list.length - 1 : (current - 1 + list.length) % list.length;
        else if (e.key === "Home") next = 0;
        else next = list.length - 1;
        list[next].focus();
    };
    const onBlur = (): void => closeMenu();
    const onScroll = (e: Event): void => {
        // Scrolling the menu's own content (a slider drag never scrolls) is fine.
        if (e.target instanceof Node && menu.contains(e.target)) return;
        closeMenu();
    };
    const onResize = (): void => closeMenu();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onBlur);
    document.addEventListener("scroll", onScroll, true); // capture: #channel-tree, .chat-messages, the window
    window.addEventListener("resize", onResize);

    openMenuState = {
        el: menu,
        anchor: opts.anchor,
        returnFocusTo: opts.returnFocusTo,
        teardown: () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("blur", onBlur);
            document.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("resize", onResize);
        },
    };
}

// ── Occupant menu (PRD 19 B8) ────────────────────────────────────────────────

/** A menu as plain data: C9 draws the same model on voice tiles, F3 swaps the renderer. */
type OccupantMenuModel =
    | { kind: "self"; userId: string }
    | {
          kind: "other";
          userId: string;
          nickname: string;
          channelId: string;
          channelName: string;
          volume: { value: number; min: number; max: number; step: number; ticks: number[] };
          localMuted: boolean;
          canKick: boolean;
      };

/**
 * What the menu holds for `occ` in `channelNode`. Yourself: one item (Voice
 * settings…). Someone else: local volume, local mute and — only with
 * KICK_USER (the server's real requirement; the old gate was MANAGE_ROLES) or,
 * on an older server that sends no permissions, today's isAdminUser — Kick.
 */
function buildOccupantMenuModel(occ: { userId: string; nickname: string }, channelNode: TreeNode): OccupantMenuModel {
    if (occ.userId === api.getInstanceId()) return { kind: "self", userId: occ.userId };
    const kickPerm = hasPerm(PERM.KICK_USER);
    return {
        kind: "other",
        userId: occ.userId,
        nickname: occ.nickname,
        channelId: channelNode.id,
        channelName: channelNode.name,
        volume: { value: api.getLocalUserVolume(occ.userId), min: 0, max: 200, step: 5, ticks: [0, 100, 200] },
        localMuted: api.getLocalUserMute(occ.userId),
        canKick: kickPerm === null ? isAdminUser : kickPerm,
    };
}

/** Opens Settings on the Voice & Shortcuts tab (PRD 19 B8's "Voice settings…"). */
function openVoiceSettings(): void {
    openClientSettings("voice");
}

/** Draws an OccupantMenuModel with the shared menu builder (PRD 19 F3). */
function renderOccupantMenu(model: OccupantMenuModel, x: number, y: number, anchor?: HTMLElement): void {
    if (model.kind === "self") {
        openMenu(
            [{ label: "Voice settings…", icon: "ph-gear", onClick: () => openVoiceSettings() }],
            x,
            y,
            { anchor },
        );
        return;
    }

    const items: MenuItem[] = [
        {
            slider: {
                label: "Volume",
                min: model.volume.min,
                max: model.volume.max,
                step: model.volume.step,
                value: model.volume.value,
                ticks: model.volume.ticks,
                format: (v) => `${v}%`,
                // Live: the audio and the readout only. Saved (and the tree mark
                // refreshed) once, when the drag ends — not on every step.
                onInput: (v) => api.setLocalUserVolume(model.userId, v),
                onChange: (v) => {
                    setSavedLocalVolume(model.userId, v);
                    refreshOccupantMarks(model.userId);
                },
            },
        },
        { divider: true },
        {
            label: model.localMuted ? "Unmute locally" : "Mute locally",
            icon: model.localMuted ? "ph-speaker-high" : "ph-speaker-slash",
            hint: "Only for you",
            onClick: () => {
                const nowMuted = !model.localMuted;
                api.setLocalUserMute(model.userId, nowMuted);
                setSavedLocalMute(model.userId, nowMuted);
                refreshOccupantMarks(model.userId); // targeted: collapsed categories survive
            },
        },
    ];
    if (model.canKick) {
        items.push({ divider: true }, { heading: "Moderate" });
        items.push({
            label: "Kick from channel",
            icon: "ph-sign-out",
            danger: true,
            onClick: async () => {
                const result = await api.kickUser(model.userId, model.channelId);
                if (result.success) {
                    showToast(`${escapeHtml(model.nickname)} was kicked from ${escapeHtml(model.channelName)}`);
                } else {
                    log(`Failed to kick: ${result.error}`, "error");
                    if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
                }
            },
        });
    }
    openMenu(items, x, y, { anchor });
}

/**
 * Updates every tree occupant element of `userId` in place (PRD 19 B8/B9): no
 * renderTree(), so collapsed categories survive. Handles both the "{n}%" volume
 * mark and the locally-muted icon.
 */
function refreshOccupantMarks(userId: string): void {
    refreshVoiceTileMarks(userId); // PRD 19 C9
    const myId = api.getInstanceId();
    const locallyMuted = userId !== myId && getSavedLocalMute(userId);
    const savedVolume = userId !== myId ? getSavedLocalVolume(userId) : 100;
    for (const el of document.querySelectorAll<HTMLElement>(`.tree-occupant[data-user-id="${CSS.escape(userId)}"]`)) {
        // Volume mark (PRD 19 B9): shown when not 100% and not muted locally.
        el.querySelector(".occ-local-volume")?.remove();
        if (!locallyMuted && savedVolume !== 100) {
            const mark = document.createElement("span");
            mark.className = "occ-local-volume";
            mark.textContent = `${savedVolume}%`;
            const anchor = el.querySelector(".occ-voice-icon, .occ-local-muted, .sharing-badge");
            if (anchor) anchor.before(mark);
            else el.appendChild(mark);
        }
        const existing = el.querySelector(".occ-local-muted");
        if (locallyMuted && !existing) {
            const holder = document.createElement("span");
            holder.className = "occ-local-muted";
            holder.innerHTML = OCC_LOCALLY_MUTED_ICON;
            const badge = el.querySelector(".sharing-badge");
            if (badge) badge.before(holder);
            else el.appendChild(holder);
        } else if (!locallyMuted && existing) {
            existing.remove();
        }
    }
}

function renderOccupants(container: HTMLElement, node: TreeNode): void {
    const myId = api.getInstanceId();

    for (const occ of node.occupants) {
        const el = document.createElement("div");
        el.className = "tree-occupant";
        // The local user's own speaking state lives in `isLocalSpeaking`
        // (PRD 14.11), not `activeSpeakers` — checked here too so a tree
        // re-render (channel update, mute/deafen toggle, etc.) doesn't
        // momentarily drop the halo until the next analyser tick reapplies it.
        if (activeSpeakers.has(occ.userId) || (occ.userId === myId && isLocalSpeaking)) {
            el.classList.add("speaking");
        }
        el.setAttribute("data-user-id", occ.userId);
        const isLocallyMuted = occ.userId !== myId && getSavedLocalMute(occ.userId);
        const voiceStateIcons =
            `${occ.isMuted ? OCC_MUTED_ICON : ""}${occ.isDeafened ? OCC_DEAFENED_ICON : ""}${isLocallyMuted ? `<span class="occ-local-muted">${OCC_LOCALLY_MUTED_ICON}</span>` : ""}`;
        const sharingBadge = occ.isSharingScreen ? `<span class="sharing-badge">LIVE</span>` : "";
        // The saved local volume, when it is not the default and they are not muted (PRD 19 B9).
        const savedVolume = occ.userId !== myId ? getSavedLocalVolume(occ.userId) : 100;
        const volumeMark =
            !isLocallyMuted && savedVolume !== 100 ? `<span class="occ-local-volume">${savedVolume}%</span>` : "";
        el.innerHTML = `<span class="occ-dot"></span>${escapeHtml(occ.nickname)}${volumeMark}${voiceStateIcons}${sharingBadge}`;

        // Clickable by anyone in the room, including the streamer
        // themself (PRD 12.13) — the badge only exists in the DOM when
        // `occ.isSharingScreen` is true, so no extra guard needed here.
        el.querySelector(".sharing-badge")?.addEventListener("click", (e) => {
            e.stopPropagation();
            pendingWatchShare = { userId: occ.userId, nickname: occ.nickname, channelId: node.id };
            watchShareConfirmNickname.textContent = occ.nickname;
            watchShareConfirmModal.classList.add("visible");
        });

        // Re-apply any saved local volume/mute for this participant. Cheap and
        // idempotent — voice.service.ts only touches the audio graph when a
        // value actually differs, and this covers both "already consuming"
        // and "not consuming yet" (the override is queued and applied as soon
        // as their producer is consumed).
        if (occ.userId !== myId) {
            api.setLocalUserVolume(occ.userId, getSavedLocalVolume(occ.userId));
            api.setLocalUserMute(occ.userId, getSavedLocalMute(occ.userId));
        }

        // Right-click → the occupant menu (PRD 19 B8): built as plain data by
        // buildOccupantMenuModel() and drawn by renderOccupantMenu().
        el.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            renderOccupantMenu(buildOccupantMenuModel(occ, node), e.clientX, e.clientY, el);
        });

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

// ── Server access (PRD 18.18) ─────────────────────────────────────────────
// A user without the Member role is connected but restricted: no text channels,
// DMs or voice, until a moderator gives it back. The server enforces this on
// every event; the client mirrors it so nothing looks usable that isn't, and
// every entry point says why instead of failing silently.
let hasServerAccess = true;
const ACCESS_BANNER_TEXT =
    "You don't have access to this server's channels and voice right now. A moderator can give it back in User Management.";

/** True when the user may use channels/DMs/voice; otherwise explains why (a toast) and returns false. */
function requireServerAccess(): boolean {
    if (hasServerAccess) return true;
    showToast(escapeHtml(ACCESS_BANNER_TEXT), 5000);
    return false;
}

/** Autopens DM tabs for partners with unread messages (connect time, and when access returns). */
function autoOpenUnreadDmTabs(): void {
    api.getUnreadDmPartners().then((res) => {
        if (res.success && res.partners && res.partners.length > 0) {
            for (const p of res.partners) {
                // Seeded first, so the tabs that end up in the background keep
                // their dot and their "Unread Messages" line (PRD 18.13).
                if (!hasDmUnread(p.partnerId)) unreadDmCounts.set(p.partnerId, p.unreadCount > 0 ? p.unreadCount : -1);
                scheduleDmSidebarRender();
                // A background tab: an incoming conversation never steals the view (PRD 19 B4).
                openDmTab(p.partnerId, p.partnerNickname, { mode: "kept", focus: false, unreadCountHint: p.unreadCount });
            }
        }
    });
}

/**
 * Applies the server's answer to "may this user use channels, DMs and voice?"
 * `restore` is true when access has just come BACK on a live connection: kept
 * tabs and unread DM tabs return without a reconnect.
 */
function applyAccessState(hasAccess: boolean, opts: { restore?: boolean } = {}): void {
    const changed = hasServerAccess !== hasAccess;
    hasServerAccess = hasAccess;
    document.body.classList.toggle("no-access", !hasAccess);
    if (!changed) return;

    if (!hasAccess) {
        void stopStageWatch(); // PRD 19 C10: the stage and any popped Viewer end with the access
        // Everything the user had open goes away; kept tabs stay remembered.
        for (const [tabId] of chatTabs) closeTab(tabId, { reason: "access" });
        previewTabId = null;
        keptTabsRestored = false;
        unreadDmCounts.clear();
        updateDmRailState(); // PRD 19 C7: the DM button is disabled without access
        // The server already removed them from voice; mirror it locally.
        if (isInVoice) {
            api.leaveVoiceChannel();
            isInVoice = false;
            currentChannelId = null;
            previousOccupantIds = new Set();
            previousSharingIds = new Set();
            voiceChannelName.textContent = "";
            voicePanel.classList.remove("in-voice");
        }
        switchTab("server-log");
        log("You no longer have access to this server's channels and voice", "error");
        showToast(escapeHtml(ACCESS_BANNER_TEXT), 7000);
    } else if (opts.restore) {
        log("Your access to this server's channels and voice was restored", "success");
        keptTabsRestored = false;
        if (currentTree.length > 0 && currentServerId) restoreKeptTabs(currentTree as TreeNode[], currentServerId);
        autoOpenUnreadDmTabs();
        void restoreKeptDmTabs(); // PRD 19 B4: remembered DM tabs come back too
        updateDmRailState(); // PRD 19 C7
        void loadDmDirectory();
        if (currentTree.length > 0) renderTree(currentTree as TreeNode[]);
    }
}

api.on("permissions-changed", (data: { permissions: string }) => {
    setMyPermissions(data.permissions); // PRD 19 A8
    refreshServerSummary(); // PRD 19 A1: the admin list and counts may have changed
});

api.on("access-changed", (data: { hasAccess: boolean }) => {
    applyAccessState(data.hasAccess, { restore: true });
});

// ── Channel Interaction ───────────────────────────────────────────────────

let isJoiningChannel = false;

async function handleChannelClick(node: TreeNode): Promise<void> {
    if (!isConnected) return;
    if (isJoiningChannel) return; // prevent rapid double-clicks
    if (!requireServerAccess()) return; // PRD 18.18

    if (node.type === "VOICE") {
        // Already in this channel: the click opens the room tab (PRD 19 C9).
        if (currentChannelId === node.id && isInVoice) {
            openVoiceTab();
            return;
        }

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

                // joinVoiceChannel() constructs a fresh VoiceService instance
                // per session — reapply the saved global voice volume, mic
                // volume, and noise cancelling setting so none silently reset
                // on every join.
                api.setGlobalVoiceVolume(voiceVolume);
                api.setMicVolume(micVolume);
                api.setNoiseCancelEnabled(noiseCancelEnabled);
                api.setNoiseCancelStrength(noiseCancelStrength);

                // Initialize previous occupants for join/leave sound detection
                previousOccupantIds = new Set(node.occupants.map((o: any) => o.userId));
                previousSharingIds = sharingIdsOf(node.occupants);

                // In PTT mode, mic starts muted (resting state) but isMuted=false
                // so PTT key can activate it. isMuted=true means "PTT locked".
                if (pttModeEnabled) {
                    api.setMuted(true);
                    isMuted = false;
                } else {
                    isMuted = false;
                    // Enable noise gate if setting is on
                    if (micSensitivityEnabled) {
                        const threshold = parseInt(micSensitivitySlider.value, 10);
                        api.setMicSensitivity(true, threshold);
                    }
                }
                // Mic level meter runs regardless of gate/PTT state — it now
                // reflects live input at all times, not just while gating.
                startMicLevelMeter();

                // Self-hear (PRD 14.10): if left on from before this join
                // (e.g. was previewing pre-join), rebuild the monitor
                // against this join's fresh graph and reapply the same
                // forced mute+deafen the toggle always implies — must run
                // after the PTT/gate block above, which otherwise
                // overwrites `isMuted` back to false.
                if (selfHearEnabled) {
                    applySelfHearMuteDeafenForcing();
                    api.setSelfHearEnabled(true);
                    updateSelfHearBanner();
                }

                // Sync mute/deafen state to the server so other occupants' icons
                // aren't left showing a stale state from a previous session.
                api.setVoiceState(isMuted, isDeafened);

                updateVoiceUI(node.name);
                log(`Joined voice channel: ${node.name}`, "success");
                SoundAlert.play("joining-channel.mp3");
                openVoiceTab(); // PRD 19 C9: join-then-open
            } else {
                log(`Failed to join voice: ${result.error}`, "error");
                currentChannelId = null;
            }
        } finally {
            isJoiningChannel = false;
        }
    } else {
        // Text channel — open (or focus) a chat tab, prompting first if NSFW.
        // An already-open tab was confirmed when it was opened, so
        // re-focusing it from the tree doesn't prompt again (PRD 16.1).
        if (node.isNsfw && isNsfwWarningEnabled() && !chatTabs.has(node.id)) {
            pendingNsfwChannel = node;
            nsfwConfirmChannelName.textContent = node.name;
            chkNsfwDontWarn.checked = false; // never pre-ticked
            nsfwConfirmModal.classList.add("visible");
            return;
        }
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
        SoundAlert.play("channel_deleted.mp3");
    } else {
        log(`Failed to delete channel: ${result.error}`, "error");
        if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
    }
}

// ── Voice room tab (PRD 19 C9) ────────────────────────────────────────────────
// ONE tab for the room you are in, deliberately NOT a ChatTab (no scroll
// keeper, no sentinels, no unread). Its × closes the tab and never leaves
// voice; leaving voice closes it. Tiles are keyed by user id: a speaking
// update only toggles a class, a presence update adds or removes tiles.

const VOICE_TAB_ID = "voice-room";
const VOICE_LAYOUT_KEY = "reson8-voice-layout";
type VoiceLayout = "mosaic" | "featured";
const VOICE_FEATURED_SLOTS = 5;

interface VoiceTab {
    tabEl: HTMLElement;
    contentEl: HTMLElement;
    nameEl: HTMLElement;
    countEl: HTMLElement;
    btnMosaic: HTMLButtonElement;
    btnFeatured: HTMLButtonElement;
    grid: HTMLElement;
    stage: HTMLElement;
    observer: ResizeObserver;
    tiles: Map<string, HTMLElement>;
    moreBlock: HTMLButtonElement;
    channelId: string;
}
let voiceTab: VoiceTab | null = null;
let voiceMoreMenuEl: HTMLDivElement | null = null;

function readVoiceLayoutPref(): VoiceLayout {
    try {
        return localStorage.getItem(VOICE_LAYOUT_KEY) === "featured" ? "featured" : "mosaic";
    } catch {
        return "mosaic";
    }
}

function writeVoiceLayoutPref(layout: VoiceLayout): void {
    try {
        localStorage.setItem(VOICE_LAYOUT_KEY, layout);
    } catch {
        /* storage unavailable — the choice just won't be remembered */
    }
}

/** Elements for a user's halo/marks: tree rows and room tiles alike. */
function speakingEls(userId: string): NodeListOf<Element> {
    const id = CSS.escape(userId);
    return document.querySelectorAll(`.tree-occupant[data-user-id="${id}"], .voice-tile[data-user-id="${id}"]`);
}

/** The columns and tile size (4:3) that make the tiles as large as possible without scrolling. Pure. */
function fitVoiceTiles(
    count: number,
    width: number,
    height: number,
    gap: number,
    ratio = 4 / 3,
    maxWidth = 420,
): { cols: number; w: number; h: number } {
    let best = { cols: 1, w: 0, h: 0 };
    for (let cols = 1; cols <= Math.max(1, count); cols++) {
        const rows = Math.ceil(count / cols);
        const byWidth = (width - gap * (cols - 1)) / cols;
        const byHeight = ((height - gap * (rows - 1)) / rows) * ratio;
        const w = Math.floor(Math.min(byWidth, byHeight, maxWidth));
        if (w > best.w) best = { cols, w, h: Math.floor(w / ratio) };
    }
    return best;
}

function voiceRoomNode(): TreeNode | null {
    return isInVoice && currentChannelId ? findChannelNodeById(currentTree, currentChannelId) : null;
}

function anyoneSharingInRoom(node: TreeNode | null): boolean {
    return !!node && node.occupants.some((o) => o.isSharingScreen);
}

/** The layout actually drawn: Featured is forced while anyone shares (the saved choice is untouched). */
function effectiveVoiceLayout(node: TreeNode | null): VoiceLayout {
    return anyoneSharingInRoom(node) ? "featured" : readVoiceLayoutPref();
}

function createVoiceTab(): VoiceTab {
    const tabEl = document.createElement("div");
    tabEl.className = "tab";
    tabEl.dataset.tabId = VOICE_TAB_ID;
    fillTabElement(tabEl, `<i class="ph ph-waveform" aria-hidden="true"></i>`, "Voice room");
    tabEl.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).classList.contains("tab-close")) closeVoiceTab();
        else switchTab(VOICE_TAB_ID);
    });
    insertTabElement(tabEl, null);

    const contentEl = document.createElement("div");
    contentEl.className = "tab-content";
    contentEl.dataset.tabId = VOICE_TAB_ID;
    contentEl.innerHTML =
        `<div class="voice-room">` +
        `<div class="voice-room-header">` +
        `<div class="voice-room-title"><div class="section-label voice-room-kicker"></div><h2 class="voice-room-name"></h2></div>` +
        `<div class="voice-room-pills">` +
        `<span class="room-pill voice-room-security"><i class="ph ph-lock-simple" aria-hidden="true"></i><span class="voice-room-security-text"></span></span>` +
        `<span class="room-pill"><i class="ph ph-users" aria-hidden="true"></i><span class="voice-room-count"></span></span>` +
        `<span class="room-pill accent voice-room-sharing-pill"><i class="ph ph-screencast" aria-hidden="true"></i><span class="voice-room-sharing"></span></span>` +
        `<div class="voice-layout-toggle voice-stream-layout-toggle" role="group" aria-label="Stream layout">` +
        `<button type="button" data-stream-layout="focus" title="One stream large, the rest as previews"><i class="ph ph-square-half" aria-hidden="true"></i>Focus</button>` +
        `<button type="button" data-stream-layout="grid" title="Every stream at the same size"><i class="ph ph-grid-four" aria-hidden="true"></i>Grid</button>` +
        `</div>` +
        `<div class="voice-layout-toggle" role="group" aria-label="Layout">` +
        `<button type="button" data-layout="mosaic"><i class="ph ph-squares-four" aria-hidden="true"></i>Mosaic</button>` +
        `<button type="button" data-layout="featured"><i class="ph ph-square-split-horizontal" aria-hidden="true"></i>Featured</button>` +
        `</div></div></div>` +
        `<div class="voice-stream" id="voice-stream">` +
        `<div class="voice-stream-main">` +
        `<div class="voice-stream-video" id="voice-stream-video"></div>` +
        `<div class="voice-stream-info"><span class="sharing-badge">LIVE</span>` +
        `<span class="voice-stream-quality"></span><span class="voice-stream-title"></span></div>` +
        `<div class="voice-stream-controls">` +
        `<i class="ph ph-speaker-high" aria-hidden="true"></i>` +
        `<input type="range" class="voice-stream-volume" min="0" max="200" step="5" value="100" title="Stream volume" aria-label="Stream volume">` +
        `<span class="voice-stream-volume-readout">100%</span>` +
        `<button type="button" class="voice-stream-popout" title="Pop out" aria-label="Pop out"><i class="ph ph-arrow-square-out" aria-hidden="true"></i></button>` +
        `<button type="button" class="voice-stream-fullscreen" title="Fullscreen" aria-label="Fullscreen"><i class="ph ph-corners-out" aria-hidden="true"></i></button>` +
        `</div>` +
        `<div class="voice-stream-note"><div class="voice-stream-note-text"></div>` +
        `<div class="voice-stream-note-actions">` +
        `<button type="button" class="btn btn-primary voice-stream-bringback">Bring it back</button>` +
        `<button type="button" class="btn btn-secondary voice-stream-showwindow">Show window</button>` +
        `</div></div>` +
        `</div>` +
        `<div class="voice-stream-side"><div class="voice-stream-side-head section-label"></div><div class="voice-stream-cards"></div></div>` +
        `<div class="voice-streams"></div>` +
        `</div>` +
        `<div class="voice-room-stage"><div class="voice-grid"></div></div>` +
        `<div class="voice-callbar">` +
        `<div class="split-btn callbar-split"><button type="button" class="voice-btn split-main" data-call="mute" title="Mute"><i class="ph ph-microphone" aria-hidden="true"></i></button>` +
        `<button type="button" class="voice-btn split-caret" data-call="input" title="Input device" aria-label="Input device" aria-haspopup="menu"><i class="ph ph-caret-down" aria-hidden="true"></i></button></div>` +
        `<div class="split-btn callbar-split"><button type="button" class="voice-btn split-main" data-call="deafen" title="Deafen"><i class="ph ph-headphones" aria-hidden="true"></i></button>` +
        `<button type="button" class="voice-btn split-caret" data-call="output" title="Output device" aria-label="Output device" aria-haspopup="menu"><i class="ph ph-caret-down" aria-hidden="true"></i></button></div>` +
        `<button type="button" class="voice-btn callbar-pill" data-call="share"><i class="ph ph-screencast" aria-hidden="true"></i><span class="callbar-share-label">Share screen</span></button>` +
        `<button type="button" class="voice-btn callbar-pill leave" data-call="leave"><i class="ph ph-phone-x" aria-hidden="true"></i>Leave</button>` +
        `</div>` +
        `</div>`;
    tabContentArea.appendChild(contentEl);

    const stage = contentEl.querySelector(".voice-room-stage") as HTMLElement;
    const moreBlock = document.createElement("button");
    moreBlock.type = "button";
    moreBlock.className = "voice-more";
    moreBlock.addEventListener("click", (e) => {
        e.stopPropagation();
        openVoiceMoreMenu(moreBlock);
    });

    const vt: VoiceTab = {
        tabEl,
        contentEl,
        nameEl: contentEl.querySelector(".voice-room-name") as HTMLElement,
        countEl: contentEl.querySelector(".voice-room-count") as HTMLElement,
        btnMosaic: contentEl.querySelector('[data-layout="mosaic"]') as HTMLButtonElement,
        btnFeatured: contentEl.querySelector('[data-layout="featured"]') as HTMLButtonElement,
        grid: contentEl.querySelector(".voice-grid") as HTMLElement,
        stage,
        observer: new ResizeObserver(() => layoutVoiceTiles()),
        tiles: new Map(),
        moreBlock,
        channelId: currentChannelId ?? "",
    };
    vt.observer.observe(stage);
    vt.observer.observe(contentEl.querySelector(".voice-stream") as HTMLElement);
    const choose = (layout: VoiceLayout): void => {
        if (anyoneSharingInRoom(voiceRoomNode())) return; // forced Featured; nothing to choose
        writeVoiceLayoutPref(layout);
        renderVoiceRoom();
    };
    vt.btnMosaic.addEventListener("click", () => choose("mosaic"));
    vt.btnFeatured.addEventListener("click", () => choose("featured"));
    contentEl.querySelector('[data-stream-layout="focus"]')?.addEventListener("click", () => {
        writeStreamLayoutPref("focus");
        if (stageState === "grid") {
            const first = roomSharers()[0];
            void leaveStreamGrid().then(() => {
                if (first && currentChannelId) void startStageWatch({ userId: first.userId, nickname: first.nickname, channelId: currentChannelId });
            });
        }
    });
    contentEl.querySelector('[data-stream-layout="grid"]')?.addEventListener("click", () => {
        writeStreamLayoutPref("grid");
        void enterStreamGrid();
    });
    // The call bar runs the dock's own code paths (PRD 20 U2) — it has no state of its own.
    const call = (name: string): HTMLButtonElement => contentEl.querySelector(`[data-call="${name}"]`) as HTMLButtonElement;
    call("mute").addEventListener("click", () => toggleMuteAndNotify());
    call("deafen").addEventListener("click", () => toggleDeafenAndNotify());
    call("share").addEventListener("click", () => btnShareScreen.click());
    call("leave").addEventListener("click", () => leaveVoiceAndNotify());
    call("input").addEventListener("click", (e) => {
        e.stopPropagation();
        void openAudioDeviceMenu("input", call("input"));
    });
    call("output").addEventListener("click", (e) => {
        e.stopPropagation();
        void openAudioDeviceMenu("output", call("output"));
    });
    return vt;
}

/** Opens (and by default focuses) the room tab; only while you are in voice. */
function openVoiceTab(opts: { focus?: boolean } = {}): void {
    if (!isInVoice || !currentChannelId) return;
    if (!voiceTab) voiceTab = createVoiceTab();
    renderVoiceRoom();
    if (opts.focus !== false) switchTab(VOICE_TAB_ID);
}

/** Closes the room tab. It never leaves voice. */
function closeVoiceTab(): void {
    closeVoiceMoreMenu();
    if (!voiceTab) return;
    if (stageState !== "idle") void stopStageWatch(); // its container goes with the tab (PRD 19 C10)
    const vt = voiceTab;
    voiceTab = null;
    vt.observer.disconnect();
    vt.tabEl.remove();
    vt.contentEl.remove();
    scheduleTabOverflow();
    if (activeTabId === VOICE_TAB_ID) {
        // The first text tab, else the Server Log.
        const next = Array.from(tabBar.querySelectorAll<HTMLElement>(".tab"))
            .map((el) => el.dataset.tabId ?? "")
            .find((id) => chatTabs.has(id));
        switchTab(next ?? "server-log");
    }
}

function voiceMarksHtml(occ: TreeNode["occupants"][number]): string {
    const myId = api.getInstanceId();
    const locallyMuted = occ.userId !== myId && getSavedLocalMute(occ.userId);
    const volume = occ.userId !== myId ? getSavedLocalVolume(occ.userId) : 100;
    return (
        `${occ.isMuted ? OCC_MUTED_ICON : ""}` +
        `${occ.isDeafened ? OCC_DEAFENED_ICON : ""}` +
        `${locallyMuted ? `<span class="occ-local-muted">${OCC_LOCALLY_MUTED_ICON}</span>` : ""}` +
        `${!locallyMuted && volume !== 100 ? `<span class="occ-local-volume">${volume}%</span>` : ""}`
    );
}

function buildVoiceTile(occ: TreeNode["occupants"][number], node: TreeNode): HTMLElement {
    const el = document.createElement("div");
    el.className = "voice-tile";
    el.dataset.userId = occ.userId;
    const name = document.createElement("div");
    name.className = "voice-tile-name";
    const marks = document.createElement("div");
    marks.className = "voice-tile-marks";
    el.append(name, marks);
    el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = voiceRoomNode() ?? node;
        const live = current.occupants.find((o) => o.userId === occ.userId) ?? occ;
        renderOccupantMenu(buildOccupantMenuModel(live, current), e.clientX, e.clientY, el);
    });
    return el;
}

/** Fills a tile's changeable parts (name, marks, LIVE badge, speaking) without rebuilding it. */
function updateVoiceTile(el: HTMLElement, occ: TreeNode["occupants"][number], node: TreeNode): void {
    const myId = api.getInstanceId();
    const nameEl = el.querySelector(".voice-tile-name") as HTMLElement;
    const label = occ.userId === myId ? `${occ.nickname} (you)` : occ.nickname;
    if (nameEl.textContent !== label) nameEl.textContent = label;
    (el.querySelector(".voice-tile-marks") as HTMLElement).innerHTML = voiceMarksHtml(occ);

    let badge = el.querySelector<HTMLElement>(".sharing-badge");
    if (occ.isSharingScreen && !badge) {
        badge = document.createElement("span");
        badge.className = "sharing-badge";
        badge.textContent = "LIVE";
        badge.addEventListener("click", (e) => {
            e.stopPropagation();
            pendingWatchShare = { userId: occ.userId, nickname: occ.nickname, channelId: node.id };
            watchShareConfirmNickname.textContent = occ.nickname;
            watchShareConfirmModal.classList.add("visible");
        });
        el.appendChild(badge);
    } else if (!occ.isSharingScreen && badge) {
        badge.remove();
    }

    el.classList.toggle("speaking", activeSpeakers.has(occ.userId) || (occ.userId === myId && isLocalSpeaking));
}

/** Local volume/mute marks changed for one user (called with the tree's own refresh). */
function refreshVoiceTileMarks(userId: string): void {
    if (!voiceTab) return;
    const node = voiceRoomNode();
    const el = voiceTab.tiles.get(userId);
    const occ = node?.occupants.find((o) => o.userId === userId);
    if (el && occ && node) updateVoiceTile(el, occ, node);
}

/** Keyed add/remove of tiles, the header and the layout. Never rebuilds a tile that stays. */
function renderVoiceRoom(): void {
    if (!voiceTab) return;
    const node = voiceRoomNode();
    if (!node) {
        closeVoiceTab();
        return;
    }
    const vt = voiceTab;
    vt.channelId = node.id;
    vt.nameEl.textContent = node.name;
    const parent = node.parentId ? findChannelNodeById(currentTree, node.parentId) : null;
    (vt.contentEl.querySelector(".voice-room-kicker") as HTMLElement).textContent = parent ? `${parent.name} · Voice room` : "Voice room";
    const count = node.occupants.length;
    vt.countEl.textContent = node.maxUsers ? `${count} / ${node.maxUsers}` : String(count);
    const secure = currentConnection?.scheme === "https";
    const sec = vt.contentEl.querySelector(".voice-room-security") as HTMLElement;
    sec.classList.toggle("insecure", !secure);
    (sec.querySelector("i") as HTMLElement).className = `ph ${secure ? "ph-lock-simple" : "ph-lock-simple-open"}`;
    (sec.querySelector(".voice-room-security-text") as HTMLElement).textContent = secure ? "Encrypted" : "Not encrypted";
    sec.title = secure ? "Encrypted connection" : "This connection is not encrypted";
    const label = vt.tabEl.querySelector(".tab-label") as HTMLElement;
    if (label.textContent !== node.name) {
        label.textContent = node.name;
        invalidateTabWidth(vt.tabEl);
    }

    const present = new Set(node.occupants.map((o) => o.userId));
    for (const [userId, el] of vt.tiles) {
        if (!present.has(userId)) {
            el.remove();
            vt.tiles.delete(userId);
        }
    }
    for (const occ of node.occupants) {
        let el = vt.tiles.get(occ.userId);
        if (!el) {
            el = buildVoiceTile(occ, node);
            vt.tiles.set(occ.userId, el);
        }
        updateVoiceTile(el, occ, node);
    }

    const sharing = anyoneSharingInRoom(node);
    // The sharer stopped, or left the room: the stage has nothing to show (PRD 19 C10).
    if (stageTarget && stageState !== "idle" && !node.occupants.some((o) => o.userId === stageTarget!.userId && o.isSharingScreen)) {
        void stopStageWatch("The stream ended");
    }
    renderSharingHeader(); // PRD 19 C11
    renderStageSide();
    syncStreamGrid();
    const layout = effectiveVoiceLayout(node);
    vt.btnMosaic.classList.toggle("active", layout === "mosaic");
    vt.btnFeatured.classList.toggle("active", layout === "featured");
    vt.btnMosaic.disabled = sharing;
    vt.btnMosaic.title = sharing ? "Mosaic is only available when no one is sharing a screen" : "Everyone, sized to fit";
    vt.btnFeatured.title = sharing ? "Featured is used while someone is sharing" : "Five people, the rest in a list";
    layoutVoiceTiles();
    renderCallBar();
}

/** Places and sizes the tiles for the current layout; called on every render and stage resize. */
function layoutVoiceTiles(): void {
    if (!voiceTab) return;
    const vt = voiceTab;
    const node = voiceRoomNode();
    if (!node) return;
    const people = node.occupants;
    const layout = effectiveVoiceLayout(node);

    // Featured: five tiles then a "…and n more" block (everyone, when it would
    // only hide one person). Mosaic: everyone. With a stream on stage the people
    // are a strip: two tiles plus the block (PRD 19 C10).
    const inStrip = stageState !== "idle";
    const featuredSlots = inStrip ? 2 : VOICE_FEATURED_SLOTS;
    const overflowing = (inStrip || layout === "featured") && people.length > featuredSlots + 1;
    const shown = overflowing ? people.slice(0, featuredSlots) : people;
    const hiddenCount = people.length - shown.length;
    const slots = shown.length + (hiddenCount > 0 ? 1 : 0);

    const rect = vt.stage.getBoundingClientRect();
    const gap = 12;
    const fit = fitVoiceTiles(Math.max(1, slots), Math.max(0, rect.width - 32), Math.max(0, rect.height - 32), gap);

    const ordered: HTMLElement[] = [];
    for (const occ of shown) {
        const el = vt.tiles.get(occ.userId);
        if (el) ordered.push(el);
    }
    for (const [userId, el] of vt.tiles) {
        el.style.display = shown.some((o) => o.userId === userId) ? "" : "none";
    }
    vt.moreBlock.style.display = hiddenCount > 0 ? "" : "none";
    vt.moreBlock.textContent = `…and ${hiddenCount} more`;

    // With a stream on stage, a strip whose tiles would be under 90 px tall becomes 44 px chips.
    const chips = inStrip && fit.h < 90;
    vt.grid.classList.toggle("chips", chips);
    const bucket = chips ? 28 : fit.w < 160 ? 32 : fit.w < 260 ? 48 : fit.w < 380 ? 64 : 80;
    for (const el of ordered) {
        el.style.width = `${fit.w}px`;
        el.style.height = `${fit.h}px`;
        el.classList.toggle("tile-sm", fit.w < 170);
        // The avatar is rebuilt only when its size bucket changes.
        const occ = people.find((o) => o.userId === el.dataset.userId);
        const current = el.querySelector<HTMLElement>(".avatar");
        if (occ && (!current || current.dataset.avatarPx !== String(bucket))) {
            current?.remove();
            el.insertBefore(createAvatarElement(occ.userId, occ.nickname, bucket), el.firstChild);
        }
    }
    vt.moreBlock.style.width = `${fit.w}px`;
    vt.moreBlock.style.height = `${fit.h}px`;
    vt.grid.style.gridTemplateColumns = chips ? "" : `repeat(${fit.cols}, ${fit.w}px)`;
    vt.grid.append(...ordered, vt.moreBlock);
    if (voiceMoreMenuEl) buildVoiceMoreMenu();
    layoutStreamGrid(); // PRD 19 C11: the stream grid shares this resize pass
}

function closeVoiceMoreMenu(): void {
    voiceMoreMenuEl?.remove();
    voiceMoreMenuEl = null;
}

/** The people who didn't get a tile: avatar, name, marks; right-click opens the shared menu. */
function buildVoiceMoreMenu(): void {
    if (!voiceMoreMenuEl) return;
    const node = voiceRoomNode();
    const menu = voiceMoreMenuEl;
    menu.replaceChildren();
    if (!node) return;
    const myId = api.getInstanceId();
    for (const occ of node.occupants.slice(stageState !== "idle" ? 2 : VOICE_FEATURED_SLOTS)) {
        const row = document.createElement("div");
        row.className = "voice-more-row";
        row.dataset.userId = occ.userId;
        row.appendChild(createAvatarElement(occ.userId, occ.nickname, 28));
        const name = document.createElement("div");
        name.className = "voice-tile-name";
        name.textContent = occ.userId === myId ? `${occ.nickname} (you)` : occ.nickname;
        row.appendChild(name);
        const marks = document.createElement("div");
        marks.className = "voice-tile-marks";
        marks.innerHTML = voiceMarksHtml(occ);
        row.appendChild(marks);
        row.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            renderOccupantMenu(buildOccupantMenuModel(occ, node), e.clientX, e.clientY, row);
        });
        menu.appendChild(row);
    }
}

function openVoiceMoreMenu(anchor: HTMLElement): void {
    if (voiceMoreMenuEl) {
        closeVoiceMoreMenu();
        return;
    }
    closeMenu();
    const menu = document.createElement("div");
    menu.className = "voice-more-menu";
    document.body.appendChild(menu);
    voiceMoreMenuEl = menu;
    buildVoiceMoreMenu();
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 268))}px`;
    menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 330)}px`;
}

document.addEventListener("pointerdown", (e) => {
    if (voiceMoreMenuEl && !voiceMoreMenuEl.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(".voice-more")) {
        closeVoiceMoreMenu();
    }
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeVoiceMoreMenu();
});
document.getElementById("btn-expand-voice")?.addEventListener("click", () => openVoiceTab());

// ── In-app stream stage (PRD 19 C10) ──────────────────────────────────────────
// One state machine: idle → starting → stage ⇄ popping → popped → returning →
// stage. Clicks are ignored while a transition runs, and every transition waits
// for the previous side to close — there is never a moment with two consumers.

type StageState = "idle" | "starting" | "stage" | "popping" | "popped" | "returning" | "grid";
let stageState: StageState = "idle";
let stageTarget: { userId: string; channelId: string; nickname: string } | null = null;
let stageStreamName = "";
let stageViewerWindowId: number | null = null;
let stageQualityTimer: ReturnType<typeof setInterval> | null = null;

function stageEl<T extends HTMLElement>(selector: string): T | null {
    return (voiceTab?.contentEl.querySelector(selector) as T | null) ?? null;
}

function roomNameForStage(): string {
    return voiceRoomNode()?.name ?? "";
}

/** Paints the stage region and the people strip for the current state. */
function renderStage(): void {
    const room = voiceTab?.contentEl.querySelector(".voice-room");
    const stream = stageEl<HTMLElement>(".voice-stream");
    if (!room || !stream) return;
    const active = stageState !== "idle";
    room.classList.toggle("has-stream", active);
    stream.classList.toggle("is-grid", stageState === "grid");
    stream.classList.toggle("is-popped", stageState === "popped" || stageState === "returning" || stageState === "popping");
    stream.classList.toggle("is-busy", stageState === "starting");
    renderStageSide();

    const note = stageEl<HTMLElement>(".voice-stream-note-text");
    const actions = stageEl<HTMLElement>(".voice-stream-note-actions");
    const who = stageTarget?.nickname ?? "";
    if (note) {
        note.textContent =
            stageState === "starting"
                ? `Connecting to ${who}'s stream…`
                : stageState === "returning"
                  ? `Bringing ${who}'s stream back…`
                  : stageState === "popping"
                    ? `Opening ${who}'s stream in its own window…`
                    : `${who}'s stream is in its own window`;
    }
    if (actions) actions.style.display = stageState === "popped" ? "" : "none";

    const title = stageEl<HTMLElement>(".voice-stream-title");
    if (title) title.textContent = stageStreamName ? `${who} · ${stageStreamName}` : who;
    layoutVoiceTiles();
}

// ── Several streams: Focus and Grid (PRD 19 C11) ──────────────────────────────
// Focus: the main stream is the C10 stage; the other sharers are static LIVE
// cards in a 212 px column (no video, no extra consumers). Grid: every stream
// gets its own watch at one 16:9 size, muted (one stream's sound at a time —
// double-click focuses one). Live previews on the cards are NOT built: they
// need a server event and the owner's decision after a measurement (D2).

const STREAM_LAYOUT_KEY = "reson8-stream-layout";
type StreamLayout = "focus" | "grid";

function readStreamLayoutPref(): StreamLayout {
    try {
        return localStorage.getItem(STREAM_LAYOUT_KEY) === "grid" ? "grid" : "focus";
    } catch {
        return "focus";
    }
}

function writeStreamLayoutPref(layout: StreamLayout): void {
    try {
        localStorage.setItem(STREAM_LAYOUT_KEY, layout);
    } catch {
        /* storage unavailable — the choice just won't be remembered */
    }
}

/** Stream names learned from a watch's ack, so a static card can show one. */
const knownStreamNames = new Map<string, string>();

/** One cell per sharer while the grid is up. `windowId` is set while that stream is popped out. */
const gridCells = new Map<string, { nickname: string; cell: HTMLElement; windowId: number | null; watching: boolean }>();

function roomSharers(): TreeNode["occupants"] {
    const node = voiceRoomNode();
    return node ? node.occupants.filter((o) => o.isSharingScreen) : [];
}

/** The header's "{n} / 5 sharing" and the Focus | Grid toggle (shown from two streams up). */
function renderSharingHeader(): void {
    if (!voiceTab) return;
    const sharers = roomSharers();
    const label = voiceTab.contentEl.querySelector(".voice-room-sharing") as HTMLElement;
    label.textContent = sharers.length > 0 ? `${sharers.length} / ${MAX_SCREEN_SHARES_PER_ROOM} sharing` : "";
    (voiceTab.contentEl.querySelector(".voice-room-sharing-pill") as HTMLElement).style.display = sharers.length > 0 ? "" : "none";
    const toggle = voiceTab.contentEl.querySelector(".voice-stream-layout-toggle") as HTMLElement;
    toggle.classList.toggle("visible", sharers.length >= 2);
    const grid = stageState === "grid";
    toggle.querySelector('[data-stream-layout="focus"]')?.classList.toggle("active", !grid);
    toggle.querySelector('[data-stream-layout="grid"]')?.classList.toggle("active", grid);
}

/** The "Also live · {n}" column: static cards for every sharer that isn't on the main stage. */
function renderStageSide(): void {
    const stream = stageEl<HTMLElement>(".voice-stream");
    const head = stageEl<HTMLElement>(".voice-stream-side-head");
    const cards = stageEl<HTMLElement>(".voice-stream-cards");
    if (!stream || !head || !cards) return;
    const others = stageState === "grid" || !stageTarget ? [] : roomSharers().filter((o) => o.userId !== stageTarget!.userId);
    stream.classList.toggle("has-side", others.length > 0 && stageState !== "idle");
    head.textContent = `Also live · ${others.length}`;
    // Keyed by user id so a presence update doesn't rebuild an unchanged card.
    const present = new Set(others.map((o) => o.userId));
    for (const el of Array.from(cards.children) as HTMLElement[]) {
        if (!present.has(el.dataset.userId ?? "")) el.remove();
    }
    for (const occ of others) {
        let card = cards.querySelector<HTMLElement>(`[data-user-id="${CSS.escape(occ.userId)}"]`);
        if (!card) {
            const btn = document.createElement("button");
            btn.type = "button";
            card = btn;
            card.className = "voice-stream-card";
            card.dataset.userId = occ.userId;
            card.append(createAvatarElement(occ.userId, occ.nickname, 36));
            const text = document.createElement("span");
            text.className = "voice-stream-card-text";
            const name = document.createElement("span");
            name.className = "voice-stream-card-name";
            const sub = document.createElement("span");
            sub.className = "voice-stream-card-sub";
            text.append(name, sub);
            const dot = document.createElement("span");
            dot.className = "voice-live-dot";
            dot.title = "Live";
            card.append(text, dot);
            card.addEventListener("click", () => {
                const channelId = currentChannelId;
                if (channelId) void startStageWatch({ userId: occ.userId, nickname: occ.nickname, channelId });
            });
            cards.appendChild(card);
        }
        (card.querySelector(".voice-stream-card-name") as HTMLElement).textContent = occ.nickname;
        (card.querySelector(".voice-stream-card-sub") as HTMLElement).textContent =
            knownStreamNames.get(occ.userId) ?? "Screen share";
    }
}

/** Sizes the grid cells (16:9, as large as will fit) — called with every voice-room layout pass. */
function layoutStreamGrid(): void {
    if (stageState !== "grid") return;
    const host = stageEl<HTMLElement>(".voice-streams");
    if (!host || gridCells.size === 0) return;
    const rect = host.getBoundingClientRect();
    const fit = fitVoiceTiles(gridCells.size, Math.max(0, rect.width - 24), Math.max(0, rect.height - 24), 12, 16 / 9, 1600);
    host.style.gridTemplateColumns = `repeat(${fit.cols}, ${fit.w}px)`;
    for (const entry of gridCells.values()) {
        entry.cell.style.width = `${fit.w}px`;
        entry.cell.style.height = `${fit.h}px`;
    }
}

function gridVideoId(userId: string): string {
    return `voice-grid-video-${userId}`;
}

function buildGridCell(occ: TreeNode["occupants"][number]): HTMLElement {
    const cell = document.createElement("div");
    cell.className = "voice-grid-cell";
    cell.dataset.userId = occ.userId;
    const video = document.createElement("div");
    video.className = "voice-grid-video";
    video.id = gridVideoId(occ.userId);
    const label = document.createElement("div");
    label.className = "voice-grid-label";
    label.textContent = occ.nickname;
    const actions = document.createElement("div");
    actions.className = "voice-grid-actions";
    const focus = document.createElement("button");
    focus.type = "button";
    focus.className = "voice-grid-focus";
    focus.title = "Focus this stream";
    focus.innerHTML = `<i class="ph ph-arrows-out-simple" aria-hidden="true"></i>`;
    const pop = document.createElement("button");
    pop.type = "button";
    pop.className = "voice-grid-popout";
    pop.title = "Pop out";
    pop.innerHTML = `<i class="ph ph-arrow-square-out" aria-hidden="true"></i>`;
    actions.append(focus, pop);
    const note = document.createElement("div");
    note.className = "voice-grid-note";
    const noteText = document.createElement("div");
    noteText.textContent = `${occ.nickname}'s stream is in its own window`;
    const noteActions = document.createElement("div");
    noteActions.className = "voice-stream-note-actions";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn btn-primary voice-grid-bringback";
    back.textContent = "Bring it back";
    const show = document.createElement("button");
    show.type = "button";
    show.className = "btn btn-secondary voice-grid-showwindow";
    show.textContent = "Show window";
    noteActions.append(back, show);
    note.append(noteText, noteActions);
    cell.append(video, label, actions, note);
    cell.addEventListener("dblclick", () => void focusStream(occ.userId));
    focus.addEventListener("click", (e) => {
        e.stopPropagation();
        void focusStream(occ.userId);
    });
    pop.addEventListener("click", (e) => {
        e.stopPropagation();
        void popOutGridStream(occ.userId);
    });
    back.addEventListener("click", () => void bringBackGridStream(occ.userId));
    show.addEventListener("click", () => {
        const w = gridCells.get(occ.userId)?.windowId;
        if (typeof w === "number") void api.focusViewerWindow(w);
    });
    return cell;
}

async function startGridWatch(userId: string): Promise<void> {
    const entry = gridCells.get(userId);
    const channelId = currentChannelId;
    if (!entry || !channelId || entry.watching) return;
    entry.watching = true;
    const res = await api.stage.watch(userId, channelId, gridVideoId(userId));
    if (!gridCells.has(userId) || stageState !== "grid") {
        // The grid was torn down (or this cell removed) while connecting.
        if (res.success) await api.stage.stop(userId);
        return;
    }
    if (!res.success) {
        entry.watching = false;
        entry.cell.querySelector(".voice-grid-label")!.textContent = `${entry.nickname} — couldn't load`;
        return;
    }
    if (res.streamName) knownStreamNames.set(userId, res.streamName);
    api.stage.setMuted(true, userId); // one stream's sound at a time; Focus brings it back
    entry.cell.querySelector(".voice-grid-label")!.textContent = res.streamName
        ? `${entry.nickname} · ${res.streamName}`
        : entry.nickname;
}

/** Keeps the grid's cells and watches in step with who is sharing right now. */
function syncStreamGrid(): void {
    if (stageState !== "grid") return;
    const host = stageEl<HTMLElement>(".voice-streams");
    if (!host) return;
    const sharers = roomSharers();
    const present = new Set(sharers.map((o) => o.userId));
    for (const [userId, entry] of gridCells) {
        if (present.has(userId)) continue;
        entry.cell.remove();
        gridCells.delete(userId);
        if (entry.windowId !== null) void api.closeViewerWindow(entry.windowId);
        void api.stage.stop(userId);
    }
    for (const occ of sharers) {
        if (gridCells.has(occ.userId)) continue;
        const cell = buildGridCell(occ);
        host.appendChild(cell);
        gridCells.set(occ.userId, { nickname: occ.nickname, cell, windowId: null, watching: false });
        void startGridWatch(occ.userId);
    }
    if (gridCells.size === 0) {
        // Nobody is sharing any more: the grid has nothing to show.
        void stopStageWatch();
        return;
    }
    layoutStreamGrid();
    renderSharingHeader();
}

async function enterStreamGrid(): Promise<void> {
    if (stageState === "grid") return;
    if (!requireServerAccess()) return;
    if (!isInVoice || !currentChannelId || roomSharers().length === 0) return;
    if (stageState === "starting" || stageState === "popping" || stageState === "returning") return;
    if (stageState !== "idle") await stopStageWatch(); // the focus watch (and a popped Viewer) first
    openVoiceTab({ focus: true });
    if (!voiceTab) return;
    stageState = "grid";
    stageTarget = null;
    renderStage();
    syncStreamGrid();
}

/** Leaves the grid, closing every stream and any popped Viewer. */
async function leaveStreamGrid(): Promise<void> {
    const windows = [...gridCells.values()].map((e) => e.windowId).filter((w): w is number => w !== null);
    for (const entry of gridCells.values()) entry.cell.remove();
    gridCells.clear();
    stageState = "idle";
    await Promise.all(windows.map((w) => api.closeViewerWindow(w)));
    await api.stage.stop();
    renderStage();
}

/** Grid → Focus on one stream (double-click / ⤢, or the Focus toggle). */
async function focusStream(userId: string): Promise<void> {
    const occ = roomSharers().find((o) => o.userId === userId);
    const channelId = currentChannelId;
    if (!occ || !channelId) return;
    writeStreamLayoutPref("focus");
    if (stageState === "grid") await leaveStreamGrid();
    await startStageWatch({ userId, nickname: occ.nickname, channelId });
}

async function popOutGridStream(userId: string): Promise<void> {
    const entry = gridCells.get(userId);
    const channelId = currentChannelId;
    if (!entry || !channelId || entry.windowId !== null) return;
    entry.watching = false;
    await api.stage.stop(userId);
    const res = await api.openScreenShareViewer(userId, entry.nickname, channelId, roomNameForStage());
    if (!gridCells.has(userId) || stageState !== "grid") {
        if (res.success && typeof res.windowId === "number") void api.closeViewerWindow(res.windowId);
        return;
    }
    if (!res.success || typeof res.windowId !== "number") {
        showToast(escapeHtml(res.error ?? "Couldn't open the stream window"));
        void startGridWatch(userId);
        return;
    }
    entry.windowId = res.windowId;
    entry.cell.classList.add("is-popped");
}

async function bringBackGridStream(userId: string): Promise<void> {
    const entry = gridCells.get(userId);
    if (!entry || entry.windowId === null) return;
    const closed = await api.closeViewerWindow(entry.windowId);
    if (!closed) {
        entry.windowId = null;
        entry.cell.classList.remove("is-popped");
        void startGridWatch(userId);
    }
}

function paintStageQuality(): void {
    const el = stageEl<HTMLElement>(".voice-stream-quality");
    if (!el) return;
    const h = stageTarget ? api.stage.qualityHeight(stageTarget.userId) : null;
    el.textContent = h ? `${h}p` : "";
}

function stopStageQualityPoll(): void {
    if (stageQualityTimer) clearInterval(stageQualityTimer);
    stageQualityTimer = null;
}

/** Starts (or switches) the in-app watch of `target`, opening the room tab. */
async function startStageWatch(target: { userId: string; nickname: string; channelId: string }): Promise<void> {
    if (!requireServerAccess()) return; // PRD 18.18
    if (!isInVoice || currentChannelId !== target.channelId) {
        showToast("Join the voice channel to watch its stream.");
        return;
    }
    if (stageState === "starting" || stageState === "popping" || stageState === "returning") return;
    if (stageState === "grid") await leaveStreamGrid();
    else if (stageState !== "idle") await stopStageWatch(); // switching to another sharer

    openVoiceTab({ focus: true });
    if (!voiceTab) return;
    stageTarget = { ...target };
    stageStreamName = "";
    stageState = "starting";
    renderStage();

    const res = await api.stage.watch(target.userId, target.channelId, "voice-stream-video");
    // Closed or switched while connecting: the preload already dropped its side if it could.
    if (stageState !== "starting" || stageTarget?.userId !== target.userId) {
        if (res.success) await api.stage.stop();
        return;
    }
    if (!res.success) {
        stageState = "idle";
        stageTarget = null;
        renderStage();
        showToast(escapeHtml(res.error ?? "Couldn't start the stream"));
        return;
    }
    stageStreamName = res.streamName ?? "";
    if (stageStreamName) knownStreamNames.set(target.userId, stageStreamName);
    api.stage.setMuted(false, target.userId);
    stageState = "stage";
    renderStage();
    paintStageQuality();
    stopStageQualityPoll();
    let tries = 0;
    stageQualityTimer = setInterval(() => {
        paintStageQuality();
        if (++tries >= 10 || (stageTarget && api.stage.qualityHeight(stageTarget.userId))) stopStageQualityPoll();
    }, 500);
}

/** Ends the stage watch and any popped Viewer; always lands in `idle`. */
async function stopStageWatch(message?: string): Promise<void> {
    if (stageState === "idle" && !stageViewerWindowId && gridCells.size === 0 && !api.stage.isWatching()) return;
    const windowId = stageViewerWindowId;
    stageViewerWindowId = null;
    const gridWindows = [...gridCells.values()].map((e) => e.windowId).filter((w): w is number => w !== null);
    for (const entry of gridCells.values()) entry.cell.remove();
    gridCells.clear();
    stageState = "idle";
    stageTarget = null;
    stageStreamName = "";
    stopStageQualityPoll();
    if (windowId !== null) await api.closeViewerWindow(windowId);
    await Promise.all(gridWindows.map((w) => api.closeViewerWindow(w)));
    await api.stage.stop();
    renderStage();
    if (message) showToast(escapeHtml(message));
}

/** Moves the stream from the stage into the Viewer window. */
async function popOutStage(): Promise<void> {
    if (stageState !== "stage" || !stageTarget) return;
    const target = stageTarget;
    stageState = "popping";
    renderStage();
    await api.stage.stop();
    const res = await api.openScreenShareViewer(target.userId, target.nickname, target.channelId, roomNameForStage());
    if (stageState !== "popping") {
        // Torn down while opening (left voice, access lost): don't leave the window behind.
        if (res.success && typeof res.windowId === "number") void api.closeViewerWindow(res.windowId);
        return;
    }
    if (!res.success || typeof res.windowId !== "number") {
        stageState = "idle";
        stageTarget = null;
        renderStage();
        showToast(escapeHtml(res.error ?? "Couldn't open the stream window"));
        return;
    }
    stageViewerWindowId = res.windowId;
    stageState = "popped";
    renderStage();
}

/** The Viewer is gone: put the stream back on the stage. */
async function returnToStage(): Promise<void> {
    if (!stageTarget || (stageState !== "popped" && stageState !== "returning")) return;
    const target = stageTarget;
    stageViewerWindowId = null;
    stageState = "returning";
    renderStage();
    const res = await api.stage.watch(target.userId, target.channelId, "voice-stream-video");
    if (stageState !== "returning") {
        if (res.success) await api.stage.stop();
        return;
    }
    if (!res.success) {
        stageState = "idle";
        stageTarget = null;
        renderStage();
        showToast(escapeHtml(res.error ?? "The stream couldn't come back"));
        return;
    }
    stageStreamName = res.streamName ?? stageStreamName;
    stageState = "stage";
    renderStage();
    paintStageQuality();
}

/** "Bring it back": close the Viewer; its closing returns the stream (viewer-closed). */
async function bringBackStage(): Promise<void> {
    if (stageState !== "popped" || stageViewerWindowId === null) return;
    const windowId = stageViewerWindowId;
    stageState = "returning";
    renderStage();
    const closed = await api.closeViewerWindow(windowId);
    if (!closed) await returnToStage(); // the window was already gone: no event will come
}

api.on("viewer-closed", (data: { windowId: number }) => {
    // A grid stream's Viewer closed: that stream goes back into its cell.
    for (const [userId, entry] of gridCells) {
        if (entry.windowId === data.windowId) {
            entry.windowId = null;
            entry.cell.classList.remove("is-popped");
            if (stageState === "grid") void startGridWatch(userId);
            return;
        }
    }
    // The user closed the Viewer (its ✕, Exit Stream or Return): the stream comes home.
    if (data.windowId === stageViewerWindowId && stageState === "popped") void returnToStage();
    else if (data.windowId === stageViewerWindowId && stageState === "returning") void returnToStage();
});

api.on("stage-ended", (data: { targetUserId: string; reason: string; kind: "ended" | "lost" }) => {
    if (stageState === "grid") {
        // One stream of the grid ended: its cell goes (the presence update does the same for a stopped share).
        const entry = gridCells.get(data.targetUserId);
        if (entry) {
            entry.cell.remove();
            gridCells.delete(data.targetUserId);
            if (gridCells.size === 0) void stopStageWatch(data.kind === "ended" ? "The stream ended" : "Lost the connection to the stream");
            else layoutStreamGrid();
        }
        return;
    }
    if (stageState !== "stage" || stageTarget?.userId !== data.targetUserId) return;
    void stopStageWatch(data.kind === "ended" ? "The stream ended" : "Lost the connection to the stream");
});

// Stage controls (the buttons live in the room tab, built once per tab).
document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest(".voice-stream-popout")) void popOutStage();
    else if (t.closest(".voice-stream-bringback")) void bringBackStage();
    else if (t.closest(".voice-stream-showwindow")) {
        if (stageViewerWindowId !== null) void api.focusViewerWindow(stageViewerWindowId);
    } else if (t.closest(".voice-stream-fullscreen")) {
        const stream = stageEl<HTMLElement>(".voice-stream-main");
        if (!stream) return;
        if (document.fullscreenElement) void document.exitFullscreen();
        else void stream.requestFullscreen().catch(() => showToast("Fullscreen isn't available here."));
    }
});
document.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.classList?.contains("voice-stream-volume")) return;
    api.stage.setVolume(Number(t.value), stageTarget?.userId);
    const readout = stageEl<HTMLElement>(".voice-stream-volume-readout");
    if (readout) readout.textContent = `${t.value}%`;
});

// ── Voice Controls ────────────────────────────────────────────────────────

/** "{room} / {category}" for the voice dock (PRD 20 U1); "" when not in voice. */
function voiceRoomLabel(): string {
    const node = isInVoice && currentChannelId ? findChannelNodeById(currentTree, currentChannelId) : null;
    if (!node) return "";
    const parent = node.parentId ? findChannelNodeById(currentTree, node.parentId) : null;
    return parent ? `${node.name} / ${parent.name}` : node.name;
}

function renderVoiceDockSub(): void {
    const label = voiceRoomLabel();
    const reconnecting = voicePanel.classList.contains("reconnecting");
    voiceChannelName.textContent = reconnecting ? `${label} (reconnecting…)` : label;
}

function updateVoiceUI(_channelName?: string): void {
    refreshLocalSpeakingHalo();
    updateCardVoiceHook?.(); // PRD 19 C12: the in-call restart note follows the room
    if (isInVoice) {
        renderVoiceRoom(); // PRD 19 C9 (a joined or switched room)
        voicePanel.classList.add("visible");
        renderVoiceDockSub();
        // Icon-only buttons (PRD 12.9) — state is conveyed by the `.active`
        // (red) styling plus the tooltip, not by swapping label text.
        btnMute.title = isMuted ? "Unmute" : "Mute";
        btnMute.classList.toggle("active", isMuted);
        btnDeafen.title = isDeafened ? "Undeafen" : "Deafen";
        btnDeafen.classList.toggle("active", isDeafened);
        btnMute.querySelector("i")!.className = `ph ${isMuted ? "ph-microphone-slash" : "ph-microphone"}`;
        btnDeafen.querySelector("i")!.className = `ph ${isDeafened ? "ph-speaker-slash" : "ph-headphones"}`;
        updateShareScreenButton();
    } else {
        if (stageState !== "idle") void stopStageWatch(); // PRD 19 C10 (also covers a popped Viewer)
        closeVoiceTab(); // PRD 19 C9: leaving voice, a kick or a deleted channel closes the room tab
        voicePanel.classList.remove("visible");
        isSharingScreen = false;
        // Leaving voice while sharing (Leave Voice, a kick, a disconnect)
        // skips the explicit stop-sharing path — without this, the title
        // bar's 🔴 marker and (harmlessly, since #voice-panel itself is
        // now hidden) the alert banner's `.visible` class would stay
        // stuck set.
        updateShareScreenButton();
    }
}

/**
 * Mirrors MAX_SCREEN_SHARES_PER_ROOM in packages/shared-types/src/models.ts
 * (PRD 19 A4); the renderer is a classic script and cannot import it. The
 * server is the authority — this only labels the button and saves a pointless
 * picker.
 */
const MAX_SCREEN_SHARES_PER_ROOM = 5;
const SCREEN_SHARE_LIMIT_TOAST = "All 5 stream slots are in use. You can share when someone stops.";

/** How many people in the room you are in are sharing their screen right now. */
function countRoomScreenShares(): number {
    if (!isInVoice || !currentChannelId) return 0;
    const node = findChannelNodeById(currentTree, currentChannelId);
    return node ? node.occupants.filter((o) => o.isSharingScreen).length : 0;
}

/** True when you are not sharing and the room has no free stream slot. */
function isScreenShareRoomFull(): boolean {
    return !isSharingScreen && countRoomScreenShares() >= MAX_SCREEN_SHARES_PER_ROOM;
}

/** Reflects sharing/enabled state on the Share Screen button (PRD 12.9). */
/**
 * Screen sharing is disabled outright on macOS builds — the packaging
 * pipeline (see `apps/client/package.json`'s `build.mac`) has never been
 * run on real macOS hardware, so this ships with the feature turned off
 * rather than an untested code path reaching users. Checked ahead of the
 * server-side `serverScreenShareEnabled` toggle so the tooltip explains
 * the more specific reason.
 */
function updateShareScreenButton(): void {
    btnShareScreen.classList.toggle("active", isSharingScreen);
    // The LIVE badge (visible to others) and this button's own red/icon
    // state are easy to miss while actually paying attention to whatever's
    // on the shared screen — a loud, impossible-to-miss banner + a second,
    // bigger stop button (`btnStopShareAlert`, wired below) and a
    // title-bar marker are the redundant, harder-to-miss cues instead.
    screenShareAlertBanner.classList.toggle("visible", isSharingScreen);
    const sharingChip = document.getElementById("titlebar-sharing"); // PRD 19 R7: the title-bar cue
    if (sharingChip) sharingChip.style.display = isSharingScreen ? "" : "none";
    updateWindowTitle();
    if (api.platform === "darwin") {
        btnShareScreen.title = "Screen sharing isn't available on macOS yet";
        btnShareScreen.disabled = true;
        renderCallBar();
        return;
    }
    const roomFull = serverScreenShareEnabled && isScreenShareRoomFull();
    btnShareScreen.classList.toggle("share-full", roomFull);
    btnShareScreen.title = isSharingScreen
        ? "Stop Sharing"
        : !serverScreenShareEnabled
          ? "Screen sharing is disabled on this server"
          : roomFull
            ? `Share screen · ${MAX_SCREEN_SHARES_PER_ROOM}/${MAX_SCREEN_SHARES_PER_ROOM}`
            : "Share Screen";
    btnShareScreen.disabled = !serverScreenShareEnabled;
    renderCallBar();
}

/** Copies the dock's mute/deafen/share state onto the room tab's call bar (PRD 20 U2). */
function renderCallBar(): void {
    if (!voiceTab) return;
    const root = voiceTab.contentEl;
    const mute = root.querySelector('[data-call="mute"]') as HTMLButtonElement | null;
    const deafen = root.querySelector('[data-call="deafen"]') as HTMLButtonElement | null;
    const share = root.querySelector('[data-call="share"]') as HTMLButtonElement | null;
    if (!mute || !deafen || !share) return;
    mute.classList.toggle("active", isMuted);
    mute.title = isMuted ? "Unmute" : "Mute";
    mute.querySelector("i")!.className = `ph ${isMuted ? "ph-microphone-slash" : "ph-microphone"}`;
    deafen.classList.toggle("active", isDeafened);
    deafen.title = isDeafened ? "Undeafen" : "Deafen";
    deafen.querySelector("i")!.className = `ph ${isDeafened ? "ph-speaker-slash" : "ph-headphones"}`;
    share.classList.toggle("active", isSharingScreen);
    share.classList.toggle("share-full", btnShareScreen.classList.contains("share-full"));
    share.disabled = btnShareScreen.disabled;
    share.title = btnShareScreen.title;
    (share.querySelector(".callbar-share-label") as HTMLElement).textContent = isSharingScreen
        ? "Stop sharing"
        : btnShareScreen.classList.contains("share-full")
          ? `Share screen · ${MAX_SCREEN_SHARES_PER_ROOM}/${MAX_SCREEN_SHARES_PER_ROOM}`
          : "Share screen";
}

// Shared mute/deafen/disconnect logic — used by both the button click handlers
// below and the keyboard-shortcut handlers, so sound alerts stay in sync between
// the two triggers instead of silently drifting apart (see PRD 4.15).
function toggleMuteAndNotify(): void {
    if (isDeafened) {
        // Clicking Mute while deafened auto-undeafens first — restoring
        // whatever mute state existed before deafening — then a normal mute
        // toggle applies on top of that resolved state below, as a single
        // combined action (one SET_VOICE_STATE, one sound: PRD 10.4).
        const resolved = api.toggleDeafen();
        isMuted = resolved.isMuted;
        isDeafened = resolved.isDeafened;
    }

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
    if (isInVoice) {
        SoundAlert.play(isMuted ? "mic_muted.mp3" : "mic_activated.mp3");
        api.setVoiceState(isMuted, isDeafened);
    }
}

function toggleDeafenAndNotify(): void {
    const resolved = api.toggleDeafen();
    isMuted = resolved.isMuted;
    isDeafened = resolved.isDeafened;
    updateVoiceUI();
    if (isInVoice) {
        SoundAlert.play(isDeafened ? "sound_muted.mp3" : "sound_resumed.mp3");
        api.setVoiceState(isMuted, isDeafened);
    }
}

// ── Self-Hear Mic Monitor (PRD 14.10) ────────────────────────────────────────

/**
 * Forces mute+deafen together when self-hear turns on while actually in a
 * voice channel — deafening already auto-mutes the mic if it wasn't already
 * paused (the existing accumulation logic, PRD 10.4), so a single
 * `toggleDeafenAndNotify()` call covers both at once with no separate mute
 * step needed. Only acts (and only remembers having forced anything) if not
 * already deafened going in, so disabling self-hear later never undoes a
 * deafen the user had already set themselves. Called both from the toggle
 * handler and, since a fresh `VoiceService` is constructed per join, from
 * both places a voice session (re)starts.
 */
function applySelfHearMuteDeafenForcing(): void {
    if (isInVoice && !isDeafened) {
        selfHearForcedDeafen = true;
        toggleDeafenAndNotify();
    } else {
        selfHearForcedDeafen = false;
    }
}

function updateSelfHearBanner(): void {
    selfHearBanner?.classList.toggle("visible", selfHearEnabled && isInVoice);
}

/** Single entry point for turning self-hear on/off — used by the Settings
 *  checkbox, the banner's "Stop Previewing" button, and leaving voice. */
function setSelfHearEnabledAndNotify(enabled: boolean): void {
    selfHearEnabled = enabled;
    // The card's expand/collapse is driven purely by this checkbox's own
    // :checked state via CSS :has() — no separate visibility toggle needed.
    if (chkSelfHear) chkSelfHear.checked = enabled;

    if (enabled) {
        applySelfHearMuteDeafenForcing();
        api.setSelfHearEnabled(true);
    } else {
        api.setSelfHearEnabled(false);
        // Restore exactly what self-hear itself forced — if the user has
        // since manually undeafened some other way, there's nothing left
        // to restore.
        if (selfHearForcedDeafen && isDeafened) {
            toggleDeafenAndNotify();
        }
        selfHearForcedDeafen = false;
    }
    updateSelfHearBanner();
}

function leaveVoiceAndNotify(): void {
    api.leaveVoiceChannel();
    isInVoice = false;
    currentChannelId = null;
    previousOccupantIds = new Set();
    previousSharingIds = new Set();
    stopMicLevelMeter();
    // Self-hear (PRD 14.10) doesn't carry over into an unrelated future
    // join — the monitor graph itself is already gone with the rest of the
    // torn-down session, so just resets the UI/flags to match. No need to
    // restore mute/deafen here: leaving the channel makes that moot.
    if (selfHearEnabled) {
        selfHearEnabled = false;
        selfHearForcedDeafen = false;
        if (chkSelfHear) chkSelfHear.checked = false;
        updateSelfHearBanner();
    }
    updateVoiceUI();
    log("Left voice channel", "info");
    SoundAlert.play("leaving-channel.mp3");
    if (currentTree.length > 0) {
        renderTree(currentTree);
    }
}

btnMute.addEventListener("click", toggleMuteAndNotify);

btnDeafen.addEventListener("click", toggleDeafenAndNotify);

/** Shared by the Share Screen button's own stop path and the redundant, harder-to-miss `btnStopShareAlert`. */
async function stopSharingScreen(): Promise<void> {
    await api.stopScreenShare();
    isSharingScreen = false;
    updateShareScreenButton();
    // Lets other occupants' sharing badge disappear (PRD 12.12).
    api.setScreenShareState(false);
}

btnShareScreen.addEventListener("click", async () => {
    if (isSharingScreen) {
        await stopSharingScreen();
        return;
    }
    // Full room: say so without opening the picker (the server still decides).
    if (isScreenShareRoomFull()) {
        showToast(SCREEN_SHARE_LIMIT_TOAST);
        return;
    }
    if (api.isLinuxWayland) {
        await startScreenShareViaSystemPicker();
        return;
    }
    await openScreenShareModal();
});

btnStopShareAlert.addEventListener("click", stopSharingScreen);
document.getElementById("titlebar-sharing")?.addEventListener("click", stopSharingScreen); // PRD 19 R7

/**
 * Linux/Wayland-only path: uses `getDisplayMedia()` (via
 * `startScreenShareViaSystemPicker`'s underlying voice-service call), not
 * `getDesktopSources()` + `startScreenShareVideo()` — that two-step API
 * showed the OS portal picker a *second* time inside the video-capture
 * step even after our own `getDesktopSources()` call had already shown it
 * once, with the resulting feed not reliably tied to what was actually
 * granted (observed as a black feed on the viewer side). `getDisplayMedia`
 * is Electron's single-round-trip native path for the Wayland portal
 * picker instead of a redundant second one on top of it.
 *
 * There's no in-app modal step left to surface the "share this window's
 * audio too" checkbox on this path (the whole point here is trusting the
 * OS picker instead of our own UI for video) — the OS picker itself has no
 * concept of it either, since it only ever asks about video. PRD 12.11's
 * business rule (audio only for an individual window, never a full-monitor
 * share) still has to be respected, so this asks via a native dialog
 * instead — but not "share <picked source>'s audio too?": confirmed live
 * that `videoRes.label` here is never a real per-window name on this
 * platform (the Wayland portal doesn't expose one to the requesting app at
 * all), so there'd be nothing meaningful to ask about or match against.
 * `pickAudioAppToShare()` instead offers a direct choice from whichever
 * apps are *actually* producing audio right now (queried via PipeWire/
 * PulseAudio introspection, which isn't privacy-gated the way window
 * capture is), and returns the exact name to hand to
 * `startAppAudioCapture` — no name-matching heuristic involved.
 *
 * Confirmed live (via a temporary diagnostic, since removed) that the
 * portal's source id (`"window:1:0"`) is just a sequential handle scoped
 * to the one grant in this request, not a real identifier of any kind —
 * there's no PID or name to recover from it by any means, not just an
 * unreliable one, so `videoRes.label` here always ends up the generic
 * "your screen" fallback for a window share. `promptForStreamName()`
 * (Cancel stops the capture; Change re-opens the portal) lets the user set their own display name instead, purely a local/UI
 * concern (never sent to the OS picker or portal) — a new modal because
 * there's no existing in-app step on this path to attach a field to,
 * unlike the Selection Modal's own name input on other platforms.
 */
let portalAttempt = 0;

async function startScreenShareViaSystemPicker(): Promise<void> {
    const attempt = ++portalAttempt;
    const card = document.getElementById("portal-wait-card") as HTMLElement;
    card.classList.add("visible");
    const videoRes = await api.startScreenShareViaSystemPicker();
    card.classList.remove("visible");
    if (attempt !== portalAttempt) {
        // Cancelled while the portal was open: drop whatever it returned.
        if (videoRes.success) await api.stopScreenShare();
        return;
    }
    if (!videoRes.success) {
        if (videoRes.errorCode === "SCREEN_SHARE_LIMIT") {
            // The capture was already stopped by the voice service.
            showToast(SCREEN_SHARE_LIMIT_TOAST);
            return;
        }
        log(`Failed to start screen share: ${videoRes.error}`, "error");
        return;
    }

    const choice = await promptForStreamName(videoRes.label ?? "");
    if (choice.action !== "start") {
        await api.stopScreenShare();
        if (choice.action === "change") await startScreenShareViaSystemPicker();
        return;
    }

    isSharingScreen = true;
    updateShareScreenButton();
    const resolvedName = choice.name || videoRes.label || "your screen";
    // Sent only once the resolved name is known, so viewers' Viewer window
    // (which reads this back via WATCH_SCREEN_SHARE) shows the exact same
    // name this client's own "Started sharing" log does, not a stale
    // pre-naming placeholder.
    api.setScreenShareState(true, resolvedName);
    log(`Started sharing "${resolvedName}"`, "success");

    if (videoRes.sourceType === "window" && (await api.platformSupportsAudioCapture())) {
        const chosenApp = await api.pickAudioAppToShare();
        if (chosenApp) {
            const audioRes = await api.startAppAudioCapture(undefined, chosenApp);
            if (!audioRes.success) {
                log(`Screen video is sharing, but audio couldn't start: ${audioRes.error}`, "error");
            }
        }
    }
}

document.getElementById("btn-portal-wait-cancel")!.addEventListener("click", () => {
    portalAttempt++; // the pending attempt is now stale
    (document.getElementById("portal-wait-card") as HTMLElement).classList.remove("visible");
});

type StreamNameChoice = { action: "start"; name: string } | { action: "change" } | { action: "cancel" };

/**
 * Shows `#stream-name-modal` for the Linux portal flow (PRD 20 S2): the chosen
 * source, a name field and Start sharing / Change / Cancel. Resolves with the
 * choice; an empty `name` means "use the default name" (see call site).
 */
function promptForStreamName(sourceName: string): Promise<StreamNameChoice> {
    return new Promise((resolve) => {
        const roomName = currentChannelId ? findChannelNodeById(currentTree, currentChannelId)?.name : null;
        (document.getElementById("stream-name-sub") as HTMLElement).textContent = roomName
            ? `Everyone in ${roomName} will be able to watch.`
            : "Everyone in your voice room will be able to watch.";
        (document.getElementById("stream-name-source") as HTMLElement).textContent = sourceName || "Your screen";
        const preview = document.getElementById("stream-name-preview") as HTMLElement;
        const paint = (): void => {
            preview.textContent = `Others will see: ${streamNameInput.value.trim() || sourceName || "your screen"}`;
        };
        streamNameInput.value = "";
        streamNameInput.placeholder = sourceName ? `Leave blank to use \u201c${sourceName}\u201d` : "Leave blank to use the default";
        paint();
        streamNameModal.classList.add("visible");
        streamNameInput.focus();
        const btnChange = document.getElementById("btn-stream-name-change") as HTMLButtonElement;
        const btnClose = document.getElementById("btn-stream-name-close") as HTMLButtonElement;
        const finish = (choice: StreamNameChoice): void => {
            streamNameModal.classList.remove("visible");
            btnStreamNameConfirm.removeEventListener("click", onStart);
            btnStreamNameCancel.removeEventListener("click", onCancel);
            btnClose.removeEventListener("click", onCancel);
            btnChange.removeEventListener("click", onChange);
            streamNameModal.removeEventListener("click", onBackdrop);
            streamNameInput.removeEventListener("input", paint);
            streamNameInput.removeEventListener("keydown", onKey);
            resolve(choice);
        };
        const onStart = (): void => finish({ action: "start", name: streamNameInput.value.trim() });
        const onCancel = (): void => finish({ action: "cancel" });
        const onChange = (): void => finish({ action: "change" });
        const onBackdrop = (e: MouseEvent): void => {
            if (e.target === streamNameModal) onCancel();
        };
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === "Enter") onStart();
            else if (e.key === "Escape") onCancel();
        };
        btnStreamNameConfirm.addEventListener("click", onStart);
        btnStreamNameCancel.addEventListener("click", onCancel);
        btnClose.addEventListener("click", onCancel);
        btnChange.addEventListener("click", onChange);
        streamNameModal.addEventListener("click", onBackdrop);
        streamNameInput.addEventListener("input", paint);
        streamNameInput.addEventListener("keydown", onKey);
    });
}

btnLeaveVoice.addEventListener("click", leaveVoiceAndNotify);

// ── Create Channel Modal ──────────────────────────────────────────────────

btnCreateChannel.addEventListener("click", () => {
    if (!isConnected) return;
    newChannelName.value = "";
    newChannelNsfw.checked = false;
    newChannelNsfwRow.style.display = newChannelType.value === "TEXT" ? "flex" : "none";
    (document.getElementById("create-channel-sub") as HTMLElement).textContent = `in ${connectedServerName ?? "this server"}`;
    setCreateChannelIconDraft(null);
    paintCreateChannelIconRow();
    paintChannelTypeSegments();
    createChannelModal.classList.add("visible");
    newChannelName.focus();
});

/** The Text | Voice segments mirror the (hidden) select, which stays the source of truth (PRD 19 R5). */
function paintChannelTypeSegments(): void {
    document.querySelectorAll<HTMLButtonElement>(".create-channel-type .segmented-option").forEach((b) => {
        const on = b.dataset.channelType === newChannelType.value;
        b.classList.toggle("active", on);
        b.setAttribute("aria-checked", String(on));
    });
}

document.querySelectorAll<HTMLButtonElement>(".create-channel-type .segmented-option").forEach((b) => {
    b.addEventListener("click", () => {
        if (newChannelType.value === b.dataset.channelType) return;
        newChannelType.value = b.dataset.channelType ?? "TEXT";
        newChannelType.dispatchEvent(new Event("change"));
        paintChannelTypeSegments();
    });
});

newChannelType.addEventListener("change", () => {
    newChannelNsfwRow.style.display = newChannelType.value === "TEXT" ? "flex" : "none";
    if (newChannelType.value !== "TEXT") newChannelNsfw.checked = false;
    paintCreateChannelIconRow();
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
    const isNsfw = type === "TEXT" && newChannelNsfw.checked;

    const result = await api.createChannel(currentServerId, name, type, parentId, isNsfw);
    if (result.success) {
        const draft = createChannelIconDraft;
        if (draft && result.channelId && type === "TEXT") void applyNewChannelIcon(result.channelId, draft);
        setCreateChannelIconDraft(null);
        log(`Channel "${name}" created`, "success");
        SoundAlert.play("channel_created.mp3");
        createChannelModal.classList.remove("visible");
    } else {
        log(`Failed to create channel: ${result.error}`, "error");
        if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
    }
});

// ── Delete Channel Modal ──────────────────────────────────────────────────

function showDeleteModal(channelId: string, channelName: string): void {
    pendingDeleteChannelId = channelId;
    deleteChannelNameEl.textContent = channelName;
    refreshDeleteModalAffected();
    deleteChannelModal.classList.add("visible");
}

/**
 * For a VOICE channel with people in it, says who is affected (PRD 19 B7).
 * Recomputed when the modal opens and whenever a presence update for that
 * channel arrives while it is open. Any other channel keeps the plain text.
 */
function refreshDeleteModalAffected(): void {
    const node = pendingDeleteChannelId ? findChannelNodeById(currentTree, pendingDeleteChannelId) : null;
    const n = node && node.type === "VOICE" ? node.occupants.length : 0;
    if (n > 0) {
        deleteChannelAffectedEl.textContent =
            `The ${n} ${n === 1 ? "person" : "people"} in it will be disconnected. ` +
            `The channel is removed for everyone on the server. This can't be undone.`;
        deleteChannelAffectedEl.style.display = "";
        deleteChannelTailEl.textContent = ""; // the sentence above already says it
    } else {
        deleteChannelAffectedEl.textContent = "";
        deleteChannelAffectedEl.style.display = "none";
        deleteChannelTailEl.textContent = " This cannot be undone.";
    }
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

// ── Rename Channel Modal (PRD 4.5) ──────────────────────────────────────────

const renameChannelError = document.getElementById("rename-channel-error") as HTMLDivElement;
let renameChannelOriginal = "";

/** Lower-cased names of the channel's siblings of the same type (the same list in the tree). */
function siblingChannelNames(channelId: string): Set<string> {
    const names = new Set<string>();
    const self = findChannelNodeById(currentTree, channelId);
    if (!self) return names;
    const parent = self.parentId ? findChannelNodeById(currentTree, self.parentId) : null;
    for (const n of parent ? parent.children : currentTree) {
        if (n.id !== channelId && n.type === self.type) names.add(n.name.trim().toLowerCase());
    }
    return names;
}

/** Returns the inline error for the current input, or "" when it can be saved. */
function validateRenameChannel(): string {
    const name = renameChannelInput.value.trim();
    if (!name) return "Give the channel a name.";
    if (pendingRenameChannelId && siblingChannelNames(pendingRenameChannelId).has(name.toLowerCase())) {
        return "Another channel here is already called that.";
    }
    return "";
}

function refreshRenameChannel(): void {
    const error = validateRenameChannel();
    renameChannelError.textContent = error;
    btnRenameConfirm.disabled = !!error || renameChannelInput.value.trim() === renameChannelOriginal;
}

function closeRenameChannel(): void {
    renameChannelModal.classList.remove("visible");
    pendingRenameChannelId = null;
}

function showRenameModal(channelId: string, currentName: string): void {
    pendingRenameChannelId = channelId;
    renameChannelOriginal = currentName;
    renameChannelInput.value = currentName;
    refreshRenameChannel();
    renameChannelError.textContent = ""; // no complaint before the user has typed anything
    renameChannelModal.classList.add("visible");
    renameChannelInput.focus();
    renameChannelInput.select();
}

async function submitRenameChannel(): Promise<void> {
    if (!pendingRenameChannelId || btnRenameConfirm.disabled) return;
    const channelId = pendingRenameChannelId;
    const name = renameChannelInput.value.trim();
    btnRenameConfirm.disabled = true;
    const result = await api.updateChannel(channelId, { name });
    if (result.success) {
        log(`Channel renamed to "${name}"`, "success");
        closeRenameChannel();
        return;
    }
    renameChannelError.textContent = result.error ?? "The channel couldn't be renamed.";
    if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
    btnRenameConfirm.disabled = false;
}

renameChannelInput.addEventListener("input", refreshRenameChannel);
renameChannelInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        void submitRenameChannel();
    } else if (e.key === "Escape") {
        e.preventDefault();
        closeRenameChannel();
    }
});
btnRenameCancel.addEventListener("click", closeRenameChannel);
renameChannelModal.addEventListener("click", (e) => {
    if (e.target === renameChannelModal) closeRenameChannel();
});
btnRenameConfirm.addEventListener("click", () => void submitRenameChannel());

// ── Move Channel Modal (PRD 14.5) ───────────────────────────────────────────

/** Marks every descendant of `node` (not `node` itself) as an invalid move
 *  target, so the picker can't offer a choice the server would reject
 *  anyway as a cycle. */
function collectDescendantIds(node: TreeNode, into: Set<string>): void {
    for (const child of node.children) {
        into.add(child.id);
        collectDescendantIds(child, into);
    }
}

/** Populates the "Move to…" select with every channel except the one being
 *  moved and its own descendants (moving into either would be rejected
 *  server-side as a no-op or a cycle — filtering them out here avoids
 *  offering a choice that can only ever fail). */
function populateMoveChannelSelect(tree: TreeNode[], channelId: string): void {
    const selfNode = findTreeNode(tree, channelId);
    const invalidIds = new Set<string>([channelId]);
    if (selfNode) collectDescendantIds(selfNode, invalidIds);

    moveChannelSelect.innerHTML = '<option value="">— None (top-level) —</option>';

    const addOptions = (nodes: TreeNode[], depth: number) => {
        for (const node of nodes) {
            // Skip (and don't recurse into) an invalid node — it and
            // everything beneath it are all invalid targets too.
            if (invalidIds.has(node.id)) continue;

            const indent = "  ".repeat(depth);
            const option = document.createElement("option");
            option.value = node.id;
            option.textContent = `${indent}${node.name}`;
            moveChannelSelect.appendChild(option);

            if (node.children.length > 0) {
                addOptions(node.children, depth + 1);
            }
        }
    };
    addOptions(tree, 0);
}

function showMoveModal(channelId: string, channelName: string): void {
    pendingMoveChannelId = channelId;
    populateMoveChannelSelect(currentTree, channelId);
    moveChannelModal.classList.add("visible");
}

btnMoveCancel.addEventListener("click", () => {
    moveChannelModal.classList.remove("visible");
    pendingMoveChannelId = null;
});

moveChannelModal.addEventListener("click", (e) => {
    if (e.target === moveChannelModal) {
        moveChannelModal.classList.remove("visible");
        pendingMoveChannelId = null;
    }
});

btnMoveConfirm.addEventListener("click", async () => {
    if (!pendingMoveChannelId) return;
    const channelId = pendingMoveChannelId;
    const newParentId = moveChannelSelect.value || null;
    moveChannelModal.classList.remove("visible");
    pendingMoveChannelId = null;

    const result = await api.moveChannel(channelId, newParentId);
    if (result.success) {
        log("Channel moved", "success");
    } else {
        log(`Failed to move channel: ${result.error}`, "error");
        if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
    }
});

// ── NSFW Channel Confirmation Modal (PRD 4.7) ───────────────────────────────

btnNsfwCancel.addEventListener("click", () => {
    nsfwConfirmModal.classList.remove("visible");
    pendingNsfwChannel = null;
});

nsfwConfirmModal.addEventListener("click", (e) => {
    if (e.target === nsfwConfirmModal) {
        nsfwConfirmModal.classList.remove("visible");
        pendingNsfwChannel = null;
    }
});

btnNsfwConfirm.addEventListener("click", () => {
    nsfwConfirmModal.classList.remove("visible");
    // Only an explicit Continue persists the tick — Cancel/backdrop discard it.
    if (chkNsfwDontWarn.checked) setNsfwWarningEnabled(false);
    if (pendingNsfwChannel) {
        openChatTab(pendingNsfwChannel.id, pendingNsfwChannel.name);
        pendingNsfwChannel = null;
        if (currentTree.length > 0) {
            renderTree(currentTree);
        }
    }
});

// ── Delete Message Confirmation Modal (PRD 4.10) ────────────────────────────

function showDeleteMessageModal(msgId: string, isDm: boolean): void {
    pendingDeleteMessage = { msgId, isDm };
    deleteMessageModal.classList.add("visible");
}

btnDeleteMessageCancel.addEventListener("click", () => {
    deleteMessageModal.classList.remove("visible");
    pendingDeleteMessage = null;
});

deleteMessageModal.addEventListener("click", (e) => {
    if (e.target === deleteMessageModal) {
        deleteMessageModal.classList.remove("visible");
        pendingDeleteMessage = null;
    }
});

btnDeleteMessageConfirm.addEventListener("click", async () => {
    if (!pendingDeleteMessage) return;
    const { msgId, isDm } = pendingDeleteMessage;
    deleteMessageModal.classList.remove("visible");
    pendingDeleteMessage = null;

    const result = isDm ? await api.deleteDirectMessage(msgId) : await api.deleteMessage(msgId);
    if (!result.success) {
        log(`Failed to delete message: ${result.error ?? "Unknown error"}`, "error");
    }
    // No optimistic DOM removal here — MESSAGE_DELETED/DIRECT_MESSAGE_DELETED
    // is echoed back to the sender the same way MESSAGE_RECEIVED/
    // DIRECT_MESSAGE_RECEIVED already are, so removeMessageElement() below
    // handles it uniformly for every client including this one.
});

/** Removes a rendered message from every tab it might be showing in (a tab stays in the DOM, just hidden, when it isn't the active one). */
function removeMessageElement(msgId: string): void {
    // Snippets that point at it flip to "Original message was deleted", and a
    // reply draft answering it is cancelled (PRD 16.11).
    handleReplyOriginalDeleted(msgId);

    document.querySelectorAll(`.chat-msg[data-msg-id="${CSS.escape(msgId)}"]`).forEach((el) => {
        // Removing a group's head promotes the next line to head, and removing
        // a message between two same-author runs can merge them (PRD 16.6).
        let next = el.nextElementSibling;
        el.remove();
        while (next && !next.classList.contains("chat-msg")) next = next.nextElementSibling;
        regroupFrom(next);
    });
}

api.on("message-deleted", (payload: { channelId: string; messageId: string }) => {
    removeMessageElement(payload.messageId);
});

api.on("dm-deleted", (payload: { dmId: string }) => {
    removeMessageElement(payload.dmId);
});

// ── Event Listeners ───────────────────────────────────────────────────────

api.on("connected", (data: { serverId: string; instanceId: string; secure?: boolean; pinned?: boolean; hasAccess?: boolean; permissions?: string }) => {
    isConnected = true;
    setMyPermissions(data.permissions); // PRD 19 A8
    applyAccessState(data.hasAccess !== false); // PRD 18.18
    currentServerId = data.serverId;
    btnConnect.disabled = true;
    btnDisconnect.disabled = false;
    serverUrlInput.disabled = true;
    nicknameInput.disabled = true;
    serverPasswordInput.disabled = true;
    document.body.classList.add("is-connected");
    document.body.classList.remove("is-approving");
    connectedNickname = nicknameInput.value.trim() || "User";
    stopSavedServerProbes(); // PRD 20 W1
    onSavedServerConnected(); // PRD 19 C1
    showWelcomeForm(); // PRD 19 R1: the connect card's job is done
    renderServerPill(); // PRD 19 C2
    renderServerHeader(); // PRD 19 C3
    statusDot.classList.add("connected");
    statusText.textContent = `Connected as ${connectedNickname}`;
    statusText.classList.add("connected");
    statusInstance.textContent = `ID: ${data.instanceId}`;
    renderConnectionSecurity(); // PRD 18.3: lock icon / "not encrypted" warning
    refreshServerSummary(); // PRD 19 A1
    hideApprovalScreen(); // PRD 18.8: a waiting identity that was just let in
    clearInviteField(); // PRD 18.9: a code is single-purpose
    if (lastDisconnectAt !== null) {
        const secs = ((Date.now() - lastDisconnectAt) / 1000).toFixed(1);
        log(`Connected to server (reconnected after ${secs}s)`, "success");
        lastDisconnectAt = null;
    } else {
        log("Connected to server", "success");
    }
    SoundAlert.play("connected.mp3");

    refreshOnlineCount();
    updateDmRailState(); // PRD 19 C7
    void loadDmDirectory();

    // Check admin/emoji-management status on connect (not just when the
    // Settings modal opens) so openSettingsPanel() already knows the answer
    // and can render the right tabs on the very first paint — see
    // applySettingsTabVisibility().
    Promise.all([
        api.getRoles(data.serverId),
        api.getBannedUsers(),
        api.getPendingEmojis(),
    ]).then(([rolesRes, bannedRes, pendingEmojisRes]) => {
        isAdminUser = rolesRes.success;
        canBanUsers = bannedRes.success;
        canManageEmojis = pendingEmojisRes.success;
        settingsTabRoles.disabled = !(isAdminUser || canBanUsers);
        if (canBanUsers) void refreshPendingApprovals(); // PRD 18.8: the badge is right from the first paint
    });

    // Auto-open DM tabs for partners with unread messages (not while restricted — PRD 18.18)
    if (hasServerAccess) autoOpenUnreadDmTabs();

    // Load approved custom emojis for the picker's "+" tab
    api.getApprovedEmojis().then((res) => {
        if (res.success && res.emojis) {
            customEmojis = res.emojis;
            api.setCustomEmojis(customEmojis);
        }
    });

    // Load the server-wide Nudge / Screen Sharing toggles, the message
    // length cap, and the server's display name for the window title bar.
    api.getServerSettings().then((res) => {
        if (res.success && res.nudgeEnabled !== undefined) {
            serverNudgeEnabled = res.nudgeEnabled;
        }
        if (res.success && res.screenShareEnabled !== undefined) {
            serverScreenShareEnabled = res.screenShareEnabled;
            updateShareScreenButton();
        }
        if (res.success && res.name) {
            connectedServerName = res.name;
            updateWindowTitle();
        }
        if (res.success) void refreshSavedServerMeta(res.name, res.iconUrl); // PRD 19 C1
        if (res.success && res.maxMessageLength !== undefined) {
            serverMaxMessageLength = res.maxMessageLength;
            chatInput.maxLength = serverMaxMessageLength;
        }
        if (res.success && res.version) {
            checkVersionMismatch(res.version);
        }
    });
});

/** When the last unintended disconnect happened — lets the next "connected"
 *  log how long the outage lasted (PRD 15.2 diagnostics). */
let lastDisconnectAt: number | null = null;

api.on("disconnected", (data?: { reason?: string }) => {
    void stopStageWatch(); // PRD 19 C10
    const disconnectReason = data?.reason ?? "unknown";
    // "io client disconnect" = the user/app closed it on purpose; anything
    // else (ping timeout, transport close/error…) is an unintended drop.
    lastDisconnectAt = disconnectReason === "io client disconnect" ? null : Date.now();
    isConnected = false;
    isAdminUser = false;
    canManageEmojis = false;
    isInVoice = false;
    currentChannelId = null;
    currentServerId = "";
    currentTree = [];
    mutedChannelIds = new Set();
    mutedChannelsServerId = null;
    customEmojis = [];
    api.setCustomEmojis(customEmojis);
    previousOccupantIds = new Set();
    previousSharingIds = new Set();
    connectedServerName = null;
    connectedNickname = "";
    updateSettingsNavCount("roles", 0, false); // PRD 20 M4
    updateSettingsNavCount("emojis", 0);
    myPermissions = null; // PRD 19 A8: unknown again
    clearServerSummary(); // PRD 19 A1
    updateWindowTitle();
    activeSpeakers.clear();
    for (const timer of speakerHoldTimers.values()) clearTimeout(timer);
    speakerHoldTimers.clear();
    sessionTimers.clear();
    btnConnect.disabled = false;
    btnDisconnect.disabled = true;
    serverUrlInput.disabled = false;
    nicknameInput.disabled = false;
    serverPasswordInput.disabled = false;
    document.body.classList.remove("is-connected", "is-approving");
    onSavedServerDisconnected(); // PRD 19 C1
    startSavedServerProbes(); // PRD 20 W1: the welcome list shows latency again
    renderServerPill(); // PRD 19 C2
    renderServerHeader(); // PRD 19 C3
    renderConnectionSecurity(); // isConnected is false → hides the lock and the warning (PRD 18.3)
    hideApprovalScreen(); // PRD 18.8
    pendingApprovals = [];
    setPendingBadges(0);
    invites = [];
    invitesSection.style.display = "none";
    unreadDmCounts.clear(); // PRD 18.13
    statusDot.classList.remove("connected");
    statusText.textContent = "Disconnected";
    statusText.classList.remove("connected");
    statusLatency.textContent = "";
    statusLatency.className = "status-latency";
    resetDmSidebar(); // PRD 19 C7
    updateVoiceUI();
    channelTree.innerHTML = `
        <div style="padding: 20px 12px; color: var(--color-neutral-500); font-size: 12px; text-align: center;">
            Connect to a server to see channels
        </div>
    `;
    // Close all chat tabs (including DM tabs)
    // A kept tab stays remembered and comes back on the next connect (PRD 17.5).
    for (const [tabId] of chatTabs) {
        closeTab(tabId, { reason: "disconnect" });
    }
    previewTabId = null;
    keptTabsRestored = false;
    keptTabsServerId = null;
    hasServerAccess = true; // the next connect says otherwise if it must (PRD 18.18)
    document.body.classList.remove("no-access");
    switchTab("server-log");
    log(`Disconnected from server (${disconnectReason})`, "error");
    SoundAlert.play("disconnected.mp3");
});

// ── Voice Auto-Reconnect (PRD 11.1) ─────────────────────────────────────────
// Fired by preload's attemptVoiceRejoin(), which transparently replays the
// full voice-join handshake after a Socket.io reconnect or a WebRTC-level
// connection failure — neither the server nor mediasoup transports survive
// either event, so nothing here resumes a session, it re-joins one.

api.on("voice-connection-lost", () => {
    log("Voice connection lost — attempting to reconnect...", "error");
});

api.on("voice-reconnecting", (data: { channelId: string }) => {
    voicePanel.classList.add("reconnecting");
    if (isInVoice && currentChannelId === data.channelId) {
        renderVoiceDockSub();
    }
});

api.on("voice-reconnected", (data: { channelId: string }) => {
    voicePanel.classList.remove("reconnecting");
    renderVoiceDockSub();
    isInVoice = true;
    currentChannelId = data.channelId;

    const node = findChannelNodeById(currentTree, data.channelId);
    updateVoiceUI(node?.name);
    // Reapply local voice settings the same way a fresh manual join does —
    // a new VoiceService instance was constructed for the rejoin, so any
    // per-session state (global volume, mic volume, noise cancelling) needs
    // to be re-sent.
    api.setGlobalVoiceVolume(voiceVolume);
    api.setMicVolume(micVolume);
    api.setNoiseCancelEnabled(noiseCancelEnabled);
    api.setNoiseCancelStrength(noiseCancelStrength);
    if (selfHearEnabled) {
        applySelfHearMuteDeafenForcing();
        api.setSelfHearEnabled(true);
        updateSelfHearBanner();
    }
    api.setVoiceState(isMuted, isDeafened);
    previousOccupantIds = new Set((node?.occupants ?? []).map((o) => o.userId));
    previousSharingIds = sharingIdsOf(node?.occupants ?? []);

    log(`Reconnected to voice channel${node ? `: ${node.name}` : ""}`, "success");
    if (currentTree.length > 0) renderTree(currentTree);
});

api.on("voice-rejoin-failed", (data: { channelId: string; error?: string }) => {
    voicePanel.classList.remove("reconnecting");
    if (currentChannelId === data.channelId) {
        isInVoice = false;
        currentChannelId = null;
        previousOccupantIds = new Set();
        previousSharingIds = new Set();
        updateVoiceUI();
    }
    log(`Couldn't reconnect to voice: ${data.error ?? "unknown error"}. Please rejoin manually.`, "error");
    if (currentTree.length > 0) renderTree(currentTree);
});

api.on("voice-error", (data: { message: string }) => {
    log(`Voice: ${data.message}`, "error");
});

api.on("error", (data: { code?: string; message: string }) => {
    // Suppress permission-denied errors — they are already handled
    // gracefully by ack callbacks (e.g., disabling the Roles tab).
    if (data.code === "PERMISSION_DENIED") return;
    // The server wants (or didn't accept) an invite code (PRD 18.9): show the field.
    if (data.code === "INVITE_REQUIRED" || data.code === "INVITE_INVALID" || data.code === "INVITE_THROTTLED") {
        showWelcomeForm(); // the code field lives in the form (PRD 19 R1)
        revealInviteField(data.message, data.code !== "INVITE_REQUIRED");
        return;
    }
    if (connectFlow && connectFlow.state === "running" && !isConnected) {
        // A refused password asks for one instead of failing (frame 3b).
        if (data.code === "JOIN_FAILED" && /password/i.test(data.message)) {
            log(`Error: ${escapeHtml(data.message)}`, "error");
            askForServerPassword(connectFlowHadPassword);
            return;
        }
        // A first connect that can't reach the server stops instead of retrying behind the card.
        if (data.code === "CONNECT_ERROR") api.disconnect();
        log(`Error: ${escapeHtml(data.message)}`, "error");
        failConnectFlow(data.message);
        return;
    }
    log(`Error: ${data.message}`, "error");
});

api.on("user-kicked", (data: { channelId: string }) => {
    log("You were kicked from the voice channel", "error");
    SoundAlert.play("you_were_kicked_from_channel.mp3");
    suppressNextPresenceSound = true;
    // Leave voice state
    if (isInVoice && currentChannelId === data.channelId) {
        isInVoice = false;
        currentChannelId = null;
        previousOccupantIds = new Set();
        previousSharingIds = new Set();
        voiceChannelName.textContent = "";
        voicePanel.classList.remove("in-voice");
        updateVoiceUI(); // PRD 19 C9: closes the room tab
    }
});

api.on("channel-user-kicked", (data: { channelId: string; userId: string }) => {
    // Another user was kicked from the channel — play kick sound, suppress
    // the presence-based leave sound that will follow immediately.
    if (isInVoice && data.channelId === currentChannelId && data.userId !== api.getInstanceId()) {
        SoundAlert.play("user_kicked_from_channel.mp3");
        suppressNextPresenceSound = true;
    }
});

api.on("user-banned", () => {
    log("You have been banned from this server", "error");
    api.disconnect();
});

/**
 * Seeds the voice-room session timers from a tree (PRD 19 A3), so a client that
 * connects mid-session shows the running timer at once. A node's own value wins;
 * a voice node with no start time AND no occupants has no running session. A
 * node with occupants but no value (an older server's tree) is left alone —
 * the presence updates keep those timers.
 */
function seedSessionTimersFromTree(nodes: TreeNode[]): void {
    for (const node of nodes) {
        if (node.type === "VOICE") {
            if (node.sessionStartedAt) {
                sessionTimers.set(node.id, node.sessionStartedAt);
            } else if (node.occupants.length === 0) {
                sessionTimers.delete(node.id);
            }
        }
        if (node.children.length > 0) seedSessionTimersFromTree(node.children);
    }
}

api.on("channel-tree", (data: { serverId: string; tree: TreeNode[] }) => {
    ensureMutedChannelsLoaded(data.serverId);
    seedSessionTimersFromTree(data.tree); // PRD 19 A3 (before the render that shows the timers)
    queueMicrotask(updateShareScreenButton); // PRD 19 A4: after renderTree stores the new tree
    pruneMutedChannels(data.tree);
    renderTree(data.tree);
    syncOpenTabNames(data.tree);
    pruneClosedChannelTabs(data.tree); // PRD 17.5
    restoreKeptTabs(data.tree, data.serverId);
    // renderTree() can seed unread state from the tree (hasUnread) (PRD 17.6).
    for (const id of chatTabs.keys()) refreshTabUnread(id);
});

/** Keeps already-open chat tabs' displayed names in sync after a channel rename. */
function syncOpenTabNames(tree: TreeNode[]): void {
    if (chatTabs.size === 0) return;

    function walk(nodes: TreeNode[]): void {
        for (const node of nodes) {
            const tab = chatTabs.get(node.id);
            if (tab && tab.channelName !== node.name) {
                tab.channelName = node.name;
                // Only the label: the kept icon and unread dot stay (PRD 17.5).
                const label = tab.tabEl.querySelector(".tab-label");
                if (label) label.textContent = node.name;
                renderTabMode(tab);
            }
            if (node.children.length > 0) walk(node.children);
        }
    }
    walk(tree);
}

api.on("presence", (data: { channelId: string; occupants: any[]; sessionStartedAt?: string }) => {
    // Track voice session timers
    if (data.sessionStartedAt && data.occupants.length > 0) {
        sessionTimers.set(data.channelId, data.sessionStartedAt);
    } else {
        sessionTimers.delete(data.channelId);
    }

    // Update occupants in the current tree
    updateOccupants(data.channelId, data.occupants);
    // A delete dialog that is open for this channel shows the new head count (PRD 19 B7).
    if (pendingDeleteChannelId === data.channelId) refreshDeleteModalAffected();
    if (deleteCategoryId) refreshDeleteCategory(); // PRD 19 C6: the voice line stays live

    // Detect user join/leave in YOUR current voice channel
    if (isInVoice && data.channelId === currentChannelId) {
        const myId = api.getInstanceId();
        const newIds = new Set(data.occupants.map((o: any) => o.userId));
        const newSharingIds = sharingIdsOf(data.occupants);

        // Skip sounds if a kick just occurred (avoids double sound)
        if (suppressNextPresenceSound) {
            suppressNextPresenceSound = false;
            previousOccupantIds = newIds;
            previousSharingIds = newSharingIds;
            return;
        }

        // Detect users who joined (in new but not in previous, excluding self)
        for (const uid of newIds) {
            if (!previousOccupantIds.has(uid) && uid !== myId) {
                SoundAlert.play("user_joined_channel.mp3");
                break; // one sound per event
            }
        }
        // Detect users who left (in previous but not in new, excluding self)
        for (const uid of previousOccupantIds) {
            if (!newIds.has(uid) && uid !== myId) {
                SoundAlert.play("user_disconnected_from_channel.mp3");
                break;
            }
        }
        // Detect screen-share start/stop among other occupants (PRD 13.16)
        for (const uid of newSharingIds) {
            if (!previousSharingIds.has(uid) && uid !== myId) {
                SoundAlert.play("user_started_sharing.mp3");
                break;
            }
        }
        for (const uid of previousSharingIds) {
            if (!newSharingIds.has(uid) && uid !== myId) {
                SoundAlert.play("user_stopped_sharing.mp3");
                break;
            }
        }
        previousOccupantIds = newIds;
        previousSharingIds = newSharingIds;
    }
});

api.on("user-joined", (data: { userId: string; nickname: string }) => {
    log(`${data.nickname} joined the server`, "info");
    refreshOnlineCount();
    onDmPresenceChange(data.userId, true); // PRD 19 C7
    refreshServerSummary(); // PRD 19 A1
    if (data.userId === profileUserId && profileIsOnline !== null) setProfilePresence(true); // PRD 17.3
    if (membersPanelActive()) void refreshMembersPanel(); // PRD 20 M1: live online dots
});

api.on("user-left", (data: { userId: string }) => {
    log(`A user left the server`, "info");
    refreshOnlineCount();
    onDmPresenceChange(data.userId, false); // PRD 19 C7
    refreshServerSummary(); // PRD 19 A1
    if (data.userId === profileUserId && profileIsOnline !== null) setProfilePresence(false); // PRD 17.3
    if (membersPanelActive()) void refreshMembersPanel(); // PRD 20 M1: live online dots
});

// ── Active Speaker Indicator ──────────────────────────────────────────────

api.on("active-speakers", (data: { channelId: string; speakers: string[] }) => {
    // The local user's own halo is now driven directly by the mic-level
    // meter's analyser tap (PRD 14.11), not this server broadcast — skip
    // it here entirely so the two paths never fight over the same DOM
    // element (an instant local update vs. a 100ms-delayed server one).
    const myId = api.getInstanceId();
    const newSpeakers = new Set(data.speakers);

    // Users who stopped speaking: start hold timer
    for (const userId of activeSpeakers) {
        if (userId === myId) continue;
        if (!newSpeakers.has(userId)) {
            // Only start a hold timer if there isn't one already
            if (!speakerHoldTimers.has(userId)) {
                const timer = setTimeout(() => {
                    activeSpeakers.delete(userId);
                    speakerHoldTimers.delete(userId);
                    // Remove .speaking class from DOM
                    speakingEls(userId).forEach((el) => el.classList.remove("speaking"));
                }, 300);
                speakerHoldTimers.set(userId, timer);
            }
        }
    }

    // Users who are speaking: add immediately (cancel any pending removal)
    for (const userId of newSpeakers) {
        if (userId === myId) continue;
        const existingTimer = speakerHoldTimers.get(userId);
        if (existingTimer) {
            clearTimeout(existingTimer);
            speakerHoldTimers.delete(userId);
        }
        activeSpeakers.add(userId);
        // Add .speaking class to DOM
        speakingEls(userId).forEach((el) => el.classList.add("speaking"));
    }
});

api.on("channel-deleted", (data: { channelId: string }) => {
    sessionTimers.delete(data.channelId);
    // Its tab (preview or kept) goes too, and a kept one is forgotten (PRD 17.5).
    closeTab(data.channelId, { reason: "deleted" });
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

// ── Voice Session Timer — tick every second ──────────────────────────────

setInterval(() => {
    const now = correctedNow();
    for (const [chId, startedAt] of sessionTimers) {
        const treeEl = document.querySelector(
            `[data-session-channel="${chId}"]`,
        ) as HTMLSpanElement | null;
        if (treeEl) {
            treeEl.textContent = formatDuration(now - new Date(startedAt).getTime());
        }
    }
}, 1000);

// ── Latency Display — poll every 3 seconds ───────────────────────────────

setInterval(() => {
    if (!isConnected) return;
    const raw = api.getLatency();
    const ms = typeof raw === "number" && !isNaN(raw) ? raw : -1;
    if (ms < 0) {
        statusLatency.textContent = "";
        voiceDockLatency.textContent = "";
        return;
    }
    statusLatency.textContent = `${ms}ms`;
    statusLatency.className = "status-latency " + (ms <= 80 ? "good" : ms <= 150 ? "warn" : "bad");
    voiceDockLatency.textContent = isInVoice ? ` · ${ms}ms` : "";
    if (isInVoice) renderVoiceDockSub(); // picks up a renamed room or category within 3 s
}, 3000);

// ── Tree Update Helpers ───────────────────────────────────────────────────

function updateOccupants(channelId: string, occupants: any[]): void {
    // Walk the tree and update occupants for the matching channel
    function walk(nodes: TreeNode[]): boolean {
        for (const node of nodes) {
            if (node.id === channelId) {
                node.occupants = occupants.map((o) => ({
                    userId: o.userId,
                    nickname: o.nickname,
                    isMuted: o.isMuted,
                    isDeafened: o.isDeafened,
                    isSharingScreen: o.isSharingScreen,
                }));
                return true;
            }
            if (walk(node.children)) return true;
        }
        return false;
    }

    if (walk(currentTree)) {
        renderTree(currentTree);
        updateShareScreenButton(); // PRD 19 A4: the room's free stream slots changed
        if (channelId === currentChannelId) renderVoiceRoom(); // PRD 19 C9: keyed add/remove of tiles
    }
}

// ── Utilities ─────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Renders a single emoji token as HTML. A `:name:` token that matches a
 * known approved custom emoji becomes an inline <img>; anything else
 * (a literal Unicode emoji, or an unrecognized :name:) is escaped as plain
 * text — matching how Discord/Slack leave unknown shortcodes literal.
 * Shared between message-content rendering and reaction-pill rendering so
 * both recognize custom emoji the same way.
 */
function renderEmojiToken(token: string): string {
    if (token.length > 2 && token.startsWith(":") && token.endsWith(":")) {
        const name = token.slice(1, -1);
        const custom = customEmojis.find((e) => e.name === name);
        if (custom) {
            return `<img src="${escapeHtml(custom.imageUrl)}" alt="${escapeHtml(token)}" title="${escapeHtml(token)}" class="custom-emoji-inline">`;
        }
    }
    return escapeHtml(token);
}

// Extended_Pictographic covers most emoji; Regional_Indicator is needed
// separately for flags (a pair of regional-indicator codepoints, e.g. 🇧🇷 —
// not itself classified as Extended_Pictographic).
const EMOJI_TEST_REGEX = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const graphemeSegmenter = typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/**
 * True when a message consists of nothing but a single emoji — either one
 * Unicode emoji grapheme cluster (correctly counting multi-codepoint
 * sequences like flags, skin-tone modifiers, or ZWJ combos as *one*
 * character) or one recognized `:custom_name:` token — with no other
 * text. Used to render such messages at ~4x size (PRD 13.14).
 */
function isSoloEmojiMessage(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;

    const customMatch = trimmed.match(/^:([a-zA-Z0-9_]{2,32}):$/);
    if (customMatch) {
        return customEmojis.some((e) => e.name === customMatch[1]);
    }

    if (!EMOJI_TEST_REGEX.test(trimmed)) return false;
    return graphemeSegmenter
        ? [...graphemeSegmenter.segment(trimmed)].length === 1
        : [...trimmed].length === 1;
}

// ── Message body rendering (PRD 15.10) ──────────────────────────────────

const MSG_ALLOWED_TAGS = new Set([
    "P", "BR", "STRONG", "EM", "U", "S", "DEL", "BLOCKQUOTE", "UL", "OL", "LI",
    "H1", "H2", "H3", "PRE", "CODE", "A", "IMG",
]);
const HTTP_URL = /^https?:\/\//i;

/**
 * Defense in depth for rendered Markdown. The renderer in the preload
 * (`markdown.ts`) already refuses raw HTML and unsafe link schemes; this
 * allow-list pass re-checks its output before it is assigned to `innerHTML`:
 * only known tags survive (anything else collapses to its plain text), links
 * keep only an http(s) `href`, `<img>` is allowed solely for the inline
 * custom-emoji class, and every other attribute — including all event
 * handlers — is dropped. A DOMParser document is inert: nothing in it runs
 * or loads while it is being walked.
 */
function sanitizeMessageHtml(html: string): string {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

    const walk = (parent: Node): void => {
        for (const node of Array.from(parent.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) continue;
            if (node.nodeType !== Node.ELEMENT_NODE) {
                node.parentNode?.removeChild(node);
                continue;
            }
            const el = node as Element;

            if (!MSG_ALLOWED_TAGS.has(el.tagName)) {
                el.replaceWith(document.createTextNode(el.textContent ?? ""));
                continue;
            }

            for (const attr of Array.from(el.attributes)) {
                const keep =
                    (el.tagName === "A" &&
                        ((attr.name === "href" && HTTP_URL.test(attr.value)) ||
                            (attr.name === "target" && attr.value === "_blank") ||
                            attr.name === "rel" ||
                            (attr.name === "class" && attr.value === "msg-link"))) ||
                    (el.tagName === "IMG" &&
                        ((attr.name === "src" && HTTP_URL.test(attr.value)) ||
                            attr.name === "alt" ||
                            attr.name === "title" ||
                            (attr.name === "class" && attr.value === "custom-emoji-inline")));
                if (!keep) el.removeAttribute(attr.name);
            }

            if (el.tagName === "A" && !el.hasAttribute("href")) {
                el.replaceWith(document.createTextNode(el.textContent ?? ""));
                continue;
            }
            if (el.tagName === "IMG" && (!el.classList.contains("custom-emoji-inline") || !el.getAttribute("src"))) {
                el.replaceWith(document.createTextNode(el.getAttribute("alt") ?? ""));
                continue;
            }

            walk(el);
        }
    };
    walk(doc.body);
    return doc.body.innerHTML;
}

/**
 * Renders a message's text into its `.msg-text` element — the single place
 * channel messages, DMs, edits and edit broadcasts all go through, so their
 * formatting can't drift apart. A lone emoji keeps its 4x solo rendering and
 * bypasses Markdown; a single plain line stays inline (the layout every
 * message had before Markdown); anything with a line break or block syntax
 * becomes a block starting under the `[time] nick` header.
 */
function setMessageBody(textEl: HTMLElement, content: string): void {
    const solo = isSoloEmojiMessage(content);
    textEl.classList.toggle("msg-text-solo-emoji", solo);
    if (solo) {
        textEl.classList.remove("msg-text-block");
        textEl.innerHTML = linkifyContent(content);
        return;
    }
    const rendered = api.renderMarkdown(content);
    textEl.innerHTML = sanitizeMessageHtml(rendered.html);
    textEl.classList.toggle("msg-text-block", rendered.block);
}

/** Build HTML for message text with clickable URL links and inline custom
 * emoji. Operates on raw (unescaped) text so the regexes work correctly,
 * then escapes/transforms each segment independently. */
function linkifyContent(text: string): string {
    const combinedRegex = /(https?:\/\/[^\s<>"'`,;)\]]+)|(:[a-zA-Z0-9_]{2,32}:)/g;
    let lastIndex = 0;
    let result = "";
    let match;

    while ((match = combinedRegex.exec(text)) !== null) {
        // Escape text before this match
        result += escapeHtml(text.slice(lastIndex, match.index));

        if (match[1]) {
            // URL
            const url = match[1];
            result += `<a href="${escapeHtml(url)}" target="_blank" class="msg-link">${escapeHtml(url)}</a>`;
        } else {
            // :name: token — renders as an <img> if it's a known custom emoji
            result += renderEmojiToken(match[2]);
        }

        lastIndex = match.index + match[0].length;
    }

    // Escape remaining text after the last match
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

const EYE_ICON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

/**
 * Wraps a card's media so it can be blurred (PRD 18.11). The wrap and its
 * overlay are ALWAYS rendered; whether the blur is active is decided purely by
 * CSS classes (`.tab-nsfw` on the tab, `.lpc-adult` on the card, and the two
 * `body.lp-*-blur-off` preferences), so toggling a switch or a channel's NSFW
 * flag updates cards already on screen. Deliberately NOT the attachment
 * classes: `body.nsfw-blur-off` (the attachments switch) must not un-blur these.
 */
function wrapPreviewMedia(card: HTMLElement, media: HTMLElement, adult: boolean): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.className = "lpc-blur-wrap";
    wrap.appendChild(media);

    const overlay = document.createElement("div");
    overlay.className = "lpc-blur-overlay";
    overlay.innerHTML = EYE_ICON_SVG;
    const label = document.createElement("span");
    label.className = "lpc-blur-label-nsfw";
    label.textContent = "NSFW channel — click to reveal";
    const labelAdult = document.createElement("span");
    labelAdult.className = "lpc-blur-label-adult";
    labelAdult.textContent = "Marked as adult content by the site — click to reveal";
    overlay.append(label, labelAdult);
    // Reveal is per card, inline; it must not open the link.
    overlay.addEventListener("click", (e) => {
        e.stopPropagation();
        wrap.classList.add("revealed");
    });
    wrap.appendChild(overlay);

    if (adult) card.classList.add("lpc-adult");
    card.appendChild(wrap);
    return wrap;
}

/**
 * Gives a card's media its final box as soon as the card is inserted, when the
 * page declared the media's size (PRD 18.12) — the card then doesn't grow once
 * the image/video loads. The existing `max-height: 300px; object-fit: cover`
 * still caps it, so the look is unchanged.
 */
function reserveMediaBox(el: HTMLElement, data: LinkPreviewData): void {
    if (data.mediaWidth && data.mediaHeight) {
        el.style.aspectRatio = `${data.mediaWidth} / ${data.mediaHeight}`;
        el.style.width = "100%";
    }
}

function createPreviewCard(data: LinkPreviewData): HTMLDivElement {
    const card = document.createElement("div");
    card.className = "link-preview-card";

    // The link IS an image (PRD 18.10): just the picture, opened in the
    // zoom-only viewer (never the "sent by" viewer — it isn't a message image).
    if (data.kind === "image" && data.image) {
        card.classList.add("lpc-direct");
        const img = document.createElement("img");
        img.className = "lpc-image lpc-direct-image";
        img.src = data.image;
        img.alt = data.domain || "Image";
        img.loading = "lazy";
        img.addEventListener("click", (e) => {
            e.stopPropagation();
            openLightbox(data.image!, { previewOnly: true });
        });
        img.addEventListener("error", () => card.remove());
        wrapPreviewMedia(card, img, !!data.adult);
        if (data.domain) {
            const domainEl = document.createElement("div");
            domainEl.className = "lpc-domain";
            domainEl.textContent = data.domain;
            card.appendChild(domainEl);
        }
        if (data.url) card.addEventListener("click", () => window.open(data.url!, "_blank"));
        return card;
    }

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
        reserveMediaBox(videoEl, data);
        videoEl.addEventListener("click", (e) => e.stopPropagation());
        wrapPreviewMedia(card, videoEl, !!data.adult);
    } else if (isEmbedVideo && data.image) {
        // Embed video (YouTube, etc.) — show image with play overlay
        const mediaWrap = document.createElement("div");
        mediaWrap.className = "lpc-media-wrap";

        const img = document.createElement("img");
        img.className = "lpc-image";
        img.src = data.image;
        img.alt = data.title || "Preview";
        img.loading = "lazy";
        reserveMediaBox(mediaWrap, data);
        img.addEventListener("error", () => { mediaWrap.style.display = "none"; });
        mediaWrap.appendChild(img);

        // Play button overlay
        const playBtn = document.createElement("div");
        playBtn.className = "lpc-play-overlay";
        playBtn.innerHTML = `<svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="24" style="fill: color-mix(in srgb, var(--color-black) 60%, transparent)"/><polygon points="18,14 36,24 18,34" fill="white"/></svg>`;
        mediaWrap.appendChild(playBtn);

        mediaWrap.addEventListener("click", (e) => {
            e.stopPropagation();
            // Open in external browser — iframe embeds don't work in Electron (file:// origin)
            window.open(data.url!, "_blank");
        });

        wrapPreviewMedia(card, mediaWrap, !!data.adult);
    } else if (data.image) {
        // Static image — full width
        const img = document.createElement("img");
        img.className = "lpc-image";
        img.src = data.image;
        img.alt = data.title || "Preview";
        img.loading = "lazy";
        reserveMediaBox(img, data);
        // The picture opens the limited, zoom-only viewer (PRD 18.19) and does NOT
        // open the link; the card's text and domain still do. The embed-video
        // thumbnail (above) keeps opening the link: it stands for a video.
        img.style.cursor = "zoom-in";
        img.addEventListener("click", (e) => {
            e.stopPropagation();
            openLightbox(data.image!, { previewOnly: true });
        });
        const staticWrap = wrapPreviewMedia(card, img, !!data.adult);
        img.addEventListener("error", () => { staticWrap.style.display = "none"; });
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

/**
 * `onLoaded` lets the caller decide whether a preview card finishing async
 * load should stick the view to the bottom (PRD 14.1/14.2) — appending a
 * new message the user was already at the bottom for, vs. revealing a
 * historical message above the fold while prepending older pages, need
 * opposite answers, so this can no longer hardcode "always scroll down."
 */
function injectLinkPreview(messageEl: HTMLElement, url: string, onLoaded?: () => void): void {
    // Turned off by the user: not even a request (PRD 18.10).
    if (!isLinkPreviewsEnabled()) return;
    // Check renderer-side cache first
    const cached = linkPreviewCache.get(url);
    if (cached !== undefined) {
        if (cached) {
            messageEl.appendChild(createPreviewCard(cached));
            onLoaded?.();
        }
        return;
    }

    // Fetch asynchronously — don't block message rendering
    api.fetchLinkPreview(url).then((data) => {
        cacheLinkPreview(url, data);
        if (!data) return;
        // Guard: ensure the message is still in the DOM (tab may have been closed)
        if (!messageEl.isConnected) return;
        messageEl.appendChild(createPreviewCard(data));
        onLoaded?.();
    }).catch(() => {
        cacheLinkPreview(url, null);
    });
}

// ── Admin Panel (renderAdminUsers only — open/close handled by openSettingsPanel) ──

// ── Members page (PRD 20 M1) ─────────────────────────────────────────────────

const ROLE_MEMBER_ID = "role-default"; // prisma/seed.ts
const ROLE_ADMIN_ID = "role-admin"; // prisma/seed.ts
const PERM_CONNECT = 1n << 0n;
const PERM_ADMIN = 1n << 8n;

type MembersFilter = "all" | "admins" | "nokey" | "noaccess";
let membersCache: any[] = [];
let membersOnline = new Set<string>();
let membersFilter: MembersFilter = "all";
const membersSearch = document.getElementById("members-search") as HTMLInputElement;

/** The Members page is the visible settings page. */
function membersPanelActive(): boolean {
    return (
        adminModal.classList.contains("visible") &&
        !!document.querySelector('.settings-panel[data-settings-panel="roles"].active')
    );
}

/** The OR of a user's role permissions on this server (strings from the server). */
function memberPerms(user: any): bigint {
    let p = 0n;
    for (const r of user.roles ?? []) {
        try {
            p |= BigInt(r.permissions);
        } catch {
            /* malformed: ignore */
        }
    }
    return p;
}

function memberIsAdmin(user: any): boolean {
    return (memberPerms(user) & PERM_ADMIN) !== 0n;
}

function memberHasAccess(user: any): boolean {
    const p = memberPerms(user);
    return (p & PERM_CONNECT) !== 0n || (p & PERM_ADMIN) !== 0n;
}

function memberHasRole(user: any, roleId: string): boolean {
    return (user.roles ?? []).some((r: any) => r.id === roleId);
}

/** The voice channel a user is in right now, from the live tree. */
function memberVoiceRoom(userId: string): string | null {
    let found: string | null = null;
    const walk = (nodes: TreeNode[]): void => {
        for (const n of nodes) {
            if (found) return;
            if (n.type === "VOICE" && n.occupants.some((o) => o.userId === userId)) found = n.name;
            walk(n.children);
        }
    };
    walk(currentTree);
    return found;
}

function memberMatchesFilter(user: any, filter: MembersFilter): boolean {
    if (filter === "admins") return memberIsAdmin(user);
    if (filter === "nokey") return user.hasIdentityKey !== true;
    if (filter === "noaccess") return !memberHasAccess(user);
    return true;
}

/** Fetches the list and who is online, then draws (PRD 20 M1). */
async function refreshMembersPanel(): Promise<void> {
    if (!isConnected) return;
    const [usersRes, onlineRes] = await Promise.all([api.getAllUsers(currentServerId), api.getOnlineUsers()]);
    if (!usersRes.success) {
        adminUserList.innerHTML = '<div class="admin-empty">You don\'t have permission to manage users.</div>';
        return;
    }
    if (onlineRes.success && onlineRes.users) membersOnline = new Set(onlineRes.users.filter((u) => u.isOnline).map((u) => u.userId));
    renderAdminUsers(usersRes.users ?? []);
}

function renderAdminUsers(users: any[]): void {
    membersCache = users;
    const myId = api.getInstanceId();
    const iAmAdmin = memberIsAdmin(users.find((u) => u.id === myId) ?? {});

    // The identity log is ADMIN-only on the server too (PRD 18.4); its nav item follows.
    identityLogAllowed = iAmAdmin;
    const logTab = document.getElementById("settings-tab-identitylog");
    if (logTab) logTab.style.display = iAmAdmin ? "" : "none";

    // Filter counts always describe the whole list.
    const counts: Record<MembersFilter, number> = {
        all: users.length,
        admins: users.filter((u) => memberIsAdmin(u)).length,
        nokey: users.filter((u) => u.hasIdentityKey !== true).length,
        noaccess: users.filter((u) => !memberHasAccess(u)).length,
    };
    document.querySelectorAll<HTMLButtonElement>("#members-filters .seg-opt").forEach((b) => {
        const f = b.dataset.filter as MembersFilter;
        (b.querySelector(".seg-count") as HTMLElement).textContent = String(counts[f]);
        b.classList.toggle("active", f === membersFilter);
        b.setAttribute("aria-checked", String(f === membersFilter));
    });
    updateSettingsNavCount("roles", users.length); // M4

    const q = membersSearch.value.trim().toLowerCase();
    const rows = users.filter(
        (u) => memberMatchesFilter(u, membersFilter) && (!q || String(u.nickname).toLowerCase().includes(q) || String(u.id).toLowerCase().includes(q)),
    );

    adminUserList.textContent = "";
    if (rows.length === 0) {
        const empty = document.createElement("div");
        empty.className = "admin-empty";
        empty.textContent = users.length === 0 ? "No users found." : q ? `No members match "${membersSearch.value.trim()}".` : "Nobody matches this filter.";
        adminUserList.appendChild(empty);
        return;
    }
    const adminCount = counts.admins;
    for (const user of rows) adminUserList.appendChild(buildMemberRow(user, { myId, iAmAdmin, adminCount }));
}

function buildMemberRow(user: any, ctx: { myId: string; iAmAdmin: boolean; adminCount: number }): HTMLElement {
    const you = user.id === ctx.myId;
    const access = memberHasAccess(user);
    const row = document.createElement("div");
    row.className = "member-row" + (access ? "" : " no-access");

    // Avatar with the online dot
    const avWrap = document.createElement("span");
    avWrap.className = "member-avatar";
    avWrap.appendChild(createAvatarElement(user.id, user.nickname, 32));
    const online = membersOnline.has(user.id) || you;
    const dot = document.createElement("span");
    dot.className = "member-dot" + (online ? " online" : "");
    avWrap.appendChild(dot);
    row.appendChild(avWrap);

    // Name line
    const main = document.createElement("div");
    main.className = "member-main";
    const name = document.createElement("div");
    name.className = "member-name";
    name.append(document.createTextNode(user.nickname));
    if (!access) name.append(memberTag("NO ACCESS", "no-access", "Their roles don't include Member (or Admin): they can't use channels, DMs or voice"));
    if (user.isBanned) name.append(memberTag("BANNED", "banned", "Banned from this server"));
    if (you) {
        const y = document.createElement("span");
        y.className = "member-you";
        y.textContent = "(you)";
        name.append(y);
    }
    if (user.hasIdentityKey) {
        const lock = document.createElement("i");
        lock.className = "ph-fill ph-lock-simple member-lock";
        lock.title = "Signed identity — key bound";
        name.append(lock);
    }

    // Second line: short id · status
    const sub = document.createElement("div");
    sub.className = "member-sub";
    const room = memberVoiceRoom(user.id);
    let status: string;
    if (you) status = room ? `Online · ${room}` : "Online · this device";
    else if (online) status = room ? `Online · ${room}` : "Online";
    else if (user.lastSeenAt) status = `Last seen ${relativeTime(Date.parse(user.lastSeenAt))}`; // D5 (a)
    else status = "Offline";
    sub.textContent = String(user.id).slice(0, 13);
    const st = document.createElement("span");
    st.textContent = ` · ${status}`;
    sub.appendChild(st);
    sub.title = user.id;
    main.append(name, sub);
    row.appendChild(main);

    // Member / Admin pills
    const pills = document.createElement("div");
    pills.className = "member-pills";
    const lastAdmin = memberIsAdmin(user) && ctx.adminCount <= 1;
    const memberPill = buildRolePill(user, ROLE_MEMBER_ID, "Member", false, you ? "You can't remove your own membership" : null);
    const adminPill = buildRolePill(
        user,
        ROLE_ADMIN_ID,
        "Admin",
        true,
        you ? "You can't remove your own admin role" : lastAdmin ? "The server needs at least one admin" : null,
    );
    if (memberPill) pills.appendChild(memberPill);
    if (adminPill) pills.appendChild(adminPill);
    row.appendChild(pills);

    // ⋮ menu
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "btn btn-icon btn-ghost member-menu-btn";
    menuBtn.title = "Actions";
    menuBtn.setAttribute("aria-label", `Actions for ${user.nickname}`);
    menuBtn.setAttribute("aria-haspopup", "menu");
    menuBtn.innerHTML = '<i class="ph ph-dots-three-vertical" aria-hidden="true"></i>';
    menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const r = menuBtn.getBoundingClientRect();
        openMemberMenu(user, ctx, r.right - 220, r.bottom + 4, menuBtn);
    });
    row.appendChild(menuBtn);
    return row;
}

function memberTag(text: string, kind: string, title: string): HTMLElement {
    const t = document.createElement("span");
    t.className = `member-tag ${kind}`;
    t.textContent = text;
    t.title = title;
    return t;
}

/** One Member/Admin pill; null when the server has no such role. `blockRemoveWhy` stops a removal (not a grant). */
function buildRolePill(user: any, roleId: string, label: string, isAdminPill: boolean, blockRemoveWhy: string | null): HTMLButtonElement | null {
    if (!allServerRoles.some((r) => r.id === roleId)) return null;
    const on = memberHasRole(user, roleId);
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "member-pill" + (isAdminPill ? " admin" : "") + (on ? " on" : "");
    const icon = isAdminPill ? (on ? "ph-shield-star" : "ph-shield") : on ? "ph-user" : "ph-user-minus";
    pill.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i>`;
    pill.append(document.createTextNode(label));
    if (!isAdminUser) {
        pill.classList.add("readonly");
        pill.title = on ? `Has ${label}` : `No ${label} role`;
        pill.tabIndex = -1;
        return pill;
    }
    if (on && blockRemoveWhy) {
        pill.disabled = true;
        pill.title = blockRemoveWhy;
        return pill;
    }
    pill.title = on ? `Click to remove ${label}` : `Click to grant ${label}`;
    pill.addEventListener("click", async () => {
        pill.disabled = true;
        const res = await api.assignRole(user.id, roleId, on ? "remove" : "add");
        if (!res.success) {
            log(`Failed to ${on ? "remove" : "add"} ${label}: ${res.error}`, "error");
            if (res.error && /permission|denied/i.test(res.error)) SoundAlert.play("insufficient_perms.mp3");
        }
        await refreshMembersPanel();
    });
    return pill;
}

function openMemberMenu(user: any, ctx: { myId: string; iAmAdmin: boolean }, x: number, y: number, anchor: HTMLElement): void {
    const you = user.id === ctx.myId;
    const items: MenuItem[] = [];
    if (ctx.iAmAdmin && user.hasIdentityKey && !you) {
        items.push({
            label: "Reset key…",
            icon: "ph-key",
            onClick: () =>
                // A second menu at the same spot is the confirmation (it disconnects them).
                openMenu(
                    [
                        {
                            label: `Reset ${user.nickname}'s key — disconnects them`,
                            icon: "ph-key",
                            danger: true,
                            onClick: async () => {
                                const res = await api.resetIdentityKey(user.id);
                                if (res.success) log(`Identity key of ${escapeHtml(user.nickname)} reset — their next connection binds a new key`, "success");
                                else log(`Failed to reset identity key: ${escapeHtml(res.error ?? "unknown error")}`, "error");
                                await refreshMembersPanel();
                            },
                        },
                    ],
                    x,
                    y,
                    { anchor },
                ),
        });
    }
    if (ctx.iAmAdmin) {
        items.push({ label: "View identity log", icon: "ph-fingerprint", onClick: () => showIdentityLog({ id: user.id, nickname: user.nickname }) });
    }
    const others = isAdminUser ? allServerRoles.filter((r) => r.id !== ROLE_MEMBER_ID && r.id !== ROLE_ADMIN_ID) : [];
    if (others.length > 0) {
        items.push({ divider: true }, { heading: "Other roles" });
        for (const role of others) {
            const has = memberHasRole(user, role.id);
            items.push({
                label: role.name,
                checked: has,
                onClick: async () => {
                    const res = await api.assignRole(user.id, role.id, has ? "remove" : "add");
                    if (!res.success) log(`Failed to change role: ${res.error}`, "error");
                    await refreshMembersPanel();
                },
            });
        }
    }
    if (canBanUsers && !you) {
        items.push({ divider: true });
        if (user.isBanned) {
            items.push({
                label: "Unban",
                icon: "ph-arrow-counter-clockwise",
                onClick: async () => {
                    const res = await api.unbanUser(user.id);
                    if (res.success) {
                        log(`Unbanned ${escapeHtml(user.nickname)}`, "success");
                        SoundAlert.play("user_unbanned_from_server.mp3");
                    } else {
                        log(`Failed to unban: ${res.error}`, "error");
                        if (res.error && /permission|denied/i.test(res.error)) SoundAlert.play("insufficient_perms.mp3");
                    }
                    await refreshMembersPanel();
                },
            });
        } else {
            items.push({ label: "Ban…", icon: "ph-prohibit", danger: true, onClick: () => openBanDialog({ id: user.id, nickname: user.nickname }) });
        }
    }
    if (items.length === 0) items.push({ label: "No actions available", disabled: true, onClick: () => {} });
    openMenu(items, x, y, { anchor });
}

membersSearch.addEventListener("input", () => renderAdminUsers(membersCache));
document.querySelectorAll<HTMLButtonElement>("#members-filters .seg-opt").forEach((b) => {
    b.addEventListener("click", () => {
        membersFilter = (b.dataset.filter as MembersFilter) ?? "all";
        renderAdminUsers(membersCache);
    });
});

// ── Tab Management ────────────────────────────────────────────────────────

function switchTab(tabId: string): void {
    activeTabId = tabId;
    scheduleDmSidebarRender(); // PRD 19 C7: the open conversation is excluded from the rail total

    // Close emoji picker on tab switch
    closeEmojiPicker();
    closeEmojiAutocomplete();

    // Deactivate all tabs and content
    tabBar.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tabContentArea.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));

    // Activate selected tab
    const tabEl = tabBar.querySelector(`.tab[data-tab-id="${tabId}"]`);
    const contentEl = tabContentArea.querySelector(`.tab-content[data-tab-id="${tabId}"]`);
    tabEl?.classList.add("active");
    contentEl?.classList.add("active");
    scheduleTabOverflow(); // PRD 19 C8: the active tab must stay visible

    // The composer says where the message goes (PRD 19 R2, frame 1a).
    const placeholderTab = chatTabs.get(tabId);
    if (placeholderTab) {
        chatInput.placeholder =
            placeholderTab.kind === "dm" ? `Message @${placeholderTab.channelName}` : `Message #${placeholderTab.channelName}`;
    }

    // Show/hide the composer (attachment tray + input bar)
    if (tabId === "server-log" || tabId === VOICE_TAB_ID) {
        chatComposer.classList.remove("visible");
    } else {
        chatComposer.classList.add("visible");
        chatInput.focus();
    }

    // A chat tab always opens/refocuses scrolled to the latest message
    // (PRD 14.1) — never resume whatever scroll position was left over
    // from a prior visit. Guarded on `initialLoadDone` so a brand-new tab
    // (still mid-fetch, empty container) isn't force-scrolled prematurely —
    // its own render loop already lands on the bottom once messages arrive.
    const tab = chatTabs.get(tabId);
    if (tab?.initialLoadDone) {
        stickToBottom(tab);
    }
    // Opening a channel (tree or tab) reads it when it is really being looked
    // at — the same rule as DMs (PRD 19 B3). A tab still loading is read when
    // its history has rendered (loadChatHistory).
    if (tab?.kind === "channel") markChannelTabRead(tab);
    // Looking at a DM tab (in a focused window) reads it (PRD 18.13).
    if (tab?.kind === "dm") {
        markDmTabRead(tab);
        refreshTabUnread(tabId);
    }
    // A kept tab restored at connect loads its history on first view (PRD 17.5).
    if (tab && !tab.loaded) loadChatHistory(tab);

    // Messages that arrived while this tab was hidden couldn't be measured
    // for "See more" — do it now that it's visible (PRD 17.7).
    contentEl?.querySelectorAll<HTMLDivElement>(".chat-msg[data-truncation-pending]").forEach((msgEl) => {
        const textEl = msgEl.querySelector<HTMLElement>(".msg-text");
        if (textEl) attachMessageTruncation(msgEl, textEl);
        else delete msgEl.dataset.truncationPending;
    });

    updateViewingIndicator();
    renderReplyBar();
}

/**
 * Opens (or focuses) a text channel's tab (PRD 17.5). By default it opens in
 * the preview tab, replacing the current preview in place; `mode: "kept"`
 * opens it as a kept tab. `focus: false` + `deferLoad` are used to restore
 * kept tabs at connect without stealing focus or fetching N histories (the
 * history loads when the tab is first activated — see switchTab()).
 */
/**
 * The preview tab a NEW preview tab will replace (PRD 19 B4: shared by channel
 * and DM tabs). Only a new PREVIEW replaces; a kept tab never does.
 */
function replaceablePreview(mode: "preview" | "kept"): ChatTab | null {
    return mode === "preview" && previewTabId ? chatTabs.get(previewTabId) ?? null : null;
}

/** Puts a new tab's element in the bar: in the replaced preview's slot, else at the end. */
function insertTabElement(tabEl: HTMLElement, replaced: ChatTab | null): void {
    if (replaced) tabBar.insertBefore(tabEl, replaced.tabEl);
    else tabBar.insertBefore(tabEl, tabBar.querySelector("#tab-overflow")); // before the overflow button (PRD 19 C8)
    scheduleTabOverflow();
}

/**
 * The shared tail of opening a tab (PRD 19 B4), once its state is registered:
 * mode styling, unread state, replacing the old preview (through closeTab, so
 * its observers and reply draft are disposed — never a bare .remove()),
 * remembering a kept tab, and optionally focusing it.
 */
function placeTab(tab: ChatTab, replaced: ChatTab | null, mode: "preview" | "kept", focus: boolean): void {
    renderTabMode(tab);
    refreshTabUnread(tab.channelId); // e.g. a restored tab for a conversation with unread messages
    // Dispose of the replaced preview AFTER the new tab exists, without the
    // usual fall-back to the Server Log in between (no flicker).
    if (replaced) closeTab(replaced.channelId, { reason: "replaced" });
    if (mode === "preview") previewTabId = tab.channelId;
    else persistKeptTabs();
    if (focus) switchTab(tab.channelId);
}

/** Double-click keeps a tab (PRD 19 B4 for DMs; the same gesture on channel tabs). */
function wireTabKeepGesture(tabEl: HTMLElement, tabId: string): void {
    tabEl.addEventListener("dblclick", (e) => {
        if ((e.target as HTMLElement).classList.contains("tab-close")) return;
        setTabKept(tabId, true);
    });
}

function openChatTab(
    channelId: string,
    channelName: string,
    opts: { mode?: "preview" | "kept"; focus?: boolean; deferLoad?: boolean } = {},
): void {
    const focus = opts.focus !== false;

    // No access (PRD 18.18): nothing opens. A background restore stays silent.
    if (!hasServerAccess) {
        if (focus) requireServerAccess();
        return;
    }

    // Already open: focus it; "Keep Tab Open" on a preview tab keeps it in place.
    const existing = chatTabs.get(channelId);
    if (existing) {
        if (opts.mode === "kept" && existing.mode !== "kept") setTabKept(channelId, true);
        if (focus) switchTab(channelId);
        return;
    }

    const mode = opts.mode ?? "preview";
    // The preview tab this one replaces, if any (only a new PREVIEW replaces).
    const replaced = replaceablePreview(mode);

    // Create tab button
    const tabEl = document.createElement("div");
    tabEl.className = "tab";
    tabEl.dataset.tabId = channelId;
    fillTabElement(tabEl, "💬", channelName);

    tabEl.addEventListener("click", (e) => {
        // Check if close button was clicked
        if ((e.target as HTMLElement).classList.contains("tab-close")) {
            closeTab(channelId);
        } else {
            switchTab(channelId);
        }
    });
    tabEl.addEventListener("contextmenu", (e) => showTabContextMenu(e, channelId));
    wireTabKeepGesture(tabEl, channelId);

    // A replacement takes the replaced tab's slot in the bar.
    insertTabElement(tabEl, replaced);

    // Create tab content
    const contentEl = document.createElement("div");
    contentEl.className = "tab-content";
    contentEl.dataset.tabId = channelId;

    // Pinned-message bar (PRD 11.5) — prepended above the message list, one
    // per channel tab, hidden until a pin actually exists.
    const pinBarEl = document.createElement("div");
    pinBarEl.className = "pinned-bar";
    pinBarEl.innerHTML = `
        <i class="ph-fill ph-push-pin" aria-hidden="true"></i>
        <div class="pinned-bar-main"><div class="pinned-bar-kicker">Pinned · <span class="pinned-bar-author"></span></div><span class="pinned-bar-text"></span></div>
        <i class="ph ph-caret-down pinned-bar-caret" aria-hidden="true"></i>
    `;
    pinBarEl.addEventListener("click", () => {
        const msgId = pinBarEl.dataset.pinnedMsgId;
        if (msgId) jumpToMessage(channelId, msgId);
    });
    contentEl.appendChild(pinBarEl);

    const messagesEl = document.createElement("div");
    messagesEl.className = "chat-messages";
    const topSentinelEl = document.createElement("div");
    topSentinelEl.className = "chat-top-sentinel";
    messagesEl.appendChild(topSentinelEl);
    contentEl.appendChild(messagesEl);
    const { bottomSentinelEl, jumpToRecentBtn } = createJumpToRecentControls(contentEl, messagesEl, () => {
        const t = chatTabs.get(channelId);
        if (t) scrollToMostRecent(t);
    });

    tabContentArea.appendChild(contentEl);

    // Store tab state
    const chatTab: ChatTab = {
        channelId,
        channelName,
        tabEl,
        contentEl,
        messagesEl,
        loaded: false,
        pinBarEl,
        pinnedMessageId: null,
        topSentinelEl,
        hasMoreOlder: false,
        loadingOlder: false,
        initialLoadDone: false,
        bottomSentinelEl,
        jumpToRecentBtn,
        atTrueLatest: true,
        loadingNewer: false,
        jumpInProgress: false,
        followBottom: true,
        programmaticScroll: 0,
        smoothScrolling: 0,
        anchor: null,
        holdTarget: null,
        kind: "channel",
        mode,
    };
    chatTabs.set(channelId, chatTab);
    syncTabNsfwClass(channelId); // PRD 18.11
    setupInfiniteScroll(chatTab);
    setupScrollKeeper(chatTab); // PRD 18.12
    placeTab(chatTab, replaced, mode, focus);

    // Fetch message history (a deferred tab loads on first activation).
    if (!opts.deferLoad) loadChatHistory(chatTab);
}

// ── DM Tab Management ─────────────────────────────────────────────────────

/**
 * Opens (or finds) a DM tab (PRD 19 B4). Defaults: `mode: "preview"`,
 * `focus: true` — what a click on a person does. Incoming DMs and the connect
 * -time auto-open pass `{ mode: "kept", focus: false }` so they never steal the
 * view. `unreadCountHint` widens the first history fetch past one page.
 */
function openDmTab(
    userId: string,
    nickname: string,
    opts: { mode?: "preview" | "kept"; focus?: boolean; unreadCountHint?: number } = {},
): void {
    const focus = opts.focus !== false;
    const mode = opts.mode ?? "preview";
    const unreadCountHint = opts.unreadCountHint;
    // No access: nothing opens. A background open stays silent.
    if (!hasServerAccess) {
        if (focus) requireServerAccess(); // PRD 18.18
        return;
    }
    const tabKey = `dm:${userId}`;

    // Already open: keep it when asked, and focus only when asked.
    const existing = chatTabs.get(tabKey);
    if (existing) {
        if (mode === "kept" && existing.mode !== "kept") setTabKept(tabKey, true);
        if (focus) switchTab(tabKey);
        return;
    }

    // The preview tab this one replaces, if any.
    const replaced = replaceablePreview(mode);

    // Create tab button
    const tabEl = document.createElement("div");
    tabEl.className = "tab";
    tabEl.dataset.tabId = tabKey;
    fillTabElement(tabEl, `<i class="ph ph-at" aria-hidden="true"></i>`, nickname);

    tabEl.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).classList.contains("tab-close")) {
            closeTab(tabKey);
        } else {
            switchTab(tabKey);
        }
    });
    tabEl.addEventListener("contextmenu", (e) => showTabContextMenu(e, tabKey)); // Keep Tab Open / Close (PRD 19 B4)
    wireTabKeepGesture(tabEl, tabKey);

    insertTabElement(tabEl, replaced);

    // Create tab content
    const contentEl = document.createElement("div");
    contentEl.className = "tab-content";
    contentEl.dataset.tabId = tabKey;

    const messagesEl = document.createElement("div");
    messagesEl.className = "chat-messages";
    const topSentinelEl = document.createElement("div");
    topSentinelEl.className = "chat-top-sentinel";
    messagesEl.appendChild(topSentinelEl);
    contentEl.appendChild(messagesEl);
    const { bottomSentinelEl, jumpToRecentBtn } = createJumpToRecentControls(contentEl, messagesEl, () => {
        const t = chatTabs.get(tabKey);
        if (t) scrollToMostRecent(t);
    });

    tabContentArea.appendChild(contentEl);

    // Store tab state
    const chatTab: ChatTab = {
        channelId: tabKey,
        channelName: nickname,
        tabEl,
        contentEl,
        messagesEl,
        loaded: false,
        pinnedMessageId: null,
        topSentinelEl,
        hasMoreOlder: false,
        loadingOlder: false,
        initialLoadDone: false,
        bottomSentinelEl,
        jumpToRecentBtn,
        atTrueLatest: true,
        loadingNewer: false,
        jumpInProgress: false,
        followBottom: true,
        programmaticScroll: 0,
        smoothScrolling: 0,
        anchor: null,
        holdTarget: null,
        kind: "dm",
        mode,
    };
    chatTabs.set(tabKey, chatTab);
    setupInfiniteScroll(chatTab);
    setupScrollKeeper(chatTab); // PRD 18.12
    placeTab(chatTab, replaced, mode, focus);

    // Fetch DM history
    loadChatHistory(chatTab, unreadCountHint);
}

/**
 * Closes a tab. `reason` (PRD 17.5) decides the bookkeeping:
 * - "user" (✕, menu) and "deleted" (channel gone) forget a kept tab;
 * - "disconnect" keeps it remembered, to be restored on the next connect;
 * - "replaced" (a new preview took its slot) also skips the fall-back to the
 *   Server Log, since the replacement is about to be focused.
 */
function closeTab(
    channelId: string,
    opts: { reason?: "user" | "replaced" | "disconnect" | "deleted" | "access" } = {},
): void {
    const reason = opts.reason ?? "user";
    const tab = chatTabs.get(channelId);
    if (!tab) return;

    tab.scrollObserver?.disconnect();
    tab.resizeObserver?.disconnect(); // PRD 18.12
    tab.mutationObserver?.disconnect();
    tab.tabEl.remove();
    tab.contentEl.remove();
    chatTabs.delete(channelId);
    scheduleTabOverflow(); // PRD 19 C8
    replyTargets.delete(channelId); // a draft reply dies with its conversation's tab (PRD 16.11)

    if (previewTabId === channelId) previewTabId = null;
    if (reason === "user" || reason === "deleted") pendingKeptDmIds.delete(channelId);
    if (tab.mode === "kept" && (reason === "user" || reason === "deleted")) persistKeptTabs();

    // If this was the active tab, switch to server log
    if (activeTabId === channelId && reason !== "replaced") {
        switchTab("server-log");
    }
}

/**
 * Keep Tab Open / Stop Keeping Open (PRD 17.5). Keeping a channel that has no
 * tab opens it as a kept tab and focuses it. Unkeeping turns the tab back into
 * THE preview tab; if another preview tab is open, the one the user is
 * looking at survives and the other closes.
 */
function setTabKept(tabId: string, kept: boolean): void {
    const tab = chatTabs.get(tabId);
    if (kept) {
        if (!tab) {
            const node = findChannelNodeById(currentTree, tabId);
            if (node) openChatTab(node.id, node.name, { mode: "kept" });
            return;
        }
        if (tab.mode === "kept") return;
        tab.mode = "kept";
        if (previewTabId === tabId) previewTabId = null;
        renderTabMode(tab);
        persistKeptTabs();
        return;
    }

    if (!tab || tab.mode !== "kept") return;
    const otherPreview = previewTabId && previewTabId !== tabId ? chatTabs.get(previewTabId) : undefined;
    tab.mode = "preview";
    renderTabMode(tab);
    if (otherPreview && activeTabId === otherPreview.channelId) {
        // The user is looking at the other preview: this one gives way.
        closeTab(tabId, { reason: "user" });
    } else {
        if (otherPreview) closeTab(otherPreview.channelId, { reason: "user" });
        previewTabId = tabId;
    }
    persistKeptTabs();
}

/**
 * Right-click on a channel or DM tab (PRD 17.5, 19 B5): Keep open / Stop keeping
 * open, Close tab, Close other tabs, Close tabs to the right. The Server Log
 * tab has no menu (it cannot be closed) and is never closed by the bulk items.
 */
function showTabContextMenu(e: MouseEvent, channelId: string): void {
    e.preventDefault();
    e.stopPropagation();
    const tab = chatTabs.get(channelId);
    if (!tab) return;

    const kept = tab.mode === "kept";
    // Tabs in bar order, the Server Log excluded (it is never closed in bulk).
    const barIds = Array.from(tabBar.querySelectorAll<HTMLElement>(".tab"))
        .map((el) => el.dataset.tabId ?? "")
        .filter((id) => id !== "server-log" && chatTabs.has(id));
    const otherIds = barIds.filter((id) => id !== channelId);
    const rightIds = barIds.slice(barIds.indexOf(channelId) + 1);

    // Each closes through closeTab(..., "user"), so a kept tab is also un-kept
    // and forgotten exactly as if its own ✕ had been clicked.
    openMenu(
        [
            {
                label: kept ? "Stop keeping open" : "Keep open",
                icon: "ph-bookmark-simple",
                onClick: () => setTabKept(channelId, !kept),
            },
            { divider: true },
            { label: "Close tab", icon: "ph-x", onClick: () => closeTab(channelId) },
            {
                label: "Close other tabs",
                disabled: otherIds.length === 0,
                onClick: () => {
                    for (const id of otherIds) closeTab(id, { reason: "user" });
                },
            },
            {
                label: "Close tabs to the right",
                disabled: rightIds.length === 0,
                onClick: () => {
                    for (const id of rightIds) closeTab(id, { reason: "user" });
                },
            },
        ],
        e.clientX,
        e.clientY,
        { anchor: tab.tabEl },
    );
}

/**
 * Re-opens the current server's kept tabs (PRD 17.5) once per connection,
 * after the first channel tree: in their saved order, unfocused, with history
 * deferred until each is first opened. Channels that no longer exist (or are
 * no longer text channels) are dropped from the store.
 */
function restoreKeptTabs(tree: TreeNode[], serverId: string): void {
    keptTabsServerId = serverId;
    // Restricted: nothing opens now, and the flag stays unset so the tabs come
    // back when access does (PRD 18.18).
    if (!hasServerAccess) return;
    if (keptTabsRestored || tree.length === 0) return;
    keptTabsRestored = true;
    const saved = readKeptTabsStore()[serverId] ?? [];
    // DM entries wait for DM data (restoreKeptDmTabs); they stay in the store meanwhile.
    pendingKeptDmIds = new Set(saved.filter((id) => id.startsWith("dm:")));
    for (const id of saved) {
        if (id.startsWith("dm:")) continue;
        const node = findChannelNodeById(tree, id);
        if (node && node.type === "TEXT") openChatTab(node.id, node.name, { mode: "kept", focus: false, deferLoad: true });
    }
    persistKeptTabs(); // drops channel ids that weren't restored; keeps the pending DMs
    if (pendingKeptDmIds.size > 0) void restoreKeptDmTabs();
}

/**
 * Re-opens remembered DM tabs once DM data exists (PRD 19 B4): the directory
 * (A7), or the online-users list on an older server. Entries for people who
 * are not listed stay in the store (they may only be without access for now).
 * Opened as kept and unfocused; history loads on first view.
 */
async function restoreKeptDmTabs(): Promise<void> {
    if (!hasServerAccess || pendingKeptDmIds.size === 0) return;
    // The first tree arrives before the `connected` event (currentServerId is
    // not set yet), so the server is identified by the kept-tabs key.
    const serverAtStart = keptTabsServerId;
    let people: { userId: string; nickname: string }[] | null = null;
    const directory = await api.getDmDirectory();
    if (directory) {
        people = directory;
    } else {
        const online = await api.getOnlineUsers();
        if (online.success && online.users) people = online.users;
    }
    // A disconnect or server switch while waiting must not open tabs on the wrong server.
    if (!people || keptTabsServerId !== serverAtStart || !hasServerAccess) return;
    for (const id of [...pendingKeptDmIds]) {
        const person = people.find((p) => `dm:${p.userId}` === id);
        if (!person) continue;
        pendingKeptDmIds.delete(id);
        openDmTab(person.userId, person.nickname, { mode: "kept", focus: false });
    }
    persistKeptTabs();
}

/** Closes kept/preview channel tabs whose channel vanished from the tree (PRD 17.5). */
function pruneClosedChannelTabs(tree: TreeNode[]): void {
    if (tree.length === 0) return; // an empty tree is transient — never prune on it
    for (const tab of [...chatTabs.values()]) {
        if (tab.kind !== "channel") continue;
        const node = findChannelNodeById(tree, tab.channelId);
        if (!node || node.type !== "TEXT") closeTab(tab.channelId, { reason: "deleted" });
    }
}

/**
 * Loads a tab's initial page of history (PRD 14.2). `unreadCountHint`
 * (DM tabs only, from `GET_UNREAD_DM_PARTNERS`'s per-partner count) widens
 * the initial fetch past `CHAT_PAGE_SIZE` when there's a deeper unread
 * backlog than one page — otherwise the "Unread Messages" separator below
 * would miss the true first-unread message, silently regressing an
 * existing feature just to shrink the common case's initial fetch size.
 */
async function loadChatHistory(tab: ChatTab, unreadCountHint?: number): Promise<void> {
    if (tab.loaded) return;
    tab.loaded = true;

    await fetchAndRenderLatestPage(tab, unreadCountHint);
    tab.initialLoadDone = true;
    tab.atTrueLatest = true;
    if (tab.kind === "channel") markChannelTabRead(tab); // PRD 19 B3: now it has been seen
    ensureHistoryFilled(tab); // an under-filled first page would never load more (PRD 17.8)
}

/**
 * Fetches and renders the freshest page of a tab's history — shared by the
 * initial load (`loadChatHistory`) and by "Jump to Most Recent Message"'s
 * from-scratch rebuild (`rebuildTabAtLatest`, PRD 14.3) when the true
 * latest message isn't currently loaded.
 */
async function fetchAndRenderLatestPage(tab: ChatTab, unreadCountHint?: number): Promise<void> {
    if (tab.channelId.startsWith("dm:")) {
        // DM tab — fetch direct messages
        const partnerId = tab.channelId.slice(3);
        const myId = api.getInstanceId();
        const initialLimit = Math.min(Math.max(unreadCountHint ?? 0, CHAT_PAGE_SIZE), 100);
        const result = await api.fetchDirectMessages(partnerId, undefined, initialLimit);
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
                    tab.bottomSentinelEl.insertAdjacentElement("beforebegin", separator);
                }
                renderDmMessage(tab, result.messages[i]);
            }

            // Unread until the tab is actually viewed with the window focused
            // (PRD 18.13): a tab opened in the background on connect keeps its
            // dot, and its messages stay unread on the server.
            if (firstUnreadIndex !== -1) {
                // The page shows how many are unread when the server's number has not arrived.
                if (!hasDmUnread(partnerId)) unreadDmCounts.set(partnerId, result.messages.length - firstUnreadIndex);
                refreshTabUnread(tab.channelId);
                markDmTabRead(tab, { hadUnreadOnPage: true });
            }

            // The server says for sure since 2.6.0 (PRD 17.8); guess for older ones.
            tab.hasMoreOlder = result.hasMoreBefore ?? result.messages.length >= initialLimit;
        }
    } else {
        // Channel tab — fetch channel messages
        const result = await api.fetchMessages(tab.channelId, undefined, CHAT_PAGE_SIZE);
        if (result.success && result.messages) {
            // Set before rendering so each message's pin button (PRD 11.5)
            // reflects the correct active/inactive state on first paint.
            tab.pinnedMessageId = result.pinnedMessage?.id ?? null;
            for (const msg of result.messages) {
                renderChatMessage(tab, msg);
            }
            updatePinBarUI(tab, result.pinnedMessage ?? null);
            tab.hasMoreOlder = result.hasMoreBefore ?? result.messages.length >= CHAT_PAGE_SIZE;
        }
    }
}

/**
 * "Jump to Most Recent Message" (PRD 14.3): when the true latest message
 * isn't currently loaded — the only case being after `jumpToMessage`
 * showed a window that might not reach the present — rebuilds the tab from
 * a fresh latest-page fetch, mirroring `jumpToMessage`'s own
 * wipe-and-rebuild shape, rather than trying to scroll through a
 * potentially huge unloaded gap.
 */
async function rebuildTabAtLatest(tab: ChatTab): Promise<void> {
    tab.messagesEl.innerHTML = "";
    tab.lastRenderedDateKey = undefined;
    tab.oldestRenderedDateKey = undefined;
    tab.oldestLoadedTimestamp = undefined;
    tab.newestLoadedTimestamp = undefined;
    tab.messagesEl.appendChild(tab.topSentinelEl);
    tab.messagesEl.appendChild(tab.bottomSentinelEl);
    tab.loadingOlder = false;
    tab.loadingNewer = false;

    await fetchAndRenderLatestPage(tab);
    tab.atTrueLatest = true;
    ensureHistoryFilled(tab);
}

/** Click handler for the floating "Jump to Most Recent Message" button
 *  (PRD 14.3). */
async function scrollToMostRecent(tab: ChatTab): Promise<void> {
    if (!tab.atTrueLatest) {
        await rebuildTabAtLatest(tab);
    }
    tab.followBottom = true;
    smoothScroll(tab, () => tab.messagesEl.scrollTo({ top: tab.messagesEl.scrollHeight, behavior: "smooth" }));
    // Landing at the bottom clears unread state, same as a natural
    // scroll-to-bottom or tab switch already does.
    markChannelTabRead(tab);
}

function setJumpToRecentVisible(tab: ChatTab, visible: boolean): void {
    tab.jumpToRecentBtn.classList.toggle("visible", visible);
}

/** Builds the bottom sentinel + floating button pair for a new tab (PRD
 *  14.3) — `bottomSentinelEl` must be appended to `messagesEl` immediately
 *  by the caller (before any messages exist yet) so every later message
 *  insertion via `bottomSentinelEl.insertAdjacentElement("beforebegin", …)`
 *  keeps it pinned as the last child automatically. */
function createJumpToRecentControls(
    contentEl: HTMLDivElement,
    messagesEl: HTMLDivElement,
    onClick: () => void,
): { bottomSentinelEl: HTMLDivElement; jumpToRecentBtn: HTMLButtonElement } {
    const bottomSentinelEl = document.createElement("div");
    bottomSentinelEl.className = "chat-bottom-sentinel";
    messagesEl.appendChild(bottomSentinelEl);

    const jumpToRecentBtn = document.createElement("button");
    jumpToRecentBtn.type = "button";
    jumpToRecentBtn.className = "jump-to-recent-btn";
    jumpToRecentBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg><span>Jump to Most Recent Message</span>`;
    jumpToRecentBtn.addEventListener("click", onClick);
    contentEl.appendChild(jumpToRecentBtn);

    return { bottomSentinelEl, jumpToRecentBtn };
}

/**
 * Fetches and prepends the next older page once the top sentinel scrolls
 * into view (PRD 14.2). Cursor is `tab.oldestLoadedTimestamp`, the
 * `createdAt` of whatever message is currently the earliest rendered.
 */
async function loadOlderMessages(tab: ChatTab): Promise<void> {
    if (!tab.initialLoadDone || tab.loadingOlder || !tab.hasMoreOlder || tab.jumpInProgress) return;

    tab.loadingOlder = true;
    tab.topSentinelEl.classList.add("loading");
    tab.topSentinelEl.textContent = "Loading older messages…";

    const isDm = tab.channelId.startsWith("dm:");
    const result = isDm
        ? await api.fetchDirectMessages(tab.channelId.slice(3), tab.oldestLoadedTimestamp, CHAT_PAGE_SIZE)
        : await api.fetchMessages(tab.channelId, tab.oldestLoadedTimestamp, CHAT_PAGE_SIZE);

    tab.loadingOlder = false;
    tab.topSentinelEl.classList.remove("loading");
    tab.topSentinelEl.textContent = "";

    if (!result.success || !result.messages || result.messages.length === 0) {
        tab.hasMoreOlder = false;
        return;
    }

    tab.hasMoreOlder = result.hasMoreBefore ?? result.messages.length >= CHAT_PAGE_SIZE;

    // Preserve the user's visual anchor across the prepend (Slack/Discord/
    // Teams pattern). Anchored on an ELEMENT — the first message whose text is
    // in view — rather than on the scrollHeight difference: the junction
    // repair can turn the old first message into a continuation, which drops
    // its header/avatar and min-height (PRD 17.2), so the height difference
    // alone no longer says where the text the user is reading went.
    const viewTop = tab.messagesEl.getBoundingClientRect().top;
    const anchorBody = Array.from(tab.messagesEl.querySelectorAll<HTMLElement>(".chat-msg .msg-body"))
        .find((b) => b.getBoundingClientRect().bottom > viewTop);
    const anchorTopBefore = anchorBody?.getBoundingClientRect().top ?? 0;
    const oldScrollHeight = tab.messagesEl.scrollHeight;
    const oldScrollTop = tab.messagesEl.scrollTop;

    if (isDm) {
        prependOlderMessages(tab, result.messages as DirectMessage[], true);
    } else {
        prependOlderMessages(tab, result.messages as ChatMessage[], false);
    }

    setScroll(tab, () => {
        if (anchorBody?.isConnected) {
            tab.messagesEl.scrollTop += anchorBody.getBoundingClientRect().top - anchorTopBefore;
        } else {
            tab.messagesEl.scrollTop = oldScrollTop + (tab.messagesEl.scrollHeight - oldScrollHeight);
        }
    });
    recordAnchor(tab); // before the keeper's next frame, so it doesn't undo this correction
    ensureHistoryFilled(tab); // a short page can still leave the sentinel in view
}

/** One `IntersectionObserver` per tab, watching both the top sentinel
 *  (PRD 14.2 — triggers loading older history) and the bottom sentinel
 *  (PRD 14.3 — shows/hides "Jump to Most Recent Message"), against its own
 *  scrollable `messagesEl` as root (not the window). */
function setupInfiniteScroll(tab: ChatTab): void {
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (entry.target === tab.topSentinelEl) {
                    if (entry.isIntersecting) loadOlderMessages(tab);
                } else if (entry.target === tab.bottomSentinelEl) {
                    // While newer history is still unloaded the button stays,
                    // even at the window's bottom (PRD 17.8).
                    setJumpToRecentVisible(tab, !entry.isIntersecting || !tab.atTrueLatest);
                    if (entry.isIntersecting) loadNewerMessages(tab);
                }
            }
        },
        { root: tab.messagesEl, threshold: 0 },
    );
    observer.observe(tab.topSentinelEl);
    observer.observe(tab.bottomSentinelEl);
    tab.scrollObserver = observer;
}

/** Messages fetched around a jump target (PRD 17.8): 20 + target + 20. */
const JUMP_WINDOW_SIZE = 41;

/**
 * Scrolling DOWN from a jump window (PRD 17.8): loads the next newer page
 * once the bottom sentinel comes into view, until the present is reached —
 * after which live messages render normally again. Appending below the
 * viewport doesn't move what the user is reading.
 */
async function loadNewerMessages(tab: ChatTab): Promise<void> {
    if (!tab.initialLoadDone || tab.loadingNewer || tab.atTrueLatest || tab.jumpInProgress || !tab.newestLoadedTimestamp) return;

    tab.loadingNewer = true;
    tab.bottomSentinelEl.classList.add("loading");
    tab.bottomSentinelEl.textContent = "Loading newer messages…";

    const isDm = tab.channelId.startsWith("dm:");
    const result = isDm
        ? await api.fetchDirectMessages(tab.channelId.slice(3), undefined, CHAT_PAGE_SIZE, undefined, tab.newestLoadedTimestamp)
        : await api.fetchMessages(tab.channelId, undefined, CHAT_PAGE_SIZE, undefined, tab.newestLoadedTimestamp);

    tab.loadingNewer = false;
    tab.bottomSentinelEl.classList.remove("loading");
    tab.bottomSentinelEl.textContent = "";
    if (!result.success || !result.messages) return;

    if (result.hasMoreAfter === undefined) {
        // A pre-2.6.0 server ignores `after` and answered with the LATEST
        // page; appending it would leave a hidden gap. Fall back to the old
        // behavior: rebuild the tab at the present.
        await rebuildTabAtLatest(tab);
        stickToBottom(tab);
        return;
    }

    for (const msg of result.messages) {
        // A live message rendered meanwhile (e.g. your own) isn't added twice.
        if (tab.messagesEl.querySelector(`.chat-msg[data-msg-id="${CSS.escape(msg.id)}"]`)) continue;
        if (isDm) renderDmMessage(tab, msg as DirectMessage, { stick: false });
        else renderChatMessage(tab, msg as ChatMessage, { stick: false });
    }
    tab.atTrueLatest = !result.hasMoreAfter;
    setJumpToRecentVisible(tab, !tab.atTrueLatest || !isNearBottom(tab.messagesEl));
    ensureHistoryFilled(tab);
}

/**
 * Loads more history while a sentinel is still inside the viewport (PRD
 * 17.8). The IntersectionObserver only fires on a CHANGE, so a page that
 * doesn't fill the list (short messages, a tall window) used to leave the
 * top sentinel visible forever with nothing to scroll — and older history
 * never loaded. Runs after every load; each load calls it again, so it
 * repeats until the list overflows or history runs out.
 */
function ensureHistoryFilled(tab: ChatTab): void {
    if (!tab.initialLoadDone || tab.jumpInProgress || !tab.messagesEl.isConnected) return;
    if (tab.messagesEl.offsetParent === null) return; // hidden tab — switching to it re-triggers the observer
    const view = tab.messagesEl.getBoundingClientRect();
    const visible = (el: HTMLElement): boolean => {
        const r = el.getBoundingClientRect();
        return r.bottom >= view.top && r.top <= view.bottom;
    };
    if (tab.hasMoreOlder && !tab.loadingOlder && visible(tab.topSentinelEl)) {
        loadOlderMessages(tab);
    } else if (!tab.atTrueLatest && !tab.loadingNewer && visible(tab.bottomSentinelEl)) {
        loadNewerMessages(tab);
    }
}

/**
 * Keeps a jump target centred for a moment while images above it finish
 * loading (PRD 17.8). Chromium's CSS scroll anchoring already compensates for
 * content growing above the viewport; this is belt and braces. Stops at once
 * when the user takes over (wheel, touch, keys, pointer).
 */
function holdJumpTarget(tab: ChatTab, el: HTMLElement, ms = 10_000): void {
    // The scroll keeper re-centres it on any size change (previews, images),
    // until the user takes over or the window passes (PRD 18.12).
    tab.holdTarget = { el, until: performance.now() + ms };
    tab.followBottom = false;
    const scroller = tab.messagesEl;
    const recenter = (): void => {
        if (el.isConnected) el.scrollIntoView({ behavior: "instant", block: "center" });
    };
    const stop = (): void => {
        scroller.removeEventListener("load", recenter, true);
        for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) scroller.removeEventListener(type, stop);
    };
    scroller.addEventListener("load", recenter, true); // <img> load doesn't bubble; capture sees it
    for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) scroller.addEventListener(type, stop, { passive: true });
    setTimeout(stop, ms);
}

function highlightMessage(el: HTMLElement): void {
    el.classList.add("msg-highlight");
    setTimeout(() => el.classList.remove("msg-highlight"), 2000);
}

/** "13th", "1st", "22nd", etc. */
function ordinalSuffix(day: number): string {
    if (day >= 11 && day <= 13) return `${day}th`;
    switch (day % 10) {
        case 1: return `${day}st`;
        case 2: return `${day}nd`;
        case 3: return `${day}rd`;
        default: return `${day}th`;
    }
}

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

/** "April 13th" for the current year, "April 13th, 2025" otherwise (PRD 13.6). */
function formatDateSectionLabel(date: Date): string {
    const label = `${MONTH_NAMES[date.getMonth()]} ${ordinalSuffix(date.getDate())}`;
    return date.getFullYear() === new Date().getFullYear()
        ? label
        : `${label}, ${date.getFullYear()}`;
}

/** `YYYY-M-D` local-date key used by both the forward (append) and
 *  backward (prepend) date-divider logic. */
function computeDayKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Inserts a "--- Month Day(th) ---" divider into `tab.messagesEl` whenever
 * `msgDate` falls on a different local day than the last message rendered
 * into this tab — called before each message is appended so the divider
 * lands directly above it. A no-op for every message after the first on
 * the same day.
 */
function maybeInsertDateDivider(tab: ChatTab, msgDate: Date): void {
    const dayKey = computeDayKey(msgDate);
    if (tab.lastRenderedDateKey === dayKey) return;
    tab.lastRenderedDateKey = dayKey;

    const divider = document.createElement("div");
    divider.className = "date-separator";
    divider.innerHTML = `<span>${escapeHtml(formatDateSectionLabel(msgDate))}</span>`;
    tab.bottomSentinelEl.insertAdjacentElement("beforebegin", divider);
}

/** True when the container is scrolled at (or within `thresholdPx` of) its
 *  own bottom — the "should new/async content auto-stick to the bottom"
 *  check used throughout PRD 14.1/14.2, so a user reading scrolled-up
 *  history never gets yanked down by something loading in the background. */
function isNearBottom(el: HTMLElement, thresholdPx = 60): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx;
}

// ── Scroll keeper (PRD 18.12) ───────────────────────────────────────────────
// Reproduced on the 18.11 build with delayed previews and slow images: (a) a
// card's image grows it AFTER the stick that ran when the card was inserted,
// so the view ended ~900px above the bottom; (b) a preview arriving after the
// user scrolled up yanked them to the bottom, because `wasNearBottom` had been
// captured at message-render time. (Content growing above the reading position
// was already handled by Chromium's native scroll anchoring.)
// One state per tab (`followBottom`, read when a size change really happens)
// and one ResizeObserver per tab replace those per-message captures.

/** Runs a programmatic scroll change so the scroll listener ignores it. */
function setScroll(tab: ChatTab, fn: () => void): void {
    tab.programmaticScroll++;
    try {
        fn();
    } finally {
        // The scroll event fires during the next frame's update, BEFORE rAF callbacks.
        requestAnimationFrame(() => {
            tab.programmaticScroll = Math.max(0, tab.programmaticScroll - 1);
            recordAnchor(tab);
        });
    }
}

/** Records the first message whose text is in view, for restoring after layout shifts. */
function recordAnchor(tab: ChatTab): void {
    const el = tab.messagesEl;
    if (el.clientHeight === 0) return; // hidden tab
    const viewTop = el.getBoundingClientRect().top;
    const bodies = el.querySelectorAll<HTMLElement>(".chat-msg .msg-body");
    for (const b of bodies) {
        const r = b.getBoundingClientRect();
        if (r.bottom > viewTop) {
            tab.anchor = { el: b, top: r.top - viewTop };
            return;
        }
    }
    tab.anchor = null;
}

/** Applied after every batch of message-size changes. */
function keepScroll(tab: ChatTab): void {
    const el = tab.messagesEl;
    if (el.clientHeight === 0) return; // hidden tab: re-applied by switchTab()
    if (tab.smoothScrolling > 0) return; // never fight a smooth scroll

    if (tab.followBottom) {
        if (el.scrollHeight - el.scrollTop - el.clientHeight > 0.5) stickToBottom(tab);
        return;
    }
    if (tab.holdTarget && performance.now() < tab.holdTarget.until && tab.holdTarget.el.isConnected) {
        const target = tab.holdTarget.el;
        setScroll(tab, () => target.scrollIntoView({ behavior: "instant", block: "center" }));
        return;
    }
    if (tab.anchor?.el.isConnected) {
        const viewTop = el.getBoundingClientRect().top;
        const delta = tab.anchor.el.getBoundingClientRect().top - viewTop - tab.anchor.top;
        if (Math.abs(delta) >= 1) setScroll(tab, () => { el.scrollTop += delta; });
    }
}

/** A smooth scroll that the keeper must not fight: programmatic until it ends. */
function smoothScroll(tab: ChatTab, start: () => void): void {
    tab.programmaticScroll++;
    tab.smoothScrolling++;
    let done = false;
    const finish = (): void => {
        if (done) return;
        done = true;
        tab.programmaticScroll = Math.max(0, tab.programmaticScroll - 1);
        tab.smoothScrolling = Math.max(0, tab.smoothScrolling - 1);
        tab.followBottom = isNearBottom(tab.messagesEl);
        recordAnchor(tab);
    };
    tab.messagesEl.addEventListener("scrollend", finish, { once: true });
    setTimeout(finish, 1200); // never leave it stuck if no scroll happens
    start();
}

function setupScrollKeeper(tab: ChatTab): void {
    const el = tab.messagesEl;
    // Runs in the frame's layout phase, before paint: correcting here means the
    // shifted frame is never shown. Only the scroll position changes in here,
    // never an element size, so it cannot feed the observer a loop.
    const ro = new ResizeObserver(() => keepScroll(tab));
    const track = (n: Node): void => {
        if (n instanceof HTMLElement && n.classList.contains("chat-msg")) ro.observe(n);
    };
    el.querySelectorAll(".chat-msg").forEach(track);
    // Every insertion path (live, prepend, jump window, rebuild) adds `.chat-msg`
    // children of the list; observing them here means no path can forget to.
    const mo = new MutationObserver((records) => {
        for (const rec of records) {
            rec.addedNodes.forEach(track);
            rec.removedNodes.forEach((n) => {
                if (n instanceof HTMLElement) ro.unobserve(n);
            });
        }
    });
    mo.observe(el, { childList: true });
    tab.resizeObserver = ro;
    tab.mutationObserver = mo;

    el.addEventListener(
        "scroll",
        () => {
            if (tab.programmaticScroll > 0) return;
            tab.followBottom = isNearBottom(el);
            recordAnchor(tab);
        },
        { passive: true },
    );
    // The user taking over ends a held jump target.
    for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
        el.addEventListener(type, () => { tab.holdTarget = null; }, { passive: true });
    }
}

function stickToBottom(tab: ChatTab): void {
    tab.followBottom = true;
    setScroll(tab, () => { tab.messagesEl.scrollTop = tab.messagesEl.scrollHeight; });
}

/** Records the oldest-loaded cursor/date-key the very first time a tab
 *  receives content — a no-op on every append after that, since appends
 *  only ever add newer messages (the oldest stays whatever was first). */
function trackOldestOnFirstAppend(tab: ChatTab, createdAt: string): void {
    if (tab.oldestLoadedTimestamp !== undefined) return;
    tab.oldestLoadedTimestamp = createdAt;
    tab.oldestRenderedDateKey = computeDayKey(new Date(createdAt));
}

// ── Message grouping + shared message shell (PRD 16.6) ─────────────────────
// A message is a "continuation" (no header) when it directly follows a
// message from the same author and lands within GROUP_WINDOW_MS of the FIRST
// message of that group — so a group never spans more than 5 minutes and the
// header's time stays meaningful. Anything that isn't a .chat-msg between two
// messages (date divider, "Unread Messages" separator, the sentinels) breaks
// the group naturally.
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** The pure grouping rule — kept free of the DOM so it's easy to reason about. */
function shouldGroupMessage(
    prev: { ownerId: string; createdMs: number; groupStartMs: number } | null,
    cur: { ownerId: string; createdMs: number; isReply: boolean },
): boolean {
    if (!prev || cur.isReply) return false; // a reply always opens its own group (PRD 16.11)
    if (prev.ownerId !== cur.ownerId) return false;
    if (cur.createdMs < prev.createdMs) return false; // clock skew: never group backwards
    return cur.createdMs - prev.groupStartMs < GROUP_WINDOW_MS; // NaN compares false -> not grouped
}

/** "23:32" in the user's locale (12h/24h as their OS prefers) — seconds dropped on purpose. */
function formatMessageTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatMessageFullDate(iso: string): string {
    return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Recomputes one message element's group state from its previous sibling and
 * writes it back (classes + data attributes). Returns whether anything
 * changed, which `regroupFrom()` uses to stop cascading.
 */
function applyGrouping(el: HTMLElement): boolean {
    const prevEl = el.previousElementSibling as HTMLElement | null;
    const prev = prevEl?.classList.contains("chat-msg")
        ? {
            ownerId: prevEl.dataset.msgOwner ?? "",
            createdMs: Date.parse(prevEl.dataset.createdAt ?? ""),
            groupStartMs: Date.parse(prevEl.dataset.groupStart ?? ""),
        }
        : null;

    const grouped = shouldGroupMessage(prev, {
        ownerId: el.dataset.msgOwner ?? "",
        createdMs: Date.parse(el.dataset.createdAt ?? ""),
        isReply: el.dataset.isReply === "1",
    });
    const groupStart = grouped ? (prevEl!.dataset.groupStart ?? "") : (el.dataset.createdAt ?? "");

    const changed = el.dataset.grouped !== (grouped ? "1" : "0") || el.dataset.groupStart !== groupStart;
    el.dataset.grouped = grouped ? "1" : "0";
    el.dataset.groupStart = groupStart;
    el.classList.toggle("msg-continuation", grouped);
    el.classList.toggle("msg-group-start", !grouped);

    // A continuation has no visible time, so its full date/time is a tooltip.
    if (grouped && el.dataset.createdAt) el.title = formatMessageFullDate(el.dataset.createdAt);
    else el.removeAttribute("title");
    return changed;
}

/**
 * Re-evaluates grouping from `startEl` forward. The start element is always
 * recomputed; after that it keeps going only while elements actually change,
 * since a changed group start can cascade (a former continuation may now
 * fall outside the 5-minute window and become a head). Used after a prepend
 * (the page junction), and after a delete (a head removed promotes the next
 * line; a removed in-between message can merge two runs).
 */
function regroupFrom(startEl: Element | null): void {
    let el = startEl;
    let first = true;
    while (el) {
        if (el.classList.contains("chat-msg")) {
            const changed = applyGrouping(el as HTMLElement);
            if (!first && !changed) break;
            first = false;
        }
        el = el.nextElementSibling;
    }
}

// ── Replies (PRD 16.11) ─────────────────────────────────────────────────────

const REPLY_ICON_SVG = `<i class="ph ph-arrow-bend-up-left" aria-hidden="true"></i>`; // PRD 19 R2: Phosphor
const REPLY_ATTACHMENT_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;

/** Shows/hides the reply bar for the ACTIVE tab (a reply draft belongs to its own conversation). */
function renderReplyBar(): void {
    const target = replyTargets.get(activeTabId);
    replyBar.classList.toggle("visible", !!target && activeTabId !== "server-log");
    replyBarNick.textContent = target?.nickname ?? "";
}

/** Puts the accent highlight on the message a tab's reply draft is answering (and nowhere else in that tab). */
function syncReplyHighlight(tabId: string): void {
    const tab = chatTabs.get(tabId);
    if (!tab) return;
    tab.messagesEl.querySelectorAll(".msg-reply-target").forEach((el) => el.classList.remove("msg-reply-target"));
    const target = replyTargets.get(tabId);
    if (target) tab.messagesEl.querySelector(`.chat-msg[data-msg-id="${CSS.escape(target.messageId)}"]`)?.classList.add("msg-reply-target");
}

function startReply(tabId: string, messageId: string, nickname: string): void {
    replyTargets.set(tabId, { messageId, nickname });
    syncReplyHighlight(tabId);
    renderReplyBar();
    chatInput.focus();
}

function cancelReply(tabId: string = activeTabId): void {
    if (!replyTargets.delete(tabId)) return;
    syncReplyHighlight(tabId);
    renderReplyBar();
}

btnReplyCancel.addEventListener("click", () => {
    cancelReply();
    chatInput.focus();
});

/** Fills in a snippet's text for a still-existing original: its plain text, or an "attachment" note for an image-only message. */
function setReplySnippetText(box: Element, content: string | undefined, hasAttachments: boolean | undefined): void {
    const text = box.querySelector(".msg-reply-text") as HTMLElement;
    // The same one-line plain-text path as the pinned bar — never raw Markdown or HTML.
    const plain = api.markdownToPlainText(content ?? "").replace(/\s+/g, " ").trim();
    text.classList.remove("attachment");
    if (plain) {
        text.textContent = plain;
    } else if (hasAttachments) {
        text.classList.add("attachment");
        text.innerHTML = `${REPLY_ATTACHMENT_ICON_SVG}<span>Click to see attachment</span>`;
    } else {
        text.textContent = "…";
    }
}

/** Turns a snippet into the non-clickable "Original message was deleted" state. */
function setReplySnippetDeleted(box: Element): void {
    box.classList.add("deleted");
    box.removeAttribute("role");
    box.removeAttribute("tabindex");
    box.removeAttribute("aria-label");
    (box.querySelector(".msg-reply-nick") as HTMLElement).textContent = "";
    const text = box.querySelector(".msg-reply-text") as HTMLElement;
    text.classList.remove("attachment");
    text.textContent = "Original message was deleted";
}

/** The snippet above a reply: nick + one line of the original, joined by a curved connector; a click jumps to it. */
function buildReplySnippet(reply: ReplyPreview, tabId: string): HTMLDivElement {
    const box = document.createElement("div");
    box.className = "msg-reply";
    box.dataset.replyToId = reply.id;
    box.setAttribute("role", "button");
    box.setAttribute("tabindex", "0");
    box.setAttribute("aria-label", "Jump to replied message");
    box.innerHTML = `<span class="msg-reply-spine"></span><span class="msg-reply-nick"></span><span class="msg-reply-text"></span>`;

    if (reply.deleted) {
        setReplySnippetDeleted(box);
    } else {
        (box.querySelector(".msg-reply-nick") as HTMLElement).textContent = reply.nickname ?? "Unknown";
        setReplySnippetText(box, reply.content, reply.hasAttachments);
    }

    const jump = (): void => {
        if (!box.classList.contains("deleted")) void jumpToMessage(tabId, reply.id);
    };
    box.addEventListener("click", jump);
    box.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            jump();
        }
    });
    return box;
}

/**
 * A message another user (or we) deleted: any reply snippet pointing at it
 * becomes "Original message was deleted" live, and a reply DRAFT that was
 * answering it is cancelled with a toast (PRD 16.11).
 */
function handleReplyOriginalDeleted(msgId: string): void {
    document.querySelectorAll(`.msg-reply[data-reply-to-id="${CSS.escape(msgId)}"]`).forEach(setReplySnippetDeleted);

    let cancelled = false;
    for (const [tabId, target] of [...replyTargets]) {
        if (target.messageId !== msgId) continue;
        replyTargets.delete(tabId);
        syncReplyHighlight(tabId);
        cancelled = true;
    }
    if (cancelled) {
        renderReplyBar();
        showToast("The message you were replying to was deleted.");
    }
}

/** The original of some replies was edited: refresh their snippets' text (the nickname can't change). */
function refreshReplySnippets(msgId: string, content: string): void {
    document.querySelectorAll(`.msg-reply[data-reply-to-id="${CSS.escape(msgId)}"]:not(.deleted)`).forEach((box) => setReplySnippetText(box, content, false));
}

/**
 * The shared skeleton of a channel/DM message: header (nick + time) and body
 * (text + "(edited)"). Always renders the header and lets CSS hide it on
 * continuations, so regrouping is only a class toggle.
 */
function buildMessageShell(opts: {
    kind: "channel" | "dm";
    id: string;
    ownerId: string;
    nickname: string;
    /** The author's avatar URL from the DTO (PRD 17.2); undefined = keep what the cache knows. */
    avatarUrl?: string | null;
    createdAt: string;
    content: string;
    edited?: boolean;
    /** The message this one replies to (PRD 16.11); its snippet goes above the header. */
    replyTo?: ReplyPreview | null;
    /** The tab this message is rendered in — a snippet click jumps within it. */
    tabId: string;
}): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "chat-msg";
    el.setAttribute("data-msg-id", opts.id);
    el.setAttribute("data-msg-type", opts.kind);
    el.setAttribute("data-msg-owner", opts.ownerId);
    el.setAttribute("data-created-at", opts.createdAt);
    // Shown in the gutter while a continuation (no header) is hovered (PRD 17.2).
    el.dataset.hhmm = formatMessageTime(opts.createdAt);

    const editedLabel = opts.edited ? `<span class="msg-edited">(edited)</span>` : "";
    const text = opts.content ? `<span class="msg-text"></span>` : "";
    el.innerHTML = `<div class="msg-header"><span class="msg-nick" role="button" tabindex="0" title="View profile">${escapeHtml(opts.nickname)}</span><span class="msg-time" title="${escapeHtml(formatMessageFullDate(opts.createdAt))}">${formatMessageTime(opts.createdAt)}</span></div>`
        + `<div class="msg-body">${text}${editedLabel}</div>`;

    if (opts.content) {
        setMessageBody(el.querySelector(".msg-text") as HTMLElement, opts.content);
    }

    // Avatar in the left gutter (PRD 17.2), inside the header so it shows and
    // hides with it — grouping (applyGrouping) needs no changes — and stays
    // level with the name even when a reply snippet sits above the header.
    rememberAvatarUrl(opts.ownerId, opts.avatarUrl);
    el.querySelector(".msg-header")?.prepend(createAvatarElement(opts.ownerId, opts.nickname, 40));
    // The name in its person's colour (PRD 19 R2) — the same hue as their avatar initials.
    (el.querySelector(".msg-nick") as HTMLElement | null)?.style.setProperty("--nick-color", nickColor(opts.ownerId));

    // A reply always opens its own group with its header showing, under the
    // snippet (PRD 16.6 rule 5 / 16.11) — applyGrouping() reads this flag.
    if (opts.replyTo) {
        el.dataset.isReply = "1";
        el.prepend(buildReplySnippet(opts.replyTo, opts.tabId));
    }
    return el;
}

/** A readable text colour for a person's name, from the same hue as their avatar (PRD 19 R2). */
function nickColor(userId: string): string {
    let h = 0;
    for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
    return `oklch(0.78 0.12 ${h % 360})`;
}

/** Adds the "(edited)" label to the end of a message's body if it isn't there yet. */
function ensureEditedLabel(el: Element): void {
    if (el.querySelector(".msg-edited")) return;
    el.querySelector(".msg-body")?.insertAdjacentHTML("beforeend", `<span class="msg-edited">(edited)</span>`);
}

/** The images to show for a message: the `attachments` list, or the first image of an older server's DTO (PRD 16.10). */
function getMessageAttachments(msg: { attachments?: { url: string }[]; attachmentUrl?: string | null }): { url: string }[] {
    if (msg.attachments && msg.attachments.length > 0) return msg.attachments;
    return msg.attachmentUrl ? [{ url: msg.attachmentUrl }] : [];
}

/**
 * Builds a message's image(s) (PRD 16.10), shared by channel and DM messages.
 * One image looks exactly as it always has (max 300x200); two or more become
 * a grid of square tiles. Every image opens the full viewer. In an NSFW
 * channel EACH image gets its own blur wrap + overlay (PRD 13.5), which is
 * what the "Blur images in NSFW channels" setting (PRD 16.2) switches off.
 */
function buildAttachmentsElement(attachments: { url: string }[], meta: LightboxMeta, nsfw: boolean): HTMLElement | null {
    if (attachments.length === 0) return null;

    const buildOne = (url: string): HTMLElement => {
        const img = document.createElement("img");
        img.src = url;
        img.className = "msg-image";
        img.loading = "lazy";
        img.alt = "Shared image";
        img.addEventListener("click", () => openLightbox(url, meta));
        if (!nsfw) return img;

        const wrap = document.createElement("div");
        wrap.className = "msg-image-nsfw-wrap";
        wrap.appendChild(img);
        const overlay = document.createElement("div");
        overlay.className = "msg-image-nsfw-overlay";
        overlay.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg><span>NSFW. Click to open image and reveal content.</span>`;
        overlay.addEventListener("click", () => openLightbox(url, meta));
        wrap.appendChild(overlay);
        return wrap;
    };

    if (attachments.length === 1) return buildOne(attachments[0].url);

    const grid = document.createElement("div");
    grid.className = "msg-attachments";
    grid.style.setProperty("--att-cols", String(Math.min(attachments.length, 3)));
    for (const a of attachments) grid.appendChild(buildOne(a.url));
    return grid;
}

/** Re-sticks the scroll to the bottom as each of a message's images finishes loading (PRD 14.1), if the user was already there. */
function stickOnImageLoad(el: HTMLElement, tab: ChatTab): void {
    el.querySelectorAll<HTMLImageElement>(".msg-image").forEach((img) => {
        img.addEventListener("load", () => {
            // Read NOW, not at render time: the user may have scrolled away since (PRD 18.12).
            if (tab.followBottom) stickToBottom(tab);
        });
    });
}

/** Builds a channel message's DOM element without appending it or touching
 *  scroll state — shared by the forward-append path (`renderChatMessage`)
 *  and the backward-prepend path (`prependOlderMessages`, PRD 14.2). */
function buildChatMessageElement(tab: ChatTab, msg: ChatMessage): HTMLDivElement {
    const el = buildMessageShell({
        kind: "channel",
        id: msg.id,
        ownerId: msg.userId,
        nickname: msg.nickname,
        avatarUrl: msg.avatarUrl,
        createdAt: msg.createdAt,
        content: msg.content,
        edited: !!msg.editedAt,
        replyTo: msg.replyTo,
        tabId: tab.channelId,
    });
    if (replyTargets.get(tab.channelId)?.messageId === msg.id) el.classList.add("msg-reply-target");

    // NSFW channels blur every image thumbnail (PRD 13.5; optional, PRD 16.2) —
    // only the full-screen viewer, opened by clicking through, shows it clearly.
    const channelNode = findChannelNodeById(currentTree, tab.channelId);
    const attachmentsEl = buildAttachmentsElement(
        getMessageAttachments(msg),
        { senderNickname: msg.nickname, sentAt: msg.createdAt },
        !!channelNode?.isNsfw,
    );
    if (attachmentsEl) el.appendChild(attachmentsEl);

    // Reaction bar
    el.appendChild(buildReactionBar(msg.id, false, msg.reactions));

    // Floating action toolbar (PRD 16.5). Insertion order is React, Edit,
    // Pin, Delete — see buildMessageActions().
    const toolbar = buildMessageActions(msg.id, false, msg.userId, msg.nickname, tab.channelId);
    attachEditButton(toolbar, msg, el);
    attachPinButton(toolbar, msg, tab);
    el.appendChild(toolbar);

    // Persistent pin marker, since the toolbar's own pin button is only
    // visible on hover. tab.pinnedMessageId is set before history renders.
    const pinIndicator = document.createElement("span");
    pinIndicator.className = "msg-pin-indicator";
    pinIndicator.setAttribute("aria-hidden", "true");
    pinIndicator.innerHTML = PIN_ICON_SVG;
    el.appendChild(pinIndicator);
    el.classList.toggle("is-pinned", tab.pinnedMessageId === msg.id);

    return el;
}

/**
 * Appends a message below everything rendered. `stick: false` (PRD 17.8) is
 * for content that is NOT the live bottom of the conversation — a jump
 * window, a page of newer history — where following the bottom (now, or
 * later when images/previews load) would yank the view off what the user is
 * looking at. That was the pinned-jump bug: rendering into the just-emptied
 * list counted as "at the bottom" for every message.
 */
function renderChatMessage(tab: ChatTab, msg: ChatMessage, opts: { stick?: boolean } = {}): void {
    const wasNearBottom = opts.stick === false ? false : isNearBottom(tab.messagesEl);

    maybeInsertDateDivider(tab, new Date(msg.createdAt));
    const el = buildChatMessageElement(tab, msg);
    tab.bottomSentinelEl.insertAdjacentElement("beforebegin", el);
    applyGrouping(el); // after insertion: needs the previous sibling (PRD 16.6)
    trackOldestOnFirstAppend(tab, msg.createdAt);
    tab.newestLoadedTimestamp = msg.createdAt; // appends are always the newest (PRD 17.8)

    if (wasNearBottom) stickToBottom(tab);

    // An attachment's image finishes decoding/laying out asynchronously,
    // after this synchronous scroll-to-bottom already ran against a
    // shorter `scrollHeight` — without this, a history with several images
    // ends up visually short of the true bottom (PRD 14.1). Only re-stick
    // if the user was already at the bottom when this message arrived —
    // never yank someone reading older history.
    stickOnImageLoad(el, tab);

    // Long-message truncation (Phase 12 sub-phase item 5) — must run after
    // appendChild, since scrollHeight/clientHeight need the element to
    // actually be laid out in the DOM.
    if (msg.content) {
        const textEl = el.querySelector(".msg-text") as HTMLElement | null;
        if (textEl) attachMessageTruncation(el, textEl);
    }

    // Async link preview injection
    if (msg.content) {
        const url = extractFirstUrl(msg.content);
        if (url) {
            injectLinkPreview(el, url, () => {
                // Read when the card lands, not when the message rendered (PRD 18.12).
                if (tab.followBottom) stickToBottom(tab);
            });
        }
    }
}

/**
 * Prepends an older page (ascending order, as returned by the server) above
 * whatever is currently the oldest-rendered content, immediately after the
 * tab's permanent top sentinel (PRD 14.2). Never touches scroll position
 * itself — the caller (`loadOlderMessages`) applies the anchor-preserving
 * correction once for the whole batch.
 */
function prependOlderMessages(tab: ChatTab, messages: ChatMessage[] | DirectMessage[], isDm: boolean): void {
    if (messages.length === 0) return;

    // The divider currently sitting right after the sentinel (if any) marks
    // a boundary against "nothing older was loaded yet" — no longer valid
    // now that even-older content is about to be inserted above it. It gets
    // recomputed correctly below instead.
    const staleLeadingDivider = tab.topSentinelEl.nextElementSibling;
    if (staleLeadingDivider?.classList.contains("date-separator")) {
        staleLeadingDivider.remove();
    }

    // Compute each entry's divider need in forward (chronological) order,
    // seeded from the day of whatever was previously the oldest-rendered
    // message, then physically insert in reverse — each insertion goes
    // immediately after the sentinel, so the last-inserted (oldest) entry
    // ends up first, restoring correct ascending DOM order overall.
    let previousDayKey = tab.oldestRenderedDateKey;
    const entries = messages.map((msg) => {
        const dayKey = computeDayKey(new Date(msg.createdAt));
        const needsDivider = dayKey !== previousDayKey;
        previousDayKey = dayKey;
        return { msg, dayKey, needsDivider };
    });

    for (let i = entries.length - 1; i >= 0; i--) {
        const { msg, dayKey, needsDivider } = entries[i];
        const el = isDm
            ? buildDmMessageElement(tab, msg as DirectMessage)
            : buildChatMessageElement(tab, msg as ChatMessage);
        tab.topSentinelEl.insertAdjacentElement("afterend", el);

        if (msg.content) {
            const textEl = el.querySelector(".msg-text") as HTMLElement | null;
            if (textEl) attachMessageTruncation(el, textEl);
        }
        if (msg.content) {
            const url = extractFirstUrl(msg.content);
            // No onLoaded callback — a historical message revealed above
            // the fold has no reason to ever force a scroll correction.
            if (url) injectLinkPreview(el, url);
        }

        if (needsDivider) {
            const divider = document.createElement("div");
            divider.className = "date-separator";
            divider.innerHTML = `<span>${escapeHtml(formatDateSectionLabel(new Date(msg.createdAt)))}</span>`;
            tab.topSentinelEl.insertAdjacentElement("afterend", divider);
        }
    }

    // Group the whole prepended page in forward order, then keep cascading
    // into the previously-first message: it may now continue the page's last
    // message (or a former group head may now be a continuation) (PRD 16.6).
    regroupFrom(tab.topSentinelEl.nextElementSibling);

    tab.oldestRenderedDateKey = entries[0].dayKey;
    tab.oldestLoadedTimestamp = messages[0].createdAt;
}

/**
 * Clamps a long message to a few lines with a "See more"/"See less"
 * toggle. Deliberately not persisted anywhere — expand state lives only in
 * the DOM classes set here, so a message re-render (switching channels
 * away and back, which rebuilds the tab's message list from scratch) or an
 * app restart already resets it with no extra work. The one case that
 * *wouldn't* reset on its own — the window staying alive and the DOM
 * untouched while just minimized/hidden — is handled separately by
 * `collapseAllExpandedMessages()` below, wired to the "window-minimized"
 * push from main.ts.
 */
/** A message collapses only when its text is taller than this many rendered
 *  lines (PRD 17.7); a collapsed one still shows 4 (the clamp in index.html). */
const COLLAPSE_THRESHOLD_LINES = 15;

function attachMessageTruncation(el: HTMLDivElement, textEl: HTMLElement): void {
    // A solo-emoji message (PRD 13.14) is a single character rendered at
    // ~4x size — never actually multi-line content to truncate, just
    // visually tall. Clamping it would false-positive "overflow" purely
    // from that height, with no hidden text to reveal via "See more".
    if (textEl.classList.contains("msg-text-solo-emoji")) return;

    // A message rendered into a hidden (display: none) tab measures 0, so it
    // could never be collapsed. Defer: switchTab() measures it once the tab
    // is shown (PRD 17.7).
    if (!textEl.isConnected || textEl.offsetParent === null) {
        el.dataset.truncationPending = "1";
        return;
    }
    delete el.dataset.truncationPending;

    // Measure the NATURAL height (no clamp) against the threshold — the
    // threshold (15 lines) and the collapsed size (4 lines) are independent.
    // getBoundingClientRect, not scrollHeight: a plain single-paragraph
    // message is an inline <span>, whose box spans all its wrapped lines but
    // whose scrollHeight is 0. "Lines" are rendered lines, so one long
    // wrapped paragraph counts by how tall it actually is.
    textEl.classList.remove("msg-text-clamped", "msg-text-expanded");
    const lineHeight = parseFloat(getComputedStyle(textEl).lineHeight) || 18;
    if (textEl.getBoundingClientRect().height <= lineHeight * COLLAPSE_THRESHOLD_LINES + 2) {
        return; // short enough: shown in full, no "See more"
    }
    textEl.classList.add("msg-text-clamped");

    const btnSeeMore = document.createElement("button");
    btnSeeMore.className = "btn-see-more";
    btnSeeMore.textContent = "See more";
    btnSeeMore.addEventListener("click", () => {
        const expanded = textEl.classList.toggle("msg-text-expanded");
        textEl.classList.toggle("msg-text-clamped", !expanded);
        btnSeeMore.textContent = expanded ? "See less" : "See more";
    });
    // Insert directly under this message's own content, above its reaction
    // bar — appendChild would land it after the reaction bar in DOM order,
    // reading visually as if it belonged to the message below (PRD 13.8).
    const reactBar = el.querySelector(".msg-reactions");
    if (reactBar) {
        el.insertBefore(btnSeeMore, reactBar);
    } else {
        el.appendChild(btnSeeMore);
    }
}

function collapseAllExpandedMessages(): void {
    document.querySelectorAll<HTMLElement>(".msg-text-expanded").forEach((textEl) => {
        textEl.classList.remove("msg-text-expanded");
        textEl.classList.add("msg-text-clamped");
        const btn = textEl.parentElement?.querySelector(".btn-see-more");
        if (btn) btn.textContent = "See more";
    });
}

api.on("window-minimized", collapseAllExpandedMessages);

// ── Chat Input ────────────────────────────────────────────────────────────

/** Grows the chat box with its content (up to the CSS max-height, then it
 *  scrolls) and shrinks it back when emptied. */
function autosizeChatInput(): void {
    chatInput.style.height = "auto";
    // scrollHeight excludes the border, but the box is border-box — add it
    // back or the content ends up 2px short and a scrollbar sliver appears.
    const border = chatInput.offsetHeight - chatInput.clientHeight;
    chatInput.style.height = `${chatInput.scrollHeight + border}px`;
}

chatInput.addEventListener("input", autosizeChatInput);

async function sendChatMessage(): Promise<void> {
    const content = chatInput.value.trim();
    if (activeTabId === "server-log") return;

    // Never send while images are still uploading or have failed (PRD 16.10).
    if (pendingAttachments.some((a) => a.status === "uploading")) {
        showToast("Waiting for images to finish uploading…");
        return;
    }
    if (pendingAttachments.some((a) => a.status === "failed")) {
        showToast("Remove or retry the failed image first");
        return;
    }
    if (!content && pendingAttachments.length === 0) return;
    closeEmojiAutocomplete();

    chatInput.value = "";
    autosizeChatInput();

    // Reply mode (PRD 16.11): the draft's target travels with the message and
    // the bar clears at once, like the tray; a failed send puts it back.
    const replyTabId = activeTabId;
    const reply = replyTargets.get(replyTabId);
    if (reply) {
        replyTargets.delete(replyTabId);
        syncReplyHighlight(replyTabId);
        renderReplyBar();
    }

    // Clear the tray right away (as before) but keep the batch — and its
    // local preview URLs — alive: they are only released once the send has
    // actually succeeded, so a failed send can put the images back.
    const batch = pendingAttachments;
    pendingAttachments = [];
    renderAttachmentTray();
    const attachments = batch.map((a) => ({ uploadId: a.uploadId, url: a.url, publicId: a.publicId }) as UploadResult);

    let result: { success: boolean; error?: string };
    if (activeTabId.startsWith("dm:")) {
        // DM tab — send direct message
        const recipientId = activeTabId.slice(3);
        result = await api.sendDirectMessage(recipientId, content, attachments, reply?.messageId);
        if (!result.success) {
            log(`Failed to send DM: ${result.error ?? "Unknown error"}`, "error");
        }
    } else {
        // Channel tab — send channel message
        const channelId = activeTabId;
        result = await api.sendMessage(channelId, content, attachments, reply?.messageId);
        if (!result.success) {
            log(`Failed to send message${result.error ? `: ${result.error}` : ""}`, "error");
        }
    }

    if (result.success) {
        for (const a of batch) URL.revokeObjectURL(a.objectUrl);
    } else {
        restoreFailedBatch(batch, result.error);
        // Put the reply draft back too, unless the user already started another there.
        if (reply && !replyTargets.has(replyTabId)) {
            replyTargets.set(replyTabId, reply);
            syncReplyHighlight(replyTabId);
            if (activeTabId === replyTabId) renderReplyBar();
        }
    }
}

/**
 * A send failed after its images were taken out of the tray (PRD 16.10).
 * "No longer available" means the server could not claim one of the uploads
 * (swept after 24h, or already used): that whole send was rolled back, so free
 * the still-good uploads and put every card back as FAILED — Retry re-uploads
 * the same file. Any other error leaves the uploads valid, so the cards come
 * back ready to resend. If the user has already picked new images meanwhile,
 * the old batch is dropped (and its uploads discarded) rather than merged.
 */
function restoreFailedBatch(batch: PendingAttachment[], error?: string): void {
    if (batch.length === 0) return;

    if (/no longer available/i.test(error ?? "")) {
        for (const a of batch) {
            discardUpload(a.uploadId);
            a.uploadId = a.url = a.publicId = undefined;
            a.status = "failed";
            a.started = true;
            a.error = "Upload expired — retry to upload it again";
        }
    }

    if (pendingAttachments.length === 0) {
        pendingAttachments = batch;
        renderAttachmentTray();
    } else {
        for (const a of batch) {
            URL.revokeObjectURL(a.objectUrl);
            discardUpload(a.uploadId);
        }
    }
}

btnSend.addEventListener("click", () => sendChatMessage());

chatInput.addEventListener("keydown", (e) => {
    // The emoji autocomplete gets first refusal: while its card is open,
    // Enter/Tab select instead of sending (PRD 16.7).
    if (handleEmojiAutocompleteKeydown(e)) return;

    // Escape cancels reply mode (PRD 16.11). It only gets here when the
    // emoji autocomplete did NOT consume it, so an open card closes first.
    if (e.key === "Escape" && !e.isComposing && replyTargets.has(activeTabId)) {
        e.preventDefault();
        cancelReply(activeTabId);
        return;
    }

    // Enter sends, Shift+Enter inserts a newline; ignore the Enter that
    // confirms an IME composition.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendChatMessage();
    }
});

// ── Emoji Autocomplete (PRD 16.7) ───────────────────────────────────────────
// Typing ":" + a letter opens a card above the colon listing matching emoji
// (custom and Unicode). Enter/Tab/click select; Unicode emoji insert as the
// character itself (only custom :name: text renders as an emoji), custom emoji
// insert as `:name:`. Typing the closing ":" of a fully-known Unicode name
// (":red_heart:") converts it in place.

const EMOJI_AC_MAX_RESULTS = 10;
// The colon must start the text or follow whitespace/an opening bracket or
// quote, so "http://x", "10:30" and "a:b" never trigger. The first char after
// it must be a letter.
const EMOJI_AC_OPEN_RE = /(?:^|[\s([{"'])(:([a-zA-Z][a-zA-Z0-9_+-]{0,31}))$/;
const EMOJI_AC_CLOSED_RE = /(?:^|[\s([{"'])(:([a-zA-Z][a-zA-Z0-9_+-]{1,31}):)$/;

interface UnicodeEmojiIndexEntry {
    emoji: string;
    name: string; // snake_case, no colons
    words: string[];
    keywords: string[];
}
let unicodeEmojiIndex: UnicodeEmojiIndexEntry[] | null = null;
let unicodeEmojiBySnake: Map<string, string> | null = null;

/** Built once, lazily — the Unicode dataset never changes at runtime. */
function getUnicodeEmojiIndex(): UnicodeEmojiIndexEntry[] {
    if (!unicodeEmojiIndex) {
        unicodeEmojiIndex = EMOJI_DATA.map((e) => {
            const name = toEmojiSnakeName(e.name);
            return { emoji: e.emoji, name, words: name.split("_"), keywords: e.keywords.map((k) => k.toLowerCase()) };
        });
        unicodeEmojiBySnake = new Map();
        for (const e of unicodeEmojiIndex) {
            if (!unicodeEmojiBySnake.has(e.name)) unicodeEmojiBySnake.set(e.name, e.emoji);
        }
    }
    return unicodeEmojiIndex;
}

/**
 * Ranked search: name prefix, then a name word's prefix, then a keyword
 * prefix (how ":laug" finds 🤣 via its "laugh" keyword), then name substring.
 * Ties: custom emoji first (server-specific, hard to discover otherwise),
 * then shorter names. Custom list is read live — it can change at runtime.
 */
function searchEmojiForAutocomplete(rawQuery: string): EmojiAcItem[] {
    const q = rawQuery.toLowerCase();
    const scored: { item: EmojiAcItem; rank: number; custom: boolean; len: number }[] = [];

    for (const ce of customEmojis) {
        const name = ce.name.toLowerCase();
        let rank = -1;
        if (name.startsWith(q)) rank = 0;
        else if (name.split("_").some((w) => w.startsWith(q))) rank = 1;
        else if (name.includes(q)) rank = 3;
        if (rank >= 0) {
            scored.push({ item: { insert: `:${ce.name}:`, label: `:${ce.name}:`, imageUrl: ce.imageUrl }, rank, custom: true, len: name.length });
        }
    }

    for (const e of getUnicodeEmojiIndex()) {
        let rank = -1;
        if (e.name.startsWith(q)) rank = 0;
        else if (e.words.some((w) => w.startsWith(q))) rank = 1;
        else if (e.keywords.some((k) => k.startsWith(q))) rank = 2;
        else if (e.name.includes(q)) rank = 3;
        if (rank >= 0) {
            scored.push({ item: { insert: e.emoji, label: `:${e.name}:`, emoji: e.emoji }, rank, custom: false, len: e.name.length });
        }
    }

    scored.sort((a, b) => a.rank - b.rank || Number(b.custom) - Number(a.custom) || a.len - b.len);
    return scored.slice(0, EMOJI_AC_MAX_RESULTS).map((s) => s.item);
}

const EMOJI_AC_MIRROR_PROPS = [
    "direction", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontStyle", "fontVariant", "fontWeight",
    "fontStretch", "fontSize", "fontSizeAdjust", "lineHeight", "fontFamily", "textAlign", "textTransform",
    "textIndent", "letterSpacing", "wordSpacing", "tabSize",
] as const;

/**
 * Viewport coordinates of the character at `index` inside a <textarea>, via
 * the standard "mirror div" technique: an off-screen div with identical text
 * metrics and wrapping, with a marker span at the index. A local helper
 * rather than a dependency — the renderer has no bundler.
 */
function getTextareaCharCoords(ta: HTMLTextAreaElement, index: number): { left: number; top: number } {
    const cs = getComputedStyle(ta);
    const mirror = document.createElement("div");
    const ms = mirror.style;
    for (const prop of EMOJI_AC_MIRROR_PROPS) {
        (ms as unknown as Record<string, string>)[prop] = cs[prop] as string;
    }
    ms.position = "absolute";
    ms.visibility = "hidden";
    ms.top = "0";
    ms.left = "-9999px";
    ms.overflow = "hidden";
    ms.whiteSpace = "pre-wrap";
    ms.wordWrap = "break-word";
    ms.boxSizing = "border-box";
    // clientWidth excludes a scrollbar (which narrows the textarea's text
    // area) and the borders; add the borders back for border-box.
    ms.width = `${ta.clientWidth + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)}px`;

    mirror.textContent = ta.value.substring(0, index);
    const marker = document.createElement("span");
    marker.textContent = ta.value.substring(index) || ".";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);

    const left = marker.offsetLeft + parseFloat(cs.borderLeftWidth);
    const top = marker.offsetTop + parseFloat(cs.borderTopWidth);
    mirror.remove();

    const rect = ta.getBoundingClientRect();
    return { left: rect.left + left - ta.scrollLeft, top: rect.top + top - ta.scrollTop };
}

function renderEmojiAutocomplete(): void {
    emojiAcHeader.textContent = `Emoji matching :${emojiAcQuery}`;
    emojiAcList.textContent = "";
    emojiAcItems.forEach((item, i) => {
        const row = document.createElement("div");
        row.className = "emoji-ac-item" + (i === emojiAcActive ? " active" : "");
        row.id = `emoji-ac-item-${i}`;
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(i === emojiAcActive));

        const glyph = document.createElement("span");
        glyph.className = "emoji-ac-glyph";
        if (item.imageUrl) {
            const img = document.createElement("img");
            img.src = item.imageUrl;
            img.alt = item.label;
            glyph.appendChild(img);
        } else {
            glyph.textContent = item.emoji ?? "";
        }
        const name = document.createElement("span");
        name.className = "emoji-ac-name";
        name.textContent = item.label;
        row.append(glyph, name);

        // mousedown must not steal focus from the textarea (it would blur +
        // close the card before the click lands).
        row.addEventListener("mousedown", (e) => e.preventDefault());
        row.addEventListener("mouseenter", () => setEmojiAutocompleteActive(i, false));
        row.addEventListener("click", () => selectEmojiAutocompleteItem(i));
        emojiAcList.appendChild(row);
    });
    acTarget().setAttribute("aria-activedescendant", `emoji-ac-item-${emojiAcActive}`);
}

function setEmojiAutocompleteActive(index: number, scroll: boolean): void {
    if (index === emojiAcActive) return;
    emojiAcActive = index;
    emojiAcList.querySelectorAll(".emoji-ac-item").forEach((el, i) => {
        el.classList.toggle("active", i === index);
        el.setAttribute("aria-selected", String(i === index));
    });
    acTarget().setAttribute("aria-activedescendant", `emoji-ac-item-${index}`);
    if (scroll) emojiAcList.children[index]?.scrollIntoView({ block: "nearest" });
}

/** Opens the card above the colon, kept fully inside the window. */
function positionEmojiAutocomplete(): void {
    const target = acTarget();
    const colon = getTextareaCharCoords(target, emojiAcColonIndex);
    const margin = 8;
    const lineHeight = parseFloat(getComputedStyle(target).lineHeight) || 18;

    // It opens upward (the composer sits at the bottom of the window). An
    // edit box near the top of the message list may have no room above, so
    // then it opens BELOW the caret's line instead (PRD 17.11); for the
    // composer that never happens. In a tiny window the card shrinks rather
    // than leave the screen.
    const roomAbove = colon.top - 6 - margin;
    const below = roomAbove < 120;
    const belowTop = colon.top + lineHeight + 6;
    const room = below ? window.innerHeight - belowTop - margin : roomAbove;
    emojiAutocompleteEl.style.maxHeight = `${Math.max(120, Math.min(320, room))}px`;

    const width = emojiAutocompleteEl.offsetWidth;
    const height = emojiAutocompleteEl.offsetHeight;
    const left = Math.max(margin, Math.min(colon.left, window.innerWidth - width - margin));
    const top = below
        ? Math.min(belowTop, window.innerHeight - height - margin)
        : Math.max(margin, colon.top - 6 - height);
    emojiAutocompleteEl.style.left = `${left}px`;
    emojiAutocompleteEl.style.top = `${top}px`;
}

function closeEmojiAutocomplete(): void {
    if (!emojiAcOpen) return;
    emojiAcOpen = false;
    emojiAcItems = [];
    emojiAutocompleteEl.classList.remove("visible");
    acTarget().setAttribute("aria-expanded", "false");
    acTarget().removeAttribute("aria-activedescendant");
}

/** Re-evaluates the text before the caret: open, refresh or close the card. */
function updateEmojiAutocomplete(): void {
    if (acTarget().selectionStart !== acTarget().selectionEnd) {
        closeEmojiAutocomplete();
        return;
    }
    const caret = acTarget().selectionStart ?? acTarget().value.length;
    const match = EMOJI_AC_OPEN_RE.exec(acTarget().value.slice(0, caret));
    if (!match) {
        closeEmojiAutocomplete();
        return;
    }

    // Group 1 is ":query" (colon included), group 2 is just "query".
    const query = match[2];
    const items = searchEmojiForAutocomplete(query);
    if (items.length === 0) {
        closeEmojiAutocomplete();
        return;
    }

    const colonIndex = caret - match[1].length;
    const queryChanged = !emojiAcOpen || query !== emojiAcQuery || colonIndex !== emojiAcColonIndex;
    emojiAcColonIndex = colonIndex;
    emojiAcQuery = query;
    emojiAcItems = items;
    if (queryChanged) emojiAcActive = 0;

    if (!emojiAcOpen) {
        // Only one emoji surface at a time (the picker in reaction mode is a
        // different flow, but it never coexists with typing anyway).
        if (emojiPicker.classList.contains("visible")) closeEmojiPicker();
        emojiAcOpen = true;
        acTarget().setAttribute("aria-expanded", "true");
        acTarget().setAttribute("aria-controls", "emoji-autocomplete");
    }
    renderEmojiAutocomplete();
    emojiAutocompleteEl.classList.add("visible");
    positionEmojiAutocomplete();
}

/** Replaces the typed ":query" with the chosen emoji (plus a trailing space). */
function selectEmojiAutocompleteItem(index: number): void {
    const item = emojiAcItems[index];
    if (!item) return;
    const caret = acTarget().selectionStart ?? acTarget().value.length;
    const nextChar = acTarget().value.charAt(caret);
    const suffix = nextChar === "" || !/\s/.test(nextChar) ? " " : "";
    acTarget().setRangeText(item.insert + suffix, emojiAcColonIndex, caret, "end");
    closeEmojiAutocomplete();
    emojiAcAfterInsert?.();
    acTarget().focus();
}

/**
 * Typing the closing ":" of a complete Unicode name (":red_heart:") swaps it
 * for the emoji character in place. Custom names are left as typed — they
 * already render from `:name:` text. Returns true when it converted.
 */
function convertClosedEmojiShortcode(): boolean {
    const caret = acTarget().selectionStart ?? acTarget().value.length;
    const match = EMOJI_AC_CLOSED_RE.exec(acTarget().value.slice(0, caret));
    if (!match) return false;
    getUnicodeEmojiIndex();
    // Group 1 is ":name:" (both colons), group 2 is just "name".
    const emoji = unicodeEmojiBySnake?.get(match[2].toLowerCase());
    if (!emoji) return false;
    acTarget().setRangeText(emoji, caret - match[1].length, caret, "end");
    emojiAcAfterInsert?.();
    return true;
}

/** Returns true when the key was consumed by the open card. */
function handleEmojiAutocompleteKeydown(e: KeyboardEvent): boolean {
    if (!emojiAcOpen || e.isComposing) return false;
    switch (e.key) {
        case "ArrowDown":
            e.preventDefault();
            setEmojiAutocompleteActive((emojiAcActive + 1) % emojiAcItems.length, true);
            return true;
        case "ArrowUp":
            e.preventDefault();
            setEmojiAutocompleteActive((emojiAcActive - 1 + emojiAcItems.length) % emojiAcItems.length, true);
            return true;
        case "Enter":
            if (e.shiftKey) {
                closeEmojiAutocomplete(); // Shift+Enter: plain newline, handled by the browser
                return false;
            }
            e.preventDefault(); // select — must NOT also send the message
            selectEmojiAutocompleteItem(emojiAcActive);
            return true;
        case "Tab":
            e.preventDefault();
            selectEmojiAutocompleteItem(emojiAcActive);
            return true;
        case "Escape":
            e.preventDefault();
            e.stopPropagation(); // closes only the card (PRD 16.11's reply cancel must not also fire)
            closeEmojiAutocomplete();
            return true;
        default:
            return false;
    }
}

/** The textarea the card serves (the composer unless another one has focus). */
function acTarget(): HTMLTextAreaElement {
    return emojiAcTarget ?? chatInput;
}

/**
 * Gives a textarea the emoji autocomplete (PRD 16.7; generalized for the edit
 * box in PRD 17.11). The card, search and keys are shared; the textarea
 * becomes the card's target when it gains focus. Its OWN keydown handler must
 * call handleEmojiAutocompleteKeydown(e) first and stop if it returns true.
 * Returns a function that detaches everything again.
 */
function attachEmojiAutocomplete(ta: HTMLTextAreaElement, opts: { onAfterInsert?: () => void } = {}): () => void {
    ta.setAttribute("aria-autocomplete", "list");
    ta.setAttribute("aria-expanded", "false");

    const claim = (): void => {
        if (emojiAcTarget !== ta) {
            if (emojiAcOpen) closeEmojiAutocomplete();
            emojiAcTarget = ta;
        }
        emojiAcAfterInsert = opts.onAfterInsert ?? null;
    };
    const onInput = (e: Event): void => {
        claim();
        if ((e as InputEvent).isComposing) return; // wait for the IME to commit
        if ((e as InputEvent).data === ":" && convertClosedEmojiShortcode()) {
            closeEmojiAutocomplete();
            return;
        }
        updateEmojiAutocomplete();
    };
    const onClick = (): void => {
        claim();
        updateEmojiAutocomplete();
    };
    // Caret moves that don't fire "input": clicking, Home/End, and Left/Right
    // (Up/Down/Enter/Tab/Escape are consumed by the card itself while it's open).
    const onKeyup = (e: KeyboardEvent): void => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
            claim();
            updateEmojiAutocomplete();
        }
    };
    const onBlur = (): void => {
        if (emojiAcTarget === ta) closeEmojiAutocomplete();
    };
    // A textarea inside the message list moves when the list scrolls.
    const scroller = ta.closest(".chat-messages");
    const onScroll = (): void => {
        if (emojiAcTarget === ta) closeEmojiAutocomplete();
    };

    ta.addEventListener("focus", claim);
    ta.addEventListener("input", onInput);
    ta.addEventListener("click", onClick);
    ta.addEventListener("keyup", onKeyup);
    ta.addEventListener("blur", onBlur);
    scroller?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
        ta.removeEventListener("focus", claim);
        ta.removeEventListener("input", onInput);
        ta.removeEventListener("click", onClick);
        ta.removeEventListener("keyup", onKeyup);
        ta.removeEventListener("blur", onBlur);
        scroller?.removeEventListener("scroll", onScroll);
        if (emojiAcTarget === ta) {
            closeEmojiAutocomplete();
            emojiAcTarget = null;
            emojiAcAfterInsert = null;
        }
    };
}

// Grabbing the card's scrollbar (or its header) must not blur the textarea,
// which would close the card mid-interaction.
emojiAutocompleteEl.addEventListener("mousedown", (e) => e.preventDefault());

// The composer: unchanged behavior, it just goes through the shared wiring now.
attachEmojiAutocomplete(chatInput, { onAfterInsert: autosizeChatInput });
window.addEventListener("resize", () => {
    if (emojiAcOpen) positionEmojiAutocomplete();
});

// ── Server Log Tab Click ──────────────────────────────────────────────────

const serverLogTab = tabBar.querySelector('.tab[data-tab-id="server-log"]');
serverLogTab?.addEventListener("click", () => switchTab("server-log"));

// ── Message Event Listener ────────────────────────────────────────────────

api.on("message", (msg: ChatMessage) => {
    const tab = chatTabs.get(msg.channelId);
    if (tab) {
        if (tab.atTrueLatest) {
            renderChatMessage(tab, msg);
        } else if (msg.userId === api.getInstanceId()) {
            // You sent it while reading older history: go to the present so
            // you see it (PRD 17.8), as other chat apps do.
            rebuildTabAtLatest(tab).then(() => {
                stickToBottom(tab);
            });
        }
        // Otherwise the tab shows a detached window (after a jump): rendering
        // it now would leave an invisible gap of unloaded messages before it.
        // Forward pagination reaches it, and "Jump to Most Recent" stays up
        // (PRD 17.8). Unread tracking below doesn't depend on rendering.
    }

    // Unread indicator (PRD 4.13): MESSAGE_RECEIVED already broadcasts to
    // everyone in the server regardless of which tab is open, so this can
    // be tracked entirely client-side — no extra server round trip.
    // Your own messages are never counted (PRD 19 B1). A message counts when
    // its channel is not the active tab OR the window is not focused (PRD 19
    // B3, the DM rule); markChannelTabRead() then clears it at once when you
    // really are looking at it.
    if (msg.userId !== api.getInstanceId()) {
        if (msg.channelId !== activeTabId || !document.hasFocus()) markChannelUnread(msg.channelId);
        const viewed = chatTabs.get(msg.channelId);
        if (viewed) markChannelTabRead(viewed);
    }
});

/** Flags a channel-tree row as unread without a full tree re-render (which would lose collapsed-category state). */
function markChannelUnread(channelId: string): void {
    bumpCount(unreadChannelCounts, channelId); // PRD 19 B1: counts every message
    refreshTabUnread(channelId); // an open, unfocused tab shows it too (PRD 17.6)
    if (isChannelMuted(channelId)) return; // still tracked, just not painted (PRD 16.4)

    const el = channelTree.querySelector(`.tree-channel[data-channel-id="${CSS.escape(channelId)}"]`);
    if (!el) return;
    el.classList.add("unread");
    setUnreadPill(el, channelUnread(channelId), "unread-count", ".ch-name");
}

function findTreeNode(nodes: TreeNode[], channelId: string): TreeNode | null {
    for (const n of nodes) {
        if (n.id === channelId) return n;
        const found = findTreeNode(n.children, channelId);
        if (found) return found;
    }
    return null;
}

/**
 * Marks a channel read only when it is really being looked at (PRD 19 B3, the
 * DM rule of PRD 18.13): its tab is active, the window has focus and its page
 * has rendered. The ONE entry point for every view path (tab switch, tree
 * click, window focus, history load, a message arriving).
 */
function markChannelTabRead(tab: ChatTab): void {
    if (tab.kind !== "channel") return;
    if (activeTabId !== tab.channelId || !document.hasFocus()) return;
    if (!tab.initialLoadDone) return;
    markChannelRead(tab.channelId);
}

/** Clears a channel's unread state locally and persists the read cursor server-side. */
function markChannelRead(channelId: string): void {
    // Clear the cached tree node's join-time hasUnread flag too — otherwise a
    // later renderTree(currentTree) call (e.g. re-rendering on voice channel
    // join/leave) re-seeds unreadChannelCounts from that stale flag (see line
    // ~1283) and the notification erroneously reappears after being read.
    const node = findTreeNode(currentTree, channelId);
    if (node) {
        node.hasUnread = false;
        node.unreadCount = undefined; // PRD 19 B1: a re-render must not re-seed it either
    }

    if (!hasChannelUnread(channelId)) return;
    unreadChannelCounts.delete(channelId);
    refreshTabUnread(channelId); // PRD 17.6

    const el = channelTree.querySelector(`.tree-channel[data-channel-id="${CSS.escape(channelId)}"]`);
    el?.classList.remove("unread");
    el?.querySelector(".unread-count")?.remove();

    api.markChannelRead(channelId);
}

// ── DM Event Listener ─────────────────────────────────────────────────────

/** Builds a DM's DOM element without appending it or touching scroll state —
 *  shared by the forward-append path (`renderDmMessage`) and the
 *  backward-prepend path (`prependOlderMessages`, PRD 14.2). Note: DMs have
 *  gets the same long-message collapse as channel messages (PRD 18.13) —
 *  attached by the render/prepend paths, which measure after insertion. */
function buildDmMessageElement(tab: ChatTab, msg: DirectMessage): HTMLDivElement {
    const el = buildMessageShell({
        kind: "dm",
        id: msg.id,
        ownerId: msg.senderId,
        nickname: msg.senderNickname,
        avatarUrl: msg.senderAvatarUrl,
        createdAt: msg.createdAt,
        content: msg.content,
        replyTo: msg.replyTo,
        tabId: tab.channelId,
    });
    if (replyTargets.get(tab.channelId)?.messageId === msg.id) el.classList.add("msg-reply-target");

    const attachmentsEl = buildAttachmentsElement(
        getMessageAttachments(msg),
        { senderNickname: msg.senderNickname, sentAt: msg.createdAt },
        false, // DM images are never blurred
    );
    if (attachmentsEl) el.appendChild(attachmentsEl);

    // Reaction bar
    el.appendChild(buildReactionBar(msg.id, true, msg.reactions));
    el.appendChild(buildMessageActions(msg.id, true, msg.senderId, msg.senderNickname, tab.channelId));

    return el;
}

/** DM counterpart of renderChatMessage() — same `stick` option (PRD 17.8). */
function renderDmMessage(tab: ChatTab, msg: DirectMessage, opts: { stick?: boolean } = {}): void {
    const wasNearBottom = opts.stick === false ? false : isNearBottom(tab.messagesEl);

    maybeInsertDateDivider(tab, new Date(msg.createdAt));
    const el = buildDmMessageElement(tab, msg);
    tab.bottomSentinelEl.insertAdjacentElement("beforebegin", el);
    applyGrouping(el); // after insertion: needs the previous sibling (PRD 16.6)
    trackOldestOnFirstAppend(tab, msg.createdAt);
    tab.newestLoadedTimestamp = msg.createdAt; // appends are always the newest (PRD 17.8)

    if (wasNearBottom) stickToBottom(tab);

    stickOnImageLoad(el, tab);

    // Long-message collapse, same as channel messages (PRD 18.13). Must run
    // after insertion: it measures. A hidden tab defers to switchTab().
    if (msg.content) {
        const textEl = el.querySelector(".msg-text") as HTMLElement | null;
        if (textEl) attachMessageTruncation(el, textEl);
    }

    // Async link preview injection
    if (msg.content) {
        const url = extractFirstUrl(msg.content);
        if (url) {
            injectLinkPreview(el, url, () => {
                // Read when the card lands, not when the message rendered (PRD 18.12).
                if (tab.followBottom) stickToBottom(tab);
            });
        }
    }
}

api.on("dm-received", async (msg: DirectMessage) => {
    const myId = api.getInstanceId();
    // Determine who the DM partner is (the other user)
    const partnerId = msg.senderId === myId ? msg.receiverId : msg.senderId;
    const partnerNick = msg.senderNickname; // sender nickname for display purposes
    const tabKey = `dm:${partnerId}`;
    onDmMessageForSidebar(partnerId, msg, msg.senderId === myId); // PRD 19 C7

    // Captured before any auto-open side effect below (PRD 14.4) — when the
    // tab doesn't exist yet, openDmTab() calls switchTab() synchronously,
    // which flips activeTabId to this tab *before* the old code below ever
    // checked it. That made a brand-new/reopened DM conversation always
    // read as "already active" even when the user was looking at something
    // else entirely — the actual root cause of the sound alert's reported
    // intermittency (it only ever failed for this specific combination:
    // auto-opened tab + window still focused elsewhere).
    const wasTabActive = activeTabId === tabKey;

    const tab = chatTabs.get(tabKey);
    if (tab) {
        // Same detached-window rules as channel messages (PRD 17.8).
        if (tab.atTrueLatest) {
            renderDmMessage(tab, msg);
        } else if (msg.senderId === myId) {
            rebuildTabAtLatest(tab).then(() => {
                stickToBottom(tab);
            });
        }
        // A message from the partner is unread until you're really looking at
        // this tab (PRD 18.13); markDmTabRead() clears it at once if you are.
        if (msg.senderId !== myId) {
            bumpCount(unreadDmCounts, partnerId);
            refreshTabUnread(tabKey);
            markDmTabRead(tab);
        }
    } else {
        // Auto-open a DM tab for incoming messages from others
        if (msg.senderId !== myId) {
            // Kept and unfocused (PRD 19 B4): it must not steal the view.
            openDmTab(partnerId, partnerNick, { mode: "kept", focus: false });
            // The tab's history will load via loadChatHistory, which includes this message
        }
    }

    // DM notification sound: play when message is from someone else AND
    // the DM tab was not already active OR the window is not focused
    if (msg.senderId !== myId) {
        const isFocused = await api.isWindowFocused();
        if (!wasTabActive || !isFocused) {
            SoundAlert.play("hey_wake_up.mp3");
        }
    }
});

// ── DM sidebar (PRD 19 C7) ───────────────────────────────────────────────────
// The rail's DM button swaps what #left-pane shows: the channel tree or this
// list of every member. The tree is hidden by a class, never rebuilt, so its
// DOM and collapsed state survive. Nothing opens until a person is clicked.

/** The two groups of the sidebar, each already in display order. Pure. */
function sortDmDirectory(entries: DmDirectoryEntry[]): { online: DmDirectoryEntry[]; offline: DmDirectoryEntry[] } {
    const order = (a: DmDirectoryEntry, b: DmDirectoryEntry): number => {
        const am = a.lastMessage ? Date.parse(a.lastMessage.at) : NaN;
        const bm = b.lastMessage ? Date.parse(b.lastMessage.at) : NaN;
        const aHas = Number.isFinite(am);
        const bHas = Number.isFinite(bm);
        if (aHas !== bHas) return aHas ? -1 : 1; // people you've messaged first
        if (aHas && bHas && am !== bm) return bm - am; // newest first
        return a.nickname.localeCompare(b.nickname);
    };
    const sorted = [...entries].sort(order);
    return { online: sorted.filter((e) => e.isOnline), offline: sorted.filter((e) => !e.isOnline) };
}

/** The one-line preview of a row's last message (plain text, never HTML). */
function dmPreviewText(entry: DmDirectoryEntry): string | null {
    const last = entry.lastMessage;
    if (!last) return null;
    const plain = api.markdownToPlainText(last.text ?? "").replace(/\s+/g, " ").trim();
    let body = plain || (last.hasAttachments ? "Image" : "");
    if (body.length > 80) body = body.slice(0, 79).trimEnd() + "…";
    return last.fromMe ? `You: ${body}` : body;
}

let dmDirectory: DmDirectoryEntry[] = [];
/** True when the server has no directory (v2.7.0): the list is the online-users answer, without previews. */
let dmDirectoryLegacy = false;
let dmDirectoryLoaded = false;
let dmDirectoryRequest = 0;
let dmDirectoryTimer: ReturnType<typeof setTimeout> | null = null;
let dmRenderQueued = false;
type SidebarMode = "servers" | "dms";
let sidebarMode: SidebarMode = "servers";

const railServersBtn = document.getElementById("rail-servers") as HTMLButtonElement;
const railDmsBtn = document.getElementById("rail-dms") as HTMLButtonElement;
const railDmBadge = document.getElementById("rail-dm-badge") as HTMLSpanElement;
const dmListBody = document.getElementById("dm-list-body") as HTMLDivElement;
const leftPaneEl = document.getElementById("left-pane") as HTMLDivElement;

function setSidebarMode(mode: SidebarMode): void {
    if (mode === "dms" && railDmsBtn.disabled) return;
    sidebarMode = mode;
    leftPaneEl.classList.toggle("show-dms", mode === "dms");
    railServersBtn.classList.toggle("active", mode === "servers");
    railDmsBtn.classList.toggle("active", mode === "dms");
    if (mode === "dms") {
        renderDmSidebar();
        void loadDmDirectory();
    }
}

/** Enabled only with a connection and server access (GET_DM_DIRECTORY is a member event). */
function updateDmRailState(): void {
    const usable = isConnected && hasServerAccess;
    railDmsBtn.disabled = !usable;
    railDmsBtn.title = !isConnected
        ? "Direct messages — connect to a server first"
        : !hasServerAccess
          ? ACCESS_BANNER_TEXT
          : "Direct messages";
    if (!usable && sidebarMode === "dms") setSidebarMode("servers");
    renderDmRailBadge();
}

/** Everything unread in DMs, except the conversation you are reading right now. */
function renderDmRailBadge(): void {
    let total = 0;
    const reading = document.hasFocus() && activeTabId.startsWith("dm:") ? activeTabId.slice(3) : null;
    for (const [partnerId, count] of unreadDmCounts) {
        if (partnerId === reading) continue;
        total += count < 0 ? 1 : count;
    }
    railDmBadge.textContent = total > 99 ? "99+" : String(total);
    railDmBadge.style.display = total > 0 && isConnected && hasServerAccess ? "" : "none";
}

/** Coalesces the many triggers (unread changes, tab switches, presence) into one render per frame. */
function scheduleDmSidebarRender(): void {
    if (dmRenderQueued) return;
    dmRenderQueued = true;
    requestAnimationFrame(() => {
        dmRenderQueued = false;
        renderDmSidebar();
    });
}

function renderDmSidebar(): void {
    renderDmRailBadge();
    const serverLabel = document.getElementById("dm-list-server");
    if (serverLabel) {
        const saved = activeSavedServerId ? savedServerById(activeSavedServerId) : undefined;
        const name = connectedServerName || saved?.name || "this server";
        serverLabel.textContent = `On ${name}`;
    }
    if (sidebarMode !== "dms") return;

    const myId = api.getInstanceId();
    const people = dmDirectory.filter((e) => e.userId !== myId);
    dmListBody.replaceChildren();

    if (dmDirectoryLegacy) {
        const note = document.createElement("div");
        note.className = "dm-legacy-note";
        note.textContent = "Message previews need a newer server.";
        dmListBody.appendChild(note);
    }
    if (!dmDirectoryLoaded) {
        const loading = document.createElement("div");
        loading.className = "dm-empty";
        loading.textContent = "Loading…";
        dmListBody.appendChild(loading);
        return;
    }
    if (people.length === 0) {
        const empty = document.createElement("div");
        empty.className = "dm-empty";
        empty.textContent = "No one else is on this server yet.";
        dmListBody.appendChild(empty);
        return;
    }

    const { online, offline } = sortDmDirectory(people);
    const addGroup = (title: string, note: string, list: DmDirectoryEntry[]): void => {
        if (list.length === 0) return;
        const head = document.createElement("div");
        head.className = "dm-group-head section-label";
        head.textContent = `${title} — ${list.length}`;
        const sub = document.createElement("div");
        sub.className = "dm-group-note";
        sub.textContent = note;
        dmListBody.append(head, sub);
        for (const entry of list) dmListBody.appendChild(buildDmRow(entry));
    };
    addGroup("Online", "Everyone on this server · message or nudge", online);
    addGroup("Offline", "Everyone on this server · they'll get your message when they sign in", offline);
}

function buildDmRow(entry: DmDirectoryEntry): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "dm-row" + (entry.isOnline ? "" : " is-offline");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.dataset.userId = entry.userId;
    if (activeTabId === `dm:${entry.userId}`) row.classList.add("is-active");

    row.appendChild(createAvatarElement(entry.userId, entry.nickname, 32));

    const main = document.createElement("div");
    main.className = "dm-row-main";
    const name = document.createElement("div");
    name.className = "dm-row-name";
    name.textContent = entry.nickname;
    const preview = document.createElement("div");
    const text = dmPreviewText(entry);
    preview.className = "dm-row-preview" + (text === null ? " is-empty" : "");
    preview.textContent = text ?? "No messages yet — start a conversation";
    main.append(name, preview);
    row.appendChild(main);

    const unread = dmUnread(entry.userId);
    if (hasDmUnread(entry.userId) && activeTabId !== `dm:${entry.userId}`) {
        const pill = document.createElement("span");
        pill.className = "count-pill";
        pill.textContent = unread > 99 ? "99+" : unread > 0 ? String(unread) : "•";
        row.appendChild(pill);
    }

    if (canNudge(entry.userId, entry.isOnline)) row.appendChild(buildNudgeButton(entry.userId, entry.nickname));

    const open = (): void => {
        if (!requireServerAccess()) return;
        openDmTab(entry.userId, entry.nickname, { mode: "preview", focus: true });
    };
    row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".btn-nudge")) return;
        open();
    });
    row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
        }
    });
    return row;
}

/** Fetches the directory (or, on an older server, the online-users list). */
async function loadDmDirectory(): Promise<void> {
    if (!isConnected || !hasServerAccess) return;
    const request = ++dmDirectoryRequest;
    let entries: DmDirectoryEntry[] | null = null;
    let legacy = false;
    const directory = await api.getDmDirectory();
    if (directory) {
        entries = directory;
    } else {
        const online = await api.getOnlineUsers();
        if (online.success && online.users) {
            legacy = true;
            entries = online.users.map((u) => ({
                userId: u.userId,
                nickname: u.nickname,
                avatarUrl: null,
                isOnline: u.isOnline,
                unreadCount: 0,
            }));
        }
    }
    // A newer request, a disconnect, or a lost access while waiting: drop this answer.
    if (request !== dmDirectoryRequest || !entries || !isConnected || !hasServerAccess) return;
    for (const e of entries) if (e.avatarUrl) avatarUrlCache.set(e.userId, e.avatarUrl);
    dmDirectory = entries;
    dmDirectoryLegacy = legacy;
    dmDirectoryLoaded = true;
    scheduleDmSidebarRender();
}

/** Someone came online or went offline: the dot moves at once, the directory is re-read after 2 s. */
function onDmPresenceChange(userId: string, online: boolean): void {
    const entry = dmDirectory.find((e) => e.userId === userId);
    if (entry) {
        entry.isOnline = online;
        scheduleDmSidebarRender();
    }
    if (dmDirectoryTimer) clearTimeout(dmDirectoryTimer);
    dmDirectoryTimer = setTimeout(() => {
        dmDirectoryTimer = null;
        void loadDmDirectory();
    }, 2000);
}

/** A DM arrived or was sent: the row's preview follows without a refetch. */
function onDmMessageForSidebar(partnerId: string, msg: DirectMessage, fromMe: boolean): void {
    const entry = dmDirectory.find((e) => e.userId === partnerId);
    if (!entry) {
        void loadDmDirectory(); // someone the list doesn't know yet
        return;
    }
    entry.lastMessage = {
        text: msg.content,
        hasAttachments: (msg.attachments?.length ?? 0) > 0 || !!msg.attachmentUrl,
        at: msg.createdAt,
        fromMe,
    };
    scheduleDmSidebarRender();
}

/** Back to a clean slate on disconnect. */
function resetDmSidebar(): void {
    dmDirectoryRequest++;
    dmDirectory = [];
    dmDirectoryLoaded = false;
    dmDirectoryLegacy = false;
    if (dmDirectoryTimer) {
        clearTimeout(dmDirectoryTimer);
        dmDirectoryTimer = null;
    }
    setSidebarMode("servers");
    dmListBody.replaceChildren();
    updateDmRailState();
}

railServersBtn.addEventListener("click", () => setSidebarMode("servers"));
railDmsBtn.addEventListener("click", () => setSidebarMode("dms"));

/** The Nudge rules shared by the DM sidebar and the profile card (PRD 17.3). */
function canNudge(userId: string, isOnline: boolean): boolean {
    return isOnline && userId !== api.getInstanceId() && serverNudgeEnabled;
}

/**
 * A Nudge button with its 30 s per-target cooldown countdown. Extracted from
 * the Online Users modal (PRD 17.3) so the profile card shares the exact same
 * behavior and cooldown (`lastNudgeSentAt`).
 */
function buildNudgeButton(userId: string, nickname: string): HTMLButtonElement {
    const nudgeBtn = document.createElement("button");
    nudgeBtn.className = "btn-nudge";
    nudgeBtn.textContent = "👋 Nudge";

    let cooldownInterval: ReturnType<typeof setInterval> | null = null;
    let wasAttached = false;
    const applyCooldownState = (): void => {
        if (!nudgeBtn.isConnected) {
            // Gone with its modal → stop ticking. Not yet attached → wait.
            if (wasAttached && cooldownInterval) clearInterval(cooldownInterval);
            return;
        }
        wasAttached = true;
        const last = lastNudgeSentAt.get(userId);
        const remaining = last ? NUDGE_COOLDOWN_MS - (Date.now() - last) : 0;
        if (remaining <= 0) {
            nudgeBtn.disabled = false;
            nudgeBtn.textContent = "👋 Nudge";
            if (cooldownInterval) {
                clearInterval(cooldownInterval);
                cooldownInterval = null;
            }
            return;
        }
        nudgeBtn.disabled = true;
        nudgeBtn.textContent = `${Math.ceil(remaining / 1000)}s`;
    };

    if (lastNudgeSentAt.has(userId)) {
        // Runs once the caller has attached the button (the first tick
        // would otherwise see it detached and stop the interval).
        queueMicrotask(applyCooldownState);
        cooldownInterval = setInterval(applyCooldownState, 1000);
    }

    nudgeBtn.addEventListener("click", async () => {
        if (!requireServerAccess()) return; // PRD 18.18
        nudgeBtn.disabled = true;
        const res = await api.nudgeUser(userId);
        if (res.success) {
            lastNudgeSentAt.set(userId, Date.now());
            applyCooldownState();
            if (!cooldownInterval) cooldownInterval = setInterval(applyCooldownState, 1000);
            log(`Nudged ${escapeHtml(nickname)}`, "success");
        } else {
            nudgeBtn.disabled = false;
            log(`Failed to nudge: ${res.error}`, "error");
        }
    });
    return nudgeBtn;
}

// ── User Profile Card (PRD 17.3) ────────────────────────────────────────────
// Opened by clicking (or Enter/Space on) a message's avatar or nickname. It
// opens at once with what the message already knows and fills in when
// GET_USER_PROFILE answers; a per-open request id drops stale answers.

const userProfileModal = document.getElementById("user-profile-modal") as HTMLDivElement;
const userProfileCard = userProfileModal.querySelector(".user-profile-card") as HTMLDivElement;
const userProfileBanner = document.getElementById("user-profile-banner") as HTMLDivElement;
const userProfileAvatar = document.getElementById("user-profile-avatar") as HTMLSpanElement;
const userProfilePresence = document.getElementById("user-profile-presence") as HTMLSpanElement;
const userProfileName = document.getElementById("user-profile-name") as HTMLHeadingElement;
const userProfileSince = document.getElementById("user-profile-since") as HTMLDivElement;
const userProfileRoles = document.getElementById("user-profile-roles") as HTMLDivElement;
const userProfileStatus = document.getElementById("user-profile-status") as HTMLDivElement;
const userProfileError = document.getElementById("user-profile-error") as HTMLDivElement;
const userProfileErrorText = document.getElementById("user-profile-error-text") as HTMLSpanElement;
const userProfileActions = document.getElementById("user-profile-actions") as HTMLDivElement;
const btnUserProfileClose = document.getElementById("btn-user-profile-close") as HTMLButtonElement;
const btnUserProfileRetry = document.getElementById("btn-user-profile-retry") as HTMLButtonElement;

let profileUserId: string | null = null;
let profileNickname = "";
/** null = not known yet (still loading, or an old server). */
let profileIsOnline: boolean | null = null;
let profileRequestId = 0;
let profileReturnFocus: HTMLElement | null = null;

/** The card reads as an English sentence ("Member since … · 7 months ago"),
 *  like the rest of the UI, so its dates are English too — the system locale
 *  produced mixed-language text. */
const PROFILE_LOCALE = "en";

/** "7 months ago" — the largest unit that fits, via Intl.RelativeTimeFormat. */
function formatRelativeTime(date: Date): string {
    const seconds = (date.getTime() - Date.now()) / 1000;
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
        ["year", 365 * 24 * 3600],
        ["month", 30 * 24 * 3600],
        ["week", 7 * 24 * 3600],
        ["day", 24 * 3600],
        ["hour", 3600],
        ["minute", 60],
    ];
    const rtf = new Intl.RelativeTimeFormat(PROFILE_LOCALE, { numeric: "auto" });
    for (const [unit, size] of units) {
        if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
    }
    return rtf.format(0, "minute");
}

function skeleton(widthPx: number): string {
    return `<span class="user-profile-skeleton" style="width:${widthPx}px"></span>`;
}

function setProfilePresence(isOnline: boolean | null): void {
    profileIsOnline = isOnline;
    userProfilePresence.classList.toggle("online", isOnline === true);
    userProfilePresence.classList.toggle("unknown", isOnline === null);
    if (isOnline === null) {
        userProfileStatus.innerHTML = skeleton(70);
    } else {
        userProfileStatus.innerHTML = `<span class="user-profile-status-dot${isOnline ? " online" : ""}"></span>${isOnline ? "Online" : "Offline"}`;
    }
    renderProfileActions();
}

/** Message + Nudge for someone else; "This is you" + Edit profile for yourself. */
function renderProfileActions(): void {
    userProfileActions.replaceChildren();
    if (!profileUserId) return;
    const userId = profileUserId;
    const nickname = profileNickname;

    if (userId === api.getInstanceId()) {
        const self = document.createElement("div");
        self.className = "user-profile-self";
        self.innerHTML = `<span>This is you</span>`;
        const edit = document.createElement("button");
        edit.type = "button";
        edit.textContent = "Edit profile";
        edit.addEventListener("click", () => {
            closeUserProfile();
            openClientSettings("profile"); // PRD 19 R3
        });
        self.appendChild(edit);
        userProfileActions.appendChild(self);
        return;
    }

    const message = document.createElement("button");
    message.type = "button";
    message.className = "btn-dm";
    message.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Message';
    message.addEventListener("click", () => {
        closeUserProfile(false);
        openDmTab(userId, nickname);
    });
    userProfileActions.appendChild(message);

    if (canNudge(userId, profileIsOnline === true)) {
        userProfileActions.appendChild(buildNudgeButton(userId, nickname));
    }
}

function renderProfileRoles(roles: UserProfile["roles"]): void {
    userProfileRoles.replaceChildren();
    if (roles.length === 0) {
        userProfileRoles.innerHTML = `<span class="user-profile-empty">No roles</span>`;
        return;
    }
    for (const role of roles) {
        const chip = document.createElement("span");
        chip.className = "user-profile-role";
        // Only a real hex color reaches CSS; anything else uses the neutral dot.
        if (role.color && /^#[0-9a-fA-F]{3,8}$/.test(role.color)) chip.style.setProperty("--role-color", role.color);
        const dot = document.createElement("span");
        dot.className = "user-profile-role-dot";
        const name = document.createElement("span");
        name.textContent = role.name;
        chip.append(dot, name);
        userProfileRoles.appendChild(chip);
    }
}

async function loadUserProfile(): Promise<void> {
    if (!profileUserId) return;
    const requestId = ++profileRequestId;
    userProfileError.hidden = true;
    userProfileSince.innerHTML = skeleton(190);
    userProfileRoles.innerHTML = `${skeleton(64)} ${skeleton(52)}`;
    setProfilePresence(null);

    const res = await api.getUserProfile(profileUserId);
    if (requestId !== profileRequestId || !userProfileModal.classList.contains("visible")) return;

    if (!res.success || !res.profile) {
        userProfileSince.textContent = "";
        userProfileRoles.replaceChildren();
        userProfileStatus.textContent = "";
        userProfileErrorText.textContent = res.unsupported
            ? "Profile details need a newer server (Reson8 2.6.0)."
            : "Couldn't load this profile.";
        btnUserProfileRetry.hidden = !!res.unsupported;
        userProfileError.hidden = false;
        return;
    }

    const p = res.profile;
    profileNickname = p.nickname;
    userProfileName.textContent = p.nickname;
    userProfileAvatar.dataset.avatarNick = p.nickname;
    rememberAvatarUrl(p.userId, p.avatarUrl);
    applyAvatar(userProfileAvatar);

    const since = new Date(p.memberSince);
    const dateText = new Intl.DateTimeFormat(PROFILE_LOCALE, { dateStyle: "long" }).format(since);
    userProfileSince.textContent = `Member since ${dateText} · ${formatRelativeTime(since)}`;
    userProfileSince.title = new Intl.DateTimeFormat(PROFILE_LOCALE, { dateStyle: "full", timeStyle: "short" }).format(since);

    renderProfileRoles(p.roles);
    setProfilePresence(p.isOnline);
}

/** Opens the card for a user. `trigger` gets focus back when it closes. */
function openUserProfile(userId: string, nickname: string, trigger?: HTMLElement | null): void {
    profileUserId = userId;
    profileNickname = nickname;
    profileReturnFocus = trigger ?? (document.activeElement as HTMLElement | null);

    userProfileName.textContent = nickname;
    userProfileBanner.style.setProperty("--profile-tint", avatarColor(userId));
    userProfileAvatar.dataset.avatarUserId = userId;
    userProfileAvatar.dataset.avatarNick = nickname;
    userProfileAvatar.dataset.avatarPx = "96";
    applyAvatar(userProfileAvatar);

    userProfileModal.classList.add("visible");
    userProfileModal.setAttribute("aria-hidden", "false");
    btnUserProfileClose.focus();
    loadUserProfile();
}

function closeUserProfile(restoreFocus = true): void {
    if (!userProfileModal.classList.contains("visible")) return;
    userProfileModal.classList.remove("visible");
    userProfileModal.setAttribute("aria-hidden", "true");
    profileRequestId++; // drop an answer still in flight
    profileUserId = null;
    userProfileActions.replaceChildren(); // stops a Nudge countdown's interval
    if (restoreFocus && profileReturnFocus?.isConnected) profileReturnFocus.focus();
    profileReturnFocus = null;
}

btnUserProfileClose.addEventListener("click", () => closeUserProfile());
btnUserProfileRetry.addEventListener("click", () => loadUserProfile());
userProfileModal.addEventListener("click", (e) => {
    if (e.target === userProfileModal) closeUserProfile();
});

// Handled on the DOCUMENT, not the dialog: focus can leave the card without
// the user meaning to (the Nudge button disables itself for its cooldown,
// and a disabled button drops focus to <body>), and Escape must still close
// it then. Capture phase, so it runs before other Escape handlers.
document.addEventListener("keydown", (e) => {
    if (!userProfileModal.classList.contains("visible")) return;
    if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeUserProfile();
        return;
    }
    // Keep Tab inside the dialog while it's open (and bring it back if lost).
    if (e.key === "Tab") {
        const focusables = Array.from(
            userProfileCard.querySelectorAll<HTMLElement>("button:not([disabled]):not([hidden]), [tabindex='0']"),
        ).filter((el) => el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!userProfileCard.contains(document.activeElement)) {
            e.preventDefault();
            (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
}, true);

/** The message's author for a click/keypress on its avatar or nickname, if that's what was hit. */
function profileTriggerFrom(target: EventTarget | null): { userId: string; nickname: string; el: HTMLElement } | null {
    const el = (target as HTMLElement | null)?.closest?.(".chat-msg .msg-header > .avatar, .chat-msg .msg-nick") as HTMLElement | null;
    if (!el) return null;
    const msg = el.closest(".chat-msg") as HTMLElement | null;
    const userId = msg?.getAttribute("data-msg-owner");
    if (!msg || !userId) return null;
    const nickname = msg.querySelector(".msg-nick")?.textContent ?? "";
    return { userId, nickname, el: (msg.querySelector(".msg-nick") as HTMLElement | null) ?? el };
}

tabContentArea.addEventListener("click", (e) => {
    const hit = profileTriggerFrom(e.target);
    if (!hit) return;
    e.stopPropagation();
    openUserProfile(hit.userId, hit.nickname, hit.el);
});

tabContentArea.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const hit = profileTriggerFrom(e.target);
    if (!hit) return;
    e.preventDefault();
    openUserProfile(hit.userId, hit.nickname, hit.el);
});

/** Refreshes the fallback online count (an older server has no summary) and the header. */
async function refreshOnlineCount(): Promise<void> {
    if (!isConnected) return;
    const result = await api.getOnlineUsers();
    if (result.success && result.users) lastOnlineUsersCount = result.users.filter((u) => u.isOnline).length;
    renderServerHeader(); // PRD 19 C3 (the fallback count for an older server)
}

// ── Unified Settings Modal (Tabs) ─────────────────────────────────────

// `isAdminUser` reflects MANAGE_ROLES specifically (despite the name — kept
// as-is since it's also relied on for the Server tab's literal-ADMIN gate).
// `canBanUsers` reflects BAN_USER specifically — separate flags so the User
// Management tab (PRD 13.17) can open to either holder while still gating
// role-editing vs. ban/unban controls individually within it.
let isAdminUser = false;
let canManageEmojis = false;
let canBanUsers = false;
/** The identity log is ADMIN-only (PRD 18.4); learned from my own roles in the member list. */
let identityLogAllowed = false;

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

/** A count pill on a settings nav item (PRD 20 M4); 0 hides it unless `showZero`. */
function updateSettingsNavCount(tab: "roles" | "emojis", n: number, showZero = tab === "roles"): void {
    const btn = document.querySelector(`.settings-tab-btn[data-settings-tab="${tab}"]`);
    if (!btn) return;
    let pill = btn.querySelector<HTMLElement>(".nav-count");
    if (!pill) {
        pill = document.createElement("span");
        pill.className = "count-pill nav-count";
        btn.appendChild(pill);
    }
    pill.textContent = n > 99 ? "99+" : String(n);
    pill.style.display = n > 0 || showZero ? "" : "none";
}

/** Applies the already-known (cached) isAdminUser/canManageEmojis flags to
 * tab visibility, and falls back to the Voice tab if the active tab just got
 * hidden. Synchronous and idempotent — safe to call both before the modal is
 * shown (using state cached at connect time) and again after a live re-check
 * resolves, without ever flashing the wrong tabs on screen in between. */
function applySettingsTabVisibility(): void {
    // User Management (PRD 13.17) opens to either MANAGE_ROLES or BAN_USER —
    // the controls inside are individually gated by each flag separately.
    settingsTabRoles.style.display = isConnected && (isAdminUser || canBanUsers) ? "" : "none";
    settingsTabEmojis.style.display = isConnected && canManageEmojis ? "" : "none";
    settingsTabServer.style.display = isConnected && isAdminUser ? "" : "none";
    // PRD 19 R4: the pages split out of User Management and the Server tab keep their old gates.
    const showTab = (id: string, on: boolean): void => {
        const el = document.getElementById(id);
        if (el) el.style.display = on ? "" : "none";
    };
    showTab("settings-tab-joining", isConnected && (isAdminUser || canBanUsers));
    showTab("settings-tab-bans", isConnected && canBanUsers);
    showTab("settings-tab-signin", isConnected && isAdminUser);
    showTab("settings-tab-identitylog", isConnected && identityLogAllowed);
    // The two join switches need literal ADMIN (UPDATE_SERVER_SETTINGS); BAN_USER holders only see the queue and invites.
    const joiningSwitches = document.getElementById("joining-switches");
    if (joiningSwitches) joiningSwitches.style.display = isConnected && isAdminUser ? "" : "none";

    const activeTabBtn = document.querySelector(".settings-tab-btn.active") as HTMLButtonElement | null;
    if (activeTabBtn && activeTabBtn.style.display === "none") {
        settingsTabBtns.forEach((b) => b.classList.remove("active"));
        settingsPanels.forEach((p) => p.classList.remove("active"));
        // The first visible page of the mode on screen (PRD 19 R3); Voice when none is left.
        const mode = adminModal.dataset.mode === "server" ? "server" : "client";
        const fallback = Array.from(
            document.querySelectorAll<HTMLElement>(`.settings-nav-group[data-nav-mode="${mode}"] .settings-tab-btn`),
        ).find((b) => b.style.display !== "none");
        if (fallback) {
            fallback.classList.add("active");
            document.querySelector(`.settings-panel[data-settings-panel="${fallback.dataset.settingsTab}"]`)?.classList.add("active");
        } else {
            showSettingsPanelOnly(mode === "server" ? "server-none" : "voice");
        }
    }
}

async function openSettingsPanel(): Promise<void> {
    // Apply the isAdminUser/canManageEmojis state already known from the
    // connect-time check (see the "connected" handler) BEFORE the modal is
    // shown, so non-admins never see the admin tabs blink into view while
    // the live re-check below is still in flight — the client already knows
    // the answer and shouldn't need a round trip to render correctly.
    applySettingsTabVisibility();
    // The NSFW modal can change this preference while Settings is closed.
    chkNsfwWarn.checked = isNsfwWarningEnabled();
    chkNsfwBlur.checked = isNsfwBlurEnabled();
    (document.getElementById("chk-link-previews") as HTMLInputElement).checked = isLinkPreviewsEnabled();
    (document.getElementById("chk-lp-nsfw-blur") as HTMLInputElement).checked = readBoolPref(LP_NSFW_BLUR_KEY);
    (document.getElementById("chk-lp-adult-blur") as HTMLInputElement).checked = readBoolPref(LP_ADULT_BLUR_KEY);
    syncProfileSection(); // discard an unsaved avatar draft from a previous visit (PRD 17.1)
    void renderTrustedCertificates(); // PRD 18.3
    hideIdentityLog(); // always reopen on the user list (PRD 18.4)
    membersSearch.value = "";
    membersFilter = "all";
    void renderBannedAddresses(); // PRD 18.7 (no-op for anyone without BAN_USER)
    void renderBannedUsers(); // PRD 20 M2
    void refreshPendingApprovals(); // PRD 18.8
    void refreshInvites(); // PRD 18.9
    adminModal.classList.add("visible");
    renderServerIconRow(); // PRD 19 C5

    // Populate audio devices
    await populateAudioDevices();

    // Mic level meter is always visible now, independent of the noise gate
    // — start a preview capture if not already in a voice channel (a live
    // call already has its own mic pipeline for the meter to read from).
    if (!isInVoice) {
        api.startMicPreview();
    }
    startMicLevelMeter();

    if (isConnected) {
        // Live re-check, in case permissions changed since connect (e.g. an
        // admin promoted/demoted this user mid-session). Fetch users, roles,
        // banned users, and the pending-emoji queue concurrently. Each tab's
        // visibility is decided by whether its own permission-gated call
        // actually succeeds, rather than a shared heuristic — GET_ROLES
        // stays MANAGE_ROLES-only and GET_BANNED_USERS stays BAN_USER-only,
        // so `isAdminUser`/`canBanUsers` reflect exactly those two
        // permissions even though GET_ALL_USERS itself now accepts either
        // one (PRD 13.17, since the tab serves both).
        const [usersRes, rolesRes, bannedRes, pendingEmojisRes, onlineRes] = await Promise.all([
            api.getAllUsers(currentServerId),
            api.getRoles(currentServerId),
            api.getBannedUsers(),
            api.getPendingEmojis(),
            api.getOnlineUsers(),
        ]);

        isAdminUser = rolesRes.success;
        canBanUsers = bannedRes.success;
        canManageEmojis = pendingEmojisRes.success;
        applySettingsTabVisibility();

        if (usersRes.success) {
            allServerRoles = rolesRes.roles ?? [];
            if (onlineRes.success && onlineRes.users) {
                membersOnline = new Set(onlineRes.users.filter((u) => u.isOnline).map((u) => u.userId));
            }
            renderAdminUsers(usersRes.users ?? []);
        } else {
            adminUserList.innerHTML = '<div class="admin-empty">You don\'t have permission to manage users.</div>';
        }

        if (canManageEmojis) {
            renderPendingEmojis(pendingEmojisRes.emojis ?? []);
            renderEmojiLibrary();
        }

        // Server tab — UPDATE_SERVER_SETTINGS requires literal ADMIN, so
        // isAdminUser is the correct (not just approximate) gate here.
        if (isAdminUser) {
            const settingsRes = await api.getServerSettings();
            if (settingsRes.success) {
                chkNudgeEnabled.checked = settingsRes.nudgeEnabled ?? true;
                chkScreenShareEnabled.checked = settingsRes.screenShareEnabled ?? true;
                inputMaxMessageLength.value = String(settingsRes.maxMessageLength ?? serverMaxMessageLength);
                renderRequireSignedSetting(settingsRes);
                renderRelayHosts(settingsRes);
                chkRequireInvite.checked = settingsRes.requireInvite ?? false;
                (chkRequireInvite.closest(".toggle-row") as HTMLElement).style.display =
                    settingsRes.requireInvite === undefined ? "none" : "";
                chkRequireApproval.checked = settingsRes.requireApproval ?? false;
                (chkRequireApproval.closest(".toggle-row") as HTMLElement).style.display =
                    settingsRes.requireApproval === undefined ? "none" : "";
            }
        }
    } else {
        adminUserList.innerHTML = '<div class="admin-empty">Connect to a server to manage roles.</div>';
    }
}

let pendingEmojiQueue: CustomEmoji[] = [];

/** "Requests · n" header, Approve all and the nav count follow the queue (PRD 20 M3). */
function syncEmojiRequests(): void {
    const n = pendingEmojiQueue.length;
    (document.getElementById("emoji-requests-label") as HTMLElement).textContent = n > 0 ? `Requests · ${n}` : "Requests";
    (document.getElementById("btn-emoji-approve-all") as HTMLElement).style.display = n > 1 ? "" : "none";
    updateSettingsNavCount("emojis", n);
    if (n === 0 && !emojiPendingList.querySelector(".bans-empty")) {
        emojiPendingList.textContent = "";
        const empty = document.createElement("div");
        empty.className = "bans-empty";
        empty.textContent = "All caught up — no emoji waiting for review.";
        emojiPendingList.appendChild(empty);
    }
}

function renderPendingEmojis(emojis: CustomEmoji[]): void {
    pendingEmojiQueue = [...emojis];
    emojiPendingList.textContent = "";

    for (const emoji of emojis) {
        const row = document.createElement("div");
        row.className = "member-row";

        const img = document.createElement("img");
        img.className = "emoji-req-img";
        img.src = emoji.imageUrl;
        img.alt = "";

        const main = document.createElement("div");
        main.className = "member-main";
        const name = document.createElement("div");
        name.className = "member-name";
        const code = document.createElement("span");
        code.className = "emoji-code";
        code.textContent = `:${emoji.name}:`;
        name.appendChild(code);
        const sub = document.createElement("div");
        sub.className = "member-sub";
        const by = document.createElement("span");
        by.textContent = `Requested by ${emoji.uploadedByNickname ?? "Unknown"}`;
        sub.appendChild(by);
        main.append(name, sub);

        const reject = document.createElement("button");
        reject.type = "button";
        reject.className = "btn btn-ghost";
        reject.textContent = "Reject";
        const approve = document.createElement("button");
        approve.type = "button";
        approve.className = "btn btn-primary";
        approve.innerHTML = '<i class="ph ph-check" aria-hidden="true"></i> Approve';

        const finish = (): void => {
            row.remove();
            pendingEmojiQueue = pendingEmojiQueue.filter((e) => e.id !== emoji.id);
            syncEmojiRequests();
        };
        approve.addEventListener("click", async () => {
            approve.disabled = reject.disabled = true;
            const result = await api.reviewCustomEmoji(emoji.id, "APPROVED");
            if (result.success) {
                log(`Approved emoji ":${escapeHtml(emoji.name)}:"`, "success");
                finish();
            } else {
                approve.disabled = reject.disabled = false;
                log(`Failed to approve emoji: ${escapeHtml(result.error ?? "unknown error")}`, "error");
            }
        });
        reject.addEventListener("click", async () => {
            approve.disabled = reject.disabled = true;
            const result = await api.reviewCustomEmoji(emoji.id, "REJECTED");
            if (result.success) {
                log(`Rejected emoji ":${escapeHtml(emoji.name)}:"`, "success");
                finish();
            } else {
                approve.disabled = reject.disabled = false;
                log(`Failed to reject emoji: ${escapeHtml(result.error ?? "unknown error")}`, "error");
            }
        });

        row.append(img, main, reject, approve);
        emojiPendingList.appendChild(row);
    }
    if (emojis.length === 0) {
        pendingEmojiQueue = [];
        emojiPendingList.textContent = "";
    }
    syncEmojiRequests();
}

document.getElementById("btn-emoji-approve-all")!.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    let approved = 0;
    for (const emoji of [...pendingEmojiQueue]) {
        const res = await api.reviewCustomEmoji(emoji.id, "APPROVED");
        if (!res.success) {
            showToast(`Approved ${approved}; stopped at :${escapeHtml(emoji.name)}: — ${escapeHtml(res.error ?? "refused")}`);
            break;
        }
        approved++;
    }
    btn.disabled = false;
    const res = await api.getPendingEmojis();
    renderPendingEmojis(res.emojis ?? []);
});

/** "On this server": every approved emoji with Remove (PRD 20 M3). Two clicks: Remove → Confirm (4 s). */
function renderEmojiLibrary(): void {
    const grid = document.getElementById("emoji-library");
    const label = document.getElementById("emoji-library-label");
    if (!grid || !label) return;
    label.textContent = `On this server · ${customEmojis.length}`;
    grid.textContent = "";
    if (customEmojis.length === 0) {
        const empty = document.createElement("div");
        empty.className = "bans-empty";
        empty.textContent = "No custom emoji yet.";
        grid.appendChild(empty);
        return;
    }
    for (const emoji of [...customEmojis].sort((a, b) => a.name.localeCompare(b.name))) {
        const card = document.createElement("div");
        card.className = "emoji-lib-card";
        const img = document.createElement("img");
        img.src = emoji.imageUrl;
        img.alt = "";
        const code = document.createElement("span");
        code.className = "emoji-code";
        code.textContent = `:${emoji.name}:`;
        code.title = `:${emoji.name}:`;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn btn-ghost emoji-lib-remove";
        remove.textContent = "Remove";
        let armedUntil = 0;
        remove.addEventListener("click", async () => {
            if (Date.now() > armedUntil) {
                armedUntil = Date.now() + 4000;
                remove.textContent = "Confirm";
                remove.classList.add("armed");
                setTimeout(() => {
                    if (Date.now() >= armedUntil) {
                        remove.textContent = "Remove";
                        remove.classList.remove("armed");
                    }
                }, 4000);
                return;
            }
            remove.disabled = true;
            const res = await api.deleteCustomEmoji(emoji.id);
            if (!res.success) {
                remove.disabled = false;
                log(`Failed to remove :${escapeHtml(emoji.name)}:: ${escapeHtml(res.error ?? "unknown error")}`, "error");
            }
            // Success: the CUSTOM_EMOJI_REMOVED broadcast re-renders the grid.
        });
        card.append(img, code);
        if (canManageEmojis) card.appendChild(remove);
        grid.appendChild(card);
    }
}

btnServerSettings.addEventListener("click", () => {
    openClientSettings(); // PRD 19 R3: the gear is this device's settings
});

// ── Approve new users (PRD 18.8) ─────────────────────────────────────────
const approvalScreen = document.getElementById("approval-screen") as HTMLDivElement;
const pendingApprovalsSection = document.getElementById("pending-approvals-section") as HTMLDivElement;
const pendingApprovalsList = document.getElementById("pending-approvals-list") as HTMLDivElement;
const pendingBadgeGear = document.getElementById("pending-badge-gear") as HTMLSpanElement;
const pendingBadgeTab = document.getElementById("pending-badge-tab") as HTMLSpanElement;
const chkRequireApproval = document.getElementById("chk-require-approval") as HTMLInputElement;

type PendingApprovalRow = NonNullable<Awaited<ReturnType<Reson8Api["getPendingApprovals"]>>["requests"]>[number];
let pendingApprovals: PendingApprovalRow[] = [];

function setPendingBadges(count: number): void {
    for (const el of [pendingBadgeGear, pendingBadgeTab]) {
        el.textContent = String(count);
        el.style.display = count > 0 ? "" : "none";
    }
    const tip = count > 0 ? `${count} ${count === 1 ? "person is" : "people are"} waiting for approval` : "Server menu";
    (document.getElementById("header-caret") as HTMLElement).title = tip;
}

/** Loads the queue (BAN_USER/ADMIN only — anyone else just gets a refusal and nothing shows). */
async function refreshPendingApprovals(): Promise<void> {
    if (!isConnected) {
        pendingApprovals = [];
        setPendingBadges(0);
        pendingApprovalsSection.style.display = "none";
        return;
    }
    const res = await api.getPendingApprovals();
    if (!res.success || !res.requests) {
        pendingApprovals = [];
        setPendingBadges(0);
        pendingApprovalsSection.style.display = "none";
        return;
    }
    pendingApprovals = res.requests;
    setPendingBadges(pendingApprovals.length);
    renderPendingApprovals();
}

function renderPendingApprovals(): void {
    pendingApprovalsList.textContent = "";
    pendingApprovalsSection.style.display = pendingApprovals.length > 0 ? "" : "none";
    for (const req of pendingApprovals) {
        const row = document.createElement("div");
        row.className = "pending-approval-row";

        const info = document.createElement("div");
        info.className = "pending-approval-info";
        const name = document.createElement("div");
        name.className = "pending-approval-name";
        name.textContent = req.nickname || "(no nickname)";
        const meta = document.createElement("div");
        meta.className = "pending-approval-meta";
        const when = new Date(req.requestedAt);
        const whenText = Number.isNaN(when.getTime())
            ? ""
            : when.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
        meta.textContent =
            `${req.online ? "Waiting now" : "Not connected right now"}${whenText ? ` · asked ${whenText}` : ""}` +
            `${req.address ? ` · ${req.address}` : ""} · ${req.fingerprint}`;
        info.append(name, meta);

        const actions = document.createElement("div");
        actions.className = "pending-approval-actions";
        const mk = (label: string, cls: string, onClick: () => Promise<void>): HTMLButtonElement => {
            const b = document.createElement("button");
            b.className = cls;
            b.textContent = label;
            b.addEventListener("click", async () => {
                for (const x of actions.querySelectorAll("button")) (x as HTMLButtonElement).disabled = true;
                await onClick();
            });
            return b;
        };
        actions.append(
            mk("Approve", "btn btn-create", async () => {
                const r = await api.approveUser(req.userId);
                log(
                    r.success
                        ? `Approved ${escapeHtml(req.nickname)}`
                        : `Couldn't approve ${escapeHtml(req.nickname)}: ${escapeHtml(r.error ?? "unknown error")}`,
                    r.success ? "success" : "error",
                );
                void refreshPendingApprovals();
            }),
            mk("Reject", "btn btn-cancel", async () => {
                const r = await api.rejectUser(req.userId);
                log(
                    r.success
                        ? `Declined ${escapeHtml(req.nickname)}`
                        : `Couldn't decline ${escapeHtml(req.nickname)}: ${escapeHtml(r.error ?? "unknown error")}`,
                    r.success ? "success" : "error",
                );
                void refreshPendingApprovals();
            }),
            mk("Reject and ban", "btn btn-disconnect", async () => {
                openBanDialog({ id: req.userId, nickname: req.nickname, pending: true });
                for (const x of actions.querySelectorAll("button")) (x as HTMLButtonElement).disabled = false;
            }),
        );
        row.append(info, actions);
        pendingApprovalsList.appendChild(row);
    }
}

// The queue changed (a new request, or another moderator decided).
api.on("pending-approvals-changed", (payload: { count: number; added?: boolean }) => {
    setPendingBadges(payload.count);
    if (payload.added) {
        SoundAlert.play("user_joined_channel.mp3");
        log("Someone is waiting for approval — see Settings → User Management", "info");
    }
    void refreshPendingApprovals();
});

// ── The waiting side: a NEW identity on a server that approves newcomers ──
function showApprovalScreen(fingerprint: string): void {
    closeSettingsPanel(); // an open dialog would hide the waiting screen
    (document.getElementById("approval-nickname") as HTMLElement).textContent = nicknameInput.value.trim() || "User";
    (document.getElementById("approval-fingerprint") as HTMLElement).textContent = fingerprint || "(unavailable)";
    (document.getElementById("approval-title") as HTMLElement).textContent = "Waiting for approval";
    (document.getElementById("approval-text") as HTMLElement).textContent =
        "This server asks a moderator to let new people in. You can leave this window open — you'll join automatically as soon as they do.";
    approvalScreen.classList.add("visible");
    document.body.classList.add("is-approving"); // the waiting screen lives in #main
    btnConnect.disabled = true;
    btnDisconnect.disabled = false;
}

function hideApprovalScreen(): void {
    approvalScreen.classList.remove("visible");
    document.body.classList.remove("is-approving");
}

api.on("approval-pending", (payload: { fingerprint?: string }) => {
    showWelcomeForm(); // PRD 19 R1
    showApprovalScreen(payload?.fingerprint ?? "");
    log("Waiting for a moderator to approve you…", "info");
});
api.on("approval-granted", () => {
    (document.getElementById("approval-title") as HTMLElement).textContent = "Approved!";
    (document.getElementById("approval-text") as HTMLElement).textContent = "Joining the server…";
    log("A moderator approved you — joining…", "success");
    SoundAlert.play("connected.mp3");
});
api.on("approval-rejected", () => {
    hideApprovalScreen();
    btnConnect.disabled = false;
    btnDisconnect.disabled = true;
    log("A moderator declined your request to join", "error");
    showToast("A moderator declined your request to join this server.", 7000);
});
document.getElementById("btn-approval-cancel")!.addEventListener("click", () => {
    hideApprovalScreen();
    api.disconnect();
    log("Cancelled the request to join", "info");
});

chkRequireApproval.addEventListener("change", async () => {
    const desired = chkRequireApproval.checked;
    const result = await api.updateServerSettings({ requireApproval: desired });
    if (result.success) {
        log(`New people ${desired ? "now need a moderator's approval" : "no longer need approval"} to join`, "success");
    } else {
        chkRequireApproval.checked = !desired; // revert on failure
        log(`Failed to update server settings: ${result.error}`, "error");
        if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
    }
});

// ── Invite codes (PRD 18.9) ──────────────────────────────────────────────
interface InviteRow {
    id: string;
    codePrefix: string;
    label: string | null;
    createdBy: string;
    createdByNickname: string | null;
    createdAt: string;
    expiresAt: string | null;
    maxUses: number | null;
    uses: number;
    status: "active" | "expired" | "used-up" | "revoked";
    usedBy: { userId: string; nickname: string | null; usedAt: string }[];
}

const inviteCodeInput = document.getElementById("invite-code") as HTMLInputElement;
const invitesSection = document.getElementById("invites-section") as HTMLDivElement;
const invitesList = document.getElementById("invites-list") as HTMLDivElement;
const chkRequireInvite = document.getElementById("chk-require-invite") as HTMLInputElement;
const inviteCreateModal = document.getElementById("invite-create-modal") as HTMLDivElement;
const inviteCodeModal = document.getElementById("invite-code-modal") as HTMLDivElement;
let invites: InviteRow[] = [];
const expandedInvites = new Set<string>();

/** Shows the code field on the connect form, focused, with the server's reason. */
function revealInviteField(message: string, invalid: boolean): void {
    inviteCodeInput.style.display = "";
    inviteCodeInput.classList.add("invite-needed");
    if (invalid) inviteCodeInput.select();
    inviteCodeInput.focus();
    log(escapeHtml(message), "error");
    showToast(escapeHtml(message), 6000);
}

/** After a successful join: forget the code and hide the field again. */
function clearInviteField(): void {
    inviteCodeInput.value = "";
    inviteCodeInput.classList.remove("invite-needed");
    inviteCodeInput.style.display = "none";
}

function describeInviteExpiry(inv: InviteRow): string {
    if (!inv.expiresAt) return "never expires";
    const when = new Date(inv.expiresAt);
    if (Number.isNaN(when.getTime())) return "";
    const text = when.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    return inv.status === "expired" ? `expired ${text}` : `expires ${text}`;
}

async function refreshInvites(): Promise<void> {
    if (!isConnected) {
        invites = [];
        invitesSection.style.display = "none";
        return;
    }
    const res = await api.getInvites();
    if (!res.success || !res.invites) {
        // No BAN_USER/ADMIN: the section simply isn't there.
        invites = [];
        invitesSection.style.display = "none";
        return;
    }
    invites = res.invites;
    invitesSection.style.display = "";
    renderInvites();
}

function renderInvites(): void {
    invitesList.textContent = "";
    if (invites.length === 0) {
        const empty = document.createElement("div");
        empty.className = "admin-empty";
        empty.textContent = "No invites yet.";
        invitesList.appendChild(empty);
        return;
    }
    for (const inv of invites) {
        const row = document.createElement("div");
        row.className = "invite-row" + (inv.status === "active" ? "" : " invite-inactive");

        const main = document.createElement("div");
        main.className = "invite-main";
        const info = document.createElement("div");
        info.className = "invite-info";

        const title = document.createElement("div");
        title.className = "invite-title";
        const code = document.createElement("code");
        code.textContent = `${inv.codePrefix}-…`;
        const label = document.createElement("span");
        label.textContent = inv.label || "Untitled invite";
        const status = document.createElement("span");
        status.className = `invite-status ${inv.status}`;
        status.textContent = inv.status === "used-up" ? "used up" : inv.status;
        title.append(code, label, status);

        const meta = document.createElement("div");
        meta.className = "invite-meta";
        const created = new Date(inv.createdAt);
        const createdText = Number.isNaN(created.getTime()) ? "" : created.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        meta.textContent =
            `${inv.uses}${inv.maxUses !== null ? ` / ${inv.maxUses}` : ""} ${inv.uses === 1 ? "use" : "uses"}` +
            ` · ${describeInviteExpiry(inv)}` +
            ` · by ${inv.createdByNickname ?? "someone"}${createdText ? `, ${createdText}` : ""}`;
        info.append(title, meta);

        const actions = document.createElement("div");
        actions.className = "invite-actions";
        if (inv.usedBy.length > 0) {
            const toggle = document.createElement("button");
            toggle.className = "btn btn-cancel";
            toggle.textContent = expandedInvites.has(inv.id) ? "Hide" : "Who used it";
            toggle.addEventListener("click", () => {
                if (expandedInvites.has(inv.id)) expandedInvites.delete(inv.id);
                else expandedInvites.add(inv.id);
                renderInvites();
            });
            actions.appendChild(toggle);
        }
        if (inv.status === "active") {
            const revoke = document.createElement("button");
            revoke.className = "btn btn-disconnect";
            revoke.textContent = "Revoke";
            revoke.addEventListener("click", async () => {
                revoke.disabled = true;
                const r = await api.revokeInvite(inv.id);
                log(
                    r.success
                        ? `Revoked invite ${escapeHtml(inv.codePrefix)}-…`
                        : `Couldn't revoke the invite: ${escapeHtml(r.error ?? "unknown error")}`,
                    r.success ? "success" : "error",
                );
                void refreshInvites();
            });
            actions.appendChild(revoke);
        }

        main.append(info, actions);
        row.appendChild(main);

        if (expandedInvites.has(inv.id) && inv.usedBy.length > 0) {
            const uses = document.createElement("div");
            uses.className = "invite-uses";
            for (const u of inv.usedBy) {
                const line = document.createElement("div");
                const at = new Date(u.usedAt);
                line.textContent = `${u.nickname ?? u.userId.slice(0, 8)}${
                    Number.isNaN(at.getTime())
                        ? ""
                        : ` — ${at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                }`;
                uses.appendChild(line);
            }
            row.appendChild(uses);
        }
        invitesList.appendChild(row);
    }
}

const inviteLabelInput = document.getElementById("invite-label") as HTMLInputElement;
const inviteExpirySelect = document.getElementById("invite-expiry") as HTMLSelectElement;
const inviteMaxUsesSelect = document.getElementById("invite-max-uses") as HTMLSelectElement;
const inviteMaxUsesCustom = document.getElementById("invite-max-uses-custom") as HTMLInputElement;
const inviteCreateError = document.getElementById("invite-create-error") as HTMLDivElement;

function closeInviteCreateModal(): void {
    inviteCreateModal.classList.remove("visible");
}

document.getElementById("btn-create-invite")!.addEventListener("click", () => {
    inviteLabelInput.value = "";
    inviteExpirySelect.value = "";
    inviteMaxUsesSelect.value = "";
    inviteMaxUsesCustom.value = "";
    inviteMaxUsesCustom.style.display = "none";
    inviteCreateError.textContent = "";
    inviteCreateModal.classList.add("visible");
    inviteLabelInput.focus();
});

inviteMaxUsesSelect.addEventListener("change", () => {
    const custom = inviteMaxUsesSelect.value === "custom";
    inviteMaxUsesCustom.style.display = custom ? "" : "none";
    if (custom) inviteMaxUsesCustom.focus();
});

document.getElementById("btn-invite-create-cancel")!.addEventListener("click", closeInviteCreateModal);

document.getElementById("btn-invite-create-confirm")!.addEventListener("click", async () => {
    let maxUses: number | null = null;
    if (inviteMaxUsesSelect.value === "custom") {
        const n = Number(inviteMaxUsesCustom.value);
        if (!Number.isInteger(n) || n < 1 || n > 1000) {
            inviteCreateError.textContent = "Enter a whole number from 1 to 1000.";
            return;
        }
        maxUses = n;
    } else if (inviteMaxUsesSelect.value) {
        maxUses = Number(inviteMaxUsesSelect.value);
    }
    const confirm = document.getElementById("btn-invite-create-confirm") as HTMLButtonElement;
    confirm.disabled = true;
    const res = await api.createInvite({
        label: inviteLabelInput.value.trim() || undefined,
        expiresInHours: inviteExpirySelect.value ? Number(inviteExpirySelect.value) : null,
        maxUses,
    });
    confirm.disabled = false;
    if (!res.success || !res.code) {
        inviteCreateError.textContent = res.error ?? "Couldn't create the invite";
        return;
    }
    closeInviteCreateModal();
    (document.getElementById("invite-code-value") as HTMLElement).textContent = res.code;
    inviteCodeModal.classList.add("visible");
    log("Created an invite", "success");
    void refreshInvites();
});

document.getElementById("btn-invite-code-copy")!.addEventListener("click", async () => {
    const text = (document.getElementById("invite-code-value") as HTMLElement).textContent ?? "";
    const ok = await api.copyText(text);
    showToast(ok ? "Invite code copied" : "Couldn't copy the code — select it and copy by hand");
});

document.getElementById("btn-invite-code-close")!.addEventListener("click", () => {
    inviteCodeModal.classList.remove("visible");
    // The code must not linger in the page once it has been shown.
    (document.getElementById("invite-code-value") as HTMLElement).textContent = "";
});

chkRequireInvite.addEventListener("change", async () => {
    const desired = chkRequireInvite.checked;
    const result = await api.updateServerSettings({ requireInvite: desired });
    if (result.success) {
        log(`New people ${desired ? "now need an invite code" : "no longer need an invite code"} to join`, "success");
    } else {
        chkRequireInvite.checked = !desired; // revert on failure
        log(`Failed to update server settings: ${result.error}`, "error");
        if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
    }
});

// ── Ban dialog + banned addresses (PRD 18.7) ─────────────────────────────
const banUserModal = document.getElementById("ban-user-modal") as HTMLDivElement;
const bannedAddressesSection = document.getElementById("banned-addresses-section") as HTMLDivElement;
const bannedAddressesList = document.getElementById("banned-addresses-list") as HTMLDivElement;
let banDialogUser: { id: string; nickname: string; pending?: boolean } | null = null;

function openBanDialog(user: { id: string; nickname: string; pending?: boolean }): void {
    banDialogUser = user;
    (document.getElementById("ban-user-name") as HTMLElement).textContent = user.nickname;
    (document.getElementById("btn-ban-user-confirm") as HTMLButtonElement).textContent = user.pending ? "Reject and ban" : "Ban";
    const none = banUserModal.querySelector<HTMLInputElement>('input[name="ban-address-scope"][value="none"]');
    if (none) none.checked = true;
    (document.getElementById("ban-scope-warning") as HTMLElement).style.display = "none";
    banUserModal.classList.add("visible");
    (document.getElementById("btn-ban-user-cancel") as HTMLButtonElement).focus(); // the safe default
}

function closeBanDialog(): void {
    banUserModal.classList.remove("visible");
    banDialogUser = null;
}

banUserModal.addEventListener("change", (e) => {
    const target = e.target as HTMLInputElement;
    if (target?.name !== "ban-address-scope") return;
    (document.getElementById("ban-scope-warning") as HTMLElement).style.display = target.value === "none" ? "none" : "";
});
document.getElementById("btn-ban-user-cancel")!.addEventListener("click", closeBanDialog);
banUserModal.addEventListener("click", (e) => {
    if (e.target === banUserModal) closeBanDialog();
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && banUserModal.classList.contains("visible")) closeBanDialog();
});

document.getElementById("btn-ban-user-confirm")!.addEventListener("click", async () => {
    const user = banDialogUser;
    if (!user) return;
    const checked = banUserModal.querySelector<HTMLInputElement>('input[name="ban-address-scope"]:checked');
    const scope = (checked?.value ?? "none") as "none" | "exact" | "range";
    closeBanDialog();

    // "Reject and ban" on someone waiting in the approval queue (PRD 18.8).
    if (user.pending) {
        const r = await api.rejectUser(user.id, { ban: true, addressBan: scope });
        if (r.success) {
            log(`Rejected and banned ${escapeHtml(user.nickname)}`, "success");
            if (r.warning) {
                log(escapeHtml(r.warning), "error");
                showToast(escapeHtml(r.warning), 8000);
            }
            SoundAlert.play("user_banned_from_server.mp3");
        } else {
            log(`Failed to reject: ${escapeHtml(r.error ?? "unknown error")}`, "error");
        }
        void refreshPendingApprovals();
        return;
    }

    const res = await api.banUser(user.id, scope);
    if (res.success) {
        log(`Banned ${escapeHtml(user.nickname)}${res.addressBanned ? " and their address" : ""}`, "success");
        // The user ban worked, but the address part couldn't be applied: say why.
        if (res.warning) {
            log(escapeHtml(res.warning), "error");
            showToast(escapeHtml(res.warning), 8000);
        }
        SoundAlert.play("user_banned_from_server.mp3");
        void renderBannedUsers();
        void renderBannedAddresses();
        if (membersPanelActive()) void refreshMembersPanel();
        else void openSettingsPanel(); // refresh to reflect the new banned state
    } else {
        log(`Failed to ban: ${escapeHtml(res.error ?? "unknown error")}`, "error");
        if (res.error && /permission|denied/i.test(res.error)) SoundAlert.play("insufficient_perms.mp3");
    }
});

/** The "Banned people" card on the Bans page (PRD 20 M2). Empty for anyone without BAN_USER. */
async function renderBannedUsers(): Promise<void> {
    const list = document.getElementById("banned-users-list");
    if (!list) return;
    if (!isConnected) {
        list.textContent = "";
        return;
    }
    const res = await api.getBannedUsers();
    list.textContent = "";
    if (!res.success || !res.users) return;
    if (res.users.length === 0) {
        const empty = document.createElement("div");
        empty.className = "bans-empty";
        empty.textContent = "Nobody is banned. Ban someone from the ⋮ menu in Members.";
        list.appendChild(empty);
        return;
    }
    for (const u of res.users) {
        const row = document.createElement("div");
        row.className = "member-row";
        const icon = document.createElement("i");
        icon.className = "ph ph-prohibit ban-row-icon";
        icon.setAttribute("aria-hidden", "true");
        const main = document.createElement("div");
        main.className = "member-main";
        const name = document.createElement("div");
        name.className = "member-name";
        name.append(document.createTextNode(u.nickname));
        if (u.address) {
            const chip = document.createElement("span");
            chip.className = "ban-address";
            chip.textContent = u.address;
            name.append(chip);
        }
        const sub = document.createElement("div");
        sub.className = "member-sub";
        const meta = document.createElement("span");
        meta.textContent = `Banned${u.bannedByNickname ? ` by ${u.bannedByNickname}` : ""} · ${relativeTime(Date.parse(u.bannedAt))}`;
        sub.appendChild(meta);
        main.append(name, sub);
        const unban = document.createElement("button");
        unban.type = "button";
        unban.className = "btn btn-secondary";
        unban.textContent = "Unban";
        unban.addEventListener("click", async () => {
            unban.disabled = true;
            const r = await api.unbanUser(u.userId);
            if (r.success) {
                log(`Unbanned ${escapeHtml(u.nickname)}`, "success");
                SoundAlert.play("user_unbanned_from_server.mp3");
            } else {
                unban.disabled = false;
                log(`Failed to unban: ${escapeHtml(r.error ?? "unknown error")}`, "error");
                if (r.error && /permission|denied/i.test(r.error)) SoundAlert.play("insufficient_perms.mp3");
                return;
            }
            void renderBannedUsers();
            void renderBannedAddresses();
            void refreshMembersPanel();
        });
        row.append(icon, main, unban);
        list.appendChild(row);
    }
}

/** The "Banned addresses" list under the users (BAN_USER holders only; the server masks it for non-ADMINs). */
async function renderBannedAddresses(): Promise<void> {
    if (!isConnected) {
        bannedAddressesSection.style.display = "none";
        return;
    }
    const res = await api.getBannedAddresses();
    if (!res.success || !res.addresses) {
        bannedAddressesSection.style.display = "none"; // no BAN_USER, or an older server
        return;
    }
    bannedAddressesSection.style.display = "";
    bannedAddressesList.textContent = "";
    if (res.addresses.length === 0) {
        const empty = document.createElement("div");
        empty.className = "admin-empty";
        empty.textContent = "No banned addresses.";
        bannedAddressesList.appendChild(empty);
        return;
    }
    for (const entry of res.addresses) {
        const row = document.createElement("div");
        row.className = "banned-address-row";
        const info = document.createElement("div");
        info.className = "banned-address-info";
        const code = document.createElement("code");
        code.textContent = entry.cidr;
        const meta = document.createElement("div");
        meta.className = "banned-address-meta";
        const when = new Date(entry.createdAt);
        const whenText = Number.isNaN(when.getTime())
            ? ""
            : when.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
        meta.textContent = `${entry.nickname ? `Banned with ${entry.nickname}` : "Banned on its own"}${whenText ? ` · ${whenText}` : ""}`;
        info.append(code, meta);
        const unban = document.createElement("button");
        unban.className = "btn-unban";
        unban.textContent = "Unban";
        unban.addEventListener("click", async () => {
            unban.disabled = true;
            const r = await api.unbanAddress(entry.id);
            if (r.success) {
                log(`Lifted the address ban on ${escapeHtml(entry.cidr)}`, "success");
                void renderBannedAddresses();
            } else {
                unban.disabled = false;
                log(`Failed to lift the address ban: ${escapeHtml(r.error ?? "unknown error")}`, "error");
            }
        });
        row.append(info, unban);
        bannedAddressesList.appendChild(row);
    }
}

// ── Identity log + "Require signed identity" (PRD 18.4) ──────────────────
const identityLogPanel = document.getElementById("identity-log-panel") as HTMLDivElement;
const identityLogList = document.getElementById("identity-log-list") as HTMLDivElement;
const identityLogFilter = document.getElementById("identity-log-filter") as HTMLSpanElement;
const btnIdentityLogBack = document.getElementById("btn-identity-log-back") as HTMLButtonElement;
const btnIdentityLogClearFilter = document.getElementById("btn-identity-log-clear-filter") as HTMLButtonElement;
const btnIdentityLogMore = document.getElementById("btn-identity-log-more") as HTMLButtonElement;
const chkRequireSigned = document.getElementById("chk-require-signed") as HTMLInputElement;
const requireSignedNote = document.getElementById("require-signed-note") as HTMLSpanElement;

let identityLogUser: { id: string; nickname: string } | null = null;
let identityLogCursor: string | null = null;
let identityLogLoading = false;

/** Plain words for the refusal keys the server stores (identity.service.ts). */
const IDENTITY_REFUSAL_WORDS: Record<string, string> = {
    verificationFailed: "the sign-in proof didn't verify",
    hostNotAllowed: "it was addressed to a name this server doesn't accept",
    otherDevice: "the identity belongs to another device",
    protectedUpdate: "an older Reson8 tried to use a protected identity",
    requiresSigned: "an older Reson8 while signed identity is required",
};

function formatLogTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return (
        d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) +
        " " +
        d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    );
}

function buildIdentityLogRow(ev: IdentityLogEvent): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "identity-log-row";

    const kind = document.createElement("span");
    kind.className = `identity-log-kind ${ev.kind.toLowerCase()}`;
    kind.textContent = ev.kind === "BOUND" ? "Key bound" : ev.kind === "RESET" ? "Key reset" : "Refused";

    const who = document.createElement("div");
    who.className = "identity-log-who";
    who.textContent = ev.nickname || "(no nickname)";
    if (ev.currentNickname) {
        const now = document.createElement("span");
        now.className = "identity-log-now";
        now.textContent = ` (now ${ev.currentNickname})`;
        who.appendChild(now);
    }
    if (ev.privileged) {
        const tag = document.createElement("span");
        tag.className = "identity-log-privileged";
        tag.textContent = "privileged";
        tag.title = "This user holds an admin or role-management role";
        who.appendChild(tag);
    }

    const time = document.createElement("span");
    time.className = "identity-log-time";
    time.textContent = formatLogTime(ev.createdAt);
    time.title = ev.createdAt;

    const detail = document.createElement("div");
    detail.className = "identity-log-detail";
    const parts: string[] = [];
    if (ev.kind === "REFUSED") {
        parts.push(`Sign-in refused: ${IDENTITY_REFUSAL_WORDS[ev.reason ?? ""] ?? ev.reason ?? "unknown reason"}.`);
    } else if (ev.kind === "RESET") {
        parts.push(`Key reset by ${ev.actorNickname ?? "an admin who has since left"}.`);
    } else {
        parts.push("First sign-in with this key — it is now bound to this identity.");
    }
    if (ev.address) parts.push(`From ${ev.address}`);
    if (ev.host) parts.push(`to ${ev.host}`);
    detail.appendChild(document.createTextNode(parts.join(" ")));
    if (ev.fingerprint) {
        detail.appendChild(document.createElement("br"));
        const code = document.createElement("code");
        code.textContent = ev.fingerprint;
        detail.appendChild(code);
    }

    row.append(kind, who, time, detail);
    return row;
}

async function loadIdentityLog(reset: boolean): Promise<void> {
    if (identityLogLoading) return;
    identityLogLoading = true;
    btnIdentityLogMore.disabled = true;
    if (reset) {
        identityLogList.textContent = "";
        identityLogCursor = null;
        const loading = document.createElement("div");
        loading.className = "admin-empty";
        loading.textContent = "Loading the identity log...";
        identityLogList.appendChild(loading);
    }
    try {
        const res = await api.getIdentityEvents({
            ...(identityLogUser ? { userId: identityLogUser.id } : {}),
            ...(identityLogCursor ? { before: identityLogCursor } : {}),
            limit: 50,
        });
        if (reset) identityLogList.textContent = "";
        if (!res.success || !res.events) {
            const err = document.createElement("div");
            err.className = "admin-empty";
            err.textContent = res.error ?? "Couldn't load the identity log.";
            identityLogList.appendChild(err);
            btnIdentityLogMore.style.display = "none";
            return;
        }
        for (const ev of res.events) identityLogList.appendChild(buildIdentityLogRow(ev));
        if (res.events.length > 0) identityLogCursor = res.events[res.events.length - 1].createdAt;
        if (identityLogList.children.length === 0) {
            const empty = document.createElement("div");
            empty.className = "admin-empty";
            empty.textContent = identityLogUser
                ? "Nothing recorded for this user yet."
                : "Nothing recorded yet. Key binds, resets and refused sign-ins will show up here.";
            identityLogList.appendChild(empty);
        }
        btnIdentityLogMore.style.display = res.hasMore ? "" : "none";
    } finally {
        identityLogLoading = false;
        btnIdentityLogMore.disabled = false;
    }
}

function showIdentityLog(user: { id: string; nickname: string } | null = null): void {
    identityLogUser = user;
    identityLogFilter.textContent = user ? `Showing only ${user.nickname}` : "All users";
    btnIdentityLogClearFilter.style.display = user ? "" : "none";
    identityLogPanel.style.display = "";
    // Its own page since PRD 19 R4 (a member row's menu lands here filtered to that person).
    const tab = document.getElementById("settings-tab-identitylog") as HTMLButtonElement | null;
    if (tab && !tab.classList.contains("active")) {
        tab.style.display = "";
        settingsTabBtns.forEach((b) => b.classList.remove("active"));
        settingsPanels.forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        document.querySelector('.settings-panel[data-settings-panel="identitylog"]')?.classList.add("active");
    }
    void loadIdentityLog(true);
}

function hideIdentityLog(): void {
    // The page is always the log; "hiding" resets its filter (PRD 19 R4).
    identityLogPanel.style.display = "";
    adminUserList.style.display = "";
    identityLogUser = null;
}

document.getElementById("settings-tab-identitylog")?.addEventListener("click", () => {
    if (identityLogUser === null) void loadIdentityLog(true);
});
btnIdentityLogBack.addEventListener("click", () => {
    hideIdentityLog();
    (document.getElementById("settings-tab-roles") as HTMLButtonElement | null)?.click(); // back to Members
});
btnIdentityLogClearFilter.addEventListener("click", () => showIdentityLog(null));
btnIdentityLogMore.addEventListener("click", () => void loadIdentityLog(false));

/** Fills the Server tab's "Require signed identity" row from GET_SERVER_SETTINGS. */
function renderRequireSignedSetting(res: {
    requireSignedIdentity?: boolean;
    requireSignedIdentityLockedByEnv?: boolean;
    unprotectedActiveUsers?: number;
}): void {
    const row = chkRequireSigned.closest(".toggle-row") as HTMLElement | null;
    // A server older than 2.7.0 doesn't send the field: hide the row rather than show a dead switch.
    if (res.requireSignedIdentity === undefined) {
        if (row) row.style.display = "none";
        return;
    }
    if (row) row.style.display = "";
    chkRequireSigned.checked = res.requireSignedIdentity;
    chkRequireSigned.disabled = !!res.requireSignedIdentityLockedByEnv;

    const n = res.unprotectedActiveUsers ?? 0;
    let note: string;
    if (res.requireSignedIdentityLockedByEnv) {
        note = "Set by the server's REQUIRE_SIGNED_IDENTITY environment variable, so it can't be changed here.";
    } else if (n > 0) {
        note =
            `${n} ${n === 1 ? "person" : "people"} active in the last 30 days ${n === 1 ? "hasn't" : "haven't"} ` +
            `connected with 2.6.0 or newer yet — turning this on locks them out until they update.`;
    } else {
        note = "Everyone active in the last 30 days is already protected, so it is safe to turn on.";
    }
    requireSignedNote.textContent = note;
    requireSignedNote.classList.toggle("safe", !res.requireSignedIdentityLockedByEnv && n === 0);
    requireSignedNote.style.display = "";
}

chkRequireSigned.addEventListener("change", async () => {
    const desired = chkRequireSigned.checked;
    const result = await api.updateServerSettings({ requireSignedIdentity: desired });
    if (result.success) {
        log(`Signed identity ${desired ? "is now required" : "is no longer required"} on this server`, "success");
    } else {
        chkRequireSigned.checked = !desired; // revert on failure
        log(`Failed to update server settings: ${result.error}`, "error");
        if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
    }
});

// ── Connection names / relay protection (PRD 18.5) ───────────────────────
const relayHostsSection = document.getElementById("relay-hosts-section") as HTMLDivElement;
const relayHostsList = document.getElementById("relay-hosts-list") as HTMLDivElement;
const relayHostsStatus = document.getElementById("relay-hosts-status") as HTMLDivElement;
const relayHostsInput = document.getElementById("relay-hosts-input") as HTMLInputElement;
const relayHostsError = document.getElementById("relay-hosts-error") as HTMLDivElement;
const relayHostsLockNote = document.getElementById("relay-hosts-lock-note") as HTMLSpanElement;
const btnRelayHostsAdd = document.getElementById("btn-relay-hosts-add") as HTMLButtonElement;
const btnRelayHostsSave = document.getElementById("btn-relay-hosts-save") as HTMLButtonElement;

/** Same shape the server accepts for a listed name (auth-hosts.service.ts). */
const RELAY_HOST_ENTRY = /^[a-z0-9._\-[\]:]{1,255}$/;

interface RelayHostChoice {
    host: string;
    checked: boolean;
    joins: number | null;
    lastSeen: string | null;
}
let relayHostChoices: RelayHostChoice[] = [];
let relayHostsLocked = false;

function refreshRelayHostsStatus(): void {
    const n = relayHostChoices.filter((c) => c.checked).length;
    relayHostsStatus.classList.toggle("on", n > 0);
    relayHostsStatus.textContent =
        n === 0 ? "Off — any name is accepted" : `On — ${n} ${n === 1 ? "name" : "names"} accepted`;
}

function renderRelayHostRows(): void {
    relayHostsList.textContent = "";
    if (relayHostChoices.length === 0) {
        const empty = document.createElement("div");
        empty.className = "relay-hosts-empty";
        empty.textContent = "No names seen yet. They appear here as people sign in; you can also add one below.";
        relayHostsList.appendChild(empty);
    }
    for (const choice of relayHostChoices) {
        const row = document.createElement("label");
        row.className = "relay-hosts-row";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = choice.checked;
        box.disabled = relayHostsLocked;
        box.addEventListener("change", () => {
            choice.checked = box.checked;
            refreshRelayHostsStatus();
        });
        const name = document.createElement("span");
        name.className = "relay-hosts-name";
        name.textContent = choice.host;
        const meta = document.createElement("span");
        meta.className = "relay-hosts-meta";
        if (choice.joins === null) {
            meta.textContent = "not seen yet";
        } else {
            const when = choice.lastSeen ? new Date(choice.lastSeen) : null;
            const whenText =
                when && !Number.isNaN(when.getTime())
                    ? `, last ${when.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                    : "";
            meta.textContent = `${choice.joins} ${choice.joins === 1 ? "sign-in" : "sign-ins"}${whenText}`;
        }
        row.append(box, name, meta);
        relayHostsList.appendChild(row);
    }
    refreshRelayHostsStatus();
}

/** Fills the section from GET_SERVER_SETTINGS (ADMIN callers get these fields; older servers don't). */
function renderRelayHosts(res: {
    authAllowedHosts?: string[];
    authAllowedHostsLockedByEnv?: boolean;
    observedAuthHosts?: { host: string; joins: number; lastSeen: string | null }[];
}): void {
    if (res.authAllowedHosts === undefined) {
        relayHostsSection.style.display = "none";
        return;
    }
    relayHostsSection.style.display = "";
    relayHostsLocked = !!res.authAllowedHostsLockedByEnv;
    relayHostsError.textContent = "";

    const listed = new Set(res.authAllowedHosts);
    const choices: RelayHostChoice[] = [];
    for (const o of res.observedAuthHosts ?? []) {
        choices.push({ host: o.host, checked: listed.has(o.host), joins: o.joins, lastSeen: o.lastSeen });
        listed.delete(o.host);
    }
    // Listed names nobody has used (yet) must stay visible, or saving would silently drop them.
    for (const host of listed) choices.push({ host, checked: true, joins: null, lastSeen: null });
    relayHostChoices = choices;

    relayHostsInput.disabled = relayHostsLocked;
    btnRelayHostsAdd.disabled = relayHostsLocked;
    btnRelayHostsSave.disabled = relayHostsLocked;
    relayHostsLockNote.style.display = relayHostsLocked ? "" : "none";
    relayHostsLockNote.textContent = relayHostsLocked
        ? "Set by the server's AUTH_ALLOWED_HOSTS environment variable, so it can't be changed here."
        : "";
    renderRelayHostRows();
}

function addRelayHostFromInput(): void {
    const host = relayHostsInput.value.trim().toLowerCase();
    relayHostsError.textContent = "";
    if (!host) return;
    if (!RELAY_HOST_ENTRY.test(host)) {
        relayHostsError.textContent = "Use a host name or address, with a port if people type one (host or host:port).";
        return;
    }
    const existing = relayHostChoices.find((c) => c.host === host);
    if (existing) existing.checked = true;
    else relayHostChoices.push({ host, checked: true, joins: null, lastSeen: null });
    relayHostsInput.value = "";
    renderRelayHostRows();
}

btnRelayHostsAdd.addEventListener("click", addRelayHostFromInput);
relayHostsInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        addRelayHostFromInput();
    }
});

btnRelayHostsSave.addEventListener("click", async () => {
    relayHostsError.textContent = "";
    // Anything typed but not added yet counts: don't lose it silently.
    if (relayHostsInput.value.trim()) addRelayHostFromInput();
    if (relayHostsError.textContent) return;

    const list = relayHostChoices.filter((c) => c.checked).map((c) => c.host);
    btnRelayHostsSave.disabled = true;
    const result = await api.updateServerSettings({ authAllowedHosts: list });
    btnRelayHostsSave.disabled = relayHostsLocked;
    if (result.success) {
        log(
            list.length === 0
                ? "Connection names: check turned off — any name is accepted"
                : `Connection names saved (${list.length}): sign-ins must be addressed to ${list.join(", ")}`,
            "success",
        );
        relayHostChoices = relayHostChoices.filter((c) => c.checked || c.joins !== null);
        renderRelayHostRows();
    } else {
        relayHostsError.textContent = result.error ?? "Couldn't save the list";
        if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
    }
});

chkNudgeEnabled.addEventListener("change", async () => {
    const desired = chkNudgeEnabled.checked;
    const result = await api.updateServerSettings({ nudgeEnabled: desired });
    if (result.success) {
        serverNudgeEnabled = desired;
        log(`Nudge ${desired ? "enabled" : "disabled"} for this server`, "success");
    } else {
        chkNudgeEnabled.checked = !desired; // revert on failure
        log(`Failed to update server settings: ${result.error}`, "error");
        if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
    }
});

chkScreenShareEnabled.addEventListener("change", async () => {
    const desired = chkScreenShareEnabled.checked;
    const result = await api.updateServerSettings({ screenShareEnabled: desired });
    if (result.success) {
        serverScreenShareEnabled = desired;
        updateShareScreenButton();
        log(`Screen sharing ${desired ? "enabled" : "disabled"} for this server`, "success");
    } else {
        chkScreenShareEnabled.checked = !desired; // revert on failure
        log(`Failed to update server settings: ${result.error}`, "error");
        if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
    }
});

btnSaveMaxMessageLength.addEventListener("click", async () => {
    const desired = Math.trunc(Number(inputMaxMessageLength.value));
    if (!Number.isFinite(desired) || desired < 1 || desired > 100_000) {
        log("Message length limit must be a whole number between 1 and 100,000", "error");
        return;
    }
    const result = await api.updateServerSettings({ maxMessageLength: desired });
    if (result.success) {
        serverMaxMessageLength = desired;
        chatInput.maxLength = desired;
        log(`Message length limit set to ${desired} characters`, "success");
    } else {
        inputMaxMessageLength.value = String(serverMaxMessageLength); // revert on failure
        log(`Failed to update server settings: ${result.error}`, "error");
        if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
    }
});

/** Stops the mic level meter's RAF loop and (if not in a call) the preview
 *  capture it was reading from — otherwise both would keep running
 *  invisibly in the background after the modal that displays them closes.
 *  While actually in a voice channel, the loop must keep running after
 *  Settings closes too (PRD 14.11) — it's what now drives the local
 *  active-speaker halo directly, independent of whether Settings is open. */
function closeSettingsPanel(): void {
    adminModal.classList.remove("visible");
    activeShortcutSlot = null;
    // Also kept alive while self-hearing out of a channel (PRD 14.10) — the
    // preview capture is what the monitor is actually routing, so closing
    // Settings must not silently kill it while the toggle still reads "on".
    if (!isInVoice && !selfHearEnabled) {
        stopMicLevelMeter();
        api.stopMicPreview();
    }
}

btnAdminClose.addEventListener("click", () => {
    closeSettingsPanel();
});

adminModal.addEventListener("click", (e) => {
    if (e.target === adminModal) {
        closeSettingsPanel();
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

/**
 * Applies and remembers an audio device (PRD 20 U1). Used by Settings' Save and by
 * the voice dock / call bar device menus, so the two can never disagree.
 * deviceId "" = the system default.
 */
function applyAudioDevice(kind: "input" | "output", deviceId: string, label: string): void {
    if (kind === "input") {
        api.setAudioInputDevice(deviceId || null);
        try {
            localStorage.setItem("reson8-audio-input", deviceId);
        } catch {
            /* not remembered */
        }
        savedInputDevice = deviceId;
        log(`Microphone set to: ${label}`, "info");
    } else {
        try {
            localStorage.setItem("reson8-audio-output", deviceId);
        } catch {
            /* not remembered */
        }
        savedOutputDevice = deviceId;
        for (const el of document.querySelectorAll("audio")) {
            (el as any).setSinkId?.(deviceId).catch(() => {});
        }
        log(`Speaker set to: ${label}`, "info");
    }
    // Settings may be open on Voice/Sound: keep its selects showing the truth.
    if (adminModal.classList.contains("visible")) void populateAudioDevices();
}

// Apply staged devices on Save
btnSaveDevices.addEventListener("click", () => {
    // Read both staged values first: populateAudioDevices() (called by applyAudioDevice
    // while Settings is open) resets the pending state synchronously.
    const nextInput = pendingInputDevice;
    const nextOutput = pendingOutputDevice;
    const inputLabel = audioInputSelect.selectedOptions[0]?.textContent ?? "System Default";
    const outputLabel = audioOutputSelect.selectedOptions[0]?.textContent ?? "System Default";
    pendingInputDevice = null;
    pendingOutputDevice = null;
    btnSaveDevices.style.display = "none";
    if (nextInput !== null && nextInput !== savedInputDevice) {
        applyAudioDevice("input", nextInput, inputLabel);
    }
    if (nextOutput !== null && nextOutput !== savedOutputDevice) {
        applyAudioDevice("output", nextOutput, outputLabel);
    }
});

/** The caret menu of the mic / headset split buttons (PRD 20 U1, frames 1a/11a). */
async function openAudioDeviceMenu(kind: "input" | "output", anchor: HTMLElement): Promise<void> {
    const { inputs, outputs } = await api.enumerateAudioDevices();
    const list = kind === "input" ? inputs : outputs;
    const current = kind === "input" ? savedInputDevice : savedOutputDevice;
    const icon = kind === "input" ? "ph-microphone" : "ph-speaker-high";
    const items: MenuItem[] = [{ heading: kind === "input" ? "Input device" : "Output device" }];
    items.push({ label: "System default", icon, checked: current === "", onClick: () => applyAudioDevice(kind, "", "System default") });
    for (const d of list) {
        const label = d.label || "Unnamed device";
        items.push({ label, icon, checked: d.deviceId === current, onClick: () => applyAudioDevice(kind, d.deviceId, label) });
    }
    items.push({ divider: true });
    items.push({ label: "Voice & audio settings…", icon: "ph-gear-six", onClick: () => openClientSettings(kind === "input" ? "voice" : "sound") });
    const r = anchor.getBoundingClientRect();
    openMenu(items, r.left, r.top, { anchor, placement: "above" });
}

btnInputDevices.addEventListener("click", (e) => {
    e.stopPropagation();
    void openAudioDeviceMenu("input", btnInputDevices);
});
btnOutputDevices.addEventListener("click", (e) => {
    e.stopPropagation();
    void openAudioDeviceMenu("output", btnOutputDevices);
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
const recordingKeys = new Set<string>();
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
            toggleMuteAndNotify();
        }
        if (shortcuts.deafen && setsEqual(heldKeys, shortcuts.deafen.keys)) {
            toggleDeafenAndNotify();
        }
        if (shortcuts.disconnect && setsEqual(heldKeys, shortcuts.disconnect.keys)) {
            leaveVoiceAndNotify();
        }
        // PTT keydown → unmute (only in PTT mode, and only if not locked/muted/deafened)
        if (shortcuts.ptt && setsEqual(heldKeys, shortcuts.ptt.keys) && pttModeEnabled && isInVoice && !isMuted && !isDeafened) {
            api.setMuted(false);
            isPttHeld = true;
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
        if (wasMatching && pttModeEnabled && isInVoice && !isMuted && !isDeafened) {
            api.setMuted(true);
            isPttHeld = false;
            updateVoiceUI();
        }
    } else {
        heldKeys.delete(e.code);
    }
});

// Global PTT from main process
api.on("ptt-pressed", () => {
    if (shortcuts.ptt && pttModeEnabled && isInVoice && !isMuted && !isDeafened) {
        api.setMuted(false);
        isPttHeld = true;
        updateVoiceUI();
    }
});

api.on("ptt-released", () => {
    // Always clear, even if the guard below is false (e.g. the user muted
    // or deafened while holding the key) — otherwise a stale "held" flag
    // would let the halo light up later.
    isPttHeld = false;
    if (shortcuts.ptt && pttModeEnabled && isInVoice && !isMuted && !isDeafened) {
        api.setMuted(true);
        updateVoiceUI();
    }
});

// ── PTT Mode Toggle ───────────────────────────────────────────────────

const btnVoiceActivation = document.getElementById("btn-voice-activation") as HTMLButtonElement;
const btnPttMode = document.getElementById("btn-ptt-mode") as HTMLButtonElement;

function updatePttModeUI(): void {
    if (pttModeEnabled) {
        btnPttMode.style.borderColor = "var(--color-accent)";
        btnPttMode.style.color = "var(--color-accent)";
        btnVoiceActivation.style.borderColor = "var(--color-divider)";
        btnVoiceActivation.style.color = "var(--color-neutral-400)";
    } else {
        btnVoiceActivation.style.borderColor = "var(--color-accent)";
        btnVoiceActivation.style.color = "var(--color-accent)";
        btnPttMode.style.borderColor = "var(--color-divider)";
        btnPttMode.style.color = "var(--color-neutral-400)";
    }
}

// Set initial UI state
updatePttModeUI();

btnVoiceActivation.addEventListener("click", () => {
    pttModeEnabled = false;
    localStorage.setItem("reson8-ptt-mode", "false");
    updatePttModeUI();
    // Re-enable noise gate section
    if (micSensitivitySection) micSensitivitySection.style.display = "";
    // If currently in voice, unmute mic so it streams immediately — unless
    // deafened, in which case the mic must stay blocked (PRD 10.4).
    if (isInVoice && !isDeafened) {
        api.setMuted(false);
        isMuted = false;
        updateVoiceUI();
        // Re-enable noise gate if it was on
        if (micSensitivityEnabled) {
            const threshold = parseInt(micSensitivitySlider.value, 10);
            api.setMicSensitivity(true, threshold);
        }
    }
    log("Voice input mode: Voice Activation", "info");
});

btnPttMode.addEventListener("click", () => {
    pttModeEnabled = true;
    localStorage.setItem("reson8-ptt-mode", "true");
    updatePttModeUI();
    // Disable noise gate section when in PTT mode
    if (micSensitivitySection) micSensitivitySection.style.display = "none";
    // Disable noise gate if active
    if (micSensitivityEnabled && isInVoice) {
        api.setMicSensitivity(false, 0);
    }
    // If currently in voice, mute mic (PTT resting state) but don't lock
    if (isInVoice) {
        api.setMuted(true);
        isMuted = false; // not locked, PTT key works
        updateVoiceUI();
    }
    log("Voice input mode: Push-To-Talk", "info");
});

// ── Attachments: picking, uploading, the tray (PRD 16.10) ───────────────────
//
// Images upload as soon as they are picked (up to MAX_CONCURRENT_UPLOADS at a
// time), long before Send, and each one shows as a card in the tray ABOVE the
// input bar — and stays there, with a preview, after its upload finishes. A
// card can be opened full size (eye), removed (trash) or, if its upload failed,
// retried. Removing an already-uploaded card discards the server's copy at
// once (PRD 16.9).

/** Mirrors `MAX_ATTACHMENTS_PER_MESSAGE` in shared-types (the renderer is a plain script and can't import it). */
const MAX_ATTACHMENTS_PER_MESSAGE = 10;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 3;
let activeUploads = 0;
let nextAttachmentId = 1;
const attachmentCardEls = new Map<string, HTMLDivElement>();

btnAttach.addEventListener("click", () => {
    if (!requireServerAccess()) return; // PRD 18.18
    fileInput.click();
});

fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = ""; // reset so picking the same file again still fires "change"
    addFiles(files);
});

// Clipboard paste — every pasted image becomes a card, not just the first
chatInput.addEventListener("paste", (e) => {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData?.items ?? [])) {
        if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) files.push(file);
        }
    }
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
});

/** Validates the picked files, adds a card for each acceptable one, and starts uploading. */
function addFiles(files: File[]): void {
    if (files.length === 0) return;
    if (!requireServerAccess()) return; // PRD 18.18 (paste and drag-and-drop arrive here too)
    if (!isConnected) {
        log("Not connected — cannot upload", "error");
        return;
    }

    let overLimit = false;
    for (const file of files) {
        const name = escapeHtml(file.name);
        if (!file.type.startsWith("image/")) {
            showToast(`"${name}" isn't an image — only images can be attached`);
            continue;
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
            showToast(`"${name}" is too large (max 5 MB)`);
            continue;
        }
        if (pendingAttachments.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
            overLimit = true;
            continue;
        }
        pendingAttachments.push({
            id: `att-${nextAttachmentId++}`,
            file,
            objectUrl: URL.createObjectURL(file),
            status: "uploading",
            started: false,
        });
    }
    if (overLimit) showToast(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} images per message`);

    renderAttachmentTray();
    pumpUploadQueue();
}

/** Starts queued uploads until MAX_CONCURRENT_UPLOADS are in flight. */
function pumpUploadQueue(): void {
    while (activeUploads < MAX_CONCURRENT_UPLOADS) {
        const next = pendingAttachments.find((a) => a.status === "uploading" && !a.started);
        if (!next) return;
        next.started = true;
        activeUploads++;
        void runUpload(next).finally(() => {
            activeUploads--;
            pumpUploadQueue();
        });
    }
}

async function runUpload(att: PendingAttachment): Promise<void> {
    try {
        const buffer = await att.file.arrayBuffer();
        const result = await api.uploadFile(buffer, att.file.name, att.file.type);
        if (att.removed) {
            // Removed while it was still uploading: throw the finished upload away (PRD 16.9).
            discardUpload(result.uploadId);
            return;
        }
        att.uploadId = result.uploadId;
        att.url = result.url;
        att.publicId = result.publicId;
        att.status = "ready";
    } catch (err: any) {
        if (att.removed) return;
        att.status = "failed";
        att.error = err?.message ?? "Upload failed";
        log(`Upload failed: ${att.error}`, "error");
    }
    renderAttachmentTray();
}

function removeAttachment(id: string): void {
    const att = pendingAttachments.find((a) => a.id === id);
    if (!att) return;
    att.removed = true;
    pendingAttachments = pendingAttachments.filter((a) => a !== att);
    URL.revokeObjectURL(att.objectUrl);
    discardUpload(att.uploadId); // already uploaded; an in-flight one is discarded when it resolves
    renderAttachmentTray();
}

function retryAttachment(id: string): void {
    const att = pendingAttachments.find((a) => a.id === id);
    if (!att || att.status !== "failed") return;
    att.status = "uploading";
    att.started = false;
    att.error = undefined;
    renderAttachmentTray();
    pumpUploadQueue();
}

const ATTACH_ICON_EYE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const ATTACH_ICON_TRASH = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
const ATTACH_ICON_RETRY = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`;
const ATTACH_ICON_WARN = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

/** One tray card, built once; `updateAttachmentCard` keeps it in sync afterwards. */
function createAttachmentCard(att: PendingAttachment): HTMLDivElement {
    const card = document.createElement("div");
    card.className = "attach-card";
    card.setAttribute("role", "listitem");

    const actions = document.createElement("div");
    actions.className = "attach-card-actions";
    const mkBtn = (cls: string, label: string, icon: string, onClick: () => void): HTMLButtonElement => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = cls;
        b.innerHTML = icon;
        b.title = label;
        b.setAttribute("aria-label", label);
        b.addEventListener("click", (e) => {
            e.stopPropagation();
            onClick();
        });
        return b;
    };
    // Preview opens the LOCAL file, so it works even while the upload is running.
    actions.appendChild(mkBtn("attach-preview", "Preview image", ATTACH_ICON_EYE, () => openLightbox(att.objectUrl, { previewOnly: true })));
    actions.appendChild(mkBtn("attach-retry", "Retry upload", ATTACH_ICON_RETRY, () => retryAttachment(att.id)));
    actions.appendChild(mkBtn("attach-remove", "Remove image", ATTACH_ICON_TRASH, () => removeAttachment(att.id)));
    card.appendChild(actions);

    const thumb = document.createElement("div");
    thumb.className = "attach-card-thumb";
    const img = document.createElement("img");
    img.src = att.objectUrl;
    img.alt = "";
    img.draggable = false;
    thumb.appendChild(img);
    const overlay = document.createElement("div");
    overlay.className = "attach-card-overlay";
    overlay.innerHTML = `<span class="attach-card-spinner"></span><span class="attach-card-warn">${ATTACH_ICON_WARN}</span>`;
    thumb.appendChild(overlay);
    card.appendChild(thumb);

    const name = document.createElement("div");
    name.className = "attach-card-name";
    name.textContent = att.file.name;
    name.title = att.file.name;
    card.appendChild(name);

    return card;
}

function updateAttachmentCard(card: HTMLDivElement, att: PendingAttachment): void {
    card.classList.toggle("uploading", att.status === "uploading");
    card.classList.toggle("failed", att.status === "failed");
    card.title = att.status === "failed" ? att.error ?? "Upload failed" : "";
    const retry = card.querySelector<HTMLButtonElement>(".attach-retry");
    if (retry) retry.hidden = att.status !== "failed";
}

/** Brings the tray's cards in line with `pendingAttachments` (add, update, remove, order). */
function renderAttachmentTray(): void {
    for (const [id, el] of attachmentCardEls) {
        if (!pendingAttachments.some((a) => a.id === id)) {
            el.remove();
            attachmentCardEls.delete(id);
        }
    }
    pendingAttachments.forEach((att, i) => {
        let card = attachmentCardEls.get(att.id);
        if (!card) {
            card = createAttachmentCard(att);
            attachmentCardEls.set(att.id, card);
        }
        updateAttachmentCard(card, att);
        if (attachmentTray.children[i] !== card) attachmentTray.insertBefore(card, attachmentTray.children[i] ?? null);
    });
    attachmentTray.classList.toggle("has-items", pendingAttachments.length > 0);
    // Send stays clickable (it explains itself with a toast) but looks disabled
    // while any image is still uploading or has failed.
    btnSend.classList.toggle("blocked", pendingAttachments.some((a) => a.status !== "ready"));
}

// ── Drag & drop images onto the chat (PRD 16.10) ────────────────────────────

const dragHasFiles = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
const canDropImages = (): boolean => isConnected && activeTabId !== "server-log";
let dragDepth = 0; // enter/leave counter: child elements fire their own leave events

function resetDropZone(): void {
    dragDepth = 0;
    chatDropOverlay.classList.remove("visible");
}

// Always-on guard: Chromium's default for a dropped file is to NAVIGATE the
// window to it, which would replace the whole app. Only drags that carry
// files are touched — text/HTML drags, including the channel tree's own
// reorder drag (text/plain), are left alone.
document.addEventListener("dragover", (e) => {
    if (dragHasFiles(e)) e.preventDefault();
});
document.addEventListener("drop", (e) => {
    if (dragHasFiles(e)) e.preventDefault();
    resetDropZone();
});
document.addEventListener("dragend", resetDropZone);
window.addEventListener("blur", resetDropZone);

rightPane.addEventListener("dragenter", (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    if (canDropImages()) chatDropOverlay.classList.add("visible");
});
rightPane.addEventListener("dragover", (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = canDropImages() ? "copy" : "none";
});
rightPane.addEventListener("dragleave", (e) => {
    if (!dragHasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) chatDropOverlay.classList.remove("visible");
});
rightPane.addEventListener("drop", (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files ?? []);
    resetDropZone();
    if (canDropImages()) addFiles(files);
});

// ── Lightbox (PRD 15.9) ────────────────────────────────────────────────
//
// The image is laid out once at its NATURAL pixel size, centred in the stage,
// and zoomed/panned purely through `transform: translate() scale()` — no
// layout work per frame, animated GIFs keep animating, and no re-decode.
// Scale is a fraction of natural size: the lowest zoom is "fit to window"
// (never upscaling small images, as before) and the highest is 200%.

interface LightboxMeta {
    senderNickname?: string;
    sentAt?: string;
    /** A preview of a picked, not-yet-sent image (PRD 16.10): zoom/pan/close only — no copy/link/open/download, no "sent by". */
    previewOnly?: boolean;
}

const LIGHTBOX_MAX_SCALE = 2; // 200% of the image's natural pixel size
const LIGHTBOX_FIT_MARGIN = 0.9; // fitted image fills at most 90% of the stage (as the old 90vw/90vh)
const LIGHTBOX_ZOOM_STOPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const LIGHTBOX_EPS = 0.001;

const lightboxStage = document.getElementById("lightbox-stage") as HTMLDivElement;
const lightboxSender = document.getElementById("lightbox-sender") as HTMLDivElement;
const lightboxZoomIndicator = document.getElementById("lightbox-zoom-indicator") as HTMLDivElement;
const btnLightboxZoomIn = document.getElementById("btn-lightbox-zoom-in") as HTMLButtonElement;
const btnLightboxZoomOut = document.getElementById("btn-lightbox-zoom-out") as HTMLButtonElement;
const btnLightboxCopyImage = document.getElementById("btn-lightbox-copy-image") as HTMLButtonElement;
const btnLightboxCopyLink = document.getElementById("btn-lightbox-copy-link") as HTMLButtonElement;
const btnLightboxOpenBrowser = document.getElementById("btn-lightbox-open-browser") as HTMLButtonElement;

const lightbox = {
    url: "",
    naturalW: 0,
    naturalH: 0,
    fit: 1,
    scale: 1,
    tx: 0,
    ty: 0,
    dragging: false,
    dragMoved: false,
    dragStartX: 0,
    dragStartY: 0,
    dragOriginTx: 0,
    dragOriginTy: 0,
    suppressClick: false,
    indicatorTimer: null as ReturnType<typeof setTimeout> | null,
    busy: false,
};

function lightboxStageSize(): { w: number; h: number } {
    return { w: lightboxStage.clientWidth, h: lightboxStage.clientHeight };
}

function lightboxComputeFit(): number {
    if (!lightbox.naturalW || !lightbox.naturalH) return 1;
    const { w, h } = lightboxStageSize();
    return Math.min(1, (w * LIGHTBOX_FIT_MARGIN) / lightbox.naturalW, (h * LIGHTBOX_FIT_MARGIN) / lightbox.naturalH);
}

/** Keeps the image from being dragged out of view: while it's smaller than
 *  the stage on an axis it stays centred, otherwise its edge may reach the
 *  stage edge but not pass it. */
function lightboxClampPan(): void {
    const { w, h } = lightboxStageSize();
    const maxX = Math.max(0, (lightbox.naturalW * lightbox.scale - w) / 2);
    const maxY = Math.max(0, (lightbox.naturalH * lightbox.scale - h) / 2);
    lightbox.tx = Math.min(maxX, Math.max(-maxX, lightbox.tx));
    lightbox.ty = Math.min(maxY, Math.max(-maxY, lightbox.ty));
}

function lightboxIsZoomed(): boolean {
    return lightbox.scale > lightbox.fit + LIGHTBOX_EPS;
}

function lightboxApply(animate: boolean): void {
    lightboxClampPan();
    lightboxImage.style.transition = animate ? "transform 0.12s ease-out, opacity 0.12s" : "opacity 0.12s";
    lightboxImage.style.transform = `translate(${lightbox.tx}px, ${lightbox.ty}px) scale(${lightbox.scale})`;
    lightboxImage.classList.toggle("zoomed", lightboxIsZoomed());
    btnLightboxZoomIn.disabled = lightbox.scale >= LIGHTBOX_MAX_SCALE - LIGHTBOX_EPS;
    btnLightboxZoomOut.disabled = !lightboxIsZoomed();
}

function lightboxShowZoomIndicator(): void {
    lightboxZoomIndicator.textContent = `${Math.round(lightbox.scale * 100)}%`;
    lightboxZoomIndicator.classList.add("visible");
    if (lightbox.indicatorTimer) clearTimeout(lightbox.indicatorTimer);
    lightbox.indicatorTimer = setTimeout(() => lightboxZoomIndicator.classList.remove("visible"), 900);
}

/** Zooms to `next`, keeping the point under `anchor` (stage-centre-relative
 *  px; defaults to the centre) fixed on screen. */
function lightboxSetScale(next: number, anchor = { x: 0, y: 0 }, animate = false): void {
    const clamped = Math.min(LIGHTBOX_MAX_SCALE, Math.max(lightbox.fit, next));
    const ratio = clamped / lightbox.scale;
    lightbox.tx = anchor.x - (anchor.x - lightbox.tx) * ratio;
    lightbox.ty = anchor.y - (anchor.y - lightbox.ty) * ratio;
    lightbox.scale = clamped;
    lightboxApply(animate);
    lightboxShowZoomIndicator();
}

/** The discrete zoom levels the buttons/keys step through: "fit", then the
 *  fixed percentages above it. */
function lightboxStops(): number[] {
    return [lightbox.fit, ...LIGHTBOX_ZOOM_STOPS.filter((v) => v > lightbox.fit + LIGHTBOX_EPS)];
}

function lightboxStepZoom(direction: 1 | -1): void {
    const stops = lightboxStops();
    const target = direction === 1
        ? stops.find((v) => v > lightbox.scale + LIGHTBOX_EPS)
        : [...stops].reverse().find((v) => v < lightbox.scale - LIGHTBOX_EPS);
    if (target !== undefined) lightboxSetScale(target, undefined, true);
}

function lightboxResetZoom(): void {
    lightbox.tx = 0;
    lightbox.ty = 0;
    lightboxSetScale(lightbox.fit, undefined, true);
}

function lightboxStagePoint(e: MouseEvent): { x: number; y: number } {
    const rect = lightboxStage.getBoundingClientRect();
    return { x: e.clientX - (rect.left + rect.width / 2), y: e.clientY - (rect.top + rect.height / 2) };
}

function openLightbox(imageUrl: string, meta?: LightboxMeta): void {
    lightbox.url = imageUrl;
    lightbox.scale = 1;
    lightbox.fit = 1;
    lightbox.tx = 0;
    lightbox.ty = 0;
    lightbox.naturalW = 0;
    lightbox.naturalH = 0;
    lightboxImage.classList.remove("ready", "zoomed", "dragging");
    imageLightboxModal.classList.toggle("preview-only", !!meta?.previewOnly);

    // "Sent by" pill — omitted entirely when a caller has no sender info.
    lightboxSender.textContent = "";
    if (meta?.senderNickname) {
        lightboxSender.append("Sent by ");
        const nick = document.createElement("strong");
        nick.textContent = meta.senderNickname;
        lightboxSender.appendChild(nick);
        if (meta.sentAt) {
            const when = document.createElement("span");
            when.className = "lightbox-sent-at";
            when.textContent = new Date(meta.sentAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
            lightboxSender.appendChild(when);
        }
        lightboxSender.hidden = false;
    } else {
        lightboxSender.hidden = true;
    }

    // Set before `src` so a cached image can't finish loading unobserved.
    lightboxImage.onload = () => {
        lightbox.naturalW = lightboxImage.naturalWidth;
        lightbox.naturalH = lightboxImage.naturalHeight;
        lightboxImage.style.width = `${lightbox.naturalW}px`;
        lightboxImage.style.height = `${lightbox.naturalH}px`;
        lightboxImage.style.marginLeft = `${-lightbox.naturalW / 2}px`;
        lightboxImage.style.marginTop = `${-lightbox.naturalH / 2}px`;
        lightbox.fit = lightboxComputeFit();
        lightbox.scale = lightbox.fit;
        lightbox.tx = 0;
        lightbox.ty = 0;
        lightboxApply(false);
        lightboxImage.classList.add("ready");
    };
    lightboxImage.onerror = () => showToast("Couldn't load the image");
    lightboxImage.src = imageUrl;
    imageLightboxModal.classList.add("visible");
    btnLightboxZoomIn.disabled = true;
    btnLightboxZoomOut.disabled = true;
}

function closeLightbox(): void {
    imageLightboxModal.classList.remove("visible", "preview-only");
    lightboxImage.onload = null;
    lightboxImage.onerror = null;
    lightboxImage.src = "";
    lightboxImage.classList.remove("ready", "zoomed", "dragging");
    lightboxZoomIndicator.classList.remove("visible");
    lightbox.url = "";
    lightbox.dragging = false;
}

imageLightboxModal.addEventListener("click", (e) => {
    if (lightbox.suppressClick) return; // the click that ended a pan-drag
    if (e.target === imageLightboxModal || e.target === lightboxStage) {
        closeLightbox();
    }
});

btnLightboxClose.addEventListener("click", () => {
    closeLightbox();
});

btnLightboxDownload.addEventListener("click", () => {
    const url = lightbox.url;
    if (url) {
        api.downloadImage(url);
    }
});

btnLightboxZoomIn.addEventListener("click", () => lightboxStepZoom(1));
btnLightboxZoomOut.addEventListener("click", () => lightboxStepZoom(-1));

btnLightboxCopyLink.addEventListener("click", async () => {
    if (!lightbox.url) return;
    const ok = await api.copyText(lightbox.url);
    showToast(ok ? "Image link copied" : "Couldn't copy the link");
});

btnLightboxOpenBrowser.addEventListener("click", async () => {
    if (!lightbox.url) return;
    const res = await api.openExternal(lightbox.url);
    if (!res.success) showToast(escapeHtml(res.error ?? "Couldn't open the link"));
});

/**
 * Copies the image itself. The bytes are fetched in the main process (no CORS
 * restrictions), decoded here and re-encoded as PNG — which also normalises
 * WebP/GIF (a GIF copies as its first frame) — then handed back to main to
 * place on the clipboard.
 */
btnLightboxCopyImage.addEventListener("click", async () => {
    const url = lightbox.url;
    if (!url || lightbox.busy) return;
    lightbox.busy = true;
    btnLightboxCopyImage.disabled = true;
    try {
        const res = await api.fetchImageBytes(url);
        if (!res.success || !res.bytes) throw new Error(res.error ?? "Couldn't fetch the image");
        const bitmap = await createImageBitmap(new Blob([res.bytes as Uint8Array<ArrayBuffer>]));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
        bitmap.close();
        const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!png) throw new Error("Couldn't convert the image");
        const ok = await api.copyPngToClipboard(new Uint8Array(await png.arrayBuffer()));
        if (!ok) throw new Error("Couldn't copy the image");
        showToast("Image copied to clipboard");
    } catch (err: any) {
        showToast(escapeHtml(err?.message ?? "Couldn't copy the image"));
    } finally {
        lightbox.busy = false;
        btnLightboxCopyImage.disabled = false;
    }
});

// Mouse wheel zooms toward the cursor.
imageLightboxModal.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (!lightbox.naturalW) return;
    lightboxSetScale(lightbox.scale * Math.exp(-e.deltaY * 0.002), lightboxStagePoint(e));
}, { passive: false });

// Double-click toggles between fit and 100% (or 200% for an image that is
// already shown at its natural size).
lightboxImage.addEventListener("dblclick", (e) => {
    if (!lightbox.naturalW) return;
    if (lightboxIsZoomed()) {
        lightboxResetZoom();
    } else {
        lightboxSetScale(lightbox.fit < 1 ? 1 : LIGHTBOX_MAX_SCALE, lightboxStagePoint(e), true);
    }
});

// Drag to pan while zoomed in.
lightboxImage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !lightboxIsZoomed()) return;
    lightbox.dragging = true;
    lightbox.dragMoved = false;
    lightbox.dragStartX = e.clientX;
    lightbox.dragStartY = e.clientY;
    lightbox.dragOriginTx = lightbox.tx;
    lightbox.dragOriginTy = lightbox.ty;
    lightboxImage.setPointerCapture(e.pointerId);
    lightboxImage.classList.add("dragging");
});

lightboxImage.addEventListener("pointermove", (e) => {
    if (!lightbox.dragging) return;
    const dx = e.clientX - lightbox.dragStartX;
    const dy = e.clientY - lightbox.dragStartY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) lightbox.dragMoved = true;
    lightbox.tx = lightbox.dragOriginTx + dx;
    lightbox.ty = lightbox.dragOriginTy + dy;
    lightboxApply(false);
});

function endLightboxDrag(e: PointerEvent): void {
    if (!lightbox.dragging) return;
    lightbox.dragging = false;
    lightboxImage.classList.remove("dragging");
    if (lightboxImage.hasPointerCapture(e.pointerId)) lightboxImage.releasePointerCapture(e.pointerId);
    if (lightbox.dragMoved) {
        // A drag must not count as a click on the backdrop (which closes).
        lightbox.suppressClick = true;
        setTimeout(() => { lightbox.suppressClick = false; }, 0);
    }
}
lightboxImage.addEventListener("pointerup", endLightboxDrag);
lightboxImage.addEventListener("pointercancel", endLightboxDrag);

// Keep the fitted size correct when the window is resized while open.
window.addEventListener("resize", () => {
    if (!imageLightboxModal.classList.contains("visible") || !lightbox.naturalW) return;
    const wasFit = !lightboxIsZoomed();
    lightbox.fit = lightboxComputeFit();
    lightbox.scale = wasFit ? lightbox.fit : Math.min(LIGHTBOX_MAX_SCALE, Math.max(lightbox.fit, lightbox.scale));
    lightboxApply(false);
});

// Keyboard zoom: + / - / 0. Only while the viewer is open, and handled keys
// are swallowed so they can't also reach a chat input underneath.
document.addEventListener("keydown", (e) => {
    if (!imageLightboxModal.classList.contains("visible") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        lightboxStepZoom(1);
    } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        lightboxStepZoom(-1);
    } else if (e.key === "0") {
        e.preventDefault();
        lightboxResetZoom();
    }
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && emojiPicker.classList.contains("visible")) {
        closeEmojiPicker();
    }
    if (e.key === "Escape" && imageLightboxModal.classList.contains("visible")) {
        closeLightbox();
    }
    if (e.key === "Escape" && videoLightboxModal.classList.contains("visible")) {
        closeVideoLightbox();
    }
});

// ── Reaction Helpers ──────────────────────────────────────────────────────

// Track reaction-mode state for the emoji picker
let reactionTargetMsgId: string | null = null;
let reactionTargetIsDm = false;

// ── Reaction hover card (PRD 15.11) ────────────────────────────────────────
//
// Hovering a reaction pill for 1s (pointer held still) shows a card with the
// emoji large, its name, and who reacted. One shared element, event
// delegation (pills are rebuilt on every REACTION_UPDATED), non-interactive.

const REACTION_CARD_DELAY_MS = 1000;
const REACTION_CARD_MOVE_TOLERANCE_PX = 4;
const REACTION_CARD_MAX_NAMES = 3;

/** Which reaction summary each pill element was built from. */
const reactionPillData = new WeakMap<HTMLElement, ReactionSummary>();

const reactionCard = document.createElement("div");
reactionCard.id = "reaction-card";
reactionCard.className = "reaction-card";
reactionCard.setAttribute("role", "tooltip");
document.body.appendChild(reactionCard);

let reactionCardPill: HTMLElement | null = null;
let reactionCardTimer: ReturnType<typeof setTimeout> | null = null;
let reactionCardAnchor = { x: 0, y: 0 };

/** Unicode emoji -> `:snake_case_name:`, built once from the picker's dataset
 *  (variation selectors stripped so "❤" and "❤️" resolve the same). */
let emojiNameLookup: Map<string, string> | null = null;

/** "face with tears of joy" -> "face_with_tears_of_joy" (shared by the reaction
 *  card and the emoji autocomplete, so both name an emoji identically). */
function toEmojiSnakeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function emojiShortName(emoji: string): string | null {
    if (!emojiNameLookup) {
        emojiNameLookup = new Map();
        for (const entry of EMOJI_DATA) {
            emojiNameLookup.set(entry.emoji.replace(/\uFE0F/g, ""), `:${toEmojiSnakeName(entry.name)}:`);
        }
    }
    return emojiNameLookup.get(emoji.replace(/\uFE0F/g, "")) ?? null;
}

/** The emoji's display name: a custom emoji's own `:name:`, a known unicode
 *  emoji's derived short name, or null when it can't be named. */
function reactionEmojiName(emoji: string): string | null {
    if (emoji.length > 2 && emoji.startsWith(":") && emoji.endsWith(":")) return emoji;
    return emojiShortName(emoji);
}

/** "A", "A and B", "A, B and C", "A, B, C and 2 others" — as DOM nodes so
 *  nicknames are never parsed as HTML. */
function buildReactorsText(summary: ReactionSummary): Node[] {
    const myId = api.getInstanceId();
    const users = summary.users ?? [];
    if (users.length === 0) {
        return [document.createTextNode(`${summary.count} ${summary.count === 1 ? "person" : "people"}`)];
    }

    const nameNode = (u: { userId: string; nickname: string }): HTMLElement => {
        const strong = document.createElement("strong");
        strong.textContent = u.userId === myId ? "You" : u.nickname;
        return strong;
    };
    const shown = users.slice(0, REACTION_CARD_MAX_NAMES);
    const others = summary.count - shown.length;
    const nodes: Node[] = [];

    shown.forEach((u, i) => {
        if (i > 0) {
            const last = i === shown.length - 1 && others <= 0;
            nodes.push(document.createTextNode(last ? " and " : ", "));
        }
        nodes.push(nameNode(u));
    });
    if (others > 0) {
        nodes.push(document.createTextNode(" and "));
        const rest = document.createElement("span");
        rest.className = "reaction-card-others";
        rest.textContent = `${others} other${others === 1 ? "" : "s"}`;
        nodes.push(rest);
    }
    return nodes;
}

function hideReactionCard(): void {
    if (reactionCardTimer) {
        clearTimeout(reactionCardTimer);
        reactionCardTimer = null;
    }
    reactionCard.classList.remove("visible");
    reactionCardPill?.removeAttribute("aria-describedby");
    reactionCardPill = null;
}

function showReactionCard(pill: HTMLElement): void {
    const summary = reactionPillData.get(pill);
    if (!summary || !pill.isConnected) return;

    reactionCard.textContent = "";

    const big = document.createElement("div");
    big.className = "reaction-card-emoji";
    big.innerHTML = renderEmojiToken(summary.emoji); // escaped / <img> only for known custom emoji
    reactionCard.appendChild(big);

    const text = document.createElement("div");
    text.className = "reaction-card-text";
    for (const node of buildReactorsText(summary)) text.appendChild(node);
    const name = reactionEmojiName(summary.emoji);
    text.appendChild(document.createTextNode(name ? " reacted with " : " reacted"));
    if (name) {
        const nameEl = document.createElement("span");
        nameEl.className = "reaction-card-name";
        nameEl.textContent = name;
        text.appendChild(nameEl);
    }
    reactionCard.appendChild(text);

    // Position above the pill, centred, flipped below when there's no room
    // and clamped so it never leaves the window.
    reactionCard.style.left = "0px";
    reactionCard.style.top = "0px";
    const cardRect = reactionCard.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(
        window.innerWidth - cardRect.width - margin,
        Math.max(margin, pillRect.left + pillRect.width / 2 - cardRect.width / 2),
    );
    let top = pillRect.top - cardRect.height - margin;
    if (top < margin) top = pillRect.bottom + margin;
    reactionCard.style.left = `${left}px`;
    reactionCard.style.top = `${top}px`;

    reactionCardPill = pill;
    pill.setAttribute("aria-describedby", reactionCard.id);
    reactionCard.classList.add("visible");
}

function startReactionCardDwell(pill: HTMLElement): void {
    if (reactionCardTimer) clearTimeout(reactionCardTimer);
    reactionCardTimer = setTimeout(() => {
        reactionCardTimer = null;
        showReactionCard(pill);
    }, REACTION_CARD_DELAY_MS);
}

function reactionPillFrom(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element ? (target.closest(".reaction-pill") as HTMLElement | null) : null;
}

document.addEventListener("mouseover", (e) => {
    const pill = reactionPillFrom(e.target);
    if (!pill || pill === reactionCardPill) return;
    hideReactionCard();
    reactionCardAnchor = { x: e.clientX, y: e.clientY };
    reactionCardPill = pill; // tracks the pill under the pointer while the dwell runs
    startReactionCardDwell(pill);
});

document.addEventListener("mousemove", (e) => {
    // Only while the dwell is still pending: "hover still" means the pointer
    // moving more than a few px restarts the wait. Once shown, it stays.
    if (!reactionCardTimer || !reactionCardPill) return;
    if (!reactionPillFrom(e.target)) return;
    const moved = Math.hypot(e.clientX - reactionCardAnchor.x, e.clientY - reactionCardAnchor.y);
    if (moved > REACTION_CARD_MOVE_TOLERANCE_PX) {
        reactionCardAnchor = { x: e.clientX, y: e.clientY };
        startReactionCardDwell(reactionCardPill);
    }
});

document.addEventListener("mouseout", (e) => {
    const pill = reactionPillFrom(e.target);
    if (!pill) return;
    const into = e.relatedTarget instanceof Node ? e.relatedTarget : null;
    if (into && pill.contains(into)) return; // moving between the pill's own children
    hideReactionCard();
});

// Keyboard users get it too, immediately (no dwell).
document.addEventListener("focusin", (e) => {
    const pill = reactionPillFrom(e.target);
    if (pill && (e.target as HTMLElement).matches(":focus-visible")) {
        hideReactionCard();
        showReactionCard(pill);
    }
});
document.addEventListener("focusout", (e) => {
    if (reactionPillFrom(e.target)) hideReactionCard();
});

document.addEventListener("click", (e) => {
    if (reactionPillFrom(e.target)) hideReactionCard(); // toggling a reaction
}, true);
document.addEventListener("scroll", () => hideReactionCard(), true);
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideReactionCard();
});
window.addEventListener("blur", hideReactionCard);

// Coming back to the window reads the DM conversation you were left looking at (PRD 18.13).
window.addEventListener("focus", () => {
    scheduleDmSidebarRender(); // PRD 19 C7
    const tab = chatTabs.get(activeTabId);
    if (tab?.kind === "dm") markDmTabRead(tab);
    if (tab?.kind === "channel") markChannelTabRead(tab); // PRD 19 B3
    for (const [id, t] of chatTabs) if (t.kind === "dm") refreshTabUnread(id);
});
window.addEventListener("blur", () => {
    scheduleDmSidebarRender(); // PRD 19 C7
    // The active DM tab is no longer "looked at": a message arriving now shows its dot.
    for (const [id, t] of chatTabs) if (t.kind === "dm") refreshTabUnread(id);
});

const REACT_ICON_SVG = `<i class="ph ph-smiley" aria-hidden="true"></i>`; // PRD 19 R2: Phosphor

/**
 * The reaction strip: only the reaction pills (plus a trailing "add
 * reaction" button once at least one exists). With no reactions it is
 * hidden by CSS and takes no space — the actions themselves live in the
 * floating toolbar from buildMessageActions() (PRD 16.5).
 */
function buildReactionBar(
    msgId: string,
    isDm: boolean,
    reactions?: ReactionSummary[],
): HTMLDivElement {
    // A bar being (re)built means any open hover card may now describe a
    // pill that is about to be replaced — close it rather than show stale data.
    hideReactionCard();

    const bar = document.createElement("div");
    bar.className = "msg-reactions";
    bar.setAttribute("data-react-bar", msgId);

    const myId = api.getInstanceId();

    if (reactions && reactions.length > 0) {
        bar.classList.add("has-reactions");
        for (const r of reactions) {
            const pill = document.createElement("button");
            pill.className = "reaction-pill" + (r.userIds.includes(myId) ? " mine" : "");
            pill.innerHTML = `${renderEmojiToken(r.emoji)} <span class="reaction-count">${r.count}</span>`;
            // No native `title`: the hover card (PRD 15.11) replaces it, and
            // both at once would double up.
            reactionPillData.set(pill, r);
            pill.addEventListener("click", (e) => {
                e.stopPropagation();
                api.toggleReaction(msgId, r.emoji, isDm);
            });
            bar.appendChild(pill);
        }

        // Quick "add another reaction" — the usual chat-app affordance once
        // the strip is visible anyway.
        const btnAdd = document.createElement("button");
        btnAdd.className = "reaction-add-btn";
        btnAdd.innerHTML = REACT_ICON_SVG;
        btnAdd.title = "Add reaction";
        btnAdd.setAttribute("aria-label", "Add reaction");
        btnAdd.addEventListener("click", (e) => {
            e.stopPropagation();
            openReactionPicker(msgId, isDm, btnAdd);
        });
        bar.appendChild(btnAdd);
    }

    return bar;
}

/**
 * The floating hover toolbar (PRD 16.5), left to right: React, [Reply —
 * PRD 16.11], Edit (own, in-window), Pin (channels), Delete (own). This
 * builds React and Delete; attachEditButton()/attachPinButton() slot theirs
 * in before Delete so the order is deterministic regardless of call order.
 */
function buildMessageActions(msgId: string, isDm: boolean, ownerId: string, authorNickname: string, tabId: string): HTMLDivElement {
    const toolbar = document.createElement("div");
    toolbar.className = "msg-actions";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Message actions");

    const btnReact = document.createElement("button");
    btnReact.type = "button";
    btnReact.className = "btn-react";
    btnReact.innerHTML = REACT_ICON_SVG;
    btnReact.title = "Add reaction";
    btnReact.setAttribute("aria-label", "Add reaction");
    btnReact.addEventListener("click", (e) => {
        e.stopPropagation();
        openReactionPicker(msgId, isDm, btnReact);
    });
    toolbar.appendChild(btnReact);

    // Reply (PRD 16.11) — right after React; Edit/Pin slot in before Delete.
    const btnReply = document.createElement("button");
    btnReply.type = "button";
    btnReply.className = "btn-reply-msg";
    btnReply.innerHTML = REPLY_ICON_SVG;
    btnReply.title = "Reply";
    btnReply.setAttribute("aria-label", "Reply");
    btnReply.addEventListener("click", (e) => {
        e.stopPropagation();
        startReply(tabId, msgId, authorNickname);
    });
    toolbar.appendChild(btnReply);

    // Delete button — own messages only (PRD 4.10)
    if (ownerId === api.getInstanceId()) {
        const btnDelete = document.createElement("button");
        btnDelete.type = "button";
        btnDelete.className = "btn-delete-msg";
        btnDelete.innerHTML = `<i class="ph ph-trash" aria-hidden="true"></i>`;
        btnDelete.title = "Delete message";
        btnDelete.setAttribute("aria-label", "Delete message");
        btnDelete.addEventListener("click", (e) => {
            e.stopPropagation();
            showDeleteMessageModal(msgId, isDm);
        });
        toolbar.appendChild(btnDelete);
    }

    return toolbar;
}

/** Inserts a toolbar button just before Delete (or at the end when there is none). */
function insertToolbarButton(toolbar: HTMLDivElement, button: HTMLButtonElement): void {
    toolbar.insertBefore(button, toolbar.querySelector(".btn-delete-msg"));
}

// A message at the very top of the scroll area would clip its toolbar (it
// floats ~14px above the message), so tuck it inside for those rows instead.
let toolbarHoverMsg: Element | null = null;
document.addEventListener("mouseover", (e) => {
    if (!(e.target instanceof Element)) return;
    const msg = e.target.closest(".chat-msg");
    if (!msg || msg === toolbarHoverMsg) return;
    toolbarHoverMsg = msg;
    const container = msg.parentElement;
    if (!container) return;
    const room = msg.getBoundingClientRect().top - container.getBoundingClientRect().top;
    msg.classList.toggle("actions-inside", room < 18);
});

function openReactionPicker(msgId: string, isDm: boolean, anchor: HTMLElement): void {
    reactionTargetMsgId = msgId;
    reactionTargetIsDm = isDm;

    // Keep this message's toolbar showing while its picker is open, so it
    // doesn't vanish as the pointer moves into the picker (PRD 16.5).
    document.querySelectorAll(".chat-msg.actions-open").forEach((m) => m.classList.remove("actions-open"));
    anchor.closest(".chat-msg")?.classList.add("actions-open");

    // Position the emoji picker near the anchor button
    const rect = anchor.getBoundingClientRect();
    emojiPicker.style.position = "fixed";
    emojiPicker.style.bottom = "auto";
    emojiPicker.style.left = `${rect.left}px`;
    emojiPicker.style.top = `${Math.max(4, rect.top - 390)}px`;

    emojiPicker.classList.add("visible");
    // The toolbar sits at the message's right edge, so the picker's left edge
    // can land past the window — pull it back inside once its width is known.
    const maxLeft = window.innerWidth - emojiPicker.offsetWidth - 8;
    emojiPicker.style.left = `${Math.max(8, Math.min(rect.left, maxLeft))}px`;
    emojiSearch.value = "";
    renderEmojiGrid();
    buildEmojiCategoryTabs();
    emojiSearch.focus();
}

function updateReactionBar(
    msgId: string,
    isDm: boolean,
    reactions: ReactionSummary[],
): void {
    // Find all reaction bars for this message (could be in multiple open tabs)
    const bars = document.querySelectorAll(`[data-react-bar="${msgId}"]`);
    for (const bar of bars) {
        const parent = bar.parentElement;
        if (!parent) continue;
        // The bar holds only reactions now (owner-only buttons moved to the
        // toolbar, which isn't rebuilt), so no owner lookup is needed.
        const newBar = buildReactionBar(msgId, isDm, reactions);
        parent.replaceChild(newBar, bar);
    }
}

// Listen for reaction updates from server
api.on("reaction-updated", (data: { messageId: string; isDm: boolean; reactions: ReactionSummary[] }) => {
    updateReactionBar(data.messageId, data.isDm, data.reactions);
});

// ── Edit Own Messages (PRD 4.11) ────────────────────────────────────────────
// Channel messages only (not DMs), text-only (no attachment), within 2
// minutes of sending — all enforced authoritatively server-side; the checks
// here are just so the user gets immediate feedback instead of a silent
// round-trip failure.
const EDIT_WINDOW_MS = 2 * 60 * 1000;

function attachEditButton(toolbar: HTMLDivElement, msg: ChatMessage, el: HTMLDivElement): void {
    const myId = api.getInstanceId();
    if (msg.userId !== myId || msg.attachmentUrl || (msg.attachments?.length ?? 0) > 0) return;

    // Previously always rendered the button and only checked the window on
    // click, surfacing the server's own rejection as an error log — the
    // button should simply not be there once editing is no longer
    // actually possible, not invite a click that's guaranteed to fail.
    const remainingMs = EDIT_WINDOW_MS - (Date.now() - new Date(msg.createdAt).getTime());
    if (remainingMs <= 0) return;

    const btnEdit = document.createElement("button");
    btnEdit.className = "btn-edit-msg";
    btnEdit.innerHTML = `<i class="ph ph-pencil-simple" aria-hidden="true"></i>`;
    btnEdit.title = "Edit message";
    btnEdit.addEventListener("click", (e) => {
        e.stopPropagation();
        const ageMs = Date.now() - new Date(msg.createdAt).getTime();
        if (ageMs > EDIT_WINDOW_MS) {
            log("Edit window has expired (2 minutes)", "error");
            btnEdit.remove();
            return;
        }
        startMessageEdit(el, msg);
    });
    btnEdit.type = "button";
    btnEdit.setAttribute("aria-label", "Edit message");
    insertToolbarButton(toolbar, btnEdit);

    // A message rendered well inside its edit window can still go stale
    // while the channel stays open (e.g. rendered at 30s old, the channel
    // sits open past the 2-minute mark) — remove the button exactly when
    // that happens instead of only gating it at initial render.
    setTimeout(() => btnEdit.remove(), remainingMs);
}

// ── Pinned Messages (PRD 11.5) ──────────────────────────────────────────────
// Pin/unpin is gated server-side by MANAGE_CHANNELS (requirePermission()),
// matching the existing rename/delete/NSFW-toggle channel context-menu
// convention — the button is shown to everyone and the server rejects
// unauthorized attempts, rather than hiding it behind a client-side
// permission cache (see channel.handler.ts's UPDATE_CHANNEL for the
// precedent this follows).

const PIN_ICON_SVG = `<i class="ph ph-push-pin" aria-hidden="true"></i>`; // PRD 19 R2: Phosphor

let pendingPinReplaceAction: (() => void) | null = null;

function attachPinButton(toolbar: HTMLDivElement, msg: ChatMessage, tab: ChatTab): void {
    const btnPin = document.createElement("button");
    btnPin.className = "btn-pin-msg";
    btnPin.innerHTML = PIN_ICON_SVG;
    const isPinned = tab.pinnedMessageId === msg.id;
    btnPin.classList.toggle("active", isPinned);
    btnPin.title = isPinned ? "Unpin message" : "Pin message";

    btnPin.addEventListener("click", async (e) => {
        e.stopPropagation();

        if (tab.pinnedMessageId === msg.id) {
            const result = await api.unpinMessage(tab.channelId);
            if (!result.success) {
                log(`Failed to unpin message: ${result.error}`, "error");
                if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
            }
            return;
        }

        const doPin = async (): Promise<void> => {
            const result = await api.pinMessage(tab.channelId, msg.id);
            if (!result.success) {
                log(`Failed to pin message: ${result.error}`, "error");
                if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
            }
        };

        if (tab.pinnedMessageId) {
            pendingPinReplaceAction = doPin;
            pinReplaceConfirmModal.classList.add("visible");
        } else {
            await doPin();
        }
    });

    btnPin.type = "button";
    btnPin.setAttribute("aria-label", btnPin.title);
    insertToolbarButton(toolbar, btnPin);
}

/** Updates a tab's pin bar + the affected message pin buttons' active state. */
function updatePinBarUI(tab: ChatTab, pinnedMessage: PinnedMessage | null): void {
    const oldPinnedId = tab.pinnedMessageId;
    tab.pinnedMessageId = pinnedMessage?.id ?? null;

    for (const id of new Set([oldPinnedId, tab.pinnedMessageId])) {
        if (!id) continue;
        const msgEl = tab.messagesEl.querySelector(`.chat-msg[data-msg-id="${id}"]`);
        if (!msgEl) continue;
        const active = id === tab.pinnedMessageId;
        msgEl.classList.toggle("is-pinned", active);
        const btn = msgEl.querySelector(".btn-pin-msg");
        if (btn) {
            btn.classList.toggle("active", active);
            btn.setAttribute("title", active ? "Unpin message" : "Pin message");
            btn.setAttribute("aria-label", active ? "Unpin message" : "Pin message");
        }
    }

    if (!tab.pinBarEl) return;
    if (pinnedMessage) {
        const textEl = tab.pinBarEl.querySelector(".pinned-bar-text") as HTMLSpanElement;
        // One line of plain text — never raw Markdown syntax or line breaks.
        const plain = api.markdownToPlainText(pinnedMessage.content);
        const preview = plain.length > 100 ? `${plain.slice(0, 100)}…` : plain;
        textEl.textContent = preview || "(attachment only)";
        const authorEl = tab.pinBarEl.querySelector(".pinned-bar-author");
        if (authorEl) authorEl.textContent = pinnedMessage.authorNickname ?? ""; // PRD 19 R2
        tab.pinBarEl.dataset.pinnedMsgId = pinnedMessage.id;
        tab.pinBarEl.classList.add("visible");
    } else {
        tab.pinBarEl.classList.remove("visible");
        delete tab.pinBarEl.dataset.pinnedMsgId;
    }
}

/**
 * Scrolls to and briefly highlights a message in a tab, fetching a window
 * around it first if it isn't within the currently-loaded page. Serves the
 * pinned-message bar (PRD 11.5) and reply snippets (PRD 16.11), in channels
 * AND DMs.
 */
async function jumpToMessage(tabId: string, messageId: string): Promise<void> {
    const tab = chatTabs.get(tabId);
    if (!tab) return;
    const isDm = tabId.startsWith("dm:");
    const selector = `.chat-msg[data-msg-id="${CSS.escape(messageId)}"]`;

    let el = tab.messagesEl.querySelector(selector) as HTMLDivElement | null;
    if (el) {
        // Already loaded: a smooth scroll reads well over a short distance.
        tab.followBottom = false;
        const target = el;
        smoothScroll(tab, () => target.scrollIntoView({ behavior: "smooth", block: "center" }));
        highlightMessage(el);
        return;
    }

    // Not loaded: fetch a window around it and land on it (PRD 17.8). While
    // this runs, neither sentinel may load pages — a prepend's scroll
    // correction would cancel the landing (the bug's H1 path).
    tab.jumpInProgress = true;
    tab.followBottom = false; // a jump window is not the live bottom (PRD 18.12)
    tab.holdTarget = null;
    const result = isDm
        ? await api.fetchDirectMessages(tabId.slice(3), undefined, JUMP_WINDOW_SIZE, messageId)
        : await api.fetchMessages(tabId, undefined, JUMP_WINDOW_SIZE, messageId);
    if (!result.success || !result.messages) {
        tab.jumpInProgress = false;
        log("Couldn't load that message — it may have been deleted", "error");
        return;
    }

    tab.messagesEl.innerHTML = "";
    tab.lastRenderedDateKey = undefined;
    // The wipe above also destroyed both pagination sentinels (PRD 14.2/
    // 14.3) — rebuild them in order (top, then bottom) so messages inserted
    // via `bottomSentinelEl.insertAdjacentElement("beforebegin", …)` land
    // correctly between them.
    tab.oldestRenderedDateKey = undefined;
    tab.oldestLoadedTimestamp = undefined;
    tab.newestLoadedTimestamp = undefined;
    tab.messagesEl.appendChild(tab.topSentinelEl);
    tab.messagesEl.appendChild(tab.bottomSentinelEl);
    tab.loadingOlder = false;
    tab.loadingNewer = false;
    // A 2.6.0+ server says exactly what lies beyond the window; for an older
    // one, assume more on both sides (the pre-17.8 behavior).
    tab.hasMoreOlder = result.hasMoreBefore ?? true;
    tab.atTrueLatest = result.hasMoreAfter === undefined ? false : !result.hasMoreAfter;

    // stick: false — the window is NOT the live bottom; following the bottom
    // here (and again as images load) was the bug's actual cause (H2).
    if (isDm) {
        for (const msg of result.messages as DirectMessage[]) renderDmMessage(tab, msg, { stick: false });
    } else {
        for (const msg of result.messages as ChatMessage[]) renderChatMessage(tab, msg, { stick: false });
    }

    el = tab.messagesEl.querySelector(selector) as HTMLDivElement | null;
    if (el) {
        // Instant: there's nothing meaningful to animate across in a list
        // that was just rebuilt.
        const landed = el;
        setScroll(tab, () => landed.scrollIntoView({ behavior: "instant", block: "center" }));
        holdJumpTarget(tab, el);
        highlightMessage(el);
    }

    // Let the landing settle, then hand the sentinels back.
    let released = false;
    const release = (): void => {
        if (released) return;
        released = true;
        tab.jumpInProgress = false;
        setJumpToRecentVisible(tab, !tab.atTrueLatest || !isNearBottom(tab.messagesEl));
        ensureHistoryFilled(tab);
    };
    tab.messagesEl.addEventListener("scrollend", release, { once: true });
    setTimeout(release, 600);
}

pinReplaceConfirmModal.addEventListener("click", (e) => {
    if (e.target === pinReplaceConfirmModal) {
        pinReplaceConfirmModal.classList.remove("visible");
        pendingPinReplaceAction = null;
    }
});

btnPinReplaceCancel.addEventListener("click", () => {
    pinReplaceConfirmModal.classList.remove("visible");
    pendingPinReplaceAction = null;
});

btnPinReplaceConfirm.addEventListener("click", async () => {
    pinReplaceConfirmModal.classList.remove("visible");
    const action = pendingPinReplaceAction;
    pendingPinReplaceAction = null;
    if (action) await action();
});

// ── Watch Screen Share Confirmation Modal (PRD 12.13) ───────────────────────

watchShareConfirmModal.addEventListener("click", (e) => {
    if (e.target === watchShareConfirmModal) {
        watchShareConfirmModal.classList.remove("visible");
        pendingWatchShare = null;
    }
});

btnWatchShareCancel.addEventListener("click", () => {
    watchShareConfirmModal.classList.remove("visible");
    pendingWatchShare = null;
});

btnWatchShareConfirm.addEventListener("click", async () => {
    watchShareConfirmModal.classList.remove("visible");
    const target = pendingWatchShare;
    pendingWatchShare = null;
    if (!target) return;

    await startStageWatch(target); // PRD 19 C10: the stream plays in the voice room tab
});

// ── Screen Share Selection Modal (PRD 12.10) ────────────────────────────────

/** The picker's single grid for the chosen tab (PRD 20 S1). */
function renderSourceGrid(): void {
    sourceShareGroups.textContent = "";
    const list = shareSources.filter((s) => s.sourceType === shareTab);
    if (list.length === 0) {
        const empty = document.createElement("div");
        empty.className = "source-share-empty";
        empty.textContent = shareTab === "screen" ? "No screens available." : "No windows available.";
        sourceShareGroups.appendChild(empty);
        return;
    }
    for (const source of list) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "source-share-card" + (selectedShareSource?.id === source.id ? " selected" : "");
        const thumb = document.createElement("img");
        thumb.className = "source-share-card-thumb";
        thumb.src = source.thumbnail;
        thumb.alt = "";
        const foot = document.createElement("div");
        foot.className = "source-share-card-foot";
        if (source.appIcon) {
            const icon = document.createElement("img");
            icon.className = "source-share-card-icon";
            icon.src = source.appIcon;
            icon.alt = "";
            foot.appendChild(icon);
        } else {
            const icon = document.createElement("i");
            icon.className = `ph ${source.sourceType === "screen" ? "ph-monitor" : "ph-app-window"} source-share-card-ph`;
            icon.setAttribute("aria-hidden", "true");
            foot.appendChild(icon);
        }
        const text = document.createElement("div");
        text.className = "source-share-card-text";
        const name = document.createElement("div");
        name.className = "source-share-card-name";
        name.textContent = source.name;
        const sub = document.createElement("div");
        sub.className = "source-share-card-sub";
        sub.textContent = shareProcessNames[source.id] ?? (source.sourceType === "screen" ? "Screen" : "Window");
        text.append(name, sub);
        foot.appendChild(text);
        const check = document.createElement("span");
        check.className = "source-share-check";
        check.innerHTML = '<i class="ph ph-check" aria-hidden="true"></i>';
        card.append(thumb, foot, check);
        card.addEventListener("click", () => selectShareSource(source, card));
        sourceShareGroups.appendChild(card);
    }
}

function setShareTab(tab: "screen" | "window"): void {
    shareTab = tab;
    document.querySelectorAll<HTMLButtonElement>("#source-share-tabs .seg-opt").forEach((b) => b.classList.toggle("active", b.dataset.sourceTab === tab));
    renderSourceGrid();
}

document.querySelectorAll<HTMLButtonElement>("#source-share-tabs .seg-opt").forEach((b) =>
    b.addEventListener("click", () => setShareTab(b.dataset.sourceTab === "window" ? "window" : "screen")),
);

function updateSharePreview(): void {
    const el = document.getElementById("source-share-preview")!;
    const name = sourceShareNameInput.value.trim() || selectedShareSource?.name || "";
    el.textContent = selectedShareSource ? `Others will see: ${name}` : "Choose a screen or window";
    sourceShareNameInput.placeholder = selectedShareSource
        ? `Leave blank to use “${selectedShareSource.name}”`
        : "Leave blank to use the source's own name";
}
sourceShareNameInput.addEventListener("input", updateSharePreview);

// Fetched once per modal open (PRD 12.11), not per selection — a
// machine-wide fact, not something that varies per source.
let audioCaptureSupported = false;

/**
 * Full Share-Audio checkbox gating (PRD 12.11's business-rule table).
 * macOS is checked ahead of the generic `audioCaptureSupported` flag so it
 * gets its own Apple-specific explanation rather than the generic one —
 * both cases report `platformSupportsAudioCapture() === false` at the
 * native layer, so platform is the only way to tell them apart client-side.
 * There's no separate per-target "would capture actually work for this
 * specific window" check: native-audio's `platformSupportsCapture()`
 * already determines pre-19041 Windows / ALSA-only Linux machine-wide, not
 * per-window (see main.ts's `platform-supports-audio-capture` handler) —
 * a real per-target failure only surfaces when `startCapture()` is
 * actually attempted, handled separately at "Start Sharing" time.
 */
function updateShareAudioCheckboxState(source: DesktopSource): void {
    let enabled: boolean;
    let desc: string;

    if (api.platform === "darwin") {
        enabled = false;
        desc = "macOS does not support per-application audio capture — only video will be shared.";
    } else if (source.sourceType !== "window") {
        enabled = false;
        desc = "Not available when sharing an entire screen — pick a window instead";
    } else if (!audioCaptureSupported) {
        enabled = false;
        desc = "Audio capture isn't available for this window on your system.";
    } else {
        enabled = true;
        desc = `Only sound from ${source.name}`;
    }

    sourceShareAudioCheckbox.disabled = !enabled;
    if (!enabled) sourceShareAudioCheckbox.checked = false;
    sourceShareAudioDesc.textContent = desc;
}

function selectShareSource(source: DesktopSource, cardEl: HTMLElement): void {
    selectedShareSource = source;
    sourceShareGroups.querySelectorAll(".source-share-card.selected").forEach((el) => {
        el.classList.remove("selected");
    });
    cardEl.classList.add("selected");
    btnScreenShareStart.disabled = false;
    updateShareAudioCheckboxState(source);
    updateSharePreview();
}

async function openScreenShareModal(): Promise<void> {
    selectedShareSource = null;
    const roomName = currentChannelId ? findChannelNodeById(currentTree, currentChannelId)?.name : null;
    (document.getElementById("screen-share-sub") as HTMLElement).textContent = roomName
        ? `Everyone in ${roomName} will be able to watch.`
        : "Everyone in your voice room will be able to watch."; // PRD 19 R5
    btnScreenShareStart.disabled = true;
    sourceShareAudioCheckbox.disabled = true;
    sourceShareAudioCheckbox.checked = false;
    sourceShareAudioDesc.textContent = "Pick a window to share its sound";
    sourceShareNameInput.value = "";
    shareSources = [];
    shareProcessNames = {};
    updateSharePreview();

    sourceShareGroups.innerHTML = "";
    const loading = document.createElement("div");
    loading.className = "source-share-empty";
    loading.textContent = "Loading sources…";
    sourceShareGroups.appendChild(loading);
    screenShareModal.classList.add("visible");

    // Re-fetched on every open — sources can appear/disappear as windows
    // open/close, so a cached list would go stale. Run alongside the
    // audio-capability check rather than after it — `getDesktopSources()`
    // can be slow (on Linux/Wayland it may wait on an OS-level consent
    // dialog, see PRD 12.10), and there's no reason the fast native check
    // should wait behind that.
    //
    // That OS-level consent dialog is also the one place this call can fail
    // outright rather than just come back empty — the user cancelling it,
    // closing it, or (on some Linux/Wayland setups) the desktop portal
    // itself hiccuping all surface as `getDesktopSources()` resolving with
    // `success: false` (PRD 12 wrap-up). Without handling that, this modal
    // would sit on "Loading sources…" forever with no way to know why.
    const [, sourcesRes] = await Promise.all([
        api.platformSupportsAudioCapture().then((supported) => {
            audioCaptureSupported = supported;
        }),
        api.getDesktopSources(),
    ]);
    sourceShareGroups.innerHTML = "";

    if (!sourcesRes.success || !sourcesRes.sources) {
        const errorEl = document.createElement("div");
        errorEl.className = "source-share-empty";
        errorEl.textContent = sourcesRes.error
            ? `Couldn't list screens/windows: ${sourcesRes.error}`
            : "Couldn't list screens/windows to share.";
        sourceShareGroups.appendChild(errorEl);
        log(`Failed to open screen share picker: ${sourcesRes.error ?? "unknown error"}`, "error");
        return;
    }

    shareSources = sourcesRes.sources;
    shareProcessNames = {};
    const screens = shareSources.filter((s) => s.sourceType === "screen").length;
    const windows = shareSources.length - screens;
    const counts = document.querySelectorAll<HTMLElement>("#source-share-tabs .seg-count");
    counts[0].textContent = String(screens);
    counts[1].textContent = String(windows);

    if (screens + windows === 0) {
        const empty = document.createElement("div");
        empty.className = "source-share-empty";
        empty.textContent = "No screens or windows available to share.";
        sourceShareGroups.appendChild(empty);
        return;
    }
    setShareTab(screens > 0 ? "screen" : "window");
    // Process names arrive later (Windows only); the cards fill in when they do.
    void api.getWindowProcessNames(shareSources.filter((s) => s.sourceType === "window").map((s) => s.id)).then((names) => {
        shareProcessNames = names;
        if (screenShareModal.classList.contains("visible")) renderSourceGrid();
    });
    updateSharePreview();
}

function closeScreenShareModal(): void {
    screenShareModal.classList.remove("visible");
    selectedShareSource = null;
}

screenShareModal.addEventListener("click", (e) => {
    if (e.target === screenShareModal) closeScreenShareModal();
});

btnScreenShareCancel.addEventListener("click", () => closeScreenShareModal());
document.getElementById("btn-screen-share-close")!.addEventListener("click", () => closeScreenShareModal());

btnScreenShareStart.addEventListener("click", async () => {
    const source = selectedShareSource;
    if (!source) return;
    btnScreenShareStart.disabled = true;

    const videoRes = await api.startScreenShareVideo(source.id);
    if (!videoRes.success) {
        btnScreenShareStart.disabled = false;
        if (videoRes.errorCode === "SCREEN_SHARE_LIMIT") {
            // The capture was already stopped by the voice service, and the
            // audio capture below was never started.
            closeScreenShareModal();
            showToast(SCREEN_SHARE_LIMIT_TOAST);
            return;
        }
        log(`Failed to start screen share: ${videoRes.error}`, "error");
        return;
    }

    if (sourceShareAudioCheckbox.checked && !sourceShareAudioCheckbox.disabled) {
        const pid = await api.resolvePidForWindowSourceId(source.id);
        const audioRes = await api.startAppAudioCapture(pid, source.name);
        if (!audioRes.success) {
            log(`Screen video is sharing, but audio couldn't start: ${audioRes.error}`, "error");
        }
    }

    isSharingScreen = true;
    updateShareScreenButton();
    closeScreenShareModal();
    const customName = sourceShareNameInput.value.trim();
    const resolvedName = customName || source.name || "your screen";
    // Makes the sharing badge (PRD 12.12) appear for other occupants, and
    // — via `streamName` — lets a viewer's Viewer window show this same
    // resolved name.
    api.setScreenShareState(true, resolvedName);
    log(`Started sharing "${resolvedName}"`, "success");
});

api.on("channel-pin-updated", (data: { channelId: string; channelName: string; pinnedMessage: PinnedMessage | null; actedByNickname?: string }) => {
    const tab = chatTabs.get(data.channelId);
    if (tab) updatePinBarUI(tab, data.pinnedMessage);

    if (data.actedByNickname) {
        log(
            `${data.actedByNickname} ${data.pinnedMessage ? "pinned a message in" : "unpinned a message in"} #${data.channelName}`,
            "info",
        );
    } else if (!data.pinnedMessage) {
        log(`The pinned message in #${data.channelName} was deleted`, "info");
    }
});

function startMessageEdit(el: HTMLDivElement, msg: ChatMessage): void {
    if (el.querySelector(".msg-edit-input")) return; // already editing
    const textEl = el.querySelector(".msg-text");
    if (!textEl) return;

    const originalHTML = textEl.outerHTML;
    const input = document.createElement("textarea");
    input.className = "msg-edit-input";
    input.value = msg.content;
    textEl.replaceWith(input);
    // The same emoji autocomplete as the composer (PRD 17.11) — attached
    // before focus so the focus makes this box the card's target.
    const detachAutocomplete = attachEmojiAutocomplete(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    const finish = async (save: boolean): Promise<void> => {
        input.removeEventListener("keydown", onKeydown);
        input.removeEventListener("blur", onBlur);
        detachAutocomplete();

        if (!save) {
            input.outerHTML = originalHTML;
            return;
        }

        const newContent = input.value.trim();
        if (!newContent || newContent === msg.content) {
            input.outerHTML = originalHTML;
            return;
        }

        const result = await api.editMessage(msg.id, newContent);
        if (!result.success) {
            log(`Failed to edit message: ${result.error}`, "error");
            input.outerHTML = originalHTML;
            return;
        }

        // Applied optimistically here rather than waiting for the
        // MESSAGE_EDITED broadcast — applyMessageEdit() below still runs
        // when that broadcast arrives (including the echo back to this
        // client) and just harmlessly re-applies the same content.
        msg.content = newContent;
        const newTextEl = document.createElement("span");
        newTextEl.className = "msg-text";
        setMessageBody(newTextEl, newContent);
        input.replaceWith(newTextEl);
        ensureEditedLabel(el);
        // Re-evaluate truncation against the new content — an edit can
        // just as easily make a short message long as vice versa. Drop
        // any stale "See more" button from before the edit first, since
        // attachMessageTruncation() only ever adds a new one when needed.
        el.querySelector(".btn-see-more")?.remove();
        attachMessageTruncation(el, newTextEl);
    };

    const onKeydown = (e: KeyboardEvent) => {
        // The open emoji card gets first refusal (PRD 17.11): Enter/Tab pick
        // an emoji instead of saving, and Escape closes the card before it
        // ever cancels the edit — the composer's precedence with replies.
        if (handleEmojiAutocompleteKeydown(e)) return;
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            finish(true);
        } else if (e.key === "Escape") {
            e.preventDefault();
            finish(false);
        }
    };
    const onBlur = () => finish(true);

    input.addEventListener("keydown", onKeydown);
    input.addEventListener("blur", onBlur);
}

/** Applies a MESSAGE_EDITED broadcast to every rendered copy of that message (a background tab stays in the DOM, just hidden). */
function applyMessageEdit(msg: ChatMessage): void {
    document.querySelectorAll(`.chat-msg[data-msg-id="${CSS.escape(msg.id)}"]`).forEach((el) => {
        const textEl = el.querySelector(".msg-text") as HTMLElement | null;
        if (textEl) {
            textEl.classList.remove("msg-text-clamped", "msg-text-expanded");
            setMessageBody(textEl, msg.content);
            // Re-evaluate truncation for the other clients viewing this
            // edit too, not just the editor's own optimistic path above.
            el.querySelector(".btn-see-more")?.remove();
            attachMessageTruncation(el as HTMLDivElement, textEl);
        }
        ensureEditedLabel(el);
    });
    // Replies to this message show its new text, as they would after a reload (PRD 16.11).
    refreshReplySnippets(msg.id, msg.content);
}

api.on("message-edited", (msg: ChatMessage) => {
    applyMessageEdit(msg);
});

// A custom emoji another user (or an admin reviewing this client's own
// upload) just got approved — add it to the cache and refresh the picker
// if it's currently open, so it shows up without needing to reconnect.
api.on("custom-emoji-approved", (data: { serverId: string; emoji: CustomEmoji }) => {
    if (!customEmojis.some((e) => e.id === data.emoji.id)) {
        customEmojis.push(data.emoji);
        api.setCustomEmojis(customEmojis);
    }
    if (emojiPicker.classList.contains("visible")) {
        renderEmojiGrid(emojiSearch.value);
    }
    renderEmojiLibrary(); // PRD 20 M3: the settings page, if open
});

api.on("custom-emoji-removed", (data: { serverId: string; emojiId: string }) => {
    const before = customEmojis.length;
    customEmojis = customEmojis.filter((e) => e.id !== data.emojiId);
    if (customEmojis.length !== before) api.setCustomEmojis(customEmojis);
    if (emojiPicker.classList.contains("visible")) renderEmojiGrid(emojiSearch.value);
    renderEmojiLibrary(); // PRD 20 M3: the settings page, if open
});

// ── Nudge (PRD 4.14) ─────────────────────────────────────────────────────

api.on("server-settings-updated", (data: {
    nudgeEnabled: boolean;
    screenShareEnabled: boolean;
    maxMessageLength: number;
    // PRD 19 A1 — absent from a v2.7.0 server: undefined means "unchanged".
    requireApproval?: boolean;
    requireInvite?: boolean;
    requireSignedIdentity?: boolean;
    // PRD 19 A2 — null = icon removed, undefined = unchanged / older server.
    iconUrl?: string | null;
}) => {
    serverNudgeEnabled = data.nudgeEnabled;
    if (data.iconUrl !== undefined) {
        void refreshSavedServerMeta(undefined, data.iconUrl); // PRD 19 C1
        if (serverSummary) serverSummary.iconUrl = data.iconUrl; // PRD 19 C5: show it now, not after the debounce
        renderServerHeader();
        renderServerIconRow();
    }
    refreshServerSummary();
    scheduleDmSidebarRender(); // PRD 19 C7: Nudge buttons appear/disappear live

    // PRD 12.14 — live-disable the Share Screen button for everyone the
    // moment an admin flips the server-wide toggle, same push path Nudge
    // already uses.
    serverScreenShareEnabled = data.screenShareEnabled;
    updateShareScreenButton();

    serverMaxMessageLength = data.maxMessageLength;
    chatInput.maxLength = serverMaxMessageLength;
});

api.on("nudge-received", async (data: { fromUserId: string; fromNickname: string }) => {
    SoundAlert.play("nudge.mp3");
    showToast(`👋 <strong>${escapeHtml(data.fromNickname)}</strong> nudged you!`);

    const isFocused = await api.isWindowFocused();
    if (!isFocused) {
        api.flashWindow();
    }
});

// A viewer opened/closed the Viewer window on this client's own screen
// share (PRD 13.16) — sound-cue only, no visible UI.
//
// A viewer who pops the stream out (or brings it back) leaves and rejoins within
// moments; that is not two events worth hearing (PRD 19 C10). The leave sound is
// held for 3 s; a join inside that window cancels both.
let pendingViewerLeaveSound: ReturnType<typeof setTimeout> | null = null;

api.on("viewer-joined-your-stream", () => {
    if (pendingViewerLeaveSound) {
        clearTimeout(pendingViewerLeaveSound);
        pendingViewerLeaveSound = null;
        return;
    }
    SoundAlert.play("user_joined_your_stream.mp3");
});

api.on("viewer-left-your-stream", () => {
    if (pendingViewerLeaveSound) clearTimeout(pendingViewerLeaveSound);
    pendingViewerLeaveSound = setTimeout(() => {
        pendingViewerLeaveSound = null;
        SoundAlert.play("user_exited_your_stream.mp3");
    }, 3000);
});

// ── Emoji Picker ──────────────────────────────────────────────────────────

function closeEmojiPicker(): void {
    emojiPicker.classList.remove("visible");
    btnEmoji.classList.remove("active");
    // Reset reaction mode
    reactionTargetMsgId = null;
    document.querySelectorAll(".chat-msg.actions-open").forEach((m) => m.classList.remove("actions-open"));
    // Reset positioning to default (for chat input picker)
    emojiPicker.style.position = "";
    emojiPicker.style.bottom = "";
    emojiPicker.style.left = "";
    emojiPicker.style.top = "";
}

function openEmojiPicker(): void {
    closeEmojiAutocomplete();
    emojiPicker.classList.add("visible");
    btnEmoji.classList.add("active");
    emojiSearch.value = "";
    renderEmojiGrid();
    buildEmojiCategoryTabs();
    emojiSearch.focus();
}

function toggleEmojiPicker(): void {
    if (emojiPicker.classList.contains("visible")) {
        closeEmojiPicker();
    } else {
        openEmojiPicker();
    }
}

// Build category tabs. The custom-emoji tab lives in its own fixed slot
// (emojiCustomTabSlot), outside the scrollable category row — previously
// it was the row's 10th tab and could scroll out of view with no visible
// scrollbar cue, making it hard to find (PRD 11.3).
function buildEmojiCategoryTabs(): void {
    emojiCategoryTabs.innerHTML = "";
    emojiCustomTabSlot.innerHTML = "";

    function clearActiveTabs(): void {
        emojiTabsBar.querySelectorAll(".emoji-cat-tab").forEach((t) => t.classList.remove("active"));
    }

    for (const cat of EMOJI_CATEGORIES) {
        const btn = document.createElement("button");
        btn.className = "emoji-cat-tab";
        btn.title = cat;
        btn.textContent = EMOJI_CATEGORY_ICONS[cat] || "·";
        btn.addEventListener("click", () => {
            // Clear search and scroll to category
            emojiSearch.value = "";
            renderEmojiGrid();
            // Find the header for this category and scroll to it
            const header = emojiGridContainer.querySelector(`[data-emoji-cat="${cat}"]`);
            if (header) {
                header.scrollIntoView({ behavior: "smooth", block: "start" });
            }
            // Update active tab
            clearActiveTabs();
            btn.classList.add("active");
        });
        emojiCategoryTabs.appendChild(btn);
    }

    // Custom server emoji (approved ones) + the upload entry point — a
    // sticker-with-a-plus icon (filled, currentColor — see app-planning/
    // custom_emoji_icon.svg for the reference this path is adapted from,
    // an ic_fluent_sticker_add_24_filled icon), replacing a plain circle
    // "+" that read as generic "add" rather than "custom emoji" and, via
    // `.emoji-cat-tab` not setting `color`, rendered as near-invisible
    // black-on-black (fixed alongside this, see that rule's own comment).
    const customBtn = document.createElement("button");
    customBtn.className = "emoji-cat-tab";
    customBtn.title = "Custom Emojis";
    customBtn.innerHTML =
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5,12 C20.5375661,12 23,14.4624339 23,17.5 C23,20.5375661 20.5375661,23 17.5,23 C14.4624339,23 12,20.5375661 12,17.5 C12,14.4624339 14.4624339,12 17.5,12 Z M17.5,13.9992349 L17.4101244,14.0072906 C17.2060313,14.0443345 17.0450996,14.2052662 17.0080557,14.4093593 L17,14.4992349 L16.9996498,16.9992349 L14.4976498,17 L14.4077742,17.0080557 C14.2036811,17.0450996 14.0427494,17.2060313 14.0057055,17.4101244 L13.9976498,17.5 L14.0057055,17.5898756 C14.0427494,17.7939687 14.2036811,17.9549004 14.4077742,17.9919443 L14.4976498,18 L17.0006498,17.9992349 L17.0011076,20.5034847 L17.0091633,20.5933603 C17.0462073,20.7974534 17.207139,20.9583851 17.411232,20.995429 L17.5011076,21.0034847 L17.5909833,20.995429 C17.7950763,20.9583851 17.956008,20.7974534 17.993052,20.5933603 L18.0011076,20.5034847 L18.0006498,17.9992349 L20.5045655,18 L20.5944411,17.9919443 C20.7985342,17.9549004 20.9594659,17.7939687 20.9965098,17.5898756 L21.0045655,17.5 L20.9965098,17.4101244 C20.9594659,17.2060313 20.7985342,17.0450996 20.5944411,17.0080557 L20.5045655,17 L17.9996498,16.9992349 L18,14.4992349 L17.9919443,14.4093593 C17.9549004,14.2052662 17.7939687,14.0443345 17.5898756,14.0072906 L17.5,13.9992349 Z M17.75,3 C19.5449254,3 21,4.45507456 21,6.25 L21.0012092,12.0225923 C19.9906579,11.3752958 18.7891565,11 17.5,11 C14.8016531,11 12.4873327,12.6442127 11.5042701,14.9854066 C10.6572014,14.9085256 9.88524157,14.6257765 9.1765361,14.1355923 C8.83586995,13.8999666 8.36869314,13.9851187 8.13306748,14.3257849 C7.89744183,14.666451 7.98259397,15.1336279 8.32326012,15.3692535 C9.16645713,15.9524604 10.0900975,16.3129767 11.0850385,16.4484275 C11.0289661,16.7904675 11,17.1418511 11,17.5 C11,18.7891565 11.3752958,19.9906579 12.0225923,21.0012092 L6.25,21 C4.45507456,21 3,19.5449254 3,17.75 L3,6.25 C3,4.45507456 4.45507456,3 6.25,3 L17.75,3 Z M9.00044779,7.75115873 C8.3104845,7.75115873 7.75115873,8.3104845 7.75115873,9.00044779 C7.75115873,9.69041108 8.3104845,10.2497368 9.00044779,10.2497368 C9.69041108,10.2497368 10.2497368,9.69041108 10.2497368,9.00044779 C10.2497368,8.3104845 9.69041108,7.75115873 9.00044779,7.75115873 Z M15.0004478,7.75115873 C14.3104845,7.75115873 13.7511587,8.3104845 13.7511587,9.00044779 C13.7511587,9.69041108 14.3104845,10.2497368 15.0004478,10.2497368 C15.6904111,10.2497368 16.2497368,9.69041108 16.2497368,9.00044779 C16.2497368,8.3104845 15.6904111,7.75115873 15.0004478,7.75115873 Z"/></svg>';
    customBtn.addEventListener("click", () => {
        emojiSearch.value = "";
        renderEmojiGrid();
        const header = emojiGridContainer.querySelector(`[data-emoji-cat="Custom"]`);
        if (header) {
            header.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        clearActiveTabs();
        customBtn.classList.add("active");
    });
    emojiCustomTabSlot.appendChild(customBtn);

    // Activate first tab
    const first = emojiCategoryTabs.querySelector(".emoji-cat-tab");
    first?.classList.add("active");
}

// Render emoji grid (optionally filtered)
function renderEmojiGrid(filter?: string): void {
    emojiGridContainer.innerHTML = "";
    const lowerFilter = filter?.toLowerCase().trim() || "";

    let totalRendered = 0;

    for (const cat of EMOJI_CATEGORIES) {
        // Filter emojis in this category
        const emojis = EMOJI_DATA.filter((e) => {
            if (e.category !== cat) return false;
            if (!lowerFilter) return true;
            return (
                e.name.toLowerCase().includes(lowerFilter) ||
                e.keywords.some((kw) => kw.toLowerCase().includes(lowerFilter))
            );
        });

        if (emojis.length === 0) continue;

        // Category header
        const header = document.createElement("div");
        header.className = "emoji-category-header";
        header.textContent = cat;
        header.setAttribute("data-emoji-cat", cat);
        emojiGridContainer.appendChild(header);

        // Grid for this category
        const grid = document.createElement("div");
        grid.className = "emoji-grid";

        for (const entry of emojis) {
            const item = document.createElement("span");
            item.className = "emoji-item";
            item.textContent = entry.emoji;
            item.title = entry.name;
            item.addEventListener("click", () => {
                insertEmojiAtCursor(entry.emoji);
            });
            grid.appendChild(item);
        }

        emojiGridContainer.appendChild(grid);
        totalRendered += emojis.length;
    }

    if (totalRendered === 0) {
        const noResults = document.createElement("div");
        noResults.className = "emoji-no-results";
        noResults.textContent = "No emojis found";
        emojiGridContainer.appendChild(noResults);
    }

    renderCustomEmojiSection(lowerFilter);
}

/** Renders the "+" tab's custom-emoji section — always shown (holds the
 * upload button) regardless of search, with items filtered by name. */
function renderCustomEmojiSection(lowerFilter: string): void {
    const header = document.createElement("div");
    header.className = "emoji-category-header";
    header.textContent = "Custom Emojis";
    header.setAttribute("data-emoji-cat", "Custom");
    emojiGridContainer.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "emoji-grid";

    const uploadBtn = document.createElement("button");
    uploadBtn.className = "emoji-upload-btn";
    uploadBtn.title = "Upload a custom emoji";
    uploadBtn.textContent = "+";
    uploadBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openEmojiUploadModal();
    });
    grid.appendChild(uploadBtn);

    // Animated emoji (PRD 13.13) — separate entry point, since the upload
    // flow skips the crop tool entirely (a GIF's frames can't be cropped
    // through a static canvas without losing the animation).
    const uploadAnimatedBtn = document.createElement("button");
    uploadAnimatedBtn.className = "emoji-upload-btn emoji-upload-btn-animated";
    uploadAnimatedBtn.title = "Upload an animated (GIF) emoji";
    uploadAnimatedBtn.textContent = "GIF+";
    uploadAnimatedBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openAnimatedEmojiUploadModal();
    });
    grid.appendChild(uploadAnimatedBtn);

    const filtered = customEmojis.filter(
        (e) => !lowerFilter || e.name.toLowerCase().includes(lowerFilter),
    );
    for (const ce of filtered) {
        const item = document.createElement("span");
        item.className = "emoji-item custom-emoji-item";
        item.title = `:${ce.name}:`;
        const img = document.createElement("img");
        img.src = ce.imageUrl;
        img.alt = ce.name;
        img.className = "custom-emoji-img";
        item.appendChild(img);
        item.addEventListener("click", () => {
            insertEmojiAtCursor(`:${ce.name}:`);
        });
        grid.appendChild(item);
    }

    emojiGridContainer.appendChild(grid);
}

// Insert emoji at cursor position in chat input or toggle reaction
function insertEmojiAtCursor(emoji: string): void {
    if (reactionTargetMsgId) {
        // Reaction mode — toggle reaction on the target message
        api.toggleReaction(reactionTargetMsgId, emoji, reactionTargetIsDm);
        closeEmojiPicker();
        return;
    }
    const start = chatInput.selectionStart ?? chatInput.value.length;
    const end = chatInput.selectionEnd ?? start;
    chatInput.setRangeText(emoji, start, end, "end");
    autosizeChatInput();
    chatInput.focus();
}

// ── Custom Emoji Upload / Crop Tool (PRD 4.8) ───────────────────────────────
//
// A simple "cover + pan + zoom" cropper, the same interaction model as
// Discord/most avatar croppers: the viewport is a fixed 220x220 square, the
// image always fully covers it (never leaving gaps), the user can drag to
// reposition and use the zoom slider to scale in, and whatever is visible in
// the viewport at confirm time is exactly what gets drawn into the final
// 128x128 output — via a canvas source-rect computed back into the image's
// natural pixel space, not by trying to read pixels off the styled <img>.

function openEmojiUploadModal(): void {
    emojiUploadStepSelect.style.display = "block";
    emojiUploadStepCrop.style.display = "none";
    emojiNameInput.value = "";
    emojiUploadModal.classList.add("visible");
}

function closeEmojiUploadModal(): void {
    emojiUploadModal.classList.remove("visible");
    if (emojiCropObjectUrl) {
        URL.revokeObjectURL(emojiCropObjectUrl);
        emojiCropObjectUrl = null;
    }
    emojiCropImg.removeAttribute("src");
    emojiCropNaturalWidth = 0;
    emojiCropNaturalHeight = 0;
}

function applyEmojiCropTransform(): void {
    const scale = emojiCropBaseScale * emojiCropZoomFactor;
    emojiCropImg.style.width = `${emojiCropNaturalWidth}px`;
    emojiCropImg.style.height = `${emojiCropNaturalHeight}px`;
    emojiCropImg.style.transform = `translate(${emojiCropOffsetX}px, ${emojiCropOffsetY}px) scale(${scale})`;
}

/** Keeps the image fully covering the viewport — offsets can't drift so far that a gap would show. */
function clampEmojiCropOffsets(): void {
    const scale = emojiCropBaseScale * emojiCropZoomFactor;
    const displayedW = emojiCropNaturalWidth * scale;
    const displayedH = emojiCropNaturalHeight * scale;
    const minX = EMOJI_CROP_VIEWPORT_SIZE - displayedW;
    const minY = EMOJI_CROP_VIEWPORT_SIZE - displayedH;
    emojiCropOffsetX = Math.min(0, Math.max(minX, emojiCropOffsetX));
    emojiCropOffsetY = Math.min(0, Math.max(minY, emojiCropOffsetY));
}

btnEmojiChooseFile.addEventListener("click", () => emojiFileInput.click());
btnEmojiUploadCancelSelect.addEventListener("click", () => closeEmojiUploadModal());
btnEmojiUploadCancel.addEventListener("click", () => closeEmojiUploadModal());

emojiUploadModal.addEventListener("click", (e) => {
    if (e.target === emojiUploadModal) closeEmojiUploadModal();
});

const EMOJI_ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

emojiFileInput.addEventListener("change", () => {
    const file = emojiFileInput.files?.[0];
    emojiFileInput.value = ""; // allow re-selecting the same file later
    if (!file) return;

    if (file.size > EMOJI_MAX_UPLOAD_SIZE) {
        log(`Image too large (max ${Math.round(EMOJI_MAX_UPLOAD_SIZE / 1024)}KB)`, "error");
        return;
    }
    if (!EMOJI_ALLOWED_TYPES.has(file.type)) {
        log("Unsupported image type", "error");
        return;
    }

    if (emojiCropObjectUrl) URL.revokeObjectURL(emojiCropObjectUrl);
    emojiCropObjectUrl = URL.createObjectURL(file);
    emojiCropImg.src = emojiCropObjectUrl;
});

emojiCropImg.addEventListener("load", () => {
    emojiCropNaturalWidth = emojiCropImg.naturalWidth;
    emojiCropNaturalHeight = emojiCropImg.naturalHeight;
    if (!emojiCropNaturalWidth || !emojiCropNaturalHeight) return;

    emojiCropBaseScale = Math.max(
        EMOJI_CROP_VIEWPORT_SIZE / emojiCropNaturalWidth,
        EMOJI_CROP_VIEWPORT_SIZE / emojiCropNaturalHeight,
    );
    emojiCropZoomFactor = 1;
    emojiCropZoom.value = "1";

    const displayedW = emojiCropNaturalWidth * emojiCropBaseScale;
    const displayedH = emojiCropNaturalHeight * emojiCropBaseScale;
    emojiCropOffsetX = (EMOJI_CROP_VIEWPORT_SIZE - displayedW) / 2;
    emojiCropOffsetY = (EMOJI_CROP_VIEWPORT_SIZE - displayedH) / 2;
    applyEmojiCropTransform();

    emojiUploadStepSelect.style.display = "none";
    emojiUploadStepCrop.style.display = "block";
});

emojiCropViewport.addEventListener("mousedown", (e) => {
    emojiCropDragging = true;
    emojiCropViewport.classList.add("dragging");
    emojiCropDragStart = { x: e.clientX, y: e.clientY, offsetX: emojiCropOffsetX, offsetY: emojiCropOffsetY };
    e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
    if (!emojiCropDragging) return;
    emojiCropOffsetX = emojiCropDragStart.offsetX + (e.clientX - emojiCropDragStart.x);
    emojiCropOffsetY = emojiCropDragStart.offsetY + (e.clientY - emojiCropDragStart.y);
    clampEmojiCropOffsets();
    applyEmojiCropTransform();
});

document.addEventListener("mouseup", () => {
    if (emojiCropDragging) {
        emojiCropDragging = false;
        emojiCropViewport.classList.remove("dragging");
    }
});

emojiCropZoom.addEventListener("input", () => {
    emojiCropZoomFactor = parseFloat(emojiCropZoom.value);
    clampEmojiCropOffsets();
    applyEmojiCropTransform();
});

btnEmojiUploadConfirm.addEventListener("click", async () => {
    const name = emojiNameInput.value.trim();
    if (!/^[a-zA-Z0-9_]{2,32}$/.test(name)) {
        log("Emoji name must be 2-32 letters, numbers, or underscores", "error");
        emojiNameInput.focus();
        return;
    }
    if (!emojiCropNaturalWidth || !emojiCropNaturalHeight) return;

    btnEmojiUploadConfirm.disabled = true;
    try {
        const scale = emojiCropBaseScale * emojiCropZoomFactor;
        const srcX = -emojiCropOffsetX / scale;
        const srcY = -emojiCropOffsetY / scale;
        const srcSize = EMOJI_CROP_VIEWPORT_SIZE / scale;

        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas not supported");
        ctx.drawImage(emojiCropImg, srcX, srcY, srcSize, srcSize, 0, 0, 128, 128);

        const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("Failed to crop image");

        const buffer = await blob.arrayBuffer();
        const uploadResult = await api.uploadEmojiFile(buffer, `${name}.png`, "image/png");
        // The file is uploaded before the emoji is submitted, so if the
        // submit fails (name taken, connection lost…) it must be discarded
        // rather than left behind (PRD 16.9).
        let submitted = false;
        try {
            const createResult = await api.createCustomEmoji(name, uploadResult);
            submitted = createResult.success;
            if (createResult.success) {
                log(`Emoji ":${name}:" submitted for admin approval`, "success");
                closeEmojiUploadModal();
            } else {
                log(`Failed to submit emoji: ${createResult.error}`, "error");
            }
        } finally {
            if (!submitted) discardUpload(uploadResult.uploadId);
        }
    } catch (err: any) {
        log(`Emoji upload failed: ${err.message}`, "error");
    } finally {
        btnEmojiUploadConfirm.disabled = false;
    }
});

// ── Animated Custom Emoji Upload (PRD 13.13) ────────────────────────────────

function openAnimatedEmojiUploadModal(): void {
    emojiAnimatedFile = null;
    emojiAnimatedNameInput.value = "";
    emojiAnimatedPreviewWrap.style.display = "none";
    btnEmojiAnimatedUploadConfirm.disabled = true;
    emojiUploadAnimatedModal.classList.add("visible");
}

function closeAnimatedEmojiUploadModal(): void {
    emojiUploadAnimatedModal.classList.remove("visible");
    if (emojiAnimatedPreviewObjectUrl) {
        URL.revokeObjectURL(emojiAnimatedPreviewObjectUrl);
        emojiAnimatedPreviewObjectUrl = null;
    }
    emojiAnimatedFile = null;
}

btnEmojiAnimatedChooseFile.addEventListener("click", () => emojiAnimatedFileInput.click());
btnEmojiAnimatedUploadCancel.addEventListener("click", () => closeAnimatedEmojiUploadModal());

emojiUploadAnimatedModal.addEventListener("click", (e) => {
    if (e.target === emojiUploadAnimatedModal) closeAnimatedEmojiUploadModal();
});

emojiAnimatedFileInput.addEventListener("change", () => {
    const file = emojiAnimatedFileInput.files?.[0];
    emojiAnimatedFileInput.value = ""; // allow re-selecting the same file later
    if (!file) return;

    if (file.size > ANIMATED_EMOJI_MAX_UPLOAD_SIZE) {
        log(`GIF too large (max ${Math.round(ANIMATED_EMOJI_MAX_UPLOAD_SIZE / (1024 * 1024))}MB)`, "error");
        return;
    }
    if (file.type !== "image/gif") {
        log("Animated emoji must be a GIF", "error");
        return;
    }

    emojiAnimatedFile = file;
    if (emojiAnimatedPreviewObjectUrl) URL.revokeObjectURL(emojiAnimatedPreviewObjectUrl);
    emojiAnimatedPreviewObjectUrl = URL.createObjectURL(file);
    emojiAnimatedPreviewImg.src = emojiAnimatedPreviewObjectUrl;
    emojiAnimatedPreviewWrap.style.display = "block";
    btnEmojiAnimatedUploadConfirm.disabled = false;
});

btnEmojiAnimatedUploadConfirm.addEventListener("click", async () => {
    const name = emojiAnimatedNameInput.value.trim();
    if (!/^[a-zA-Z0-9_]{2,32}$/.test(name)) {
        log("Emoji name must be 2-32 letters, numbers, or underscores", "error");
        emojiAnimatedNameInput.focus();
        return;
    }
    if (!emojiAnimatedFile) return;

    btnEmojiAnimatedUploadConfirm.disabled = true;
    try {
        const buffer = await emojiAnimatedFile.arrayBuffer();
        const uploadResult = await api.uploadAnimatedEmojiFile(buffer, `${name}.gif`, "image/gif");
        let submitted = false; // discard the uploaded file if the submit fails (PRD 16.9)
        try {
            const createResult = await api.createCustomEmoji(name, uploadResult, true);
            submitted = createResult.success;
            if (createResult.success) {
                log(`Animated emoji ":${name}:" submitted for admin approval`, "success");
                closeAnimatedEmojiUploadModal();
            } else {
                log(`Failed to submit emoji: ${createResult.error}`, "error");
            }
        } finally {
            if (!submitted) discardUpload(uploadResult.uploadId);
        }
    } catch (err: any) {
        log(`Emoji upload failed: ${err.message}`, "error");
    } finally {
        btnEmojiAnimatedUploadConfirm.disabled = false;
    }
});

// ── Channel Icon Modal (PRD 14.7, text channels only) ───────────────────────
//
// Same "cover + pan + zoom" cropper as the custom-emoji upload tool above —
// duplicated rather than shared (this codebase's convention: duplication
// over a premature shared abstraction for what's only the second use of
// this exact pattern) — plus a "choose a default emoji instead" step that
// reuses the full built-in 552-entry emoji set (not a curated subset).

/** Where the channel-icon chooser sends its result (PRD 20 S3). */
let channelIconDraftMode = false;
type ChannelIconDraft = { emoji: string } | { blob: Blob; url: string } | null;
let createChannelIconDraft: ChannelIconDraft = null;
const newChannelIconBtn = document.getElementById("new-channel-icon-btn") as HTMLButtonElement;
const newChannelIconHint = document.getElementById("new-channel-icon-hint") as HTMLElement;

function setCreateChannelIconDraft(draft: ChannelIconDraft): void {
    if (createChannelIconDraft && "url" in createChannelIconDraft) URL.revokeObjectURL(createChannelIconDraft.url);
    createChannelIconDraft = draft;
    newChannelIconBtn.textContent = "";
    if (!draft) {
        newChannelIconBtn.innerHTML = '<i class="ph ph-hash" aria-hidden="true"></i>';
    } else if ("emoji" in draft) {
        newChannelIconBtn.textContent = draft.emoji;
    } else {
        const img = document.createElement("img");
        img.src = draft.url;
        img.alt = "";
        newChannelIconBtn.appendChild(img);
    }
}

function paintCreateChannelIconRow(): void {
    const text = newChannelType.value === "TEXT";
    newChannelIconBtn.style.display = text ? "" : "none";
    newChannelIconHint.style.display = text ? "" : "none";
    if (!text) setCreateChannelIconDraft(null);
}

newChannelIconBtn.addEventListener("click", () => {
    channelIconDraftMode = true;
    pendingChannelIconId = null;
    channelIconStepSelect.style.display = "block";
    channelIconStepEmoji.style.display = "none";
    channelIconStepCrop.style.display = "none";
    channelIconModal.classList.add("visible");
});

/** Applies the icon chosen in Create channel to the new channel (PRD 20 S3). */
async function applyNewChannelIcon(channelId: string, draft: NonNullable<ChannelIconDraft>): Promise<void> {
    if ("emoji" in draft) {
        const res = await api.updateChannel(channelId, { iconEmoji: draft.emoji });
        if (!res.success) log(`Channel created, but its icon couldn't be set: ${escapeHtml(res.error ?? "unknown error")}`, "error");
        return;
    }
    try {
        const upload = await api.uploadChannelIcon(await draft.blob.arrayBuffer(), "channel-icon.png", "image/png");
        let applied = false;
        try {
            const res = await api.updateChannel(channelId, { iconUploadId: upload.uploadId, iconUrl: upload.url, iconPublicId: upload.publicId ?? null });
            applied = res.success;
            if (!res.success) log(`Channel created, but its icon couldn't be set: ${escapeHtml(res.error ?? "unknown error")}`, "error");
        } finally {
            if (!applied) discardUpload(upload.uploadId);
        }
    } catch (err: any) {
        log(`Channel created, but the icon upload failed: ${escapeHtml(err?.message ?? String(err))}`, "error");
    }
}

function showChannelIconModal(channelId: string): void {
    channelIconDraftMode = false;
    pendingChannelIconId = channelId;
    channelIconStepSelect.style.display = "block";
    channelIconStepEmoji.style.display = "none";
    channelIconStepCrop.style.display = "none";
    channelIconModal.classList.add("visible");
}

function closeChannelIconModal(): void {
    channelIconModal.classList.remove("visible");
    channelIconDraftMode = false;
    pendingChannelIconId = null;
    channelCropper.clear();
}

/** Builds a simple category-grouped emoji grid inside the modal — a
 *  smaller, self-contained instance rather than reusing the chat input's
 *  floating emoji-picker widget, which is purpose-built for that different
 *  UI context (search, custom-emoji tab, cursor insertion). */
function renderChannelIconEmojiGrid(): void {
    channelIconEmojiGrid.innerHTML = "";

    for (const cat of EMOJI_CATEGORIES) {
        const entries = EMOJI_DATA.filter((e) => e.category === cat);
        if (entries.length === 0) continue;

        const header = document.createElement("div");
        header.className = "emoji-category-header";
        header.textContent = `${EMOJI_CATEGORY_ICONS[cat] ?? ""} ${cat}`;
        channelIconEmojiGrid.appendChild(header);

        const grid = document.createElement("div");
        grid.className = "emoji-grid";
        for (const entry of entries) {
            const item = document.createElement("div");
            item.className = "emoji-item";
            item.textContent = entry.emoji;
            item.title = entry.name;
            item.addEventListener("click", () => selectChannelIconEmoji(entry.emoji));
            grid.appendChild(item);
        }
        channelIconEmojiGrid.appendChild(grid);
    }
}

async function selectChannelIconEmoji(emoji: string): Promise<void> {
    if (channelIconDraftMode) {
        setCreateChannelIconDraft({ emoji });
        closeChannelIconModal();
        return;
    }
    if (!pendingChannelIconId) return;
    const channelId = pendingChannelIconId;
    closeChannelIconModal();

    const result = await api.updateChannel(channelId, { iconEmoji: emoji });
    if (result.success) {
        log("Channel icon updated", "success");
    } else {
        log(`Failed to update channel icon: ${result.error}`, "error");
        if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
    }
}

btnChannelIconChooseEmoji.addEventListener("click", () => {
    channelIconStepSelect.style.display = "none";
    channelIconStepEmoji.style.display = "block";
    renderChannelIconEmojiGrid();
});

btnChannelIconBackFromEmoji.addEventListener("click", () => {
    channelIconStepEmoji.style.display = "none";
    channelIconStepSelect.style.display = "block";
});

btnChannelIconChooseImage.addEventListener("click", () => channelIconFileInput.click());
btnChannelIconCancelSelect.addEventListener("click", () => closeChannelIconModal());
btnChannelIconUploadCancel.addEventListener("click", () => closeChannelIconModal());

channelIconModal.addEventListener("click", (e) => {
    if (e.target === channelIconModal) closeChannelIconModal();
});

btnChannelIconReset.addEventListener("click", async () => {
    if (channelIconDraftMode) {
        setCreateChannelIconDraft(null);
        closeChannelIconModal();
        return;
    }
    if (!pendingChannelIconId) return;
    const channelId = pendingChannelIconId;
    closeChannelIconModal();

    const result = await api.updateChannel(channelId, { iconEmoji: null });
    if (result.success) {
        log("Channel icon reset to default", "success");
    } else {
        log(`Failed to reset channel icon: ${result.error}`, "error");
        if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
    }
});

channelIconFileInput.addEventListener("change", () => {
    const file = channelIconFileInput.files?.[0];
    channelIconFileInput.value = ""; // allow re-selecting the same file later
    if (!file) return;

    if (file.size > CHANNEL_ICON_MAX_UPLOAD_SIZE) {
        log(`Image too large (max ${Math.round(CHANNEL_ICON_MAX_UPLOAD_SIZE / 1024)}KB)`, "error");
        return;
    }
    if (!CHANNEL_ICON_ALLOWED_TYPES.has(file.type)) {
        log("Unsupported image type", "error");
        return;
    }

    channelCropper.loadFile(file);
});

btnChannelIconUploadConfirm.addEventListener("click", async () => {
    if (channelIconDraftMode) {
        if (!channelCropper.isReady()) return;
        const blob = await channelCropper.toBlob(128, "image/png");
        if (blob) setCreateChannelIconDraft({ blob, url: URL.createObjectURL(blob) });
        closeChannelIconModal();
        return;
    }
    if (!pendingChannelIconId) return;
    if (!channelCropper.isReady()) return;
    const channelId = pendingChannelIconId;

    btnChannelIconUploadConfirm.disabled = true;
    try {
        const blob = await channelCropper.toBlob(128, "image/png");
        if (!blob) throw new Error("Failed to crop image");

        const buffer = await blob.arrayBuffer();
        const uploadResult = await api.uploadChannelIcon(buffer, "channel-icon.png", "image/png");
        let applied = false; // discard the uploaded file if the update fails (PRD 16.9)
        try {
            const updateResult = await api.updateChannel(channelId, {
                iconUploadId: uploadResult.uploadId,
                // Legacy fields, for a pre-v2.5.0 server; a v2.5.0+ server uses the id.
                iconUrl: uploadResult.url,
                iconPublicId: uploadResult.publicId ?? null,
            });
            applied = updateResult.success;

            if (updateResult.success) {
                log("Channel icon updated", "success");
                closeChannelIconModal();
            } else {
                log(`Failed to update channel icon: ${updateResult.error}`, "error");
                if (updateResult.error && /permission|denied/i.test(updateResult.error)) SoundAlert.play("insufficient_perms.mp3");
            }
        } finally {
            if (!applied) discardUpload(uploadResult.uploadId);
        }
    } catch (err: any) {
        log(`Channel icon upload failed: ${err.message}`, "error");
    } finally {
        btnChannelIconUploadConfirm.disabled = false;
    }
});

// ── Server icon (PRD 19 C5) ──────────────────────────────────────────────────

const SERVER_ICON_VIEWPORT = 220;
const SERVER_ICON_MAX_BYTES = 1024 * 1024; // the server's own cap (A2)
const SERVER_ICON_MIN_SIDE = 256;
const SERVER_ICON_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const serverIconModal = document.getElementById("server-icon-modal") as HTMLDivElement;
const serverIconFileInput = document.getElementById("server-icon-file-input") as HTMLInputElement;
const btnServerIconSave = document.getElementById("btn-server-icon-save") as HTMLButtonElement;
const serverIconError = document.getElementById("server-icon-error") as HTMLDivElement;
const serverIconPreviewBig = document.getElementById("server-icon-preview-40") as HTMLCanvasElement;
const serverIconPreviewSmall = document.getElementById("server-icon-preview-24") as HTMLCanvasElement;

/** Draws the current crop into the two preview sizes (the real avatars are 40 and 24 px). */
function paintServerIconPreviews(): void {
    if (!serverCropper?.isReady()) return;
    for (const c of [serverIconPreviewBig, serverIconPreviewSmall]) {
        const ctx = c.getContext("2d");
        if (!ctx) continue;
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(serverCropper.toCanvas(c.width), 0, 0);
    }
}

const serverCropper: IconCropper | null = new IconCropper(
    document.getElementById("server-icon-crop-viewport") as HTMLDivElement,
    document.getElementById("server-icon-crop-img") as HTMLImageElement,
    document.getElementById("server-icon-crop-zoom") as HTMLInputElement,
    SERVER_ICON_VIEWPORT,
    () => {
        (document.getElementById("server-icon-step-pick") as HTMLElement).style.display = "none";
        (document.getElementById("server-icon-step-crop") as HTMLElement).style.display = "block";
        btnServerIconSave.disabled = false;
        paintServerIconPreviews();
    },
    () => paintServerIconPreviews(),
);

function showServerIconError(text: string): void {
    serverIconError.textContent = text;
    serverIconError.style.display = text ? "block" : "none";
}

function closeServerIconModal(): void {
    serverIconModal.classList.remove("visible");
    serverCropper?.clear();
    btnServerIconSave.disabled = true;
    showServerIconError("");
    (document.getElementById("server-icon-step-pick") as HTMLElement).style.display = "block";
    (document.getElementById("server-icon-step-crop") as HTMLElement).style.display = "none";
}

/** The icon's current public URL, or null. */
function serverIconPublicUrl(): string | null {
    return serverSummary?.iconUrl ?? currentServerIcon();
}

function openServerIconModal(): void {
    closeServerIconModal();
    const url = serverIconPublicUrl();
    (document.getElementById("server-icon-link") as HTMLElement).textContent = url ?? "Shown after you save";
    serverIconModal.classList.add("visible");
}

/** Validates a picked/dropped file and hands it to the cropper. */
async function pickServerIconFile(file: File | undefined): Promise<void> {
    if (!file || !serverCropper) return;
    showServerIconError("");
    if (!SERVER_ICON_TYPES.has(file.type)) {
        showServerIconError("Use a PNG, JPEG, GIF or WebP image.");
        return;
    }
    if (file.size > SERVER_ICON_MAX_BYTES) {
        showServerIconError("That image is over 1 MB.");
        return;
    }
    try {
        const bitmap = await createImageBitmap(file);
        const small = bitmap.width < SERVER_ICON_MIN_SIDE || bitmap.height < SERVER_ICON_MIN_SIDE;
        bitmap.close();
        if (small) {
            showServerIconError(`The image must be at least ${SERVER_ICON_MIN_SIDE}×${SERVER_ICON_MIN_SIDE} pixels.`);
            return;
        }
    } catch {
        showServerIconError("That file couldn't be read as an image.");
        return;
    }
    serverCropper.loadFile(file);
}

serverIconFileInput.addEventListener("change", () => {
    const file = serverIconFileInput.files?.[0];
    serverIconFileInput.value = "";
    void pickServerIconFile(file);
});
document.getElementById("btn-server-icon-choose")?.addEventListener("click", () => serverIconFileInput.click());
document.getElementById("btn-server-icon-cancel")?.addEventListener("click", closeServerIconModal);
serverIconModal.addEventListener("click", (e) => {
    if (e.target === serverIconModal) closeServerIconModal();
});
const serverIconDrop = document.getElementById("server-icon-drop") as HTMLDivElement;
serverIconDrop.addEventListener("dragover", (e) => {
    e.preventDefault();
    serverIconDrop.classList.add("over");
});
serverIconDrop.addEventListener("dragleave", () => serverIconDrop.classList.remove("over"));
serverIconDrop.addEventListener("drop", (e) => {
    e.preventDefault();
    serverIconDrop.classList.remove("over");
    void pickServerIconFile(e.dataTransfer?.files?.[0]);
});

btnServerIconSave.addEventListener("click", async () => {
    if (!serverCropper?.isReady()) return;
    btnServerIconSave.disabled = true;
    showServerIconError("");
    let uploadId: string | undefined;
    try {
        // 512x512 PNG; if that is over 1 MB, retry as WebP at 0.9 (the server's cap).
        let blob = await serverCropper.toBlob(512, "image/png");
        let name = "server-icon.png";
        let mime = "image/png";
        if (blob && blob.size > SERVER_ICON_MAX_BYTES) {
            blob = await serverCropper.toBlob(512, "image/webp", 0.9);
            name = "server-icon.webp";
            mime = "image/webp";
        }
        if (!blob || blob.size > SERVER_ICON_MAX_BYTES) throw new Error("The cropped image is still over 1 MB");
        const up = await api.uploadServerIcon(await blob.arrayBuffer(), name, mime);
        uploadId = up.uploadId;
        if (!uploadId) throw new Error("This server did not accept the upload");
        const res = await api.updateServerSettings({ iconUploadId: uploadId });
        if (!res.success) throw new Error(res.error ?? "The icon could not be saved");
        uploadId = undefined; // claimed
        showToast("Server icon updated");
        closeServerIconModal();
    } catch (err: any) {
        showServerIconError(err?.message ?? "The icon could not be saved");
        if (uploadId) void discardUpload(uploadId);
        btnServerIconSave.disabled = !serverCropper?.isReady();
    }
});

/** The Identity row at the top of Server settings: preview, Upload/Change, Remove. */
function renderServerIconRow(): void {
    const preview = document.getElementById("server-icon-row-preview");
    if (!preview) return;
    const name = connectedServerName ?? "Server";
    const url = currentServerIcon();
    preview.replaceChildren(serverAvatarElement(name, url, 56));
    const hasIcon = !!(serverSummary?.iconUrl ?? null);
    (document.getElementById("btn-server-icon-upload") as HTMLButtonElement).textContent = hasIcon ? "Change" : "Upload";
    (document.getElementById("btn-server-icon-remove") as HTMLButtonElement).style.display = hasIcon ? "" : "none";
}

document.getElementById("btn-server-icon-upload")?.addEventListener("click", openServerIconModal);
{
    const removeBtn = document.getElementById("btn-server-icon-remove") as HTMLButtonElement;
    let armedTimer: ReturnType<typeof setTimeout> | null = null;
    removeBtn.addEventListener("click", async () => {
        if (!removeBtn.classList.contains("armed")) {
            // A small confirm: the second click within 4 s removes it.
            removeBtn.classList.add("armed");
            removeBtn.textContent = "Click again to remove";
            armedTimer = setTimeout(() => {
                removeBtn.classList.remove("armed");
                removeBtn.textContent = "Remove";
            }, 4000);
            return;
        }
        if (armedTimer) clearTimeout(armedTimer);
        removeBtn.classList.remove("armed");
        removeBtn.textContent = "Remove";
        const res = await api.updateServerSettings({ iconUploadId: null });
        showToast(res.success ? "Server icon removed" : escapeHtml(res.error ?? "Couldn't remove the icon"));
        if (res.success) void refreshServerSummary();
    });
}

// Emoji button toggle
btnEmoji.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleEmojiPicker();
});

// Click inside picker should not close it
emojiPicker.addEventListener("click", (e) => {
    e.stopPropagation();
});

// Click outside picker to close
document.addEventListener("click", (e) => {
    if (
        emojiPicker.classList.contains("visible") &&
        !emojiPicker.contains(e.target as Node) &&
        e.target !== btnEmoji &&
        !btnEmoji.contains(e.target as Node)
    ) {
        closeEmojiPicker();
    }
});

// Search debounce
let emojiSearchTimeout: ReturnType<typeof setTimeout> | null = null;
emojiSearch.addEventListener("input", () => {
    if (emojiSearchTimeout) clearTimeout(emojiSearchTimeout);
    emojiSearchTimeout = setTimeout(() => {
        renderEmojiGrid(emojiSearch.value);
        // Clear active category tab during search
        if (emojiSearch.value.trim()) {
            emojiCategoryTabs.querySelectorAll(".emoji-cat-tab").forEach((t) => t.classList.remove("active"));
        }
    }, 150);
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

// ── Sound Alerts Mute Preference ──────────────────────────────────────────

chkMuteAlerts.checked = soundAlertsMuted;

chkMuteAlerts.addEventListener("change", () => {
    soundAlertsMuted = chkMuteAlerts.checked;
    localStorage.setItem("reson8-mute-alerts", String(soundAlertsMuted));
});

// ── Content Preferences (PRD 16.1) ────────────────────────────────────────

chkNsfwWarn.checked = isNsfwWarningEnabled();

chkNsfwWarn.addEventListener("change", () => {
    setNsfwWarningEnabled(chkNsfwWarn.checked);
});

chkNsfwBlur.checked = isNsfwBlurEnabled();
applyNsfwBlurPreference();

chkNsfwBlur.addEventListener("change", () => {
    setNsfwBlurEnabled(chkNsfwBlur.checked);
});

const chkLpNsfwBlur = document.getElementById("chk-lp-nsfw-blur") as HTMLInputElement;
const chkLpAdultBlur = document.getElementById("chk-lp-adult-blur") as HTMLInputElement;
chkLpNsfwBlur.checked = readBoolPref(LP_NSFW_BLUR_KEY);
chkLpAdultBlur.checked = readBoolPref(LP_ADULT_BLUR_KEY);
applyLinkPreviewBlurPreferences();
chkLpNsfwBlur.addEventListener("change", () => {
    writeBoolPref(LP_NSFW_BLUR_KEY, chkLpNsfwBlur.checked);
    applyLinkPreviewBlurPreferences();
});
chkLpAdultBlur.addEventListener("change", () => {
    writeBoolPref(LP_ADULT_BLUR_KEY, chkLpAdultBlur.checked);
    applyLinkPreviewBlurPreferences();
});

// ── Integrated title bar (PRD 19 R7) ─────────────────────────────────────────
// The main process decides the frame before the window exists; the page only
// learns which mode is in force (body classes drive the drag region, the space
// for the OS controls and hiding the bar in fullscreen) and offers the switch.

const chkSystemTitleBar = document.getElementById("chk-system-titlebar") as HTMLInputElement;
const systemTitleBarRestart = document.getElementById("system-titlebar-restart") as HTMLDivElement;

function applyWindowChromeState(state: { maximized: boolean; fullscreen: boolean }): void {
    document.body.classList.toggle("window-maximized", state.maximized);
    document.body.classList.toggle("window-fullscreen", state.fullscreen);
}

void api.windowChrome.get().then((chrome) => {
    document.body.classList.toggle("integrated-titlebar", chrome.integrated);
    document.body.classList.add(`platform-${chrome.platform}`);
    applyWindowChromeState(chrome);
    chkSystemTitleBar.checked = chrome.systemTitleBarSaved;
    // Saved but not yet in force (changed, then not restarted): keep saying so.
    systemTitleBarRestart.style.display = chrome.systemTitleBarSaved === chrome.integrated ? "" : "none";
});
api.on("window-chrome-state", applyWindowChromeState);

chkSystemTitleBar.addEventListener("change", async () => {
    const res = await api.windowChrome.setSystemTitleBar(chkSystemTitleBar.checked);
    if (!res.saved) {
        chkSystemTitleBar.checked = !chkSystemTitleBar.checked;
        showToast("Couldn't save the title-bar choice.");
        return;
    }
    systemTitleBarRestart.style.display = res.restartNeeded ? "" : "none";
});
document.getElementById("btn-system-titlebar-restart")?.addEventListener("click", () => void api.windowChrome.relaunch());

const chkLinkPreviews = document.getElementById("chk-link-previews") as HTMLInputElement;
chkLinkPreviews.checked = isLinkPreviewsEnabled();
applyLinkPreviewPreference();
chkLinkPreviews.addEventListener("change", () => {
    setLinkPreviewsEnabled(chkLinkPreviews.checked);
});

// ── Identity fingerprint in Settings → About (PRD 17.12) ────────────────────
const aboutIdentityFingerprint = document.getElementById("about-identity-fingerprint") as HTMLElement;
const btnCopyFingerprint = document.getElementById("btn-copy-fingerprint") as HTMLButtonElement;
btnCopyFingerprint.addEventListener("click", async () => {
    const fp = aboutIdentityFingerprint.textContent ?? "";
    if (!fp.startsWith("SHA256:")) return;
    const ok = await api.copyText(fp);
    btnCopyFingerprint.textContent = ok ? "Copied!" : "Copy failed";
    setTimeout(() => (btnCopyFingerprint.textContent = "Copy"), 1500);
});

// ── Identity key storage, backup and restore (PRD 18.6) ─────────────────────
const aboutIdentityStorage = document.getElementById("about-identity-storage") as HTMLDivElement;
const btnIdentityExport = document.getElementById("btn-identity-export") as HTMLButtonElement;
const btnIdentityImport = document.getElementById("btn-identity-import") as HTMLButtonElement;
const identityExportModal = document.getElementById("identity-export-modal") as HTMLDivElement;
const identityImportModal = document.getElementById("identity-import-modal") as HTMLDivElement;
const identityLockedModal = document.getElementById("identity-locked-modal") as HTMLDivElement;
const identityExportPass = document.getElementById("identity-export-pass") as HTMLInputElement;
const identityExportPass2 = document.getElementById("identity-export-pass2") as HTMLInputElement;
const identityExportError = document.getElementById("identity-export-error") as HTMLDivElement;
const btnIdentityExportConfirm = document.getElementById("btn-identity-export-confirm") as HTMLButtonElement;
const identityImportPass = document.getElementById("identity-import-pass") as HTMLInputElement;
const identityImportError = document.getElementById("identity-import-error") as HTMLDivElement;
const btnIdentityImportUnlock = document.getElementById("btn-identity-import-unlock") as HTMLButtonElement;
const btnIdentityImportApply = document.getElementById("btn-identity-import-apply") as HTMLButtonElement;
const MIN_BACKUP_PASSPHRASE = 10; // mirrors identity-backup.ts; main re-validates

let importToken: string | null = null;

/** Fills the About → Identity block from the main process's view of the key. */
async function refreshIdentityPanel(): Promise<void> {
    try {
        const st = await api.identity.getStatus();
        if (st.state === "locked") {
            aboutIdentityFingerprint.textContent = "Locked";
            aboutIdentityStorage.textContent =
                "Your identity key couldn't be unlocked, so you can't connect. Import a backup or create a new identity.";
            aboutIdentityStorage.classList.add("warn");
        } else {
            aboutIdentityFingerprint.textContent = st.fingerprint;
            aboutIdentityStorage.classList.remove("warn");
            aboutIdentityStorage.textContent =
                st.storage === "encrypted"
                    ? "Stored encrypted by your operating system."
                    : st.storage === "file"
                      ? "Stored as a protected file in Reson8's data folder (no system keyring available)."
                      : "Temporary identity for this development build — it changes every launch.";
        }
        btnIdentityExport.disabled = !st.canBackup || st.state === "locked";
        btnIdentityImport.disabled = !st.canBackup;
        const devTitle = "Not available in development builds, which use a temporary identity";
        btnIdentityExport.title = st.canBackup ? "" : devTitle;
        btnIdentityImport.title = st.canBackup ? "" : devTitle;
        if (st.state === "locked") identityLockedModal.classList.add("visible");
    } catch {
        aboutIdentityFingerprint.textContent = "Unavailable";
    }
}
void refreshIdentityPanel();

function closeIdentityExportModal(): void {
    identityExportModal.classList.remove("visible");
    identityExportPass.value = "";
    identityExportPass2.value = "";
}

function closeIdentityImportModal(): void {
    identityImportModal.classList.remove("visible");
    identityImportPass.value = "";
    importToken = null;
}

btnIdentityExport.addEventListener("click", () => {
    identityExportPass.value = "";
    identityExportPass2.value = "";
    identityExportError.textContent = "";
    identityExportModal.classList.add("visible");
    identityExportPass.focus();
});
document.getElementById("btn-identity-export-cancel")!.addEventListener("click", closeIdentityExportModal);

btnIdentityExportConfirm.addEventListener("click", async () => {
    const pass = identityExportPass.value;
    identityExportError.textContent = "";
    if (pass.normalize("NFC").length < MIN_BACKUP_PASSPHRASE) {
        identityExportError.textContent = `Use at least ${MIN_BACKUP_PASSPHRASE} characters.`;
        return;
    }
    if (pass !== identityExportPass2.value) {
        identityExportError.textContent = "The two passphrases don't match.";
        return;
    }
    btnIdentityExportConfirm.disabled = true;
    try {
        const res = await api.identity.exportBackup(pass);
        if (res.ok) {
            closeIdentityExportModal();
            showToast(`Identity saved to <strong>${escapeHtml(res.path ?? "the chosen file")}</strong>`, 6000);
            log("Identity backup exported", "success");
        } else if (!res.canceled) {
            identityExportError.textContent = res.error ?? "Couldn't export the identity.";
        }
    } finally {
        btnIdentityExportConfirm.disabled = false;
    }
});

async function startIdentityImport(): Promise<void> {
    const picked = await api.identity.pickBackup();
    if (!picked.ok || !picked.token) {
        if (!picked.canceled) showToast(escapeHtml(picked.error ?? "Couldn't open that file"));
        return;
    }
    importToken = picked.token;
    (document.getElementById("identity-import-file") as HTMLElement).textContent = picked.fileName ?? "backup";
    identityImportPass.value = "";
    identityImportError.textContent = "";
    (document.getElementById("identity-import-step-pass") as HTMLElement).style.display = "";
    (document.getElementById("identity-import-step-confirm") as HTMLElement).style.display = "none";
    identityLockedModal.classList.remove("visible");
    identityImportModal.classList.add("visible");
    identityImportPass.focus();
}

btnIdentityImport.addEventListener("click", () => void startIdentityImport());
document.getElementById("btn-identity-import-cancel")!.addEventListener("click", closeIdentityImportModal);
document.getElementById("btn-identity-import-back")!.addEventListener("click", closeIdentityImportModal);

btnIdentityImportUnlock.addEventListener("click", async () => {
    if (!importToken) return;
    identityImportError.textContent = "";
    btnIdentityImportUnlock.disabled = true;
    try {
        const res = await api.identity.decryptBackup(importToken, identityImportPass.value);
        identityImportPass.value = "";
        if (!res.ok) {
            identityImportError.textContent = res.error ?? "Couldn't unlock the backup.";
            return;
        }
        if (res.fingerprint === res.currentFingerprint && res.instanceId === res.currentInstanceId) {
            closeIdentityImportModal();
            showToast("That backup is the identity this install already uses — nothing to import.");
            return;
        }
        const set = (id: string, text: string): void => {
            (document.getElementById(id) as HTMLElement).textContent = text;
        };
        set("identity-import-new-fp", res.fingerprint ?? "");
        set("identity-import-new-id", `User ID ${res.instanceId ?? ""}`);
        set("identity-import-cur-fp", res.currentFingerprint ?? "(locked)");
        set("identity-import-cur-id", `User ID ${res.currentInstanceId ?? ""}`);
        (document.getElementById("identity-import-step-pass") as HTMLElement).style.display = "none";
        (document.getElementById("identity-import-step-confirm") as HTMLElement).style.display = "";
    } finally {
        btnIdentityImportUnlock.disabled = false;
    }
});
identityImportPass.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnIdentityImportUnlock.click();
});

btnIdentityImportApply.addEventListener("click", async () => {
    if (!importToken) return;
    btnIdentityImportApply.disabled = true;
    const res = await api.identity.applyBackup(importToken);
    if (!res.ok) {
        btnIdentityImportApply.disabled = false;
        showToast(escapeHtml(res.error ?? "Couldn't apply the backup"));
        closeIdentityImportModal();
        return;
    }
    btnIdentityImportApply.textContent = "Restarting…"; // the app relaunches on its own
});

// Locked key (PRD 18.6): raised by the preload when a connect finds it.
api.on("identity-locked", () => {
    showWelcomeForm(); // PRD 19 R1
    identityLockedModal.classList.add("visible");
    log("Your identity key is locked — import a backup or create a new identity", "error");
    void refreshIdentityPanel();
});
document.getElementById("btn-identity-locked-close")!.addEventListener("click", () => {
    identityLockedModal.classList.remove("visible");
});
document.getElementById("btn-identity-locked-import")!.addEventListener("click", () => void startIdentityImport());
{
    // Creating a new identity orphans every binding the old key had on servers,
    // so it takes a second, deliberate click (the same arming pattern as "Reset key").
    const btn = document.getElementById("btn-identity-locked-new") as HTMLButtonElement;
    let armedUntil = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    btn.addEventListener("click", async () => {
        if (Date.now() > armedUntil) {
            armedUntil = Date.now() + 5000;
            btn.textContent = "Click again to confirm";
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => (btn.textContent = "Create new identity"), 5000);
            return;
        }
        if (timer) clearTimeout(timer);
        btn.textContent = "Create new identity";
        const res = await api.identity.createNew();
        if (res.ok) {
            identityLockedModal.classList.remove("visible");
            showToast("New identity created. Ask a server admin to reset your old one to get your roles back.", 7000);
            log("Created a new identity (the old key file was kept aside)", "success");
            void refreshIdentityPanel();
        } else {
            showToast(escapeHtml(res.error ?? "Couldn't create a new identity"));
        }
    });
}
document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (identityExportModal.classList.contains("visible")) closeIdentityExportModal();
    else if (identityImportModal.classList.contains("visible")) closeIdentityImportModal();
    else if (identityLockedModal.classList.contains("visible")) identityLockedModal.classList.remove("visible");
});

// ── Profile: avatar settings (PRD 17.1) ─────────────────────────────────────
// Settings → Application. Editing is a draft until Save; the preview probes
// the provider with d=404 to tell "your picture" from "a generated one".

const profileAvatarPreview = document.getElementById("profile-avatar-preview") as HTMLSpanElement;
const profileAvatarStatus = document.getElementById("profile-avatar-status") as HTMLSpanElement;
const profileEmailInput = document.getElementById("profile-email-input") as HTMLInputElement;
const profileEmailError = document.getElementById("profile-email-error") as HTMLSpanElement;
const profileProviderLink = document.getElementById("profile-provider-link") as HTMLAnchorElement;
const btnProfileSave = document.getElementById("btn-profile-save") as HTMLButtonElement;
const btnProfileRemove = document.getElementById("btn-profile-remove") as HTMLButtonElement;
const chkAvatarsExternal = document.getElementById("chk-avatars-external") as HTMLInputElement;
const profileProviderButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".segmented-option[data-avatar-provider]"),
);

const AVATAR_PROVIDER_INFO: Record<AvatarProvider, { name: string; site: string; url: string }> = {
    libravatar: { name: "Libravatar", site: "libravatar.org", url: "https://www.libravatar.org/" },
    gravatar: { name: "Gravatar", site: "gravatar.com", url: "https://gravatar.com/" },
};
const PROFILE_PREVIEW_PX = 96;

let profileDraftProvider: AvatarProvider = readAvatarPrefs().provider;
let profilePreviewTimer: ReturnType<typeof setTimeout> | null = null;
let profilePreviewToken = 0;
let profileSaving = false;

profileAvatarPreview.dataset.avatarPreview = "1";
profileAvatarPreview.dataset.avatarPx = String(PROFILE_PREVIEW_PX);

function setProfileStatus(text: string, found = false): void {
    profileAvatarStatus.textContent = text;
    profileAvatarStatus.classList.toggle("found", found);
}

/** Paints the preview for the current draft; `immediate` skips the typing debounce. */
function updateProfilePreview(immediate = false): void {
    if (profilePreviewTimer) clearTimeout(profilePreviewTimer);
    const run = (): void => {
        const token = ++profilePreviewToken;
        const myId = api.getInstanceId();
        profileAvatarPreview.dataset.avatarUserId = myId;
        profileAvatarPreview.dataset.avatarNick = nicknameInput.value.trim() || "You";
        const px = PROFILE_PREVIEW_PX * 2;
        const email = profileEmailInput.value.trim();
        const fallback = myId ? [api.avatar.withSize(api.avatar.defaultUrl(myId), px)] : [];

        if (!areExternalAvatarsEnabled()) {
            applyAvatar(profileAvatarPreview, []);
            setProfileStatus("External avatars are off");
            return;
        }
        if (!email) {
            applyAvatar(profileAvatarPreview, fallback);
            setProfileStatus("Default avatar");
            return;
        }
        if (!api.avatar.isPlausibleEmail(email)) return; // keep the last good preview while typing

        const selection = api.avatar.selectionFor(profileDraftProvider, email);
        const name = AVATAR_PROVIDER_INFO[profileDraftProvider].name;
        const chosen = [api.avatar.withSize(api.avatar.previewUrl(selection, "wavatar"), px), ...fallback];
        setProfileStatus("Checking…");
        // Libravatar can take several seconds (it proxies Gravatar on a miss),
        // so the probe gives up after a while instead of "Checking…" forever.
        const giveUp = setTimeout(() => {
            if (token !== profilePreviewToken) return;
            profilePreviewToken++; // a late probe answer must not overwrite this
            applyAvatar(profileAvatarPreview, chosen);
            setProfileStatus(`Couldn't reach ${name} right now — your choice will still be used.`);
        }, 10000);
        // A detached Image is fine here (it's an image probe, not playback).
        const probe = new Image();
        probe.referrerPolicy = "no-referrer";
        probe.onload = () => {
            clearTimeout(giveUp);
            if (token !== profilePreviewToken) return;
            applyAvatar(profileAvatarPreview, chosen);
            setProfileStatus("Avatar found ✓", true);
        };
        probe.onerror = () => {
            clearTimeout(giveUp);
            if (token !== profilePreviewToken) return;
            applyAvatar(profileAvatarPreview, chosen);
            setProfileStatus(`No picture on ${name} yet — you'll get a generated one. New pictures can take a few minutes to appear.`);
        };
        probe.src = api.avatar.withSize(api.avatar.previewUrl(selection, "404"), px);
    };
    if (immediate) run();
    else profilePreviewTimer = setTimeout(run, 400);
}

/** Provider toggle, link text, validation message and button states for the draft. */
function renderProfileControls(): void {
    for (const btn of profileProviderButtons) {
        const selected = btn.dataset.avatarProvider === profileDraftProvider;
        btn.setAttribute("aria-checked", String(selected));
        btn.tabIndex = selected ? 0 : -1;
    }
    profileProviderLink.textContent = AVATAR_PROVIDER_INFO[profileDraftProvider].site;

    const email = profileEmailInput.value.trim();
    const invalid = email.length > 0 && !api.avatar.isPlausibleEmail(email);
    profileEmailInput.classList.toggle("invalid", invalid);
    profileEmailError.textContent = invalid ? "That doesn't look like an email address." : "";

    const saved = readAvatarPrefs();
    const dirty = profileDraftProvider !== saved.provider || email.toLowerCase() !== saved.email.trim().toLowerCase();
    btnProfileSave.disabled = profileSaving || invalid || !dirty;
    btnProfileRemove.disabled = profileSaving || !saved.email;
}

/** Resets the draft to the saved preferences — every time Settings opens. */
function syncProfileSection(): void {
    const saved = readAvatarPrefs();
    profileDraftProvider = saved.provider;
    profileEmailInput.value = saved.email;
    chkAvatarsExternal.checked = areExternalAvatarsEnabled();
    renderProfileControls();
    updateProfilePreview(true);
}

/** Saves the draft (or clears it) and tells the server when connected. */
async function commitAvatar(provider: AvatarProvider, email: string): Promise<void> {
    writeAvatarPrefs(provider, email);
    renderProfileControls(); // the draft is now the saved state
    const selection = currentAvatarSelection();
    api.setAvatarSelection(selection); // every future join carries it

    if (!isConnected) {
        showToast(email ? "Avatar saved — it will be shared when you connect" : "Avatar removed");
        return;
    }

    profileSaving = true;
    renderProfileControls();
    const res = await api.setAvatar(selection);
    profileSaving = false;
    renderProfileControls();

    if (res.success) {
        const myId = api.getInstanceId();
        rememberAvatarUrl(myId, res.avatarUrl ?? null);
        refreshAvatars(myId);
        showToast(email ? "Avatar saved" : "Avatar removed");
    } else if (res.unsupported) {
        showToast("Saved on this computer. This server doesn't support avatars yet — it needs Reson8 2.6.0.", 6000);
    } else {
        showToast(`Saved on this computer, but the server refused it: ${escapeHtml(res.error ?? "unknown error")}`, 6000);
    }
}

for (const btn of profileProviderButtons) {
    btn.addEventListener("click", () => {
        profileDraftProvider = btn.dataset.avatarProvider === "gravatar" ? "gravatar" : "libravatar";
        renderProfileControls();
        updateProfilePreview(true);
    });
    // Arrow keys move between the two options (radiogroup keyboard pattern).
    btn.addEventListener("keydown", (e) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
        e.preventDefault();
        const next = profileProviderButtons.find((b) => b !== btn);
        next?.click();
        next?.focus();
    });
}

profileEmailInput.addEventListener("input", () => {
    renderProfileControls();
    updateProfilePreview();
});

profileEmailInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !btnProfileSave.disabled) {
        e.preventDefault();
        btnProfileSave.click();
    }
});

profileProviderLink.addEventListener("click", (e) => {
    e.preventDefault();
    api.openExternal(AVATAR_PROVIDER_INFO[profileDraftProvider].url);
});

btnProfileSave.addEventListener("click", async () => {
    const email = profileEmailInput.value.trim();
    if (email && !api.avatar.isPlausibleEmail(email)) return;
    await commitAvatar(profileDraftProvider, email);
});

btnProfileRemove.addEventListener("click", async () => {
    profileEmailInput.value = "";
    await commitAvatar(profileDraftProvider, "");
    updateProfilePreview(true);
});

chkAvatarsExternal.addEventListener("change", () => {
    setExternalAvatarsEnabled(chkAvatarsExternal.checked);
    updateProfilePreview(true);
});

// Hand the saved choice to the preload before any connect, so the very first
// USER_JOIN_SERVER (and every reconnect) carries it.
api.setAvatarSelection(currentAvatarSelection());

api.on("user-avatar-updated", (data: { userId: string; avatarUrl: string | null }) => {
    rememberAvatarUrl(data.userId, data.avatarUrl);
    refreshAvatars(data.userId);
});

// ── Audio Tab Volume Sliders (PRD 10.2) ────────────────────────────────────

audioNudgeVolumeSlider.value = String(nudgeVolume);
audioNudgeVolumeValue.textContent = `${nudgeVolume}%`;
audioAlertVolumeSlider.value = String(alertVolume);
audioAlertVolumeValue.textContent = `${alertVolume}%`;
audioVoiceVolumeSlider.value = String(voiceVolume);
audioVoiceVolumeValue.textContent = `${voiceVolume}%`;

audioNudgeVolumeSlider.addEventListener("input", () => {
    nudgeVolume = Number(audioNudgeVolumeSlider.value);
    audioNudgeVolumeValue.textContent = `${nudgeVolume}%`;
    localStorage.setItem("reson8-nudge-volume", String(nudgeVolume));
});

audioAlertVolumeSlider.addEventListener("input", () => {
    alertVolume = Number(audioAlertVolumeSlider.value);
    audioAlertVolumeValue.textContent = `${alertVolume}%`;
    localStorage.setItem("reson8-alert-volume", String(alertVolume));
});

audioVoiceVolumeSlider.addEventListener("input", () => {
    voiceVolume = Number(audioVoiceVolumeSlider.value);
    audioVoiceVolumeValue.textContent = `${voiceVolume}%`;
    localStorage.setItem("reson8-voice-volume", String(voiceVolume));
    api.setGlobalVoiceVolume(voiceVolume);
});

// ── Auto-Updater (PRD 10.1, state machine PRD 19 B12) ───────────────────────
// ONE state object drives the update modal, the About row and the gear dot.
// The startup check (fired from main.ts) never touches this UI directly: it
// only reaches the renderer via the "update-available" event, so a failed or
// negative startup check is silent by construction.

type UpdatePhase = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error";
interface UpdateState {
    phase: UpdatePhase;
    current: string;
    next?: string;
    releaseDate?: string;
    sizeBytes?: number;
    percent?: number;
    transferred?: number;
    total?: number;
    checkedAt?: number;
    error?: string;
    /** What the error interrupted: a download (an update was found) or a check. */
    errorDuring?: "check" | "download";
}
let updateState: UpdateState = { phase: "idle", current: "" };
const updateListeners = new Set<(s: UpdateState) => void>();

/** Merges `patch` into the state, then tells every listener. */
function setUpdateState(patch: Partial<UpdateState>): void {
    updateState = { ...updateState, ...patch };
    for (const listener of updateListeners) listener(updateState);
}

function formatBytes(n: number): string {
    return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** The corner card's content for the current phase (showing it is the event handlers' decision). */
function renderUpdateCard(state: UpdateState): void {
    const show = (el: HTMLElement, visible: boolean): void => {
        el.style.display = visible ? "" : "none";
    };
    show(btnUpdateNow, false);
    show(btnUpdateLater, false);
    show(btnUpdateNotes, false);
    show(btnUpdateNext, false);
    show(btnUpdateRestart, false);
    show(btnUpdateHide, false);
    show(updateCardError, false);
    updateCard.classList.toggle("is-downloading", state.phase === "downloading");
    btnUpdateNow.disabled = false;

    // In a call, a restart drops you from the room (set with textContent).
    const room = isInVoice && currentChannelId ? findChannelNodeById(currentTree, currentChannelId)?.name : null;
    const warn = !!room && (state.phase === "available" || state.phase === "ready");
    show(updateCardCall, warn);
    if (warn) updateCardRoom.textContent = room ?? "";

    switch (state.phase) {
        case "available":
            updateCardTitle.textContent = `Reson8 ${state.next ?? ""} is available`;
            updateCardNote.textContent = `You have ${state.current}.${state.sizeBytes ? ` ${formatBytes(state.sizeBytes)} to download.` : ""}`;
            show(btnUpdateNotes, !!state.next);
            show(btnUpdateLater, true);
            show(btnUpdateNow, true);
            break;
        case "downloading": {
            updateCardTitle.textContent = `Downloading Reson8 ${state.next ?? ""}…`;
            updateCardNote.textContent = "You can keep chatting. We'll ask before restarting.";
            const pct = Math.round(state.percent ?? 0);
            updateCardBarFill.style.width = `${pct}%`;
            updateCardPct.textContent = `${pct}%`;
            show(btnUpdateHide, true);
            break;
        }
        case "ready":
            // Nothing restarts by itself (PRD 19 B12): the user picks.
            updateCardTitle.textContent = "Ready to restart";
            updateCardNote.textContent = "The update is downloaded. Restart now, or it installs the next time Reson8 closes.";
            show(btnUpdateNext, true);
            show(btnUpdateRestart, true);
            break;
        case "error":
            updateCardTitle.textContent = "Update failed";
            updateCardNote.textContent = "The update could not be completed.";
            show(updateCardError, true);
            updateCardError.textContent = `Update failed: ${state.error}. Please download the latest version manually from GitHub.`;
            show(btnUpdateLater, true);
            show(btnUpdateNow, true);
            break;
        default:
            break;
    }
}

/** "just now", "5 min ago", or a clock time — for the About row's "checked …". */
function relativeChecked(at: number): string {
    const sec = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (sec < 60) return "just now";
    if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
    return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** The About › Updates row, per SPEC 8.1: title, note, tag, bar and actions for each phase. */
function renderUpdateAbout(state: UpdateState): void {
    const checking = state.phase === "checking";
    updateRowIcon.classList.toggle("spinning", checking);
    updateRowNew.style.display = state.phase === "available" ? "" : "none";
    updateRowBar.style.display = state.phase === "downloading" ? "" : "none";
    btnUpdateRowNotes.style.display = state.phase === "available" && state.next ? "" : "none";
    btnCheckUpdates.style.display = state.phase === "downloading" ? "none" : "";
    btnCheckUpdates.disabled = checking;
    btnCheckUpdates.className = "btn " + (state.phase === "available" || state.phase === "ready" ? "btn-primary" : "btn-secondary");
    btnCheckUpdates.textContent =
        state.phase === "available" ? "Update now" : state.phase === "ready" ? "Restart to update" : "Check for updates";
    const date = state.releaseDate ? new Date(state.releaseDate).toLocaleDateString() : "";

    switch (state.phase) {
        case "checking":
            updateRowTitle.textContent = "Checking for updates…";
            updateRowNote.textContent = "";
            break;
        case "up-to-date":
            updateRowTitle.textContent = "You're up to date";
            updateRowNote.textContent = `${state.current} is the latest version${state.checkedAt ? ` · checked ${relativeChecked(state.checkedAt)}` : ""}`;
            break;
        case "available":
            updateRowTitle.textContent = `Reson8 ${state.next ?? ""} is available`;
            updateRowNote.textContent = [
                date ? `Released ${date}` : "",
                state.sizeBytes ? formatBytes(state.sizeBytes) : "",
                `you have ${state.current}`,
            ]
                .filter(Boolean)
                .join(" · ");
            break;
        case "downloading": {
            const pct = Math.round(state.percent ?? 0);
            updateRowTitle.textContent = `Downloading ${state.next ?? "the update"}…`;
            updateRowNote.textContent = `${pct}%${state.total ? ` of ${formatBytes(state.total)}` : ""} · you can keep using Reson8`;
            updateRowBarFill.style.width = `${pct}%`;
            break;
        }
        case "ready":
            updateRowTitle.textContent = "Update ready";
            updateRowNote.textContent = "Downloaded. Restart Reson8 to finish — it takes a few seconds.";
            break;
        case "error":
            if (state.errorDuring === "download") {
                updateRowTitle.textContent = `Couldn't download ${state.next ?? "the update"}`;
                updateRowNote.textContent = `${state.error ? `${state.error} · ` : ""}you can download it manually from GitHub`;
            } else {
                updateRowTitle.textContent = "Couldn't check for updates";
                updateRowNote.textContent = state.error ? state.error : "Try again later.";
            }
            break;
        default:
            updateRowTitle.textContent = "Updates";
            updateRowNote.textContent = state.checkedAt ? `Last checked ${relativeChecked(state.checkedAt)}` : "";
    }
}

/** A dot on the gear while an update is available or ready. */
function renderUpdateGear(state: UpdateState): void {
    document
        .getElementById("btn-server-settings")
        ?.classList.toggle("has-update", state.phase === "available" || state.phase === "ready");
}

updateListeners.add(renderUpdateCard);
updateCardVoiceHook = () => renderUpdateCard(updateState);
updateListeners.add(renderUpdateAbout);
updateListeners.add(renderUpdateGear);

// Handlers are named so they can be exercised without the main process.
function onUpdateAvailable(data: { version: string; releaseDate?: string; sizeBytes?: number }): void {
    setUpdateState({
        phase: "available",
        next: data.version,
        releaseDate: data.releaseDate,
        sizeBytes: data.sizeBytes,
        percent: undefined,
        error: undefined,
        checkedAt: Date.now(),
    });
    updateCard.classList.add("visible");
}

function onDownloadProgress(data: { percent: number; transferred?: number; total?: number }): void {
    if (updateState.phase !== "downloading") return;
    setUpdateState({ percent: data.percent, transferred: data.transferred, total: data.total });
}

function onUpdateDownloaded(): void {
    setUpdateState({ phase: "ready", percent: 100 });
    updateCard.classList.add("visible");
}

function onUpdateError(data: { message: string }): void {
    const during =
        updateState.phase === "error"
            ? (updateState.errorDuring ?? "check") // a repeat of the same failure keeps its kind
            : updateState.phase === "available" || updateState.phase === "downloading"
              ? "download"
              : "check";
    setUpdateState({ phase: "error", error: data.message, errorDuring: during });
    updateCard.classList.add("visible");
}

api.on("update-available", onUpdateAvailable);
api.on("download-progress", onDownloadProgress);
api.on("update-downloaded", onUpdateDownloaded);
api.on("update-error", onUpdateError);

function startUpdateDownload(): void {
    setUpdateState({ phase: "downloading", percent: 0, transferred: undefined, total: undefined, error: undefined });
    updateCard.classList.add("visible"); // the card shows the progress; Hide dismisses it
    api.downloadUpdate();
}

btnUpdateNow.addEventListener("click", startUpdateDownload);

// × and Later (and Hide while downloading) only hide the card: the phase stays,
// so the gear dot and the About row keep showing it (PRD 19 C12).
const hideUpdateCard = (): void => updateCard.classList.remove("visible");
btnUpdateLater.addEventListener("click", hideUpdateCard);
btnUpdateClose.addEventListener("click", hideUpdateCard);
btnUpdateHide.addEventListener("click", hideUpdateCard);

btnUpdateRestart.addEventListener("click", () => {
    api.quitAndInstall();
});

btnUpdateNext.addEventListener("click", () => {
    // Hides the card and keeps phase "ready": electron-updater installs on
    // quit (autoInstallOnAppQuit defaults to true; main.ts does not set it).
    hideUpdateCard();
});

/** Wraps "#123" issue references in monospace accent chips (text nodes only; links and code are left alone). */
function chipIssueRefs(root: HTMLElement): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n as Text;
        if (/#\d+/.test(text.data) && !text.parentElement?.closest("a, code, pre")) targets.push(text);
    }
    for (const node of targets) {
        const frag = document.createDocumentFragment();
        let last = 0;
        for (const m of node.data.matchAll(/#\d+/g)) {
            const at = m.index ?? 0;
            if (at > last) frag.append(node.data.slice(last, at));
            const chip = document.createElement("span");
            chip.className = "issue-chip";
            chip.textContent = m[0];
            frag.append(chip);
            last = at + m[0].length;
        }
        if (last < node.data.length) frag.append(node.data.slice(last));
        node.replaceWith(frag);
    }
}

type WhatsNewVariant = "launch" | "about" | "pending";

/**
 * Fills and opens the What's new dialog (PRD 19 C12). "launch" (first launch of a
 * new version) is the only one whose button marks the version as seen; "about"
 * (Settings › About) and "pending" (an available update's notes) just close.
 */
function showWhatsNew(
    variant: WhatsNewVariant,
    version: string,
    notes: { name: string; bodyHtml: string; htmlUrl: string; publishedAt?: string },
): void {
    pendingWhatsNewVersion = variant === "launch" ? version : null;
    pendingWhatsNewUrl = notes.htmlUrl;
    whatsNewKicker.textContent =
        variant === "launch" ? "Updated · you're on the new version" : variant === "pending" ? "Available update" : "Release notes";
    whatsNewTitle.textContent = `What's new in ${notes.name || `v${version}`}`;
    whatsNewDate.textContent = notes.publishedAt ? new Date(notes.publishedAt).toLocaleDateString() : "";
    btnWhatsNewDismiss.textContent = variant === "launch" ? "Got it" : "Close";
    whatsNewFootNote.textContent =
        variant === "launch"
            ? "From the GitHub release. Shown once after each update; find it again in Settings › About."
            : "From the GitHub release.";
    // Already-rendered HTML (see main.ts's ReleaseNotes doc comment) — not raw markdown.
    whatsNewBody.innerHTML = notes.bodyHtml || "<p>No release notes were provided for this version.</p>";
    chipIssueRefs(whatsNewBody);
    whatsNewModal.classList.add("visible");
}

/** The pending update's release notes (PRD 19 B12): Close never marks a version as seen. */
async function openPendingNotes(): Promise<void> {
    const next = updateState.next;
    if (!next) return;
    const notes = await api.fetchReleaseNotes(next);
    if (!notes) {
        showToast("Could not load the release notes right now.");
        return;
    }
    showWhatsNew("pending", next, notes);
}

btnUpdateNotes.addEventListener("click", () => void openPendingNotes());
btnUpdateRowNotes.addEventListener("click", () => void openPendingNotes());

/** The About row's primary action depends on the phase: check, download, or restart. */
btnCheckUpdates.addEventListener("click", () => {
    if (updateState.phase === "available") startUpdateDownload();
    else if (updateState.phase === "ready") api.quitAndInstall();
});

document.getElementById("btn-about-whats-new")?.addEventListener("click", async () => {
    const version = updateState.current;
    if (!version) return;
    const notes = await api.fetchReleaseNotes(version);
    if (!notes) {
        showToast("Could not load the release notes right now.");
        return;
    }
    showWhatsNew("about", version, notes);
});

// ── About Tab (PRD 10.1) ────────────────────────────────────────────────────

api.getAppVersion().then((version) => {
    aboutVersion.textContent = `Version ${version}`;
    const clientVersion = document.getElementById("status-client-version");
    if (clientVersion) clientVersion.textContent = `Client ${version}`; // PRD 19 C2
    setUpdateState({ current: version });
    checkForWhatsNew(version);
});

// ── Post-Update "What's New" Modal (PRD 11.4) ───────────────────────────────
// Shown once per version bump: compares the running app version against the
// last one the user actually dismissed this modal for (localStorage), and if
// they differ, fetches that version's GitHub release notes and shows them.
// The "seen" marker is only persisted once the modal has actually been shown
// and dismissed — a failed fetch (offline, rate-limited) is retried on the
// next launch instead of silently losing the notification.
let pendingWhatsNewVersion: string | null = null;
let pendingWhatsNewUrl: string | null = null;

async function checkForWhatsNew(currentVersion: string): Promise<void> {
    const lastSeen = localStorage.getItem("reson8-last-seen-version");
    if (!lastSeen) {
        // No local record of a "last seen" version. This is either a truly
        // fresh install (nothing to announce "what's new" against) or an
        // upgrade from a pre-11.4 client that predates this feature and so
        // never wrote the marker in the first place — telling those apart
        // needs a signal older than this feature itself, so we reuse the
        // instance ID file's presence (written on this client's actual
        // first-ever launch, independent of any single feature's state).
        const isExistingInstall = await api.isExistingInstall();
        if (!isExistingInstall) {
            localStorage.setItem("reson8-last-seen-version", currentVersion);
            return;
        }
        // Existing install, first launch with this feature — fall through
        // and show this version's notes, same as any other version bump.
    } else if (lastSeen === currentVersion) {
        return;
    }

    const notes = await api.fetchReleaseNotes(currentVersion);
    if (!notes) return; // try again next launch

    // The fetch can finish after the user has already connected (or started to):
    // the modal must never appear over a live session (PRD 19 B11). Return
    // WITHOUT marking the version as seen, so the notes show at the next launch.
    if (isConnected || connectInProgress) return;

    showWhatsNew("launch", currentVersion, notes);
}

btnWhatsNewDismiss.addEventListener("click", () => {
    whatsNewModal.classList.remove("visible");
    if (pendingWhatsNewVersion) {
        localStorage.setItem("reson8-last-seen-version", pendingWhatsNewVersion);
        pendingWhatsNewVersion = null;
    }
});

btnWhatsNewGithub.addEventListener("click", () => {
    if (pendingWhatsNewUrl) window.open(pendingWhatsNewUrl, "_blank");
});

whatsNewModal.addEventListener("click", (e) => {
    if (e.target === whatsNewModal) {
        whatsNewModal.classList.remove("visible");
        // Not marked as seen — an accidental backdrop click shouldn't
        // permanently suppress the notification.
    }
});

// ── Client/Server Version Mismatch Warning (Phase 12 sub-phase, item 11) ───
// Warns on ANY difference between the connected server's version and this
// client's own version, in either direction, showing both numbers. Not
// persisted/dismissed-forever like "What's New" above — a mismatch is a
// per-connection fact (you might connect to a different, up-to-date server
// next), so it's re-shown on every connection where it's still true.
// Comparison is semver-aware (PRD 19 R0) — "3.0.0-beta.1" must not parse as
// NaN — and lives in app-version.ts, reached through the preload.
async function checkVersionMismatch(serverVersion: string): Promise<void> {
    const clientVersion = await api.getAppVersion();
    if (clientVersion === serverVersion) return;

    const order = api.version.compare(serverVersion, clientVersion);
    if (order === 0) return; // e.g. "v3.0.0" vs "3.0.0"
    if (order === null) {
        // Unparseable on one side: state both versions without guessing which is newer.
        versionMismatchMessage.textContent = `This server runs v${serverVersion}; your client is v${clientVersion}.`;
        btnVersionMismatchReleases.style.display = "none";
        versionMismatchModal.classList.add("visible");
        return;
    }
    const serverIsNewer = order > 0;
    versionMismatchMessage.textContent = serverIsNewer
        ? `This server is running v${serverVersion}, but your client is v${clientVersion}. Some features might not work correctly until you update.`
        : `Your client is v${clientVersion}, but this server is running v${serverVersion}. Some features might not work correctly until the server is updated.`;
    btnVersionMismatchReleases.style.display = serverIsNewer ? "" : "none";
    versionMismatchModal.classList.add("visible");
}

btnVersionMismatchDismiss.addEventListener("click", () => {
    versionMismatchModal.classList.remove("visible");
});

btnVersionMismatchReleases.addEventListener("click", () => {
    window.open("https://github.com/fbarrella/reson8/releases", "_blank");
});

versionMismatchModal.addEventListener("click", (e) => {
    if (e.target === versionMismatchModal) {
        versionMismatchModal.classList.remove("visible");
    }
});

btnCheckUpdates.addEventListener("click", async () => {
    // Update now / Restart are handled above; only the check phases get here.
    if (updateState.phase === "ready" || updateState.phase === "downloading" || updateState.phase === "available") return;
    setUpdateState({ phase: "checking", error: undefined });
    const result = await api.checkForUpdates();
    if (result.status === "not-available") {
        setUpdateState({ phase: "up-to-date", checkedAt: Date.now() });
    } else if (result.status === "error") {
        setUpdateState({ phase: "error", error: result.message, checkedAt: Date.now() });
    }
    // "available": the update-available event (onUpdateAvailable) sets the
    // phase and opens the corner card.
});

// ── Mic Sensitivity / Noise Gate ──────────────────────────────────────────

// Local active-speaker indicator (PRD 14.11) — the local user's own halo is
// computed straight from this same analyser tap instead of waiting for the
// server's 100ms-interval ACTIVE_SPEAKERS broadcast. That round trip is
// genuinely necessary for *other* users (their audio really does arrive via
// the server), but for the local user it adds needless perceived latency —
// the mic-level meter's own tick loop already reads this same signal every
// animation frame, so it's reused here rather than building a second
// analyser loop. A 300ms hold before clearing mirrors the server's own
// active-speaker hold behavior, so brief pauses between words don't flicker
// the halo on/off the way a raw instantaneous threshold check would.
let isLocalSpeaking = false;
/** True while the PTT key/combo is physically held (PRD 15.3) — the only
 *  moment the mic actually transmits in push-to-talk mode. */
let isPttHeld = false;
let localSpeakingHoldTimer: ReturnType<typeof setTimeout> | null = null;

/** Reuses the noise gate's own threshold when it's enabled (consistent
 *  "gate-open = speaking" behavior); falls back to a fixed default when the
 *  gate is off, matching the server-side AudioLevelObserver's own -50dB
 *  threshold (mediasoup.service.ts). */
function localSpeakingThreshold(): number {
    return micSensitivityEnabled ? parseInt(micSensitivitySlider.value, 10) : -50;
}

/** Whether the mic is actually open to other participants right now (PRD
 *  15.3). The local analyser taps the graph BEFORE mute takes effect, so
 *  level alone says nothing about whether anyone can hear you. */
function isLocalMicTransmitting(): boolean {
    return isInVoice && !isMuted && !isDeafened && (!pttModeEnabled || isPttHeld);
}

/** Drops the own-voice halo immediately when the mic stops transmitting
 *  (mute/deafen/PTT release), instead of waiting out the 300ms hold timer.
 *  Safe to call on every voice-UI refresh: a no-op while transmitting. */
function refreshLocalSpeakingHalo(): void {
    if (isLocalMicTransmitting()) return;
    if (localSpeakingHoldTimer) {
        clearTimeout(localSpeakingHoldTimer);
        localSpeakingHoldTimer = null;
    }
    if (isLocalSpeaking) {
        isLocalSpeaking = false;
        setLocalSpeakingClass(false);
    }
}

function setLocalSpeakingClass(speaking: boolean): void {
    const myId = api.getInstanceId();
    speakingEls(myId).forEach((el) => el.classList.toggle("speaking", speaking));
}

function startMicLevelMeter(): void {
    stopMicLevelMeter(); // clear any previous
    function tick() {
        const dB = api.getMicLevel();
        // Map dB range [-60, 0] to [0%, 100%]
        const pct = Math.max(0, Math.min(100, ((dB + 60) / 60) * 100));
        if (micLevelBar) micLevelBar.style.width = `${pct}%`;

        // Only meaningful while actually in a voice channel — outside one,
        // this analyser is reading the settings-preview capture instead,
        // and there's no local `.tree-occupant` row to update anyway.
        if (isInVoice) {
            const speaking = isLocalMicTransmitting() && dB > localSpeakingThreshold();
            if (speaking) {
                if (localSpeakingHoldTimer) {
                    clearTimeout(localSpeakingHoldTimer);
                    localSpeakingHoldTimer = null;
                }
                if (!isLocalSpeaking) {
                    isLocalSpeaking = true;
                    setLocalSpeakingClass(true);
                }
            } else if (isLocalSpeaking && !localSpeakingHoldTimer) {
                localSpeakingHoldTimer = setTimeout(() => {
                    isLocalSpeaking = false;
                    localSpeakingHoldTimer = null;
                    setLocalSpeakingClass(false);
                }, 300);
            }
        }

        micLevelAnimId = requestAnimationFrame(tick);
    }
    micLevelAnimId = requestAnimationFrame(tick);
}

function stopMicLevelMeter(): void {
    if (micLevelAnimId !== null) {
        cancelAnimationFrame(micLevelAnimId);
        micLevelAnimId = null;
    }
    if (localSpeakingHoldTimer) {
        clearTimeout(localSpeakingHoldTimer);
        localSpeakingHoldTimer = null;
    }
    if (isLocalSpeaking) {
        isLocalSpeaking = false;
        setLocalSpeakingClass(false);
    }
    if (micLevelBar) micLevelBar.style.width = "0%";
}

// Initialize noise gate from localStorage
{
    const savedThreshold = localStorage.getItem("reson8-mic-sensitivity-threshold");
    if (savedThreshold && micSensitivitySlider) {
        micSensitivitySlider.value = savedThreshold;
    }
    if (micSensitivityValue && micSensitivitySlider) {
        micSensitivityValue.textContent = `${micSensitivitySlider.value} dB`;
    }
    if (chkMicSensitivity) {
        chkMicSensitivity.checked = micSensitivityEnabled;
    }
    // The card's expand/collapse is driven purely by this checkbox's own
    // :checked state via CSS :has() — no separate visibility toggle needed.
    // Hide noise gate section if PTT mode is active
    if (pttModeEnabled && micSensitivitySection) {
        micSensitivitySection.style.display = "none";
    }
}

chkMicSensitivity?.addEventListener("change", () => {
    // The mic level meter no longer starts/stops with this toggle — it's
    // always running independently (see openSettingsPanel()/join handler)
    // — this only controls the gate itself now.
    micSensitivityEnabled = chkMicSensitivity.checked;
    if (micSensitivityEnabled) {
        localStorage.setItem("reson8-mic-sensitivity-enabled", "true");
        if (isInVoice && !pttModeEnabled) {
            const threshold = parseInt(micSensitivitySlider.value, 10);
            api.setMicSensitivity(true, threshold);
        }
    } else {
        localStorage.removeItem("reson8-mic-sensitivity-enabled");
        api.setMicSensitivity(false, 0);
    }
});

micSensitivitySlider?.addEventListener("input", () => {
    const val = micSensitivitySlider.value;
    micSensitivityValue.textContent = `${val} dB`;
    localStorage.setItem("reson8-mic-sensitivity-threshold", val);
    if (micSensitivityEnabled && isInVoice && !pttModeEnabled) {
        api.setMicThreshold(parseInt(val, 10));
    }
});

// ── Mic Volume (PRD 13.3) ───────────────────────────────────────────────────

if (micVolumeSlider) micVolumeSlider.value = String(micVolume);
if (micVolumeValue) micVolumeValue.textContent = `${micVolume}%`;

micVolumeSlider?.addEventListener("input", () => {
    micVolume = Number(micVolumeSlider.value);
    micVolumeValue.textContent = `${micVolume}%`;
    localStorage.setItem("reson8-mic-volume", String(micVolume));
    api.setMicVolume(micVolume);
});

// ── Noise Cancelling (PRD 13.1) ──────────────────────────────────────────────

if (chkNoiseCancel) chkNoiseCancel.checked = noiseCancelEnabled;
if (noiseCancelStrengthSlider) noiseCancelStrengthSlider.value = String(noiseCancelStrength);
if (noiseCancelStrengthValue) noiseCancelStrengthValue.textContent = String(noiseCancelStrength);

chkNoiseCancel?.addEventListener("change", () => {
    noiseCancelEnabled = chkNoiseCancel.checked;
    if (noiseCancelEnabled) {
        localStorage.setItem("reson8-noise-cancel-enabled", "true");
    } else {
        localStorage.removeItem("reson8-noise-cancel-enabled");
    }
    // The card's expand/collapse is driven purely by this checkbox's own
    // :checked state via CSS :has() — no separate visibility toggle needed.
    // The very first enable this session fetches/compiles the vendored WASM
    // engine — no UI blocking needed, it applies whenever it resolves.
    api.setNoiseCancelEnabled(noiseCancelEnabled);
});

// ── Noise Cancelling Strength (PRD 14.12) ────────────────────────────────────

noiseCancelStrengthSlider?.addEventListener("input", () => {
    noiseCancelStrength = Number(noiseCancelStrengthSlider.value);
    noiseCancelStrengthValue.textContent = String(noiseCancelStrength);
    localStorage.setItem("reson8-noise-cancel-strength", String(noiseCancelStrength));
    api.setNoiseCancelStrength(noiseCancelStrength);
});

// ── Self-Hear Mic Monitor (PRD 14.10) ────────────────────────────────────────

if (selfHearVolumeSlider) selfHearVolumeSlider.value = String(selfHearVolume);
if (selfHearVolumeValue) selfHearVolumeValue.textContent = `${selfHearVolume}%`;

chkSelfHear?.addEventListener("change", () => {
    setSelfHearEnabledAndNotify(chkSelfHear.checked);
});

btnStopSelfHear?.addEventListener("click", () => {
    setSelfHearEnabledAndNotify(false);
});

selfHearVolumeSlider?.addEventListener("input", () => {
    selfHearVolume = Number(selfHearVolumeSlider.value);
    if (selfHearVolumeValue) selfHearVolumeValue.textContent = `${selfHearVolume}%`;
    localStorage.setItem("reson8-self-hear-volume", String(selfHearVolume));
    api.setSelfHearVolume(selfHearVolume);
});
