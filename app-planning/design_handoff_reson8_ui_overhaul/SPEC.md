# Reson8 UI overhaul — behaviour spec

These are the final rules. Frame ids (e.g. `13b`) point into `design/Reson8 UI Study.dc.html`. Where a later decision overrode an earlier frame, the rule here says so.

---

## 1. Shell and servers

### 1.1 Layout (1a)
- **Columns:** a 64px server rail on the left, a 280px sidebar, then the main area (tab bar + content). A 28px status bar runs along the bottom.
- **Rail, top to bottom:** the Servers button, the Direct messages button (with its badge), a divider, saved servers (40×40, `--radius-md`, initials or icon), and Add a server. Settings sits at the bottom.
- **The settings gear** shows an 8px accent dot while an update is available or waiting for a restart (§8).
- **Status bar:** a connection dot, "Encrypted" (no TLS version text), and "Client {version}" on the right.
- **Title bar:** the logo and "Reson8" only, with no version number. The connection pill there reads "Not connected", or the server name once connected; clicking it opens the switcher (1d).

### 1.2 Not connected (2a, 2b)
- **Welcome screen:** a connect form (address, nickname, optional password, Remember) and the **saved server list**.
- **Saved servers** replace today's single remembered URL. Store them in `localStorage` under `reson8-saved-servers`. Each entry is `{ name, host, port, iconUrl?, lastConnected }`.
- **Icons offline:** `iconUrl` is the server's public icon URL (§1.5), so saved servers show their icon even while disconnected.
- **Disabled controls:** with no connection, the DM rail button is disabled and its tooltip reads "Direct messages — connect to a server first".

