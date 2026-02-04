/**
 * Utility functions: logging, formatting, and diff processing.
 * Owns debug logging state.
 */

import hljs from "highlight.js";
import { DEBUG, USERNAME, DebugConfig, WsLogEntry, DiffLine } from "./types";
import { getWsForLogging, getCurrentCorrelationId } from "./connection";

// Re-export pure functions
export { formatFileSize, base64ToBytes, parseDiff } from "./utils-pure";

// ============================================================================
// Debug Logging State
// ============================================================================

let debugLogQueue: WsLogEntry[] = [];
let debugLogWsReady = false;

function isDebugLogWsReady(): boolean {
  return debugLogWsReady;
}

function setDebugLogWsReady(v: boolean): void {
  debugLogWsReady = v;
}

function pushDebugLog(entry: WsLogEntry): void {
  debugLogQueue.push(entry);
}

function shiftDebugLog(): WsLogEntry | undefined {
  return debugLogQueue.shift();
}

// ============================================================================
// Debug Logging
// ============================================================================

/**
 * Debug logger that routes to console and server
 */
export function debugLog(
  category: keyof DebugConfig,
  level: string,
  message: string,
  data: Record<string, unknown> = {},
): void {
  if (!DEBUG[category]) return;

  const timestamp = Date.now();
  const logEntry = {
    ts: timestamp,
    cat: category,
    corrId: getCurrentCorrelationId(),
    user: USERNAME,
    msg: message,
    ...data,
  };

  // Log to browser console
  if (level === "error") {
    console.error(`[${category}] ${message}`, data);
  } else if (level === "warn") {
    console.warn(`[${category}] ${message}`, data);
  } else {
    console.log(`[${category}] ${message}`, data);
  }

  // Route to server via WebSocket for docker logs visibility
  const wsLogEntry: WsLogEntry = {
    type: "debug_log",
    level,
    category,
    message,
    data,
  };
  if (isDebugLogWsReady()) {
    sendDebugLogToServer(wsLogEntry);
  } else {
    pushDebugLog(wsLogEntry);
  }
}

/**
 * Send a debug log entry to the server
 */
export function sendDebugLogToServer(entry: WsLogEntry): void {
  const ws = getWsForLogging();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(entry));
  }
}

/**
 * Flush queued debug logs when WebSocket connects
 */
export function flushDebugLogQueue(): void {
  setDebugLogWsReady(true);
  let entry = shiftDebugLog();
  while (entry) {
    sendDebugLogToServer(entry);
    entry = shiftDebugLog();
  }
}

// ============================================================================
// Formatting Utilities
// ============================================================================

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Convert URL-safe base64 to Uint8Array (for VAPID keys)
 */
export function urlBase64ToUint8Array(
  base64String: string,
): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ============================================================================
// Diff Processing
// ============================================================================

/**
 * Split highlighted HTML by newlines while preserving span tags
 */
export function splitHighlightedHTML(html: string): string[] {
  const lines: string[] = [];
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;

  let currentLine = "";
  const openTags: string[] = []; // Stack of open tag class names

  function walkNode(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      const parts = text.split("\n");

      for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
          // Close all open tags before pushing the line
          for (let j = openTags.length - 1; j >= 0; j--) {
            currentLine += "</span>";
          }
          lines.push(currentLine);
          currentLine = "";

          // Reopen tags for next line
          for (const className of openTags) {
            currentLine += `<span class="${className}">`;
          }
        }
        currentLine += escapeHtml(parts[i]);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      if (element.tagName.toLowerCase() === "span") {
        const className = element.className;
        currentLine += `<span class="${className}">`;
        openTags.push(className);

        // Process children
        for (const child of Array.from(element.childNodes)) {
          walkNode(child);
        }

        currentLine += "</span>";
        openTags.pop();
      } else {
        // Process children of non-span elements
        for (const child of Array.from(element.childNodes)) {
          walkNode(child);
        }
      }
    }
  }

  walkNode(tempDiv);

  // Push last line if exists
  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

// Language extension to highlight.js language map
const LANGUAGE_MAP: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  h: "c",
  hpp: "cpp",
  css: "css",
  scss: "scss",
  sass: "sass",
  html: "html",
  htm: "html",
  xml: "xml",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  sh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  sql: "sql",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  cs: "csharp",
};

/**
 * Apply syntax highlighting to diff lines
 */
export function highlightDiffLines(
  diffLines: DiffLine[],
  filePath: string,
): DiffLine[] {
  // Detect language from file extension
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const language = LANGUAGE_MAP[ext] || "";

  // Extract raw code (without +/- prefixes)
  const codeLines = diffLines.map((line) => {
    let code = line.content;
    // Remove leading +/- but preserve indentation
    if (code.startsWith("+") || code.startsWith("-")) {
      code = code.substring(1);
    }
    return code;
  });

  // Apply syntax highlighting to entire code block
  const tempDiv = document.createElement("div");
  const pre = document.createElement("pre");
  const code = document.createElement("code");

  if (language) {
    code.className = `language-${language}`;
  }

  code.textContent = codeLines.join("\n");
  pre.appendChild(code);
  tempDiv.appendChild(pre);

  // Highlight the code
  hljs.highlightElement(code);

  // Extract highlighted HTML and split back into lines
  const highlightedHTML = code.innerHTML;
  const highlightedLines = splitHighlightedHTML(highlightedHTML);

  // Match highlighted lines back to diff lines
  return diffLines.map((line, index) => ({
    ...line,
    highlightedContent: highlightedLines[index] ?? "",
  }));
}
