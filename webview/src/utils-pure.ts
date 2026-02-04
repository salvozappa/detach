/**
 * Pure utility functions with no browser dependencies.
 * These can be tested directly in Node.js without mocking.
 */

export interface DiffLine {
  type: "added" | "removed" | "context";
  content: string;
  highlightedContent?: string;
}

/**
 * Format file size to human-readable string
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/**
 * Decode base64 to Uint8Array (handles UTF-8 properly)
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Parse git diff output into structured lines
 */
export function parseDiff(diffText: string): DiffLine[] {
  const lines = diffText.split("\n");
  const result: DiffLine[] = [];

  for (const line of lines) {
    // Skip diff metadata headers
    if (
      line.startsWith("diff") ||
      line.startsWith("index") ||
      line.startsWith("---") ||
      line.startsWith("+++") ||
      line.startsWith("@@")
    ) {
      continue;
    }

    if (line.startsWith("+")) {
      result.push({ type: "added", content: line });
    } else if (line.startsWith("-")) {
      result.push({ type: "removed", content: line });
    } else {
      result.push({ type: "context", content: line });
    }
  }

  return result;
}
