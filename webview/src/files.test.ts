/**
 * Unit tests for file navigation module.
 * Uses Node.js native test runner.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getCurrentPath,
  getCurrentFilePath,
  isInitialized,
  onFileListChange,
  onFileContentChange,
  onDiffContentChange,
  handleFileMessage,
  __test_reset,
} from "./files.js";
import {
  PROJECT_ROOT,
  FileListMessage,
  FileContentMessage,
  FileWithDiffMessage,
  FileInfo,
} from "./types.js";

describe("files module", () => {
  beforeEach(() => {
    __test_reset();
  });

  describe("state getters", () => {
    it("getCurrentPath returns PROJECT_ROOT initially", () => {
      assert.equal(getCurrentPath(), PROJECT_ROOT);
    });

    it("getCurrentFilePath returns empty string initially", () => {
      assert.equal(getCurrentFilePath(), "");
    });

    it("isInitialized returns false initially", () => {
      assert.equal(isInitialized(), false);
    });
  });

  describe("callback registration", () => {
    it("onFileListChange stores callback and it gets called", () => {
      let called = false;
      let receivedFiles: FileInfo[] = [];
      let receivedPath = "";

      onFileListChange((files, path) => {
        called = true;
        receivedFiles = files;
        receivedPath = path;
      });

      const msg: FileListMessage = {
        type: "file_list",
        files: [{ name: "test.ts", is_dir: false, size: 100 }],
        path: "/test/path",
      };
      handleFileMessage(msg);

      assert.equal(called, true);
      assert.equal(receivedFiles.length, 1);
      assert.equal(receivedFiles[0].name, "test.ts");
      assert.equal(receivedPath, "/test/path");
    });

    it("onFileContentChange stores callback and it gets called", () => {
      let called = false;
      let receivedContent = "";
      let receivedFilename = "";

      onFileContentChange((content, filename) => {
        called = true;
        receivedContent = content;
        receivedFilename = filename;
      });

      const msg: FileContentMessage = {
        type: "file_content",
        content: "file contents here",
        path: "/some/path/file.ts",
      };
      handleFileMessage(msg);

      assert.equal(called, true);
      assert.equal(receivedContent, "file contents here");
      assert.equal(receivedFilename, "file.ts");
    });

    it("onDiffContentChange stores callback and it gets called", () => {
      let called = false;
      let receivedDiff = "";
      let receivedFilename = "";
      let receivedHasDiff = false;

      onDiffContentChange((diff, filename, hasDiff) => {
        called = true;
        receivedDiff = diff;
        receivedFilename = filename;
        receivedHasDiff = hasDiff;
      });

      const msg: FileWithDiffMessage = {
        type: "file_with_diff",
        diff: "+added line\n-removed line",
        path: "/path/to/changed.ts",
        hasDiff: true,
      };
      handleFileMessage(msg);

      assert.equal(called, true);
      assert.equal(receivedDiff, "+added line\n-removed line");
      assert.equal(receivedFilename, "changed.ts");
      assert.equal(receivedHasDiff, true);
    });
  });

  describe("handleFileMessage - file_list", () => {
    it("updates currentPath from message", () => {
      const msg: FileListMessage = {
        type: "file_list",
        files: [],
        path: "/new/path",
      };
      handleFileMessage(msg);

      assert.equal(getCurrentPath(), "/new/path");
    });

    it("handles empty files array", () => {
      let receivedFiles: FileInfo[] | null = null;

      onFileListChange((files) => {
        receivedFiles = files;
      });

      const msg: FileListMessage = {
        type: "file_list",
        files: [],
        path: "/empty",
      };
      handleFileMessage(msg);

      assert.deepEqual(receivedFiles, []);
    });

    it("handles missing files (undefined) gracefully", () => {
      let receivedFiles: FileInfo[] | null = null;

      onFileListChange((files) => {
        receivedFiles = files;
      });

      const msg: FileListMessage = {
        type: "file_list",
        path: "/no-files",
      };
      handleFileMessage(msg);

      assert.deepEqual(receivedFiles, []);
    });

    it("does not update state when error present", () => {
      const msg: FileListMessage = {
        type: "file_list",
        path: "/error/path",
        error: "Permission denied",
      };
      handleFileMessage(msg);

      // Path should remain unchanged (PROJECT_ROOT)
      assert.equal(getCurrentPath(), PROJECT_ROOT);
    });

    it("does not invoke callback when callback not registered", () => {
      // No callback registered, should not throw
      const msg: FileListMessage = {
        type: "file_list",
        files: [{ name: "test.ts", is_dir: false, size: 100 }],
        path: "/test",
      };
      handleFileMessage(msg);

      // Just verify no error thrown and path is updated
      assert.equal(getCurrentPath(), "/test");
    });
  });

  describe("handleFileMessage - file_content", () => {
    it("extracts filename from path correctly", () => {
      let receivedFilename = "";

      onFileContentChange((_, filename) => {
        receivedFilename = filename;
      });

      const msg: FileContentMessage = {
        type: "file_content",
        content: "content",
        path: "/deep/nested/path/file.tsx",
      };
      handleFileMessage(msg);

      assert.equal(receivedFilename, "file.tsx");
    });

    it("handles path with no slashes", () => {
      let receivedFilename = "";

      onFileContentChange((_, filename) => {
        receivedFilename = filename;
      });

      const msg: FileContentMessage = {
        type: "file_content",
        content: "content",
        path: "singlefile.ts",
      };
      handleFileMessage(msg);

      assert.equal(receivedFilename, "singlefile.ts");
    });

    it("does not invoke callback when error present", () => {
      let called = false;

      onFileContentChange(() => {
        called = true;
      });

      const msg: FileContentMessage = {
        type: "file_content",
        content: "content",
        path: "/path/file.ts",
        error: "File not found",
      };
      handleFileMessage(msg);

      assert.equal(called, false);
    });
  });

  describe("handleFileMessage - file_with_diff", () => {
    it("passes hasDiff true correctly", () => {
      let receivedHasDiff = false;

      onDiffContentChange((_, __, hasDiff) => {
        receivedHasDiff = hasDiff;
      });

      const msg: FileWithDiffMessage = {
        type: "file_with_diff",
        diff: "+line",
        path: "/path/file.ts",
        hasDiff: true,
      };
      handleFileMessage(msg);

      assert.equal(receivedHasDiff, true);
    });

    it("passes hasDiff false correctly", () => {
      let receivedHasDiff = true;

      onDiffContentChange((_, __, hasDiff) => {
        receivedHasDiff = hasDiff;
      });

      const msg: FileWithDiffMessage = {
        type: "file_with_diff",
        diff: "",
        path: "/path/file.ts",
        hasDiff: false,
      };
      handleFileMessage(msg);

      assert.equal(receivedHasDiff, false);
    });

    it("does not invoke callback when error present", () => {
      let called = false;

      onDiffContentChange(() => {
        called = true;
      });

      const msg: FileWithDiffMessage = {
        type: "file_with_diff",
        diff: "",
        path: "/path/file.ts",
        hasDiff: false,
        error: "Cannot read file",
      };
      handleFileMessage(msg);

      assert.equal(called, false);
    });
  });
});
