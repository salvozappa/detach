/**
 * Git view module: git operations, status display, and change management.
 * Handles staging, unstaging, committing, pulling, and pushing.
 */

import { FileChange, GitMessage, GitStatusMessage, GitErrorMessage } from '../types';
import {
    isGitViewInitialized,
    setGitViewInitialized,
    getUnstagedChanges,
    setUnstagedChanges,
    getStagedChanges,
    setStagedChanges,
    getDiscardConfirmState,
    setDiscardConfirmTime,
    clearDiscardConfirmState,
    getCurrentPath
} from '../state';
import { escapeHtml, parseDiff, highlightDiffLines } from '../utils';
import { sendMessage, isConnected } from '../connection';
import { showToast, listFiles } from './code-view';

// ============================================================================
// Git View Initialization
// ============================================================================

/**
 * Initialize Git view when switching to it
 */
export function initGitView(): void {
    if (isGitViewInitialized()) return;
    setGitViewInitialized(true);

    // Set up accordion toggle
    document.querySelectorAll('.git-section-header').forEach(header => {
        header.addEventListener('click', () => toggleGitSection(header as HTMLElement));
    });

    // Set up commit input auto-resize
    setupCommitInput();

    // Set up pull/push button handlers
    const pullBtn = document.getElementById('pull-btn');
    const pushBtn = document.getElementById('push-btn');
    if (pullBtn) pullBtn.onclick = pullChanges;
    if (pushBtn) pushBtn.onclick = pushChanges;

    // Set up stage all / unstage all button handlers
    document.getElementById('stage-all-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        stageAll();
    });
    document.getElementById('unstage-all-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        unstageAll();
    });

    // Load git status
    loadGitStatus();
}

/**
 * Set up auto-resize behavior for commit input
 */
function setupCommitInput(): void {
    const input = document.getElementById('commit-message') as HTMLTextAreaElement | null;
    if (!input) return;

    input.addEventListener('input', function (this: HTMLTextAreaElement) {
        // Reset height to calculate new height
        this.style.height = 'auto';

        // Set to scrollHeight, but respect min/max
        const newHeight = Math.min(Math.max(this.scrollHeight, 36), 120);
        this.style.height = newHeight + 'px';
    });
}

/**
 * Toggle accordion section (mutually exclusive)
 */
function toggleGitSection(header: HTMLElement): void {
    const section = header.dataset.section;
    if (!section) return;
    const content = document.getElementById(`${section}-content`);
    const isCollapsed = header.classList.contains('collapsed');

    // Collapse all sections first
    document.querySelectorAll('.git-section-header').forEach(h => {
        h.classList.add('collapsed');
        const contentId = `${(h as HTMLElement).dataset.section}-content`;
        document.getElementById(contentId)?.classList.add('collapsed');
    });

    // If it was collapsed, expand it. If it was expanded, leave it collapsed.
    if (isCollapsed && content) {
        header.classList.remove('collapsed');
        content.classList.remove('collapsed');
    }
}

// ============================================================================
// Git Status
// ============================================================================

/**
 * Load git status from bridge
 */
