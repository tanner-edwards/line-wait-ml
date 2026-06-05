// notification-copy.js
// All user-facing notification copy lives here.
// Edit this file to change what users read in push notifications and history.

/**
 * @param {number|null} ms
 * @returns {string|null}
 */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 1.25) return 'an hour';
  if (hours < 10) return `${Math.round(hours * 10) / 10} hours`;
  return `${Math.round(hours)} hours`;
}

/**
 * @param {string} type - 'trough' | 'closure' | 'reopen' | 'peak'
 * @param {string|null} rideName
 * @param {string|null} badge - 'star' | 'go' | null
 * @returns {string}
 */
export function notificationTitle(type, rideName, badge) {
  const safeName = rideName ?? 'Ride';
  if (type === 'trough') return `${badge === 'star' ? '⭐' : '✅'} ${safeName}`;
  if (type === 'closure') return `✕ ${safeName}`;
  if (type === 'reopen') return `🎉 ${safeName}`;
  if (type === 'peak') return `🛑 ${safeName}`;
  return safeName;
}

/**
 * @param {{
 *   type: string,
 *   badge?: string|null,
 *   currentWait?: number|null,
 *   bucket0Wait?: number|null,
 *   rideStats?: { p50?: number, p90?: number }|null,
 *   durationMs?: number|null,
 *   waitAtClose?: number|null,
 * }} params
 * @returns {string}
 */
export function notificationBody({ type, badge = null, currentWait = null, bucket0Wait = null, rideStats = null, durationMs = null, waitAtClose = null }) {
  if (type === 'trough') {
    const waitText = currentWait != null ? `${currentWait} min` : 'a short wait';
    const compare = bucket0Wait != null ? ` — usually ${bucket0Wait} around now` : '';
    if (badge === 'star') return `${waitText}${compare}. Rare low.`;
    return `Only ${waitText}${compare}.`;
  }
  if (type === 'closure') {
    return 'Currently down.';
  }
  if (type === 'reopen') {
    const downtime = formatDuration(durationMs);
    const nowText = currentWait != null ? `${currentWait} min` : null;
    const closedText = waitAtClose != null ? `${waitAtClose} min` : null;
    const base = downtime ? `Back after ${downtime}.` : 'Back up.';
    if (closedText && nowText) return `${base} Was ${closedText} at close — now ${nowText}.`;
    if (closedText) return `${base} Was ${closedText} when it closed.`;
    if (nowText) return `${base} Wait posted at ${nowText}.`;
    return base;
  }
  if (type === 'peak') {
    const waitText = currentWait != null ? `${currentWait} min` : 'a long wait';
    const compare = rideStats?.p50 != null ? ` — average is ${rideStats.p50} min` : '';
    return `At ${waitText}${compare}. Now's not the time.`;
  }
  return '';
}
