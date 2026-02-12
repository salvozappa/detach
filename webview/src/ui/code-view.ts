/**
 * Code view UI: file browser, code viewer, and selection mode.
 * Imports business logic from files.ts and git.ts.
 */

import hljs from 'highlight.js';
import { Diff2HtmlUI } from 'diff2html/lib/ui/js/diff2html-ui-slim';
import { ColorSchemeType } from 'diff2html/lib/types';
import { FileInfo, PROJECT_ROOT } from '../types';
import { formatFileSize } from '../utils';
import { isConnected } from '../connection';
import * as files from '../files';
import * as git from '../git';
import { focusLLMTerminal, sendToLLMTerminal } from './terminal';

// ============================================================================
// State (UI-only state for selection mode)
// ============================================================================

let selectModeActive = false;
let selectedLines = new Set<number>();
let selectionPhase: 'none' | 'first' | 'range' = 'none';

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize code view event handlers
 */
export function initCodeViewHandlers(): void {
    // Register render callbacks with files module
    files.onFileListChange(renderFileList);
    files.onFileContentChange(showCodeViewer);
    files.onDiffContentChange(showDiffViewer);

    // Click handler for code lines using event delegation
    document.getElementById('code-content-diff')?.addEventListener('click', (e) => {
        const lineEl = (e.target as HTMLElement).closest('.d2h-code-line-ctn') as HTMLElement | null;
        if (lineEl && lineEl.dataset.line !== undefined) {
            handleLineClick(parseInt(lineEl.dataset.line, 10));
        }
    });

    // Update button position on scroll
    document.getElementById('code-content-diff')?.addEventListener('scroll', () => {
        if (selectModeActive && selectedLines.size > 0) {
            updateSendToLLMButton();
        }
    });

    // Send to LLM button click handler
    document.getElementById('send-to-llm-btn')?.addEventListener('click', sendSelectionToLLM);
}

// ============================================================================
// File List Rendering
// ============================================================================

/**
 * Render the file list
 */
