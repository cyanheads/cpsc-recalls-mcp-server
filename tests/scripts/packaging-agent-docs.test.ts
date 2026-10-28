/**
 * @fileoverview Tests for the bundle agent-doc pattern shared by `scripts/clean-mcpb.ts`
 * (the strip step) and `scripts/lint-packaging.ts` (the post-bundle check): dependency
 * agent docs are stripped at a package root, and runtime `skills/` directories deeper in a
 * package — the MCP SDK's `dist/ext/skills/` — ship.
 * @module tests/scripts/packaging-agent-docs.test
 */

import { describe, expect, it } from 'vitest';
import { AGENT_DOC_ENTRY, filterAgentDocEntries } from '../../scripts/clean-mcpb.js';

/**
 * Loaded by runtime URL rather than a static import: the script's fallback import of the
 * framework repository's own `src/mcp-server/skills.js` does not resolve in a server, so
 * a static import fails the typecheck.
 */
const lintPackaging: { AGENT_DOC_ENTRY: RegExp } = await import(
  new URL('../../scripts/lint-packaging.ts', import.meta.url).href
);

/** Bundle entries the server loads at runtime or publishes; none may be stripped. */
const kept = [
  'node_modules/@modelcontextprotocol/server/dist/ext/skills/index.js',
  'node_modules/@modelcontextprotocol/server/dist/ext/skills/loader.js',
  'node_modules/some-pkg/node_modules/@modelcontextprotocol/server/dist/ext/skills/index.js',
  'node_modules/@scope/pkg/node_modules/@modelcontextprotocol/server/dist/ext/skills/loader.js',
  'node_modules/some-pkg/dist/skills/runtime.js',
  'skills/recall-triage/SKILL.md',
  'dist/index.js',
];

/** Agent docs a dependency ships at its package root, or a `SKILL.md` anywhere in it. */
const stripped = [
  'node_modules/some-pkg/skills/foo/SKILL.md',
  'node_modules/some-pkg/skills/foo/reference.md',
  'node_modules/@cyanheads/mcp-ts-core/framework-skills/add-tool/SKILL.md',
  'node_modules/@cyanheads/mcp-ts-core/framework-skills/techniques/references/outline-on-overflow.md',
  'node_modules/some-pkg/.claude/settings.json',
  'node_modules/@scope/pkg/.agents/skills/a/SKILL.md',
  'node_modules/some-pkg/node_modules/other-pkg/skills/x.md',
  'node_modules/@scope/pkg/node_modules/@other/pkg/framework-skills/a/SKILL.md',
  'node_modules/some-pkg/docs/guide/SKILL.md',
];

describe('bundle agent-doc pattern', () => {
  it('keeps runtime skills directories, the published root skills tree, and the entry point', () => {
    expect(filterAgentDocEntries(kept)).toEqual([]);
    for (const entry of kept) {
      expect(lintPackaging.AGENT_DOC_ENTRY.test(entry), entry).toBe(false);
    }
  });

  it('strips package-root agent-doc directories and nested SKILL.md docs', () => {
    expect(filterAgentDocEntries(stripped)).toEqual(stripped);
    for (const entry of stripped) {
      expect(lintPackaging.AGENT_DOC_ENTRY.test(entry), entry).toBe(true);
    }
  });

  it('uses one literal in the strip step and the post-bundle check', () => {
    expect(lintPackaging.AGENT_DOC_ENTRY.source).toBe(AGENT_DOC_ENTRY.source);
    expect(lintPackaging.AGENT_DOC_ENTRY.flags).toBe(AGENT_DOC_ENTRY.flags);
  });
});
