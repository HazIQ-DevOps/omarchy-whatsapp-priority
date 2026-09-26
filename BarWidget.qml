import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Bar entry point. Owns the daemon connection and hosts Panel.qml, mirroring
// the first-party clock/audio widgets: one manifest kind, panel loaded inside.
BarWidget {
  id: root
  moduleName: "io.github.ricky.whatsapp"

  // nf-fa-whatsapp / nf-fa-comment_slash for the unlinked state.
  readonly property string glyphLinked: "\uf232"
  readonly property string glyphOffline: "\uf232"

  readonly property string pluginDir: {
    var url = Qt.resolvedUrl(".").toString()
    if (url.indexOf("file://") === 0) url = url.substring(7)
    if (url.length > 1 && url.charAt(url.length - 1) === "/") url = url.substring(0, url.length - 1)
    return decodeURIComponent(url)
  }

  readonly property int unread: client.unread
  readonly property bool linked: client.signedIn
  readonly property bool showCount: root.setting("showUnreadCount", true) === true
  readonly property bool hideWhenEmpty: root.setting("hideWhenEmpty", false) === true
  readonly property string priorityName: String(root.setting("priorityName", "") || "")
  readonly property bool priorityAlert: Model.hasPriorityUnread(
    (client.attentionChats || []).filter(function(chat) { return !chat.archived && !root.isChatDismissed(chat) }),
    priorityName)
  property var dismissedChats: ({})
  property bool hoverGroupsExpanded: false
  readonly property var hoverChats: {
    var chats = (client.attentionChats || []).slice()
    var recent = client.chats || []
    for (var i = 0; i < recent.length; i++) {
      if (!recent[i] || chats.some(function(chat) { return chat.jid === recent[i].jid })) continue
      chats.push(recent[i])
    }
    return chats
  }
  readonly property var hoverSections: Model.hoverSections(root.hoverChats, 5, function(chat) {
    return root.isChatDismissed(chat)
  })
  readonly property var hoverIndividuals: root.hoverSections.individuals
  readonly property var hoverGroups: root.hoverSections.groups
  readonly property int hoverGroupUnread: Model.unreadMessageCount(root.hoverGroups)

  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

  function open() {
    hoverPreview.open = false
    if (panelLoader.item) panelLoader.item.open()
  }
  function close() {
    hoverPreview.open = false
    if (panelLoader.item) panelLoader.item.close()
  }
  function toggle() {
    hoverPreview.open = false
    if (panelLoader.item) panelLoader.item.toggle()
  }
  function openSearch() {
    hoverPreview.open = false
    if (!panelLoader.item) return
    panelLoader.item.open()
    panelLoader.item.focusSearch()
  }
  function closeForPopoutSwitch() { if (panelLoader.item) panelLoader.item.closeForPopoutSwitch() }

  function injectPanel() {
    if (!panelLoader.item) return
    panelLoader.item.bar = root.bar
    panelLoader.item.anchorItem = button
    panelLoader.item.hostWidget = root
    panelLoader.item.client = client
    panelLoader.item.settings = root.settings
    panelLoader.item.pluginDir = root.pluginDir
  }

  function openWebClient() {
    webLauncher.running = true
  }

  function showHoverPreview() {
    hoverClose.stop()
    if (!root.opened) hoverPreview.open = true
  }

  function scheduleHoverClose() { hoverClose.restart() }

  function isChatDismissed(chat) {
    if (!chat || !chat.jid) return false
    var stamp = dismissedChats[String(chat.jid)]
    return stamp !== undefined && Number(stamp) >= Number(chat.lastTs || 0)
  }

  function dismissChat(chat) {
    if (!chat || !chat.jid) return
    var next = Object.assign({}, dismissedChats)
    next[String(chat.jid)] = Number(chat.lastTs || 0)
    dismissedChats = next
  }

  // A notification click routes through the daemon, which broadcasts `focus` to
  // every connected panel. Only select here: `omarchy-whatsapp-focus` asks the
  // shell to open one panel, so opening them all here would pop a panel on
  // every monitor at once.
  function focusChat(jid) {
    if (!jid || !panelLoader.item) return
    hoverPreview.open = false
    panelLoader.item.prepareChat(jid)
    panelLoader.item.open()
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight
  visible: !root.hideWhenEmpty || root.unread > 0 || root.opened

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  WhatsAppClient {
    id: client
    pluginDir: root.pluginDir
    socketPath: root.setting("socketPath", "")
    autostartDaemon: root.setting("autostartDaemon", true) === true
    onFocusRequested: function (jid) { root.focusChat(jid) }
  }

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  Process {
    id: webLauncher
    command: [root.pluginDir + "/bin/omarchy-whatsapp-open", root.setting("webAppUrl", "https://web.whatsapp.com")]
  }

  Timer {
    id: hoverClose
    interval: 220
    onTriggered: if (!hoverPreview.containsMouse) hoverPreview.open = false
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: {
      var badge = Model.badgeText(root.unread)
      if (root.showCount && badge.length > 0) return root.glyphLinked + " " + badge
      return root.linked ? root.glyphLinked : root.glyphOffline
    }
    active: root.unread > 0
    activeColor: root.priorityAlert ? "#e5484d" : "#25D366"
    dimmed: !root.linked
    tooltipText: ""
    onPressed: function (buttonCode) {
      if (buttonCode === Qt.LeftButton) root.toggle()
      else if (buttonCode === Qt.RightButton) root.openWebClient()
    }

    HoverHandler {
      onHoveredChanged: {
        if (hovered) root.showHoverPreview()
        else root.scheduleHoverClose()
      }
    }
  }

  PopupCard {
    id: hoverPreview
    anchorItem: button
    bar: root.bar
    owner: root
    triggerMode: "hover"
    contentWidth: fittedContentWidth(Style.space(390), Style.space(440))
    contentHeight: fittedContentHeight(hoverContent.implicitHeight, Style.space(520))

    onContainsMouseChanged: {
      if (containsMouse) hoverClose.stop()
      else root.scheduleHoverClose()
    }

    Item {
      id: hoverClickSurface
      anchors.fill: parent

      MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.LeftButton
        cursorShape: Qt.PointingHandCursor
        onClicked: button.triggerPress(Qt.LeftButton)
      }

      Column {
        id: hoverContent
        width: parent.width
        spacing: Style.space(8)

        RowLayout {
          width: parent.width
          Text {
            Layout.fillWidth: true
            text: "WhatsApp"
            textFormat: Text.PlainText
            color: root.bar ? root.bar.foreground : Color.foreground
            font.family: root.bar ? root.bar.fontFamily : Style.font.family
            font.bold: true
            font.pixelSize: Style.font.title
            MouseArea {
              anchors.fill: parent
              cursorShape: Qt.PointingHandCursor
              onClicked: root.open()
            }
          }
          Text {
            text: root.unread > 0 ? root.unread + " unread" : ""
            textFormat: Text.PlainText
            color: root.priorityAlert ? "#e5484d" : "#25D366"
            font.family: root.bar ? root.bar.fontFamily : Style.font.family
            font.pixelSize: Style.font.caption
          }
          PanelActionButton {
            iconText: "\uf002"
            tooltipText: "Search contacts"
            foreground: root.bar ? root.bar.foreground : Color.foreground
            fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
            onClicked: root.openSearch()
          }
        }

        Text {
          visible: root.hoverIndividuals.length === 0 && root.hoverGroups.length === 0
          width: parent.width
          text: root.linked ? "No recent conversations" : "Click to link WhatsApp"
          textFormat: Text.PlainText
          color: root.bar ? root.bar.foreground : Color.foreground
          font.family: root.bar ? root.bar.fontFamily : Style.font.family
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.open()
          }
        }

        Component {
          id: hoverChatTile
          Rectangle {
            id: chatTile
            required property var modelData
            width: hoverContent.width
            height: tileContent.implicitHeight + Style.space(14)
            radius: Style.cornerRadius
            color: tileMouse.containsMouse
              ? Style.hoverFillFor(root.bar ? root.bar.foreground : Color.foreground, Color.accent)
              : Style.normalFillFor(root.bar ? root.bar.foreground : Color.foreground, Color.accent)
            border.width: 1
            border.color: {
              var ink = root.bar ? root.bar.foreground : Color.foreground
              return Qt.rgba(ink.r, ink.g, ink.b, 0.2)
            }

            Column {
              id: tileContent
              anchors.left: parent.left
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              anchors.leftMargin: Style.space(9)
              anchors.rightMargin: Style.space(9)
              spacing: Style.space(3)

              RowLayout {
                width: parent.width
                Text {
                  Layout.fillWidth: true
                  text: Model.chatTitle(chatTile.modelData)
                  textFormat: Text.PlainText
                  color: Model.isPriorityChat(chatTile.modelData, root.priorityName)
                    ? "#e5484d" : (root.bar ? root.bar.foreground : Color.foreground)
                  font.family: root.bar ? root.bar.fontFamily : Style.font.family
                  font.bold: (chatTile.modelData.unread || 0) > 0
                  elide: Text.ElideRight
                }
                Text {
                  text: (chatTile.modelData.unread || 0) > 0 ? String(chatTile.modelData.unread) : ""
                  textFormat: Text.PlainText
                  color: Model.isPriorityChat(chatTile.modelData, root.priorityName) ? "#e5484d" : "#25D366"
                  font.family: root.bar ? root.bar.fontFamily : Style.font.family
                }
              }
              Text {
                width: parent.width
                text: Model.truncate(Model.chatPreview(chatTile.modelData), 90)
                textFormat: Text.PlainText
                color: root.bar ? root.bar.foreground : Color.foreground
                opacity: 0.72
                font.family: root.bar ? root.bar.fontFamily : Style.font.family
                wrapMode: Text.Wrap
                maximumLineCount: 2
                elide: Text.ElideRight
              }
            }

            MouseArea {
              id: tileMouse
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onClicked: root.focusChat(chatTile.modelData.jid)
            }
          }
        }

        Text {
          visible: root.hoverIndividuals.length > 0 || root.hoverGroups.length > 0
          width: parent.width
          text: "Individuals"
          textFormat: Text.PlainText
          color: root.bar ? root.bar.foreground : Color.foreground
          opacity: 0.65
          font.family: root.bar ? root.bar.fontFamily : Style.font.family
          font.pixelSize: Style.font.caption
          font.bold: true
        }

        Text {
          visible: root.hoverIndividuals.length === 0 && root.hoverGroups.length > 0
          width: parent.width
          text: "No individual conversations"
          textFormat: Text.PlainText
          color: root.bar ? root.bar.foreground : Color.foreground
          opacity: 0.65
          font.family: root.bar ? root.bar.fontFamily : Style.font.family
          font.pixelSize: Style.font.caption
        }

        ListView {
          width: parent.width
          visible: root.hoverIndividuals.length > 0
          height: Math.min(contentHeight, Style.space(220))
          model: root.hoverIndividuals
          delegate: hoverChatTile
          spacing: Style.space(4)
          clip: true
          boundsBehavior: Flickable.StopAtBounds
          interactive: contentHeight > height
        }

        Rectangle {
          id: hoverGroupToggle
          visible: root.hoverGroups.length > 0
          width: parent.width
          height: Style.space(32)
          radius: Style.cornerRadius
          color: groupMouse.containsMouse
            ? Style.hoverFillFor(root.bar ? root.bar.foreground : Color.foreground, Color.accent)
            : Style.normalFillFor(root.bar ? root.bar.foreground : Color.foreground, Color.accent)
          border.width: 1
          border.color: {
            var ink = root.bar ? root.bar.foreground : Color.foreground
            return Qt.rgba(ink.r, ink.g, ink.b, 0.2)
          }

          Text {
            anchors.left: parent.left
            anchors.right: hoverGroupUnreadLabel.left
            anchors.verticalCenter: parent.verticalCenter
            anchors.margins: Style.space(9)
            text: (root.hoverGroupsExpanded ? "▾" : "▸") + "  Groups (" + root.hoverGroups.length + ")"
            textFormat: Text.PlainText
            color: root.bar ? root.bar.foreground : Color.foreground
            font.family: root.bar ? root.bar.fontFamily : Style.font.family
            font.bold: true
            elide: Text.ElideRight
          }

          Text {
            id: hoverGroupUnreadLabel
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            anchors.rightMargin: Style.space(9)
            visible: root.hoverGroupUnread > 0
            text: visible ? String(root.hoverGroupUnread) + " unread" : ""
            textFormat: Text.PlainText
            color: "#25D366"
            font.family: root.bar ? root.bar.fontFamily : Style.font.family
            font.pixelSize: Style.font.caption
            font.bold: true
          }

          MouseArea {
            id: groupMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: root.hoverGroupsExpanded = !root.hoverGroupsExpanded
          }
        }

        ListView {
          width: parent.width
          visible: root.hoverGroupsExpanded && root.hoverGroups.length > 0
          height: Math.min(contentHeight, Style.space(110))
          model: root.hoverGroups
          delegate: hoverChatTile
          spacing: Style.space(4)
          clip: true
          boundsBehavior: Flickable.StopAtBounds
          interactive: contentHeight > height
        }

        Text {
          width: parent.width
          text: "Open all chats · click a contact above to reply"
          textFormat: Text.PlainText
          color: root.bar ? root.bar.foreground : Color.foreground
          opacity: 0.6
          font.family: root.bar ? root.bar.fontFamily : Style.font.family
          font.pixelSize: Style.font.caption
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.open()
          }
        }
      }
    }
  }
}
