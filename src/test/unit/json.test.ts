import { describe, it, expect } from 'vitest';
import { safeJsonParse } from '../../utils/json.js';

/**
 * The lenient path of `safeJsonParse` runs only when strict `JSON.parse`
 * fails -- so every input here carries a comment, which is what forces it.
 * Each case pins a string value that a string-unaware cleanup rewrites.
 */
describe('safeJsonParse — lenient path is string-aware', () => {
  it('keeps ", }" inside a string value intact', () => {
    const input = '{\n  // hook\n  "command": "echo a, }",\n  "next": 1\n}';
    expect(safeJsonParse(input)).toEqual({
      success: true,
      data: { command: 'echo a, }', next: 1 },
    });
  });

  it('keeps ", ]" inside a string value intact', () => {
    const input = '{\n  // list\n  "args": ["x, ]", "y"],\n}';
    expect(safeJsonParse(input)).toEqual({
      success: true,
      data: { args: ['x, ]', 'y'] },
    });
  });

  it('parses a block comment that contains "//"', () => {
    const input = '{\n  /* see https://example.com */\n  "a": 1\n}';
    expect(safeJsonParse(input)).toEqual({ success: true, data: { a: 1 } });
  });

  it('keeps "//" and "/*" inside a string value intact', () => {
    const input = '{\n  // c\n  "url": "https://x.dev/a//b",\n  "glob": "src/*.ts"\n}';
    expect(safeJsonParse(input)).toEqual({
      success: true,
      data: { url: 'https://x.dev/a//b', glob: 'src/*.ts' },
    });
  });

  it('still removes a real trailing comma and a real comment', () => {
    const input = '{\n  "a": [1, 2,], // trailing\n  "b": { "c": true, },\n}';
    expect(safeJsonParse(input)).toEqual({
      success: true,
      data: { a: [1, 2], b: { c: true } },
    });
  });

  it('rejects content the lenient path cannot repair', () => {
    const result = safeJsonParse('{ // c\n "a": 1 "b": 2 }');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/^Invalid JSON: /);
    }
  });

  it('rejects empty content', () => {
    expect(safeJsonParse('').success).toBe(false);
  });
});
