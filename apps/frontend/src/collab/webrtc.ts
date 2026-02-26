/**
 * WebRTC P2P sync layer for Yjs collaboration.
 *
 * Uses a lightweight signaling WebSocket to exchange offer/answer/ICE,
 * then opens RTCDataChannels between peers for direct Yjs sync.
 * The existing WebSocket CollabProvider remains the primary transport
 * (handles persistence, initial state); WebRTC supplements it with
 * low-latency peer-to-peer updates that work across NATs via STUN.
 */
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

type PeerState = {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  ready: boolean;
};

export type WebRTCStatus = 'disconnected' | 'connecting' | 'connected';

type WebRTCProviderOptions = {
  serverUrl: string;
  token?: string;
  projectId: string;
  filePath: string;
  doc: Y.Doc;
  awareness: Awareness;
  onStatus?: (status: WebRTCStatus, peerCount: number) => void;
};

export class WebRTCProvider {
  private serverUrl: string;
  private token: string;
  private projectId: string;
  private filePath: string;
  private doc: Y.Doc;
  private awareness: Awareness;
  private onStatus?: (status: WebRTCStatus, peerCount: number) => void;

  private ws: WebSocket | null = null;
  private peerId = '';
  private peers = new Map<string, PeerState>();
  private shouldReconnect = false;
  private reconnectAttempts = 0;
  private docUpdateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;
  private awarenessUpdateHandler:
    | ((update: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => void)
    | null = null;

  constructor(options: WebRTCProviderOptions) {
    this.serverUrl = options.serverUrl.replace(/\/$/, '');
    this.token = options.token || '';
    this.projectId = options.projectId;
    this.filePath = options.filePath;
    this.doc = options.doc;
    this.awareness = options.awareness;
    this.onStatus = options.onStatus;
  }

  connect() {
    this.shouldReconnect = true;
    this.attachDocListeners();
    this.openSignaling();
  }

  disconnect() {
    this.shouldReconnect = false;
    this.detachDocListeners();
    for (const [id] of this.peers) {
      this.closePeer(id);
    }
    this.peers.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.onStatus?.('disconnected', 0);
  }

  get connectedPeerCount(): number {
    let count = 0;
    for (const [, p] of this.peers) {
      if (p.ready) count++;
    }
    return count;
  }

  // ── Signaling ──

  private openSignaling() {
    const wsBase = this.serverUrl.replace(/^http/, 'ws');
    const qs = new URLSearchParams({
      projectId: this.projectId,
      file: this.filePath,
    });
    if (this.token) qs.set('token', this.token);
    const url = `${wsBase}/api/collab/signal?${qs}`;

    this.onStatus?.('connecting', 0);
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
    };

    ws.onmessage = (event) => {
      let msg: { type: string; [k: string]: unknown };
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'welcome':
          this.peerId = msg.id as string;
          // Initiate connections to existing peers (we are the offerer)
          for (const id of msg.peers as string[]) {
            this.createPeer(id, true);
          }
          this.emitStatus();
          break;
        case 'peer-joined':
          // New peer will send us an offer, we wait
          break;
        case 'peer-left':
          this.closePeer(msg.id as string);
          this.emitStatus();
          break;
        case 'signal':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          this.handleSignal(msg.from as string, msg.data as any);
          break;
      }
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.shouldReconnect) {
        const delay = Math.min(15_000, 1000 * Math.pow(2, this.reconnectAttempts));
        this.reconnectAttempts++;
        setTimeout(() => this.openSignaling(), delay);
      }
      this.onStatus?.('disconnected', 0);
    };

    ws.onerror = () => {
      // close event will handle reconnect
    };
  }

  private sendSignal(to: string, data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'signal', to, data }));
    }
  }

  // ── Peer connection management ──

  private createPeer(remoteId: string, initiator: boolean) {
    if (this.peers.has(remoteId)) return;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const state: PeerState = { pc, dc: null, ready: false };
    this.peers.set(remoteId, state);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendSignal(remoteId, { type: 'ice', candidate: e.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.closePeer(remoteId);
        this.emitStatus();
      }
    };

    if (initiator) {
      const dc = pc.createDataChannel('yjs', { ordered: true });
      state.dc = dc;
      this.setupDataChannel(dc, remoteId, state);
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          this.sendSignal(remoteId, { type: 'offer', sdp: pc.localDescription });
        })
        .catch(() => this.closePeer(remoteId));
    } else {
      pc.ondatachannel = (e) => {
        state.dc = e.channel;
        this.setupDataChannel(e.channel, remoteId, state);
      };
    }
  }

  private setupDataChannel(dc: RTCDataChannel, remoteId: string, state: PeerState) {
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      state.ready = true;
      this.emitStatus();

      // Send initial sync step 1
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      dc.send(encoding.toUint8Array(encoder) as unknown as ArrayBuffer);

      // Send current awareness state
      const awarenessStates = this.awareness.getStates();
      if (awarenessStates.size > 0) {
        const update = awarenessProtocol.encodeAwarenessUpdate(
          this.awareness,
          Array.from(awarenessStates.keys()),
        );
        const aEncoder = encoding.createEncoder();
        encoding.writeVarUint(aEncoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(aEncoder, update);
        dc.send(encoding.toUint8Array(aEncoder) as unknown as ArrayBuffer);
      }
    };

    dc.onmessage = (event) => {
      const data = new Uint8Array(event.data as ArrayBuffer);
      this.handlePeerMessage(data, remoteId);
    };

    dc.onclose = () => {
      state.ready = false;
      this.emitStatus();
    };

    dc.onerror = () => {
      state.ready = false;
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleSignal(from: string, data: any) {
    if (data.type === 'offer') {
      // We received an offer — create answerer peer
      this.createPeer(from, false);
      const state = this.peers.get(from);
      if (!state) return;
      try {
        await state.pc.setRemoteDescription(data.sdp);
        const answer = await state.pc.createAnswer();
        await state.pc.setLocalDescription(answer);
        this.sendSignal(from, { type: 'answer', sdp: state.pc.localDescription });
      } catch {
        this.closePeer(from);
      }
    } else if (data.type === 'answer') {
      const state = this.peers.get(from);
      if (!state) return;
      try {
        await state.pc.setRemoteDescription(data.sdp);
      } catch {
        this.closePeer(from);
      }
    } else if (data.type === 'ice') {
      const state = this.peers.get(from);
      if (!state) return;
      try {
        await state.pc.addIceCandidate(data.candidate);
      } catch {
        // non-fatal
      }
    }
  }

  private closePeer(id: string) {
    const state = this.peers.get(id);
    if (!state) return;
    state.ready = false;
    try { state.dc?.close(); } catch { /* */ }
    try { state.pc.close(); } catch { /* */ }
    this.peers.delete(id);
  }

  // ── Yjs message handling ──

  private handlePeerMessage(data: Uint8Array, _from: string) {
    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);
    if (messageType === MESSAGE_SYNC) {
      const replyEncoder = encoding.createEncoder();
      encoding.writeVarUint(replyEncoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, replyEncoder, this.doc, this);
      if (encoding.length(replyEncoder) > 1) {
        this.broadcastToPeers(encoding.toUint8Array(replyEncoder));
      }
    } else if (messageType === MESSAGE_AWARENESS) {
      const update = decoding.readVarUint8Array(decoder);
      awarenessProtocol.applyAwarenessUpdate(this.awareness, update, this);
    }
  }

  private broadcastToPeers(payload: Uint8Array, excludePeerId?: string) {
    for (const [id, state] of this.peers) {
      if (id === excludePeerId) continue;
      if (state.ready && state.dc?.readyState === 'open') {
        try {
          state.dc.send(payload as unknown as ArrayBuffer);
        } catch {
          // channel may have just closed
        }
      }
    }
  }

  private attachDocListeners() {
    if (this.docUpdateHandler) return;

    this.docUpdateHandler = (update, origin) => {
      if (origin === this) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcastToPeers(encoding.toUint8Array(encoder));
    };

    this.awarenessUpdateHandler = ({ added, updated, removed }, origin) => {
      if (origin === this) return;
      const changedClients = added.concat(updated).concat(removed);
      const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, update);
      this.broadcastToPeers(encoding.toUint8Array(encoder));
    };

    this.doc.on('update', this.docUpdateHandler);
    this.awareness.on('update', this.awarenessUpdateHandler);
  }

  private detachDocListeners() {
    if (this.docUpdateHandler) {
      this.doc.off('update', this.docUpdateHandler);
      this.docUpdateHandler = null;
    }
    if (this.awarenessUpdateHandler) {
      this.awareness.off('update', this.awarenessUpdateHandler);
      this.awarenessUpdateHandler = null;
    }
  }

  private emitStatus() {
    const count = this.connectedPeerCount;
    const status: WebRTCStatus = count > 0 ? 'connected' : this.ws ? 'connecting' : 'disconnected';
    this.onStatus?.(status, count);
  }
}
