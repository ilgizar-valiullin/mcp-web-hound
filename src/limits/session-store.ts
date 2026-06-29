export class SessionStore {
  private sessionExpiresAt = 0;
  private seenUrls: Set<string> = new Set();
  private windowMs: number;
  private stretchMs: number;

  constructor(windowMinutes: number, stretchMinutes: number) {
    this.windowMs = windowMinutes * 60 * 1000;
    this.stretchMs = stretchMinutes * 60 * 1000;
  }

  get enabled(): boolean {
    return this.windowMs > 0;
  }

  private ensureSession(): void {
    const now = Date.now();
    if (this.sessionExpiresAt === 0 || now >= this.sessionExpiresAt) {
      this.seenUrls.clear();
      this.sessionExpiresAt = now + this.windowMs;
    }
  }

  private tryStretchSession(): void {
    if (this.stretchMs <= 0) return;
    const now = Date.now();
    const remaining = this.sessionExpiresAt - now;
    if (remaining < this.stretchMs) {
      this.sessionExpiresAt += this.stretchMs;
    }
  }

  isSeen(url: string): boolean {
    this.ensureSession();
    return this.seenUrls.has(url);
  }

  markSeen(urls: string[]): void {
    this.ensureSession();
    this.tryStretchSession();
    for (const url of urls) {
      this.seenUrls.add(url);
    }
  }

  clear(): void {
    this.seenUrls.clear();
    this.sessionExpiresAt = 0;
  }

  size(): number {
    return this.seenUrls.size;
  }
}
