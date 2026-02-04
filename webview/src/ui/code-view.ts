/**
 * Code view module: file browser, code viewer, and toast notifications.
 * Handles file listing, syntax-highlighted code display, and diff viewing.
 */

import hljs from "highlight.js";
import { Diff2HtmlUI } from "diff2html/lib/ui/js/diff2html-ui-slim";
import { ColorSchemeType } from "diff2html/lib/types";
import { FileInfo, FileMessage, PROJECT_ROOT } from "../types";
import {
  getCurrentPath,
  setCurrentPath,
  getCurrentFilePath,
  setCurrentFilePath,
  isCodeViewInitialized,
  setCodeViewInitialized,
  isSelectModeActive,
  setSelectModeActive,
  getSelectedLines,
  clearSelectedLines,
  addSelectedLine,
  getSelectionPhase,
  setSelectionPhase,
  getUnstagedChanges,
  getActiveToast,
  setActiveToast,
  addToastToQueue,
  shiftToastFromQueue,
} from "../state";
import { formatFileSize } from "../utils";
import { sendMessage, isConnected } from "../connection";
import { focusLLMTerminal, sendToLLMTerminal } from "./terminal";

// ============================================================================
// Toast Notifications
// ============================================================================

/**
 * Show a toast notification
 */
export function showToast(
  message: string,
  type = "success",
  duration = 3000,
): void {
  const container = document.getElementById("toast-container");
  if (!container) return;

  // Create toast element
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;

  // If there's an active toast, queue this one
  if (getActiveToast()) {
    addToastToQueue({ message, type, duration });
    return;
  }

  // Show the toast
  setActiveToast(toast);
  container.appendChild(toast);

  // Auto-hide after duration (unless it's an error)
  if (type !== "error" && duration > 0) {
    setTimeout(() => hideToast(toast), duration);
  }
}

/**
 * Hide a toast notification
 */
function hideToast(toast: HTMLElement): void {
  if (!toast || !toast.parentNode) return;

  // Fade out animation
  toast.classList.add("hiding");

  // Remove from DOM after animation
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }

    setActiveToast(null);

    // Show next toast in queue
    const next = shiftToastFromQueue();
    if (next) showToast(next.message, next.type, next.duration);
  }, 300);
}

/**
 * Initialize toast click handler
 */
export function initToastHandlers(): void {
  document.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).classList.contains("toast")) {
      hideToast(e.target as HTMLElement);
    }
  });
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Request file listing from server
 */
export function listFiles(path: string): void {
  sendMessage({ type: "list_files", path: path });
}

/**
 * Request file content from server
 */
function readFile(path: string): void {
  sendMessage({ type: "read_file", path: path });
}

/**
 * Request file content with diff information
 */
function readFileWithDiff(path: string): void {
  sendMessage({ type: "read_file_with_diff", path: path });
}

/**
 * Navigate to a folder
 */
export function navigateToFolder(path: string): void {
  listFiles(path);
}

/**
 * Open a file for viewing
 */
export function openFile(path: string, filename: string): void {
  const filenameEl = document.getElementById("code-filename");
  if (filenameEl) filenameEl.textContent = filename;
  setCurrentFilePath(path);
  readFileWithDiff(path);
}

// ============================================================================
// File List Rendering
// ============================================================================

/**
 * Render the file list
 */
