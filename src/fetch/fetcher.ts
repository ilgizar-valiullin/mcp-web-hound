import { config } from '../utils/config.js';

export interface FetcherResult {
  content: string;
  title: string;
  statusCode: number;
  fetchTimeMs: number;
  contentType: string;
}

const RETRYABLE_STATUS = [429, 500, 502, 503, 504];
const RETRYABLE_ERRORS = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'];

export class Fetcher {
  private concurrentLimit: number;
  private activeRequests = 0;
  private requestQueue: Array<() => Promise<void>> = [];
  private domainDelays = new Map<string, number>();

  constructor() {
    this.concurrentLimit = config.FETCH_CONCURRENT_LIMIT;
  }

  async fetch(url: string): Promise<FetcherResult> {
    return this.enqueue(() => this.executeFetch(url));
  }

  private async executeFetch(url: string, retryCount = 0): Promise<FetcherResult> {
    const domain = this.extractDomain(url);
    await this.enforceDomainDelay(domain);

    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(config.FETCH_TIMEOUT_MS),
        headers: {
          'User-Agent': config.FETCH_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
          'Accept-Encoding': 'gzip, deflate',
        },
        redirect: 'follow',
      });

      const fetchTimeMs = Date.now() - startTime;
      this.domainDelays.set(domain, Date.now());

      if (!response.ok) {
        if (retryCount < config.FETCH_MAX_RETRIES && RETRYABLE_STATUS.includes(response.status)) {
          await this.sleep(Math.pow(2, retryCount) * 1000);
          return this.executeFetch(url, retryCount + 1);
        }

        return {
          content: '',
          title: '',
          statusCode: response.status,
          fetchTimeMs,
          contentType: response.headers.get('content-type') ?? '',
        };
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        return {
          content: '',
          title: '',
          statusCode: response.status,
          fetchTimeMs,
          contentType,
        };
      }

      const text = await response.text();
      const truncated = text.length > config.FETCH_MAX_BODY_SIZE
        ? text.slice(0, config.FETCH_MAX_BODY_SIZE)
        : text;

      return {
        content: truncated,
        title: '',
        statusCode: response.status,
        fetchTimeMs,
        contentType,
      };
    } catch (err) {
      const errorCode = (err as NodeJS.ErrnoException).code ?? '';

      if (retryCount < config.FETCH_MAX_RETRIES && RETRYABLE_ERRORS.includes(errorCode)) {
        await this.sleep(Math.pow(2, retryCount) * 1000);
        return this.executeFetch(url, retryCount + 1);
      }

      throw err;
    }
  }

  private async enqueue(fn: () => Promise<FetcherResult>): Promise<FetcherResult> {
    if (this.activeRequests < this.concurrentLimit) {
      this.activeRequests++;
      try {
        return await fn();
      } finally {
        this.activeRequests--;
        this.processQueue();
      }
    }

    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  private processQueue(): void {
    if (this.requestQueue.length > 0 && this.activeRequests < this.concurrentLimit) {
      const next = this.requestQueue.shift();
      if (next) {
        this.activeRequests++;
        next().finally(() => {
          this.activeRequests--;
          this.processQueue();
        });
      }
    }
  }

  private async enforceDomainDelay(domain: string): Promise<void> {
    const lastRequest = this.domainDelays.get(domain);
    if (lastRequest) {
      const elapsed = Date.now() - lastRequest;
      if (elapsed < 500) {
        await this.sleep(500 - elapsed);
      }
    }
  }

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return 'unknown';
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  get activeRequestCount(): number {
    return this.activeRequests;
  }

  get queuedRequestCount(): number {
    return this.requestQueue.length;
  }
}
