# Changelog

## 1.3.2

- Add experimental outgoing and incoming one-to-one voice calls using the existing WhatsApp login.
- Resolve the selected contact's number automatically; provide optional manual dialing.
- Add caller details, Answer, Decline, mute, hang up, and elapsed call time.
- Open the call panel and show a desktop notification for incoming calls.
- Handle caller cancellation and calls answered on another device.
- Fix native LID encoding and avoid treating incoming offer events as hang-up.
- Clear microphone shutdown errors after hang-up and restore reply focus.
- Restore image paste through Ctrl+V, Ctrl+Shift+V, Shift+Insert and Omarchy's Super+V route.
- Pin native calling dependencies and include compiled calling code for installation without a TypeScript build.

Live verification on the maintainer's installation: outgoing call, incoming pickup, mute, hang up, and decline all passed. Incoming ringing expires after 60 seconds; calls have a ten-minute limit. Video and group calls are unsupported.

### Updating an existing Git installation

```sh
omarchy plugin update io.github.ricky.whatsapp --yes
~/.config/omarchy/plugins/io.github.ricky.whatsapp/bin/omarchy-whatsapp-setup
systemctl --user restart omarchy-whatsapp.service
omarchy restart shell
```

Credentials and message history remain in their existing state directory.
