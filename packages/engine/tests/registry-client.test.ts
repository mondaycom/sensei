import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RegistryClient, DEFAULT_REGISTRY_URL } from '../src/registry-client.js';

const MOCK_SUITE_INFO = {
  slug: 'sdr-qualification',
  name: 'SDR Qualification Suite',
  description: 'Sales development rep evaluation',
  category: 'sales',
  version: '1.0.0',
  avg_rating: 8.7,
  rating_count: 42,
  download_count: 156,
  belt: { name: 'Black', color: 'black' },
  publisher_name: 'sensei-team',
  tags: ['sdr', 'sales', 'cold-email'],
};

const MOCK_SEARCH_RESULT = {
  suites: [MOCK_SUITE_INFO],
  total: 1,
};

const MOCK_YAML = `id: sdr-qualification\nname: SDR Qualification Suite\nversion: "1.0.0"\nscenarios: []`;

describe('RegistryClient', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses DEFAULT_REGISTRY_URL by default', () => {
    expect(DEFAULT_REGISTRY_URL).toBe('https://sensei.sh/api/marketplace');
  });

  it('allows custom base URL via constructor', () => {
    const client = new RegistryClient('https://custom.registry/api');
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(MOCK_SEARCH_RESULT)));
    client.search('test');
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('https://custom.registry/api'));
  });

  describe('search', () => {
    it('sends correct query params', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify(MOCK_SEARCH_RESULT)));
      const client = new RegistryClient('https://api.test');
      const result = await client.search('sdr', { category: 'sales', sort: 'rating', limit: 5 });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.test/search?q=sdr&category=sales&sort=rating&limit=5',
      );
      expect(result.suites).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('throws on non-OK response', async () => {
      fetchSpy.mockResolvedValue(new Response('Server error', { status: 500 }));
      const client = new RegistryClient('https://api.test');
      await expect(client.search('fail')).rejects.toThrow('Registry search failed (500)');
    });
  });

  describe('getInfo', () => {
    it('returns suite info for valid slug', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify(MOCK_SUITE_INFO)));
      const client = new RegistryClient('https://api.test');
      const info = await client.getInfo('sdr-qualification');

      expect(fetchSpy).toHaveBeenCalledWith('https://api.test/suites/sdr-qualification');
      expect(info.slug).toBe('sdr-qualification');
      expect(info.avg_rating).toBe(8.7);
    });

    it('throws user-friendly message on 404', async () => {
      fetchSpy.mockResolvedValue(new Response('Not found', { status: 404 }));
      const client = new RegistryClient('https://api.test');
      await expect(client.getInfo('nonexistent')).rejects.toThrow(
        'Suite "nonexistent" not found in the marketplace',
      );
    });
  });

  describe('download', () => {
    it('returns YAML content', async () => {
      fetchSpy.mockResolvedValue(new Response(MOCK_YAML));
      const client = new RegistryClient('https://api.test');
      const yaml = await client.download('sdr-qualification');

      expect(fetchSpy).toHaveBeenCalledWith('https://api.test/suites/sdr-qualification/download');
      expect(yaml).toContain('sdr-qualification');
    });

    it('throws on 404', async () => {
      fetchSpy.mockResolvedValue(new Response('Not found', { status: 404 }));
      const client = new RegistryClient('https://api.test');
      await expect(client.download('missing')).rejects.toThrow(
        'Suite "missing" not found in the marketplace',
      );
    });
  });

  describe('publish', () => {
    it('sends correct payload with auth header', async () => {
      const publishResult = { slug: 'my-suite', url: 'https://sensei.sh/marketplace/my-suite' };
      fetchSpy.mockResolvedValue(new Response(JSON.stringify(publishResult)));

      const client = new RegistryClient('https://api.test');
      const result = await client.publish(
        MOCK_YAML,
        { name: 'My Suite', description: 'A test suite', tags: ['test'] },
        'sk-test-key',
      );

      expect(fetchSpy).toHaveBeenCalledWith('https://api.test/suites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer sk-test-key',
        },
        body: expect.stringContaining('"name":"My Suite"'),
      });
      expect(result.slug).toBe('my-suite');
      expect(result.url).toContain('sensei.sh');
    });

    it('throws on auth failure', async () => {
      fetchSpy.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
      const client = new RegistryClient('https://api.test');
      await expect(
        client.publish(MOCK_YAML, { name: 'Test' }, 'bad-key'),
      ).rejects.toThrow('Registry publish failed (401)');
    });
  });
});
