import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GraphLoader } from '../../src/GraphLoader';

describe('GraphLoader', () => {
  let loader: GraphLoader;

  beforeEach(() => {
    loader = new GraphLoader(1000);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('checkForUpdates', () => {
    it('returns true when version has changed', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ buildTime: 'v2' }),
      });
      const changed = await loader.checkForUpdates();
      expect(changed).toBe(true);
    });

    it('returns false when version is unchanged on second poll', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ buildTime: 'v1' }),
      });
      await loader.checkForUpdates(); // primes lastSeenVersion = 'v1'
      const changed = await loader.checkForUpdates();
      expect(changed).toBe(false);
    });

    it('returns true on each new distinct version', async () => {
      const mockFetch = fetch as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ buildTime: 'v1' }) });
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ buildTime: 'v2' }) });

      await loader.checkForUpdates(); // v1 → true
      const changed = await loader.checkForUpdates(); // v2 → true
      expect(changed).toBe(true);
    });

    it('returns false when the response is not ok', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
      const changed = await loader.checkForUpdates();
      expect(changed).toBe(false);
    });

    it('returns false on network error', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
      const changed = await loader.checkForUpdates();
      expect(changed).toBe(false);
    });
  });

  describe('loadGraph', () => {
    it('returns graph data on success', async () => {
      const mockData = { nodes: [{ id: 'a' }], edges: [], lastUpdated: 'v1' };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });
      const result = await loader.loadGraph();
      expect(result).toEqual(mockData);
    });

    it('caches the loaded graph', async () => {
      const mockData = { nodes: [], edges: [], lastUpdated: 'v1' };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });
      await loader.loadGraph();
      expect(loader.getCachedGraph()).toEqual(mockData);
    });

    it('returns cached graph when fetch response is not ok', async () => {
      const mockData = { nodes: [], edges: [], lastUpdated: 'v1' };
      const mockFetch = fetch as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockData });
      await loader.loadGraph(); // populate cache

      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' });
      const result = await loader.loadGraph();
      expect(result).toEqual(mockData);
    });

    it('returns null when fetch fails and there is no cache', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });
      const result = await loader.loadGraph();
      expect(result).toBeNull();
    });

    it('returns cached graph on network error when cache exists', async () => {
      const mockData = { nodes: [], edges: [], lastUpdated: 'v1' };
      const mockFetch = fetch as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockData });
      await loader.loadGraph(); // populate cache

      mockFetch.mockRejectedValue(new Error('Network error'));
      const result = await loader.loadGraph();
      expect(result).toEqual(mockData);
    });

    it('returns null on network error with no cache', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
      const result = await loader.loadGraph();
      expect(result).toBeNull();
    });

    it('primes lastSeenVersion from graph.lastUpdated on first load', async () => {
      const mockData = { nodes: [], edges: [], lastUpdated: 'build-123' };
      (fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: true, json: async () => mockData })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ buildTime: 'build-123' }) });

      await loader.loadGraph();
      // Version was primed from graph, so polling unchanged version returns false
      const changed = await loader.checkForUpdates();
      expect(changed).toBe(false);
    });
  });

  describe('getCachedGraph', () => {
    it('returns null before any load', () => {
      expect(loader.getCachedGraph()).toBeNull();
    });

    it('returns data after a successful load', async () => {
      const mockData = { nodes: [], edges: [], lastUpdated: 'v1' };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });
      await loader.loadGraph();
      expect(loader.getCachedGraph()).toEqual(mockData);
    });
  });

  describe('shouldPoll', () => {
    it('returns true initially (no load has occurred)', () => {
      expect(loader.shouldPoll()).toBe(true);
    });

    it('returns false immediately after a successful load', async () => {
      const mockData = { nodes: [], edges: [], lastUpdated: 'v1' };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });
      await loader.loadGraph();
      expect(loader.shouldPoll()).toBe(false);
    });
  });

  describe('setPollInterval', () => {
    it('can be set to a new interval', () => {
      loader.setPollInterval(500);
      // No error thrown — interval accepted
      expect(true).toBe(true);
    });

    it('a very short interval makes shouldPoll true again quickly', async () => {
      loader.setPollInterval(0);
      const mockData = { nodes: [], edges: [], lastUpdated: 'v1' };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });
      await loader.loadGraph();
      // With 0ms interval, time elapsed >= 0 so shouldPoll should be true
      expect(loader.shouldPoll()).toBe(true);
    });
  });
});
