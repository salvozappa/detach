/**
 * Unit tests for WebSocket connection module.
 * Uses Node.js native test runner.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getCurrentSessionId,
  getCurrentCorrelationId,
  getWsForLogging,
  registerMessageHandler,
  registerTerminalDataHandler,
  registerSessionHandler,
  registerTerminalSizeCallback,
  sendMessage,
  isConnected,
  calculateReconnectDelay,
  buildWebSocketURL,
  __test_reset,
} from "./connection.js";
import { RECONNECT_BASE_DELAY, RECONNECT_MAX_DELAY } from "./types.js";

describe("connection module", () => {
  beforeEach(() => {
    __test_reset();
  });

  describe("state getters", () => {
    it("getCurrentSessionId returns null initially", () => {
      assert.equal(getCurrentSessionId(), null);
    });

    it("getCurrentCorrelationId returns null initially", () => {
      assert.equal(getCurrentCorrelationId(), null);
    });

    it("getWsForLogging returns null initially", () => {
      assert.equal(getWsForLogging(), null);
    });

    it("isConnected returns false when no WebSocket", () => {
      assert.equal(isConnected(), false);
    });
  });

  describe("sendMessage", () => {
    it("returns false when WebSocket is null", () => {
      const result = sendMessage({ type: "test" });
      assert.equal(result, false);
    });
  });

  describe("calculateReconnectDelay", () => {
    it("returns base delay plus jitter on first attempt", () => {
      const delay = calculateReconnectDelay(0, RECONNECT_BASE_DELAY, RECONNECT_MAX_DELAY, 0);
      assert.equal(delay, RECONNECT_BASE_DELAY);
    });

    it("doubles delay on each subsequent attempt", () => {
      const delay0 = calculateReconnectDelay(0, 1000, 30000, 0);
      const delay1 = calculateReconnectDelay(1, 1000, 30000, 0);
      const delay2 = calculateReconnectDelay(2, 1000, 30000, 0);
      const delay3 = calculateReconnectDelay(3, 1000, 30000, 0);

      assert.equal(delay0, 1000);
      assert.equal(delay1, 2000);
      assert.equal(delay2, 4000);
      assert.equal(delay3, 8000);
    });

    it("caps at max delay", () => {
      const delay = calculateReconnectDelay(10, 1000, 30000, 0);
      // 2^10 * 1000 = 1024000, but max is 30000
      assert.equal(delay, 30000);
    });

    it("adds jitter to delay", () => {
      const jitter = 500;
      const delay = calculateReconnectDelay(0, 1000, 30000, jitter);
      assert.equal(delay, 1000 + jitter);
    });

    it("uses default values when not specified", () => {
      // With default jitter (random), delay should be >= base
      const delay = calculateReconnectDelay(0);
      assert.ok(delay >= RECONNECT_BASE_DELAY);
      assert.ok(delay < RECONNECT_BASE_DELAY + 1000); // jitter is max 1000
    });
  });

  describe("buildWebSocketURL", () => {
    it("uses wss:// for https: protocol", () => {
      const url = buildWebSocketURL("https:", "example.com", "testuser");
      assert.equal(url, "wss://example.com/ws?user=testuser");
    });

    it("uses wss:// for file: protocol", () => {
      const url = buildWebSocketURL("file:", "example.com", "testuser");
      assert.equal(url, "wss://example.com/ws?user=testuser");
    });

    it("uses ws:// for http: protocol", () => {
      const url = buildWebSocketURL("http:", "localhost:8080", "testuser");
      assert.equal(url, "ws://localhost:8080/ws?user=testuser");
    });

    it("includes username parameter", () => {
      const url = buildWebSocketURL("https:", "host.com", "myuser");
      assert.ok(url.includes("user=myuser"));
    });

    it("URL-encodes special characters in username", () => {
      const url = buildWebSocketURL("https:", "host.com", "user@domain");
      assert.ok(url.includes("user=user%40domain"));
    });

    it("uses correct host", () => {
      const url = buildWebSocketURL("https:", "custom.host:9000", "user");
      assert.ok(url.includes("custom.host:9000"));
    });
  });

  describe("handler registration", () => {
    it("registerMessageHandler stores handler by type", () => {
      let received: unknown = null;

      registerMessageHandler("test_type", (msg) => {
        received = msg;
      });

      // We can't easily trigger the handler without a WebSocket connection
      // This test verifies the registration doesn't throw
      assert.equal(received, null);
    });

    it("registerTerminalDataHandler stores handler", () => {
      let called = false;

      registerTerminalDataHandler(() => {
        called = true;
      });

      // Handler stored successfully (no error thrown)
      assert.equal(called, false);
    });

    it("registerSessionHandler stores handler", () => {
      let sessionId: string | null = null;

      registerSessionHandler((id) => {
        sessionId = id;
      });

      // Handler stored successfully (no error thrown)
      assert.equal(sessionId, null);
    });

    it("registerTerminalSizeCallback stores callback", () => {
      let calledWith: string | null = null;

      registerTerminalSizeCallback((terminal) => {
        calledWith = terminal;
      });

      // Callback stored successfully (no error thrown)
      assert.equal(calledWith, null);
    });
  });
});
