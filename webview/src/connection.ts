/**
 * WebSocket connection management, health checks, and web push registration.
 * Handles connection lifecycle, reconnection with exponential backoff, and message routing.
 */

import {
  WS_STATES,
  WsState,
  CLOSE_CODE_MEANINGS,
  WS_HOST,
  USERNAME,
  RECONNECT_BASE_DELAY,
  RECONNECT_MAX_DELAY,
} from "./types";
import {
  getWs,
  setWs,
  getWsState,
  setWsStateValue,
  setCurrentSessionId,
  getReconnectAttempts,
  setReconnectAttempts,
  incrementReconnectAttempts,
  getReconnectTimeout,
  setReconnectTimeout,
  getIsConnecting,
  setIsConnecting,
  getLastStateChange,
  setLastStateChange,
  getConnectionStartTime,
  setConnectionStartTime,
  getLastPongTime,
  setLastPongTime,
  getHealthCheckInterval,
  setHealthCheckInterval,
  incrementConnectionAttemptId,
  setCurrentCorrelationId,
} from "./state";
import {
  debugLog,
  flushDebugLogQueue,
  base64ToBytes,
  urlBase64ToUint8Array,
} from "./utils";

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

// ============================================================================
// Status Display
// ============================================================================

/**
 * Update the connection status display
 */
export function updateStatus(status: string, message: string): void {
  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.className = status;
    statusEl.textContent = message;
  }
}

// ============================================================================
// Connection State
// ============================================================================

/**
 * Generate correlation ID for connection attempts
 */
function generateCorrelationId(): string {
  return `conn-${Date.now()}-${incrementConnectionAttemptId()}`;
}

/**
 * Connection state transition with logging
 */
function setWsState(newState: WsState, reason = ""): void {
  const prevState = getWsState();
  const duration = Date.now() - getLastStateChange();
  setWsStateValue(newState);
  setLastStateChange(Date.now());

  debugLog("WS", "info", "State transition", {
    from: prevState,
    to: newState,
    reason: reason,
    durationInPrevState: duration,
  });
}

/**
 * Get WebSocket URL with authentication parameters
 */
function getWebSocketURL(): string {
  const params = new URLSearchParams({ user: USERNAME });

  // Use wss:// for HTTPS pages or file:// (Android bundled assets), ws:// for HTTP
  const protocol =
    window.location.protocol === "https:" ||
    window.location.protocol === "file:"
      ? "wss:"
      : "ws:";

  // Use /ws path for WebSocket connections (proxied by nginx)
  return `${protocol}//${WS_HOST}/ws?${params.toString()}`;
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Calculate reconnection delay with exponential backoff and jitter
 */
function getReconnectDelay(): number {
  const delay = Math.min(
    RECONNECT_BASE_DELAY * Math.pow(2, getReconnectAttempts()),
    RECONNECT_MAX_DELAY,
  );
  // Add jitter to prevent thundering herd
  return delay + Math.random() * 1000;
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
  setLastPongTime(Date.now());

  const interval = setInterval(() => {
    const timeSinceLastPong = Date.now() - getLastPongTime();
    const ws = getWs();

    debugLog("HEALTH", "debug", "Health check tick", {
      timeSinceLastPong: timeSinceLastPong,
      wsState: getWsState(),
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

  setHealthCheckInterval(interval);
}

/**
 * Stop health check monitoring
 */
function stopHealthCheck(): void {
  debugLog("HEALTH", "info", "Stopping health check");
  const interval = getHealthCheckInterval();
  if (interval) {
    clearInterval(interval);
    setHealthCheckInterval(null);
  }
}

// ============================================================================
// Web Push Registration
// ============================================================================

/**
 * Register Web Push subscription for PWA push notifications
 */
async function registerWebPush(): Promise<void> {
  debugLog("WS", "info", "registerWebPush called");

  // Check if service worker and push are supported
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    debugLog("WS", "info", "Web Push not supported in this browser");
    return;
  }

  // Get VAPID public key from meta tag
  const vapidMeta = document.querySelector(
    'meta[name="vapid-public-key"]',
  ) as HTMLMetaElement | null;
  if (!vapidMeta || !vapidMeta.content) {
    debugLog("WS", "info", "VAPID public key not configured");
    return;
  }
  const vapidPublicKey = vapidMeta.content;

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
      wsState: getWsState(),
    });
    return;
  }
  setIsConnecting(true);

  setCurrentCorrelationId(generateCorrelationId());
  setConnectionStartTime(Date.now());

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
    setWs(ws);

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
        setReconnectTimeout(null);
      }

      // Reset reconnection backoff on successful connection
      setReconnectAttempts(0);

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
            setLastPongTime(Date.now());
          } else if (msg.type === "terminal_data") {
            // Route terminal data to correct terminal
            const data = base64ToBytes(msg.data);
            if (terminalDataHandler) {
              terminalDataHandler(msg.terminal || "llm", data);
            }
          } else if (msg.type === "session" && msg.id) {
            console.log("Session ID:", msg.id);
            setCurrentSessionId(msg.id);
            // Register for push notifications
            registerWebPush();
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
      setReconnectTimeout(timeout);
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
    setReconnectTimeout(timeout);
  }
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
    wsState: getWsState(),
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
      setReconnectAttempts(0);
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
    wsState: getWsState(),
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
    setReconnectTimeout(null);
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
    wsState: getWsState(),
    wsReadyState: ws ? ws.readyState : null,
  });

  // Network is back - reconnect immediately
  updateStatus("connecting", "Network restored - reconnecting...");
  setReconnectAttempts(0);
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
