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

interface Reson8Api {
    readonly platform: string;
    readonly isLinuxWayland: boolean;
    getInstanceId(): string;
    isExistingInstall(): Promise<boolean>;
    connect(host: string, port: number | undefined, nickname: string, password?: string): Promise<void>;
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
    fetchReleaseNotes(version: string): Promise<{ name: string; bodyHtml: string; htmlUrl: string } | null>;
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
    deleteChannel(channelId: string): Promise<{ success: boolean; error?: string }>;
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
    banUser(userId: string): Promise<{ success: boolean; error?: string }>;
    unbanUser(userId: string): Promise<{ success: boolean; error?: string }>;
    getBannedUsers(): Promise<{ success: boolean; users?: { userId: string; nickname: string; bannedAt: string }[]; error?: string }>;
    uploadFile(fileBuffer: ArrayBuffer, fileName: string, mimeType: string): Promise<UploadResult>;
    downloadImage(url: string): void;
    setCustomEmojis(list: Array<{ name: string; imageUrl: string }>): void;
    renderMarkdown(text: string): { html: string; block: boolean };
    avatar: {
        isPlausibleEmail(email: string): boolean;
        selectionFor(provider: "libravatar" | "gravatar", email: string): { provider: "libravatar" | "gravatar"; hash: string };
        previewUrl(selection: { provider: "libravatar" | "gravatar"; hash: string }, fallback: "wavatar" | "404"): string;
        defaultUrl(userId: string): string;
        withSize(url: string, px: number): string;
    };
    setAvatarSelection(selection: { provider: "libravatar" | "gravatar"; hash: string } | null): void;
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
    discardUpload(uploadId: string): Promise<{ success: boolean; error?: string }>;
    createCustomEmoji(name: string, image: UploadResult, isAnimated?: boolean): Promise<{ success: boolean; emojiId?: string; error?: string }>;
    getApprovedEmojis(): Promise<{ success: boolean; emojis?: CustomEmoji[]; error?: string }>;
    getPendingEmojis(): Promise<{ success: boolean; emojis?: CustomEmoji[]; error?: string }>;
    reviewCustomEmoji(emojiId: string, decision: "APPROVED" | "REJECTED"): Promise<{ success: boolean; error?: string }>;
    nudgeUser(targetUserId: string): Promise<{ success: boolean; error?: string }>;
    getServerSettings(): Promise<{
        success: boolean;
        nudgeEnabled?: boolean;
        screenShareEnabled?: boolean;
        name?: string;
        maxMessageLength?: number;
        version?: string;
        error?: string;
    }>;
    updateServerSettings(
        settings: { nudgeEnabled?: boolean; screenShareEnabled?: boolean; maxMessageLength?: number },
    ): Promise<{ success: boolean; error?: string }>;
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
    startScreenShareVideo(chromeMediaSourceId: string): Promise<{ success: boolean; error?: string }>;
    startScreenShareViaSystemPicker(): Promise<{
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
    ): Promise<{ success: boolean; error?: string }>;
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
let serverBaseUrl: string = "";

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

// Link preview cache (renderer-side to avoid redundant IPC calls)
const linkPreviewCache = new Map<string, LinkPreviewData | null>();

// Voice session timers: channelId → ISO startedAt
const sessionTimers = new Map<string, string>();

// Text channels with unread messages (PRD 4.13). Seeded from the server's
// per-user hasUnread flag at join time, then kept live client-side: every
// MESSAGE_RECEIVED for a channel that isn't the active tab adds to this set
// (no server round-trip needed, since MESSAGE_RECEIVED already broadcasts
// server-wide regardless of which tabs are open); opening a channel's tab
// clears it and persists the read cursor via MARK_CHANNEL_READ.
const unreadChannelIds = new Set<string>();

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
/** The currently-connected server's display name, once fetched via getServerSettings() — null until then / after disconnect. */
let connectedServerName: string | null = null;

/**
 * Composes the OS window title bar text — "Reson8" (or "Reson8 -
 * [ServerName]" once known) with a 🔴 prefix while actively screen
 * sharing. The two concerns (server name, live-sharing indicator) update
 * independently and at different times, so this is the single place that
 * combines them rather than each call site clobbering the other's part of
 * the string.
 */
function updateWindowTitle(): void {
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
const aboutUpdateStatus = document.getElementById("about-update-status") as HTMLDivElement;

// Update modal (PRD 10.1)
const updateModal = document.getElementById("update-modal") as HTMLDivElement;
const updateModalTitle = document.getElementById("update-modal-title") as HTMLHeadingElement;
const updateModalMessage = document.getElementById("update-modal-message") as HTMLParagraphElement;
const updateModalProgressWrap = document.getElementById("update-modal-progress-wrap") as HTMLDivElement;
const updateModalProgressBar = document.getElementById("update-modal-progress-bar") as HTMLDivElement;
const updateModalStatus = document.getElementById("update-modal-status") as HTMLDivElement;
const btnUpdateNow = document.getElementById("btn-update-now") as HTMLButtonElement;
const btnUpdateLater = document.getElementById("btn-update-later") as HTMLButtonElement;

const whatsNewModal = document.getElementById("whats-new-modal") as HTMLDivElement;
const whatsNewTitle = document.getElementById("whats-new-title") as HTMLHeadingElement;
const whatsNewBody = document.getElementById("whats-new-body") as HTMLDivElement;
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
const btnOnlineUsers = document.getElementById("btn-online-users") as HTMLButtonElement;
const onlineUsersModal = document.getElementById("online-users-modal") as HTMLDivElement;
const onlineUserList = document.getElementById("online-user-list") as HTMLDivElement;
const btnOnlineClose = document.getElementById("btn-online-close") as HTMLButtonElement;
const onlineDot = document.getElementById("online-dot") as HTMLSpanElement;
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
const btnStreamNameSkip = document.getElementById("btn-stream-name-skip") as HTMLButtonElement;
const btnStreamNameConfirm = document.getElementById("btn-stream-name-confirm") as HTMLButtonElement;

type DesktopSource = {
    id: string;
    name: string;
    thumbnail: string;
    appIcon: string | null;
    sourceType: "screen" | "window";
};
let selectedShareSource: DesktopSource | null = null;

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

const CHANNEL_ICON_CROP_VIEWPORT_SIZE = 220;
const CHANNEL_ICON_MAX_UPLOAD_SIZE = 512 * 1024; // 512KB, pre-crop (PRD 14.7's own cap, not the emoji one)
const CHANNEL_ICON_ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

let pendingChannelIconId: string | null = null;

// State for the channel-icon crop tool — a separate set of variables from
// the emoji crop tool's own (duplicated, not shared, per this feature's
// design decision), since both modals could in principle be reasoned about
// independently and neither is ever open while the other is mid-crop.
let channelIconCropNaturalWidth = 0;
let channelIconCropNaturalHeight = 0;
let channelIconCropBaseScale = 1;
let channelIconCropZoomFactor = 1;
let channelIconCropOffsetX = 0;
let channelIconCropOffsetY = 0;
let channelIconCropObjectUrl: string | null = null;
let channelIconCropDragging = false;
let channelIconCropDragStart = { x: 0, y: 0, offsetX: 0, offsetY: 0 };

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
    /** Text channel vs DM (PRD 17.5). Only channel tabs have a mode. */
    kind: "channel" | "dm";
    /** "preview" = replaced by the next channel opened; "kept" = stays open
     *  and is remembered across restarts (PRD 17.5). Channel tabs only. */
    mode?: "preview" | "kept";
}
const chatTabs = new Map<string, ChatTab>();

// ── Preview tabs & "Keep Tab Open" (PRD 17.5) ────────────────────────────────
// Clicking a text channel opens it in THE preview tab (at most one), which the
// next channel replaces in place. "Keep Tab Open" makes a tab permanent and
// remembers it per server (`reson8-kept-tabs`, same shape and try/catch
// discipline as `reson8-muted-channels`). DM tabs are unaffected.

/** The single preview tab, if any. */
let previewTabId: string | null = null;
/** Kept tabs are restored once per connection, after the first channel tree. */
let keptTabsRestored = false;
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
        .filter((id) => chatTabs.get(id)?.kind === "channel");
    try {
        const store = readKeptTabsStore();
        if (ids.length > 0) store[keptTabsServerId] = ids;
        else delete store[keptTabsServerId];
        localStorage.setItem(KEPT_TABS_KEY, JSON.stringify(store));
    } catch {
        /* storage unavailable — kept tabs just won't be remembered */
    }
}

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
        `<span class="tab-unread-dot" aria-hidden="true"></span>` +
        `<span class="tab-close" role="button" aria-label="Close tab">✕</span>`;
    (tabEl.querySelector(".tab-label") as HTMLElement).textContent = name;
}

/**
 * Unread indicator on an open, unfocused channel tab (PRD 17.6) — kept or
 * preview alike, never for a muted channel. Derived from the same state the
 * tree uses (`unreadChannelIds` + `isChannelMuted`), so the two can't
 * disagree. DM tabs are out of scope (DMs are marked read on arrival).
 */
