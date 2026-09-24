# WhatsApp Priority for Omarchy

This is a shareable build of the [WhatsApp plugin for Omarchy](https://github.com/srineshr1/omarchy-whatsapp) with a grouped unread hover view, keyboard controls, and one priority sender. It uses WhatsApp's linked-device feature, so each person links **their own** account. No account or message data is in this archive.

## Install from GitHub

You need Omarchy 4 (Quattro), Node.js 20 or newer, and an internet connection for the daemon dependencies.

Run this in a terminal:

```sh
omarchy plugin add https://github.com/HazIQ-DevOps/omarchy-whatsapp-priority.git --enable
```

Omarchy will ask you to approve and enable the plugin. Click the WhatsApp icon in the bar and scan the QR code with your phone: **WhatsApp → Settings → Linked devices → Link a device**. The plugin sets up its daemon on first start.

For an offline source archive, extract it, enter the `omarchy-whatsapp-priority` directory, and run `./install.sh` instead.

This build uses the same plugin ID, `io.github.ricky.whatsapp`, as the upstream plugin. `omarchy plugin add` will refuse to install if it is already present. Review or back up that installation first. You can remove the old plugin with `omarchy plugin remove io.github.ricky.whatsapp`, then run the add command. The linked-device credentials and message cache are stored outside the plugin directory. The archive installer also supports `./install.sh --replace` after review.

## Use

Hover over the bar icon for an unread summary grouped by conversation. Click that summary to open or focus the full WhatsApp Web client. Click the bar icon itself to see the chat list and reply. Use `j`/`k` or arrow keys to select a chat, `Enter` to open it, and `Escape` to go back. Opening a chat marks it read on WhatsApp.

Press `S` in the chat list, or click the gear, to open Settings. Enter **one** priority sender name and save it. The bar indicator turns red while that sender has unread messages; ordinary unread messages keep it green. The same rule checks the most recent sender in a group chat. The name must match the sender's displayed name, ignoring case and extra spaces.

Press `C` on a selected chat to clear its preview from this plugin until a newer message arrives or the shell restarts. This does **not** delete or mark the chat read in WhatsApp. Right-click the icon for the full WhatsApp Web client.

## Privacy and provenance

Each installation creates its own linked-device credentials in `~/.local/state/omarchy-whatsapp/auth/` and a local message cache in `~/.local/state/omarchy-whatsapp/store.json`. Keep those private. This archive contains source code only. The bridge uses [Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial WhatsApp Web client.

Based on [srineshr1/omarchy-whatsapp](https://github.com/srineshr1/omarchy-whatsapp) at commit `0a9b19cbc7c6e376ecf4dc3d3229543620caecca`, under the included MIT [LICENSE](LICENSE). See [LOCAL_CHANGES.md](LOCAL_CHANGES.md) for changes in this build and [README.md](README.md) for detailed usage and troubleshooting.
