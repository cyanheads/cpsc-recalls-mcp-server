/**
 * @fileoverview Count limits and offset slicing for the CPSC recall lists.
 * @module mcp-server/tools/count-paging
 */

import { type Context, z } from '@cyanheads/mcp-ts-core';
import { ATTR_MCP_TOOL_NAME, createCounter } from '@cyanheads/mcp-ts-core/utils';

type ListTool = 'cpsc_search_recalls' | 'cpsc_get_recent';

let clampCounter: ReturnType<typeof createCounter> | undefined;

/** Builds the input schema and paging policy for one list tool at startup. */
export function createCountPaging(toolName: ListTool, cap: number, clampLimits: boolean) {
  const positive = z.number().min(1);
  const bounded = clampLimits ? positive : positive.max(cap);
  // Zod's .int() rejects unsafe integers. A request above the cap only needs comparison.
  const limit = bounded
    .refine(Number.isInteger, 'Expected an integer')
    .default(20)
    .meta({
      type: 'integer',
      description: clampLimits
        ? `Maximum recalls to return. Defaults to 20. A page holds at most ${cap} recalls. A larger limit is clamped to ${cap}, with a notice when more recalls remain.`
        : `Maximum recalls to return. Defaults to 20 and accepts up to ${cap}.`,
    });

  return {
    limit,
    slice<T>(
      matches: readonly T[],
      input: { limit: number; offset: number },
      ctx: Pick<Context, 'log'>,
    ) {
      const { limit: requested, offset } = input;
      const clamped = clampLimits && requested > cap;
      const pageSize = clamped ? cap : requested;

      if (clamped) {
        clampCounter ??= createCounter(
          'cpsc.pagination.limit_clamps',
          'Recall list limits clamped to the page cap',
          '{calls}',
        );
        clampCounter.add(1, { [ATTR_MCP_TOOL_NAME]: toolName });
        ctx.log.info('Recall page limit clamped', { tool: toolName, requested, cap });
      }

      const rows = matches.slice(offset, offset + pageSize);
      const nextOffset = offset + rows.length;
      const hasMore = nextOffset < matches.length;
      const capNotice =
        clamped && hasMore
          ? `Returned ${cap} of the ${requested} requested recalls: a page holds at most ${cap} recalls. Continue with offset ${nextOffset} for the rest.`
          : undefined;

      return { rows, hasMore, capNotice };
    },
  };
}
