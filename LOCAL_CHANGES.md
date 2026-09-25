# Local WhatsApp bar changes

This installation is based on [srineshr1/omarchy-whatsapp](https://github.com/srineshr1/omarchy-whatsapp), version 1.1.0 (MIT license).

- Hover over the bar icon for separated conversation cards. Click a contact's card to open that chat directly, or use the heading/footer to open the full chat list.
- Click the icon for the original keyboard-driven chat list, conversation view, and inline reply.
- In the panel, open Settings with the gear or `S`. Save one priority contact name. The bar indicator and that chat's badge are red while it has unread messages; other unread messages use green.
- `C` on a selected chat hides its preview in the current shell session until a newer message arrives. It does not mark the chat read in WhatsApp. `Enter` opens the chat and follows the upstream plugin's read-receipt behavior.
- The bridge sends all unread chat metadata separately from the recent-chat limit, so an older priority conversation still changes the indicator.
- The composer can paste a clipboard image, preview it, add a caption, and send it through the linked device after explicit confirmation. PNG, JPEG, and WebP images up to 12 MB are supported. Text paste continues to work normally.
- Received videos and video notes play in a full-screen Qt viewer with pause, seek, and keyboard controls. The bridge downloads a video only when opened, caps it at 100 MB, and asks the linked phone to resend media details for older video entries when possible.
- Voice notes and other audio play in the chat bubble with pause and seek controls. Documents save to Downloads on request, keeping the sender's safe filename without overwriting an existing file. Audio is limited to 50 MB and documents to 200 MB; older entries request missing media details from the linked phone.
- Search chats by name, group sender, or number from the top of the chat list (`/` focuses search). The hover card's search button opens it directly.
- Use the emoji picker (`Ctrl+E`, arrows, `Enter`) or typed shortcuts such as `:)`, `:D`, `LOL`, and `<3` in replies and captions.
- Outgoing messages use the phone JID when an internal linked-device ID has a known phone mapping. libsignal session dumps are redacted before reaching the local journal.
- Baileys is pinned to 7.0.0-rc14 for PN/LID session migration and session recovery. Contact mapping uses the current protocol fields and mapping API. The lockfile uses npm registry packages, including libsignal; startup detects outdated installed versions.
- Original outgoing protobuf payloads are retained in a private, bounded retry cache so resends remain accurate across restarts. Offline tests cover real Signal encryption through an address change and restart, and exact retry payload preservation for text, quotes, images, reactions, edits, and revokes.

The linked-device bridge, chat storage, and reply behavior remain from the upstream project.
