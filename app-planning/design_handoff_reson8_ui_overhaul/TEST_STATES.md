# Test states

Each study frame is a state the real app must reach. Verify each one by hand, or headless with the repo's CDP recipe (`apps/client/AGENTS.md` › "Driving the real app headlessly"), and take a screenshot of each.

## Shell, connecting
- [ ] **2a:** first launch shows the empty connect form and no saved servers.
- [ ] **2b:** returning shows the saved servers with icons (offline). Connect runs the probe → sign-in steps.
- [ ] **3a:** connection failed: an error is shown, Try again works, and editing the address works.
- [ ] **3b:** password required: the flow pauses at sign-in and asks for the password.
- [ ] **3c:** the NSFW channel prompt appears on opening an NSFW channel.
- [ ] **1d:** the title-bar pill opens the server switcher.
- [ ] **1e:** the server dropdown: non-admins see only About and Copy address.
- [ ] **16a:** About shows the encryption state, latency (re-measure works), "{online} of {total}" matching the header count, admin chips that open profiles, and the feature On/Off list updating live after a toggle in Server settings.
- [ ] **12a–12d:** server icon upload, crop, and save. The icon appears in the header, rail and saved list, and still shows after disconnecting. Remove falls back to initials.

## Channel tree, menus
- [ ] **6a:** the text channel menu, admin vs. member (members don't see "Manage channel").
- [ ] **6b:** the tab menu: Keep open, Close, Close others, Close to the right.
- [ ] **6c:** rename: the name is pre-selected, empty and duplicate names are refused, Enter saves and Esc cancels.
- [ ] **6d / 6e:** set icon, emoji and image (crop).
- [ ] **6f:** move to category.
- [ ] **6g:** delete text channel; its tab closes for everyone.
- [ ] **7a / 7b:** voice channel menu; delete with people inside disconnects them, and the body states how many.
- [ ] **14a–14d:** category menu, rename, delete keeping channels (they move to top level), delete with channels (tabs close, voice disconnects).
- [ ] **8a / 8b / 8c:** occupant menu from the tree and from a tile; the volume persists across a restart; local mute shows the mark; Kick is admin-only; on yourself only Voice settings appears.
- [ ] The muted channel is faded, shows no count in the tree, no tab badge, and the bell-slash. Unmuting restores the count.
- [ ] The voice session timer ticks, hides when the channel is empty, and restarts from 0.
- [ ] The voice count pill hides when the channel is empty.

## Tabs
- [ ] Opening channel A, then channel B, replaces A's preview tab in place.
- [ ] Double-click or Keep open makes a tab permanent, and it's restored after restart.
- [ ] **9b:** a DM opens in the preview tab and opening another DM or channel replaces it; a kept DM survives.
- [ ] **13a:** the voice tab appears only via Expand or a voice-row click; × closes it and you stay connected; there's never a second voice tab.
- [ ] **13b:** overflow: the "{n} more" list, the active tab always visible, the unread dot on the button, and closing from the list.
- [ ] There's no "+" in the tab bar.

## DMs
- [ ] **9a:** the DM rail button swaps the sidebar only; the main area is unchanged.
- [ ] Every registered member is listed in Online / Offline; never-messaged people show "No messages yet" in italics.
- [ ] Unread counts appear on the row, on the background tab and as the rail total; reading clears them (using the `markDmTabRead()` focus rule).
- [ ] With no server connected, the DM button is disabled.
- [ ] Switching servers shows a different DM list.

## Voice room
- [ ] **1f / 11a:** Mosaic, voice-only: a full room (16) fits without scrolling.
- [ ] **11b:** Featured: five tiles plus "…and n more", and the popover lists the rest.
- [ ] **11d:** someone starts sharing → Featured is forced and Mosaic is disabled with its tooltip; the stream ends → the previous choice returns.
- [ ] **1b:** single-share stage: LIVE, volume, Pop out, Fullscreen.
- [ ] **10a:** pop out: always-on-top defaults to on; Return and Close bring the stream back; the stage placeholder is visible and not covered.
- [ ] **15d:** five sharers, Focus: clicking a preview swaps it into the main slot; people show as chips.
- [ ] **15e:** Grid: double-click focuses a stream.
- [ ] A 6th person trying to share gets the server error and the toast; the button shows "5/5".

## Updates
- [ ] **4g / 15a:** About row: available → Update now → downloading (progress) → Restart to update. The gear dot shows in the available and ready states.
- [ ] **15b:** the launch card is non-blocking; Later hides it; the in-call amber note shows while connected to voice.
- [ ] **15c:** after updating, What's new shows over the welcome screen before connecting, and never after sign-in. Got it marks it seen; a backdrop click doesn't.
- [ ] A failed download shows the error with a manual-download hint.

## Settings (restyle only)
- [ ] **4a–4h:** each client settings page.
- [ ] **5a–5f:** each server settings page.