export function loadGitStatus(): void {
    if (!isConnected()) return;
    sendMessage({ type: 'git_status' });
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Render a file change item
 */
function renderFileChange(file: FileChange, staged = false): string {
    const diffLines = parseDiff(file.diff);

    // Apply syntax highlighting
    const highlightedLines = highlightDiffLines(diffLines, file.path);

    const diffHtml = highlightedLines.map(line => {
        let content = line.highlightedContent || '';

        // Determine line class and whether to add prefix
        let lineClass: string;
        if (file.isUntracked) {
            // Untracked files: no prefix, use 'untracked' class
            lineClass = 'untracked';
        } else {
            // Tracked files: add prefix for added/removed lines
            if (line.type === 'added' || line.type === 'removed') {
                const prefix = line.type === 'added' ? '+' : '-';
                content = `<span class="diff-prefix">${prefix}</span>${content}`;
            }
            lineClass = line.type;
        }

        return `<div class="git-diff-line ${lineClass}">${content}</div>`;
    }).join('');

    const actionsHtml = staged ?
        `<button class="git-action-btn unstage" data-file="${escapeHtml(file.path)}">Unstage</button>` :
        `<button class="git-action-btn stage" data-file="${escapeHtml(file.path)}">Stage</button>
         <button class="git-action-btn discard" data-file="${escapeHtml(file.path)}">Discard</button>`;

    return `
        <div class="git-file-item">
            <div class="git-file-header">
                <div class="git-file-info">
                    <span class="git-file-name">${escapeHtml(file.path)}</span>
                    <span class="git-file-stats">
                        <span class="added">+${file.added || 0}</span>
                        <span class="removed">-${file.removed || 0}</span>
                    </span>
                </div>
                <div class="git-file-actions">
                    ${actionsHtml}
                </div>
            </div>
            <div class="git-diff">${diffHtml}</div>
        </div>
    `;
}

/**
 * Update unstaged changes display
 */
function updateUnstagedChanges(files: FileChange[]): void {
    setUnstagedChanges(files);
    const container = document.getElementById('unstaged-content');
    const count = document.getElementById('unstaged-count');
    const stageAllBtn = document.getElementById('stage-all-btn') as HTMLButtonElement | null;

    if (!container || !count) return;

    count.textContent = String(files.length);
    if (stageAllBtn) stageAllBtn.disabled = files.length === 0;

    if (files.length === 0) {
        container.innerHTML = '<div class="git-empty">No unstaged changes</div>';
        return;
    }

    container.innerHTML = files.map(f => renderFileChange(f, false)).join('');

    // Attach event listeners
    container.querySelectorAll('.git-action-btn.stage').forEach(btn => {
        btn.addEventListener('click', () => stageFile((btn as HTMLElement).dataset.file || ''));
    });

    container.querySelectorAll('.git-action-btn.discard').forEach(btn => {
        btn.addEventListener('click', () => discardFile(btn as HTMLElement, (btn as HTMLElement).dataset.file || ''));
    });
}

/**
 * Update staged changes display
 */
function updateStagedChanges(files: FileChange[]): void {
    setStagedChanges(files);
    const container = document.getElementById('staged-content');
    const count = document.getElementById('staged-count');
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement | null;
    const messageInput = document.getElementById('commit-message') as HTMLTextAreaElement | null;
    const unstageAllBtn = document.getElementById('unstage-all-btn') as HTMLButtonElement | null;

    if (!container || !count) return;

    count.textContent = String(files.length);
    if (unstageAllBtn) unstageAllBtn.disabled = files.length === 0;

    // Enable/disable based on both staged files and message presence
    const updateCommitButton = (): void => {
        if (!commitBtn || !messageInput) return;
        const hasMessage = messageInput.value.trim().length > 0;
        const hasStaged = files.length > 0;
        commitBtn.disabled = !(hasMessage && hasStaged);
    };

    updateCommitButton();
    if (commitBtn) commitBtn.onclick = performCommit;

    // Listen to input changes to enable/disable button
    if (messageInput) messageInput.oninput = updateCommitButton;

    if (files.length === 0) {
        container.innerHTML = '<div class="git-empty">No staged changes</div>';
        return;
    }

    container.innerHTML = files.map(f => renderFileChange(f, true)).join('');

    // Attach event listeners
    container.querySelectorAll('.git-action-btn.unstage').forEach(btn => {
        btn.addEventListener('click', () => unstageFile((btn as HTMLElement).dataset.file || ''));
    });
}

// ============================================================================
// Git Actions
// ============================================================================

/**
 * Stage a file
 */
function stageFile(filePath: string): void {
    sendMessage({ type: 'git_stage', file: filePath });
}

/**
 * Unstage a file
 */
function unstageFile(filePath: string): void {
    sendMessage({ type: 'git_unstage', file: filePath });
}

/**
 * Stage all files
 */
function stageAll(): void {
    sendMessage({ type: 'git_stage_all' });
}

/**
 * Unstage all files
 */
function unstageAll(): void {
    sendMessage({ type: 'git_unstage_all' });
}

/**
 * Discard a file with double-tap confirmation
 */
function discardFile(btn: HTMLElement, filePath: string): void {
    // Implement double-tap confirmation
    const now = Date.now();
    const discardConfirmState = getDiscardConfirmState();
    const lastTap = discardConfirmState[filePath] || 0;

    if (now - lastTap < 2000) { // 2 second window for double tap
        // Confirmed - discard the file
        sendMessage({ type: 'git_discard', file: filePath });
        clearDiscardConfirmState(filePath);
        btn.classList.remove('confirm');
    } else {
        // First tap - show confirmation state
        setDiscardConfirmTime(filePath, now);
        btn.classList.add('confirm');
        btn.textContent = 'Tap again to confirm';

        // Reset after 2 seconds
        setTimeout(() => {
            if (getDiscardConfirmState()[filePath] === now) {
                clearDiscardConfirmState(filePath);
                btn.classList.remove('confirm');
                btn.textContent = 'Discard';
            }
        }, 2000);
    }
}

/**
 * Perform commit with the current message
 */
function performCommit(): void {
    const messageInput = document.getElementById('commit-message') as HTMLTextAreaElement | null;
    if (!messageInput) return;
    const message = messageInput.value.trim();

    if (!message) {
        alert('Please enter a commit message');
        return;
    }

    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement | null;
    if (!commitBtn) return;

    // Send commit request via WebSocket
    sendMessage({
        type: 'git_commit',
        message: message
    });

    // Disable button to prevent double-submit
    commitBtn.disabled = true;
    commitBtn.textContent = 'Committing...';
}

/**
 * Pull changes from remote
 */
function pullChanges(): void {
    if (!isConnected()) return;

    const pullBtn = document.getElementById('pull-btn') as HTMLButtonElement | null;
    if (pullBtn) {
        pullBtn.disabled = true;
        pullBtn.textContent = 'Pulling...';
    }

    sendMessage({ type: 'git_pull' });
}

/**
 * Push changes to remote
 */
function pushChanges(): void {
    if (!isConnected()) return;

    const pushBtn = document.getElementById('push-btn') as HTMLButtonElement | null;
    if (pushBtn) {
        pushBtn.disabled = true;
        pushBtn.textContent = 'Pushing...';
    }

    sendMessage({ type: 'git_push' });
}

// ============================================================================
// Message Handler
// ============================================================================

/**
 * Handle Git messages from WebSocket
 */
export function handleGitMessage(msg: GitMessage): void {
    if (msg.type === 'git_status') {
        const statusMsg = msg as GitStatusMessage;
        updateUnstagedChanges(statusMsg.unstaged || []);
        updateStagedChanges(statusMsg.staged || []);
        // Refresh file list if we're on the code view to update unstaged highlighting
        if (document.getElementById('view-code')?.classList.contains('active')) {
            const currentPath = getCurrentPath();
            if (currentPath) {
                listFiles(currentPath);
            }
        }
    } else if (
        msg.type === 'git_stage_success' ||
        msg.type === 'git_unstage_success' ||
        msg.type === 'git_discard_success' ||
        msg.type === 'git_stage_all_success' ||
        msg.type === 'git_unstage_all_success'
    ) {
        // Reload git status after action
        loadGitStatus();
    } else if (msg.type === 'git_commit_success') {
        const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement | null;
        const messageInput = document.getElementById('commit-message') as HTMLTextAreaElement | null;

        // Re-enable button and clear message
        if (commitBtn) {
            commitBtn.disabled = false;
            commitBtn.textContent = 'Commit';
        }
        if (messageInput) messageInput.value = '';

        // Show success toast
        showToast('Committed successfully');

        // Refresh git status
        loadGitStatus();
    } else if (msg.type === 'git_pull_success') {
        const pullBtn = document.getElementById('pull-btn') as HTMLButtonElement | null;
        if (pullBtn) {
            pullBtn.disabled = false;
            pullBtn.textContent = 'Pull';
        }

        // Show success toast
        showToast('Pulled changes');

        // Refresh git status to show new changes
        loadGitStatus();
    } else if (msg.type === 'git_push_success') {
        const pushBtn = document.getElementById('push-btn') as HTMLButtonElement | null;
        if (pushBtn) {
            pushBtn.disabled = false;
            pushBtn.textContent = 'Push';
        }

        // Show success toast
        showToast('Pushed to remote');

        // Refresh git status
        loadGitStatus();
    } else if (msg.type === 'git_error') {
        const errorMsg = msg as GitErrorMessage;
        console.error('Git error:', errorMsg.error);
        alert('Error: ' + errorMsg.error);

        // Re-enable all buttons
        const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement | null;
        const pullBtn = document.getElementById('pull-btn') as HTMLButtonElement | null;
        const pushBtn = document.getElementById('push-btn') as HTMLButtonElement | null;

        if (commitBtn && commitBtn.disabled) {
            commitBtn.disabled = false;
            commitBtn.textContent = 'Commit';
        }
        if (pullBtn && pullBtn.disabled) {
            pullBtn.disabled = false;
            pullBtn.textContent = 'Pull';
        }
        if (pushBtn && pushBtn.disabled) {
            pushBtn.disabled = false;
            pushBtn.textContent = 'Push';
        }
    }
}

// ============================================================================
// View Activation
// ============================================================================

/**
 * Activate git view
 */
export function activateGitView(): void {
    initGitView();
    // Always refresh git status when opening the view
    loadGitStatus();
}