### 1.3 Server header and dropdown (1e)
- **Header:** the 38×38 server icon (initials on `--color-accent-900` when there's no icon), the server name, and "{host} · {N} online" underneath.
- **The online count is live and must match the About modal's count.** Never hard-code it.
- **Dropdown items:** About {server}, Copy server address, then a divider, then Create channel (admin) and Server settings (admin). Non-admins never see the admin items.

### 1.4 About {server} (16a)
- **Who and how:** every member can open it; it's read-only. The dialog is 560px wide.
- **Header:** icon or initials, the name, and the address in monospace with a copy button (copying shows the toast "Server address copied"). Close is an × at the top right.
- **Three summary cards** in a three-column grid:
  - **Connection:** "Encrypted" or "Not encrypted". Take this from the TLS state `resolveConnectionTarget()` already decided.
  - **Latency:** in ms, with four signal bars. Under 40ms is Excellent (4 bars), under 90 Good (3), under 160 Slow (2), otherwise 1 bar. A ↻ button measures again, spinning while it does.
  - **People:** "{online} online of {total}" with a thin green bar. Count distinct people; a person with several identities counts once.
- **Admins:** chips with an avatar and an online dot. Clicking a chip opens that person's profile card. The current user's chip is suffixed "(you)".
- **Features:** a list of every toggle a server can have, each showing **On** or **Off**: Nudge, Screen sharing, Approval to join, Invite code required, Signed identity required. The header reads "{n} of {m} on". It updates live from `SERVER_SETTINGS_UPDATED`.

### 1.5 Server icon (12a–12d)
- **Where:** Server settings › General starts with an "Identity" row: the 56px icon preview, "Server icon", a note, and Upload / Change / Remove buttons.
- **The upload dialog** reuses the image half of the channel-icon dialog:
  - **Input:** drop or choose a file (PNG, JPEG, GIF or WebP, up to 1 MB, at least 256×256).
  - **Crop:** a square crop with a Zoom slider.
  - **Previews:** at 40px and 24px.
  - **Public-link notice:** an accent-tinted box headed "The icon gets a public link". It says the image is stored on the server but anyone with the link can open it; that Reson8 saves the link in each person's saved server list so the icon shows while disconnected; and not to use a private image. It shows the URL.
  - **Saving:** "Save icon" stays disabled until a file is chosen.
- **Without an icon,** every place the server appears (header, settings header, rail, saved list, About) shows its initials on `--color-accent-900`.

---

## 2. Channel tree

### 2.1 Rows
- **Text channel:** its icon (custom emoji or image, else `#`), the name, and an unread count pill. When the user can't read the channel, its name is shown faded at 0.5 opacity.
- **Voice channel:**
  - **Name:** the speaker icon and the name.
  - **Session timer** (§2.2), only while someone is in the channel.
  - **Count pill:** a 👤 icon and the number, in an 18px pill tinted 6%; tooltip "{n} people connected". Hidden when the channel is empty.
  - **Occupants** are listed below the channel.
- **Occupant row** (26px, indented 34px): avatar, name, the speaking halo, their mic-muted icon (red), and two local-only marks:
  - **"{n}%"** in monospace when you've set their volume to something other than 100%;
  - **a speaker-slash** when you've muted them locally.
- **Highlight ring:** the row whose menu is open gets an accent ring.

### 2.2 Session timer
- **Format:** `mm:ss`, switching to `h:mm:ss` from one hour; tabular numbers, 11px monospace.
- **What it measures:** how long the channel has continuously had at least one person in it.
- **Lifecycle:** it disappears when the channel empties, and restarts from zero when someone joins next.
- **Server dependency:** this needs a per-channel "occupied since" timestamp from the server. The existing `#voice-session-timer` is the user's own session in the voice dock, which is a different thing; see CODE_MAP.

### 2.3 Mute channel (personal)
- **Muted channel:** shown at 0.5 opacity, except while it's the channel you're viewing. It gets a bell-slash icon, shows **no unread count** in the tree, and its tab shows **no badge**.
- **Unmuting** brings its unread count back.
- **Opening a channel clears its unread count,** whether you open it from the tree or from its tab.

---

## 3. Context menus
All menus share one builder and the look described in README › Visual rules. A menu opens at the cursor and is clamped inside the window. It closes on outside click, Esc or scroll. The row it belongs to keeps an accent ring while it's open.

### 3.1 Text channel (6a)
1. Keep tab open / Stop keeping open
2. Mute channel / Unmute channel
3. Divider, then the "Manage channel" label (admins only from here on):
   - Rename… (6c)
   - Set icon… (6d emoji, 6e image)
   - Move to category… (6f)
   - Mark as NSFW / Unmark NSFW
4. Divider, then **Delete channel…** (6g)

### 3.2 Voice channel (7a)
"Manage channel" (admins): Rename…, Move to category…, a divider, then **Delete channel…**. There's no Keep open, Mute, Set icon or NSFW.

**Voice delete (7b):** the body text says "The {n} people in it will be disconnected." whenever anyone is in the channel. If you are in it yourself, you're returned to text chat.

### 3.3 Category (14a–14d)
- **Menu** (admins): the "Manage category" label, Rename category…, a divider, then **Delete category…**.
- **Rename** (14b), 400px dialog:
  - **Title and subtitle:** "Rename category", with the subtitle "Its channels stay where they are."
  - **Field:** the name is pre-selected, max 32 characters.
  - **Inline errors:** "Give the category a name." when empty, and "Another category is already called that." for a duplicate (case-insensitive).
  - **Keys and button:** Enter saves, Esc cancels. Rename is disabled while there's an error or the name is unchanged.
  - **State:** the category keeps its collapsed or expanded state.
- **Delete** (14c, 14d), 460px dialog:
  - **Title:** "Delete {name}?"
  - **When it has channels:** "It holds {x text channels} and {y voice channels}. Choose what happens to them." followed by two radio cards:
    - **Keep the channels** (the default, with an accent ring): they move to the top of the list, outside any category, and nothing is lost.
    - **Delete the channels too** (red ring): every message, pin and attachment in them is deleted for everyone, and this can't be undone.
  - **People in voice:** when people are in its voice channels, show the amber line "{n} people are in its voice channels right now and will be disconnected. This only applies if the channels are deleted."
  - **When empty:** "The category is empty, so nothing else changes."
  - **Confirm button:** "Delete category", or "Delete category and {n} channels" when the second option is chosen.
  - **Side effects:** deleting channels closes their tabs, disconnects their voice rooms, and closes the voice room tab if your room was among them.

### 3.4 Person in a voice channel (8a–8c)
- **Where:** the same menu opens from a tree occupant row and from a tile in the voice room tab.
- **Items:**
  - **Volume:** a slider from 0 to 200% in steps of 5, with a live "{n}%" readout and 0% / 100% / 200% ticks.
  - **Divider, then Mute locally / Unmute locally,** with the hint "Only for you".
  - **Divider, then the "Moderate" label and **Kick from channel**** (red). **Admins only;** members get the menu without this group. Kicking shows the toast "{name} was kicked from {channel}".
- **On yourself,** the menu shows only "Voice settings…".
- **Storage:** volume and local mute persist per user id (`reson8-local-volume-*` / `reson8-local-mute-*`, which already exist).

### 3.5 Tab (6b)
Keep open / Stop keeping open, Close tab, Close other tabs, Close tabs to the right. The Server Log tab can't be closed.

---

## 4. Tabs (13a, 13b, 6b, 9b)
- **Sources:** a text channel, a DM conversation, the voice room, or search results. **There is no "+" button.**
- **Preview tab:** at most one. Opening the next channel or DM **replaces** it in place, unless it was kept. A preview tab shows its label in italics.
- **Kept tab:** made by "Keep open" or by double-clicking the tab. It shows a pin icon, stays until closed, and is remembered per server (`reson8-kept-tabs` already exists).
- **DM tabs follow exactly the same preview and kept rules as channels.** This is a change: today DM tabs aren't preview tabs. A DM tab uses an `@` icon and the partner's name.
- **Voice room tab:**
  - **Only one exists,** because you can only be in one room. It never replaces another tab and is never replaced.
  - **It's optional.** It opens when you click "Expand voice room" in the voice dock (the dock button's tooltip) or click a voice channel in the tree.
  - **Its × closes the tab but keeps you connected.** If you were viewing it, you go to your first text tab.