export function renderFileList(files: FileInfo[], path: string): void {
  const fileList = document.getElementById("file-list");
  const currentPathEl = document.getElementById("current-path");

  if (!fileList || !currentPathEl) return;

  setCurrentPath(path);
  currentPathEl.textContent = path;

  // Build set of unstaged file paths and directories containing unstaged files
  const unstagedChanges = getUnstagedChanges();
  const unstagedPaths = new Set(unstagedChanges.map((f) => f.path));
  const dirsWithUnstaged = new Set<string>();
  const untrackedDirPrefixes: string[] = [];

  for (const f of unstagedChanges) {
    // Untracked directories end with / - track them separately
    if (f.path.endsWith("/")) {
      const dirPath = f.path.slice(0, -1);
      untrackedDirPrefixes.push(dirPath + "/");
      dirsWithUnstaged.add(dirPath);
      continue;
    }
    const parts = f.path.split("/");
    // Add all parent directories to the set
    for (let i = 1; i < parts.length; i++) {
      dirsWithUnstaged.add(parts.slice(0, i).join("/"));
    }
  }

  // Helper to check if path is inside an untracked directory
  const isInsideUntrackedDir = (relPath: string): boolean => {
    return untrackedDirPrefixes.some((prefix) => relPath.startsWith(prefix));
  };

  // Build set of ignored file/directory names
  const ignoredNames = new Set<string>();
  for (const file of files) {
    if (file.is_ignored) {
      ignoredNames.add(file.name);
    }
  }

  let html = "";

  // Add parent directory link if not at project root
  if (path !== PROJECT_ROOT) {
    const parentPath = path.split("/").slice(0, -1).join("/") || PROJECT_ROOT;
    html += `
            <div class="file-item" onclick="navigateToFolder('${parentPath}')">
                <span class="file-icon">📁</span>
                <span class="file-name">..</span>
            </div>
        `;
  }

  // Filter out .git directory and sort: folders first, then files
  const sorted = [...files]
    .filter((f) => f.name !== ".git")
    .sort((a, b) => {
      if (a.is_dir && !b.is_dir) return -1;
      if (!a.is_dir && b.is_dir) return 1;
      return a.name.localeCompare(b.name);
    });

  for (const file of sorted) {
    const icon = file.is_dir ? "📁" : "📄";
    const size = file.is_dir ? "" : formatFileSize(file.size);
    const fullPath = path + "/" + file.name;
    const relativePath = fullPath.replace(PROJECT_ROOT + "/", "");
    const hasUnstagedChanges = file.is_dir
      ? dirsWithUnstaged.has(relativePath) ||
        isInsideUntrackedDir(relativePath + "/")
      : unstagedPaths.has(relativePath) || isInsideUntrackedDir(relativePath);
    // Only show as ignored if not already showing as unstaged
    const isIgnored = !hasUnstagedChanges && ignoredNames.has(file.name);

    // Determine CSS class
    let cssClass = "file-item";
    if (hasUnstagedChanges) {
      cssClass += " has-unstaged-changes";
    } else if (isIgnored) {
      cssClass += " is-ignored";
    }

    if (file.is_dir) {
      html += `
                <div class="${cssClass}" onclick="navigateToFolder('${fullPath}')">
                    <span class="file-icon">${icon}</span>
                    <span class="file-name">${file.name}</span>
                </div>
            `;
    } else {
      html += `
                <div class="${cssClass}" onclick="openFile('${fullPath}', '${file.name}')">
                    <span class="file-icon">${icon}</span>
                    <span class="file-name">${file.name}</span>
                    <span class="file-size">${size}</span>
                </div>
            `;
    }
  }

  fileList.innerHTML = html;
}

// ============================================================================
// Code Viewer
// ============================================================================

/**
 * Show code viewer with syntax highlighting
 */
function showCodeViewer(content: string, filename: string): void {
  const codeEl = document.getElementById("code-content");
  const normalContainer = document.getElementById("code-content-normal");
  const diffContainer = document.getElementById("code-content-diff");

  if (!codeEl || !normalContainer || !diffContainer) return;

  // Show normal view, hide diff view
  normalContainer.style.display = "block";
  diffContainer.style.display = "none";

  codeEl.textContent = content;

  // Auto-detect language and highlight
  delete (codeEl as HTMLElement & { dataset: { highlighted?: string } }).dataset
    .highlighted;
  hljs.highlightElement(codeEl);

  // Switch panels
  document.getElementById("file-explorer-panel")?.classList.remove("active");
  document.getElementById("code-viewer-panel")?.classList.add("active");
}

// diff2html configuration - line-by-line is more mobile-friendly
const diff2htmlConfig = {
  drawFileList: false,
  fileListToggle: false,
  fileContentToggle: false,
  matching: "lines" as const,
  outputFormat: "line-by-line" as const,
  synchronisedScroll: true,
  highlight: true,
  renderNothingWhenEmpty: false,
  colorScheme: ColorSchemeType.DARK,
};

/**
 * Show diff viewer with syntax highlighting
 */
