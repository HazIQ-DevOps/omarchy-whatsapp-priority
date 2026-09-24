# Local WhatsApp bar changes

This installation is based on [srineshr1/omarchy-whatsapp](https://github.com/srineshr1/omarchy-whatsapp), version 1.1.0 (MIT license).

- Hover over the bar icon for a compact list of unread conversations, grouped by chat. Click the summary to open the same chat panel as a bar-icon click.
- Click the icon for the original keyboard-driven chat list, conversation view, and inline reply.
- In the panel, open Settings with the gear or `S`. Save one priority contact name. The bar indicator and that chat's badge are red while it has unread messages; other unread messages use green.
- `C` on a selected chat hides its preview in the current shell session until a newer message arrives. It does not mark the chat read in WhatsApp. `Enter` opens the chat and follows the upstream plugin's read-receipt behavior.
- The bridge sends all unread chat metadata separately from the recent-chat limit, so an older priority conversation still changes the indicator.
- The composer can paste a clipboard image, preview it, add a caption, and send it through the linked device after explicit confirmation. PNG, JPEG, and WebP images up to 12 MB are supported. Text paste continues to work normally.
- The dependency lockfile updates transitive `sharp` to 0.35.4, the patched version for [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), while keeping `baileys` at 6.7.24.

The linked-device bridge, chat storage, and reply behavior remain from the upstream project.
