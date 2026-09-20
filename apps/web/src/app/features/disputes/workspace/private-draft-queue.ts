import type { DisputeDraftContent, DisputeDraftView } from '@homeservicemarketplace/contracts';

export type DraftSaveState = 'empty' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';
export interface DraftSnapshot {
  state: DraftSaveState;
  unsaved: boolean;
  busy: boolean;
  expiresAt: string | null;
}
export interface DraftTransport {
  save: (request: { version: number; content: DisputeDraftContent }) => Promise<DisputeDraftView>;
  read: () => Promise<DisputeDraftView>;
}
const empty = (): DisputeDraftContent => ({
  issueCode: '',
  requestedOutcome: '',
  statement: '',
  step: 0,
});
const signature = (value: DisputeDraftContent) =>
  JSON.stringify([value.issueCode, value.requestedOutcome, value.statement, value.step]);

/** One revision chain per form. Private prose lives only in memory and the authenticated API. */
export class PrivateDraftQueue {
  readonly enabled: boolean;
  private desired: DisputeDraftContent;
  private acknowledged: DisputeDraftContent;
  private version: number;
  private savedAt: string | null;
  private expiry: string | null;
  private active = true;
  private paused = false;
  private problem: 'error' | 'conflict' | null = null;
  private running: Promise<boolean> | null = null;
  private reading = false;
  // Keep the exact packet after a lost response. A later edit must not reuse its version.
  private packet: { version: number; content: DisputeDraftContent } | null = null;
  private listeners = new Set<() => void>();
  private snapshot: DraftSnapshot;

  constructor(
    initial: DisputeDraftView | undefined,
    private readonly transport: DraftTransport,
  ) {
    this.enabled = initial !== undefined;
    this.desired = { ...(initial?.content ?? empty()) };
    this.acknowledged = { ...this.desired };
    this.version = initial?.version ?? 0;
    this.savedAt = initial?.savedAt ?? null;
    this.expiry = initial?.expiresAt ?? null;
    this.snapshot = this.nextSnapshot();
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  setActive(active: boolean) {
    this.active = active;
  }
  update(content: DisputeDraftContent, paused: boolean) {
    this.desired = { ...content };
    this.paused = paused;
    this.emit();
  }
  private nextSnapshot(): DraftSnapshot {
    // An unacknowledged packet remains unsaved even if the user edits back to the baseline.
    const unsaved = !!this.packet || signature(this.desired) !== signature(this.acknowledged);
    const busy = !!this.running || this.reading;
    return {
      unsaved,
      busy,
      expiresAt: this.expiry,
      state:
        this.problem ?? (busy ? 'saving' : unsaved ? 'dirty' : this.savedAt ? 'saved' : 'empty'),
    };
  }
  private emit() {
    const next = this.nextSnapshot();
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    if (this.active) this.listeners.forEach((listener) => listener());
  }
  flush = (): Promise<boolean> => {
    if (!this.enabled) return Promise.resolve(true);
    if (!this.active || this.paused || this.reading || this.problem === 'conflict')
      return Promise.resolve(false);
    if (this.running) return this.running;
    this.problem = null;
    // Defer the loop so `running` is installed before the first asynchronous transport call.
    this.running = Promise.resolve()
      .then(() => this.drain())
      .finally(() => {
        this.running = null;
        this.emit();
      });
    this.emit();
    return this.running;
  };
  private async drain(): Promise<boolean> {
    while (this.packet || signature(this.desired) !== signature(this.acknowledged)) {
      if (!this.active || this.paused) return false;
      this.packet ??= { version: this.version, content: { ...this.desired } };
      const sent = this.packet;
      try {
        const receipt = await this.transport.save(sent);
        if (
          receipt.version !== sent.version + 1 ||
          !receipt.savedAt ||
          signature(receipt.content) !== signature(sent.content)
        ) {
          throw new Error('Draft acknowledgement did not match the submitted revision');
        }
        this.version = receipt.version;
        this.acknowledged = { ...sent.content };
        this.savedAt = receipt.savedAt;
        this.expiry = receipt.expiresAt;
        this.packet = null;
        this.emit();
      } catch (error) {
        const status = (error as { response?: { status?: number } })?.response?.status;
        this.problem = status === 409 ? 'conflict' : 'error';
        this.emit();
        return false;
      }
    }
    return true;
  }
  /** Only call after the user has explicitly confirmed discarding their unsent input. */
  reload = async (): Promise<DisputeDraftContent | null> => {
    if (!this.enabled || this.reading || this.paused || !this.active) return null;
    if (this.running) await this.running;
    if (!this.active) return null;
    this.reading = true;
    this.emit();
    try {
      const current = await this.transport.read();
      if (!Number.isSafeInteger(current.version) || current.version < this.version)
        throw new Error('Stale draft read');
      this.version = current.version;
      this.desired = { ...current.content };
      this.acknowledged = { ...current.content };
      this.savedAt = current.savedAt;
      this.expiry = current.expiresAt;
      this.packet = null;
      this.problem = null;
      return { ...current.content };
    } catch {
      // A failed read does not discard the local packet or silently lower its version.
      this.problem ??= 'error';
      return null;
    } finally {
      this.reading = false;
      this.emit();
    }
  };
}