- **Badges:**
  - **Unread count pill** on any channel or DM tab that isn't active.
  - **Muted channels:** their tab is faded to 0.55, shows a bell-slash, and has no badge.
  - **Unread labels** use weight 600 and `--color-neutral-100` text.
- **Overflow:**
  - **Collapsing:** tabs that don't fit in the bar collapse into an **"{n} more ▾"** button at the end of the bar.
  - **The active tab always stays visible.** If it would overflow, it swaps places with the last tab that fits.
  - **Unread hint:** a 7px accent dot on the button means a hidden tab has unread messages.
  - **The list:** a 260px dropdown headed "Open tabs that don't fit". Each row has the icon, the label, a pin if kept, the unread count, and × (if closable). Clicking a row opens that tab.
  - **Measure the real widths with ResizeObserver;** the mockup only estimates them.

---

## 5. Direct messages (1c, 9a, 9b)
- **DMs belong to the server you're connected to,** just like the channel tree. Another server means different people and a different history. With no server connected there are no DMs, and the button is disabled.
- **The DM rail button only swaps the sidebar** to the DM list. The main area stays exactly as it was; nothing opens until you click a person. The Servers button swaps it back.
- **List header:** "Direct messages", with "On {server name}" underneath (a server icon glyph and an explanatory tooltip). There is **no** compose button.
- **Who's listed:** every registered member except you, grouped into **Online — {n}** and **Offline — {n}**.
  - **Group notes:** Online reads "Everyone on this server · message or nudge"; Offline reads "Everyone on this server · they'll get your message when they sign in".
  - **Order:** within each group, people you've already messaged come first (most recent first), then everyone else alphabetically.
  - **Never-messaged people** show "No messages yet — start a conversation" in italics where the last-message preview would be.
- **Unread:**
  - **Row:** a count pill on the row.
  - **Tab:** a count on the DM's tab while it's in the background.
  - **Rail button:** a **total** on the DM rail button, excluding the conversation you're currently reading.
  - **Clearing:** reading a conversation clears its count. Keep the existing `markDmTabRead()` rule: the tab is active, the window has focus, and the page has rendered.
- **Clicking a row** opens that person's conversation in the preview tab (§4).

---

## 6. Voice room tab

### 6.1 Without screen shares (1f, 11a, 11b)
- **Header:** the room name, a "{n} / {cap}" count, and a **Mosaic | Featured** toggle.
- **Mosaic** (only when **nobody** is sharing): every person gets a tile. Tiles shrink together to fit the area without scrolling and keep a 4:3 ratio. On small tiles the name gets smaller and the volume readout is hidden.
- **Featured:**
  - **Tiles:** five full-size tiles, then a sixth block reading **"…and {n} more"**.
  - **The "more" list:** clicking the block opens a popover listing the remaining people (avatar, name, mute marks; right-click gives the §3.4 menu).
- **The user's choice persists.**
- **Tiles:**
  - **Contents:** the avatar with a speaking ring (green), the name (with "(you)" for yourself), the mic-muted icon, and the local-mute and volume marks (§2.1).
  - **What's not shown:** no "speaking / idle / ms" text and no codec chip.
  - **Right-click** opens §3.4.