function renderFileList(fileList: FileInfo[], path: string): void {
    const fileListEl = document.getElementById('file-list');
    const currentPathEl = document.getElementById('current-path');

    if (!fileListEl || !currentPathEl) return;

    currentPathEl.textContent = path;

    // Build set of unstaged file paths and directories containing unstaged files
    const unstagedChanges = git.getUnstagedChanges();
    const unstagedPaths = new Set(unstagedChanges.map(f => f.path));
    const dirsWithUnstaged = new Set<string>();
    const untrackedDirPrefixes: string[] = [];

    for (const f of unstagedChanges) {
        if (f.path.endsWith('/')) {
            const dirPath = f.path.slice(0, -1);
            untrackedDirPrefixes.push(dirPath + '/');
            dirsWithUnstaged.add(dirPath);
            continue;
        }
        const parts = f.path.split('/');
        for (let i = 1; i < parts.length; i++) {
            dirsWithUnstaged.add(parts.slice(0, i).join('/'));
        }
    }

    const isInsideUntrackedDir = (relPath: string): boolean => {
        return untrackedDirPrefixes.some(prefix => relPath.startsWith(prefix));
    };

    const ignoredNames = new Set<string>();
    for (const file of fileList) {
        if (file.is_ignored) {
            ignoredNames.add(file.name);
        }
    }

    let html = '';

    // Add parent directory link if not at project root
    if (path !== PROJECT_ROOT) {
        const parentPath = path.split('/').slice(0, -1).join('/') || PROJECT_ROOT;
        html += `
            <div class="file-item" onclick="navigateToFolder('${parentPath}')">
                <span class="file-icon">📁</span>
                <span class="file-name">..</span>
            </div>
        `;
    }

    // Filter out .git directory and sort: folders first, then files
    const sorted = [...fileList]
        .filter(f => f.name !== '.git')
        .sort((a, b) => {
            if (a.is_dir && !b.is_dir) return -1;
            if (!a.is_dir && b.is_dir) return 1;
            return a.name.localeCompare(b.name);
        });

    for (const file of sorted) {
        const icon = file.is_dir ? '📁' : '📄';
        const size = file.is_dir ? '' : formatFileSize(file.size);
        const fullPath = path + '/' + file.name;
        const relativePath = fullPath.replace(PROJECT_ROOT + '/', '');
        const hasUnstagedChanges = file.is_dir
            ? dirsWithUnstaged.has(relativePath) || isInsideUntrackedDir(relativePath + '/')
            : unstagedPaths.has(relativePath) || isInsideUntrackedDir(relativePath);
        const isIgnored = !hasUnstagedChanges && ignoredNames.has(file.name);

        let cssClass = 'file-item';
        if (hasUnstagedChanges) {
            cssClass += ' has-unstaged-changes';
        } else if (isIgnored) {
            cssClass += ' is-ignored';
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

    fileListEl.innerHTML = html;
}

// ============================================================================
// Code Viewer
// ============================================================================

/**
 * Show code viewer with syntax highlighting
 */
function showCodeViewer(content: string, filename: string): void {
    const codeEl = document.getElementById('code-content');
    const normalContainer = document.getElementById('code-content-normal');
    const diffContainer = document.getElementById('code-content-diff');

    if (!codeEl || !normalContainer || !diffContainer) return;

    normalContainer.style.display = 'block';
    diffContainer.style.display = 'none';

    codeEl.textContent = content;
    delete (codeEl as HTMLElement & { dataset: { highlighted?: string } }).dataset.highlighted;
    hljs.highlightElement(codeEl);

    document.getElementById('file-explorer-panel')?.classList.remove('active');
    document.getElementById('code-viewer-panel')?.classList.add('active');
}

// diff2html configuration
const diff2htmlConfig = {
    drawFileList: false,
    fileListToggle: false,
    fileContentToggle: false,
    matching: 'lines' as const,
    outputFormat: 'line-by-line' as const,
    synchronisedScroll: true,
    highlight: true,
    renderNothingWhenEmpty: false,
    colorScheme: ColorSchemeType.DARK,
};

/**
 * Show diff viewer with syntax highlighting
 */
function showDiffViewer(diff: string, filename: string, hasChanges: boolean): void {
    const normalContainer = document.getElementById('code-content-normal');
    const diffContainer = document.getElementById('code-content-diff');

    if (!normalContainer || !diffContainer) return;

    normalContainer.style.display = 'none';
    diffContainer.style.display = 'block';

    if (hasChanges) {
        diffContainer.classList.remove('no-changes');
    } else {
        diffContainer.classList.add('no-changes');
    }

    const diff2htmlUi = new Diff2HtmlUI(diffContainer, diff, diff2htmlConfig);
    diff2htmlUi.draw();
    diff2htmlUi.highlightCode();

    // Add data-line attributes for selection
    const lineElements = diffContainer.querySelectorAll('.d2h-code-line-ctn');
    lineElements.forEach((el, index) => {
        (el as HTMLElement).dataset.line = String(index);
    });

    clearSelection();

    document.getElementById('file-explorer-panel')?.classList.remove('active');
    document.getElementById('code-viewer-panel')?.classList.add('active');
}

/**
 * Show file explorer panel
 */
export function showFileExplorer(): void {
    document.getElementById('code-viewer-panel')?.classList.remove('active');
    document.getElementById('file-explorer-panel')?.classList.add('active');

    if (selectModeActive) {
        selectModeActive = false;
        document.getElementById('code-select-toggle')?.classList.remove('active');
        document.getElementById('code-content-diff')?.classList.remove('select-mode');
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
    selectModeActive = !selectModeActive;

    const btn = document.getElementById('code-select-toggle');
    const diffContainer = document.getElementById('code-content-diff');

    if (!btn || !diffContainer) return;

    if (selectModeActive) {
        btn.classList.add('active');
        diffContainer.classList.add('select-mode');
    } else {
        btn.classList.remove('active');
        diffContainer.classList.remove('select-mode');
        clearSelection();
    }
}

/**
 * Clear all selected lines
 */
function clearSelection(): void {
    selectedLines.clear();
    document.querySelectorAll('.d2h-code-line-ctn.selected').forEach(el => {
        el.classList.remove('selected');
    });
    selectionPhase = 'none';
    updateSendToLLMButton();
}

/**
 * Select a specific line
 */
function selectLine(lineNumber: number): void {
    const lineEl = document.querySelector(`.d2h-code-line-ctn[data-line="${lineNumber}"]`);
    if (lineEl) {
        selectedLines.add(lineNumber);
        lineEl.classList.add('selected');
    }
}

/**
 * Update the position of the "Send to LLM" button
 */
function updateSendToLLMButton(): void {
    const btn = document.getElementById('send-to-llm-btn') as HTMLElement | null;
    if (!btn) return;

    if (selectedLines.size === 0) {
        btn.style.display = 'none';
        return;
    }

    const sortedLines = Array.from(selectedLines).sort((a, b) => a - b);
    const lastLineNumber = sortedLines[sortedLines.length - 1];
    const lastLineEl = document.querySelector(`.d2h-code-line-ctn[data-line="${lastLineNumber}"]`);

    if (!lastLineEl) {
        btn.style.display = 'none';
        return;
    }

    const lineRect = lastLineEl.getBoundingClientRect();
    btn.style.display = 'block';
    btn.style.top = lineRect.bottom + 'px';
}

/**
 * Handle line click in selection mode
 */
function handleLineClick(lineNumber: number): void {
    if (!selectModeActive) return;

    if (selectionPhase === 'range') {
        clearSelection();
    } else if (selectionPhase === 'none') {
        selectLine(lineNumber);
        selectionPhase = 'first';
        updateSendToLLMButton();
    } else if (selectionPhase === 'first') {
        const firstLine = Array.from(selectedLines)[0];
        const start = Math.min(firstLine, lineNumber);
        const end = Math.max(firstLine, lineNumber);

        clearSelection();
        for (let i = start; i <= end; i++) {
            selectLine(i);
        }
        selectionPhase = 'range';
        updateSendToLLMButton();
    }
}

/**
 * Send selected lines to LLM terminal
 */
function sendSelectionToLLM(): void {
    const currentFilePath = files.getCurrentFilePath();
    if (selectedLines.size === 0 || !currentFilePath) return;

    const sortedLines = Array.from(selectedLines).sort((a, b) => a - b);
    const startLine = sortedLines[0] + 1;
    const endLine = sortedLines[sortedLines.length - 1] + 1;

    let reference: string;
    if (startLine === endLine) {
        reference = `${currentFilePath}:${startLine} `;
    } else {
        reference = `${currentFilePath}:${startLine}-${endLine} `;
    }

    // Switch to LLM view
    const switchViewEvent = new CustomEvent('switchView', { detail: 'llm' });
    document.dispatchEvent(switchViewEvent);

    focusLLMTerminal();
    sendToLLMTerminal(reference);

    selectModeActive = false;
    document.getElementById('code-select-toggle')?.classList.remove('active');
    document.getElementById('code-content-diff')?.classList.remove('select-mode');
    clearSelection();
}

// ============================================================================
// Navigation (exposed for window global)
// ============================================================================

/**
 * Refresh the current file list
 */
export function refreshFileList(): void {
    git.loadStatus();
    files.refresh();
}

/**
 * Navigate to a folder
 */
export function navigateToFolder(path: string): void {
    files.navigateTo(path);
}

/**
 * Open a file for viewing
 */
export function openFile(path: string, filename: string): void {
    const filenameEl = document.getElementById('code-filename');
    if (filenameEl) filenameEl.textContent = filename;
    files.openFile(path);
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
    git.loadStatus();

    // Initialize files module if needed
    files.initialize();

    // Reload current file if viewer is active
    if (document.getElementById('code-viewer-panel')?.classList.contains('active')) {
        files.reloadCurrentFile();
    }
}
