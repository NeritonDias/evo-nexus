/**
 * Shared terminal-server URL constants.
 * Exported here so AgentChat, useGlobalNotifications, and any future consumer
 * all resolve the same base URL without duplication.
 */
const isLocal =
  import.meta.env.DEV || /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)

export const TS_HTTP = isLocal
  ? `http://${window.location.hostname}:32352`
  : `${window.location.protocol}//${window.location.host}/terminal`

export const TS_WS = isLocal
  ? `ws://${window.location.hostname}:32352`
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/terminal`
