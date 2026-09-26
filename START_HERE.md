# WhatsApp Priority for Omarchy

This is a shareable build of the [WhatsApp plugin for Omarchy](https://github.com/srineshr1/omarchy-whatsapp) with a grouped unread hover view, keyboard controls, and one priority sender. It uses WhatsApp's linked-device feature, so each person links **their own** account. No account or message data is in this archive.

## Install from GitHub

You need Omarchy 4 (Quattro), Node.js 20 or newer, `qt6-multimedia`, and an internet connection for the daemon dependencies. Sending voice notes also needs `pipewire-audio` and `ffmpeg`. Copying received JPEG, WebP, or GIF images into other apps and generating thumbnails for previously downloaded videos also uses `ffmpeg`.

Run this in a terminal:

```sh
omarchy plugin add https://github.com/HazIQ-DevOps/omarchy-whatsapp-priority.git --enable
```

Omarchy will ask you to approve and enable the plugin. Click the WhatsApp icon in the bar and scan the QR code with your phone: **WhatsApp → Settings → Linked devices → Link a device**. The plugin sets up its daemon on first start.

For an offline source archive, extract it, enter the `omarchy-whatsapp-priority` directory, and run `./install.sh` instead.

This build uses the same plugin ID, `io.github.ricky.whatsapp`, as the upstream plugin. `omarchy plugin add` will refuse to install if it is already present. Review or back up that installation first. You can remove the old plugin with `omarchy plugin remove io.github.ricky.whatsapp`, then run the add command. The linked-device credentials and message cache are stored outside the plugin directory. The archive installer also supports `./install.sh --replace` after review.

To update an existing Git installation, run:

```sh
omarchy plugin update io.github.ricky.whatsapp --yes
~/.config/omarchy/plugins/io.github.ricky.whatsapp/bin/omarchy-whatsapp-setup
systemctl --user restart omarchy-whatsapp.service
omarchy restart shell
```

Omarchy updates the plugin files, but it does not restart the background WhatsApp service. Check the installed version with `jq -r .version ~/.config/omarchy/plugins/io.github.ricky.whatsapp/manifest.json`.

## Use

Hover over the bar icon for a preview with individuals first and groups in a collapsed **Groups** section. Click the Groups row to expand it, or click a contact to open that chat. The click-open panel has the same split; select Groups with the arrow keys and press `Enter` to expand. Archived chats are excluded from both views and from the main panel's search. Search still finds matching groups even while the section is collapsed. Use `j`/`k` or arrow keys to select a chat, `Enter` to open it, and `Escape` to go back. Opening a chat marks it read on WhatsApp. Right-click the bar icon for the full WhatsApp Web client.

The Groups heading shows how many unread messages are in its visible groups, including muted groups. Archived and locally hidden groups are excluded. Audio and video playback follows the current system output, so changing the default to a Bluetooth speaker also changes the plugin's output.

Press `S` in the chat list, or click the gear, to open Settings. Enter **one** priority sender name and save it. The bar indicator turns red while that sender has unread messages; ordinary unread messages keep it green. The same rule checks the most recent sender in a group chat. The name must match the sender's displayed name, ignoring case and extra spaces.

Press `C` on a selected chat to clear its preview from this plugin until a newer message arrives or the shell restarts. This does **not** delete or mark the chat read in WhatsApp. Right-click the icon for the full WhatsApp Web client.

In a conversation, press `Ctrl+V` to attach a copied PNG, JPEG, or WebP image (up to 12 MB). Check the preview, optionally type a caption, then press `Enter` or click Send. `Escape` or the × button removes the pending image without sending it. Plain text still pastes normally.

Click the microphone or press `Ctrl+Shift+R` to record a voice note. Click Stop or press the shortcut again, play the preview, then click Send. Press `Escape` or × to discard it. Recording stops after three minutes, and the note is never sent automatically.
If the note is silent, open Settings and choose the microphone that picks up your voice. This selection affects only this plugin and survives shell restarts and plugin updates.

Click a message bubble, or press `Ctrl+Up` from the reply box, to select a message. Use arrows to move between messages. Press `R` for a quoted reply, `F` to forward it to a searched contact, or `A` to react. Press `0` to remove your reaction. For your own text, click its pencil icon or select it and press `E` to edit. The draft stays in the composer until WhatsApp confirms the edit; errors leave it available to retry. Press `D` to delete a message for yourself, or `X` to delete your own message for everyone; both delete actions ask for confirmation. Select a received video and press `V` to play it, or click its tile. In the viewer, use Space to pause, Left/Right to seek, and Escape to close. Click a voice note or select it and press `P` to play or pause it in chat. Click a document or select it and press `S` to save it to Downloads. Forwarding in this panel supports text, images, and stickers with their original media data. Use the full WhatsApp client for other media types.

The chat loads up to 200 locally stored messages. Click the magnifying glass in an open chat, press `/` with a message selected, or press `Ctrl+F` from the composer to search that conversation's cached message text. Choose a result to jump to and highlight it. Click the grid icon, press `G` with a message selected, or press `Ctrl+G` from the composer to browse locally cached photos, videos, documents, and audio in a larger window; arrows and Enter navigate it. These views do not fetch older WhatsApp history or download media that is not already cached.

Video bubbles and the local media grid show poster frames when WhatsApp supplies one or the video is already cached. Document bubbles and gallery tiles show type icons for archives, PDFs, spreadsheets, and other common files. Links sent in text get a WhatsApp preview when the linked website supplies metadata; a normal link is still sent if no preview is available.

Click the copy icon at the top-right of a bubble to copy a text message or an image/sticker. An image downloads first if needed. Press `C` on a selected message for the same action. For an image with a caption, copy selects the image. The external-link icon in the header opens the full WhatsApp Web client.

## Privacy and provenance

Each installation creates its own linked-device credentials in `~/.local/state/omarchy-whatsapp/auth/` and a local message cache in `~/.local/state/omarchy-whatsapp/store.json`. Keep those private. This archive contains source code only. The bridge uses [Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial WhatsApp Web client.

Based on [srineshr1/omarchy-whatsapp](https://github.com/srineshr1/omarchy-whatsapp) at commit `0a9b19cbc7c6e376ecf4dc3d3229543620caecca`, under the included MIT [LICENSE](LICENSE). See [LOCAL_CHANGES.md](LOCAL_CHANGES.md) for changes in this build and [README.md](README.md) for detailed usage and troubleshooting.
