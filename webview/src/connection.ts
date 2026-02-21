/**
 * WebSocket connection management, health checks, and web push registration.
 * Handles connection lifecycle, reconnection with exponential backoff, and message routing.
 * Owns all connection-related state.
 */

import {
  WS_STATES,
  WsState,
  CLOSE_CODE_MEANINGS,
  WS_HOST,
  USERNAME,
  RECONNECT_BASE_DELAY,
  RECONNECT_MAX_DELAY,
  TOKEN_STORAGE_KEY,
} from "./types";
import {
  debugLog,
  flushDebugLogQueue,
  base64ToBytes,
  urlBase64ToUint8Array,
} from "./utils";
import { updateStatus } from "./ui/status";

// ============================================================================
// Connection State
// ============================================================================

let ws: WebSocket | null = null;
let wsState: WsState = WS_STATES.DISCONNECTED;
let currentSessionId: string | null = null;
let reconnectAttempts = 0;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let isConnectingFlag = false;
let lastStateChange = Date.now();
let connectionStartTime: number | null = null;
let lastPongTime = Date.now();
let healthCheckInterval: ReturnType<typeof setInterval> | null = null;
let connectionAttemptId = 0;
let currentCorrelationId: string | null = null;

// Internal getters/setters
function getWs(): WebSocket | null {
  return ws;
}
function setWsValue(newWs: WebSocket | null): void {
  ws = newWs;
}
function getWsStateValue(): WsState {
  return wsState;
}
function setWsStateValue(state: WsState): void {
  wsState = state;
}
function getReconnectAttempts(): number {
  return reconnectAttempts;
}
function setReconnectAttemptsValue(n: number): void {
  reconnectAttempts = n;
}
function incrementReconnectAttempts(): void {
  reconnectAttempts++;
}
function getReconnectTimeout(): ReturnType<typeof setTimeout> | null {
  return reconnectTimeout;
}
function setReconnectTimeoutValue(
  t: ReturnType<typeof setTimeout> | null,
): void {
  reconnectTimeout = t;
}
function getIsConnecting(): boolean {
  return isConnectingFlag;
}
function setIsConnecting(v: boolean): void {
  isConnectingFlag = v;
}
function getLastStateChange(): number {
  return lastStateChange;
}
function setLastStateChangeValue(t: number): void {
  lastStateChange = t;
}
function getConnectionStartTime(): number | null {
  return connectionStartTime;
}
function setConnectionStartTimeValue(t: number | null): void {
  connectionStartTime = t;
}
function getLastPongTime(): number {
  return lastPongTime;
}
function setLastPongTimeValue(t: number): void {
  lastPongTime = t;
}
function getHealthCheckInterval(): ReturnType<typeof setInterval> | null {
  return healthCheckInterval;
}
function setHealthCheckIntervalValue(
  i: ReturnType<typeof setInterval> | null,
): void {
  healthCheckInterval = i;
}
function incrementConnectionAttemptId(): number {
  return ++connectionAttemptId;
}

// Exports for external access
export function getCurrentSessionId(): string | null {
  return currentSessionId;
}

export function getCurrentCorrelationId(): string | null {
  return currentCorrelationId;
}

/**
 * Get WebSocket for debug logging (used by utils.ts)
 */
export function getWsForLogging(): WebSocket | null {
  return ws;
}

// ============================================================================
// Message Handler Registry
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MessageHandler = (msg: any) => void;
type TerminalDataHandler = (terminal: string, data: Uint8Array) => void;
type SessionHandler = (sessionId: string) => void;

const messageHandlers: Map<string, MessageHandler> = new Map();
let terminalDataHandler: TerminalDataHandler | null = null;
let sessionHandler: SessionHandler | null = null;
let terminalSizeCallback: ((terminal: "llm" | "terminal") => void) | null =
  null;

/**
 * Register a handler for a specific message type
 */
export function registerMessageHandler(
  type: string,
  handler: MessageHandler,
): void {
  messageHandlers.set(type, handler);
}

