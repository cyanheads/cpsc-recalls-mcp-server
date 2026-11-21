/**
 * @fileoverview Clamp telemetry for the CPSC recall lists.
 * @module tests/tools/count-paging.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { createCounter } from '@cyanheads/mcp-ts-core/utils';
import { expect, it, vi } from 'vitest';
import { createCountPaging } from '@/mcp-server/tools/count-paging.js';

vi.mock('@cyanheads/mcp-ts-core/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cyanheads/mcp-ts-core/utils')>()),
  createCounter: vi.fn(),
}));

it('records one clamp per oversized call even when no continuation is needed', () => {
  const add = vi.fn();
  vi.mocked(createCounter).mockReturnValue({ add });
  const ctx = createMockContext();
  const info = vi.spyOn(ctx.log, 'info');
  const search = createCountPaging('cpsc_search_recalls', 500, true);
  const recent = createCountPaging('cpsc_get_recent', 1_000, true);
  const strict = createCountPaging('cpsc_search_recalls', 500, false);

  search.slice([1], { limit: 500, offset: 0 }, ctx);
  strict.slice([1], { limit: 499, offset: 0 }, ctx);
  expect(createCounter).not.toHaveBeenCalled();
  expect(info).not.toHaveBeenCalled();

  expect(search.slice([1], { limit: 501, offset: 0 }, ctx)).toEqual({
    rows: [1],
    hasMore: false,
    capNotice: undefined,
  });
  expect(recent.slice([], { limit: 10_000, offset: 0 }, ctx)).toEqual({
    rows: [],
    hasMore: false,
    capNotice: undefined,
  });
  expect(createCounter).toHaveBeenCalledExactlyOnceWith(
    'cpsc.pagination.limit_clamps',
    'Recall list limits clamped to the page cap',
    '{calls}',
  );
  expect(add.mock.calls).toEqual([
    [1, { 'mcp.tool.name': 'cpsc_search_recalls' }],
    [1, { 'mcp.tool.name': 'cpsc_get_recent' }],
  ]);
  expect(info.mock.calls).toEqual([
    ['Recall page limit clamped', { tool: 'cpsc_search_recalls', requested: 501, cap: 500 }],
    ['Recall page limit clamped', { tool: 'cpsc_get_recent', requested: 10_000, cap: 1_000 }],
  ]);
});
