/**
 * Format an EngineResult into a string the bot/MCP transports surface back to
 * the LLM (and onward to the user). Single source of truth so all transports
 * present envelopes identically — important for the LLM to learn the pattern.
 */

import { EngineResult, isNeedsConfirmation, isOk } from './result';

export function formatEngineResult<T>(
  r: EngineResult<T>,
  formatSuccess: (d: T) => string,
): string {
  if (isOk(r)) return formatSuccess(r.data);
  if (isNeedsConfirmation(r)) {
    const c = r.needsConfirmation;
    return [
      `Confirmation required for ${c.action}.`,
      ``,
      `Preview:`,
      JSON.stringify(c.preview, null, 2),
      ``,
      `To proceed, call this tool again with the SAME arguments plus:`,
      `  confirmation_token: "${c.confirmation_token}"`,
      ``,
      `Token expires at ${c.expires_at}.`,
    ].join('\n');
  }
  return `Error [${r.error.code}]: ${r.error.message}`;
}
