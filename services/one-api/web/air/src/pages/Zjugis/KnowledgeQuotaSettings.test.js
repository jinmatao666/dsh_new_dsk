jest.mock('../../helpers', () => ({ API: { get: jest.fn(), put: jest.fn() } }));
import { bytesToMegabytesInput, megabytesInputToBytes, normalizeKnowledgeQuota } from './KnowledgeQuotaSettings';

test('normalizeKnowledgeQuota drops invalid allocations and keeps defaults', () => {
  expect(normalizeKnowledgeQuota(undefined)).toEqual({ enabled: false, totalBytes: 0, allocations: [] });
  expect(normalizeKnowledgeQuota({
    enabled: true,
    totalBytes: 104857600,
    allocations: [
      { userId: 1, quotaBytes: 10 },
      { userId: 1, quotaBytes: 20 },
      { userId: 0, quotaBytes: 5 },
      { userId: 2, quotaBytes: -1 },
      { userId: 3, quotaBytes: 30 },
    ],
  })).toEqual({
    enabled: true,
    totalBytes: 104857600,
    allocations: [{ userId: 1, quotaBytes: 10 }, { userId: 3, quotaBytes: 30 }],
  });
});

test('megabyte helpers round-trip whole and fractional values', () => {
  expect(bytesToMegabytesInput(100 * 1024 * 1024)).toBe('100');
  expect(bytesToMegabytesInput(1.5 * 1024 * 1024)).toBe('1.5');
  expect(megabytesInputToBytes('100')).toBe(100 * 1024 * 1024);
  expect(megabytesInputToBytes('')).toBe(0);
  expect(Number.isNaN(megabytesInputToBytes('-1'))).toBe(true);
});
