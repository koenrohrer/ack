import { describe, it, expect } from 'vitest';
import { expandPlaceholders } from '../../plugins/plugin.expand.js';

/**
 * Agent Plugins 1.0.0 §9.2 — placeholder expansion.
 *
 * "Expansion is a single, non-recursive textual replacement of every exact
 *  occurrence of either placeholder. Text introduced by a replacement MUST NOT
 *  be scanned for further placeholders."
 */

const ROOT = '/plugins/demo';
const DATA = '/plugin-data/demo';
const vars = { pluginRoot: ROOT, pluginData: DATA };

describe('expandPlaceholders', () => {
  it('replaces a lone ${PLUGIN_ROOT}', () => {
    expect(expandPlaceholders('${PLUGIN_ROOT}', vars)).toBe(ROOT);
  });

  it('replaces a lone ${PLUGIN_DATA}', () => {
    expect(expandPlaceholders('${PLUGIN_DATA}', vars)).toBe(DATA);
  });

  it('replaces every occurrence, not just the first', () => {
    expect(expandPlaceholders('${PLUGIN_ROOT}/a:${PLUGIN_ROOT}/b:${PLUGIN_ROOT}', vars)).toBe(
      '/plugins/demo/a:/plugins/demo/b:/plugins/demo',
    );
  });

  it('replaces both placeholders in one string', () => {
    expect(expandPlaceholders('--config ${PLUGIN_ROOT}/c.json --state ${PLUGIN_DATA}/s', vars)).toBe(
      '--config /plugins/demo/c.json --state /plugin-data/demo/s',
    );
  });

  it('replaces adjacent placeholders with no separator between them', () => {
    expect(expandPlaceholders('${PLUGIN_ROOT}${PLUGIN_DATA}', vars)).toBe(`${ROOT}${DATA}`);
  });

  // -------------------------------------------------------------------------
  // Single pass — the two cases below are deliberately mirrored so that neither
  // "replace ROOT then replace DATA" nor "replace DATA then replace ROOT" can
  // satisfy both. Only a genuine single scan passes.
  // -------------------------------------------------------------------------

  it('does not rescan text introduced by a ${PLUGIN_DATA} replacement', () => {
    const recursive = { pluginRoot: ROOT, pluginData: '/data/${PLUGIN_ROOT}/demo' };
    expect(expandPlaceholders('${PLUGIN_DATA}/cache', recursive)).toBe(
      '/data/${PLUGIN_ROOT}/demo/cache',
    );
  });

  it('does not rescan text introduced by a ${PLUGIN_ROOT} replacement', () => {
    const recursive = { pluginRoot: '/root/${PLUGIN_DATA}', pluginData: DATA };
    expect(expandPlaceholders('${PLUGIN_ROOT}/bin', recursive)).toBe('/root/${PLUGIN_DATA}/bin');
  });

  it('treats the replacement value as literal text, not a regex replacement pattern', () => {
    // String.prototype.replace/replaceAll give `$&`, `$'`, "$`" and `$$` special
    // meaning in the replacement argument. They are ordinary path characters here.
    const dollars = { pluginRoot: "/root/$&$'$`$$", pluginData: DATA };
    expect(expandPlaceholders('${PLUGIN_ROOT}/x', dollars)).toBe("/root/$&$'$`$$/x");
  });

  // -------------------------------------------------------------------------
  // Nothing else expands
  // -------------------------------------------------------------------------

  it('leaves an unrecognized ${...} placeholder literal', () => {
    expect(expandPlaceholders('${HOME}/x', vars)).toBe('${HOME}/x');
  });

  it('leaves brace-less $PLUGIN_ROOT literal', () => {
    expect(expandPlaceholders('$PLUGIN_ROOT/x', vars)).toBe('$PLUGIN_ROOT/x');
  });

  it('leaves an unterminated ${PLUGIN_ROOT literal', () => {
    expect(expandPlaceholders('${PLUGIN_ROOT/x', vars)).toBe('${PLUGIN_ROOT/x');
  });

  it('is case-sensitive — ${plugin_root} stays literal', () => {
    expect(expandPlaceholders('${plugin_root}/x', vars)).toBe('${plugin_root}/x');
  });

  it('does not match a placeholder with surrounding whitespace inside the braces', () => {
    expect(expandPlaceholders('${ PLUGIN_ROOT }/x', vars)).toBe('${ PLUGIN_ROOT }/x');
  });

  it('does not expand a %PLUGIN_ROOT% style placeholder', () => {
    expect(expandPlaceholders('%PLUGIN_ROOT%/x', vars)).toBe('%PLUGIN_ROOT%/x');
  });

  it('returns a string with no placeholders unchanged', () => {
    expect(expandPlaceholders('--verbose', vars)).toBe('--verbose');
  });

  it('returns the empty string unchanged', () => {
    expect(expandPlaceholders('', vars)).toBe('');
  });

  it('expands to an empty replacement value without inserting anything else', () => {
    expect(expandPlaceholders('a${PLUGIN_DATA}b', { pluginRoot: ROOT, pluginData: '' })).toBe('ab');
  });
});