function refreshTabUnread(channelId: string): void {
    const tab = chatTabs.get(channelId);
    if (!tab || tab.kind !== "channel") return;
    const show = unreadChannelIds.has(channelId) && !isChannelMuted(channelId) && activeTabId !== channelId;
    tab.tabEl.classList.toggle("has-unread", show);
    if (show) tab.tabEl.setAttribute("aria-label", `${tab.channelName} (unread)`);
    else tab.tabEl.removeAttribute("aria-label");
}

/** Applies a channel tab's mode to its element (classes + tooltip). */
function renderTabMode(tab: ChatTab): void {
    const kept = tab.mode === "kept";
    tab.tabEl.classList.toggle("kept", kept);
    tab.tabEl.classList.toggle("preview", tab.mode === "preview");
    tab.tabEl.title = kept
        ? `${tab.channelName} — kept open`
        : `${tab.channelName} — preview: opening another channel replaces this tab. Right-click → Keep Tab Open to keep it.`;
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
    isNsfw?: boolean;
    hasUnread?: boolean;
    /** Custom tree icon (PRD 14.7, text channels only) — mutually
     *  exclusive with `iconUrl`; falls back to the default 💬 icon when
     *  both are null/undefined. */
    iconEmoji?: string | null;
    iconUrl?: string | null;
    children: TreeNode[];
    occupants: { userId: string; nickname: string; isMuted?: boolean; isDeafened?: boolean; isSharingScreen?: boolean }[];
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

function renderCategory(node: TreeNode, siblings: TreeNode[]): HTMLDivElement {
    const category = document.createElement("div");
    category.className = "tree-category";

    // A voice channel that gains a child stays non-joinable (its own
    // occupant/join affordance never applied once it became a parent) —
    // previously silent about this, so this badge makes it explicit
    // instead of the join button just quietly disappearing (PRD 14.6).
    const voiceBadge = node.type === "VOICE"
        ? `<span class="category-voice-badge" title="Voice channels with sub-channels can't be joined directly">Category</span>`
        : "";

    const label = document.createElement("div");
    label.className = "tree-category-label";
    label.innerHTML = `<span class="arrow">▾</span> ${escapeHtml(node.name)}${voiceBadge}`;
    label.addEventListener("click", () => {
        category.classList.toggle("collapsed");
    });
    attachChannelDragHandlers(label, node, siblings);
    attachChannelContextMenu(label, node);
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
// (unreadChannelIds / the server's read cursor are untouched); muting only
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

    const showUnread = unreadChannelIds.has(channelId) && !muted;
    el.classList.toggle("unread", showUnread);
    const dot = el.querySelector(".unread-dot");
    if (showUnread && !dot) {
        const newDot = document.createElement("span");
        newDot.className = "unread-dot";
        el.querySelector(".ch-name")?.after(newDot);
    } else if (!showUnread) {
        dot?.remove();
    }
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
    const countBadge = count > 0 ? `<span class="ch-count">${count}</span>` : "";

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
    // via unreadChannelIds until the tab is opened.
    if (!isVoice) {
        channel.dataset.channelId = node.id;
        if (node.hasUnread && node.id !== activeTabId) unreadChannelIds.add(node.id);
        // A muted channel (PRD 16.4) is faded and never paints unread visuals,
        // though the unread set above keeps tracking it.
        if (isChannelMuted(node.id)) channel.classList.add("muted");
        else if (unreadChannelIds.has(node.id)) channel.classList.add("unread");
    }
    const unreadDot = !isVoice && unreadChannelIds.has(node.id) && !isChannelMuted(node.id)
        ? `<span class="unread-dot"></span>`
        : "";

    channel.innerHTML = `
        ${iconHtml}
        <span class="ch-name">${escapeHtml(node.name)}</span>
        ${unreadDot}
        ${nsfwBadge}
        ${timerBadge}
        ${countBadge}
    `;

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

        document.querySelector(".occupant-ctx-menu")?.remove();

        const menu = document.createElement("div");
        menu.className = "occupant-ctx-menu";
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;

        // Mute is personal (client-side, no permission) and only offered on an
        // openable text channel — never voice channels or category rows (PRD 16.4).
        // Keep Tab Open (PRD 17.5) sits with Mute: both are personal, text-channel-only.
        const isKept = chatTabs.get(node.id)?.mode === "kept";
        const muteItem = canMute
            ? `<button class="channel-ctx-menu-item ctx-keep-btn">🔖 ${isKept ? "Stop Keeping Open" : "Keep Tab Open"}</button>`
              + `<button class="channel-ctx-menu-item ctx-mute-btn">${isChannelMuted(node.id) ? "🔔 Unmute Channel" : "🔕 Mute Channel"}</button><div class="ctx-menu-divider"></div>`
            : "";

        menu.innerHTML = `
            ${muteItem}
            <button class="channel-ctx-menu-item ctx-rename-btn">✏️ Rename</button>
            <button class="channel-ctx-menu-item ctx-move-btn">📁 Move to…</button>
            ${!isVoice ? `<button class="channel-ctx-menu-item ctx-icon-btn">🖼️ Set Icon</button>` : ""}
            ${!isVoice ? `<button class="channel-ctx-menu-item ctx-nsfw-toggle-btn">🔞 ${node.isNsfw ? "Unmark" : "Mark"} as NSFW</button>` : ""}
            <button class="ctx-delete-channel-btn">🗑️ Delete Channel</button>
        `;

        menu.querySelector(".ctx-mute-btn")?.addEventListener("click", () => {
            menu.remove();
            setChannelMuted(node.id, !isChannelMuted(node.id));
        });

        menu.querySelector(".ctx-keep-btn")?.addEventListener("click", () => {
            menu.remove();
            setTabKept(node.id, !isKept);
        });

        menu.querySelector(".ctx-rename-btn")?.addEventListener("click", () => {
            menu.remove();
            showRenameModal(node.id, node.name);
        });

        menu.querySelector(".ctx-move-btn")?.addEventListener("click", () => {
            menu.remove();
            showMoveModal(node.id, node.name);
        });

        menu.querySelector(".ctx-icon-btn")?.addEventListener("click", () => {
            menu.remove();
            showChannelIconModal(node.id);
        });

        menu.querySelector(".ctx-nsfw-toggle-btn")?.addEventListener("click", async () => {
            menu.remove();
            const result = await api.updateChannel(node.id, { isNsfw: !node.isNsfw });
            if (!result.success) {
                log(`Failed to update channel: ${result.error}`, "error");
                if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
            }
        });

        menu.querySelector(".ctx-delete-channel-btn")?.addEventListener("click", () => {
            menu.remove();
            showDeleteModal(node.id, node.name);
        });

        document.body.appendChild(menu);

        const closeCtx = (ev: MouseEvent) => {
            if (!menu.contains(ev.target as Node)) {
                menu.remove();
                document.removeEventListener("click", closeCtx, true);
            }
        };
        setTimeout(() => document.addEventListener("click", closeCtx, true), 0);
    });
}

