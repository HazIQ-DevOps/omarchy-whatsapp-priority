import QtQuick
import QtQuick.Controls
import QtMultimedia
import Quickshell
import Quickshell.Wayland
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// The WhatsApp surface: chat list, conversation, inline reply, and the QR
// pairing screen. Loaded by BarWidget.qml, which injects `bar`, `anchorItem`,
// `hostWidget`, and the shared `client`.
Panel {
  id: root
  moduleName: "io.github.ricky.whatsapp"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  property var client: null
  property string pluginDir: ""

  // "chats" | "chat" | "forward" | "settings"; login replaces chats while unlinked.
  property string view: "chats"
  property string activeJid: ""
  property var activeChat: null
  property var messages: []
  property int cursorIndex: 0
  property string statusLine: ""
  property bool pinToLatest: true
  property bool logoutConfirmOpen: false
  property bool refreshing: false
  property string peekImagePath: ""
  property string peekVideoPath: ""
  property string videoError: ""
  property string pendingMediaMessageId: ""
  property string activeAudioMessageId: ""
  property string audioPath: ""
  readonly property bool peekActive: peekImagePath.length > 0 || peekVideoPath.length > 0
  property string pendingImagePath: ""
  property string pendingImageMime: ""
  property string pendingImageJid: ""
  property string pasteRequestJid: ""
  property bool imageSending: false
  property string voiceState: "idle" // preparing, recording, stopping, converting, ready, sending
  property string voiceRecordPath: ""
  property string pendingVoicePath: ""
  property string pendingVoiceJid: ""
  property int voiceSeconds: 0
  property double voiceStartedAt: 0
  property string searchQuery: ""
  property bool groupsExpanded: false
  property bool emojiPickerOpen: false
  property int emojiCursorIndex: 0
  property string selectedMessageId: ""
  property string quotedMessageId: ""
  property string editingMessageId: ""
  property string forwardingMessageId: ""
  property string forwardingFromJid: ""
  property bool reactionMode: false
  property bool deleteConfirmOpen: false
  property bool deleteForEveryone: false
  readonly property var emojiChoices: ["🙂", "😄", "😂", "😉", "🙁", "😢", "😮", "😛", "❤️", "👍", "🎉", "🙏"]

  readonly property var chats: client ? client.chats : []
  readonly property bool daemonOnline: client ? client.daemonOnline : false
  readonly property bool needsLogin: client ? client.needsLogin === true : false
  readonly property bool pairingPaused: client ? client.pairingStopped === true : false
  readonly property bool hasQr: client ? client.hasQr === true : false
  readonly property bool linked: client ? client.signedIn : false
  readonly property bool showLogin: needsLogin && view !== "settings"
  readonly property string fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
  // Popup content must use the theme foreground. barForeground can switch to
  // a wallpaper-contrast color when the bar is transparent, which may be dark
  // even though the popup surface remains dark.
  readonly property color foreground: root.bar ? root.bar.foreground : Color.foreground
  readonly property color secondaryForeground: Qt.darker(root.foreground, 1.5)
  readonly property int chatLimit: root.setting("chatLimit", 40)
  readonly property int messageLimit: root.setting("messageLimit", 60)

  function open() { root.controller.show() }
  function close() { root.controller.hide() }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.hostWidget || root, direction)
    return false
  }

  function chatAt(index) {
    var list = root.visibleChats
    if (index < 0 || index >= list.length) return null
    return list[index].isGroupHeader ? null : list[index]
  }

  readonly property int inboxFetchLimit: Math.max(200, root.chatLimit * 4)

  readonly property var visibleChats: {
    var epoch = root.client ? root.client.chatsEpoch : 0
    var list = root.client && root.client.attentionChats ? root.client.attentionChats.slice() : []
    var recent = root.chats || []
    for (var i = 0; i < recent.length; i++) {
      if (!recent[i] || list.some(function(chat) { return chat.jid === recent[i].jid })) continue
      list.push(recent[i])
    }
    if (epoch < 0) return []
    return Model.inboxRows(list, root.view, root.searchQuery, root.groupsExpanded,
      root.chatLimit, function(chat) {
        return root.hostWidget && root.hostWidget.isChatDismissed
          ? root.hostWidget.isChatDismissed(chat) : false
      })
  }
  readonly property int groupHeaderIndex: root.visibleChats.findIndex(function(chat) { return chat.isGroupHeader })
  readonly property var visibleIndividualChats: root.groupHeaderIndex < 0
    ? root.visibleChats : root.visibleChats.slice(0, root.groupHeaderIndex)
  readonly property var visibleGroupChats: root.groupHeaderIndex < 0
    ? [] : root.visibleChats.slice(root.groupHeaderIndex + 1)

  onSearchQueryChanged: {
    root.cursorIndex = 0
    if (chatList) chatList.positionViewAtBeginning()
  }

  function focusSearch() {
    if (root.view !== "chats" && root.view !== "forward") root.back()
    if (root.client) root.client.requestChats(root.inboxFetchLimit)
    Qt.callLater(function () { searchField.forceActiveFocus() })
  }

  function insertEmoji(value) {
    if (!value || root.view !== "chat") return
    if (root.reactionMode) {
      if (root.client && root.selectedMessageId)
        root.client.reactToMessage(root.activeJid, root.selectedMessageId, value)
      root.reactionMode = false
      root.emojiPickerOpen = false
      root.selectedMessageId = ""
      keyCatcher.forceActiveFocus()
      return
    }
    var at = composer.cursorPosition
    composer.insert(at, value)
    composer.cursorPosition = at + value.length
    root.emojiPickerOpen = false
    composer.forceActiveFocus()
  }

  function toggleEmojiPicker() {
    root.emojiPickerOpen = !root.emojiPickerOpen
    if (root.emojiPickerOpen) {
      root.emojiCursorIndex = 0
      Qt.callLater(function () { emojiGrid.forceActiveFocus() })
    } else {
      root.reactionMode = false
      composer.forceActiveFocus()
    }
  }

  function expandComposerShorthand() {
    var at = composer.cursorPosition
    var before = composer.text.slice(0, at)
    if (!/\s$/.test(before)) return
    var expanded = Model.expandEmoticons(before)
    if (expanded === before) return
    composer.text = expanded + composer.text.slice(at)
    composer.cursorPosition = expanded.length
  }

  function clearSelectedChat() {
    if (root.view !== "chats" || !root.hostWidget || !root.hostWidget.dismissChat) return
    var chat = root.chatAt(root.cursorIndex)
    if (!chat) return
    root.hostWidget.dismissChat(chat)
    root.cursorIndex = Math.max(0, Math.min(root.cursorIndex, root.visibleChats.length - 1))
  }

  // Point the panel at a chat without touching read state. Used by the focus
  // broadcast: a notification must not clear the unread badge before the panel
  // is actually on screen. onOpenedChanged marks it read once it is.
  function prepareChat(jid) {
    if (!jid || !root.client) return
    root.emojiPickerOpen = false
    root.activeJid = jid
    root.activeChat = null
    root.messages = []
    root.pendingMediaMessageId = ""
    root.stopAudio()
    root.selectedMessageId = ""
    root.quotedMessageId = ""
    root.editingMessageId = ""
    root.pinToLatest = true
    root.view = "chat"
    root.client.loadMessages(jid, root.messageLimit)
  }

  // User-initiated open: marks the chat read and puts the cursor in the reply box.
  function selectChat(jid) {
    root.prepareChat(jid)
    if (!root.client) return
    root.client.markRead(jid)
    Qt.callLater(function () { composer.forceActiveFocus() })
  }

  function back() {
    if (root.view === "forward") {
      root.view = "chat"
      root.searchQuery = ""
      Qt.callLater(function () { keyCatcher.forceActiveFocus() })
      return
    }
    root.emojiPickerOpen = false
    root.selectedMessageId = ""
    root.quotedMessageId = ""
    root.editingMessageId = ""
    root.view = "chats"
    root.activeJid = ""
    root.activeChat = null
    root.messages = []
    root.pendingMediaMessageId = ""
    root.stopAudio()
    composer.text = ""
    Qt.callLater(function () { keyCatcher.forceActiveFocus() })
  }

  function closePeek() {
    peekVideoPlayer.stop()
    root.peekImagePath = ""
    root.peekVideoPath = ""
    root.videoError = ""
  }

  function viewVideo(message) {
    if (!message || !root.client || !root.activeJid) return
    if (message.videoPath) {
      root.peekImagePath = ""
      root.videoError = ""
      root.peekVideoPath = message.videoPath
      return
    }
    if (root.pendingMediaMessageId === message.id) return
    root.pendingMediaMessageId = message.id
    root.statusLine = "Downloading video…"
    if (!root.client.downloadMedia(root.activeJid, message.id)) {
      root.pendingMediaMessageId = ""
      root.statusLine = "WhatsApp is not connected"
    }
  }

  function stopAudio() {
    voicePlayer.stop()
    root.activeAudioMessageId = ""
    root.audioPath = ""
  }

  function toggleAudio(message) {
    if (!message || !root.client || !root.activeJid) return
    if (message.audioPath) {
      if (root.activeAudioMessageId === message.id) {
        if (voicePlayer.playbackState === MediaPlayer.PlayingState) voicePlayer.pause()
        else voicePlayer.play()
      } else {
        voicePlayer.stop()
        root.activeAudioMessageId = message.id
        root.audioPath = message.audioPath
      }
      return
    }
    if (root.pendingMediaMessageId === message.id) return
    root.pendingMediaMessageId = message.id
    root.statusLine = "Downloading audio…"
    if (!root.client.downloadMedia(root.activeJid, message.id)) {
      root.pendingMediaMessageId = ""
      root.statusLine = "WhatsApp is not connected"
    }
  }

  function downloadDocument(message) {
    if (!message || !root.client || !root.activeJid) return
    if (message.documentPath) {
      root.statusLine = "Saved to " + message.documentPath
      return
    }
    if (root.pendingMediaMessageId === message.id) return
    root.pendingMediaMessageId = message.id
    root.statusLine = "Downloading document…"
    if (!root.client.downloadMedia(root.activeJid, message.id)) {
      root.pendingMediaMessageId = ""
      root.statusLine = "WhatsApp is not connected"
    }
  }

  function playbackTime(milliseconds) {
    var seconds = Math.floor(Math.max(0, milliseconds || 0) / 1000)
    var remainder = seconds % 60
    return Math.floor(seconds / 60) + ":" + (remainder < 10 ? "0" : "") + remainder
  }

  function openSettings() {
    priorityField.text = String(root.setting("priorityName", "") || "")
    root.view = "settings"
    Qt.callLater(function () { priorityField.forceActiveFocus() })
  }

  function savePriorityName() {
    var name = String(priorityField.text || "").trim().replace(/\s+/g, " ").slice(0, 120)
    var entry = { id: root.moduleName }
    for (var key in root.settings) if (key !== "id") entry[key] = root.settings[key]
    entry.priorityName = name
    root.settings = entry
    if (root.hostWidget) root.hostWidget.settings = entry
    if (root.bar && root.bar.shell && typeof root.bar.shell.updateEntryInline === "function")
      root.bar.shell.updateEntryInline(root.moduleName, entry)
    root.view = "chats"
    root.statusLine = name ? "Priority sender saved" : "Priority sender cleared"
    Qt.callLater(function () { keyCatcher.forceActiveFocus() })
  }

  function requestLogout() {
    logoutConfirm.selectedIndex = 1
    root.logoutConfirmOpen = true
    Qt.callLater(function () { logoutConfirm.forceActiveFocus() })
  }

  function cancelLogout() {
    root.logoutConfirmOpen = false
    Qt.callLater(function () { keyCatcher.forceActiveFocus() })
  }

  function confirmLogout() {
    root.logoutConfirmOpen = false
    if (root.client) root.client.logout()
    root.back()
    root.statusLine = ""
  }

  function moveCursor(delta) {
    if (root.view === "chat" && root.selectedMessageId) {
      var index = root.messages.findIndex(function(message) { return message.id === root.selectedMessageId })
      var nextMessage = Math.max(0, Math.min(root.messages.length - 1, index + delta))
      if (root.messages[nextMessage]) {
        root.selectedMessageId = root.messages[nextMessage].id
        messageList.positionViewAtIndex(nextMessage, ListView.Contain)
      }
      return
    }
    if (root.view !== "chats" && root.view !== "forward") return
    var count = root.visibleChats.length
    if (count === 0) return
    var next = root.cursorIndex + delta
    if (next < 0) next = 0
    if (next > count - 1) next = count - 1
    root.cursorIndex = next
    if (root.groupHeaderIndex >= 0 && next > root.groupHeaderIndex)
      groupList.positionViewAtIndex(next - root.groupHeaderIndex - 1, ListView.Contain)
    else if (next < root.groupHeaderIndex || root.groupHeaderIndex < 0)
      chatList.positionViewAtIndex(next, ListView.Contain)
  }

  function activateCursor() {
    if (root.view !== "chats" && root.view !== "forward") return
    var row = root.visibleChats[root.cursorIndex]
    if (row && row.isGroupHeader) {
      root.groupsExpanded = !root.groupsExpanded
      return
    }
    var chat = root.chatAt(root.cursorIndex)
    if (chat) {
      if (root.view === "forward") root.forwardTo(chat.jid)
      else root.selectChat(chat.jid)
    }
  }

  function selectedMessage() {
    return root.messages.find(function(message) { return message.id === root.selectedMessageId }) || null
  }

  function quotedMessage() {
    return root.messages.find(function(message) { return message.id === root.quotedMessageId }) || null
  }

  function selectMessage(id) {
    root.selectedMessageId = id
    keyCatcher.forceActiveFocus()
  }

  function startReply() {
    if (!root.selectedMessage() || root.selectedMessage().deleted) return
    root.quotedMessageId = root.selectedMessageId
    root.editingMessageId = ""
    root.selectedMessageId = ""
    composer.forceActiveFocus()
  }

  function startForward() {
    if (!root.selectedMessage() || root.selectedMessage().deleted) return
    root.forwardingMessageId = root.selectedMessageId
    root.forwardingFromJid = root.activeJid
    root.view = "forward"
    root.searchQuery = ""
    root.cursorIndex = 0
    if (root.client) root.client.requestChats(root.inboxFetchLimit)
    Qt.callLater(function () { searchField.forceActiveFocus() })
  }

  function forwardTo(jid) {
    if (!root.client || !root.client.ready || !root.forwardingMessageId) return
    if (root.client.forwardMessage(root.forwardingFromJid, root.forwardingMessageId, jid)) {
      root.statusLine = "Forwarding…"
      root.view = "chat"
      root.selectedMessageId = ""
      root.searchQuery = ""
      Qt.callLater(function () { keyCatcher.forceActiveFocus() })
    }
  }

  function startReaction() {
    if (!root.selectedMessage() || root.selectedMessage().deleted) return
    root.reactionMode = true
    root.emojiPickerOpen = true
    root.emojiCursorIndex = 0
    Qt.callLater(function () { emojiGrid.forceActiveFocus() })
  }

  function removeReaction() {
    if (!root.client || !root.selectedMessageId) return
    root.client.reactToMessage(root.activeJid, root.selectedMessageId, "")
    root.selectedMessageId = ""
    keyCatcher.forceActiveFocus()
  }

  function startEdit() {
    var message = root.selectedMessage()
    if (!message || !message.fromMe || message.deleted
        || (message.type !== "conversation" && message.type !== "extendedTextMessage")) return
    root.editingMessageId = message.id
    root.quotedMessageId = ""
    root.selectedMessageId = ""
    composer.text = message.text || ""
    composer.forceActiveFocus()
  }

  function requestDelete(everyone) {
    var message = root.selectedMessage()
    if (!message || (everyone && !message.fromMe)) return
    root.deleteForEveryone = everyone
    root.deleteConfirmOpen = true
    Qt.callLater(function () { deleteConfirm.forceActiveFocus() })
  }

  function confirmDelete() {
    root.deleteConfirmOpen = false
    if (root.client && root.selectedMessageId)
      root.client.deleteMessage(root.activeJid, root.selectedMessageId, root.deleteForEveryone)
    root.selectedMessageId = ""
    Qt.callLater(function () { keyCatcher.forceActiveFocus() })
  }

  function sendReply() {
    var text = Model.expandEmoticons(composer.text)
    var hasPendingImage = root.pendingImagePath.length > 0 && root.pendingImageJid === root.activeJid
    var hasPendingVoice = root.pendingVoicePath.length > 0 && root.pendingVoiceJid === root.activeJid
    if ((!text || !text.trim().length) && !hasPendingImage && !hasPendingVoice) return
    if (!root.client || !root.client.ready) {
      root.statusLine = "Not connected to WhatsApp"
      return
    }
    if (root.editingMessageId) {
      if (root.client.editMessage(root.activeJid, root.editingMessageId, text)) {
        root.editingMessageId = ""
        composer.text = ""
        root.statusLine = "Editing…"
      }
      return
    }
    if (hasPendingImage) {
      if (root.imageSending) return
      if (root.client.sendImage(root.activeJid, root.pendingImagePath, root.pendingImageMime, text, root.quotedMessageId)) {
        root.imageSending = true
        root.statusLine = "Sending image\u2026"
      } else {
        root.statusLine = "Could not send the image"
      }
      return
    }
    if (hasPendingVoice) {
      if (root.voiceState !== "ready") return
      voicePreviewPlayer.stop()
      if (root.client.sendVoice(root.activeJid, root.pendingVoicePath, root.quotedMessageId)) {
        root.voiceState = "sending"
        root.statusLine = "Sending voice note…"
      } else root.statusLine = "Could not send the voice note"
      return
    }
    if (root.client.sendMessage(root.activeJid, text, root.quotedMessageId)) {
      composer.text = ""
      root.quotedMessageId = ""
      root.statusLine = ""
      typingTimer.stop()
      root.client.setTyping(root.activeJid, "paused")
    }
  }

  function clearPendingImage(deleteFile) {
    var path = root.pendingImagePath
    root.pendingImagePath = ""
    root.pendingImageMime = ""
    root.pendingImageJid = ""
    root.imageSending = false
    if (deleteFile && path)
      Quickshell.execDetached([root.pluginDir + "/bin/omarchy-whatsapp-paste-image", "delete", path])
  }

  function deleteVoiceFile(path) {
    if (path) Quickshell.execDetached([root.pluginDir + "/bin/omarchy-whatsapp-voice", "delete", path])
  }

  function discardVoice() {
    if (root.voiceState === "sending") return
    voicePreviewPlayer.stop()
    voiceClock.stop()
    if (root.voiceState === "recording" || root.voiceState === "stopping") {
      root.voiceState = "idle"
      if (voiceRecorder.processId) Quickshell.execDetached(["kill", "-INT", String(voiceRecorder.processId)])
      else voiceRecorder.running = false
    } else root.voiceState = "idle"
    root.deleteVoiceFile(root.voiceRecordPath)
    root.deleteVoiceFile(root.pendingVoicePath)
    root.voiceRecordPath = ""
    root.pendingVoicePath = ""
    root.pendingVoiceJid = ""
    root.voiceSeconds = 0
  }

  function toggleVoiceRecording() {
    if (root.voiceState === "recording") {
      root.voiceState = "stopping"
      voiceClock.stop()
      if (voiceRecorder.processId) Quickshell.execDetached(["kill", "-INT", String(voiceRecorder.processId)])
      else { root.discardVoice(); root.statusLine = "Microphone did not start" }
      return
    }
    if (!root.linked || !root.client || !root.client.ready || root.view !== "chat") return
    if (root.voiceState !== "idle" && root.voiceState !== "ready") return
    if (root.pendingImagePath || root.editingMessageId || clipboardCapture.running) {
      root.statusLine = "Finish the image or edit before recording"
      return
    }
    if (root.voiceState === "ready") root.discardVoice()
    root.pendingVoiceJid = root.activeJid
    root.voiceState = "preparing"
    voicePrepare.running = true
  }

  function handlePreparedVoice(output) {
    var result
    try { result = JSON.parse(output) }
    catch (err) { root.discardVoice(); root.statusLine = "Could not prepare microphone"; return }
    if (result.kind !== "prepared" || !result.path) {
      root.discardVoice()
      root.statusLine = result.message || "Could not prepare microphone"
      return
    }
    if (root.voiceState !== "preparing" || root.pendingVoiceJid !== root.activeJid || !root.opened) {
      root.deleteVoiceFile(result.path)
      return
    }
    root.voiceRecordPath = result.path
    root.voiceSeconds = 0
    root.voiceStartedAt = Date.now()
    voiceRecorder.command = [root.pluginDir + "/bin/omarchy-whatsapp-voice", "record", result.path]
    root.voiceState = "recording"
    root.statusLine = "Recording voice note"
    voiceRecorder.running = true
    voiceClock.start()
  }

  function handleEncodedVoice(output) {
    var result
    try { result = JSON.parse(output) }
    catch (err) {
      if (root.voiceState === "converting") {
        root.discardVoice()
        root.statusLine = "Could not encode voice note"
      }
      return
    }
    root.voiceRecordPath = ""
    if (root.voiceState !== "converting") {
      if (result.path) root.deleteVoiceFile(result.path)
      return
    }
    if (result.kind !== "voice" || !result.path) {
      root.discardVoice()
      root.statusLine = result.message || "Could not encode voice note"
      return
    }
    if (root.voiceState !== "converting" || root.pendingVoiceJid !== root.activeJid || !root.opened) {
      root.deleteVoiceFile(result.path)
      return
    }
    root.pendingVoicePath = result.path
    root.voiceState = "ready"
    root.statusLine = "Voice note ready to send"
  }

  function pasteImageOrText() {
    if (clipboardCapture.running || root.imageSending) return
    if (root.voiceState !== "idle") {
      root.statusLine = "Discard or send the voice note before pasting an image"
      return
    }
    root.pasteRequestJid = root.activeJid
    clipboardCapture.running = true
  }

  function handleClipboardCapture(output) {
    var result
    try { result = JSON.parse(output) }
    catch (err) { root.statusLine = "Could not read the clipboard"; return }
    if (result.kind === "none") {
      if (root.view === "chat" && root.activeJid === root.pasteRequestJid) composer.paste()
      return
    }
    if (result.kind === "error") {
      root.statusLine = result.message || "Could not paste the image"
      return
    }
    if (result.kind !== "image" || !result.path || !result.mime) return
    if (root.view !== "chat" || root.activeJid !== root.pasteRequestJid) {
      Quickshell.execDetached([root.pluginDir + "/bin/omarchy-whatsapp-paste-image", "delete", result.path])
      return
    }
    root.clearPendingImage(true)
    root.pendingImagePath = result.path
    root.pendingImageMime = result.mime
    root.pendingImageJid = root.activeJid
    root.statusLine = "Image ready to send"
  }

  onActiveJidChanged: {
    if (root.pendingImagePath && root.pendingImageJid !== root.activeJid && !root.imageSending)
      root.clearPendingImage(true)
    if (root.voiceState !== "idle" && root.pendingVoiceJid !== root.activeJid)
      root.discardVoice()
  }
  onViewChanged: {
    if (root.view !== "chat" && root.pendingImagePath && !root.imageSending)
      root.clearPendingImage(true)
    if (root.view !== "chat" && root.voiceState !== "idle") root.discardVoice()
  }
  Component.onDestruction: {
    if (root.pendingImagePath && !root.imageSending) root.clearPendingImage(true)
    if (root.voiceState !== "idle" && root.voiceState !== "sending") root.discardVoice()
  }

  function openWebClient() {
    webLauncher.running = true
  }

  function finishRefresh() {
    refreshWatchdog.stop()
    root.refreshing = false
    if (root.statusLine === "Refreshing\u2026") root.statusLine = ""
  }

  function refreshChats() {
    if (!root.client || root.showLogin || root.refreshing) return
    if (!root.client.linkUp) {
      root.statusLine = "Daemon offline"
      return
    }
    root.refreshing = true
    root.statusLine = "Refreshing\u2026"
    var ok = root.client.refreshInbox(
      root.view === "chat" ? root.activeJid : "",
      root.inboxFetchLimit,
      root.messageLimit
    )
    if (!ok) {
      root.refreshing = false
      root.statusLine = "Not connected"
      return
    }
    refreshWatchdog.restart()
  }

  function patchMessage(messageId, fields) {
    var list = root.messages.slice()
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === messageId) {
        var next = Object.assign({}, list[i], fields)
        if (fields.status !== undefined)
          next.status = Math.max(list[i].status || 0, fields.status || 0)
        list[i] = next
        var atEnd = messageList.atYEnd || root.pinToLatest
        var y = messageList.contentY
        root.messages = list
        Qt.callLater(function () {
          if (atEnd) {
            root.pinToLatest = true
            messageList.positionViewAtEnd()
          } else {
            messageList.contentY = y
          }
        })
        return true
      }
    }
    return false
  }

  function appendMessage(message) {
    if (!message) return
    if (root.patchMessage(message.id, message)) return
    var list = root.messages.slice()
    list.push(message)
    root.pinToLatest = true
    root.messages = list
    Qt.callLater(function () { messageList.positionViewAtEnd() })
  }

  onOpenedChanged: {
    if (!root.opened) {
      if (root.activeAudioMessageId) root.stopAudio()
      if (root.voiceState !== "idle" && root.voiceState !== "sending") root.discardVoice()
      return
    }
    root.statusLine = ""
    if (root.client) {
      root.client.refresh()
      root.client.requestChats(root.inboxFetchLimit)
      if (root.view === "chat" && root.activeJid) {
        root.client.loadMessages(root.activeJid, root.messageLimit)
        root.client.markRead(root.activeJid)
        Qt.callLater(function () { composer.forceActiveFocus() })
      }
    }
  }

  Connections {
    target: root.client
    enabled: root.client !== null

    function onMessagesLoaded(jid, chat, messages) {
      if (jid !== root.activeJid) return
      root.activeChat = chat
      root.pinToLatest = true
      root.messages = messages || []
      Qt.callLater(function () { messageList.positionViewAtEnd() })
      if (root.refreshing) root.finishRefresh()
    }

    function onChatsChanged() {
      if (root.refreshing && root.view !== "chat") root.finishRefresh()
    }

    function onMessageArrived(jid, message, chat) {
      if (jid !== root.activeJid) return
      if (chat) root.activeChat = chat
      root.appendMessage(message)
      // The conversation is on screen, so the message is read the moment it
      // lands rather than sitting as an unread the user has already seen.
      if (root.opened && root.client && root.client.ready) root.client.markRead(jid)
    }

    function onMessageStatusChanged(jid, messageId, status) {
      // Receipt JIDs are often a LID or device-suffixed form that does not
      // equal activeJid. Apply by message id in the open thread.
      root.patchMessage(messageId, { status: status })
    }

    function onMessageMedia(jid, messageId, mediaPath, mediaKind, details) {
      if (!mediaPath || !root.messages.some(function(message) { return message.id === messageId })) return
      if (mediaKind === "video") {
        root.patchMessage(messageId, { videoPath: mediaPath })
        if (root.pendingMediaMessageId === messageId) {
          root.pendingMediaMessageId = ""
          root.statusLine = ""
          root.videoError = ""
          root.peekVideoPath = mediaPath
        }
      } else if (mediaKind === "audio") {
        root.patchMessage(messageId, Object.assign({ audioPath: mediaPath }, details || {}))
        if (root.pendingMediaMessageId === messageId) {
          root.pendingMediaMessageId = ""
          root.statusLine = ""
          root.stopAudio()
          root.activeAudioMessageId = messageId
          root.audioPath = mediaPath
        }
      } else if (mediaKind === "document") {
        root.patchMessage(messageId, Object.assign({ documentPath: mediaPath }, details || {}))
        if (root.pendingMediaMessageId === messageId) {
          root.pendingMediaMessageId = ""
          root.statusLine = "Saved to " + mediaPath
        }
      } else root.patchMessage(messageId, { imagePath: mediaPath })
    }

    function onMessageMediaError(jid, messageId, message) {
      if (root.pendingMediaMessageId !== messageId) return
      root.pendingMediaMessageId = ""
      root.statusLine = message || "Could not download media"
    }

    function onMessagePatched(jid, messageId, fields) {
      root.patchMessage(messageId, fields)
    }

    function onMessageRemoved(jid, messageId) {
      if (root.messages.some(function(message) { return message.id === messageId }))
        root.messages = root.messages.filter(function(message) { return message.id !== messageId })
    }

    function onImageSendAcknowledged(jid) {
      if (jid !== root.pendingImageJid || !root.imageSending) return
      root.clearPendingImage(false)
      composer.clear()
      root.quotedMessageId = ""
      root.statusLine = ""
      typingTimer.stop()
      root.client.setTyping(jid, "paused")
    }

    function onVoiceSendAcknowledged(jid) {
      if (jid !== root.pendingVoiceJid || root.voiceState !== "sending") return
      root.pendingVoicePath = ""
      root.pendingVoiceJid = ""
      root.voiceState = "idle"
      root.voiceSeconds = 0
      root.quotedMessageId = ""
      root.statusLine = ""
      typingTimer.stop()
      root.client.setTyping(jid, "paused")
    }

    function onActionAcknowledged(action, jid) {
      if (["forward", "edit", "react", "delete"].indexOf(action) !== -1)
        root.statusLine = ""
    }

    function onCommandFailed(command, message) {
      if (command === "send") root.statusLine = message
      if (command === "downloadMedia") {
        root.pendingMediaMessageId = ""
        root.statusLine = message || "Could not download media"
      }
      if (command === "sendImage") {
        root.imageSending = false
        root.statusLine = message || "Could not send the image"
        if (root.pendingImageJid !== root.activeJid) root.clearPendingImage(true)
      }
      if (command === "sendVoice") {
        root.voiceState = "ready"
        root.statusLine = message || "Could not send the voice note"
        if (root.pendingVoiceJid !== root.activeJid) root.discardVoice()
      }
      if (["forward", "react", "edit", "delete"].indexOf(command) !== -1)
        root.statusLine = message || command + " failed"
      if (command === "refresh") {
        root.refreshing = false
        refreshWatchdog.stop()
        if (message && message.indexOf("unknown command") !== -1 && root.client) {
          root.client.requestChats(root.inboxFetchLimit)
          if (root.view === "chat" && root.activeJid)
            root.client.loadMessages(root.activeJid, root.messageLimit)
          root.statusLine = ""
          return
        }
        root.statusLine = message || "Refresh failed"
      }
    }
  }

  MediaPlayer {
    id: voicePlayer
    source: root.audioPath.length > 0 ? Qt.resolvedUrl("file://" + root.audioPath) : ""
    audioOutput: AudioOutput {}
    onSourceChanged: {
      if (root.audioPath.length > 0) play()
    }
    onErrorOccurred: function (error, errorString) {
      root.statusLine = errorString || "Could not play audio"
    }
  }

  MediaPlayer {
    id: voicePreviewPlayer
    source: root.pendingVoicePath.length > 0 ? Qt.resolvedUrl("file://" + root.pendingVoicePath) : ""
    audioOutput: AudioOutput {}
    onErrorOccurred: function (error, errorString) {
      root.statusLine = errorString || "Could not preview voice note"
    }
  }

  Timer {
    id: voiceClock
    interval: 1000
    repeat: true
    onTriggered: {
      root.voiceSeconds = Math.floor((Date.now() - root.voiceStartedAt) / 1000)
      if (root.voiceSeconds >= 180) root.toggleVoiceRecording()
    }
  }

  Process {
    id: voicePrepare
    command: [root.pluginDir + "/bin/omarchy-whatsapp-voice", "prepare"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.handlePreparedVoice(text)
    }
    onExited: function (exitCode) {
      if (exitCode !== 0 && root.voiceState === "preparing") {
        root.discardVoice()
        root.statusLine = "Could not prepare microphone"
      }
    }
  }

  Process {
    id: voiceRecorder
    onExited: function (exitCode) {
      if (root.voiceState === "stopping") {
        root.voiceState = "converting"
        voiceEncode.command = [root.pluginDir + "/bin/omarchy-whatsapp-voice", "finish", root.voiceRecordPath]
        voiceEncode.running = true
      } else if (root.voiceState === "recording") {
        root.discardVoice()
        root.statusLine = "Microphone recording stopped unexpectedly"
      }
    }
  }

  Process {
    id: voiceEncode
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.handleEncodedVoice(text)
    }
    onExited: function (exitCode) {
      if (exitCode !== 0 && root.voiceState === "converting") {
        root.discardVoice()
        root.statusLine = "Could not encode voice note"
      }
    }
  }

  Shortcut {
    sequence: "Ctrl+Shift+R"
    enabled: root.opened && root.view === "chat"
    onActivated: root.toggleVoiceRecording()
  }

  Process {
    id: linkLauncher
    property string targetUrl: ""
    command: ["xdg-open", targetUrl]
    function open(url) {
      targetUrl = url
      running = true
    }
  }

  Process {
    id: webLauncher
    command: [root.pluginDir + "/bin/omarchy-whatsapp-open", root.setting("webAppUrl", "https://web.whatsapp.com")]
  }

  Process {
    id: clipboardCapture
    command: [root.pluginDir + "/bin/omarchy-whatsapp-paste-image", "capture"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.handleClipboardCapture(text)
    }
    onExited: function (exitCode) {
      if (exitCode !== 0) root.statusLine = "Could not read the clipboard image"
    }
  }

  Process {
    id: daemonStarter
    command: ["systemctl", "--user", "start", "omarchy-whatsapp.service"]
    onExited: function (exitCode) {
      if (exitCode !== 0 && root.client) root.client.startDaemon()
    }
  }

  // Coalesces keystrokes into one "composing" presence, then one "paused" a
  // few seconds after the user stops.
  Timer {
    id: typingTimer
    interval: 3000
    repeat: false
    onTriggered: if (root.client && root.activeJid) root.client.setTyping(root.activeJid, "paused")
  }

  Timer {
    id: refreshWatchdog
    interval: 8000
    repeat: false
    onTriggered: root.finishRefresh()
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.hostWidget || root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(400))
    contentHeight: panel.fittedContentHeight(content.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      // Composer, logout confirm, and image peek own keys while they are up.
      blocked: composer.activeFocus || emojiButton.activeFocus || emojiGrid.activeFocus
        || priorityField.activeFocus || searchField.activeFocus
        || root.logoutConfirmOpen || root.deleteConfirmOpen || root.peekActive

      onCloseRequested: {
        if (root.peekActive) root.closePeek()
        else if (root.logoutConfirmOpen) root.cancelLogout()
        else if (root.deleteConfirmOpen) root.deleteConfirmOpen = false
        else if (root.selectedMessageId) root.selectedMessageId = ""
        else if (root.view === "chat" || root.view === "forward" || root.view === "settings") root.back()
        else root.close()
      }
      onTabRequested: function (direction) { root.switchPanel(direction) }
      onMoveRequested: function (dx, dy) { root.moveCursor(dy) }
      onActivateRequested: {
        if (root.view === "chat" && root.selectedMessageId) root.startReply()
        else root.activateCursor()
      }
      onTextKey: function (text) {
        if (root.view === "chat" && root.selectedMessageId) {
          if (text === "r" || text === "R") root.startReply()
          else if (text === "v" || text === "V") {
            var selectedVideo = root.messages.find(function(message) { return message.id === root.selectedMessageId })
            if (selectedVideo && (selectedVideo.type === "videoMessage" || selectedVideo.type === "ptvMessage"))
              root.viewVideo(selectedVideo)
          }
          else if (text === "p" || text === "P") {
            var selectedAudio = root.messages.find(function(message) { return message.id === root.selectedMessageId })
            if (selectedAudio && selectedAudio.type === "audioMessage") root.toggleAudio(selectedAudio)
          }
          else if (text === "s" || text === "S") {
            var selectedDocument = root.messages.find(function(message) { return message.id === root.selectedMessageId })
            if (selectedDocument && (selectedDocument.type === "documentMessage"
              || selectedDocument.type === "documentWithCaptionMessage")) root.downloadDocument(selectedDocument)
          }
          else if (text === "f" || text === "F") root.startForward()
          else if (text === "e" || text === "E") root.startEdit()
          else if (text === "d" || text === "D") root.requestDelete(false)
          else if (text === "x" || text === "X") root.requestDelete(true)
          else if (text === "a" || text === "A") root.startReaction()
          else if (text === "0") root.removeReaction()
          return
        }
        if (text === "r" || text === "R") root.refreshChats()
        else if (text === "/") root.focusSearch()
        else if ((text === "s" || text === "S") && root.view === "chats") root.openSettings()
        else if ((text === "c" || text === "C") && root.view === "chats") root.clearSelectedChat()
      }

      Column {
        id: content
        width: parent.width
        spacing: Style.space(8)

        // ── Header ───────────────────────────────────────────────────────
        Item {
          width: parent.width
          implicitHeight: Math.max(headerText.implicitHeight, backButton.height, headerActions.implicitHeight)

          Rectangle {
            id: backButton
            visible: root.view === "chat" || root.view === "forward" || root.view === "settings"
            width: Style.space(26)
            height: Style.space(26)
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            radius: 0
            color: backMouse.containsMouse
              ? Style.hoverFillFor(root.foreground, root.bar ? root.bar.urgent : Color.accent)
              : Style.normalFillFor(root.foreground, Color.accent)
            border.color: root.foreground
            border.width: 1

            Text {
              anchors.centerIn: parent
              text: "\uf060"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.icon
            }

            MouseArea {
              id: backMouse
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onClicked: root.back()
            }
          }

          Column {
            id: headerText
            anchors.left: backButton.visible ? backButton.right : parent.left
            anchors.leftMargin: backButton.visible ? Style.space(8) : 0
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: headerActions.left
            anchors.rightMargin: Style.space(8)
            spacing: Style.space(1)

            Text {
              width: parent.width
              text: root.view === "settings" ? "Settings"
                : root.view === "forward" ? "Forward to…"
                : root.view === "chat"
                  ? Model.chatTitle(root.activeChat || { jid: root.activeJid, name: "" })
                  : "WhatsApp"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.subtitle
              font.bold: true
              elide: Text.ElideRight
            }

            Text {
              width: parent.width
              text: {
                if (root.statusLine.length > 0) return root.statusLine
                if (root.view === "chat") return ""
                if (root.needsLogin) return root.hasQr ? "Scan the QR code" : ""
                var unread = root.client ? root.client.unread : 0
                return unread > 0 ? unread + " unread" : ""
              }
              visible: text.length > 0
              color: root.statusLine.length > 0 ? (root.bar ? root.bar.urgent : Color.urgent) : root.secondaryForeground
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              elide: Text.ElideRight
            }
          }

          Row {
            id: headerActions
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            PanelActionButton {
              visible: !root.showLogin && (root.view === "chats" || root.view === "chat")
              iconText: "\uf021"
              tooltipText: root.view === "chat" ? "Refresh this conversation" : "Refresh chats"
              enabled: root.linked && !root.refreshing
              foreground: root.foreground
              fontFamily: root.fontFamily
              onClicked: root.refreshChats()
            }

            PanelActionButton {
              visible: root.view === "chats"
              iconText: "\uf013"
              tooltipText: "Settings"
              foreground: root.foreground
              fontFamily: root.fontFamily
              onClicked: root.openSettings()
            }

            PanelActionButton {
              iconText: "\uf24d"
              tooltipText: "Open the full WhatsApp Web client"
              foreground: root.foreground
              fontFamily: root.fontFamily
              onClicked: {
                root.openWebClient()
                root.close()
              }
            }

            PanelActionButton {
              visible: !root.showLogin && root.view === "chats"
              iconText: "\uf011"
              tooltipText: "Log out of WhatsApp"
              foreground: root.foreground
              hoverColor: root.bar ? root.bar.urgent : Color.urgent
              fontFamily: root.fontFamily
              onClicked: root.requestLogout()
            }
          }
        }

        PanelSeparator { foreground: root.foreground }

        Column {
          width: parent.width
          spacing: Style.space(9)
          visible: root.view === "settings"

          Text {
            width: parent.width
            text: "Priority sender"
            textFormat: Text.PlainText
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.subtitle
            font.bold: true
          }

          Text {
            width: parent.width
            text: "Enter one contact name as it appears in WhatsApp. The bar indicator turns red while their conversation has unread messages."
            textFormat: Text.PlainText
            color: root.secondaryForeground
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            wrapMode: Text.WordWrap
          }

          TextField {
            id: priorityField
            width: parent.width
            foreground: root.foreground
            accent: "#e5484d"
            placeholderText: "Contact name"
            onAccepted: root.savePriorityName()
            Keys.onEscapePressed: function(event) {
              root.back()
              event.accepted = true
            }
          }

          Row {
            spacing: Style.space(8)
            Button {
              text: "Save"
              foreground: root.foreground
              fontFamily: root.fontFamily
              bordered: true
              onClicked: root.savePriorityName()
            }
            Button {
              text: "Clear"
              foreground: root.foreground
              fontFamily: root.fontFamily
              bordered: true
              onClicked: {
                priorityField.text = ""
                root.savePriorityName()
              }
            }
          }
        }

        // ── Login ────────────────────────────────────────────────────────
        Column {
          width: parent.width
          spacing: Style.space(8)
          visible: root.showLogin

          Image {
            id: qrImage
            visible: root.hasQr && qrImage.status === Image.Ready
            width: Math.min(parent.width, Style.space(220))
            height: width
            anchors.horizontalCenter: parent.horizontalCenter
            fillMode: Image.PreserveAspectFit
            source: root.hasQr && root.client && root.client.qrPng
              ? Qt.resolvedUrl("file://" + root.client.qrPng)
              : ""
          }

          Text {
            width: parent.width
            visible: root.hasQr
            horizontalAlignment: Text.AlignHCenter
            text: "WhatsApp \u2192 Linked devices \u2192 Link a device"
            color: root.secondaryForeground
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.WordWrap
          }

          Text {
            width: parent.width
            visible: !root.hasQr && root.client && root.client.pendingLogin
            horizontalAlignment: Text.AlignHCenter
            text: "Getting QR code\u2026"
            color: root.secondaryForeground
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }

          Button {
            anchors.horizontalCenter: parent.horizontalCenter
            visible: !root.hasQr
            text: "Login"
            foreground: root.foreground
            fontFamily: root.fontFamily
            bordered: true
            onClicked: {
              if (!root.daemonOnline) daemonStarter.running = true
              if (root.client) root.client.startLogin()
            }
          }
        }

        // ── Chat list ────────────────────────────────────────────────────
        Column {
          width: parent.width
          spacing: Style.space(4)
          visible: !root.showLogin && (root.view === "chats" || root.view === "forward")

          TextField {
            id: searchField
            width: parent.width
            foreground: root.foreground
            accent: root.bar ? root.bar.urgent : Color.accent
            placeholderText: root.view === "forward" ? "Find recipient…" : "Search contacts  /"
            onTextChanged: root.searchQuery = text
            onActiveFocusChanged: if (activeFocus && root.client) root.client.requestChats(root.inboxFetchLimit)
            onAccepted: root.activateCursor()
            Keys.onEscapePressed: function(event) {
              if (searchField.text.length > 0) searchField.clear()
              else keyCatcher.forceActiveFocus()
              event.accepted = true
            }
          }

          Text {
            width: parent.width
            visible: root.visibleChats.length === 0
            text: root.searchQuery.trim().length > 0 ? "No matching contacts." : "No conversations yet."
            color: root.secondaryForeground
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            wrapMode: Text.WordWrap
          }

          Text {
            width: parent.width
            visible: root.view === "chats" && root.searchQuery.trim().length === 0
              && root.visibleChats.length > 0
            text: "Individuals"
            color: root.secondaryForeground
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
          }

          Component {
            id: chatRowComponent
            CursorSurface {
              id: chatRow
              required property var modelData
              required property int index
              readonly property int globalIndex: (ListView.view === groupList
                ? root.groupHeaderIndex + 1 : 0) + index

              width: ListView.view.width
              implicitHeight: rowText.implicitHeight + Style.space(16)
              height: implicitHeight
              foreground: root.foreground
              accent: root.bar ? root.bar.urgent : Color.accent
              hasCursor: root.cursorIndex === chatRow.globalIndex

              Column {
                id: rowText
                anchors.left: parent.left
                anchors.right: rowMeta.left
                anchors.verticalCenter: parent.verticalCenter
                anchors.leftMargin: Style.space(8)
                anchors.rightMargin: Style.space(6)
                spacing: Style.space(1)

                Text {
                  width: parent.width
                  text: Model.chatTitle(chatRow.modelData)
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  font.bold: (chatRow.modelData.unread || 0) > 0
                  elide: Text.ElideRight
                }

                Text {
                  width: parent.width
                  text: Model.truncate(Model.chatPreview(chatRow.modelData), 64)
                  color: root.secondaryForeground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  elide: Text.ElideRight
                }
              }

              Column {
                id: rowMeta
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                anchors.rightMargin: Style.space(8)
                spacing: Style.space(2)
                width: Math.max(badge.implicitWidth, stamp.implicitWidth)

                Text {
                  id: stamp
                  anchors.right: parent.right
                  text: Model.chatTimestamp(chatRow.modelData.lastTs)
                  color: root.secondaryForeground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                }

                Rectangle {
                  id: badge
                  anchors.right: parent.right
                  visible: (chatRow.modelData.unread || 0) > 0
                  implicitWidth: badgeLabel.implicitWidth + Style.space(8)
                  implicitHeight: badgeLabel.implicitHeight + Style.space(2)
                  width: implicitWidth
                  height: implicitHeight
                  radius: height / 2
                  color: Model.isPriorityChat(chatRow.modelData, root.setting("priorityName", ""))
                    ? "#e5484d" : "#25D366"

                  Text {
                    id: badgeLabel
                    anchors.centerIn: parent
                    text: Model.badgeText(chatRow.modelData.unread)
                    color: Color.background
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    font.bold: true
                  }
                }
              }

              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onContainsMouseChanged: if (containsMouse) root.cursorIndex = chatRow.globalIndex
                onClicked: {
                  if (root.view === "forward") root.forwardTo(chatRow.modelData.jid)
                  else root.selectChat(chatRow.modelData.jid)
                }
              }

              Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                height: 1
                color: root.foreground
                opacity: 0.16
              }
            }
          }

          ListView {
            id: chatList
            width: parent.width
            visible: root.visibleIndividualChats.length > 0
            height: Math.min(contentHeight, Style.space(300))
            model: root.visibleIndividualChats
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            interactive: contentHeight > height
            currentIndex: root.cursorIndex
            spacing: Style.space(3)
            ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

            delegate: chatRowComponent
          }

          CursorSurface {
            id: groupToggle
            width: parent.width
            height: Style.space(34)
            visible: root.groupHeaderIndex >= 0
            foreground: root.foreground
            accent: root.bar ? root.bar.urgent : Color.accent
            hasCursor: root.cursorIndex === root.groupHeaderIndex

            Text {
              anchors.left: parent.left
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              anchors.margins: Style.space(8)
              text: (root.groupsExpanded ? "▾" : "▸") + "  Groups ("
                + (root.visibleChats[root.groupHeaderIndex]
                  ? root.visibleChats[root.groupHeaderIndex].groupCount : 0) + ")"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
              font.bold: true
              elide: Text.ElideRight
            }

            MouseArea {
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onContainsMouseChanged: if (containsMouse) root.cursorIndex = root.groupHeaderIndex
              onClicked: {
                root.cursorIndex = root.groupHeaderIndex
                root.groupsExpanded = !root.groupsExpanded
                keyCatcher.forceActiveFocus()
              }
            }
          }

          ListView {
            id: groupList
            width: parent.width
            visible: root.visibleGroupChats.length > 0
            height: Math.min(contentHeight, Style.space(220))
            model: root.visibleGroupChats
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            interactive: contentHeight > height
            currentIndex: root.cursorIndex - root.groupHeaderIndex - 1
            spacing: Style.space(3)
            ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }
            delegate: chatRowComponent
          }

          Text {
            width: parent.width
            visible: root.visibleChats.length > 0
            text: root.view === "forward"
              ? "↑/↓ choose · Enter or click to forward · Esc back"
              : "↑/↓ choose · Enter open/expand · / search · C hide · S settings · Esc close"
            textFormat: Text.PlainText
            color: root.secondaryForeground
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.WordWrap
          }
        }

        // ── Conversation ─────────────────────────────────────────────────
        Column {
          width: parent.width
          spacing: Style.space(6)
          visible: !root.showLogin && root.view === "chat"

          ListView {
            id: messageList
            width: parent.width
            height: Style.space(300)
            model: root.messages
            clip: true
            spacing: Style.space(4)
            boundsBehavior: Flickable.StopAtBounds
            ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }
            onMovementEnded: root.pinToLatest = atYEnd
            onContentHeightChanged: if (root.pinToLatest) Qt.callLater(function () { messageList.positionViewAtEnd() })

            delegate: Column {
              id: messageRow
              required property var modelData
              required property int index

              width: ListView.view.width
              spacing: Style.space(3)

              readonly property var previous: messageRow.index > 0 ? root.messages[messageRow.index - 1] : null
              readonly property bool showDay: !messageRow.previous
                || !Model.sameDay(messageRow.previous.ts, messageRow.modelData.ts)

              Text {
                width: parent.width
                visible: messageRow.showDay
                horizontalAlignment: Text.AlignHCenter
                text: Model.dayLabel(messageRow.modelData.ts)
                color: root.secondaryForeground
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
              }

              Item {
                id: bubbleRow
                width: parent.width
                implicitHeight: bubble.height
                height: implicitHeight

                readonly property real pad: Style.space(8)
                // Each label's width comes from its own natural (unwrapped)
                // implicitWidth, and the bubble from those labels. Anchoring the
                // content to both bubble edges instead would make the bubble's
                // width depend on content that depends on the bubble: a binding
                // loop, which collapses every bubble to a few pixels.
                readonly property real maxInner: Math.max(Style.space(60), bubbleRow.width * 0.82 - bubbleRow.pad * 2)
                readonly property bool hasImage: !!messageRow.modelData.imagePath
                  && String(messageRow.modelData.imagePath).length > 0
                readonly property bool hasVideo: !messageRow.modelData.deleted
                  && (messageRow.modelData.type === "videoMessage" || messageRow.modelData.type === "ptvMessage")
                readonly property bool hasAudio: !messageRow.modelData.deleted
                  && messageRow.modelData.type === "audioMessage"
                readonly property bool hasDocument: !messageRow.modelData.deleted
                  && (messageRow.modelData.type === "documentMessage"
                    || messageRow.modelData.type === "documentWithCaptionMessage")
                readonly property bool showBody: {
                  var text = messageRow.modelData.text || ""
                  if (!text.length) return false
                  if (bubbleRow.hasImage && Model.isPhotoPlaceholder(text)) return false
                  if (bubbleRow.hasVideo && (text === "Video" || text === "Video note")) return false
                  return true
                }
                readonly property bool showSender: !messageRow.modelData.fromMe
                  && root.activeChat !== null
                  && root.activeChat.isGroup === true

                Rectangle {
                  id: bubble
                  width: bubbleContent.width + bubbleRow.pad * 2
                  height: bubbleContent.implicitHeight + bubbleRow.pad
                  anchors.right: messageRow.modelData.fromMe ? parent.right : undefined
                  anchors.left: messageRow.modelData.fromMe ? undefined : parent.left
                  radius: Style.cornerRadius > 0 ? Style.cornerRadius : Style.space(6)
                  color: messageRow.modelData.fromMe
                    ? Style.selectedFillFor(root.foreground, root.bar ? root.bar.urgent : Color.accent)
                    : Style.normalFillFor(root.foreground, Color.accent)
                  border.width: root.selectedMessageId === messageRow.modelData.id ? 2 : 0
                  border.color: root.bar ? root.bar.urgent : Color.accent

                  TapHandler { onTapped: root.selectMessage(messageRow.modelData.id) }

                  Column {
                    id: bubbleContent
                    x: bubbleRow.pad
                    y: bubbleRow.pad / 2
                    spacing: Style.space(1)
                    width: Math.max(
                      bubbleRow.showSender ? senderLabel.width : 0,
                      quoteLabel.visible ? quoteLabel.width : 0,
                      forwardedLabel.visible ? forwardedLabel.width : 0,
                      bubbleRow.hasImage ? photo.width : 0,
                      bubbleRow.hasVideo ? videoTile.width : 0,
                      bubbleRow.hasAudio ? audioTile.width : 0,
                      bubbleRow.hasDocument ? documentTile.width : 0,
                      bodyLabel.visible ? bodyLabel.width : 0,
                      reactionsLabel.visible ? reactionsLabel.width : 0,
                      Math.min(metaLabel.implicitWidth, bubbleRow.maxInner))

                    Text {
                      id: senderLabel
                      visible: bubbleRow.showSender
                      width: Math.min(implicitWidth, bubbleRow.maxInner)
                      text: messageRow.modelData.senderName || ""
                      color: root.bar ? root.bar.urgent : Color.accent
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                      font.bold: true
                      elide: Text.ElideRight
                    }

                    Text {
                      id: forwardedLabel
                      visible: messageRow.modelData.forwarded === true
                      text: "↪ Forwarded"
                      color: root.secondaryForeground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                    }

                    Text {
                      id: quoteLabel
                      visible: !!messageRow.modelData.quote
                      width: Math.min(implicitWidth, bubbleRow.maxInner)
                      text: visible ? "↩ " + (messageRow.modelData.quote.sender || "Reply")
                        + ": " + Model.truncate(messageRow.modelData.quote.text || "Message", 60) : ""
                      textFormat: Text.PlainText
                      color: root.bar ? root.bar.urgent : Color.accent
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                      elide: Text.ElideRight
                    }

                    Image {
                      id: photo
                      visible: bubbleRow.hasImage && photo.status !== Image.Error
                      width: Math.min(bubbleRow.maxInner, Style.space(220))
                      height: photo.sourceSize.height > 0
                        ? Math.min(Style.space(200), photo.sourceSize.height * (width / Math.max(1, photo.sourceSize.width)))
                        : Style.space(140)
                      fillMode: Image.PreserveAspectFit
                      asynchronous: true
                      cache: true
                      source: bubbleRow.hasImage
                        ? Qt.resolvedUrl("file://" + messageRow.modelData.imagePath)
                        : ""

                      MouseArea {
                        id: photoMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: root.peekImagePath = messageRow.modelData.imagePath

                        Rectangle {
                          anchors.fill: parent
                          color: photoMouse.containsMouse ? "#20ffffff" : "transparent"
                          radius: Style.cornerRadius > 0 ? Style.cornerRadius : Style.space(4)

                          Text {
                            anchors.centerIn: parent
                            visible: photoMouse.containsMouse
                            text: "\uf00e"
                            font.family: root.fontFamily
                            font.pixelSize: Style.font.title
                            color: "#ffffff"
                          }
                        }
                      }
                    }

                    Rectangle {
                      id: videoTile
                      visible: bubbleRow.hasVideo
                      width: Math.min(bubbleRow.maxInner, Style.space(220))
                      height: Style.space(125)
                      radius: Style.cornerRadius > 0 ? Style.cornerRadius : Style.space(4)
                      color: Style.normalFillFor(root.foreground, Color.accent)
                      border.width: 1
                      border.color: root.secondaryForeground

                      Text {
                        anchors.centerIn: parent
                        text: root.pendingMediaMessageId === messageRow.modelData.id
                          ? "Downloading video…" : "▶  Play video"
                        color: root.foreground
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.body
                      }

                      MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: root.viewVideo(messageRow.modelData)
                      }
                    }

                    Rectangle {
                      id: audioTile
                      visible: bubbleRow.hasAudio
                      width: Math.min(bubbleRow.maxInner, Style.space(220))
                      height: Style.space(66)
                      radius: Style.cornerRadius > 0 ? Style.cornerRadius : Style.space(4)
                      color: Style.normalFillFor(root.foreground, Color.accent)
                      border.width: 1
                      border.color: root.secondaryForeground

                      Column {
                        anchors.fill: parent
                        anchors.margins: Style.space(6)
                        spacing: Style.space(1)
                        Row {
                          width: parent.width
                          spacing: Style.space(6)
                          Text {
                            id: audioPlayLabel
                            width: parent.width - audioDurationLabel.width - Style.space(6)
                            text: root.pendingMediaMessageId === messageRow.modelData.id
                              ? "Downloading audio…"
                              : root.activeAudioMessageId === messageRow.modelData.id
                                && voicePlayer.playbackState === MediaPlayer.PlayingState ? "Ⅱ  Pause"
                                  : messageRow.modelData.isVoiceNote ? "▶  Voice note" : "▶  Play audio"
                            color: root.foreground
                            font.family: root.fontFamily
                            font.pixelSize: Style.font.body
                            elide: Text.ElideRight
                            MouseArea {
                              anchors.fill: parent
                              cursorShape: Qt.PointingHandCursor
                              onClicked: root.toggleAudio(messageRow.modelData)
                            }
                          }
                          Text {
                            id: audioDurationLabel
                            text: root.activeAudioMessageId === messageRow.modelData.id
                              && voicePlayer.duration > 0 ? root.playbackTime(voicePlayer.duration)
                                : root.playbackTime((messageRow.modelData.audioSeconds || 0) * 1000)
                            color: root.secondaryForeground
                            font.family: root.fontFamily
                            font.pixelSize: Style.font.caption
                          }
                        }
                        Slider {
                          width: parent.width
                          height: Style.space(28)
                          enabled: root.activeAudioMessageId === messageRow.modelData.id
                          from: 0
                          to: Math.max(1, root.activeAudioMessageId === messageRow.modelData.id
                            ? voicePlayer.duration : (messageRow.modelData.audioSeconds || 0) * 1000)
                          value: root.activeAudioMessageId === messageRow.modelData.id ? voicePlayer.position : 0
                          onMoved: if (enabled) voicePlayer.position = value
                        }
                      }
                    }

                    Rectangle {
                      id: documentTile
                      visible: bubbleRow.hasDocument
                      width: Math.min(bubbleRow.maxInner, Style.space(220))
                      height: Style.space(60)
                      radius: Style.cornerRadius > 0 ? Style.cornerRadius : Style.space(4)
                      color: Style.normalFillFor(root.foreground, Color.accent)
                      border.width: 1
                      border.color: root.secondaryForeground

                      Column {
                        anchors.fill: parent
                        anchors.margins: Style.space(7)
                        Text {
                          width: parent.width
                          text: messageRow.modelData.fileName || "Document"
                          textFormat: Text.PlainText
                          color: root.foreground
                          font.family: root.fontFamily
                          font.pixelSize: Style.font.body
                          elide: Text.ElideRight
                        }
                        Text {
                          width: parent.width
                          text: messageRow.modelData.documentPath ? "✓ Saved to Downloads"
                            : root.pendingMediaMessageId === messageRow.modelData.id
                              ? "Downloading…" : "↓ Download document"
                          color: root.secondaryForeground
                          font.family: root.fontFamily
                          font.pixelSize: Style.font.caption
                        }
                      }

                      MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: root.downloadDocument(messageRow.modelData)
                      }
                    }

                    Text {
                      id: bodyLabel
                      visible: bubbleRow.showBody
                      width: Math.min(implicitWidth, bubbleRow.maxInner)
                      textFormat: Text.StyledText
                      text: Model.formatMessageText(messageRow.modelData.text, root.bar ? root.bar.urgent : Color.accent)
                      color: root.foreground
                      linkColor: root.bar ? root.bar.urgent : Color.accent
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                      wrapMode: Text.Wrap
                      onLinkActivated: function (link) {
                        if (link) {
                          if (!Qt.openUrlExternally(link)) linkLauncher.open(link)
                        }
                      }

                      MouseArea {
                        anchors.fill: parent
                        acceptedButtons: Qt.NoButton
                        hoverEnabled: true
                        cursorShape: bodyLabel.hoveredLink.length > 0 ? Qt.PointingHandCursor : Qt.IBeamCursor
                      }
                    }

                    Text {
                      id: reactionsLabel
                      visible: !!messageRow.modelData.reactions && messageRow.modelData.reactions.length > 0
                      width: Math.min(implicitWidth, bubbleRow.maxInner)
                      text: visible ? messageRow.modelData.reactions.map(function(entry) { return entry.emoji }).join(" ") : ""
                      textFormat: Text.PlainText
                      font.pixelSize: Style.font.body
                    }

                    Text {
                      id: metaLabel
                      width: parent.width
                      horizontalAlignment: Text.AlignRight
                      text: {
                        var stampText = Model.messageTimestamp(messageRow.modelData.ts)
                        if (messageRow.modelData.edited) stampText += " · edited"
                        if (!messageRow.modelData.fromMe) return stampText
                        return stampText + " " + Model.statusGlyph(messageRow.modelData.status)
                      }
                      color: messageRow.modelData.fromMe && Model.statusIsRead(messageRow.modelData.status)
                        ? (root.bar ? root.bar.urgent : Color.accent)
                        : root.secondaryForeground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                    }
                  }
                }
              }
            }
          }

          Text {
            width: parent.width
            visible: root.messages.length === 0
            text: "No messages loaded yet."
            color: root.secondaryForeground
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }

          Flow {
            width: parent.width
            spacing: Style.space(4)
            visible: root.selectedMessageId.length > 0
            Button {
              text: "Reply"
              enabled: !!root.selectedMessage() && !root.selectedMessage().deleted
              foreground: root.foreground
              fontFamily: root.fontFamily
              bordered: true
              onClicked: root.startReply()
            }
            Button {
              text: "Forward"
              enabled: !!root.selectedMessage() && !root.selectedMessage().deleted
              foreground: root.foreground
              fontFamily: root.fontFamily
              bordered: true
              onClicked: root.startForward()
            }
            Button {
              text: "React"
              enabled: !!root.selectedMessage() && !root.selectedMessage().deleted
              foreground: root.foreground
              fontFamily: root.fontFamily
              bordered: true
              onClicked: root.startReaction()
            }
            Button {
              visible: !!root.selectedMessage() && !!root.selectedMessage().reactions
                && root.selectedMessage().reactions.some(function(entry) { return entry.actor === "me" })
              text: "Unreact"
              foreground: root.foreground
              fontFamily: root.fontFamily
              bordered: true
              onClicked: root.removeReaction()
            }
            Button {
              visible: !!root.selectedMessage() && root.selectedMessage().fromMe
                && !root.selectedMessage().deleted
                && (root.selectedMessage().type === "conversation" || root.selectedMessage().type === "extendedTextMessage")
              text: "Edit"
              foreground: root.foreground
              fontFamily: root.fontFamily
              bordered: true
              onClicked: root.startEdit()
            }
            Button {
              text: "Delete me"
              foreground: root.foreground
              fontFamily: root.fontFamily
              bordered: true
              onClicked: root.requestDelete(false)
            }
            Button {
              visible: !!root.selectedMessage() && root.selectedMessage().fromMe
              text: "Delete all"
              foreground: root.foreground
              fontFamily: root.fontFamily
              bordered: true
              onClicked: root.requestDelete(true)
            }
          }

          Text {
            width: parent.width
            visible: root.selectedMessageId.length > 0
            text: "R reply · F forward · A react · 0 unreact · E edit · D delete me · X delete all · ↑/↓ select · Esc cancel"
            textFormat: Text.PlainText
            color: root.secondaryForeground
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.WordWrap
          }

          // ── Inline reply ───────────────────────────────────────────────
          Column {
            width: parent.width
            spacing: Style.space(6)

            Item {
              width: parent.width
              visible: root.quotedMessageId.length > 0 || root.editingMessageId.length > 0
              height: visible ? Style.space(36) : 0
              Rectangle {
                anchors.fill: parent
                color: Style.normalFillFor(root.foreground, Color.accent)
                radius: Style.cornerRadius
              }
              Text {
                anchors.left: parent.left
                anchors.right: cancelQuote.left
                anchors.leftMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                text: root.editingMessageId
                  ? "Editing message"
                  : "Replying to: " + Model.truncate(root.quotedMessage() ? root.quotedMessage().text : "", 50)
                textFormat: Text.PlainText
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                elide: Text.ElideRight
              }
              PanelActionButton {
                id: cancelQuote
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                iconText: "\uf00d"
                tooltipText: "Cancel reply or edit"
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: {
                  root.quotedMessageId = ""
                  root.editingMessageId = ""
                  composer.text = ""
                }
              }
            }

            Item {
              id: pendingImagePreview
              width: parent.width
              visible: root.pendingImagePath.length > 0 && root.pendingImageJid === root.activeJid
              implicitHeight: visible ? Style.space(116) : 0
              height: implicitHeight

              Rectangle {
                anchors.fill: parent
                color: Style.normalFillFor(root.foreground, Color.accent)
                radius: Style.cornerRadius
              }

              Image {
                id: outgoingPreviewImage
                anchors.left: parent.left
                anchors.leftMargin: Style.space(6)
                anchors.verticalCenter: parent.verticalCenter
                width: Style.space(104)
                height: parent.height - Style.space(12)
                source: pendingImagePreview.visible ? Qt.resolvedUrl("file://" + root.pendingImagePath) : ""
                fillMode: Image.PreserveAspectFit
                asynchronous: true
              }

              Text {
                anchors.left: outgoingPreviewImage.right
                anchors.right: cancelImage.left
                anchors.leftMargin: Style.space(8)
                anchors.rightMargin: Style.space(6)
                anchors.verticalCenter: parent.verticalCenter
                text: root.imageSending ? "Sending image\u2026" : "Image ready to send"
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                wrapMode: Text.WordWrap
              }

              PanelActionButton {
                id: cancelImage
                anchors.right: parent.right
                anchors.rightMargin: Style.space(6)
                anchors.top: parent.top
                anchors.topMargin: Style.space(6)
                iconText: "\uf00d"
                tooltipText: "Remove image"
                enabled: !root.imageSending
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.clearPendingImage(true)
              }
            }

            Rectangle {
              id: pendingVoicePreview
              width: parent.width
              visible: root.voiceState !== "idle" && root.pendingVoiceJid === root.activeJid
              height: visible ? Style.space(38) : 0
              radius: Style.cornerRadius
              color: Style.normalFillFor(root.foreground, Color.accent)

              PanelActionButton {
                id: voicePlayButton
                anchors.left: parent.left
                anchors.leftMargin: Style.space(6)
                anchors.verticalCenter: parent.verticalCenter
                iconText: voicePreviewPlayer.playbackState === MediaPlayer.PlayingState ? "\uf04c" : "\uf04b"
                tooltipText: voicePreviewPlayer.playbackState === MediaPlayer.PlayingState ? "Pause voice preview" : "Play voice preview"
                enabled: root.voiceState === "ready" || root.voiceState === "sending"
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: {
                  if (voicePreviewPlayer.playbackState === MediaPlayer.PlayingState) voicePreviewPlayer.pause()
                  else voicePreviewPlayer.play()
                }
              }

              Text {
                anchors.left: voicePlayButton.right
                anchors.right: cancelVoice.left
                anchors.leftMargin: Style.space(8)
                anchors.rightMargin: Style.space(6)
                anchors.verticalCenter: parent.verticalCenter
                text: root.voiceState === "recording" ? "Recording  " + root.playbackTime(root.voiceSeconds * 1000)
                  : root.voiceState === "preparing" ? "Opening microphone…"
                  : root.voiceState === "stopping" || root.voiceState === "converting" ? "Preparing voice note…"
                  : root.voiceState === "sending" ? "Sending voice note…" : "Voice note  " + root.playbackTime(root.voiceSeconds * 1000)
                textFormat: Text.PlainText
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                elide: Text.ElideRight
              }

              PanelActionButton {
                id: cancelVoice
                anchors.right: parent.right
                anchors.rightMargin: Style.space(6)
                anchors.verticalCenter: parent.verticalCenter
                iconText: "\uf00d"
                tooltipText: "Discard voice note"
                enabled: root.voiceState !== "sending"
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.discardVoice()
              }
            }

            Item {
              width: parent.width
              implicitHeight: Math.max(composer.implicitHeight, sendButton.implicitHeight)

              TextField {
                id: composer
                anchors.left: parent.left
                anchors.right: emojiButton.left
                anchors.rightMargin: Style.space(6)
                anchors.verticalCenter: parent.verticalCenter
                foreground: root.foreground
                accent: root.bar ? root.bar.urgent : Color.accent
                placeholderText: root.linked
                  ? (root.editingMessageId ? "Edit message…" : pendingImagePreview.visible ? "Caption (optional)\u2026" : "Reply\u2026")
                  : "Not connected"
                enabled: root.linked && !root.imageSending && root.voiceState !== "recording"
                onAccepted: root.sendReply()
                onTextEdited: root.expandComposerShorthand()
                onTextChanged: {
                  if (!root.client || !root.activeJid || !text.length) return
                  if (!typingTimer.running) root.client.setTyping(root.activeJid, "composing")
                  typingTimer.restart()
                }
                Keys.onPressed: function (event) {
                  if (event.key === Qt.Key_V && (event.modifiers & Qt.ControlModifier)
                      && !(event.modifiers & Qt.ShiftModifier)) {
                    event.accepted = true
                    root.pasteImageOrText()
                  } else if (event.key === Qt.Key_E && (event.modifiers & Qt.ControlModifier)) {
                    event.accepted = true
                    root.toggleEmojiPicker()
                  } else if (event.key === Qt.Key_Up && (event.modifiers & Qt.ControlModifier)
                      && root.messages.length > 0) {
                    event.accepted = true
                    root.selectMessage(root.messages[root.messages.length - 1].id)
                  }
                }
                Keys.onEscapePressed: function (event) {
                  if (root.emojiPickerOpen) root.toggleEmojiPicker()
                  else if (root.editingMessageId || root.quotedMessageId) {
                    root.editingMessageId = ""
                    root.quotedMessageId = ""
                    composer.text = ""
                  }
                  else if (pendingImagePreview.visible) root.clearPendingImage(true)
                  else if (pendingVoicePreview.visible) root.discardVoice()
                  else if (composer.text.length > 0) composer.text = ""
                  else root.back()
                  event.accepted = true
                }
              }

              PanelActionButton {
                id: emojiButton
                anchors.right: voiceButton.left
                anchors.rightMargin: Style.space(4)
                anchors.verticalCenter: parent.verticalCenter
                iconText: "\uf118"
                tooltipText: "Choose an emoji"
                enabled: root.linked && !root.imageSending
                focusable: true
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.toggleEmojiPicker()
              }

              PanelActionButton {
                id: voiceButton
                anchors.right: sendButton.left
                anchors.rightMargin: Style.space(4)
                anchors.verticalCenter: parent.verticalCenter
                iconText: root.voiceState === "recording" ? "\uf04d" : "\uf130"
                tooltipText: root.voiceState === "recording" ? "Stop recording (Ctrl+Shift+R)"
                  : "Record voice note (Ctrl+Shift+R)"
                enabled: (root.linked || root.voiceState === "recording") && !root.imageSending
                  && (root.voiceState === "idle" || root.voiceState === "ready" || root.voiceState === "recording")
                focusable: true
                foreground: root.voiceState === "recording" ? (root.bar ? root.bar.urgent : Color.accent) : root.foreground
                fontFamily: root.fontFamily
                onClicked: root.toggleVoiceRecording()
              }

              PanelActionButton {
                id: sendButton
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                iconText: "\uf1d8"
                tooltipText: root.editingMessageId ? "Save edit" : pendingImagePreview.visible ? "Send image"
                  : root.voiceState === "ready" ? "Send voice note" : "Send"
                enabled: root.linked && !root.imageSending
                  && (composer.text.trim().length > 0 || pendingImagePreview.visible || root.voiceState === "ready")
                  && (root.voiceState === "idle" || root.voiceState === "ready")
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.sendReply()
              }
            }

            Column {
              width: parent.width
              spacing: Style.space(4)
              visible: root.emojiPickerOpen

              Text {
                width: parent.width
                text: root.reactionMode ? "Choose a reaction" : "Pick an emoji, or type :)  :D  LOL  <3"
                textFormat: Text.PlainText
                color: root.secondaryForeground
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
              }

              Flow {
                id: emojiGrid
                width: parent.width
                spacing: Style.space(3)
                Keys.onPressed: function (event) {
                  if (event.key === Qt.Key_Escape) {
                    root.toggleEmojiPicker()
                  } else if (event.key === Qt.Key_Right || event.key === Qt.Key_Down) {
                    root.emojiCursorIndex = Math.min(root.emojiChoices.length - 1, root.emojiCursorIndex + 1)
                  } else if (event.key === Qt.Key_Left || event.key === Qt.Key_Up) {
                    root.emojiCursorIndex = Math.max(0, root.emojiCursorIndex - 1)
                  } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter || event.key === Qt.Key_Space) {
                    root.insertEmoji(root.emojiChoices[root.emojiCursorIndex])
                  } else {
                    return
                  }
                  event.accepted = true
                }

                Repeater {
                  model: root.emojiChoices
                  delegate: Rectangle {
                    required property string modelData
                    required property int index
                    width: Style.space(30)
                    height: Style.space(30)
                    radius: Style.cornerRadius
                    color: emojiMouse.containsMouse
                      ? Style.hoverFillFor(root.foreground, root.bar ? root.bar.urgent : Color.accent)
                      : Style.normalFillFor(root.foreground, Color.accent)
                    border.width: emojiGrid.activeFocus && root.emojiCursorIndex === index ? 2 : 0
                    border.color: root.bar ? root.bar.urgent : Color.accent

                    Text {
                      anchors.centerIn: parent
                      text: modelData
                      textFormat: Text.PlainText
                      font.pixelSize: Style.font.title
                    }

                    MouseArea {
                      id: emojiMouse
                      anchors.fill: parent
                      hoverEnabled: true
                      cursorShape: Qt.PointingHandCursor
                      onContainsMouseChanged: if (containsMouse) root.emojiCursorIndex = index
                      onClicked: root.insertEmoji(modelData)
                    }
                  }
                }
              }
            }
          }
        }
      }

      ConfirmDialog {
        id: deleteConfirm
        anchors.fill: parent
        opened: root.deleteConfirmOpen
        z: 11
        focus: opened
        message: root.deleteForEveryone
          ? "Delete this message for everyone?"
          : "Delete this message for you?"
        confirmText: "Delete"
        foreground: root.foreground
        fontFamily: root.fontFamily
        onCanceled: {
          root.deleteConfirmOpen = false
          keyCatcher.forceActiveFocus()
        }
        onConfirmed: root.confirmDelete()

        Keys.onPressed: function (event) {
          if (handleKey(event)) event.accepted = true
        }
      }

      ConfirmDialog {
        id: logoutConfirm
        anchors.fill: parent
        opened: root.logoutConfirmOpen
        z: 10
        focus: opened
        message: "Log out and unlink this device?"
        confirmText: "Log out"
        foreground: root.foreground
        fontFamily: root.fontFamily
        onCanceled: root.cancelLogout()
        onConfirmed: root.confirmLogout()

        Keys.onPressed: function (event) {
          if (handleKey(event)) event.accepted = true
        }
      }
    }
  }

  // ── Desktop Screen-Centered Media Peek Window ───────────────────────
  PanelWindow {
    id: imagePeekOverlay
    visible: root.peekActive
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.namespace: "omarchy-whatsapp-peek"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: root.peekActive ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None

    onVisibleChanged: {
      if (visible) {
        Qt.callLater(function () { peekKeyCatcher.forceActiveFocus() })
      }
    }

    Rectangle {
      anchors.fill: parent
      color: Qt.rgba(0, 0, 0, 0.82)

      MouseArea {
        anchors.fill: parent
        onClicked: root.closePeek()
      }
    }

    Item {
      id: peekKeyCatcher
      anchors.fill: parent
      focus: root.peekActive

      Keys.onEscapePressed: function (event) {
        root.closePeek()
        event.accepted = true
      }

      Keys.onSpacePressed: function (event) {
        if (root.peekVideoPath) {
          if (peekVideoPlayer.playbackState === MediaPlayer.PlayingState) peekVideoPlayer.pause()
          else peekVideoPlayer.play()
          event.accepted = true
        }
      }

      Keys.onLeftPressed: function (event) {
        if (root.peekVideoPath) {
          peekVideoPlayer.position = Math.max(0, peekVideoPlayer.position - 5000)
          event.accepted = true
        }
      }

      Keys.onRightPressed: function (event) {
        if (root.peekVideoPath) {
          peekVideoPlayer.position = Math.min(peekVideoPlayer.duration, peekVideoPlayer.position + 5000)
          event.accepted = true
        }
      }

      Item {
        anchors.centerIn: parent
        width: Math.min(parent.width * 0.85, Style.space(950))
        height: Math.min(parent.height * 0.85, Style.space(850))

        Image {
          id: peekImage
          anchors.centerIn: parent
          width: Math.min(parent.width, sourceSize.width > 0 ? sourceSize.width : parent.width)
          height: Math.min(parent.height, sourceSize.height > 0 ? sourceSize.height : parent.height)
          fillMode: Image.PreserveAspectFit
          asynchronous: true
          visible: root.peekImagePath.length > 0
          source: root.peekImagePath.length > 0 ? Qt.resolvedUrl("file://" + root.peekImagePath) : ""

          MouseArea {
            anchors.fill: parent
            onClicked: function (event) { event.accepted = true }
          }
        }

        MediaPlayer {
          id: peekVideoPlayer
          source: root.peekVideoPath.length > 0 ? Qt.resolvedUrl("file://" + root.peekVideoPath) : ""
          videoOutput: peekVideo
          audioOutput: AudioOutput {}
          onSourceChanged: {
            if (root.peekVideoPath.length > 0) play()
          }
          onErrorOccurred: function (error, errorString) {
            root.videoError = errorString || "Could not play video"
          }
        }

        VideoOutput {
          id: peekVideo
          anchors.fill: parent
          anchors.bottomMargin: Style.space(44)
          visible: root.peekVideoPath.length > 0
          fillMode: VideoOutput.PreserveAspectFit
          MouseArea {
            anchors.fill: parent
            onClicked: {
              if (peekVideoPlayer.playbackState === MediaPlayer.PlayingState) peekVideoPlayer.pause()
              else peekVideoPlayer.play()
            }
          }
        }

        Text {
          visible: root.peekVideoPath.length > 0 && root.videoError.length > 0
          anchors.centerIn: parent
          width: parent.width * 0.8
          text: root.videoError
          color: "#ffffff"
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          wrapMode: Text.Wrap
          horizontalAlignment: Text.AlignHCenter
        }

        Row {
          visible: root.peekVideoPath.length > 0
          anchors.left: parent.left
          anchors.right: parent.right
          anchors.bottom: parent.bottom
          spacing: Style.space(8)

          Button {
            text: peekVideoPlayer.playbackState === MediaPlayer.PlayingState ? "Pause" : "Play"
            onClicked: {
              if (peekVideoPlayer.playbackState === MediaPlayer.PlayingState) peekVideoPlayer.pause()
              else peekVideoPlayer.play()
            }
          }
          Slider {
            width: parent.width - Style.space(130)
            from: 0
            to: Math.max(1, peekVideoPlayer.duration)
            value: peekVideoPlayer.position
            onMoved: peekVideoPlayer.position = value
          }
          Button { text: "Close"; onClicked: root.closePeek() }
        }
      }
    }
  }
}
