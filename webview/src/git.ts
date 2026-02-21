/**
 * Git business logic: state management and operations.
 * Owns git-related state and handles WebSocket messages.
 */

import { FileChange, GitMessage, GitStatusMessage, GitErrorMessage } from './types';
import { sendMessage, isConnected } from './connection';

// ============================================================================
// State
// ============================================================================

let unstagedChanges: FileChange[] = [];
let stagedChanges: FileChange[] = [];
let discardConfirmState: Record<string, number> = {};

// ============================================================================
// Getters
// ============================================================================

export function getUnstagedChanges(): FileChange[] {
    return unstagedChanges;
}

export function getStagedChanges(): FileChange[] {
    return stagedChanges;
}

// ============================================================================
// Render Callback
// ============================================================================

type RenderCallback = () => void;
let onStateChange: RenderCallback | null = null;

/**
 * Register callback to be called when git state changes
 */
export function onGitStateChange(callback: RenderCallback): void {
    onStateChange = callback;
}

function notifyStateChange(): void {
    if (onStateChange) {
        onStateChange();
    }
}

// ============================================================================
// Operations
// ============================================================================

/**
 * Load git status from server
 */
export function loadStatus(): void {
    if (!isConnected()) return;
    sendMessage({ type: 'git_status' });
}

/**
 * Stage a file
 */
export function stage(filePath: string): void {
    sendMessage({ type: 'git_stage', file: filePath });
}

/**
 * Unstage a file
 */
export function unstage(filePath: string): void {
    sendMessage({ type: 'git_unstage', file: filePath });
}

/**
 * Stage all files
 */
export function stageAll(): void {
    sendMessage({ type: 'git_stage_all' });
}

/**
 * Unstage all files
 */
export function unstageAll(): void {
    sendMessage({ type: 'git_unstage_all' });
}

/**
 * Commit staged changes
 */
export function commit(message: string): void {
    sendMessage({ type: 'git_commit', message });
}

/**
 * Pull changes from remote
 */
export function pull(): void {
    if (!isConnected()) return;
    sendMessage({ type: 'git_pull' });
}

/**
 * Push changes to remote
 */
export function push(): void {
    if (!isConnected()) return;
    sendMessage({ type: 'git_push' });
}

/**
 * Discard changes to a file
 */
export function discard(filePath: string): void {
    sendMessage({ type: 'git_discard', file: filePath });
}

// ============================================================================
// Discard Confirmation State
// ============================================================================

/**
 * Check if file is pending discard confirmation
 * Returns timestamp of first tap, or 0 if not pending
 */
export function getDiscardConfirmTime(filePath: string): number {
    return discardConfirmState[filePath] || 0;
}

/**
 * Set discard confirmation timestamp
 */
export function setDiscardConfirmTime(filePath: string, time: number): void {
    discardConfirmState[filePath] = time;
}

/**
 * Clear discard confirmation state for a file
 */
export function clearDiscardConfirm(filePath: string): void {
    delete discardConfirmState[filePath];
}

// ============================================================================
// Message Handler
// ============================================================================

type ToastFn = (message: string, type?: string) => void;
type RefreshFileListFn = () => void;

let showToast: ToastFn | null = null;
let refreshFileList: RefreshFileListFn | null = null;

/**
 * Register toast function (to avoid circular dependency with UI)
 */
export function setToastFn(fn: ToastFn): void {
    showToast = fn;
}

/**
 * Register file list refresh function (to avoid circular dependency)
 */
export function setRefreshFileListFn(fn: RefreshFileListFn): void {
    refreshFileList = fn;
}

/**
 * Handle Git messages from WebSocket
 */
export function handleGitMessage(msg: GitMessage): void {
    if (msg.type === 'git_status') {
        const statusMsg = msg as GitStatusMessage;
        unstagedChanges = statusMsg.unstaged || [];
        stagedChanges = statusMsg.staged || [];
        notifyStateChange();

        // Refresh file list if we're on the explore view
        if (document.getElementById('view-explore')?.classList.contains('active')) {
            if (refreshFileList) {
                refreshFileList();
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
        loadStatus();
    } else if (msg.type === 'git_commit_success') {
        if (showToast) showToast('Committed successfully');
        loadStatus();
        // Dispatch event for UI to reset commit form
        document.dispatchEvent(new CustomEvent('gitCommitSuccess'));
    } else if (msg.type === 'git_pull_success') {
        if (showToast) showToast('Pulled changes');
        loadStatus();
        // Dispatch event for UI to reset pull button
        document.dispatchEvent(new CustomEvent('gitPullSuccess'));
    } else if (msg.type === 'git_push_success') {
        if (showToast) showToast('Pushed to remote');
        loadStatus();
        // Dispatch event for UI to reset push button
        document.dispatchEvent(new CustomEvent('gitPushSuccess'));
    } else if (msg.type === 'git_error') {
        const errorMsg = msg as GitErrorMessage;
        console.error('Git error:', errorMsg.error);
        alert('Error: ' + errorMsg.error);
        // Dispatch event for UI to reset buttons
        document.dispatchEvent(new CustomEvent('gitError'));
    }
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Reset module state for testing
 */
export function __test_reset(): void {
    unstagedChanges = [];
    stagedChanges = [];
    discardConfirmState = {};
    onStateChange = null;
    showToast = null;
    refreshFileList = null;
}
