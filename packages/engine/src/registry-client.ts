/**
 * Registry Client — talks to the Sensei Suite Marketplace API.
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface SearchResult {
  suites: SuiteInfo[];
  total: number;
}

export interface SuiteInfo {
  slug: string;
  name: string;
  description: string;
  category: string;
  version: string;
  avg_rating: number;
  rating_count: number;
  download_count: number;
  belt: { name: string; color: string };
  publisher_name: string | null;
  tags: string[];
}

export interface PublishMetadata {
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
}

export interface PublishResult {
  slug: string;
  url: string;
}

// ─── Client ─────────────────────────────────────────────────────────

export const DEFAULT_REGISTRY_URL = 'https://sensei.sh/api/marketplace';

export class RegistryClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? process.env.SENSEI_REGISTRY_URL ?? DEFAULT_REGISTRY_URL;
  }

  /** Search suites by query string with optional filters. */
  async search(query: string, options?: { category?: string; sort?: string; limit?: number }): Promise<SearchResult> {
    const params = new URLSearchParams({ q: query });
    if (options?.category) params.set('category', options.category);
    if (options?.sort) params.set('sort', options.sort);
    if (options?.limit) params.set('limit', String(options.limit));

    const res = await fetch(`${this.baseUrl}/search?${params}`);
    if (!res.ok) {
      throw new Error(`Registry search failed (${res.status}): ${await res.text()}`);
    }
    return res.json() as Promise<SearchResult>;
  }

  /** Get detailed info about a suite by slug. */
  async getInfo(slug: string): Promise<SuiteInfo> {
    const res = await fetch(`${this.baseUrl}/suites/${encodeURIComponent(slug)}`);
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`Suite "${slug}" not found in the marketplace`);
      }
      throw new Error(`Registry getInfo failed (${res.status}): ${await res.text()}`);
    }
    return res.json() as Promise<SuiteInfo>;
  }

  /** Download the suite YAML content by slug. */
  async download(slug: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/suites/${encodeURIComponent(slug)}/download`);
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`Suite "${slug}" not found in the marketplace`);
      }
      throw new Error(`Registry download failed (${res.status}): ${await res.text()}`);
    }
    return res.text();
  }

  /** Publish a suite to the marketplace. Requires an API key. */
  async publish(yaml: string, metadata: PublishMetadata, apiKey: string): Promise<PublishResult> {
    const res = await fetch(`${this.baseUrl}/suites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ yaml, ...metadata }),
    });
    if (!res.ok) {
      throw new Error(`Registry publish failed (${res.status}): ${await res.text()}`);
    }
    return res.json() as Promise<PublishResult>;
  }
}
