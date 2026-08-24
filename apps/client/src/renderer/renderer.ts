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
    editedAt?: string | null;
    reactions?: Array<{ emoji: string; count: number; userIds: string[] }>;
}

interface PinnedMessage {
    id: string;
    content: string;
    authorNickname: string;
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
    reactions?: Array<{ emoji: string; count: number; userIds: string[] }>;
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
    checkForUpdates(): Promise<{ status: "available" | "not-available" | "error"; message?: string }>;
    downloadUpdate(): Promise<void>;
    quitAndInstall(): void;
    getAppVersion(): Promise<string>;
    fetchReleaseNotes(version: string): Promise<{ name: string; body: string; htmlUrl: string } | null>;
    createChannel(
        serverId: string,
        name: string,
        type: "TEXT" | "VOICE",
        parentId?: string | null,
        isNsfw?: boolean,
    ): Promise<{ success: boolean; channelId?: string; error?: string }>;
    updateChannel(
        channelId: string,
        changes: { name?: string; position?: number; isNsfw?: boolean },
    ): Promise<{ success: boolean; error?: string }>;
    reorderChannels(
        parentId: string | null,
        orderedChannelIds: string[],
    ): Promise<{ success: boolean; error?: string }>;
    deleteChannel(channelId: string): Promise<{ success: boolean; error?: string }>;
    sendMessage(channelId: string, content: string, attachmentUrl?: string, attachmentPublicId?: string): Promise<{ success: boolean; messageId?: string }>;
    deleteMessage(messageId: string): Promise<{ success: boolean; error?: string }>;
    editMessage(messageId: string, content: string): Promise<{ success: boolean; error?: string }>;
    fetchMessages(channelId: string, before?: string, limit?: number, aroundMessageId?: string): Promise<{ success: boolean; messages?: ChatMessage[]; pinnedMessage?: PinnedMessage | null; error?: string }>;
    pinMessage(channelId: string, messageId: string): Promise<{ success: boolean; error?: string }>;
    unpinMessage(channelId: string): Promise<{ success: boolean; error?: string }>;
    markChannelRead(channelId: string): Promise<{ success: boolean }>;
    getAllUsers(serverId: string): Promise<{ success: boolean; users?: any[]; error?: string }>;
    getRoles(serverId: string): Promise<{ success: boolean; roles?: any[]; error?: string }>;
    assignRole(userId: string, roleId: string, action: "add" | "remove"): Promise<{ success: boolean; error?: string }>;
    enumerateAudioDevices(): Promise<{ inputs: { deviceId: string; label: string }[]; outputs: { deviceId: string; label: string }[] }>;
    setAudioInputDevice(deviceId: string | null): void;
    sendDirectMessage(recipientId: string, content: string, attachmentUrl?: string, attachmentPublicId?: string): Promise<{ success: boolean; messageId?: string; error?: string }>;
    deleteDirectMessage(dmId: string): Promise<{ success: boolean; error?: string }>;
    fetchDirectMessages(partnerId: string, before?: string, limit?: number): Promise<{ success: boolean; messages?: DirectMessage[]; error?: string }>;
    getOnlineUsers(): Promise<{ success: boolean; users?: { userId: string; nickname: string; isOnline: boolean }[]; error?: string }>;
    markDmsRead(partnerId: string): Promise<{ success: boolean; error?: string }>;
    getUnreadDmPartners(): Promise<{ success: boolean; partners?: { partnerId: string; partnerNickname: string; unreadCount: number }[]; error?: string }>;
    kickUser(userId: string, channelId: string): Promise<{ success: boolean; error?: string }>;
    banUser(userId: string): Promise<{ success: boolean; error?: string }>;
    unbanUser(userId: string): Promise<{ success: boolean; error?: string }>;
    getBannedUsers(): Promise<{ success: boolean; users?: { userId: string; nickname: string; bannedAt: string }[]; error?: string }>;
    uploadFile(fileBuffer: ArrayBuffer, fileName: string, mimeType: string): Promise<{ url: string; publicId?: string }>;
    downloadImage(url: string): void;
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
    uploadEmojiFile(fileBuffer: ArrayBuffer, fileName: string, mimeType: string): Promise<{ url: string; publicId?: string }>;
    createCustomEmoji(name: string, imageUrl: string, imagePublicId?: string): Promise<{ success: boolean; emojiId?: string; error?: string }>;
    getApprovedEmojis(): Promise<{ success: boolean; emojis?: CustomEmoji[]; error?: string }>;
    getPendingEmojis(): Promise<{ success: boolean; emojis?: CustomEmoji[]; error?: string }>;
    reviewCustomEmoji(emojiId: string, decision: "APPROVED" | "REJECTED"): Promise<{ success: boolean; error?: string }>;
    nudgeUser(targetUserId: string): Promise<{ success: boolean; error?: string }>;
    getServerSettings(): Promise<{
        success: boolean;
        nudgeEnabled?: boolean;
        screenShareEnabled?: boolean;
        error?: string;
    }>;
    updateServerSettings(
        settings: { nudgeEnabled?: boolean; screenShareEnabled?: boolean },
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

// Attachment state
let pendingAttachmentUrl: string | null = null;
let pendingAttachmentPublicId: string | null = null;
let serverBaseUrl: string = "";

// Active speakers state
const activeSpeakers = new Set<string>();
const speakerHoldTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Track previous occupants per voice channel for join/leave sound detection
let previousOccupantIds: Set<string> = new Set();

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
const chatInputBar = document.getElementById("chat-input-bar") as HTMLDivElement;
const chatInput = document.getElementById("chat-input") as HTMLInputElement;
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
const attachmentPreview = document.getElementById("attachment-preview") as HTMLDivElement;
const imageLightboxModal = document.getElementById("image-lightbox-modal") as HTMLDivElement;
const lightboxImage = document.getElementById("lightbox-image") as HTMLImageElement;
const btnLightboxDownload = document.getElementById("btn-lightbox-download") as HTMLButtonElement;

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
const micSensitivitySliderWrap = document.getElementById("mic-sensitivity-slider-wrap") as HTMLDivElement;
const micSensitivitySlider = document.getElementById("mic-sensitivity-slider") as HTMLInputElement;
const micSensitivityValue = document.getElementById("mic-sensitivity-value") as HTMLSpanElement;
const micLevelBar = document.getElementById("mic-level-bar") as HTMLDivElement;
const micSensitivitySection = document.getElementById("mic-sensitivity-section") as HTMLDivElement;

// State for pending delete
let pendingDeleteChannelId: string | null = null;

// ── Rename Channel Modal (PRD 4.5) ──────────────────────────────────────────
const renameChannelModal = document.getElementById("rename-channel-modal") as HTMLDivElement;
const renameChannelInput = document.getElementById("rename-channel-input") as HTMLInputElement;
const btnRenameCancel = document.getElementById("btn-rename-cancel") as HTMLButtonElement;
const btnRenameConfirm = document.getElementById("btn-rename-confirm") as HTMLButtonElement;
let pendingRenameChannelId: string | null = null;

// ── NSFW Channel Confirmation Modal (PRD 4.7) ───────────────────────────────
const nsfwConfirmModal = document.getElementById("nsfw-confirm-modal") as HTMLDivElement;
const nsfwConfirmChannelName = document.getElementById("nsfw-confirm-channel-name") as HTMLElement;
const btnNsfwCancel = document.getElementById("btn-nsfw-cancel") as HTMLButtonElement;
const btnNsfwConfirm = document.getElementById("btn-nsfw-confirm") as HTMLButtonElement;
let pendingNsfwChannel: TreeNode | null = null;

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

    const label = document.createElement("div");
    label.className = "tree-category-label";
    label.innerHTML = `<span class="arrow">▾</span> ${escapeHtml(node.name)}`;
    label.addEventListener("click", () => {
        category.classList.toggle("collapsed");
    });
    attachChannelDragHandlers(label, node, siblings);
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

    // Also render the category itself as a joinable channel if it's a voice channel
    // (categories can also be voice channels that users can join)

    category.appendChild(children);
    return category;
}

function renderChannel(node: TreeNode, siblings: TreeNode[]): HTMLDivElement {
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
        if (unreadChannelIds.has(node.id)) channel.classList.add("unread");
    }
    const unreadDot = !isVoice && unreadChannelIds.has(node.id) ? `<span class="unread-dot"></span>` : "";

