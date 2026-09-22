/**
 * Placeholder expansion, Agent Plugins 1.0.0 §9.2.
 */

/**
 * Values substituted for the two recognized placeholders.
 */
export interface PluginVariables {
  pluginRoot: string;
  pluginData: string;
}

/**
 * The only two placeholders that expand. Global so that every occurrence is
 * replaced; the alternation makes it one scan rather than one pass per name.
 */
const PLACEHOLDER_PATTERN = /\$\{(PLUGIN_ROOT|PLUGIN_DATA)\}/g;

/**
 * Replace every exact occurrence of `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` in
 * `value`.
 *
 * Expansion is a single non-recursive scan: text introduced by a replacement is
 * never rescanned, so a `pluginData` value that itself contains the literal
 * `${PLUGIN_ROOT}` survives unexpanded. Unrecognized placeholder-like text
 * (`${HOME}`, `$PLUGIN_ROOT`, `${ PLUGIN_ROOT }`) stays literal, and nothing
 * else is expanded.
 *
 * The replacement is supplied as a function so that `$&`, `` $` `` and `$$` in
 * a plugin root or data path are treated as ordinary characters rather than as
 * `String.prototype.replace` substitution patterns.
 */
export function expandPlaceholders(value: string, vars: PluginVariables): string {
  return value.replace(PLACEHOLDER_PATTERN, (_match, name: string) =>
    name === 'PLUGIN_ROOT' ? vars.pluginRoot : vars.pluginData,
  );
}
