/**
 * Git view UI: rendering and event handling.
 * Imports business logic from git.ts.
 */

import { FileChange } from '../types';
import { escapeHtml, parseDiff, highlightDiffLines } from '../utils';
import * as git from '../git';

// ============================================================================
// State
// ============================================================================

let initialized = false;

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize Git view UI when first opened
 */
export function initGitView(): void {
    if (initialized) return;
    initialized = true;

    // Set up accordion toggle
    document.querySelectorAll('.git-section-header').forEach(header => {
        header.addEventListener('click', () => toggleGitSection(header as HTMLElement));
    });

    // Set up commit input auto-resize
    setupCommitInput();

    // Set up pull/push button handlers
    const pullBtn = document.getElementById('pull-btn');
    const pushBtn = document.getElementById('push-btn');
    if (pullBtn) pullBtn.onclick = onPullClick;
    if (pushBtn) pushBtn.onclick = onPushClick;

    // Set up stage all / unstage all button handlers
    document.getElementById('stage-all-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        git.stageAll();
    });
    document.getElementById('unstage-all-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        git.unstageAll();
    });

    // Register render callback with git module
    git.onGitStateChange(render);

    // Listen for git events to update UI
    document.addEventListener('gitCommitSuccess', onCommitSuccess);
    document.addEventListener('gitPullSuccess', onPullSuccess);
    document.addEventListener('gitPushSuccess', onPushSuccess);
    document.addEventListener('gitError', onGitError);
}

/**
 * Set up auto-resize behavior for commit input
 */
