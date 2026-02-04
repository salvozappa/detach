/**
 * Unit tests for git operations module.
 * Uses Node.js native test runner.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getUnstagedChanges,
  getStagedChanges,
  onGitStateChange,
  setToastFn,
  setRefreshFileListFn,
  getDiscardConfirmTime,
  setDiscardConfirmTime,
  clearDiscardConfirm,
  handleGitMessage,
  __test_reset,
} from "./git.js";
import { GitStatusMessage, FileChange } from "./types.js";

// Mock global document for handleGitMessage tests
const mockEvents: { type: string }[] = [];
const mockDocument = {
  getElementById: () => null,
  dispatchEvent: (event: { type: string }) => {
    mockEvents.push(event);
    return true;
  },
};

// Mock alert for git_error tests
const mockAlerts: string[] = [];
const mockAlert = (message: string) => {
  mockAlerts.push(message);
};

// Store originals and set mocks
const originalDocument =
  typeof globalThis.document !== "undefined" ? globalThis.document : undefined;
const originalAlert =
  typeof globalThis.alert !== "undefined" ? globalThis.alert : undefined;

describe("git module", () => {
  beforeEach(() => {
    __test_reset();
    mockEvents.length = 0;
    mockAlerts.length = 0;
    // Set up mocks for tests
    (globalThis as { document?: unknown }).document = mockDocument;
    (globalThis as { alert?: unknown }).alert = mockAlert;
  });

  describe("state getters", () => {
    it("getUnstagedChanges returns empty array initially", () => {
      assert.deepEqual(getUnstagedChanges(), []);
    });

    it("getStagedChanges returns empty array initially", () => {
      assert.deepEqual(getStagedChanges(), []);
    });
  });

  describe("callback registration", () => {
    it("onGitStateChange stores callback and it gets called", () => {
      let called = false;

      onGitStateChange(() => {
        called = true;
      });

      const msg: GitStatusMessage = {
        type: "git_status",
        unstaged: [],
        staged: [],
      };
      handleGitMessage(msg);

      assert.equal(called, true);
    });

    it("setToastFn stores callback and it gets called on commit success", () => {
      let toastMessage = "";
      let toastType: string | undefined;

      setToastFn((message, type) => {
        toastMessage = message;
        toastType = type;
      });

      handleGitMessage({ type: "git_commit_success" });

      assert.equal(toastMessage, "Committed successfully");
      assert.equal(toastType, undefined);
    });

    it("setRefreshFileListFn stores callback", () => {
      let called = false;

      setRefreshFileListFn(() => {
        called = true;
      });

      // refreshFileList is only called when code view is active
      // Since we mock getElementById to return null, it won't be called
      const msg: GitStatusMessage = {
        type: "git_status",
        unstaged: [],
        staged: [],
      };
      handleGitMessage(msg);

      // With null element, refreshFileList should not be called
      assert.equal(called, false);
    });
  });

  describe("discard confirmation state", () => {
    it("getDiscardConfirmTime returns 0 for unknown file", () => {
      assert.equal(getDiscardConfirmTime("unknown/file.ts"), 0);
    });

    it("setDiscardConfirmTime stores timestamp", () => {
      const now = Date.now();
      setDiscardConfirmTime("src/file.ts", now);

      assert.equal(getDiscardConfirmTime("src/file.ts"), now);
    });

    it("clearDiscardConfirm removes entry", () => {
      const now = Date.now();
      setDiscardConfirmTime("src/file.ts", now);

      clearDiscardConfirm("src/file.ts");

      assert.equal(getDiscardConfirmTime("src/file.ts"), 0);
    });

    it("handles multiple files independently", () => {
      const time1 = 1000;
      const time2 = 2000;

      setDiscardConfirmTime("file1.ts", time1);
      setDiscardConfirmTime("file2.ts", time2);

      assert.equal(getDiscardConfirmTime("file1.ts"), time1);
      assert.equal(getDiscardConfirmTime("file2.ts"), time2);

      clearDiscardConfirm("file1.ts");

      assert.equal(getDiscardConfirmTime("file1.ts"), 0);
      assert.equal(getDiscardConfirmTime("file2.ts"), time2);
    });

    it("overwrites existing timestamp", () => {
      setDiscardConfirmTime("file.ts", 1000);
      setDiscardConfirmTime("file.ts", 2000);

      assert.equal(getDiscardConfirmTime("file.ts"), 2000);
    });
  });

  describe("handleGitMessage - git_status", () => {
    it("updates unstagedChanges from message", () => {
      const changes: FileChange[] = [
        { path: "file1.ts", diff: "+line", added: 1, removed: 0, isUntracked: false },
      ];

      const msg: GitStatusMessage = {
        type: "git_status",
        unstaged: changes,
        staged: [],
      };
      handleGitMessage(msg);

      assert.deepEqual(getUnstagedChanges(), changes);
    });

    it("updates stagedChanges from message", () => {
      const changes: FileChange[] = [
        { path: "file2.ts", diff: "-line", added: 0, removed: 1, isUntracked: false },
      ];

      const msg: GitStatusMessage = {
        type: "git_status",
        unstaged: [],
        staged: changes,
      };
      handleGitMessage(msg);

      assert.deepEqual(getStagedChanges(), changes);
    });

    it("handles undefined unstaged/staged arrays", () => {
      const msg: GitStatusMessage = {
        type: "git_status",
      };
      handleGitMessage(msg);

      assert.deepEqual(getUnstagedChanges(), []);
      assert.deepEqual(getStagedChanges(), []);
    });

    it("invokes onStateChange callback", () => {
      let callCount = 0;

      onGitStateChange(() => {
        callCount++;
      });

      handleGitMessage({ type: "git_status", unstaged: [], staged: [] });
      handleGitMessage({ type: "git_status", unstaged: [], staged: [] });

      assert.equal(callCount, 2);
    });
  });

  describe("handleGitMessage - success messages", () => {
    it("git_commit_success shows toast", () => {
      let toastMessage = "";

      setToastFn((message) => {
        toastMessage = message;
      });

      handleGitMessage({ type: "git_commit_success" });

      assert.equal(toastMessage, "Committed successfully");
    });

    it("git_commit_success dispatches event", () => {
      handleGitMessage({ type: "git_commit_success" });

      assert.equal(mockEvents.length, 1);
      assert.equal(mockEvents[0].type, "gitCommitSuccess");
    });

    it("git_pull_success shows toast and dispatches event", () => {
      let toastMessage = "";

      setToastFn((message) => {
        toastMessage = message;
      });

      handleGitMessage({ type: "git_pull_success" });

      assert.equal(toastMessage, "Pulled changes");
      assert.equal(mockEvents.some((e) => e.type === "gitPullSuccess"), true);
    });

    it("git_push_success shows toast and dispatches event", () => {
      let toastMessage = "";

      setToastFn((message) => {
        toastMessage = message;
      });

      handleGitMessage({ type: "git_push_success" });

      assert.equal(toastMessage, "Pushed to remote");
      assert.equal(mockEvents.some((e) => e.type === "gitPushSuccess"), true);
    });
  });

  describe("handleGitMessage - git_error", () => {
    it("dispatches gitError event", () => {
      handleGitMessage({ type: "git_error", error: "Something went wrong" });

      assert.equal(mockEvents.some((e) => e.type === "gitError"), true);
    });

    it("shows alert with error message", () => {
      handleGitMessage({ type: "git_error", error: "Something went wrong" });

      assert.equal(mockAlerts.length, 1);
      assert.equal(mockAlerts[0], "Error: Something went wrong");
    });
  });
});

// Cleanup: restore original global state
if (originalDocument !== undefined) {
  (globalThis as { document?: unknown }).document = originalDocument;
}
if (originalAlert !== undefined) {
  (globalThis as { alert?: unknown }).alert = originalAlert;
}