/**
 * Register handler for terminal data
 */
export function registerTerminalDataHandler(
  handler: TerminalDataHandler,
): void {
  terminalDataHandler = handler;
}

/**
 * Register handler for session establishment
 */
export function registerSessionHandler(handler: SessionHandler): void {
  sessionHandler = handler;
}

/**
 * Register callback to send terminal size after connection
 */
export function registerTerminalSizeCallback(
  callback: (terminal: "llm" | "terminal") => void,
): void {
  terminalSizeCallback = callback;
}

/**
 * Calculate reconnection delay with exponential backoff and jitter
 * Pure function that can be tested directly
 */
export function calculateReconnectDelay(
  attempts: number,
  baseDelay: number = RECONNECT_BASE_DELAY,
  maxDelay: number = RECONNECT_MAX_DELAY,
  jitter: number = Math.random() * 1000,
): number {
  const delay = Math.min(baseDelay * Math.pow(2, attempts), maxDelay);
  return delay + jitter;
}

/**
 * Build WebSocket URL from protocol, host, and username
 * Pure function that can be tested directly
 */
export function buildWebSocketURL(
  protocol: string,
  host: string,
  username: string,
): string {
  const params = new URLSearchParams({ user: username });

  // Include authentication token if available
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token) {
    params.append("token", token);
  }

  const wsProtocol =
    protocol === "https:" || protocol === "file:" ? "wss:" : "ws:";
  return `${wsProtocol}//${host}/ws?${params.toString()}`;
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Calculate reconnection delay with exponential backoff and jitter
 */
function getReconnectDelay(): number {
  return calculateReconnectDelay(getReconnectAttempts());
}

/**
 * Start health check monitoring
 */
function startHealthCheck(): void {
  debugLog("HEALTH", "info", "Starting health check", {
    interval: 10000,
    staleThreshold: 20000,
  });

  const existingInterval = getHealthCheckInterval();
  if (existingInterval) {
    clearInterval(existingInterval);
  }
  setLastPongTimeValue(Date.now());

  const interval = setInterval(() => {
    const timeSinceLastPong = Date.now() - getLastPongTime();
    const ws = getWs();

    debugLog("HEALTH", "debug", "Health check tick", {
      timeSinceLastPong: timeSinceLastPong,
      wsState: getWsStateValue(),
      wsReadyState: ws ? ws.readyState : null,
    });

    if (timeSinceLastPong > 20000) {
      debugLog("HEALTH", "warn", "Connection stale, forcing close", {
        timeSinceLastPong: timeSinceLastPong,
      });
      if (ws) {
        ws.close(4000, "Health check timeout");
      }
    }
  }, 10000);

  setHealthCheckIntervalValue(interval);
}

/**
 * Stop health check monitoring
 */
function stopHealthCheck(): void {
  debugLog("HEALTH", "info", "Stopping health check");
  const interval = getHealthCheckInterval();
  if (interval) {
    clearInterval(interval);
    setHealthCheckIntervalValue(null);
  }
}

// ============================================================================
// Web Push Registration
// ============================================================================

/**
 * Register Web Push subscription for PWA push notifications
 */
async function registerWebPush(vapidPublicKey: string): Promise<void> {
  debugLog("WS", "info", "registerWebPush called");

  // Check if service worker and push are supported
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    debugLog("WS", "info", "Web Push not supported in this browser");
    return;
  }

  const ws = getWs();
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    debugLog("WS", "warn", "Cannot register Web Push: WebSocket not connected");
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    // Check if already subscribed
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      // Request permission and subscribe
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        debugLog("WS", "info", "Notification permission denied");
        return;
      }

      // Convert VAPID key to Uint8Array
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey,
      });
      debugLog("WS", "info", "Created new Web Push subscription");
    } else {
      debugLog("WS", "info", "Using existing Web Push subscription");
    }

    // Send subscription to backend
    debugLog("WS", "info", "Registering Web Push subscription via WebSocket");
    ws.send(
      JSON.stringify({
        type: "register_web_push",
        subscription: subscription.toJSON(),
      }),
    );
  } catch (err) {
    debugLog(
      "WS",
      "error",
      "Web Push registration failed: " + (err as Error).message,
    );
  }
}