    channel.innerHTML = `
        <span class="ch-icon ${iconClass}">${icon}</span>
        <span class="ch-name">${escapeHtml(node.name)}</span>
        ${unreadDot}
        ${nsfwBadge}
        ${timerBadge}
        ${countBadge}
    `;

    channel.addEventListener("click", () => handleChannelClick(node));
    attachChannelDragHandlers(channel, node, siblings);

    // Right-click → Rename / Toggle NSFW (text only) / Delete
    channel.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();

        document.querySelector(".occupant-ctx-menu")?.remove();

        const menu = document.createElement("div");
        menu.className = "occupant-ctx-menu";
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;

        menu.innerHTML = `
            <button class="channel-ctx-menu-item ctx-rename-btn">✏️ Rename</button>
            ${!isVoice ? `<button class="channel-ctx-menu-item ctx-nsfw-toggle-btn">🔞 ${node.isNsfw ? "Unmark" : "Mark"} as NSFW</button>` : ""}
            <button class="ctx-delete-channel-btn">🗑️ Delete Channel</button>
        `;

        menu.querySelector(".ctx-rename-btn")?.addEventListener("click", () => {
            menu.remove();
            showRenameModal(node.id, node.name);
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

    return channel;
}

// Inline SVGs shown next to an occupant's name when they've muted or deafened
// themselves, so it doesn't look like they're simply ignoring everyone else.
const OCC_MUTED_ICON =
    `<svg class="occ-voice-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" title="Muted"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2M19 10v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
const OCC_DEAFENED_ICON =
    `<svg class="occ-voice-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" title="Deafened"><line x1="1" y1="1" x2="23" y2="23"/><path d="M3 18v-6a9 9 0 0 1 15.34-6.36M21 12v2.5"/><path d="M21 16v2a2 2 0 0 1-2 2h-1"/><path d="M3 18v2a2 2 0 0 0 2 2h1v-4H4a1 1 0 0 0-1 1z"/></svg>`;

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
        if (activeSpeakers.has(occ.userId)) {
            el.classList.add("speaking");
        }
        el.setAttribute("data-user-id", occ.userId);
        const voiceStateIcons =
            `${occ.isMuted ? OCC_MUTED_ICON : ""}${occ.isDeafened ? OCC_DEAFENED_ICON : ""}`;
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
                // per session — reapply the saved global voice volume so it
                // doesn't silently reset to 100% on every join.
                api.setGlobalVoiceVolume(voiceVolume);

                // Initialize previous occupants for join/leave sound detection
                previousOccupantIds = new Set(node.occupants.map((o: any) => o.userId));

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
                        startMicLevelMeter();
                    }
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
        // Text channel — open (or focus) a chat tab, prompting first if NSFW
        if (node.isNsfw) {
            pendingNsfwChannel = node;
            nsfwConfirmChannelName.textContent = node.name;
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
    document.title = isSharingScreen ? "🔴 Reson8" : "Reson8";
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

function leaveVoiceAndNotify(): void {
    api.leaveVoiceChannel();
    isInVoice = false;
    currentChannelId = null;
    previousOccupantIds = new Set();
    stopMicLevelMeter();
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
    document.querySelectorAll(`.chat-msg[data-msg-id="${CSS.escape(msgId)}"]`).forEach((el) => el.remove());
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
    log("Connected to server", "success");
    SoundAlert.play("connected.mp3");

    // Always show the online users button when connected
    btnOnlineUsers.style.display = "";
    updateOnlineDot();

    // Check admin/emoji-management status on connect (not just when the
    // Settings modal opens) so openSettingsPanel() already knows the answer
    // and can render the right tabs on the very first paint — see
    // applySettingsTabVisibility().
    Promise.all([api.getAllUsers(data.serverId), api.getPendingEmojis()]).then(
        ([usersRes, pendingEmojisRes]) => {
            isAdminUser = usersRes.success;
            canManageEmojis = pendingEmojisRes.success;
            settingsTabRoles.disabled = !isAdminUser;
        },
    );

    // Auto-open DM tabs for partners with unread messages
    api.getUnreadDmPartners().then((res) => {
        if (res.success && res.partners && res.partners.length > 0) {
            for (const p of res.partners) {
                openDmTab(p.partnerId, p.partnerNickname);
            }
        }
    });

    // Load approved custom emojis for the picker's "+" tab
    api.getApprovedEmojis().then((res) => {
        if (res.success && res.emojis) {
            customEmojis = res.emojis;
        }
    });

    // Load the server-wide Nudge / Screen Sharing toggles
    api.getServerSettings().then((res) => {
        if (res.success && res.nudgeEnabled !== undefined) {
            serverNudgeEnabled = res.nudgeEnabled;
        }
        if (res.success && res.screenShareEnabled !== undefined) {
            serverScreenShareEnabled = res.screenShareEnabled;
            updateShareScreenButton();
        }
    });
});

api.on("disconnected", () => {
    isConnected = false;
    isAdminUser = false;
    canManageEmojis = false;
    isInVoice = false;
    currentChannelId = null;
    currentServerId = "";
    currentTree = [];
    customEmojis = [];
    previousOccupantIds = new Set();
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
    for (const [tabId] of chatTabs) {
        closeTab(tabId);
    }
    switchTab("server-log");
    log("Disconnected from server", "error");
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
    // per-session state (global volume) needs to be re-sent.
    api.setGlobalVoiceVolume(voiceVolume);
    api.setVoiceState(isMuted, isDeafened);
    previousOccupantIds = new Set((node?.occupants ?? []).map((o) => o.userId));

    log(`Reconnected to voice channel${node ? `: ${node.name}` : ""}`, "success");
    if (currentTree.length > 0) renderTree(currentTree);
});

api.on("voice-rejoin-failed", (data: { channelId: string; error?: string }) => {
    voicePanel.classList.remove("reconnecting");
    if (currentChannelId === data.channelId) {
        isInVoice = false;
        currentChannelId = null;
        previousOccupantIds = new Set();
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
    renderTree(data.tree);
    syncOpenTabNames(data.tree);
});

/** Keeps already-open chat tabs' displayed names in sync after a channel rename. */
function syncOpenTabNames(tree: TreeNode[]): void {
    if (chatTabs.size === 0) return;

    function walk(nodes: TreeNode[]): void {
        for (const node of nodes) {
            const tab = chatTabs.get(node.id);
            if (tab && tab.channelName !== node.name) {
                tab.channelName = node.name;
                tab.tabEl.innerHTML = `💬 ${escapeHtml(node.name)} <span class="tab-close">✕</span>`;
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

        // Skip sounds if a kick just occurred (avoids double sound)
        if (suppressNextPresenceSound) {
            suppressNextPresenceSound = false;
            previousOccupantIds = newIds;
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
        previousOccupantIds = newIds;
    }
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
    sessionTimers.delete(data.channelId);
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
    markChannelRead(tabId);

    // Close emoji picker on tab switch
    closeEmojiPicker();

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
        if (msgId) jumpToPinnedMessage(channelId, msgId);
    });
    contentEl.appendChild(pinBarEl);

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
        pinBarEl,
        pinnedMessageId: null,
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
        pinnedMessageId: null,
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
            // Set before rendering so each message's pin button (PRD 11.5)
            // reflects the correct active/inactive state on first paint.
            tab.pinnedMessageId = result.pinnedMessage?.id ?? null;
            for (const msg of result.messages) {
                renderChatMessage(tab, msg);
            }
            updatePinBarUI(tab, result.pinnedMessage ?? null);
        }
    }
}

function renderChatMessage(tab: ChatTab, msg: ChatMessage): void {
    const el = document.createElement("div");
    el.className = "chat-msg";
    el.setAttribute("data-msg-id", msg.id);
    el.setAttribute("data-msg-type", "channel");
    el.setAttribute("data-msg-owner", msg.userId);

    const time = new Date(msg.createdAt).toLocaleTimeString();
    const editedLabel = msg.editedAt ? `<span class="msg-edited">(edited)</span>` : "";
    let html = `<span class="msg-time">${time}</span>${editedLabel}<span class="msg-nick">${escapeHtml(msg.nickname)}</span>`;

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

    // Reaction bar
    const reactBar = buildReactionBar(msg.id, false, msg.userId, msg.reactions);
    el.appendChild(reactBar);
    attachEditButton(reactBar, msg, el);
    attachPinButton(reactBar, msg, tab);

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
    const attachmentPublicId = pendingAttachmentPublicId;
    clearAttachmentPreview();

    if (activeTabId.startsWith("dm:")) {
        // DM tab — send direct message
        const recipientId = activeTabId.slice(3);
        const result = await api.sendDirectMessage(recipientId, content, attachmentUrl ?? undefined, attachmentPublicId ?? undefined);
        if (!result.success) {
            log(`Failed to send DM: ${result.error ?? "Unknown error"}`, "error");
        }
    } else {
        // Channel tab — send channel message
        const channelId = activeTabId;
        const result = await api.sendMessage(channelId, content, attachmentUrl ?? undefined, attachmentPublicId ?? undefined);
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

    const el = channelTree.querySelector(`.tree-channel[data-channel-id="${CSS.escape(channelId)}"]`);
    el?.classList.remove("unread");
    el?.querySelector(".unread-dot")?.remove();

    api.markChannelRead(channelId);
}

// ── DM Event Listener ─────────────────────────────────────────────────────

function renderDmMessage(tab: ChatTab, msg: DirectMessage): void {
    const el = document.createElement("div");
    el.className = "chat-msg";
    el.setAttribute("data-msg-id", msg.id);
    el.setAttribute("data-msg-type", "dm");
    el.setAttribute("data-msg-owner", msg.senderId);

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

    // Reaction bar
    const reactBar = buildReactionBar(msg.id, true, msg.senderId, msg.reactions);
    el.appendChild(reactBar);

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

api.on("dm-received", async (msg: DirectMessage) => {
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

    // DM notification sound: play when message is from someone else AND
    // the DM tab is not focused OR the window is not focused
    if (msg.senderId !== myId) {
        const isTabActive = activeTabId === tabKey;
        const isFocused = await api.isWindowFocused();
        if (!isTabActive || !isFocused) {
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

    // Append banned users section (admin only)
    if (isAdminUser) {
        const bannedResult = await api.getBannedUsers();
        if (bannedResult.success && bannedResult.users && bannedResult.users.length > 0) {
            const separator = document.createElement("div");
            separator.className = "online-users-separator banned";
            separator.textContent = "Banned Users";
            onlineUserList.appendChild(separator);

            for (const banned of bannedResult.users) {
                const row = document.createElement("div");
                row.className = "online-user-row";

                const info = document.createElement("div");
                info.className = "online-user-info";
                info.innerHTML = `<span class="online-user-dot banned"></span><span class="online-user-nick banned">${escapeHtml(banned.nickname)}</span>`;
                row.appendChild(info);

                const unbanBtn = document.createElement("button");
                unbanBtn.className = "btn-unban";
                unbanBtn.textContent = "Unban";
                unbanBtn.addEventListener("click", async () => {
                    const res = await api.unbanUser(banned.userId);
                    if (res.success) {
                        log(`Unbanned ${escapeHtml(banned.nickname)}`, "success");
                        SoundAlert.play("user_unbanned_from_server.mp3");
                        row.remove();
                        // Remove separator if no more banned users
                        const remaining = onlineUserList.querySelectorAll(".btn-unban");
                        if (remaining.length === 0) {
                            separator.remove();
                        }
                    } else {
                        log(`Failed to unban: ${res.error}`, "error");
                        if (res.error && /permission|denied/i.test(res.error)) SoundAlert.play("insufficient_perms.mp3");
                    }
                });
                row.appendChild(unbanBtn);

                onlineUserList.appendChild(row);
            }
        }
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

    const myId = api.getInstanceId();

    // Nudge — online users only, never yourself, only when the server allows it
    if (user.isOnline && user.userId !== myId && serverNudgeEnabled) {
        const nudgeBtn = document.createElement("button");
        nudgeBtn.className = "btn-nudge";
        nudgeBtn.textContent = "👋 Nudge";

        let cooldownInterval: ReturnType<typeof setInterval> | null = null;
        const applyCooldownState = (): void => {
            if (!document.body.contains(nudgeBtn)) {
                if (cooldownInterval) clearInterval(cooldownInterval);
                return;
            }
            const last = lastNudgeSentAt.get(user.userId);
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

        if (lastNudgeSentAt.has(user.userId)) {
            applyCooldownState();
            cooldownInterval = setInterval(applyCooldownState, 1000);
        }

        nudgeBtn.addEventListener("click", async () => {
            nudgeBtn.disabled = true;
            const res = await api.nudgeUser(user.userId);
            if (res.success) {
                lastNudgeSentAt.set(user.userId, Date.now());
                applyCooldownState();
                if (!cooldownInterval) cooldownInterval = setInterval(applyCooldownState, 1000);
                log(`Nudged ${escapeHtml(user.nickname)}`, "success");
            } else {
                nudgeBtn.disabled = false;
                log(`Failed to nudge: ${res.error}`, "error");
            }
        });
        btnGroup.appendChild(nudgeBtn);
    }

    // Admin-only ban button (don't show for self)
    if (isAdminUser && user.userId !== myId) {
        const banBtn = document.createElement("button");
        banBtn.className = "btn-ban";
        banBtn.textContent = "Ban";
        banBtn.addEventListener("click", async () => {
            const res = await api.banUser(user.userId);
            if (res.success) {
                log(`Banned ${escapeHtml(user.nickname)} from server`, "success");
                SoundAlert.play("user_banned_from_server.mp3");
                row.remove();
            } else {
                log(`Failed to ban: ${res.error}`, "error");
                if (res.error && /permission|denied/i.test(res.error)) SoundAlert.play("insufficient_perms.mp3");
            }
        });
        btnGroup.appendChild(banBtn);
    }

    row.appendChild(btnGroup);
    return row;
}

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

let isAdminUser = false;
let canManageEmojis = false;

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
    settingsTabRoles.style.display = isConnected && isAdminUser ? "" : "none";
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
    adminModal.classList.add("visible");

    // Populate audio devices
    await populateAudioDevices();

    // Start mic preview for meter if sensitivity is enabled and not already in voice
    if (micSensitivityEnabled && !isInVoice) {
        api.startMicPreview();
        startMicLevelMeter();
    }

    if (isConnected) {
        // Live re-check, in case permissions changed since connect (e.g. an
        // admin promoted/demoted this user mid-session). Fetch users, roles,
        // and the pending-emoji queue concurrently. The Emojis tab's
        // visibility is decided by whether GET_PENDING_EMOJIS actually
        // succeeds (i.e. the server confirms MANAGE_EMOJIS) rather than
        // reusing the isAdminUser heuristic — MANAGE_EMOJIS is a distinct
        // permission bit, even though in practice only the Admin role (via
        // its ADMIN bypass) holds it today.
        const [usersRes, rolesRes, pendingEmojisRes] = await Promise.all([
            api.getAllUsers(currentServerId),
            api.getRoles(currentServerId),
            api.getPendingEmojis(),
        ]);

        isAdminUser = usersRes.success;
        canManageEmojis = pendingEmojisRes.success;
        applySettingsTabVisibility();

        if (isAdminUser) {
            allServerRoles = rolesRes.roles ?? [];
            renderAdminUsers(usersRes.users ?? []);
        } else {
            adminUserList.innerHTML = '<div class="admin-empty">You don\'t have permission to manage roles.</div>';
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
        updateVoiceUI();
    }
});

api.on("ptt-released", () => {
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
            startMicLevelMeter();
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
        stopMicLevelMeter();
    }
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

// Uploads happen up front (before Send is even clicked) — SEND_MESSAGE only
// fires once an attachmentUrl already exists. So the "nothing shows until
// upload finishes" gap this item fixes is entirely inside this function: the
// moment a file is picked/pasted, show a local-blob thumbnail + spinner in
// the attachment bar immediately (PRD 4.12), instead of only a text log line
// while the network round-trip is in flight.
let pendingAttachmentObjectUrl: string | null = null;

function revokePendingAttachmentObjectUrl(): void {
    if (pendingAttachmentObjectUrl) {
        URL.revokeObjectURL(pendingAttachmentObjectUrl);
        pendingAttachmentObjectUrl = null;
    }
}

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

    revokePendingAttachmentObjectUrl();
    pendingAttachmentObjectUrl = URL.createObjectURL(file);
    showAttachmentUploading(file.name, pendingAttachmentObjectUrl);

    try {
        const buffer = await file.arrayBuffer();
        const result = await api.uploadFile(buffer, file.name, file.type);
        pendingAttachmentUrl = result.url;
        pendingAttachmentPublicId = result.publicId ?? null;
        revokePendingAttachmentObjectUrl();
        showAttachmentPreview(file.name);
        log(`Image ready to send: ${file.name}`, "success");
    } catch (err: any) {
        log(`Upload failed: ${err.message}`, "error");
        showAttachmentFailed(file.name, err.message, () => handleFileUpload(file));
    }
}

/** Instant local preview shown the moment a file is picked, before the upload round-trip even starts. */
function showAttachmentUploading(fileName: string, previewObjectUrl: string): void {
    attachmentPreview.classList.remove("attachment-failed");
    attachmentPreview.innerHTML = `
        <img class="attachment-thumb" src="${escapeHtml(previewObjectUrl)}" alt="">
        <span class="attachment-name">📎 Uploading ${escapeHtml(fileName)}…</span>
        <span class="attachment-spinner"></span>
    `;
    attachmentPreview.style.display = "flex";
}

/** Ready-to-send state — unchanged from before this item, on purpose: only the uploading/failed states are new. */
function showAttachmentPreview(fileName: string): void {
    attachmentPreview.classList.remove("attachment-failed");
    attachmentPreview.innerHTML = `
        <span class="attachment-name">📎 ${escapeHtml(fileName)}</span>
        <button class="attachment-remove" id="btn-remove-attachment">✕</button>
    `;
    attachmentPreview.style.display = "flex";
    document.getElementById("btn-remove-attachment")?.addEventListener("click", clearAttachmentPreview);
}

/** Failure state — surfaces the error instead of silently discarding the attempt, with a one-click retry (re-reads the same File object). */
function showAttachmentFailed(fileName: string, errorMessage: string, onRetry: () => void): void {
    attachmentPreview.classList.add("attachment-failed");
    attachmentPreview.innerHTML = `
        <span class="attachment-name">⚠️ ${escapeHtml(fileName)} failed: ${escapeHtml(errorMessage)}</span>
        <button class="attachment-retry" id="btn-retry-attachment">Retry</button>
        <button class="attachment-remove" id="btn-remove-attachment">✕</button>
    `;
    attachmentPreview.style.display = "flex";
    document.getElementById("btn-retry-attachment")?.addEventListener("click", onRetry);
    document.getElementById("btn-remove-attachment")?.addEventListener("click", clearAttachmentPreview);
}

function clearAttachmentPreview(): void {
    pendingAttachmentUrl = null;
    pendingAttachmentPublicId = null;
    revokePendingAttachmentObjectUrl();
    attachmentPreview.classList.remove("attachment-failed");
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
    if (e.key === "Escape" && emojiPicker.classList.contains("visible")) {
        closeEmojiPicker();
    }
    if (e.key === "Escape" && imageLightboxModal.classList.contains("visible")) {
        imageLightboxModal.classList.remove("visible");
        lightboxImage.src = "";
    }
    if (e.key === "Escape" && videoLightboxModal.classList.contains("visible")) {
        closeVideoLightbox();
    }
});

// ── Reaction Helpers ──────────────────────────────────────────────────────

// Track reaction-mode state for the emoji picker
let reactionTargetMsgId: string | null = null;
let reactionTargetIsDm = false;

function buildReactionBar(
    msgId: string,
    isDm: boolean,
    ownerId: string,
    reactions?: Array<{ emoji: string; count: number; userIds: string[] }>,
): HTMLDivElement {
    const bar = document.createElement("div");
    bar.className = "msg-reactions";
    bar.setAttribute("data-react-bar", msgId);

    const myId = api.getInstanceId();

    if (reactions && reactions.length > 0) {
        for (const r of reactions) {
            const pill = document.createElement("button");
            pill.className = "reaction-pill" + (r.userIds.includes(myId) ? " mine" : "");
            pill.innerHTML = `${renderEmojiToken(r.emoji)} <span class="reaction-count">${r.count}</span>`;
            pill.title = `Reacted by ${r.count} user${r.count > 1 ? "s" : ""}`;
            pill.addEventListener("click", (e) => {
                e.stopPropagation();
                api.toggleReaction(msgId, r.emoji, isDm);
            });
            bar.appendChild(pill);
        }
    }

    // Add react button (small smiley icon)
    const btnReact = document.createElement("button");
    btnReact.className = "btn-react";
    btnReact.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`;
    btnReact.title = "Add reaction";
    btnReact.addEventListener("click", (e) => {
        e.stopPropagation();
        openReactionPicker(msgId, isDm, btnReact);
    });
    bar.appendChild(btnReact);

    // Delete button — own messages only (PRD 4.10)
    if (ownerId === myId) {
        const btnDelete = document.createElement("button");
        btnDelete.className = "btn-delete-msg";
        btnDelete.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
        btnDelete.title = "Delete message";
        btnDelete.addEventListener("click", (e) => {
            e.stopPropagation();
            showDeleteMessageModal(msgId, isDm);
        });
        bar.appendChild(btnDelete);
    }

    return bar;
}

function openReactionPicker(msgId: string, isDm: boolean, anchor: HTMLElement): void {
    reactionTargetMsgId = msgId;
    reactionTargetIsDm = isDm;

    // Position the emoji picker near the anchor button
    const rect = anchor.getBoundingClientRect();
    emojiPicker.style.position = "fixed";
    emojiPicker.style.bottom = "auto";
    emojiPicker.style.left = `${rect.left}px`;
    emojiPicker.style.top = `${Math.max(4, rect.top - 390)}px`;

    emojiPicker.classList.add("visible");
    emojiSearch.value = "";
    renderEmojiGrid();
    buildEmojiCategoryTabs();
    emojiSearch.focus();
}

function updateReactionBar(
    msgId: string,
    isDm: boolean,
    reactions: Array<{ emoji: string; count: number; userIds: string[] }>,
): void {
    // Find all reaction bars for this message (could be in multiple open tabs)
    const bars = document.querySelectorAll(`[data-react-bar="${msgId}"]`);
    for (const bar of bars) {
        const parent = bar.parentElement;
        if (!parent) continue;
        // Rebuild the bar — ownerId is read back from the message element's
        // own data-msg-owner attribute (set at render time) since
        // REACTION_UPDATED doesn't carry it.
        const ownerId = parent.getAttribute("data-msg-owner") ?? "";
        const newBar = buildReactionBar(msgId, isDm, ownerId, reactions);
        parent.replaceChild(newBar, bar);
    }
}

// Listen for reaction updates from server
api.on("reaction-updated", (data: { messageId: string; isDm: boolean; reactions: Array<{ emoji: string; count: number; userIds: string[] }> }) => {
    updateReactionBar(data.messageId, data.isDm, data.reactions);
});

// ── Edit Own Messages (PRD 4.11) ────────────────────────────────────────────
// Channel messages only (not DMs), text-only (no attachment), within 2
// minutes of sending — all enforced authoritatively server-side; the checks
// here are just so the user gets immediate feedback instead of a silent
// round-trip failure.
const EDIT_WINDOW_MS = 2 * 60 * 1000;

function attachEditButton(bar: HTMLDivElement, msg: ChatMessage, el: HTMLDivElement): void {
    const myId = api.getInstanceId();
    if (msg.userId !== myId || msg.attachmentUrl) return;

    const btnEdit = document.createElement("button");
    btnEdit.className = "btn-edit-msg";
    btnEdit.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    btnEdit.title = "Edit message";
    btnEdit.addEventListener("click", (e) => {
        e.stopPropagation();
        const ageMs = Date.now() - new Date(msg.createdAt).getTime();
        if (ageMs > EDIT_WINDOW_MS) {
            log("Edit window has expired (2 minutes)", "error");
            return;
        }
        startMessageEdit(el, msg);
    });
    bar.appendChild(btnEdit);
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

function attachPinButton(bar: HTMLDivElement, msg: ChatMessage, tab: ChatTab): void {
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

    bar.appendChild(btnPin);
}

/** Updates a tab's pin bar + the affected message pin buttons' active state. */
function updatePinBarUI(tab: ChatTab, pinnedMessage: PinnedMessage | null): void {
    const oldPinnedId = tab.pinnedMessageId;
    tab.pinnedMessageId = pinnedMessage?.id ?? null;

    for (const id of new Set([oldPinnedId, tab.pinnedMessageId])) {
        if (!id) continue;
        const btn = tab.messagesEl.querySelector(`[data-msg-id="${id}"] .btn-pin-msg`);
        if (btn) {
            const active = id === tab.pinnedMessageId;
            btn.classList.toggle("active", active);
            btn.setAttribute("title", active ? "Unpin message" : "Pin message");
        }
    }

    if (!tab.pinBarEl) return;
    if (pinnedMessage) {
        const textEl = tab.pinBarEl.querySelector(".pinned-bar-text") as HTMLSpanElement;
        const preview = pinnedMessage.content.length > 100
            ? `${pinnedMessage.content.slice(0, 100)}…`
            : pinnedMessage.content;
        textEl.textContent = preview || "(attachment only)";
        tab.pinBarEl.dataset.pinnedMsgId = pinnedMessage.id;
        tab.pinBarEl.classList.add("visible");
    } else {
        tab.pinBarEl.classList.remove("visible");
        delete tab.pinBarEl.dataset.pinnedMsgId;
    }
}

/** Scrolls to and briefly highlights a pinned message, fetching a window
 *  around it first if it isn't within the currently-loaded page. */
async function jumpToPinnedMessage(channelId: string, messageId: string): Promise<void> {
    const tab = chatTabs.get(channelId);
    if (!tab) return;

    let el = tab.messagesEl.querySelector(`[data-msg-id="${messageId}"]`) as HTMLDivElement | null;

    if (!el) {
        const result = await api.fetchMessages(channelId, undefined, 50, messageId);
        if (!result.success || !result.messages) {
            log("Couldn't load the pinned message", "error");
            return;
        }
        tab.messagesEl.innerHTML = "";
        for (const msg of result.messages) {
            renderChatMessage(tab, msg);
        }
        el = tab.messagesEl.querySelector(`[data-msg-id="${messageId}"]`) as HTMLDivElement | null;
    }

    if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("msg-highlight");
        setTimeout(() => el?.classList.remove("msg-highlight"), 2000);
    }
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
        newTextEl.innerHTML = linkifyContent(newContent);
        input.replaceWith(newTextEl);
        if (!el.querySelector(".msg-edited")) {
            el.querySelector(".msg-time")?.insertAdjacentHTML("afterend", `<span class="msg-edited">(edited)</span>`);
        }
    };