function setupCommitInput(): void {
    const input = document.getElementById('commit-message') as HTMLTextAreaElement | null;
    if (!input) return;

    input.addEventListener('input', function (this: HTMLTextAreaElement) {
        this.style.height = 'auto';
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

    // If it was collapsed, expand it
    if (isCollapsed && content) {
        header.classList.remove('collapsed');
        content.classList.remove('collapsed');
    }
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Render the git view based on current state
 */
export function render(): void {
    renderUnstagedChanges(git.getUnstagedChanges());
    renderStagedChanges(git.getStagedChanges());
}

/**
 * Render a file change item
 */
function renderFileChange(file: FileChange, staged: boolean): string {
    const diffLines = parseDiff(file.diff);
    const highlightedLines = highlightDiffLines(diffLines, file.path);

    const diffHtml = highlightedLines.map(line => {
        let content = line.highlightedContent || '';
        let lineClass: string;

        if (file.isUntracked) {
            lineClass = 'untracked';
        } else {
            if (line.type === 'added' || line.type === 'removed') {
                const prefix = line.type === 'added' ? '+' : '-';
                content = `<span class="diff-prefix">${prefix}</span>${content}`;
            }
            lineClass = line.type;
        }

        return `<div class="git-diff-line ${lineClass}">${content}</div>`;
    }).join('');

    const actionsHtml = staged
        ? `<button class="git-action-btn unstage" data-file="${escapeHtml(file.path)}">Unstage</button>`
        : `<button class="git-action-btn stage" data-file="${escapeHtml(file.path)}">Stage</button>
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
 * Render unstaged changes section
 */
function renderUnstagedChanges(files: FileChange[]): void {
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
        btn.addEventListener('click', () => {
            git.stage((btn as HTMLElement).dataset.file || '');
        });
    });

    container.querySelectorAll('.git-action-btn.discard').forEach(btn => {
        btn.addEventListener('click', () => {
            onDiscardClick(btn as HTMLElement);
        });
    });
}

/**
 * Render staged changes section
 */
function renderStagedChanges(files: FileChange[]): void {
    const container = document.getElementById('staged-content');
    const count = document.getElementById('staged-count');
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement | null;
    const messageInput = document.getElementById('commit-message') as HTMLTextAreaElement | null;
    const unstageAllBtn = document.getElementById('unstage-all-btn') as HTMLButtonElement | null;

    if (!container || !count) return;

    count.textContent = String(files.length);
    if (unstageAllBtn) unstageAllBtn.disabled = files.length === 0;

    // Enable/disable commit button based on staged files and message
    const updateCommitButton = (): void => {
        if (!commitBtn || !messageInput) return;
        const hasMessage = messageInput.value.trim().length > 0;
        const hasStaged = files.length > 0;
        commitBtn.disabled = !(hasMessage && hasStaged);
    };

    updateCommitButton();
    if (commitBtn) commitBtn.onclick = onCommitClick;
    if (messageInput) messageInput.oninput = updateCommitButton;

    if (files.length === 0) {
        container.innerHTML = '<div class="git-empty">No staged changes</div>';
        return;
    }

    container.innerHTML = files.map(f => renderFileChange(f, true)).join('');

    // Attach event listeners
    container.querySelectorAll('.git-action-btn.unstage').forEach(btn => {
        btn.addEventListener('click', () => {
            git.unstage((btn as HTMLElement).dataset.file || '');
        });
    });
}

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle commit button click
 */
function onCommitClick(): void {
    const messageInput = document.getElementById('commit-message') as HTMLTextAreaElement | null;
    if (!messageInput) return;

    const message = messageInput.value.trim();
    if (!message) {
        alert('Please enter a commit message');
        return;
    }

    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement | null;
    if (commitBtn) {
        commitBtn.disabled = true;
        commitBtn.textContent = 'Committing...';
    }

    git.commit(message);
}

/**
 * Handle pull button click
 */
function onPullClick(): void {
    const pullBtn = document.getElementById('pull-btn') as HTMLButtonElement | null;
    if (pullBtn) {
        pullBtn.disabled = true;
        pullBtn.textContent = 'Pulling...';
    }
    git.pull();
}

/**
 * Handle push button click
 */
function onPushClick(): void {
    const pushBtn = document.getElementById('push-btn') as HTMLButtonElement | null;
    if (pushBtn) {
        pushBtn.disabled = true;
        pushBtn.textContent = 'Pushing...';
    }
    git.push();
}

/**
 * Handle discard button click with double-tap confirmation
 */
function onDiscardClick(btn: HTMLElement): void {
    const filePath = btn.dataset.file || '';
    const now = Date.now();
    const lastTap = git.getDiscardConfirmTime(filePath);

    if (now - lastTap < 2000) {
        // Confirmed - discard the file
        git.discard(filePath);
        git.clearDiscardConfirm(filePath);
        btn.classList.remove('confirm');
    } else {
        // First tap - show confirmation state
        git.setDiscardConfirmTime(filePath, now);
        btn.classList.add('confirm');
        btn.textContent = 'Tap again to confirm';

        // Reset after 2 seconds
        setTimeout(() => {
            if (git.getDiscardConfirmTime(filePath) === now) {
                git.clearDiscardConfirm(filePath);
                btn.classList.remove('confirm');
                btn.textContent = 'Discard';
            }
        }, 2000);
    }
}

/**
 * Handle commit success event
 */
function onCommitSuccess(): void {
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement | null;
    const messageInput = document.getElementById('commit-message') as HTMLTextAreaElement | null;

    if (commitBtn) {
        commitBtn.disabled = false;
        commitBtn.textContent = 'Commit';
    }
    if (messageInput) {
        messageInput.value = '';
    }
}

/**
 * Handle pull success event
 */
function onPullSuccess(): void {
    const pullBtn = document.getElementById('pull-btn') as HTMLButtonElement | null;
    if (pullBtn) {
        pullBtn.disabled = false;
        pullBtn.textContent = 'Pull';
    }
}

/**
 * Handle push success event
 */
function onPushSuccess(): void {
    const pushBtn = document.getElementById('push-btn') as HTMLButtonElement | null;
    if (pushBtn) {
        pushBtn.disabled = false;
        pushBtn.textContent = 'Push';
    }
}

/**
 * Handle git error event
 */
function onGitError(): void {
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

// ============================================================================
// View Activation
// ============================================================================

/**
 * Activate git view
 */
export function activateGitView(): void {
    initGitView();
    git.loadStatus();
}
