# Test states

Each study frame is a state the real app must reach. Verify each one by hand, or headless with the repo's CDP recipe (`apps/client/AGENTS.md` › "Driving the real app headlessly"), and take a screenshot of each.

**Sweep of 14/10/2026 (3.0.0-beta.2, Windows 11, dev build):** every line below was driven in the real Electron client over CDP — two to six app instances, Socket.io bots for crowds, the dev servers on 9800 (open) and 9801 (password), and a third server on its own database for the per-server DM list. A screenshot was taken for every state (kept locally, not committed). Three failures were found and fixed in the same pass (6c, the "5/5" label, the failed-download row); they are marked below. Not covered here, and tracked in PRD 20: macOS and Linux (V2), stream sound and a second machine (V1), real updates from a published release (U1–U3).

## Shell, connecting
- [x] **2a:** first launch shows the empty connect form and no saved servers.
- [x] **2b:** returning shows the saved servers with icons (offline). Connect runs the probe → sign-in steps. *(Locally the steps finish in under 250 ms, too fast to capture mid-way; the failed/paused states below show the same card.)*
- [x] **3a:** connection failed: an error is shown, Try again works, and editing the address works.
- [x] **3b:** password required: the flow pauses at sign-in and asks for the password. *(A wrong password is refused in the dialog; the right one connects and is remembered.)*
- [x] **3c:** the NSFW channel prompt appears on opening an NSFW channel.
- [x] **1d:** the title-bar pill opens the server switcher.
- [x] **1e:** the server dropdown: non-admins see only About and Copy address.
- [x] **16a:** About shows the encryption state, latency (re-measure works), "{online} of {total}" matching the header count, admin chips that open profiles, and the feature On/Off list updating live after a toggle in Server settings.
- [x] **12a–12d:** server icon upload, crop, and save. The icon appears in the header, rail and saved list, and still shows after disconnecting. Remove falls back to initials.

## Channel tree, menus
- [x] **6a:** the text channel menu, admin vs. member (members don't see "Manage channel").
- [x] **6b:** the tab menu: Keep open, Close, Close others, Close to the right.
- [x] **6c:** rename: the name is pre-selected, empty and duplicate names are refused, Enter saves and Esc cancels. *(Fixed in this sweep: Enter and Esc did nothing and duplicates were accepted. Now an inline error, a disabled Rename button, and a duplicate check against the same-type channels in the same list, ignoring case.)*
- [x] **6d / 6e:** set icon, emoji and image (crop).
- [x] **6f:** move to category.
- [x] **6g:** delete text channel; its tab closes for everyone.
- [x] **7a / 7b:** voice channel menu; delete with people inside disconnects them, and the body states how many.
- [x] **14a–14d:** category menu, rename, delete keeping channels (they move to top level), delete with channels (tabs close, voice disconnects).
- [x] **8a / 8b / 8c:** occupant menu from the tree and from a tile; the volume persists across a restart; local mute shows the mark; Kick is admin-only; on yourself only Voice settings appears.
- [x] The muted channel is faded, shows no count in the tree, no tab badge, and the bell-slash. Unmuting restores the count.
- [x] The voice session timer ticks, hides when the channel is empty, and restarts from 0.
- [x] The voice count pill hides when the channel is empty.

## Tabs
- [x] Opening channel A, then channel B, replaces A's preview tab in place.
- [x] Double-click or Keep open makes a tab permanent, and it's restored after restart.
- [x] **9b:** a DM opens in the preview tab and opening another DM or channel replaces it; a kept DM survives.
- [x] **13a:** the voice tab appears only via Expand or a voice-row click; × closes it and you stay connected; there's never a second voice tab.
- [x] **13b:** overflow: the "{n} more" list, the active tab always visible, the unread dot on the button, and closing from the list.
- [x] There's no "+" in the tab bar.

## DMs
- [x] **9a:** the DM rail button swaps the sidebar only; the main area is unchanged.
- [x] Every registered member is listed in Online / Offline; never-messaged people show "No messages yet" in italics.
- [x] Unread counts appear on the row, on the background tab and as the rail total; reading clears them (using the `markDmTabRead()` focus rule).
- [x] With no server connected, the DM button is disabled.
- [x] Switching servers shows a different DM list. *(The 9800 and 9801 dev servers share one database, so this was checked against a third server on its own database.)*

## Voice room
- [x] **1f / 11a:** Mosaic, voice-only: a full room (16) fits without scrolling.
- [x] **11b:** Featured: five tiles plus "…and n more", and the popover lists the rest.
- [x] **11d:** someone starts sharing → Featured is forced and Mosaic is disabled with its tooltip; the stream ends → the previous choice returns.
- [x] **1b:** single-share stage: LIVE, volume, Pop out, Fullscreen. *(The picture rendered on this machine; stream sound and a second machine are PRD 20 V1.)*
- [x] **10a:** pop out: always-on-top defaults to on; Return and Close bring the stream back; the stage placeholder is visible and not covered.
- [x] **15d:** five sharers, Focus: clicking a preview swaps it into the main slot; people show as chips. *(At 1440×900 the people strip has room for full tiles; it switches to chips only when a tile would be under 90 px tall, as designed.)*
- [x] **15e:** Grid: double-click focuses a stream.
- [x] A 6th person trying to share gets the server error and the toast; the button shows "5/5". *(Fixed in this sweep: the icon-only button showed "5/5" only in its tooltip; it now shows a visible "5/5" while the room is full.)*

## Updates
- [x] **4g / 15a:** About row: available → Update now → downloading (progress) → Restart to update. The gear dot shows in the available and ready states. *(Progress and ready were driven through the renderer's own update handlers; a real download needs a published release, PRD 20 U1.)*
- [x] **15b:** the launch card is non-blocking; Later hides it; the in-call amber note shows while connected to voice.
- [x] **15c:** after updating, What's new shows over the welcome screen before connecting, and never after sign-in. Got it marks it seen; a backdrop click doesn't. *(Checked with v2.7.0's published notes; v3.0.0-beta.1 has no GitHub release yet.)*
- [x] A failed download shows the error with a manual-download hint. *(Fixed in this sweep: the main process sent the error twice, and the About row then said "Couldn't check for updates". It now says "Couldn't download {version}" with the manual-download hint; a failed check keeps its own wording.)*

## Settings (restyle only)
- [x] **4a–4h:** each client settings page. *(All 7 pages at 1440×900 and 1024×680: no horizontal scroll, nothing outside the panel.)*
- [x] **5a–5f:** each server settings page. *(All 7 pages, Identity log included, at both sizes.)*

## Revision 2 (Turn 17)
- [ ] **17a:** connected to a server, not in a room: the card shows "Disconnected" in yellow, no second line, Mute and Deafen with working device menus, and no Share, Leave or Expand.
- [ ] **17a:** you're not listed in any room in the tree, and room counts don't include you.
- [ ] **17b:** join a room: the card turns green with the full controls. Leave: back to 17a at once, with no layout jump.
- [ ] Mute while disconnected, then join: you join muted. The same goes for Deafen.
- [ ] Kicked from a room: the card goes to Disconnected (not hidden).
- [ ] Leave while viewing the voice room tab: the tab closes and the first text tab shows.
- [ ] Not connected to any server: no card.
- [ ] **17c:** App settings: the category menu is frosted purple glass over a soft glow, with a lit right edge. The content side is unchanged.
- [ ] **17d:** Server settings: the same treatment. The nav scrolls and clicks normally.