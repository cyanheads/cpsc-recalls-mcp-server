#!/usr/bin/env node
/**
 * @fileoverview cpsc-recalls-mcp-server MCP server entry point.
 * @module index
 */

import { createApp } from '@cyanheads/mcp-ts-core';
import { cpscGetRecall } from './mcp-server/tools/definitions/cpsc-get-recall.tool.js';
import { cpscGetRecent } from './mcp-server/tools/definitions/cpsc-get-recent.tool.js';
import { cpscSearchRecalls } from './mcp-server/tools/definitions/cpsc-search-recalls.tool.js';
import { initCpscRecallService } from './services/cpsc-recall/cpsc-recall-service.js';

await createApp({
  name: 'cpsc-recalls-mcp-server',
  title: 'cpsc-recalls-mcp-server',
  /**
   * Every tool is a single-shot read against the CPSC API — nothing gates on
   * `ctx.requestInput`, so no caller needs a session to answer a mid-handler prompt.
   * `MCP_SESSION_MODE` still overrides this at deploy time.
   */
  sessionMode: 'stateless',
  tools: [cpscSearchRecalls, cpscGetRecall, cpscGetRecent],
  resources: [],
  prompts: [],
  instructions:
    'CPSC consumer product recalls from saferproducts.gov. Search with cpsc_search_recalls, which needs at least one filter (a product, brand, hazard, or other text filter, or a date bound); browse the latest recalls with cpsc_get_recent, and pass a recall number from either to cpsc_get_recall for the full record. CPSC jurisdiction: consumer products only — food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), pesticides (EPA), and firearms (ATF) are covered by other agencies.',
  setup(core) {
    void core;
    initCpscRecallService();
  },
});
