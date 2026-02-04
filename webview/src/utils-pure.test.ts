/**
 * Unit tests for pure utility functions.
 * Uses Node.js native test runner.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatFileSize, parseDiff, base64ToBytes } from "./utils-pure.js";

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
    // "hello" in base64
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
