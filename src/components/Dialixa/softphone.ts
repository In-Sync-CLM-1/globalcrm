import type { SimpleUser } from "sip.js/lib/platform/web";

export interface SoftphoneLogin {
  ws_url: string;
  domain: string;
  ice_servers: RTCIceServer[];
  extension: string;
  username: string;
  password: string;
}

export type LineState = "connecting" | "ready" | "offline" | "refused";

export interface SoftphoneEvents {
  onLine: (s: LineState) => void;
  onRinging: (number: string) => void;
  onAnswered: () => void;
  onEnded: () => void;
}

/** The softphone line inside the CRM: one registered extension, one call at a time. Loaded only when used. */
export class Softphone {
  private user: SimpleUser | null = null;
  private stopped = false;
  private retry: number | undefined;

  constructor(private login: SoftphoneLogin, private audio: HTMLAudioElement, private events: SoftphoneEvents) {}

  async start() {
    const { SimpleUser } = await import("sip.js/lib/platform/web");
    if (this.stopped) return;
    const { login } = this;
    const user = new SimpleUser(login.ws_url, {
      aor: `sip:${login.username}@${login.domain}`,
      media: { constraints: { audio: true, video: false }, remote: { audio: this.audio } },
      reconnectionAttempts: 5,
      reconnectionDelay: 4,
      userAgentOptions: {
        authorizationUsername: login.username,
        authorizationPassword: login.password,
        displayName: login.extension,
        logBuiltinEnabled: false,
        sessionDescriptionHandlerFactoryOptions: login.ice_servers.length
          ? { peerConnectionConfiguration: { iceServers: login.ice_servers } }
          : {},
      },
    });
    this.user = user;
    user.delegate = {
      onServerConnect: () => { this.register(); },
      onServerDisconnect: () => { if (!this.stopped) { this.events.onLine("offline"); this.retryLater(); } },
      onRegistered: () => this.events.onLine("ready"),
      onUnregistered: () => { if (!this.stopped) this.events.onLine("offline"); },
      onCallReceived: () => this.events.onRinging(this.remoteNumber()),
      onCallAnswered: () => this.events.onAnswered(),
      onCallHangup: () => this.events.onEnded(),
    };
    this.connect();
  }

  private async connect() {
    if (this.stopped || !this.user) return;
    this.events.onLine("connecting");
    try { await this.user.connect(); } catch { this.events.onLine("offline"); this.retryLater(); }
  }

  private register() {
    this.user?.register({
      requestDelegate: {
        onReject: (r) => {
          const code = r.message.statusCode ?? 0;
          if (code === 401 || code === 403 || code === 404 || code === 407) this.events.onLine("refused");
          else this.events.onLine("offline");
        },
      },
    }).catch(() => this.events.onLine("offline"));
  }

  private retryLater() {
    window.clearTimeout(this.retry);
    this.retry = window.setTimeout(() => {
      if (!this.stopped && this.user && !this.user.isConnected()) this.connect();
    }, 30_000);
  }

  /** The number of whoever is calling this extension. */
  private remoteNumber(): string {
    const session = (this.user as unknown as { session?: { remoteIdentity?: { uri?: { user?: string } } } })?.session;
    return session?.remoteIdentity?.uri?.user ?? "";
  }

  answer() { return this.user?.answer(); }
  decline() { return this.user?.decline(); }
  hangup() { return this.user?.hangup(); }
  setMuted(m: boolean) { if (m) this.user?.mute(); else this.user?.unmute(); }
  setHeld(h: boolean) { return h ? this.user?.hold() : this.user?.unhold(); }
  tone(t: string) { return this.user?.sendDTMF(t); }

  async stop() {
    this.stopped = true;
    window.clearTimeout(this.retry);
    const u = this.user;
    this.user = null;
    if (!u) return;
    try { await u.unregister(); } catch { /* already gone */ }
    try { await u.disconnect(); } catch { /* already gone */ }
  }
}