// ============================================================================
// WebSocket Connection
// ============================================================================

/**
 * Establish WebSocket connection with automatic reconnection
 */
export function connect(): void {
  // Prevent concurrent connection attempts
  if (getIsConnecting()) {
    debugLog("WS", "info", "Connection already in progress, skipping", {
      wsState: getWsStateValue(),
    });
    return;
  }
  setIsConnecting(true);

  currentCorrelationId = generateCorrelationId();
  setConnectionStartTimeValue(Date.now());

  const existingWs = getWs();
  debugLog("WS", "info", "Starting connection", {
    attempt: getReconnectAttempts(),
    hasExistingWs: !!existingWs,
    existingWsState: existingWs ? existingWs.readyState : null,
  });

  if (existingWs) {
    debugLog("WS", "info", "Closing existing WebSocket", {
      readyState: existingWs.readyState,
    });
    existingWs.close();
  }

  setWsState(WS_STATES.CONNECTING, "connect() called");
  updateStatus("connecting", "Connecting to terminal...");

  try {
    const wsUrl = getWebSocketURL();

    debugLog("WS", "info", "Creating WebSocket", {
      url: wsUrl,
    });

    const ws = new WebSocket(wsUrl);
    setWsValue(ws);

    ws.onopen = () => {
      setIsConnecting(false);
      const connectionStartTime = getConnectionStartTime();
      const connectDuration = connectionStartTime
        ? Date.now() - connectionStartTime
        : 0;

      // Flush queued debug logs now that WebSocket is ready
      flushDebugLogQueue();

      debugLog("WS", "info", "WebSocket opened", {
        connectDuration: connectDuration,
      });

      setWsState(WS_STATES.CONNECTED, "onopen");
      updateStatus("connected", "Connected");

      // Cancel any pending reconnect timeout
      const reconnectTimeout = getReconnectTimeout();
      if (reconnectTimeout) {
        debugLog("WS", "info", "Clearing stale reconnect timeout");
        clearTimeout(reconnectTimeout);
        setReconnectTimeoutValue(null);
      }

      // Reset reconnection backoff on successful connection
      setReconnectAttemptsValue(0);

      // Start health monitoring
      startHealthCheck();

      // Send initial terminal sizes
      if (terminalSizeCallback) {
        terminalSizeCallback("llm");
        terminalSizeCallback("terminal");
      }
    };

    ws.onmessage = (event) => {
      // Handle text messages (session ID, file ops) vs binary (terminal output)
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "pong") {
            // Server heartbeat - update last pong time
            const timeSinceLastPong = Date.now() - getLastPongTime();
            debugLog("HEALTH", "debug", "Pong received", {
              timeSinceLastPong: timeSinceLastPong,
            });
            setLastPongTimeValue(Date.now());
          } else if (msg.type === "terminal_data") {
            // Route terminal data to correct terminal
            const data = base64ToBytes(msg.data);
            if (terminalDataHandler) {
              terminalDataHandler(msg.terminal || "llm", data);
            }
          } else if (msg.type === "session" && msg.id) {
            console.log("Session ID:", msg.id);
            currentSessionId = msg.id;
            // Register for push notifications if VAPID key provided
            if (msg.vapidPublicKey) {
              registerWebPush(msg.vapidPublicKey);
            }
            // Notify session handler
            if (sessionHandler) {
              sessionHandler(msg.id);
            }
          } else {
            // Route to registered message handlers
            // Check for exact type match first
            const handler = messageHandlers.get(msg.type);
            if (handler) {
              handler(msg);
            } else {
              // Check for prefix match (e.g., 'git_' messages)
              for (const [prefix, prefixHandler] of messageHandlers) {
                if (prefix.endsWith("_") && msg.type.startsWith(prefix)) {
                  prefixHandler(msg);
                  break;
                }
              }
            }
          }
        } catch (e) {
          // Not JSON, treat as text terminal output
          if (terminalDataHandler) {
            const encoder = new TextEncoder();
            terminalDataHandler("llm", encoder.encode(event.data));
          }
        }
      } else if (event.data instanceof ArrayBuffer) {
        const data = new Uint8Array(event.data);
        if (terminalDataHandler) {
          terminalDataHandler("llm", data);
        }
      } else if (event.data instanceof Blob) {
        event.data.arrayBuffer().then((buf) => {
          if (terminalDataHandler) {
            terminalDataHandler("llm", new Uint8Array(buf));
          }
        });
      }
    };

    ws.onerror = (error) => {
      debugLog("WS", "error", "WebSocket error", {
        errorType: (error as Event).type,
        message: (error as ErrorEvent).message || "No message",
        readyState: ws ? ws.readyState : null,
      });
      updateStatus("disconnected", "Connection error");
    };

    ws.onclose = (event) => {
      setIsConnecting(false);
      const connectionStartTime = getConnectionStartTime();
      const closeInfo = {
        code: event.code,
        reason: event.reason || "No reason provided",
        wasClean: event.wasClean,
        codeMeaning: CLOSE_CODE_MEANINGS[event.code] || "Unknown",
        timeSinceOpen: connectionStartTime
          ? Date.now() - connectionStartTime
          : null,
      };

      debugLog("WS", "warn", "WebSocket closed", closeInfo);

      stopHealthCheck();
      setWsState(WS_STATES.DISCONNECTED, `Close code: ${event.code}`);

      // Notify UI components so they can reset in-progress states
      document.dispatchEvent(new CustomEvent('wsDisconnected'));

      // Handle authentication failure (4001 Unauthorized)
      if (event.code === 4001) {
        debugLog("WS", "error", "Authentication failed - token invalid or missing");
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        updateStatus(
          "disconnected",
          "Not paired. Scan QR code from server logs to pair this device.",
        );
        // Don't auto-reconnect for auth failures - user needs to re-pair
        return;
      }

      const delay = getReconnectDelay();
      incrementReconnectAttempts();

      debugLog("WS", "info", "Scheduling reconnect", {
        delay: delay,
        nextAttempt: getReconnectAttempts(),
      });

      updateStatus(
        "disconnected",
        `Disconnected. Reconnecting in ${Math.round(delay / 1000)}s...`,
      );

      // Auto-reconnect with exponential backoff
      const existingTimeout = getReconnectTimeout();
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }
      const timeout = setTimeout(() => {
        setWsState(WS_STATES.RECONNECTING, "reconnect timeout fired");
        connect();
      }, delay);
      setReconnectTimeoutValue(timeout);
    };
  } catch (error) {
    setIsConnecting(false);
    debugLog("WS", "error", "Connection exception", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    const delay = getReconnectDelay();
    incrementReconnectAttempts();
    updateStatus(
      "disconnected",
      `Failed to connect. Retrying in ${Math.round(delay / 1000)}s...`,
    );

    // Retry connection with exponential backoff
    const existingTimeout = getReconnectTimeout();
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    const timeout = setTimeout(connect, delay);
    setReconnectTimeoutValue(timeout);
  }
}

