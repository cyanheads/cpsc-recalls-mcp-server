#!/usr/bin/env node
/**
 * @fileoverview cpsc-recalls-mcp-server MCP server entry point.
 * @module index
 */

import { type AnyToolDef, createApp, z } from '@cyanheads/mcp-ts-core';
import { parseEnvConfig } from '@cyanheads/mcp-ts-core/config';
import { createCpscGetRecall } from './mcp-server/tools/definitions/cpsc-get-recall.tool.js';
import { createCpscGetRecent } from './mcp-server/tools/definitions/cpsc-get-recent.tool.js';
import { createCpscSearchRecalls } from './mcp-server/tools/definitions/cpsc-search-recalls.tool.js';
import { initCpscRecallService } from './services/cpsc-recall/cpsc-recall-service.js';

// setup selects the advertised schemas after the framework loads the server environment.
const tools: AnyToolDef[] = [];

await createApp({
  name: 'cpsc-recalls-mcp-server',
  title: 'cpsc-recalls-mcp-server',
  /**
   * Every tool is a single-shot read against the CPSC API — nothing gates on
   * `ctx.requestInput`, so no caller needs a session to answer a mid-handler prompt.
   * `MCP_SESSION_MODE` still overrides this at deploy time.
   */
  sessionMode: 'stateless',
  tools,
  resources: [],
  prompts: [],
  skills: 'skills',
  instructions:
    'CPSC consumer product recalls from saferproducts.gov. Search with cpsc_search_recalls, which needs at least one filter (a product, brand, hazard, or other text filter, or a date bound); browse the latest recalls with cpsc_get_recent, and pass a recall number from either to cpsc_get_recall for the full record. CPSC jurisdiction: consumer products, including child-resistant packaging for drugs and supplements, ATVs and snowmobiles, bicycle tires, and gun safes and locks; food and drugs (FDA), on-road vehicles and their tires (NHTSA), boats (USCG), pesticides (EPA), and firearms (ATF) belong to other agencies.',
  setup() {
    const { clampLimits, normalizeRecallNumbers } = parseEnvConfig(
      z.object({
        clampLimits: z.stringbool().default(true),
        normalizeRecallNumbers: z.stringbool().default(true),
      }),
      {
        clampLimits: 'CPSC_CLAMP_LIMITS',
        normalizeRecallNumbers: 'CPSC_NORMALIZE_RECALL_NUMBERS',
      },
    );
    tools.push(
      createCpscSearchRecalls(clampLimits),
      createCpscGetRecall(normalizeRecallNumbers),
      createCpscGetRecent(clampLimits),
    );
    initCpscRecallService();
  },
});
