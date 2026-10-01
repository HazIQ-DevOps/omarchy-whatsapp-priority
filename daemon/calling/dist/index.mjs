/**
 * baileys-caller — WhatsApp voice calling for Node.js.
 *
 * Wraps WhatsApp Web's official VoIP WASM stack and routes signaling through
 * Baileys. Public surface:
 *
 *   const client = new VoipClient({ authDir })
 *   await client.connect()
 *   const call = await client.call("12345678901", { audioSource: "./hi.mp3" })
 *
 * @author ShellTear
 */
import { EventEmitter } from "node:events";
import { randomBytes, createHmac, createHash } from "node:crypto";
import { resolve } from "node:path";
import { WasmEngine } from "./wasm-engine.mjs";
import { RelayRtcTransport } from "./relay-transport.mjs";
import { SignalingBridge } from "./signaling.mjs";
import { AudioFeeder } from "./audio-feeder.mjs";
import { CallState } from "./types.mjs";
export { CallState } from "./types.mjs";
const SHA256_LEN = 32;
const loadBaileys = async () => {
    try {
        return await import("baileys");
    }
    catch {
        throw new Error("Could not import baileys. Install it as a peer dependency.");
    }
};
const toBareJid = (jid) => {
    if (!jid)
        return jid;
    const at = jid.indexOf("@");
    if (at < 0)
        return jid;
    const user = jid.slice(0, at).split(":")[0];
    return `${user}@${jid.slice(at + 1)}`;
};
const computeHkdf = (key, salt, info, length) => {
    const effectiveSalt = salt && salt.length > 0 ? Buffer.from(salt) : Buffer.alloc(SHA256_LEN, 0);
    const prk = createHmac("sha256", effectiveSalt).update(key).digest();
    const blocks = Math.ceil(length / SHA256_LEN);
    const okm = Buffer.alloc(blocks * SHA256_LEN);
    let prev = Buffer.alloc(0);
    for (let i = 1; i <= blocks; i += 1) {
        prev = createHmac("sha256", prk)
            .update(prev)
            .update(info)
            .update(Buffer.from([i]))
            .digest();
        prev.copy(okm, (i - 1) * SHA256_LEN);
    }
    return new Uint8Array(okm.buffer, okm.byteOffset, length);
};
const computeHmacSha256 = (data, key) => {
    const result = createHmac("sha256", Buffer.from(key)).update(data).digest();
    return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
};
const isCallReceiptNode = (node) => {
    if (node?.tag !== "receipt")
        return false;
    const child = Array.isArray(node.content) ? node.content[0] : null;
    return !!(child?.attrs?.["call-id"] || child?.attrs?.call_id);
};
/** A live or recently-ended call. */
export class ActiveCall extends EventEmitter {
    callId;
    engine;
    #state = CallState.Idle;
    incoming = false;
    peerJid = "";
    accept = (audioSource = "microphone:", durationMs = 600_000) => {
        if (this.#ended || !this.incoming || this.#state !== CallState.ReceivedCall)
            throw new Error("This incoming call is no longer ringing");
        this._audioSource = audioSource;
        this.engine.acceptCall();
        if (this.#endTimer)
            clearTimeout(this.#endTimer);
        this.#endTimer = setTimeout(() => this.end(), durationMs);
    };
    decline = () => {
        if (this.#ended)
            return;
        try {
            this.engine.rejectCall();
        }
        finally {
            this._forceEnd("declined");
        }
    };
    #endResolver;
    #endPromise;
    #endTimer = null;
    #ended = false;
    /** @internal mirrors the source path for the audio feeder */
    _audioSource = "silence";
    constructor(callId, engine, durationMs) {
        super();
        this.callId = callId;
        this.engine = engine;
        this.#endPromise = new Promise((res) => { this.#endResolver = res; });
        if (durationMs > 0) {
            this.#endTimer = setTimeout(() => this.end(), durationMs);
        }
    }
    get state() { return this.#state; }
    end = () => {
        if (this.#ended)
            return;
        try {
            this.engine.endCall(0, true);
        }
        catch { }
        this._forceEnd("hangup");
    };
    mute = (muted) => {
        try {
            this.engine.setMute(muted);
        }
        catch { }
    };
    waitForEnd = () => this.#endPromise;
    /** @internal — called by VoipClient on WASM call-state change */
    _updateState = (state) => {
        this.#state = state;
        if (state === CallState.PreacceptReceived)
            this.emit("ringing");
        else if (state === CallState.Active)
            this.emit("connected");
        else if (state === CallState.Idle || state === CallState.Ending || state === CallState.ActiveElsewhere) {
            this._forceEnd("ended");
        }
    };
    /** @internal */
    _emitAudio = (pcm) => { this.emit("audio", pcm); };
    /** @internal */
    _forceEnd = (reason) => {
        if (this.#ended)
            return;
        this.#ended = true;
        if (this.#endTimer) {
            clearTimeout(this.#endTimer);
            this.#endTimer = null;
        }
        this.emit("ended", reason);
        this.#endResolver(reason);
    };
}
/** Top-level client. Connects to WhatsApp and lets you place calls. */
export class VoipClient extends EventEmitter {
    #config;
    #engine = null;
    #relay = null;
    #signaling = null;
    #sock = null;
    #activeCall = null;
    #baileys = null;
    #closed = false;
    #socketHandlers = [];
    #retryTimer = null;
    #connectionReject = null;
    // Capture state populated when WASM negotiates audio params
    #capturePtr = 0;
    #captureChunkBytes = 0;
    #captureSampleRate = 16000;
    #captureChannels = 1;
    #captureFramesPerChunk = 320;
    #feeder = null;
    constructor(config) {
        super();
        this.#config = config;
    }
    /** Connect to WhatsApp and bring up the WASM VoIP stack. */
    connect = async () => {
        this.#closed = false;
        this.emit("stage", "Connecting to WhatsApp");
        this.#baileys = await loadBaileys();
        if (this.#config.socket) {
            this.#sock = this.#config.socket;
            await this.#initializeCalling();
            return;
        }
        const { useMultiFileAuthState, default: makeWASocket, DisconnectReason } = this.#baileys;
        const makeSocket = makeWASocket ?? this.#baileys.makeWASocket ?? this.#baileys;
        const authDir = resolve(this.#config.authDir);
        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        const silentLogger = {
            level: "silent",
            child: () => silentLogger,
            trace: () => { },
            debug: () => { },
            info: () => { },
            warn: () => { },
            error: () => { },
            fatal: () => { },
        };
        const { version } = await this.#baileys.fetchLatestBaileysVersion();
        if (this.#closed)
            throw new Error("Connection cancelled");
        const createSocket = () => makeSocket({
            version,
            browser: ["Omarchy Calling Lab", "Chrome", "1.0.0"],
            syncFullHistory: false,
            markOnlineOnConnect: false,
            auth: state,
            emitOwnEvents: true,
            logger: silentLogger,
        });
        // Connect with auto-reconnect on the post-QR 515 stream-error path.
        await new Promise((resolveOpen, rejectOpen) => {
            this.#connectionReject = rejectOpen;
            let opened = false;
            let retries = 0;
            const maxRetries = 5;
            const connectSocket = () => {
                if (this.#closed)
                    return;
                const socket = createSocket();
                this.#sock = socket;
                socket.ev.on("creds.update", () => { if (!this.#closed && this.#sock === socket)
                    void saveCreds().catch(() => { }); });
                socket.ev.on("connection.update", (update) => {
                    if (this.#closed || this.#sock !== socket)
                        return;
                    const code = update.lastDisconnect?.error?.output?.statusCode;
                    if (update.connection)
                        this.emit("connection-detail", { state: update.connection, code: code ?? null });
                    if (update.qr)
                        this.emit("qr", update.qr);
                    if (update.connection === "open") {
                        opened = true;
                        this.#connectionReject = null;
                        this.emit("stage", "WhatsApp linked · starting calling engine");
                        resolveOpen();
                        return;
                    }
                    if (update.connection === "close" && opened) {
                        this.emit("disconnected", { code, message: update.lastDisconnect?.error?.message ?? "Connection closed" });
                    }
                    if (update.connection === "close" && !opened) {
                        const statusCode = update.lastDisconnect?.error?.output?.statusCode;
                        const shouldReconnect = statusCode === 515 || statusCode === DisconnectReason?.restartRequired;
                        if (shouldReconnect && retries < maxRetries) {
                            retries += 1;
                            this.#retryTimer = setTimeout(connectSocket, 1000);
                        }
                        else {
                            const err = new Error(`${update.lastDisconnect?.error?.message ?? "WhatsApp connection closed"} (code ${statusCode ?? "unknown"})`);
                            err.statusCode = statusCode;
                            this.#connectionReject = null;
                            rejectOpen(err);
                        }
                    }
                });
            };
            connectSocket();
        });
        await this.#initializeCalling();
    };
    #initializeCalling = async () => {
        if (this.#closed)
            throw new Error("Connection cancelled");
        this.#signaling = new SignalingBridge({ sock: this.#sock, onError: error => this.emit("signaling-error", error), onTrace: data => this.emit("signaling-trace", data) });
        await this.#signaling.init();
        this.#relay = new RelayRtcTransport({
            onTransportMessage: (data, ip, port) => this.#engine?.handleOnTransportMessage(data, ip, port),
            onIceRtt: (rttMs, ip, port) => this.#engine?.updateIceRtt(rttMs, ip, port),
        });
        this.#engine = new WasmEngine({
            enableLogs: process.env.OMARCHY_WHATSAPP_CALL_DEBUG === "1",
            callbacks: {
                onLog: (level, message) => {
                    if (/offer|incoming|reject|parse|error|fail/i.test(message))
                        this.emit("native-log", { level, message: message.replace(/[\w:+.-]+@(s\.whatsapp\.net|lid|g\.us)/g, jid => { const [user, domain] = jid.split("@"); const device = user.includes(":") ? user.split(":")[1] : "none"; return `[peer-${createHash("sha256").update(user.split(":")[0]).digest("hex").slice(0, 8)}:device=${device}@${domain}]`; }).replace(/[0-9a-f]{16,}/gi, "[value]").replace(/\d{7,}/g, "[number]") });
                },
                onSignalingXmpp: (peerJid, callId, xmlPayload) => this.#signaling.sendSignaling(peerJid, callId, xmlPayload),
                onCallEvent: (eventType, eventData) => this.#handleCallEvent(eventType, eventData),
                sendDataToRelay: (data, ip, port) => this.#relay.send(data, ip, port),
                onAudioCaptureInit: (config) => this.#handleAudioCaptureInit(config),
                onAudioCaptureStart: () => this.#handleAudioCaptureStart(),
                onAudioCaptureStop: () => this.#handleAudioCaptureStop(),
                onAudioPlaybackInit: (config) => this.emit("playback-config", config),
                onAudioPlaybackData: (audioData) => this.#activeCall?._emitAudio(audioData),
                cryptoHkdf: computeHkdf,
                hmacSha256: computeHmacSha256,
            },
        });
        const engine = this.#engine;
        await engine.initialize();
        if (this.#closed) {
            engine.destroy();
            throw new Error("Connection cancelled");
        }
        this.#signaling.attachEngine(engine);
        const selfPnJid = this.#sock.authState.creds.me?.id;
        const selfLidJid = this.#sock.authState.creds.me?.lid;
        await this.#engine.initVoipStack(selfPnJid, toBareJid(selfPnJid), selfLidJid);
        await this.#engine.waitForVoipStackReady();
        if (this.#closed)
            throw new Error("Connection cancelled");
        this.emit("stage", "Ready for voice calls");
        try {
            this.#engine.updateNetworkMedium(2, 0);
        }
        catch { }
        const signaling = this.#signaling;
        const onCall = (node) => {
            if (this.#closed)
                return;
            const child = Array.isArray(node.content) ? node.content[0] : null;
            this.emit("call-stanza", { tag: child?.tag ?? "unknown", offline: !!node.attrs?.offline, attrs: Object.keys(child?.attrs ?? {}), children: Array.isArray(child?.content) ? child.content.map((c) => c.tag) : [], platform: child?.attrs?.platform ?? node.attrs?.platform, version: child?.attrs?.version ?? node.attrs?.version });
            const callId = String(child?.attrs?.["call-id"] ?? child?.attrs?.call_id ?? "");
            if (child?.tag === "offer" && callId && !this.#activeCall && !this.#pendingIncoming) {
                const children = Array.isArray(child.content) ? child.content : [];
                const unsupported = children.some((item) => item?.tag === "video")
                    || !!child.attrs?.["group-jid"] || !!child.attrs?.["group-call"];
                if (unsupported)
                    return; // Leave video and group offers to other linked devices.
                const pending = { callId, peerJid: toBareJid(String(child.attrs?.["call-creator"] || node.attrs?.from || "")) };
                this.#pendingIncoming = pending;
                setTimeout(() => { if (this.#pendingIncoming === pending)
                    this.#pendingIncoming = null; }, 60_000).unref();
            }
            if (child?.tag === "terminate" && this.#pendingIncoming?.callId === callId)
                this.#pendingIncoming = null;
            signaling.processIncomingCall(node, engine, this.#activeCall?.callId ?? this.#pendingIncoming?.callId ?? "");
        };
        const onReceipt = (node) => {
            if (!this.#closed && isCallReceiptNode(node))
                signaling.processIncomingReceipt(node, engine, this.#activeCall?.callId ?? "");
        };
        this.#socketHandlers = [["CB:call", onCall], ["CB:receipt", onReceipt]];
        for (const [name, handler] of this.#socketHandlers)
            this.#sock.ws.on(name, handler);
    };
    /** Place an outbound voice call. */
    call = async (phoneNumber, opts = {}) => {
        if (!this.#engine || !this.#signaling)
            throw new Error("Not connected. Call connect() first.");
        if (this.#activeCall || this.#pendingIncoming)
            throw new Error("A call is already active.");
        const targetNumber = phoneNumber.replace(/\D/g, "");
        const targetPnJid = `${targetNumber}@s.whatsapp.net`;
        const durationMs = opts.durationMs ?? 120_000;
        const audioSource = opts.audioSource ?? "silence";
        const peerLid = await this.#signaling.resolveLid(targetPnJid);
        if (!peerLid)
            throw new Error(`Could not resolve LID for ${targetPnJid}`);
        for (const jid of [targetPnJid, peerLid]) {
            try {
                await this.#sock.presenceSubscribe(jid);
            }
            catch { }
        }
        await new Promise((r) => setTimeout(r, 750));
        const peerDeviceJids = await this.#signaling.discoverPeerDevices(peerLid);
        const deviceList = peerDeviceJids.length ? peerDeviceJids : [toBareJid(peerLid)];
        await this.#signaling.ensureSessionsForPeers(deviceList);
        await new Promise((r) => setTimeout(r, 500));
        await this.#signaling.issueTcToken(peerLid);
        const tcToken = await this.#signaling.ensureTcToken(peerLid, targetPnJid);
        if (!this.#engine || !this.#signaling)
            throw new Error("Call cancelled or device disconnected");
        const callId = ("00" + randomBytes(16).toString("hex").slice(2)).toUpperCase();
        const call = new ActiveCall(callId, this.#engine, durationMs);
        call.once("ended", () => {
            this.#handleAudioCaptureStop();
            this.#relay?.closeAll();
            this.#activeCall = null;
        });
        call._audioSource = audioSource;
        this.#activeCall = call;
        this.#engine.startCall({
            peerJid: peerLid,
            peerPn: targetPnJid,
            peerList: deviceList,
            callId,
            isVideo: false,
            isLidCall: true,
            isFromDialer: false,
            extraData: tcToken,
        });
        return call;
    };
    /** Tear down the WhatsApp socket and release resources. */
    disconnect = () => {
        this.#closed = true;
        this.#pendingIncoming = null;
        if (this.#retryTimer) {
            clearTimeout(this.#retryTimer);
            this.#retryTimer = null;
        }
        this.#connectionReject?.(new Error("Connection cancelled"));
        this.#connectionReject = null;
        this.#activeCall?.end();
        this.#handleAudioCaptureStop();
        this.#activeCall = null;
        this.#relay?.closeAll();
        this.#engine?.destroy();
        for (const [name, handler] of this.#socketHandlers)
            this.#sock?.ws?.off?.(name, handler);
        this.#socketHandlers = [];
        this.#signaling?.destroy();
        if (!this.#config.socket)
            this.#sock?.end?.();
        this.#engine = null;
        this.#relay = null;
        this.#signaling = null;
        this.#sock = null;
    };
    // ─── private ──────────────────────────────────────────────────────────────
    #pendingIncoming = null;
    #handleCallEvent = (eventType, eventData) => {
        this.emit("engine-event", { eventType });
        if (eventType === 16 && eventData) {
            try {
                const parsed = JSON.parse(eventData);
                const info = parsed.call_info ?? parsed.callInfo ?? {};
                const callState = Number(info.call_state ?? info.callState ?? 0);
                this.emit("call-state-diagnostic", { callState, fields: Object.keys(parsed), infoFields: Object.keys(info), pendingIncoming: !!this.#pendingIncoming });
                if (callState === CallState.ReceivedCall && !this.#activeCall && this.#pendingIncoming && this.#engine) {
                    const incoming = this.#pendingIncoming;
                    this.#pendingIncoming = null;
                    const call = new ActiveCall(incoming.callId, this.#engine, 60_000);
                    call.incoming = true;
                    call.peerJid = incoming.peerJid;
                    this.#activeCall = call;
                    call.once("ended", () => {
                        this.#handleAudioCaptureStop();
                        this.#relay?.closeAll();
                        if (this.#activeCall === call)
                            this.#activeCall = null;
                    });
                    call._updateState(callState);
                    this.emit("incoming-call", call);
                }
                else
                    this.#activeCall?._updateState(callState);
                if (callState === CallState.Idle || callState === CallState.Ending)
                    this.#pendingIncoming = null;
            }
            catch { }
        }
        else if (eventType === 156 && eventData) {
            try {
                const update = JSON.parse(eventData);
                this.#relay?.updateRelayList(update);
            }
            catch { }
        }
        // Event 2 is emitted for an incoming offer, not a terminal event.
        // State-change event 16 (Idle/Ending/ActiveElsewhere) owns call teardown.
    };
    #handleAudioCaptureInit = (config) => {
        if (!this.#engine)
            return;
        this.#captureSampleRate = config.sampleRate || 16000;
        this.#captureChannels = config.channels || 1;
        this.#captureFramesPerChunk = config.framesPerChunk || 320;
        const chunkSamples = this.#captureFramesPerChunk * this.#captureChannels;
        this.#captureChunkBytes = chunkSamples * Float32Array.BYTES_PER_ELEMENT;
        this.#capturePtr = this.#engine.malloc(this.#captureChunkBytes);
    };
    #handleAudioCaptureStart = () => {
        if (!this.#engine || !this.#capturePtr)
            return;
        const audioSource = this.#activeCall?._audioSource ?? "silence";
        this.#feeder = new AudioFeeder(this.#captureSampleRate, this.#captureChannels, this.#captureFramesPerChunk, (chunk) => {
            if (this.#engine && this.#capturePtr)
                this.#engine.sendAudioData(chunk, this.#capturePtr);
        }, audioSource, (message) => this.emit("audio-error", message));
        this.#feeder.start();
    };
    #handleAudioCaptureStop = () => {
        this.#feeder?.stop();
        this.#feeder = null;
        if (this.#engine && this.#capturePtr) {
            try {
                this.#engine.free(this.#capturePtr);
            }
            catch { }
            this.#capturePtr = 0;
        }
    };
}
