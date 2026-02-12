/**
 * Application entry point and orchestrator.
 * Initializes all modules and manages view switching.
 */

import { APP_VERSION, TOKEN_STORAGE_KEY } from './types';
import {
    connect,
    registerMessageHandler,
    registerTerminalDataHandler,
    registerTerminalSizeCallback,
    handleVisibilityChange,
    handleOffline,
    handleOnline,
    handleBeforeUnload
} from './connection';
import {
    initLLMTerminal,
    initKeyboardToolbar,
    initViewportListeners,
    initFocusTracking,
    handleTerminalData,
    sendTerminalSize,
    activateLLMView,
    activateTerminalView,
    deactivateTerminalViews
} from './ui/terminal';
import { handleFileMessage } from './files';
import { handleGitMessage } from './git';
import { initToastHandlers } from './ui/toast';
import {
    initCodeViewHandlers,
    activateCodeView,
    navigateToFolder,
    openFile,
    showFileExplorer,
    toggleSelectMode,
    refreshFileList
} from './ui/code-view';
import { activateGitView } from './ui/git-view';

// ============================================================================
// Application Initialization
// ============================================================================

console.log('[APP] Version:', APP_VERSION);

// Register service worker for PWA and push notifications
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
        .then(registration => {
            console.log('[APP] Service Worker registered:', registration.scope);
        })
        .catch(error => {
            console.error('[APP] Service Worker registration failed:', error);
        });
}

// Extract and store authentication token from URL (pairing flow)
const urlParams = new URLSearchParams(window.location.search);
const tokenFromUrl = urlParams.get('token');
if (tokenFromUrl) {
    localStorage.setItem(TOKEN_STORAGE_KEY, tokenFromUrl);
    // Remove token from URL (clean up address bar, prevent token leakage via history/referrer)
    window.history.replaceState({}, '', window.location.pathname);
    console.log('[APP] Stored authentication token from URL');
}

// Initialize terminals
initLLMTerminal();

// Initialize UI handlers
initToastHandlers();
initCodeViewHandlers();
initKeyboardToolbar();
initViewportListeners();
initFocusTracking();

// Register message handlers
registerMessageHandler('file_list', handleFileMessage);
registerMessageHandler('file_content', handleFileMessage);
registerMessageHandler('file_with_diff', handleFileMessage);
registerMessageHandler('git_', handleGitMessage);

// Register terminal data handler
registerTerminalDataHandler(handleTerminalData);

// Register terminal size callback
registerTerminalSizeCallback(sendTerminalSize);

// ============================================================================
// View Switching
// ============================================================================

/**
 * Switch between application views
 */
function switchView(viewName: string): void {
    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    // Show selected view
    document.getElementById(`view-${viewName}`)?.classList.add('active');
    document.querySelector(`[data-view="${viewName}"]`)?.classList.add('active');

    // Handle view-specific activation
    if (viewName === 'llm') {
        activateLLMView();
    } else if (viewName === 'terminal') {
        activateTerminalView();
    } else {
        deactivateTerminalViews();
    }

    // Load files when switching to Code view
    if (viewName === 'code') {
        activateCodeView();
    }

    // Initialize Git view when switching to it
    if (viewName === 'git') {
        activateGitView();
    }
}

// Nav button click handlers
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView((btn as HTMLElement).dataset.view || ''));
});

// Listen for switchView events from code-view module
document.addEventListener('switchView', ((e: CustomEvent) => {
    switchView(e.detail);
}) as EventListener);

// ============================================================================
// Lifecycle Handlers
// ============================================================================

// Handle page visibility (reconnect when coming back to the page)
document.addEventListener('visibilitychange', handleVisibilityChange);

// Cleanup on page unload
window.addEventListener('beforeunload', handleBeforeUnload);

// Network status change handlers
window.addEventListener('offline', handleOffline);
window.addEventListener('online', handleOnline);

// ============================================================================
// Global Window Exports
// ============================================================================

// Expose functions to window for HTML onclick handlers
declare global {
    interface Window {
        navigateToFolder: typeof navigateToFolder;
        openFile: typeof openFile;
        showFileExplorer: typeof showFileExplorer;
        toggleSelectMode: typeof toggleSelectMode;
        refreshFileList: typeof refreshFileList;
        switchView: typeof switchView;
    }
}

window.navigateToFolder = navigateToFolder;
window.openFile = openFile;
window.showFileExplorer = showFileExplorer;
window.toggleSelectMode = toggleSelectMode;
window.refreshFileList = refreshFileList;
window.switchView = switchView;

// ============================================================================
// Start Application
// ============================================================================

// Initialize keyboard toolbar visibility (LLM view is default)
document.getElementById('keyboard-toolbar')?.classList.add('visible');

// Start connection
connect();
