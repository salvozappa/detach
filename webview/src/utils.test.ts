/**
 * Unit tests for utility functions.
 * Uses Node.js native test runner.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatFileSize,
  parseDiff,
  base64ToBytes,
  urlBase64ToUint8Array,
  escapeHtml,
} from "./utils.js";

// Mock document for testing DOM-dependent functions
const mockDoc = {
  createElement: (tag: string) => {
    let textContent = "";
    let innerHTML = "";
    return {
      get textContent() {
        return textContent;
      },
      set textContent(v: string) {
        textContent = v;
        // Simple HTML escaping for mock
        innerHTML = v
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      },
      get innerHTML() {
        return innerHTML;
      },
      set innerHTML(v: string) {
        innerHTML = v;
      },
    };
  },
} as unknown as Document;

describe("formatFileSize", () => {
  it("formats 0 bytes", () => {
    assert.equal(formatFileSize(0), "0 B");
  });

  it("formats bytes under 1KB", () => {
    assert.equal(formatFileSize(500), "500 B");
    assert.equal(formatFileSize(1023), "1023 B");
  });

  it("formats kilobytes", () => {
    assert.equal(formatFileSize(1024), "1.0 KB");
    assert.equal(formatFileSize(1536), "1.5 KB");
    assert.equal(formatFileSize(10240), "10.0 KB");
  });

  it("formats megabytes", () => {
    assert.equal(formatFileSize(1024 * 1024), "1.0 MB");
    assert.equal(formatFileSize(1.5 * 1024 * 1024), "1.5 MB");
  });
});

describe("parseDiff", () => {
  it("returns empty array for empty input", () => {
    assert.deepEqual(parseDiff(""), [{ type: "context", content: "" }]);
  });

  it("parses added lines", () => {
    const result = parseDiff("+new line");
    assert.deepEqual(result, [{ type: "added", content: "+new line" }]);
  });

  it("parses removed lines", () => {
    const result = parseDiff("-old line");
    assert.deepEqual(result, [{ type: "removed", content: "-old line" }]);
  });

  it("parses context lines", () => {
    const result = parseDiff(" unchanged");
    assert.deepEqual(result, [{ type: "context", content: " unchanged" }]);
  });

  it("filters out diff headers", () => {
    const diff = `diff --git a/file.ts b/file.ts
index abc123..def456 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 context
+added
-removed`;
    const result = parseDiff(diff);
    assert.deepEqual(result, [
      { type: "context", content: " context" },
      { type: "added", content: "+added" },
      { type: "removed", content: "-removed" },
    ]);
  });

  it("handles multiple lines", () => {
    const diff = `+line1
-line2
 line3`;
    const result = parseDiff(diff);
    assert.equal(result.length, 3);
    assert.equal(result[0].type, "added");
    assert.equal(result[1].type, "removed");
    assert.equal(result[2].type, "context");
  });
});

describe("base64ToBytes", () => {
  it("decodes basic ASCII", () => {
    const result = base64ToBytes("aGVsbG8=");
    assert.equal(result.length, 5);
    assert.equal(String.fromCharCode(...result), "hello");
  });

  it("decodes empty string", () => {
    const result = base64ToBytes("");
    assert.equal(result.length, 0);
  });

  it("returns Uint8Array", () => {
    const result = base64ToBytes("dGVzdA==");
    assert.ok(result instanceof Uint8Array);
  });
});

describe("urlBase64ToUint8Array", () => {
  it("converts URL-safe base64", () => {
    // Standard base64: "test" = "dGVzdA=="
    // URL-safe would replace + with - and / with _
    const result = urlBase64ToUint8Array("dGVzdA");
    assert.equal(String.fromCharCode(...result), "test");
  });

  it("handles padding", () => {
    // "a" in base64 is "YQ==" - without padding it's "YQ"
    const result = urlBase64ToUint8Array("YQ");
    assert.equal(String.fromCharCode(...result), "a");
  });
});

describe("escapeHtml", () => {
  it("escapes angle brackets", () => {
    const result = escapeHtml("<script>", mockDoc);
    assert.equal(result, "&lt;script&gt;");
  });

  it("escapes ampersands", () => {
    const result = escapeHtml("a & b", mockDoc);
    assert.equal(result, "a &amp; b");
  });

  it("escapes quotes", () => {
    const result = escapeHtml('"quoted"', mockDoc);
    assert.equal(result, "&quot;quoted&quot;");
  });

  it("passes through plain text", () => {
    const result = escapeHtml("hello world", mockDoc);
    assert.equal(result, "hello world");
  });
});