// Inline SVGs shown next to an occupant's name when they've muted or deafened
// themselves, so it doesn't look like they're simply ignoring everyone else.
const OCC_MUTED_ICON =
    `<svg class="occ-voice-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" title="Muted"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2M19 10v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
const OCC_DEAFENED_ICON =
    `<svg class="occ-voice-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" title="Deafened"><line x1="1" y1="1" x2="23" y2="23"/><path d="M3 18v-6a9 9 0 0 1 15.34-6.36M21 12v2.5"/><path d="M21 16v2a2 2 0 0 1-2 2h-1"/><path d="M3 18v2a2 2 0 0 0 2 2h1v-4H4a1 1 0 0 0-1 1z"/></svg>`;
// Same mic-slash shape as OCC_MUTED_ICON but in the app's accent light-blue —
// shown only to this client when they've locally muted the occupant (PRD
// 4.1/4.2's "Mute Locally"), distinct from the red server-broadcast mute icon
// since only the local viewer sees this one.
const OCC_LOCALLY_MUTED_ICON =
    `<svg class="occ-voice-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" title="Muted for you only"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2M19 10v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;

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
            `${occ.isMuted ? OCC_MUTED_ICON : ""}${occ.isDeafened ? OCC_DEAFENED_ICON : ""}${isLocallyMuted ? OCC_LOCALLY_MUTED_ICON : ""}`;
        const sharingBadge = occ.isSharingScreen ? `<span class="sharing-badge">LIVE</span>` : "";
        el.innerHTML = `<span class="occ-dot"></span>${escapeHtml(occ.nickname)}${voiceStateIcons}${sharingBadge}`;

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

        // Right-click → per-user local volume/mute (everyone) + Kick (admins only)
        el.addEventListener("contextmenu", (e) => {
            const targetId = occ.userId;
            if (targetId === myId) return;
            e.preventDefault();
            e.stopPropagation();

            // Remove any existing context menu
            document.querySelector(".occupant-ctx-menu")?.remove();

            const menu = document.createElement("div");
            menu.className = "occupant-ctx-menu";
            menu.style.left = `${e.clientX}px`;
            menu.style.top = `${e.clientY}px`;

            const currentVolume = api.getLocalUserVolume(targetId);
            const currentMuted = api.getLocalUserMute(targetId);

            menu.innerHTML = `
                <div class="ctx-volume-row">
                    <span class="ctx-volume-label">Volume <span class="ctx-volume-value">${currentVolume}%</span></span>
                    <input type="range" class="ctx-volume-slider" min="0" max="200" step="5" value="${currentVolume}">
                </div>
                <button class="ctx-mute-btn${currentMuted ? " active" : ""}">${currentMuted ? "🔇 Unmute Locally" : "🔊 Mute Locally"}</button>
                ${isAdminUser ? `<button class="ctx-kick-btn">🚫 Kick from Channel</button>` : ""}
            `;

            const volumeSlider = menu.querySelector(".ctx-volume-slider") as HTMLInputElement;
            const volumeValue = menu.querySelector(".ctx-volume-value") as HTMLSpanElement;
            volumeSlider.addEventListener("input", () => {
                const percent = parseInt(volumeSlider.value, 10);
                volumeValue.textContent = `${percent}%`;
                api.setLocalUserVolume(targetId, percent);
                setSavedLocalVolume(targetId, percent);
            });

            const muteBtn = menu.querySelector(".ctx-mute-btn") as HTMLButtonElement;
            muteBtn.addEventListener("click", () => {
                const nowMuted = !muteBtn.classList.contains("active");
                api.setLocalUserMute(targetId, nowMuted);
                setSavedLocalMute(targetId, nowMuted);
                muteBtn.classList.toggle("active", nowMuted);
                muteBtn.textContent = nowMuted ? "🔇 Unmute Locally" : "🔊 Mute Locally";
                if (currentTree.length > 0) renderTree(currentTree);
            });

            const kickBtn = menu.querySelector(".ctx-kick-btn") as HTMLButtonElement | null;
            kickBtn?.addEventListener("click", async () => {
                menu.remove();
                const result = await api.kickUser(targetId, node.id);
                if (result.success) {
                    log(`Kicked ${escapeHtml(occ.nickname)} from channel`, "success");
                } else {
                    log(`Failed to kick: ${result.error}`, "error");
                    if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
                }
            });

            document.body.appendChild(menu);

            // Close on click outside (but not while dragging the slider)
            const closeCtx = (ev: MouseEvent) => {
                if (!menu.contains(ev.target as Node)) {
                    menu.remove();
                    document.removeEventListener("click", closeCtx, true);
                }
            };
            setTimeout(() => document.addEventListener("click", closeCtx, true), 0);
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

// ── Voice Controls ────────────────────────────────────────────────────────

function updateVoiceUI(channelName?: string): void {
    refreshLocalSpeakingHalo();
    if (isInVoice) {
        voicePanel.classList.add("visible");
        if (channelName) {
            voiceChannelName.textContent = `Voice: ${channelName}`;
        }
        // Icon-only buttons (PRD 12.9) — state is conveyed by the `.active`
        // (red) styling plus the tooltip, not by swapping label text.
        btnMute.title = isMuted ? "Unmute" : "Mute";
        btnMute.classList.toggle("active", isMuted);
        btnDeafen.title = isDeafened ? "Undeafen" : "Deafen";
        btnDeafen.classList.toggle("active", isDeafened);
        updateShareScreenButton();
    } else {
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
    updateWindowTitle();
    if (api.platform === "darwin") {
        btnShareScreen.title = "Screen sharing isn't available on macOS yet";
        btnShareScreen.disabled = true;
        return;
    }
    btnShareScreen.title = isSharingScreen
        ? "Stop Sharing"
        : serverScreenShareEnabled
          ? "Share Screen"
          : "Screen sharing is disabled on this server";
    btnShareScreen.disabled = !serverScreenShareEnabled;
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
    if (api.isLinuxWayland) {
        await startScreenShareViaSystemPicker();
        return;
    }
    await openScreenShareModal();
});

btnStopShareAlert.addEventListener("click", stopSharingScreen);

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
 * lets the user set their own display name instead, purely a local/UI
 * concern (never sent to the OS picker or portal) — a new modal because
 * there's no existing in-app step on this path to attach a field to,
 * unlike the Selection Modal's own name input on other platforms.
 */
async function startScreenShareViaSystemPicker(): Promise<void> {
    const videoRes = await api.startScreenShareViaSystemPicker();
    if (!videoRes.success) {
        log(`Failed to start screen share: ${videoRes.error}`, "error");
        return;
    }

    isSharingScreen = true;
    updateShareScreenButton();

    const customName = await promptForStreamName();
    const resolvedName = customName || videoRes.label || "your screen";
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

/**
 * Shows `#stream-name-modal` and resolves with the trimmed name the user
 * entered, or `""` if they clicked Skip / clicked outside the modal —
 * callers treat an empty string as "use the default name" (see call site).
 */
function promptForStreamName(): Promise<string> {
    return new Promise((resolve) => {
        streamNameInput.value = "";
        streamNameModal.classList.add("visible");
        streamNameInput.focus();

        const cleanup = (): void => {
            streamNameModal.classList.remove("visible");
            btnStreamNameConfirm.removeEventListener("click", onConfirm);
            btnStreamNameSkip.removeEventListener("click", onSkip);
            streamNameModal.removeEventListener("click", onBackdropClick);
        };
        const onConfirm = (): void => {
            const value = streamNameInput.value.trim();
            cleanup();
            resolve(value);
        };
        const onSkip = (): void => {
            cleanup();
            resolve("");
        };
        const onBackdropClick = (e: MouseEvent): void => {
            if (e.target === streamNameModal) onSkip();
        };

        btnStreamNameConfirm.addEventListener("click", onConfirm);
        btnStreamNameSkip.addEventListener("click", onSkip);
        streamNameModal.addEventListener("click", onBackdropClick);
    });
}

btnLeaveVoice.addEventListener("click", leaveVoiceAndNotify);

// ── Create Channel Modal ──────────────────────────────────────────────────

btnCreateChannel.addEventListener("click", () => {
    if (!isConnected) return;
    newChannelName.value = "";
    newChannelNsfw.checked = false;
    newChannelNsfwRow.style.display = newChannelType.value === "TEXT" ? "flex" : "none";
    createChannelModal.classList.add("visible");
    newChannelName.focus();
});

newChannelType.addEventListener("change", () => {
    newChannelNsfwRow.style.display = newChannelType.value === "TEXT" ? "flex" : "none";
    if (newChannelType.value !== "TEXT") newChannelNsfw.checked = false;
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

// ── Rename Channel Modal (PRD 4.5) ──────────────────────────────────────────

function showRenameModal(channelId: string, currentName: string): void {
    pendingRenameChannelId = channelId;
    renameChannelInput.value = currentName;
    renameChannelModal.classList.add("visible");
    renameChannelInput.focus();
    renameChannelInput.select();
}

btnRenameCancel.addEventListener("click", () => {
    renameChannelModal.classList.remove("visible");
    pendingRenameChannelId = null;
});

renameChannelModal.addEventListener("click", (e) => {
    if (e.target === renameChannelModal) {
        renameChannelModal.classList.remove("visible");
        pendingRenameChannelId = null;
    }
});

btnRenameConfirm.addEventListener("click", async () => {
    if (!pendingRenameChannelId) return;
    const name = renameChannelInput.value.trim();
    if (!name) {
        renameChannelInput.focus();
        return;
    }
    const channelId = pendingRenameChannelId;
    renameChannelModal.classList.remove("visible");
    pendingRenameChannelId = null;

    const result = await api.updateChannel(channelId, { name });
    if (result.success) {
        log(`Channel renamed to "${name}"`, "success");
    } else {
        log(`Failed to rename channel: ${result.error}`, "error");
        if (result.error && /permission|denied/i.test(result.error)) SoundAlert.play("insufficient_perms.mp3");
    }
});

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
    if (lastDisconnectAt !== null) {
        const secs = ((Date.now() - lastDisconnectAt) / 1000).toFixed(1);
        log(`Connected to server (reconnected after ${secs}s)`, "success");
        lastDisconnectAt = null;
    } else {
        log("Connected to server", "success");
    }
    SoundAlert.play("connected.mp3");

    // Always show the online users button when connected
    btnOnlineUsers.style.display = "";
    updateOnlineDot();

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
    });

    // Auto-open DM tabs for partners with unread messages
    api.getUnreadDmPartners().then((res) => {
        if (res.success && res.partners && res.partners.length > 0) {
            for (const p of res.partners) {
                openDmTab(p.partnerId, p.partnerNickname, p.unreadCount);
            }
        }
    });

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
    updateWindowTitle();
    activeSpeakers.clear();
    for (const timer of speakerHoldTimers.values()) clearTimeout(timer);
    speakerHoldTimers.clear();
    sessionTimers.clear();
    const panelTimer = document.getElementById("voice-session-timer");
    if (panelTimer) panelTimer.textContent = "";
    btnConnect.disabled = false;
    btnDisconnect.disabled = true;
    serverUrlInput.disabled = false;
    nicknameInput.disabled = false;
    serverPasswordInput.disabled = false;
    statusDot.classList.remove("connected");
    statusText.textContent = "Disconnected";
    statusText.classList.remove("connected");
    statusLatency.textContent = "";
    statusLatency.className = "status-latency";
    btnOnlineUsers.style.display = "none";
    onlineDot.classList.remove("active");
    updateVoiceUI();
    channelTree.innerHTML = `
        <div style="padding: 20px 12px; color: var(--text-muted); font-size: 12px; text-align: center;">
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
        voiceChannelName.textContent += " (reconnecting…)";
    }
});

api.on("voice-reconnected", (data: { channelId: string }) => {
    voicePanel.classList.remove("reconnecting");
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

api.on("channel-tree", (data: { serverId: string; tree: TreeNode[] }) => {
    ensureMutedChannelsLoaded(data.serverId);
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
    updateOnlineDot();
    if (data.userId === profileUserId && profileIsOnline !== null) setProfilePresence(true); // PRD 17.3
});

api.on("user-left", (data: { userId: string }) => {
    log(`A user left the server`, "info");
    updateOnlineDot();
    if (data.userId === profileUserId && profileIsOnline !== null) setProfilePresence(false); // PRD 17.3
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
                    const els = document.querySelectorAll(`.tree-occupant[data-user-id="${userId}"]`);
                    els.forEach((el) => el.classList.remove("speaking"));
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
        const els = document.querySelectorAll(`.tree-occupant[data-user-id="${userId}"]`);
        els.forEach((el) => el.classList.add("speaking"));
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
    // Update the voice panel timer
    if (currentChannelId && sessionTimers.has(currentChannelId)) {
        const panelTimer = document.getElementById("voice-session-timer");
        if (panelTimer) {
            panelTimer.textContent = formatDuration(
                now - new Date(sessionTimers.get(currentChannelId)!).getTime(),
            );
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
        return;
    }
    statusLatency.textContent = `${ms}ms`;
    statusLatency.className = "status-latency " + (ms <= 80 ? "good" : ms <= 150 ? "warn" : "bad");
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

/**
 * `onLoaded` lets the caller decide whether a preview card finishing async
 * load should stick the view to the bottom (PRD 14.1/14.2) — appending a
 * new message the user was already at the bottom for, vs. revealing a
 * historical message above the fold while prepending older pages, need
 * opposite answers, so this can no longer hardcode "always scroll down."
 */
function injectLinkPreview(messageEl: HTMLElement, url: string, onLoaded?: () => void): void {
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
        linkPreviewCache.set(url, data);
        if (!data) return;
        // Guard: ensure the message is still in the DOM (tab may have been closed)
        if (!messageEl.isConnected) return;
        messageEl.appendChild(createPreviewCard(data));
        onLoaded?.();
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

    const myId = api.getInstanceId();

    for (const user of users) {
        const row = document.createElement("div");
        row.className = "admin-user-row";

        const userRoleIds = new Set((user.roles ?? []).map((r: any) => r.id));

        // User info
        const infoEl = document.createElement("div");
        infoEl.className = "admin-user-info";
        const bannedBadge = user.isBanned ? ' <span class="user-banned-badge">BANNED</span>' : "";
        infoEl.innerHTML = `
            <div class="admin-user-nickname">${escapeHtml(user.nickname)}${bannedBadge}</div>
            <div class="admin-user-id">${escapeHtml(user.id)}</div>
        `;
        row.appendChild(infoEl);

        // Role toggles — only for those who can actually manage roles; a
        // BAN_USER-only holder would just get PERMISSION_DENIED on click
        // (PRD 13.17), so don't show them as if they were usable.
        if (isAdminUser) {
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
        }

        // Ban / Unban — only for those who hold BAN_USER (PRD 13.17). Works
        // for offline users too, unlike the old Online Users modal button
        // this replaces — GET_ALL_USERS lists every user with a role on
        // this server regardless of online status. Your own row shows a
        // disabled Ban button instead of hiding it (PRD 15.4) so the rows
        // stay consistent; the server independently rejects self-ban.
        if (canBanUsers && user.id === myId) {
            const selfBanBtn = document.createElement("button");
            selfBanBtn.className = "btn-ban";
            selfBanBtn.disabled = true;
            selfBanBtn.setAttribute("aria-disabled", "true");
            selfBanBtn.title = "You can't ban yourself";
            selfBanBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="7" cy="7" r="4"/><circle cx="18" cy="17" r="5"/><line x1="14.5" y1="20.5" x2="21.5" y2="13.5"/></svg> Ban';
            row.appendChild(selfBanBtn);
        } else if (canBanUsers) {
            const banBtn = document.createElement("button");
            banBtn.className = user.isBanned ? "btn-unban" : "btn-ban";
            // "Ban" gets a user-with-a-no-entry-circle icon so the
            // destructive action reads at a glance; "Unban" stays
            // text-only, matching the plain role-badge pills beside it.
            banBtn.innerHTML = user.isBanned
                ? "Unban"
                : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="7" cy="7" r="4"/><circle cx="18" cy="17" r="5"/><line x1="14.5" y1="20.5" x2="21.5" y2="13.5"/></svg> Ban';
            banBtn.addEventListener("click", async () => {
                const res = user.isBanned
                    ? await api.unbanUser(user.id)
                    : await api.banUser(user.id);
                if (res.success) {
                    log(`${user.isBanned ? "Unbanned" : "Banned"} ${escapeHtml(user.nickname)}`, "success");
                    SoundAlert.play(user.isBanned ? "user_unbanned_from_server.mp3" : "user_banned_from_server.mp3");
                    openSettingsPanel(); // refresh to reflect the new banned state
                } else {
                    log(`Failed to ${user.isBanned ? "unban" : "ban"}: ${res.error}`, "error");
                    if (res.error && /permission|denied/i.test(res.error)) SoundAlert.play("insufficient_perms.mp3");
                }
            });
            row.appendChild(banBtn);
        }

        adminUserList.appendChild(row);
    }
}

// ── Tab Management ────────────────────────────────────────────────────────

function switchTab(tabId: string): void {
    activeTabId = tabId;
    markChannelRead(tabId);

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

    // Show/hide the composer (attachment tray + input bar)
    if (tabId === "server-log") {
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
        tab.messagesEl.scrollTop = tab.messagesEl.scrollHeight;
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
function openChatTab(
    channelId: string,
    channelName: string,
    opts: { mode?: "preview" | "kept"; focus?: boolean; deferLoad?: boolean } = {},
): void {
    const focus = opts.focus !== false;

    // Already open: focus it; "Keep Tab Open" on a preview tab keeps it in place.
    const existing = chatTabs.get(channelId);
    if (existing) {
        if (opts.mode === "kept" && existing.mode !== "kept") setTabKept(channelId, true);
        if (focus) switchTab(channelId);
        return;
    }

    const mode = opts.mode ?? "preview";
    // The preview tab this one replaces, if any (only a new PREVIEW replaces).
    const replaced = mode === "preview" && previewTabId ? chatTabs.get(previewTabId) ?? null : null;

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
    tabEl.addEventListener("contextmenu", (e) => showChannelTabContextMenu(e, channelId));

    // A replacement takes the replaced tab's slot in the bar.
    if (replaced) tabBar.insertBefore(tabEl, replaced.tabEl);
    else tabBar.appendChild(tabEl);

    // Create tab content
    const contentEl = document.createElement("div");
    contentEl.className = "tab-content";
    contentEl.dataset.tabId = channelId;

    // Pinned-message bar (PRD 11.5) — prepended above the message list, one
    // per channel tab, hidden until a pin actually exists.
    const pinBarEl = document.createElement("div");
    pinBarEl.className = "pinned-bar";
    pinBarEl.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg>
        <span class="pinned-bar-text"></span>
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
        kind: "channel",
        mode,
    };
    chatTabs.set(channelId, chatTab);
    setupInfiniteScroll(chatTab);
    renderTabMode(chatTab);
    refreshTabUnread(channelId); // e.g. a kept tab restored for a channel with unread messages

    // Dispose of the replaced preview AFTER the new tab exists, without the
    // usual fall-back to the Server Log in between (no flicker).
    if (replaced) closeTab(replaced.channelId, { reason: "replaced" });
    if (mode === "preview") previewTabId = channelId;
    else persistKeptTabs();

    if (focus) switchTab(channelId);

    // Fetch message history (a deferred tab loads on first activation).
    if (!opts.deferLoad) loadChatHistory(chatTab);
}

// ── DM Tab Management ─────────────────────────────────────────────────────

function openDmTab(userId: string, nickname: string, unreadCountHint?: number): void {
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
    fillTabElement(tabEl, "✉️", nickname);

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
        kind: "dm",
    };
    chatTabs.set(tabKey, chatTab);
    setupInfiniteScroll(chatTab);

    // Switch to the new tab
    switchTab(tabKey);

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
    opts: { reason?: "user" | "replaced" | "disconnect" | "deleted" } = {},
): void {
    const reason = opts.reason ?? "user";
    const tab = chatTabs.get(channelId);
    if (!tab) return;

    tab.scrollObserver?.disconnect();
    tab.tabEl.remove();
    tab.contentEl.remove();
    chatTabs.delete(channelId);
    replyTargets.delete(channelId); // a draft reply dies with its conversation's tab (PRD 16.11)

    if (previewTabId === channelId) previewTabId = null;
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
function setTabKept(channelId: string, kept: boolean): void {
    const tab = chatTabs.get(channelId);
    if (kept) {
        if (!tab) {
            const node = findChannelNodeById(currentTree, channelId);
            if (node) openChatTab(node.id, node.name, { mode: "kept" });
            return;
        }
        if (tab.kind !== "channel" || tab.mode === "kept") return;
        tab.mode = "kept";
        if (previewTabId === channelId) previewTabId = null;
        renderTabMode(tab);
        persistKeptTabs();
        return;
    }

    if (!tab || tab.kind !== "channel" || tab.mode !== "kept") return;
    const otherPreview = previewTabId && previewTabId !== channelId ? chatTabs.get(previewTabId) : undefined;
    tab.mode = "preview";
    renderTabMode(tab);
    if (otherPreview && activeTabId === otherPreview.channelId) {
        // The user is looking at the other preview: this one gives way.
        closeTab(channelId, { reason: "user" });
    } else {
        if (otherPreview) closeTab(otherPreview.channelId, { reason: "user" });
        previewTabId = channelId;
    }
    persistKeptTabs();
}

/** Right-click on a channel tab (PRD 17.5): Keep Tab Open / Stop Keeping Open, Close Tab. */
function showChannelTabContextMenu(e: MouseEvent, channelId: string): void {
    e.preventDefault();
    e.stopPropagation();
    const tab = chatTabs.get(channelId);
    if (!tab) return;

    document.querySelector(".occupant-ctx-menu")?.remove();
    const menu = document.createElement("div");
    menu.className = "occupant-ctx-menu";
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    const kept = tab.mode === "kept";
    menu.innerHTML = `
        <button class="channel-ctx-menu-item ctx-keep-btn">🔖 ${kept ? "Stop Keeping Open" : "Keep Tab Open"}</button>
        <div class="ctx-menu-divider"></div>
        <button class="channel-ctx-menu-item ctx-close-tab-btn">✕ Close Tab</button>
    `;
    menu.querySelector(".ctx-keep-btn")?.addEventListener("click", () => {
        menu.remove();
        setTabKept(channelId, !kept);
    });
    menu.querySelector(".ctx-close-tab-btn")?.addEventListener("click", () => {
        menu.remove();
        closeTab(channelId);
    });
    document.body.appendChild(menu);

    const closeCtx = (ev: MouseEvent) => {
        if (!menu.contains(ev.target as Node)) {
            menu.remove();
            document.removeEventListener("click", closeCtx, true);
        }
    };
    setTimeout(() => document.addEventListener("click", closeCtx, true), 0);
}

/**
 * Re-opens the current server's kept tabs (PRD 17.5) once per connection,
 * after the first channel tree: in their saved order, unfocused, with history
 * deferred until each is first opened. Channels that no longer exist (or are
 * no longer text channels) are dropped from the store.
 */
function restoreKeptTabs(tree: TreeNode[], serverId: string): void {
    keptTabsServerId = serverId;
    if (keptTabsRestored || tree.length === 0) return;
    keptTabsRestored = true;
    const saved = readKeptTabsStore()[serverId] ?? [];
    for (const id of saved) {
        const node = findChannelNodeById(tree, id);
        if (node && node.type === "TEXT") openChatTab(node.id, node.name, { mode: "kept", focus: false, deferLoad: true });
    }
    persistKeptTabs(); // drops ids that weren't restored
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

            // Mark messages as read now that the tab is open
            if (firstUnreadIndex !== -1) {
                api.markDmsRead(partnerId);
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
    tab.messagesEl.scrollTo({ top: tab.messagesEl.scrollHeight, behavior: "smooth" });
    // Landing at the bottom clears unread state, same as a natural
    // scroll-to-bottom or tab switch already does.
    markChannelRead(tab.channelId);
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

    if (anchorBody?.isConnected) {
        tab.messagesEl.scrollTop += anchorBody.getBoundingClientRect().top - anchorTopBefore;
    } else {
        tab.messagesEl.scrollTop = oldScrollTop + (tab.messagesEl.scrollHeight - oldScrollHeight);
    }
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
        tab.messagesEl.scrollTop = tab.messagesEl.scrollHeight;
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
function holdJumpTarget(tab: ChatTab, el: HTMLElement, ms = 1500): void {
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

function stickToBottom(tab: ChatTab): void {
    tab.messagesEl.scrollTop = tab.messagesEl.scrollHeight;
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

const REPLY_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>`;
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

    // A reply always opens its own group with its header showing, under the
    // snippet (PRD 16.6 rule 5 / 16.11) — applyGrouping() reads this flag.
    if (opts.replyTo) {
        el.dataset.isReply = "1";
        el.prepend(buildReplySnippet(opts.replyTo, opts.tabId));
    }
    return el;
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
function stickOnImageLoad(el: HTMLElement, tab: ChatTab, wasNearBottom: boolean): void {
    el.querySelectorAll<HTMLImageElement>(".msg-image").forEach((img) => {
        img.addEventListener("load", () => {
            if (wasNearBottom) stickToBottom(tab);
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
    stickOnImageLoad(el, tab, wasNearBottom);

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
                if (wasNearBottom) stickToBottom(tab);
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

        if (!isDm && msg.content) {
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
    chatInput.setAttribute("aria-activedescendant", `emoji-ac-item-${emojiAcActive}`);
}

function setEmojiAutocompleteActive(index: number, scroll: boolean): void {
    if (index === emojiAcActive) return;
    emojiAcActive = index;
    emojiAcList.querySelectorAll(".emoji-ac-item").forEach((el, i) => {
        el.classList.toggle("active", i === index);
        el.setAttribute("aria-selected", String(i === index));
    });
    chatInput.setAttribute("aria-activedescendant", `emoji-ac-item-${index}`);
    if (scroll) emojiAcList.children[index]?.scrollIntoView({ block: "nearest" });
}

/** Opens the card above the colon, kept fully inside the window. */
function positionEmojiAutocomplete(): void {
    const colon = getTextareaCharCoords(chatInput, emojiAcColonIndex);
    const margin = 8;

    // It opens upward (the input sits at the bottom of the window); in a tiny
    // window shrink the card rather than push it off the top.
    const roomAbove = colon.top - 6 - margin;
    emojiAutocompleteEl.style.maxHeight = `${Math.max(120, Math.min(320, roomAbove))}px`;

    const width = emojiAutocompleteEl.offsetWidth;
    const height = emojiAutocompleteEl.offsetHeight;
    const left = Math.max(margin, Math.min(colon.left, window.innerWidth - width - margin));
    const top = Math.max(margin, colon.top - 6 - height);
    emojiAutocompleteEl.style.left = `${left}px`;
    emojiAutocompleteEl.style.top = `${top}px`;
}

function closeEmojiAutocomplete(): void {
    if (!emojiAcOpen) return;
    emojiAcOpen = false;
    emojiAcItems = [];
    emojiAutocompleteEl.classList.remove("visible");
    chatInput.setAttribute("aria-expanded", "false");
    chatInput.removeAttribute("aria-activedescendant");
}

/** Re-evaluates the text before the caret: open, refresh or close the card. */
function updateEmojiAutocomplete(): void {
    if (chatInput.selectionStart !== chatInput.selectionEnd) {
        closeEmojiAutocomplete();
        return;
    }
    const caret = chatInput.selectionStart ?? chatInput.value.length;
    const match = EMOJI_AC_OPEN_RE.exec(chatInput.value.slice(0, caret));
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
        chatInput.setAttribute("aria-expanded", "true");
        chatInput.setAttribute("aria-controls", "emoji-autocomplete");
    }
    renderEmojiAutocomplete();
    emojiAutocompleteEl.classList.add("visible");
    positionEmojiAutocomplete();
}

/** Replaces the typed ":query" with the chosen emoji (plus a trailing space). */
function selectEmojiAutocompleteItem(index: number): void {
    const item = emojiAcItems[index];
    if (!item) return;
    const caret = chatInput.selectionStart ?? chatInput.value.length;
    const nextChar = chatInput.value.charAt(caret);
    const suffix = nextChar === "" || !/\s/.test(nextChar) ? " " : "";
    chatInput.setRangeText(item.insert + suffix, emojiAcColonIndex, caret, "end");
    closeEmojiAutocomplete();
    autosizeChatInput();
    chatInput.focus();
}

/**
 * Typing the closing ":" of a complete Unicode name (":red_heart:") swaps it
 * for the emoji character in place. Custom names are left as typed — they
 * already render from `:name:` text. Returns true when it converted.
 */
function convertClosedEmojiShortcode(): boolean {
    const caret = chatInput.selectionStart ?? chatInput.value.length;
    const match = EMOJI_AC_CLOSED_RE.exec(chatInput.value.slice(0, caret));
    if (!match) return false;
    getUnicodeEmojiIndex();
    // Group 1 is ":name:" (both colons), group 2 is just "name".
    const emoji = unicodeEmojiBySnake?.get(match[2].toLowerCase());
    if (!emoji) return false;
    chatInput.setRangeText(emoji, caret - match[1].length, caret, "end");
    autosizeChatInput();
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

chatInput.setAttribute("aria-autocomplete", "list");
chatInput.setAttribute("aria-expanded", "false");
// Grabbing the card's scrollbar (or its header) must not blur the textarea,
// which would close the card mid-interaction.
emojiAutocompleteEl.addEventListener("mousedown", (e) => e.preventDefault());

chatInput.addEventListener("input", (e) => {
    if ((e as InputEvent).isComposing) return; // wait for the IME to commit
    if ((e as InputEvent).data === ":" && convertClosedEmojiShortcode()) {
        closeEmojiAutocomplete();
        return;
    }
    updateEmojiAutocomplete();
});
// Caret moves that don't fire "input": clicking, Home/End, and Left/Right
// (Up/Down/Enter/Tab/Escape are consumed by the card itself while it's open).
chatInput.addEventListener("click", updateEmojiAutocomplete);
chatInput.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
        updateEmojiAutocomplete();
    }
});
chatInput.addEventListener("blur", closeEmojiAutocomplete);
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
                tab.messagesEl.scrollTop = tab.messagesEl.scrollHeight;
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
    if (msg.channelId !== activeTabId) {
        markChannelUnread(msg.channelId);
    }
});

/** Flags a channel-tree row as unread without a full tree re-render (which would lose collapsed-category state). */
function markChannelUnread(channelId: string): void {
    if (unreadChannelIds.has(channelId)) return;
    unreadChannelIds.add(channelId);
    refreshTabUnread(channelId); // an open, unfocused tab shows it too (PRD 17.6)
    if (isChannelMuted(channelId)) return; // still tracked, just not painted (PRD 16.4)

    const el = channelTree.querySelector(`.tree-channel[data-channel-id="${CSS.escape(channelId)}"]`);
    if (!el || el.classList.contains("unread")) return;
    el.classList.add("unread");
    if (!el.querySelector(".unread-dot")) {
        const dot = document.createElement("span");
        dot.className = "unread-dot";
        el.querySelector(".ch-name")?.after(dot);
    }
}

function findTreeNode(nodes: TreeNode[], channelId: string): TreeNode | null {
    for (const n of nodes) {
        if (n.id === channelId) return n;
        const found = findTreeNode(n.children, channelId);
        if (found) return found;
    }
    return null;
}

/** Clears a channel's unread state locally and persists the read cursor server-side. */
function markChannelRead(channelId: string): void {
    // Clear the cached tree node's join-time hasUnread flag too — otherwise a
    // later renderTree(currentTree) call (e.g. re-rendering on voice channel
    // join/leave) re-seeds unreadChannelIds from that stale flag (see line
    // ~1283) and the notification erroneously reappears after being read.
    const node = findTreeNode(currentTree, channelId);
    if (node) node.hasUnread = false;

    if (!unreadChannelIds.has(channelId)) return;
    unreadChannelIds.delete(channelId);
    refreshTabUnread(channelId); // PRD 17.6

    const el = channelTree.querySelector(`.tree-channel[data-channel-id="${CSS.escape(channelId)}"]`);
    el?.classList.remove("unread");
    el?.querySelector(".unread-dot")?.remove();

    api.markChannelRead(channelId);
}

// ── DM Event Listener ─────────────────────────────────────────────────────

/** Builds a DM's DOM element without appending it or touching scroll state —
 *  shared by the forward-append path (`renderDmMessage`) and the
 *  backward-prepend path (`prependOlderMessages`, PRD 14.2). Note: DMs have
 *  never had long-message truncation (unlike channel messages) — preserved
 *  as-is here, not a gap introduced by this refactor. */
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

    stickOnImageLoad(el, tab, wasNearBottom);

    // Async link preview injection
    if (msg.content) {
        const url = extractFirstUrl(msg.content);
        if (url) {
            injectLinkPreview(el, url, () => {
                if (wasNearBottom) stickToBottom(tab);
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
                tab.messagesEl.scrollTop = tab.messagesEl.scrollHeight;
            });
        }
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

    // DM notification sound: play when message is from someone else AND
    // the DM tab was not already active OR the window is not focused
    if (msg.senderId !== myId) {
        const isFocused = await api.isWindowFocused();
        if (!wasTabActive || !isFocused) {
            SoundAlert.play("hey_wake_up.mp3");
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

function renderOnlineUsers(users: { userId: string; nickname: string; isOnline: boolean }[]): void {
    onlineUserList.innerHTML = "";

    if (users.length === 0) {
        onlineUserList.innerHTML = '<div class="admin-empty">No users available.</div>';
        return;
    }

    // Sort: online first, then offline; alphabetical within each group
    const sorted = [...users].sort((a, b) => {
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        return a.nickname.localeCompare(b.nickname);
    });

    const onlineUsers = sorted.filter((u) => u.isOnline);
    const offlineUsers = sorted.filter((u) => !u.isOnline);

    // Render online users
    for (const user of onlineUsers) {
        onlineUserList.appendChild(createUserRow(user));
    }

    // Render offline separator + offline users
    if (offlineUsers.length > 0) {
        if (onlineUsers.length > 0) {
            const separator = document.createElement("div");
            separator.className = "online-users-separator";
            separator.textContent = "Offline";
            onlineUserList.appendChild(separator);
        }
        for (const user of offlineUsers) {
            onlineUserList.appendChild(createUserRow(user));
        }
    }
}

function createUserRow(user: { userId: string; nickname: string; isOnline: boolean }): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "online-user-row";

    const info = document.createElement("div");
    info.className = "online-user-info";
    const dotClass = user.isOnline ? "online-user-dot" : "online-user-dot offline";
    const nickClass = user.isOnline ? "online-user-nick" : "online-user-nick offline";
    info.innerHTML = `<span class="${dotClass}"></span><span class="${nickClass}">${escapeHtml(user.nickname)}</span>`;
    row.appendChild(info);

    const btnGroup = document.createElement("div");
    btnGroup.className = "online-user-btns";

    const dmBtn = document.createElement("button");
    dmBtn.className = "btn-dm";
    dmBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> DM';
    dmBtn.addEventListener("click", () => {
        onlineUsersModal.classList.remove("visible");
        openDmTab(user.userId, user.nickname);
    });
    btnGroup.appendChild(dmBtn);

    // Nudge — online users only, never yourself, only when the server allows it
    if (canNudge(user.userId, user.isOnline)) {
        btnGroup.appendChild(buildNudgeButton(user.userId, user.nickname));
    }

    // Ban moved to the User Management settings tab (PRD 13.17) — it
    // now also works for offline users, which this modal never could.

    row.appendChild(btnGroup);
    return row;
}

/** The Nudge rules shared by the Online Users modal and the profile card (PRD 17.3). */
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
            openSettingsPanel();
            (document.querySelector('.settings-tab-btn[data-settings-tab="app"]') as HTMLButtonElement | null)?.click();
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

/** Checks online user count and toggles the green dot on the Online Users button. */
async function updateOnlineDot(): Promise<void> {
    if (!isConnected) {
        onlineDot.classList.remove("active");
        return;
    }
    const result = await api.getOnlineUsers();
    if (result.success && result.users && result.users.some((u) => u.isOnline)) {
        onlineDot.classList.add("active");
    } else {
        onlineDot.classList.remove("active");
    }
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

    const activeTabBtn = document.querySelector(".settings-tab-btn.active") as HTMLButtonElement | null;
    if (activeTabBtn && activeTabBtn.style.display === "none") {
        settingsTabBtns.forEach((b) => b.classList.remove("active"));
        settingsPanels.forEach((p) => p.classList.remove("active"));
        const voiceBtn = document.querySelector('.settings-tab-btn[data-settings-tab="voice"]');
        const voicePanel = document.querySelector('.settings-panel[data-settings-panel="voice"]');
        voiceBtn?.classList.add("active");
        voicePanel?.classList.add("active");
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
    syncProfileSection(); // discard an unsaved avatar draft from a previous visit (PRD 17.1)
    adminModal.classList.add("visible");

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
        const [usersRes, rolesRes, bannedRes, pendingEmojisRes] = await Promise.all([
            api.getAllUsers(currentServerId),
            api.getRoles(currentServerId),
            api.getBannedUsers(),
            api.getPendingEmojis(),
        ]);

        isAdminUser = rolesRes.success;
        canBanUsers = bannedRes.success;
        canManageEmojis = pendingEmojisRes.success;
        applySettingsTabVisibility();

        if (usersRes.success) {
            allServerRoles = rolesRes.roles ?? [];
            renderAdminUsers(usersRes.users ?? []);
        } else {
            adminUserList.innerHTML = '<div class="admin-empty">You don\'t have permission to manage users.</div>';
        }

        if (canManageEmojis) {
            renderPendingEmojis(pendingEmojisRes.emojis ?? []);
        }

        // Server tab — UPDATE_SERVER_SETTINGS requires literal ADMIN, so
        // isAdminUser is the correct (not just approximate) gate here.
        if (isAdminUser) {
            const settingsRes = await api.getServerSettings();
            if (settingsRes.success) {
                chkNudgeEnabled.checked = settingsRes.nudgeEnabled ?? true;
                chkScreenShareEnabled.checked = settingsRes.screenShareEnabled ?? true;
                inputMaxMessageLength.value = String(settingsRes.maxMessageLength ?? serverMaxMessageLength);
            }
        }
    } else {
        adminUserList.innerHTML = '<div class="admin-empty">Connect to a server to manage roles.</div>';
    }
}

function renderPendingEmojis(emojis: CustomEmoji[]): void {
    emojiPendingList.innerHTML = "";

    if (emojis.length === 0) {
        emojiPendingList.innerHTML = '<div class="admin-empty">No emojis pending review.</div>';
        return;
    }

    for (const emoji of emojis) {
        const row = document.createElement("div");
        row.className = "admin-user-row";
        row.innerHTML = `
            <img class="emoji-pending-thumb" src="${escapeHtml(emoji.imageUrl)}" alt="${escapeHtml(emoji.name)}">
            <div class="admin-user-info">
                <div class="admin-user-nickname">:${escapeHtml(emoji.name)}:</div>
                <div class="admin-user-id">by ${escapeHtml(emoji.uploadedByNickname ?? "Unknown")}</div>
            </div>
            <div class="emoji-pending-actions">
                <button class="btn-emoji-approve">✓ Approve</button>
                <button class="btn-emoji-reject">✕ Reject</button>
            </div>
        `;

        row.querySelector(".btn-emoji-approve")?.addEventListener("click", async () => {
            const result = await api.reviewCustomEmoji(emoji.id, "APPROVED");
            if (result.success) {
                log(`Approved emoji ":${emoji.name}:"`, "success");
                row.remove();
                if (emojiPendingList.children.length === 0) {
                    emojiPendingList.innerHTML = '<div class="admin-empty">No emojis pending review.</div>';
                }
            } else {
                log(`Failed to approve emoji: ${result.error}`, "error");
            }
        });

        row.querySelector(".btn-emoji-reject")?.addEventListener("click", async () => {
            const result = await api.reviewCustomEmoji(emoji.id, "REJECTED");
            if (result.success) {
                log(`Rejected emoji ":${emoji.name}:"`, "success");
                row.remove();
                if (emojiPendingList.children.length === 0) {
                    emojiPendingList.innerHTML = '<div class="admin-empty">No emojis pending review.</div>';
                }
            } else {
                log(`Failed to reject emoji: ${result.error}`, "error");
            }
        });

        emojiPendingList.appendChild(row);
    }
}

btnServerSettings.addEventListener("click", () => {
    openSettingsPanel();
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

const REACT_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`;

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
        btnDelete.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
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
    btnEdit.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
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

const PIN_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg>`;

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
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        highlightMessage(el);
        return;
    }

    // Not loaded: fetch a window around it and land on it (PRD 17.8). While
    // this runs, neither sentinel may load pages — a prepend's scroll
    // correction would cancel the landing (the bug's H1 path).
    tab.jumpInProgress = true;
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
        el.scrollIntoView({ behavior: "instant", block: "center" });
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

    const res = await api.openScreenShareViewer(target.userId, target.nickname, target.channelId);
    if (!res.success) {
        log(`Failed to open viewer: ${res.error}`, "error");
    }
});

// ── Screen Share Selection Modal (PRD 12.10) ────────────────────────────────

function renderSourceShareGroup(title: string, sources: DesktopSource[]): HTMLElement {
    const wrapper = document.createElement("div");

    const heading = document.createElement("div");
    heading.className = "source-share-group-title";
    heading.textContent = title;
    wrapper.appendChild(heading);

    const grid = document.createElement("div");
    grid.className = "source-share-grid";
    for (const source of sources) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "source-share-card";

        const thumb = document.createElement("img");
        thumb.className = "source-share-card-thumb";
        thumb.src = source.thumbnail;
        thumb.alt = "";
        card.appendChild(thumb);

        const nameRow = document.createElement("div");
        nameRow.className = "source-share-card-name";
        if (source.appIcon) {
            const icon = document.createElement("img");
            icon.className = "source-share-card-icon";
            icon.src = source.appIcon;
            icon.alt = "";
            nameRow.appendChild(icon);
        }
        const nameSpan = document.createElement("span");
        nameSpan.textContent = source.name;
        nameRow.appendChild(nameSpan);
        card.appendChild(nameRow);

        card.addEventListener("click", () => selectShareSource(source, card));
        grid.appendChild(card);
    }
    wrapper.appendChild(grid);
    return wrapper;
}

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
        desc = "Audio sharing is only available for individual application windows.";
    } else if (!audioCaptureSupported) {
        enabled = false;
        desc = "Audio capture isn't available for this window on your system.";
    } else {
        enabled = true;
        desc = "Share this window's audio too";
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
}

async function openScreenShareModal(): Promise<void> {
    selectedShareSource = null;
    btnScreenShareStart.disabled = true;
    sourceShareAudioCheckbox.disabled = true;
    sourceShareAudioCheckbox.checked = false;
    sourceShareAudioDesc.textContent = "Select a source first";
    sourceShareNameInput.value = "";

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

    const sources = sourcesRes.sources;
    const screens = sources.filter((s) => s.sourceType === "screen");
    const windows = sources.filter((s) => s.sourceType === "window");

    if (screens.length === 0 && windows.length === 0) {
        const empty = document.createElement("div");
        empty.className = "source-share-empty";
        empty.textContent = "No screens or windows available to share.";
        sourceShareGroups.appendChild(empty);
        return;
    }
    if (screens.length > 0) {
        sourceShareGroups.appendChild(renderSourceShareGroup("Screens", screens));
    }
    if (windows.length > 0) {
        sourceShareGroups.appendChild(renderSourceShareGroup("Application Windows", windows));
    }
}

function closeScreenShareModal(): void {
    screenShareModal.classList.remove("visible");
    selectedShareSource = null;
}

screenShareModal.addEventListener("click", (e) => {
    if (e.target === screenShareModal) closeScreenShareModal();
});

btnScreenShareCancel.addEventListener("click", () => closeScreenShareModal());

btnScreenShareStart.addEventListener("click", async () => {
    const source = selectedShareSource;
    if (!source) return;
    btnScreenShareStart.disabled = true;

    const videoRes = await api.startScreenShareVideo(source.id);
    if (!videoRes.success) {
        log(`Failed to start screen share: ${videoRes.error}`, "error");
        btnScreenShareStart.disabled = false;
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
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    const finish = async (save: boolean): Promise<void> => {
        input.removeEventListener("keydown", onKeydown);
        input.removeEventListener("blur", onBlur);

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
});

// ── Nudge (PRD 4.14) ─────────────────────────────────────────────────────

api.on("server-settings-updated", (data: { nudgeEnabled: boolean; screenShareEnabled: boolean; maxMessageLength: number }) => {
    serverNudgeEnabled = data.nudgeEnabled;
    // If the Online Users modal is open, re-render so Nudge buttons appear/disappear live.
    if (onlineUsersModal.classList.contains("visible")) {
        api.getOnlineUsers().then((res) => {
            if (res.success && res.users) renderOnlineUsers(res.users);
        });
    }

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
api.on("viewer-joined-your-stream", () => {
    SoundAlert.play("user_joined_your_stream.mp3");
});

api.on("viewer-left-your-stream", () => {
    SoundAlert.play("user_exited_your_stream.mp3");
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

function showChannelIconModal(channelId: string): void {
    pendingChannelIconId = channelId;
    channelIconStepSelect.style.display = "block";
    channelIconStepEmoji.style.display = "none";
    channelIconStepCrop.style.display = "none";
    channelIconModal.classList.add("visible");
}

function closeChannelIconModal(): void {
    channelIconModal.classList.remove("visible");
    pendingChannelIconId = null;
    if (channelIconCropObjectUrl) {
        URL.revokeObjectURL(channelIconCropObjectUrl);
        channelIconCropObjectUrl = null;
    }
    channelIconCropImg.removeAttribute("src");
    channelIconCropNaturalWidth = 0;
    channelIconCropNaturalHeight = 0;
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

    if (channelIconCropObjectUrl) URL.revokeObjectURL(channelIconCropObjectUrl);
    channelIconCropObjectUrl = URL.createObjectURL(file);
    channelIconCropImg.src = channelIconCropObjectUrl;
});

function applyChannelIconCropTransform(): void {
    const scale = channelIconCropBaseScale * channelIconCropZoomFactor;
    channelIconCropImg.style.width = `${channelIconCropNaturalWidth}px`;
    channelIconCropImg.style.height = `${channelIconCropNaturalHeight}px`;
    channelIconCropImg.style.transform = `translate(${channelIconCropOffsetX}px, ${channelIconCropOffsetY}px) scale(${scale})`;
}

/** Keeps the image fully covering the viewport — offsets can't drift so far that a gap would show. */
function clampChannelIconCropOffsets(): void {
    const scale = channelIconCropBaseScale * channelIconCropZoomFactor;
    const displayedW = channelIconCropNaturalWidth * scale;
    const displayedH = channelIconCropNaturalHeight * scale;
    const minX = CHANNEL_ICON_CROP_VIEWPORT_SIZE - displayedW;
    const minY = CHANNEL_ICON_CROP_VIEWPORT_SIZE - displayedH;
    channelIconCropOffsetX = Math.min(0, Math.max(minX, channelIconCropOffsetX));
    channelIconCropOffsetY = Math.min(0, Math.max(minY, channelIconCropOffsetY));
}

channelIconCropImg.addEventListener("load", () => {
    channelIconCropNaturalWidth = channelIconCropImg.naturalWidth;
    channelIconCropNaturalHeight = channelIconCropImg.naturalHeight;
    if (!channelIconCropNaturalWidth || !channelIconCropNaturalHeight) return;

    channelIconCropBaseScale = Math.max(
        CHANNEL_ICON_CROP_VIEWPORT_SIZE / channelIconCropNaturalWidth,
        CHANNEL_ICON_CROP_VIEWPORT_SIZE / channelIconCropNaturalHeight,
    );
    channelIconCropZoomFactor = 1;
    channelIconCropZoom.value = "1";

    const displayedW = channelIconCropNaturalWidth * channelIconCropBaseScale;
    const displayedH = channelIconCropNaturalHeight * channelIconCropBaseScale;
    channelIconCropOffsetX = (CHANNEL_ICON_CROP_VIEWPORT_SIZE - displayedW) / 2;
    channelIconCropOffsetY = (CHANNEL_ICON_CROP_VIEWPORT_SIZE - displayedH) / 2;
    applyChannelIconCropTransform();

    channelIconStepSelect.style.display = "none";
    channelIconStepCrop.style.display = "block";
});

channelIconCropViewport.addEventListener("mousedown", (e) => {
    channelIconCropDragging = true;
    channelIconCropViewport.classList.add("dragging");
    channelIconCropDragStart = { x: e.clientX, y: e.clientY, offsetX: channelIconCropOffsetX, offsetY: channelIconCropOffsetY };
    e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
    if (!channelIconCropDragging) return;
    channelIconCropOffsetX = channelIconCropDragStart.offsetX + (e.clientX - channelIconCropDragStart.x);
    channelIconCropOffsetY = channelIconCropDragStart.offsetY + (e.clientY - channelIconCropDragStart.y);
    clampChannelIconCropOffsets();
    applyChannelIconCropTransform();
});

document.addEventListener("mouseup", () => {
    if (channelIconCropDragging) {
        channelIconCropDragging = false;
        channelIconCropViewport.classList.remove("dragging");
    }
});

channelIconCropZoom.addEventListener("input", () => {
    channelIconCropZoomFactor = parseFloat(channelIconCropZoom.value);
    clampChannelIconCropOffsets();
    applyChannelIconCropTransform();
});

btnChannelIconUploadConfirm.addEventListener("click", async () => {
    if (!pendingChannelIconId) return;
    if (!channelIconCropNaturalWidth || !channelIconCropNaturalHeight) return;
    const channelId = pendingChannelIconId;

    btnChannelIconUploadConfirm.disabled = true;
    try {
        const scale = channelIconCropBaseScale * channelIconCropZoomFactor;
        const srcX = -channelIconCropOffsetX / scale;
        const srcY = -channelIconCropOffsetY / scale;
        const srcSize = CHANNEL_ICON_CROP_VIEWPORT_SIZE / scale;

        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas not supported");
        ctx.drawImage(channelIconCropImg, srcX, srcY, srcSize, srcSize, 0, 0, 128, 128);

        const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
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

// ── Auto-Updater (PRD 10.1) ─────────────────────────────────────────────────
// Modal state machine: idle → found → downloading → ready. The startup check
// (fired from main.ts) never touches this UI directly — it only ever reaches
// the renderer via the "update-available" event below, so a failed/negative
// startup check is silent by construction, matching the spec.

type UpdateModalState = "idle" | "found" | "downloading" | "ready";
let updateModalState: UpdateModalState = "idle";

function showUpdateFoundModal(version: string): void {
    updateModalState = "found";
    updateModalTitle.textContent = "⬆ Update Available";
    updateModalMessage.textContent =
        `A newer version of Reson8 (${version}) is available. Some features might fail if you don't update.`;
    updateModalProgressWrap.style.display = "none";
    updateModalStatus.style.display = "none";
    btnUpdateNow.style.display = "";
    btnUpdateNow.disabled = false;
    btnUpdateNow.textContent = "Update Now";
    btnUpdateLater.style.display = "";
    updateModal.classList.add("visible");
}

function showUpdateDownloading(): void {
    updateModalState = "downloading";
    updateModalTitle.textContent = "⬇ Downloading Update";
    updateModalMessage.textContent = "Downloading the update — this may take a moment.";
    updateModalProgressWrap.style.display = "";
    updateModalProgressBar.style.width = "0%";
    updateModalStatus.style.display = "none";
    btnUpdateNow.style.display = "none";
    btnUpdateLater.style.display = "none";
}

function showUpdateReadyToRestart(): void {
    updateModalState = "ready";
    updateModalTitle.textContent = "✅ Update Ready";
    updateModalMessage.textContent = "Update ready — restarting...";
    updateModalProgressWrap.style.display = "none";
}

function showUpdateError(message: string): void {
    updateModalStatus.style.display = "";
    updateModalStatus.textContent =
        `Update failed: ${message}. Please download the latest version manually from GitHub.`;
    updateModalProgressWrap.style.display = "none";
    btnUpdateNow.style.display = "";
    btnUpdateNow.disabled = false;
    btnUpdateNow.textContent = "Update Now";
    btnUpdateLater.style.display = "";
}

api.on("update-available", (data: { version: string }) => {
    showUpdateFoundModal(data.version);
});

api.on("download-progress", (data: { percent: number }) => {
    if (updateModalState === "downloading") {
        updateModalProgressBar.style.width = `${Math.round(data.percent)}%`;
    }
});

api.on("update-downloaded", () => {
    showUpdateReadyToRestart();
    setTimeout(() => api.quitAndInstall(), 1200);
});

api.on("update-error", (data: { message: string }) => {
    showUpdateError(data.message);
});

btnUpdateNow.addEventListener("click", () => {
    showUpdateDownloading();
    api.downloadUpdate();
});

btnUpdateLater.addEventListener("click", () => {
    updateModal.classList.remove("visible");
    updateModalState = "idle";
});

// ── About Tab (PRD 10.1) ────────────────────────────────────────────────────

api.getAppVersion().then((version) => {
    aboutVersion.textContent = `Version ${version}`;
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

    pendingWhatsNewVersion = currentVersion;
    pendingWhatsNewUrl = notes.htmlUrl;
    whatsNewTitle.textContent = `🎉 What's New in ${notes.name || `v${currentVersion}`}`;
    // Already-rendered HTML (see main.ts's ReleaseNotes doc comment) — not
    // raw markdown, so this no longer shows literal "#"/"**"/"-" syntax.
    whatsNewBody.innerHTML = notes.bodyHtml || "<p>No release notes were provided for this version.</p>";
    whatsNewModal.classList.add("visible");
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
function compareVersions(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

async function checkVersionMismatch(serverVersion: string): Promise<void> {
    const clientVersion = await api.getAppVersion();
    if (clientVersion === serverVersion) return;

    const serverIsNewer = compareVersions(serverVersion, clientVersion) > 0;
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
    btnCheckUpdates.disabled = true;
    btnCheckUpdates.textContent = "Checking...";
    aboutUpdateStatus.textContent = "";
    const result = await api.checkForUpdates();
    btnCheckUpdates.disabled = false;
    btnCheckUpdates.textContent = "Check for Updates";
    if (result.status === "not-available") {
        aboutUpdateStatus.textContent = "You're up to date.";
    } else if (result.status === "error") {
        aboutUpdateStatus.textContent = result.message
            ? `Could not check for updates: ${result.message}`
            : "Could not check for updates. Try again later.";
    }
    // "available": the update-available listener above opens the shared modal.
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
    document.querySelectorAll(`.tree-occupant[data-user-id="${myId}"]`)
        .forEach((el) => el.classList.toggle("speaking", speaking));
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
