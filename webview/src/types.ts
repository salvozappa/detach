// ============================================================================
// Type Definitions
// ============================================================================

export interface FileInfo {
  name: string;
  is_dir: boolean;
  size: number;
  is_ignored?: boolean;
}

export interface FileChange {
  path: string;
  diff: string;
  added: number;
  removed: number;
  isUntracked: boolean;
}

// Re-exported from utils-pure.ts for backwards compatibility
export type { DiffLine } from "./utils-pure";

export interface ToastItem {
  message: string;
  type: string;
  duration: number;
}

export interface DebugConfig {
  WS: boolean;
  HEALTH: boolean;
  VISIBILITY: boolean;
  NETWORK: boolean;
  TERMINAL: boolean;
  TOOLBAR: boolean;
  FOCUS: boolean;
}

export interface WsLogEntry {
  type: string;
  level: string;
  category: string;
  message: string;
  data: Record<string, unknown>;
}

// ============================================================================
// Message Types (WebSocket protocol)
// ============================================================================

export interface FileListMessage {
  type: "file_list";
  files?: FileInfo[];
  path: string;
  error?: string;
}

export interface FileContentMessage {
  type: "file_content";
  content: string;
  path: string;
  error?: string;
}

export interface FileWithDiffMessage {
  type: "file_with_diff";
  diff: string;
  path: string;
  hasDiff: boolean;
  error?: string;
}

export type FileMessage =
  | FileListMessage
  | FileContentMessage
  | FileWithDiffMessage;

export interface GitStatusMessage {
  type: "git_status";
  unstaged?: FileChange[];
  staged?: FileChange[];
}

export interface GitErrorMessage {
  type: "git_error";
  error: string;
}

export type GitMessage = GitStatusMessage | GitErrorMessage | { type: string };

// ============================================================================
// Connection State
// ============================================================================

export const WS_STATES = {
  DISCONNECTED: "DISCONNECTED",
  CONNECTING: "CONNECTING",
  CONNECTED: "CONNECTED",
  RECONNECTING: "RECONNECTING",
  CLOSING: "CLOSING",
} as const;

export type WsState = (typeof WS_STATES)[keyof typeof WS_STATES];

export const CLOSE_CODE_MEANINGS: Record<number, string> = {
  1000: "Normal closure",
  1001: "Going away (browser/tab closing)",
  1002: "Protocol error",
  1003: "Unsupported data",
  1005: "No status received",
  1006: "Abnormal closure (no close frame)",
  1007: "Invalid frame payload data",
  1008: "Policy violation",
  1009: "Message too big",
  1010: "Mandatory extension",
  1011: "Internal server error",
  1015: "TLS handshake failure",
};

// ============================================================================
// Configuration Constants
// ============================================================================

export const APP_VERSION = "2026-01-28-v9";

export const WS_HOST = window.location.host || "nightly01.tail5fb253.ts.net";
export const WS_PORT = "8081";

export const USERNAME = "detach-dev";

export const PROJECT_ROOT = "~/projects/notestash";

export const RECONNECT_BASE_DELAY = 1000; // Start at 1 second
export const RECONNECT_MAX_DELAY = 30000; // Max 30 seconds

export const DEBUG: DebugConfig = {
  WS: true, // WebSocket connection events
  HEALTH: true, // Health check events
  VISIBILITY: true, // Page visibility events
  NETWORK: true, // Network online/offline events
  TERMINAL: true, // Terminal input/focus events
  TOOLBAR: true, // Keyboard toolbar button events
  FOCUS: true, // Document focus events
};