### 6.2 One screen share (1b, 11d)
- **Forced layout:** the moment anyone shares, **Mosaic is disabled.** Its button is greyed out at 0.4 opacity with a not-allowed cursor and the tooltip "Mosaic is only available when no one is sharing a screen". The room switches to **Featured**, and the user's own choice comes back when the last stream ends.
- **Stage:** the stream fills the stage, with a LIVE badge, quality, and sharer + title. The controls at the top right are volume, Pop out and Fullscreen.
- **People** appear as a strip under the stage, showing **two full tiles plus the aggregator block**.
- **Streams play inside the app by default.** The separate window is an option, not the default.
- **Pop out (10a):** opens the existing Viewer window (`viewer.html`). Its title bar reads "{sharer} · {title} — {room}" and it has stream volume (0–200%), fullscreen, and **Always on top** (on by default). "Return to Reson8" and Close both bring the stream back. While popped out, the stage shows "{sharer}'s stream is in its own window" (top-left aligned), with **Bring it back** and **Show window** (which focuses or flashes the Viewer).

### 6.3 Multiple screen shares (15d, 15e): up to 5 per room
- **Header:** shows "{n} / 5 sharing" and a **Focus | Grid** toggle. The people toggle stays forced to Featured.
- **Focus** (the default):
  - **Main stream:** one stream large, with its LIVE badge, quality, and volume / Pop out / Fullscreen.
  - **Also live:** a 212px column on the right headed "Also live · {n}", holding the other streams as 16:9 live previews. Clicking a preview swaps it into the main slot.
- **Grid:** every stream at the same 16:9 size, fitted to the area. Double-click or the ⤢ button focuses one.
- **People** shrink to a single row of 44px name chips (avatar, name, mute and sharing icons) under the streams. When tiles in the strip are shorter than 90px, they use this single-row chip layout.
- **The 6th sharer:** Share screen reads "Share screen · 5/5". Clicking it shows the toast "All 5 stream slots are in use. You can share when someone stops." The cap **must be enforced by the server**; the client UI only explains it.

---

## 7. Server settings additions
- **General** gains the Identity / Server icon row (§1.5) above the existing Messages and Features groups.

---

## 8. Updates (4g, 15a–15c)

### 8.1 Settings › About, the update row
| State | Title | Note | Actions |
| --- | --- | --- | --- |
| idle | Updates | Last checked … | Check for updates |
| checking | Checking for updates… | (spinner icon) | (disabled) |
| up to date | You're up to date | {v} is the latest version · checked just now | Check for updates |
| available | Reson8 {next} is available, with a **New** tag | Released {date} · {size} · you have {v} | Release notes · **Update now** |
| downloading | Downloading {next}… | {pct}% of {size} · you can keep using Reson8, plus a 4px progress bar | (none) |
| ready | Update ready | Downloaded. Restart Reson8 to finish — it takes a few seconds. | **Restart to update** |

The gear in the rail shows the accent dot in the *available* and *ready* states (§1.1).

### 8.2 On launch (15b)
- **Not a blocking modal.** This replaces today's `#update-modal`: a 360px card in the bottom-right corner, above the status bar, with an accent edge and a soft glow.
- **Available:** "Reson8 {next} is available", a one-line summary, and "You have {v}." Buttons: What's new (ghost, left), Later, **Update**.
- **Downloading:** "Downloading Reson8 {next}…" with "You can keep chatting. We'll ask before restarting." and a progress bar with a percentage. The button is Hide.
- **Ready:** "Ready to restart". Buttons: On next launch, **Restart now**.
- **In a call:** while in a voice call, add an amber notice box: "Restarting drops you from **{room}** for a few seconds." Its icon aligns with the first line and the text wraps cleanly.
- **Dismissing:** × or Later only hides the card. The row in About (§8.1) keeps the state.

### 8.3 What's new (15c)
- **When it shows:** only on the **first launch of a newly installed version**, and **only before connecting to any server**, over the welcome screen. It never shows after sign-in.
- **Restarting the app** always lands on the welcome screen first.
- **Source:** the GitHub release body, fetched through the existing `api.fetchReleaseNotes()` and `reson8-last-seen-version` logic.
- **Layout:** a 600px dialog, at most 760px tall.
  - **Header:** a radial accent wash, the logo, a kicker ("Updated · you're on the new version"), "What's new in {v}", the date, and a "View on GitHub" link.
  - **Body:** scrolls. Sections from the release markdown keep their headings and bullets. Issue refs render as monospace accent chips.
  - **Footer:** "From the GitHub release. Shown once after each update; find it again in Settings › About." with a **Got it** button.
- **Reopening:** from Settings › About ("What's new in {v}"), or from "Release notes" for a pending update. In those cases the kicker reads "Release notes" or "Available update" and the button reads Close.
- **Marking as seen:** only Got it does that, as today. A backdrop click doesn't.