    const onKeydown = (e: KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
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
        const textEl = el.querySelector(".msg-text");
        if (textEl) {
            textEl.innerHTML = linkifyContent(msg.content);
        }
        if (!el.querySelector(".msg-edited")) {
            el.querySelector(".msg-time")?.insertAdjacentHTML("afterend", `<span class="msg-edited">(edited)</span>`);
        }
    });
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
    }
    if (emojiPicker.classList.contains("visible")) {
        renderEmojiGrid(emojiSearch.value);
    }
});

// ── Nudge (PRD 4.14) ─────────────────────────────────────────────────────

api.on("server-settings-updated", (data: { nudgeEnabled: boolean; screenShareEnabled: boolean }) => {
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
});

api.on("nudge-received", async (data: { fromUserId: string; fromNickname: string }) => {
    SoundAlert.play("nudge.mp3");
    showToast(`👋 <strong>${escapeHtml(data.fromNickname)}</strong> nudged you!`);

    const isFocused = await api.isWindowFocused();
    if (!isFocused) {
        api.flashWindow();
    }
});

// ── Emoji Picker ──────────────────────────────────────────────────────────

function closeEmojiPicker(): void {
    emojiPicker.classList.remove("visible");
    btnEmoji.classList.remove("active");
    // Reset reaction mode
    reactionTargetMsgId = null;
    // Reset positioning to default (for chat input picker)
    emojiPicker.style.position = "";
    emojiPicker.style.bottom = "";
    emojiPicker.style.left = "";
    emojiPicker.style.top = "";
}