/**
 * Get WebSocket URL with authentication parameters
 */
function getWebSocketURL(): string {
  return buildWebSocketURL(window.location.protocol, WS_HOST, USERNAME);
}

/**
 * Connection state transition with logging
 */
function setWsState(newState: WsState, reason = ""): void {
  const prevState = getWsStateValue();
  const duration = Date.now() - getLastStateChange();
  setWsStateValue(newState);
  setLastStateChangeValue(Date.now());

  debugLog("WS", "info", "State transition", {
    from: prevState,
    to: newState,
    reason: reason,
    durationInPrevState: duration,
  });
}

/**
 * Generate correlation ID for connection attempts
 */
function generateCorrelationId(): string {
  return `conn-${Date.now()}-${incrementConnectionAttemptId()}`;
}

// ============================================================================
// Lifecycle Handlers
// ============================================================================

/**
 * Handle page visibility changes
 */
export function handleVisibilityChange(): void {
  const visibilityState = document.visibilityState;
  const hidden = document.hidden;
  const ws = getWs();

  debugLog("VISIBILITY", "info", "Visibility changed", {
    visibilityState: visibilityState,
    hidden: hidden,
    wsState: getWsStateValue(),
    wsReadyState: ws ? ws.readyState : null,
    reconnectAttempts: getReconnectAttempts(),
    timeSinceLastPong: Date.now() - getLastPongTime(),
  });

  if (hidden) {
    debugLog("VISIBILITY", "info", "Page hidden - stopping health checks");
    stopHealthCheck();
  } else {
    debugLog("VISIBILITY", "info", "Page visible - checking connection");

    if (
      !ws ||
      ws.readyState === WebSocket.CLOSED ||
      ws.readyState === WebSocket.CLOSING
    ) {
      debugLog(
        "VISIBILITY",
        "info",
        "Connection lost while hidden, reconnecting",
        {
          wsExists: !!ws,
          wsReadyState: ws ? ws.readyState : null,
        },
      );
      // Reset backoff when user returns for quick reconnection
      setReconnectAttemptsValue(0);
      connect();
    } else if (ws.readyState === WebSocket.OPEN) {
      debugLog(
        "VISIBILITY",
        "info",
        "Connection still open, restarting health monitoring",
      );
      startHealthCheck();
    } else if (ws.readyState === WebSocket.CONNECTING) {
      debugLog("VISIBILITY", "info", "Connection in progress, waiting");
    }
  }
}