function showDiffViewer(
  diff: string,
  filename: string,
  hasChanges = true,
): void {
  const normalContainer = document.getElementById("code-content-normal");
  const diffContainer = document.getElementById("code-content-diff");

  if (!normalContainer || !diffContainer) return;

  // Hide normal view, show diff view
  normalContainer.style.display = "none";
  diffContainer.style.display = "block";

  // Add/remove no-changes class for styling
  if (hasChanges) {
    diffContainer.classList.remove("no-changes");
  } else {
    diffContainer.classList.add("no-changes");
  }

  // Render diff using diff2html
  const diff2htmlUi = new Diff2HtmlUI(diffContainer, diff, diff2htmlConfig);
  diff2htmlUi.draw();
  diff2htmlUi.highlightCode();

  // Add data-line attributes to each line for selection
  const lineElements = diffContainer.querySelectorAll(".d2h-code-line-ctn");
  lineElements.forEach((el, index) => {
    (el as HTMLElement).dataset.line = String(index);
  });

  // Clear selection when viewing new file
  clearSelection();

  // Switch panels
  document.getElementById("file-explorer-panel")?.classList.remove("active");
  document.getElementById("code-viewer-panel")?.classList.add("active");
}

/**
 * Show file explorer panel
 */
export function showFileExplorer(): void {
  document.getElementById("code-viewer-panel")?.classList.remove("active");
  document.getElementById("file-explorer-panel")?.classList.add("active");

  // Reset select mode when leaving code viewer
  if (isSelectModeActive()) {
    setSelectModeActive(false);
    document.getElementById("code-select-toggle")?.classList.remove("active");
    document
      .getElementById("code-content-diff")
      ?.classList.remove("select-mode");
    clearSelection();
  }
}

// ============================================================================
// Selection Mode
// ============================================================================

/**
 * Toggle selection mode for code lines
 */
export function toggleSelectMode(): void {
  const active = !isSelectModeActive();
  setSelectModeActive(active);

  const btn = document.getElementById("code-select-toggle");
  const diffContainer = document.getElementById("code-content-diff");

  if (!btn || !diffContainer) return;

  if (active) {
    btn.classList.add("active");
    diffContainer.classList.add("select-mode");
  } else {
    btn.classList.remove("active");
    diffContainer.classList.remove("select-mode");
    clearSelection();
  }
}

/**
 * Clear all selected lines
 */
function clearSelection(): void {
  clearSelectedLines();
  document.querySelectorAll(".d2h-code-line-ctn.selected").forEach((el) => {
    el.classList.remove("selected");
  });
  setSelectionPhase("none");
  updateSendToLLMButton();
}

/**
 * Select a specific line
 */
function selectLine(lineNumber: number): void {
  const lineEl = document.querySelector(
    `.d2h-code-line-ctn[data-line="${lineNumber}"]`,
  );
  if (lineEl) {
    addSelectedLine(lineNumber);
    lineEl.classList.add("selected");
  }
}

/**
 * Update the position of the "Send to LLM" button
 */
function updateSendToLLMButton(): void {
  const btn = document.getElementById("send-to-llm-btn") as HTMLElement | null;
  if (!btn) return;

  const selectedLines = getSelectedLines();
  if (selectedLines.size === 0) {
    btn.style.display = "none";
    return;
  }

  // Find the last selected line element
  const sortedLines = Array.from(selectedLines).sort((a, b) => a - b);
  const lastLineNumber = sortedLines[sortedLines.length - 1];
  const lastLineEl = document.querySelector(
    `.d2h-code-line-ctn[data-line="${lastLineNumber}"]`,
  );

  if (!lastLineEl) {
    btn.style.display = "none";
    return;
  }

  // Position the button below the last selected line
  const lineRect = lastLineEl.getBoundingClientRect();
  btn.style.display = "block";
  btn.style.top = lineRect.bottom + "px";
}

/**
 * Handle line click in selection mode
 */