function openEmojiPicker(): void {
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
    // small "plus" icon in the same stroke style as the main emoji button,
    // sized down to fit the tab, replacing the previous "➕" character
    // (inconsistent size/weight across platforms and easy to miss at low
    // opacity).
    const customBtn = document.createElement("button");
    customBtn.className = "emoji-cat-tab";
    customBtn.title = "Custom Emojis";
    customBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
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
        const createResult = await api.createCustomEmoji(name, uploadResult.url, uploadResult.publicId);

        if (createResult.success) {
            log(`Emoji ":${name}:" submitted for admin approval`, "success");
            closeEmojiUploadModal();
        } else {
            log(`Failed to submit emoji: ${createResult.error}`, "error");
        }
    } catch (err: any) {
        log(`Emoji upload failed: ${err.message}`, "error");
    } finally {
        btnEmojiUploadConfirm.disabled = false;
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
    whatsNewBody.textContent = notes.body.trim() || "No release notes were provided for this version.";
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

function startMicLevelMeter(): void {
    stopMicLevelMeter(); // clear any previous
    function tick() {
        const dB = api.getMicLevel();
        // Map dB range [-60, 0] to [0%, 100%]
        const pct = Math.max(0, Math.min(100, ((dB + 60) / 60) * 100));
        if (micLevelBar) micLevelBar.style.width = `${pct}%`;
        micLevelAnimId = requestAnimationFrame(tick);
    }
    micLevelAnimId = requestAnimationFrame(tick);
}

function stopMicLevelMeter(): void {
    if (micLevelAnimId !== null) {
        cancelAnimationFrame(micLevelAnimId);
        micLevelAnimId = null;
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
    if (micSensitivitySliderWrap) {
        micSensitivitySliderWrap.style.display = micSensitivityEnabled ? "block" : "none";
    }
    // Hide noise gate section if PTT mode is active
    if (pttModeEnabled && micSensitivitySection) {
        micSensitivitySection.style.display = "none";
    }
}

chkMicSensitivity?.addEventListener("change", () => {
    micSensitivityEnabled = chkMicSensitivity.checked;
    if (micSensitivityEnabled) {
        localStorage.setItem("reson8-mic-sensitivity-enabled", "true");
        micSensitivitySliderWrap.style.display = "block";
        if (isInVoice && !pttModeEnabled) {
            const threshold = parseInt(micSensitivitySlider.value, 10);
            api.setMicSensitivity(true, threshold);
        } else if (!isInVoice) {
            // Start preview so the meter works outside a voice channel
            api.startMicPreview();
        }
        startMicLevelMeter();
    } else {
        localStorage.removeItem("reson8-mic-sensitivity-enabled");
        micSensitivitySliderWrap.style.display = "none";
        api.setMicSensitivity(false, 0);
        api.stopMicPreview();
        stopMicLevelMeter();
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