/**
 * Handle browser going offline
 */
export function handleOffline(): void {
  const ws = getWs();
  debugLog("NETWORK", "warn", "Browser went offline", {
    wsState: getWsStateValue(),
    wsReadyState: ws ? ws.readyState : null,
  });

  // Update status immediately
  setWsState(WS_STATES.DISCONNECTED, "network offline");
  updateStatus("disconnected", "Connection lost - offline");

  // Stop health checks and pending reconnects
  stopHealthCheck();
  const reconnectTimeout = getReconnectTimeout();
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    setReconnectTimeoutValue(null);
  }

  // Close the WebSocket
  if (ws) {
    ws.close();
  }
}

/**
 * Handle browser coming online
 */
export function handleOnline(): void {
  const ws = getWs();
  debugLog("NETWORK", "info", "Browser came online", {
    wsState: getWsStateValue(),
    wsReadyState: ws ? ws.readyState : null,
  });

  // Network is back - reconnect immediately
  updateStatus("connecting", "Network restored - reconnecting...");
  setReconnectAttemptsValue(0);
  setIsConnecting(false);
  connect();
}

/**
 * Handle page unload
 */
export function handleBeforeUnload(): void {
  stopHealthCheck();
  const ws = getWs();
  if (ws) {
    ws.close();
  }
  const reconnectTimeout = getReconnectTimeout();
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }
}

/**
 * Send data over WebSocket
 */
export function sendMessage(message: Record<string, unknown>): boolean {
  const ws = getWs();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}

/**
 * Check if WebSocket is connected and ready
 */
export function isConnected(): boolean {
  const ws = getWs();
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Reset module state for testing
 */
export function __test_reset(): void {
  ws = null;
  wsState = WS_STATES.DISCONNECTED;
  currentSessionId = null;
  reconnectAttempts = 0;
  reconnectTimeout = null;
  isConnectingFlag = false;
  lastStateChange = Date.now();
  connectionStartTime = null;
  lastPongTime = Date.now();
  healthCheckInterval = null;
  connectionAttemptId = 0;
  currentCorrelationId = null;
  messageHandlers.clear();
  terminalDataHandler = null;
  sessionHandler = null;
  terminalSizeCallback = null;
}