function handleLineClick(lineNumber: number): void {
  if (!isSelectModeActive()) return;

  const phase = getSelectionPhase();
  if (phase === "range") {
    // Tap after range is complete: just clear
    clearSelection();
  } else if (phase === "none") {
    // First tap: select starting line
    selectLine(lineNumber);
    setSelectionPhase("first");
    updateSendToLLMButton();
  } else if (phase === "first") {
    // Second tap: select range from first to this line
    const selectedLines = getSelectedLines();
    const firstLine = Array.from(selectedLines)[0];
    const start = Math.min(firstLine, lineNumber);
    const end = Math.max(firstLine, lineNumber);

    // Clear and select entire range
    clearSelection();
    for (let i = start; i <= end; i++) {
      selectLine(i);
    }
    setSelectionPhase("range");
    updateSendToLLMButton();
  }
}

/**
 * Send selected lines to LLM terminal
 */
function sendSelectionToLLM(): void {
  const selectedLines = getSelectedLines();
  const currentFilePath = getCurrentFilePath();

  if (selectedLines.size === 0 || !currentFilePath) return;

  // Get line range (convert to 1-based for display)
  const sortedLines = Array.from(selectedLines).sort((a, b) => a - b);
  const startLine = sortedLines[0] + 1;
  const endLine = sortedLines[sortedLines.length - 1] + 1;

  // Create reference string
  let reference: string;
  if (startLine === endLine) {
    reference = `${currentFilePath}:${startLine} `;
  } else {
    reference = `${currentFilePath}:${startLine}-${endLine} `;
  }

  // Switch to LLM view (this will be handled by app.ts via switchView)
  const switchViewEvent = new CustomEvent("switchView", { detail: "llm" });
  document.dispatchEvent(switchViewEvent);

  // Focus the terminal and send reference
  focusLLMTerminal();
  sendToLLMTerminal(reference);

  // Clear selection and exit select mode
  setSelectModeActive(false);
  document.getElementById("code-select-toggle")?.classList.remove("active");
  document.getElementById("code-content-diff")?.classList.remove("select-mode");
  clearSelection();
}

/**
 * Initialize code view event handlers
 */
export function initCodeViewHandlers(): void {
  // Click handler for code lines using event delegation
  document
    .getElementById("code-content-diff")
    ?.addEventListener("click", (e) => {
      const lineEl = (e.target as HTMLElement).closest(
        ".d2h-code-line-ctn",
      ) as HTMLElement | null;
      if (lineEl && lineEl.dataset.line !== undefined) {
        handleLineClick(parseInt(lineEl.dataset.line, 10));
      }
    });

  // Update button position on scroll
  document
    .getElementById("code-content-diff")
    ?.addEventListener("scroll", () => {
      if (isSelectModeActive() && getSelectedLines().size > 0) {
        updateSendToLLMButton();
      }
    });

  // Send to LLM button click handler
  document
    .getElementById("send-to-llm-btn")
    ?.addEventListener("click", sendSelectionToLLM);
}

// ============================================================================
// Message Handler
// ============================================================================

/**
 * Handle file-related messages from WebSocket
 */
export function handleFileMessage(msg: FileMessage): void {
  if (msg.type === "file_list") {
    if (msg.error) {
      console.error("File list error:", msg.error);
      return;
    }
    renderFileList(msg.files || [], msg.path);
  } else if (msg.type === "file_content") {
    if (msg.error) {
      console.error("File read error:", msg.error);
      return;
    }
    showCodeViewer(msg.content, msg.path.split("/").pop() || "");
  } else if (msg.type === "file_with_diff") {
    if (msg.error) {
      console.error("File read error:", msg.error);
      return;
    }

    const filename = msg.path.split("/").pop() || "";
    showDiffViewer(msg.diff, filename, msg.hasDiff);
  }
}

// ============================================================================
// View Activation
// ============================================================================

/**
 * Activate code view and load files if needed
 */
export function activateCodeView(): void {
  if (!isConnected()) return;

  // Load git status for file highlighting
  sendMessage({ type: "git_status" });

  if (!isCodeViewInitialized()) {
    setCodeViewInitialized(true);
    listFiles(PROJECT_ROOT);
  }

  // Reload current file if viewer is active
  const currentFilePath = getCurrentFilePath();
  if (
    document
      .getElementById("code-viewer-panel")
      ?.classList.contains("active") &&
    currentFilePath
  ) {
    readFileWithDiff(currentFilePath);
  }
}

/**
 * Refresh file list at current path
 */
export function refreshFileList(): void {
  const currentPath = getCurrentPath();
  if (currentPath) {
    listFiles(currentPath);
  }
}
