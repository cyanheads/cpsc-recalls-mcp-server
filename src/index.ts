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
  tools: [cpscSearchRecalls, cpscGetRecall, cpscGetRecent],
  resources: [],
  prompts: [],
  instructions:
    'CPSC consumer product recall database (saferproducts.gov). ' +
    'Use cpsc_search_recalls to find recalls by product, brand, hazard, or date. ' +
    'Use cpsc_get_recall for full detail on a specific recall number. ' +
    'Use cpsc_get_recent for a recent recall feed. ' +
    'CPSC jurisdiction: consumer products only — food/drugs (FDA), vehicles/tires (NHTSA), boats (USCG), pesticides (EPA) are covered by other agencies.',
  setup(core) {
    void core;
    initCpscRecallService();
  },
});
