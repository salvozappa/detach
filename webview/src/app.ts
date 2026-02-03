// TypeScript imports for dependencies
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import hljs from 'highlight.js';
import { Diff2HtmlUI } from 'diff2html/lib/ui/js/diff2html-ui-slim';
import { ColorSchemeType } from 'diff2html/lib/types';

// Type definitions
interface FileInfo {
    name: string;
    is_dir: boolean;
    size: number;
    is_ignored?: boolean;
}

interface FileChange {
    path: string;
    diff: string;
    added: number;
    removed: number;
    isUntracked: boolean;
}

interface DiffLine {
    type: 'added' | 'removed' | 'context';
    content: string;
    highlightedContent?: string;
}

interface ToastItem {
    message: string;
    type: string;
    duration: number;
}

interface DebugConfig {
    WS: boolean;
    HEALTH: boolean;
    VISIBILITY: boolean;
    NETWORK: boolean;
    TERMINAL: boolean;
    TOOLBAR: boolean;
    FOCUS: boolean;
}

interface WsLogEntry {
    type: string;
    level: string;
    category: string;
    message: string;
    data: Record<string, unknown>;
}

// App version for cache debugging
const APP_VERSION = '2026-01-28-v9';
console.log('[APP] Version:', APP_VERSION);

// Configuration - use same host as the page is served from
const WS_HOST = window.location.host || 'nightly01.tail5fb253.ts.net';
const WS_PORT = '8081';

// Authentication - HARDCODED FOR NOW
const USERNAME = 'detach-dev';

// Debug logging configuration
const DEBUG: DebugConfig = {
    WS: true,        // WebSocket connection events
    HEALTH: true,    // Health check events
    VISIBILITY: true, // Page visibility events
    NETWORK: true,   // Network online/offline events
    TERMINAL: true,  // Terminal input/focus events
    TOOLBAR: true,   // Keyboard toolbar button events
    FOCUS: true      // Document focus events
};

// Correlation ID for tracking connection attempts
let connectionAttemptId = 0;
let currentCorrelationId: string | null = null;

// Connection state machine
const WS_STATES = {
    DISCONNECTED: 'DISCONNECTED',
    CONNECTING: 'CONNECTING',
    CONNECTED: 'CONNECTED',
    RECONNECTING: 'RECONNECTING',
    CLOSING: 'CLOSING'
} as const;

type WsState = typeof WS_STATES[keyof typeof WS_STATES];

let wsState: WsState = WS_STATES.DISCONNECTED;
let lastStateChange = Date.now();
let connectionStartTime: number | null = null;

// Session state
let currentSessionId: string | null = null;

// WebSocket close code meanings
const CLOSE_CODE_MEANINGS: Record<number, string> = {
    1000: 'Normal closure',
    1001: 'Going away (browser/tab closing)',
    1002: 'Protocol error',
    1003: 'Unsupported data',
    1005: 'No status received',
    1006: 'Abnormal closure (no close frame)',
    1007: 'Invalid frame payload data',
    1008: 'Policy violation',
    1009: 'Message too big',
    1010: 'Mandatory extension',
    1011: 'Internal server error',
    1015: 'TLS handshake failure'
};

// Queue for debug logs before WebSocket is ready
const debugLogQueue: WsLogEntry[] = [];
let debugLogWsReady = false;

// Debug logger that routes to Android and server
function debugLog(category: keyof DebugConfig, level: string, message: string, data: Record<string, unknown> = {}): void {
    if (!DEBUG[category]) return;

    const timestamp = Date.now();
    const logEntry = {
        ts: timestamp,
        cat: category,
        corrId: currentCorrelationId,
        user: USERNAME,
        msg: message,
        ...data
    };

    const formattedMsg = JSON.stringify(logEntry);

    // Log to browser console
    if (level === 'error') {
        console.error(`[${category}] ${message}`, data);
    } else if (level === 'warn') {
        console.warn(`[${category}] ${message}`, data);
    } else {
        console.log(`[${category}] ${message}`, data);
    }

    // Route to server via WebSocket for docker logs visibility
    const wsLogEntry: WsLogEntry = { type: 'debug_log', level, category, message, data };
    if (debugLogWsReady) {
        sendDebugLogToServer(wsLogEntry);
    } else {
        debugLogQueue.push(wsLogEntry);
    }
}

// Send a debug log entry to the server
function sendDebugLogToServer(entry: WsLogEntry): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(entry));
    }
}

// Flush queued debug logs when WebSocket connects
function flushDebugLogQueue(): void {
    debugLogWsReady = true;
    while (debugLogQueue.length > 0) {
        const entry = debugLogQueue.shift();
        if (entry) sendDebugLogToServer(entry);
    }
}

// Connection state transition logging
function setWsState(newState: WsState, reason = ''): void {
    const prevState = wsState;
    const duration = Date.now() - lastStateChange;
    wsState = newState;
    lastStateChange = Date.now();

    debugLog('WS', 'info', 'State transition', {
        from: prevState,
        to: newState,
        reason: reason,
        durationInPrevState: duration
    });
}

// Generate correlation ID for connection attempts
function generateCorrelationId(): string {
    return `conn-${Date.now()}-${++connectionAttemptId}`;
}

// Register Web Push subscription for PWA push notifications
async function registerWebPush(): Promise<void> {
    debugLog('WS', 'info', 'registerWebPush called');

    // Check if service worker and push are supported
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        debugLog('WS', 'info', 'Web Push not supported in this browser');
        return;
    }

    // Get VAPID public key from meta tag
    const vapidMeta = document.querySelector('meta[name="vapid-public-key"]') as HTMLMetaElement | null;
    if (!vapidMeta || !vapidMeta.content) {
        debugLog('WS', 'info', 'VAPID public key not configured');
        return;
    }
    const vapidPublicKey = vapidMeta.content;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        debugLog('WS', 'warn', 'Cannot register Web Push: WebSocket not connected');
        return;
    }

    try {
        const registration = await navigator.serviceWorker.ready;

        // Check if already subscribed
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
            // Request permission and subscribe
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                debugLog('WS', 'info', 'Notification permission denied');
                return;
            }

            // Convert VAPID key to Uint8Array
            const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: applicationServerKey
            });
            debugLog('WS', 'info', 'Created new Web Push subscription');
        } else {
            debugLog('WS', 'info', 'Using existing Web Push subscription');
        }

        // Send subscription to backend
        debugLog('WS', 'info', 'Registering Web Push subscription via WebSocket');
        ws.send(JSON.stringify({
            type: 'register_web_push',
            subscription: subscription.toJSON()
        }));
    } catch (err) {
        debugLog('WS', 'error', 'Web Push registration failed: ' + (err as Error).message);
    }
}

// Helper function to convert VAPID key
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Exponential backoff reconnection
const RECONNECT_BASE_DELAY = 1000;  // Start at 1 second
const RECONNECT_MAX_DELAY = 30000;  // Max 30 seconds
let reconnectAttempts = 0;

// Connection health monitoring
let lastPongTime = Date.now();
let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

function getReconnectDelay(): number {
    const delay = Math.min(
        RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts),
        RECONNECT_MAX_DELAY
    );
    // Add jitter to prevent thundering herd
    return delay + Math.random() * 1000;
}

function startHealthCheck(): void {
    debugLog('HEALTH', 'info', 'Starting health check', {
        interval: 10000,
        staleThreshold: 20000
    });

    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
    }
    lastPongTime = Date.now();
    healthCheckInterval = setInterval(() => {
        const timeSinceLastPong = Date.now() - lastPongTime;

        debugLog('HEALTH', 'debug', 'Health check tick', {
            timeSinceLastPong: timeSinceLastPong,
            wsState: wsState,
            wsReadyState: ws ? ws.readyState : null
        });

        if (timeSinceLastPong > 20000) {
            debugLog('HEALTH', 'warn', 'Connection stale, forcing close', {
                timeSinceLastPong: timeSinceLastPong
            });
            if (ws) {
                ws.close(4000, 'Health check timeout');
            }
        }
    }, 10000);
}

function stopHealthCheck(): void {
    debugLog('HEALTH', 'info', 'Stopping health check');
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
    }
}

// Toast notification system
const toastQueue: ToastItem[] = [];
let activeToast: HTMLElement | null = null;

function showToast(message: string, type = 'success', duration = 3000): void {
    const container = document.getElementById('toast-container');
    if (!container) return;

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    // If there's an active toast, queue this one
    if (activeToast) {
        toastQueue.push({ message, type, duration });
        return;
    }

    // Show the toast
    activeToast = toast;
    container.appendChild(toast);

    // Auto-hide after duration (unless it's an error)
    if (type !== 'error' && duration > 0) {
        setTimeout(() => hideToast(toast), duration);
    }
}

function hideToast(toast: HTMLElement): void {
    if (!toast || !toast.parentNode) return;

    // Fade out animation
    toast.classList.add('hiding');

    // Remove from DOM after animation
    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }

        activeToast = null;

        // Show next toast in queue
        if (toastQueue.length > 0) {
            const next = toastQueue.shift();
            if (next) showToast(next.message, next.type, next.duration);
        }
    }, 300); // Match animation duration
}

// Allow clicking toast to dismiss it early
document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).classList.contains('toast')) {
        hideToast(e.target as HTMLElement);
    }
});

// Code view state
const PROJECT_ROOT = '~/projects/notestash';
let currentPath = PROJECT_ROOT;
let codeViewInitialized = false;

// Selection mode state
let selectModeActive = false;
let selectedLines = new Set<number>();
let currentFilePath = '';
let selectionPhase: 'none' | 'first' | 'range' = 'none';

// Code view functions
function listFiles(path: string): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'list_files', path: path }));
    }
}

function readFile(path: string): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'read_file', path: path }));
    }
}

function readFileWithDiff(path: string): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'read_file_with_diff', path: path }));
    }
}

function renderFileList(files: FileInfo[], path: string): void {
    const fileList = document.getElementById('file-list');
    const currentPathEl = document.getElementById('current-path');

    if (!fileList || !currentPathEl) return;

    currentPath = path;
    currentPathEl.textContent = path;

    // Build set of unstaged file paths and directories containing unstaged files
    const unstagedPaths = new Set(unstagedChanges.map(f => f.path));
    const dirsWithUnstaged = new Set<string>();
    const untrackedDirPrefixes: string[] = []; // Untracked directories - all contents are unstaged
    for (const f of unstagedChanges) {
        // Untracked directories end with / - track them separately
        if (f.path.endsWith('/')) {
            const dirPath = f.path.slice(0, -1); // Remove trailing slash
            untrackedDirPrefixes.push(dirPath + '/');
            dirsWithUnstaged.add(dirPath);
            continue;
        }
        const parts = f.path.split('/');
        // Add all parent directories to the set
        for (let i = 1; i < parts.length; i++) {
            dirsWithUnstaged.add(parts.slice(0, i).join('/'));
        }
    }

    // Helper to check if path is inside an untracked directory
    const isInsideUntrackedDir = (relPath: string): boolean => {
        return untrackedDirPrefixes.some(prefix => relPath.startsWith(prefix));
    };

    // Build set of ignored file/directory names (directly ignored by gitignore)
    const ignoredNames = new Set<string>();
    for (const file of files) {
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
    const sorted = [...files]
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
        // Only show as ignored if not already showing as unstaged (pink takes priority)
        const isIgnored = !hasUnstagedChanges && ignoredNames.has(file.name);

        // Determine CSS class: unstaged (pink) takes priority over ignored (gray)
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

    fileList.innerHTML = html;
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function navigateToFolder(path: string): void {
    listFiles(path);
}

function openFile(path: string, filename: string): void {
    const filenameEl = document.getElementById('code-filename');
    if (filenameEl) filenameEl.textContent = filename;
    currentFilePath = path;
    readFileWithDiff(path);
}

function showCodeViewer(content: string, filename: string): void {
    const codeEl = document.getElementById('code-content');
    const normalContainer = document.getElementById('code-content-normal');
    const diffContainer = document.getElementById('code-content-diff');

    if (!codeEl || !normalContainer || !diffContainer) return;

    // Show normal view, hide diff view
    normalContainer.style.display = 'block';
    diffContainer.style.display = 'none';

    codeEl.textContent = content;

    // Auto-detect language and highlight
    delete (codeEl as HTMLElement & { dataset: { highlighted?: string } }).dataset.highlighted;
    hljs.highlightElement(codeEl);

    // Switch panels
    document.getElementById('file-explorer-panel')?.classList.remove('active');
    document.getElementById('code-viewer-panel')?.classList.add('active');
}

// diff2html configuration - line-by-line is more mobile-friendly
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

function showDiffViewer(diff: string, filename: string, hasChanges = true): void {
    const normalContainer = document.getElementById('code-content-normal');
    const diffContainer = document.getElementById('code-content-diff');

    if (!normalContainer || !diffContainer) return;

    // Hide normal view, show diff view
    normalContainer.style.display = 'none';
    diffContainer.style.display = 'block';

    // Add/remove no-changes class for styling (single line number column)
    if (hasChanges) {
        diffContainer.classList.remove('no-changes');
    } else {
        diffContainer.classList.add('no-changes');
    }

    // Render diff using diff2html
    const diff2htmlUi = new Diff2HtmlUI(diffContainer, diff, diff2htmlConfig);
    diff2htmlUi.draw();
    diff2htmlUi.highlightCode();

    // Add data-line attributes to each line for selection
    const lineElements = diffContainer.querySelectorAll('.d2h-code-line-ctn');
    lineElements.forEach((el, index) => {
        (el as HTMLElement).dataset.line = String(index);
    });

    // Clear selection when viewing new file
    clearSelection();

    // Switch panels
    document.getElementById('file-explorer-panel')?.classList.remove('active');
    document.getElementById('code-viewer-panel')?.classList.add('active');
}

function showFileExplorer(): void {
    document.getElementById('code-viewer-panel')?.classList.remove('active');
    document.getElementById('file-explorer-panel')?.classList.add('active');

    // Reset select mode when leaving code viewer
    if (selectModeActive) {
        selectModeActive = false;
        document.getElementById('code-select-toggle')?.classList.remove('active');
        document.getElementById('code-content-diff')?.classList.remove('select-mode');
        clearSelection();
    }
}

// Selection mode functions
function toggleSelectMode(): void {
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

function clearSelection(): void {
    selectedLines.clear();
    document.querySelectorAll('.d2h-code-line-ctn.selected').forEach(el => {
        el.classList.remove('selected');
    });
    selectionPhase = 'none';
    updateSendToLLMButton();
}

function selectLine(lineNumber: number): void {
    const lineEl = document.querySelector(`.d2h-code-line-ctn[data-line="${lineNumber}"]`);
    if (lineEl) {
        selectedLines.add(lineNumber);
        lineEl.classList.add('selected');
    }
}

function updateSendToLLMButton(): void {
    const btn = document.getElementById('send-to-llm-btn') as HTMLElement | null;
    if (!btn) return;

    if (selectedLines.size === 0) {
        btn.style.display = 'none';
        return;
    }

    // Find the last selected line element
    const sortedLines = Array.from(selectedLines).sort((a, b) => a - b);
    const lastLineNumber = sortedLines[sortedLines.length - 1];
    const lastLineEl = document.querySelector(`.d2h-code-line-ctn[data-line="${lastLineNumber}"]`);

    if (!lastLineEl) {
        btn.style.display = 'none';
        return;
    }

    // Position the button below the last selected line
    // Button uses position: fixed, so we use viewport coordinates directly
    const lineRect = lastLineEl.getBoundingClientRect();

    // Position in viewport coordinates (lineRect.bottom is already viewport-relative)
    btn.style.display = 'block';
    btn.style.top = (lineRect.bottom) + 'px';
}

function handleLineClick(lineNumber: number): void {
    if (!selectModeActive) return;

    if (selectionPhase === 'range') {
        // Tap after range is complete: just clear
        clearSelection();
    } else if (selectionPhase === 'none') {
        // First tap: select starting line
        selectLine(lineNumber);
        selectionPhase = 'first';
        updateSendToLLMButton();
    } else if (selectionPhase === 'first') {
        // Second tap: select range from first to this line
        const firstLine = Array.from(selectedLines)[0];
        const start = Math.min(firstLine, lineNumber);
        const end = Math.max(firstLine, lineNumber);

        // Clear and select entire range
        clearSelection();
        for (let i = start; i <= end; i++) {
            selectLine(i);
        }
        selectionPhase = 'range';
        updateSendToLLMButton();
    }
}

// Set up click handler for code lines using event delegation
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
document.getElementById('send-to-llm-btn')?.addEventListener('click', () => {
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

    // Switch to LLM view
    switchView('llm');

    // Focus the terminal so user can start typing
    term.focus();

    // Send reference to terminal
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'terminal_data',
            terminal: 'llm',
            data: btoa(reference)
        }));
    }

    // Clear selection and exit select mode
    selectModeActive = false;
    document.getElementById('code-select-toggle')?.classList.remove('active');
    document.getElementById('code-content-diff')?.classList.remove('select-mode');
    clearSelection();
});

function performCommit(): void {
    const messageInput = document.getElementById('commit-message') as HTMLTextAreaElement | null;
    if (!messageInput) return;
    const message = messageInput.value.trim();

    if (!message) {
        alert('Please enter a commit message');
        return;
    }

    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement | null;
    if (!commitBtn || !ws) return;

    // Send commit request via WebSocket
    ws.send(JSON.stringify({
        type: 'git_commit',
        message: message
    }));

    // Disable button to prevent double-submit
    commitBtn.disabled = true;
    commitBtn.textContent = 'Committing...';
}

interface FileListMessage {
    type: 'file_list';
    files?: FileInfo[];
    path: string;
    error?: string;
}

interface FileContentMessage {
    type: 'file_content';
    content: string;
    path: string;
    error?: string;
}

interface FileWithDiffMessage {
    type: 'file_with_diff';
    diff: string;
    path: string;
    hasDiff: boolean;
    error?: string;
}

type FileMessage = FileListMessage | FileContentMessage | FileWithDiffMessage;

function handleFileMessage(msg: FileMessage): void {
    if (msg.type === 'file_list') {
        if (msg.error) {
            console.error('File list error:', msg.error);
            return;
        }
        renderFileList(msg.files || [], msg.path);
    } else if (msg.type === 'file_content') {
        if (msg.error) {
            console.error('File read error:', msg.error);
            return;
        }
        showCodeViewer(msg.content, msg.path.split('/').pop() || '');
    } else if (msg.type === 'file_with_diff') {
        if (msg.error) {
            console.error('File read error:', msg.error);
            return;
        }

        const filename = msg.path.split('/').pop() || '';

        // Always use diff view for consistency
        // hasChanges controls whether we show two line number columns or one
        showDiffViewer(msg.diff, filename, msg.hasDiff);
    }
}

function getWebSocketURL(): string {
    const params = new URLSearchParams({ user: USERNAME });

    // Use wss:// for HTTPS pages or file:// (Android bundled assets), ws:// for HTTP
    const protocol = (window.location.protocol === 'https:' || window.location.protocol === 'file:') ? 'wss:' : 'ws:';

    // Use /ws path for WebSocket connections (proxied by nginx)
    // This works for both HTTP and HTTPS
    return `${protocol}//${WS_HOST}/ws?${params.toString()}`;
}

// Status elements
const statusEl = document.getElementById('status');

// Initialize xterm.js
const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: {
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#ffffff',
        cursorAccent: '#000000',
        selectionBackground: 'rgba(255, 255, 255, 0.3)',
        black: '#000000',
        red: '#e06c75',
        green: '#98c379',
        yellow: '#d19a66',
        blue: '#61afef',
        magenta: '#c678dd',
        cyan: '#56b6c2',
        white: '#abb2bf',
        brightBlack: '#5c6370',
        brightRed: '#e06c75',
        brightGreen: '#98c379',
        brightYellow: '#d19a66',
        brightBlue: '#61afef',
        brightMagenta: '#c678dd',
        brightCyan: '#56b6c2',
        brightWhite: '#ffffff'
    },
    allowTransparency: false,
    scrollback: 100000
});

// Fit addon for responsive terminal sizing
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

// Open terminal
const terminalEl = document.getElementById('terminal');
if (terminalEl) {
    term.open(terminalEl);
    fitAddon.fit();
}

// Shell terminal - lazy initialized when Terminal view is first opened
let termShell: Terminal | null = null;
let fitAddonShell: FitAddon | null = null;
let shellTerminalInitialized = false;

function initShellTerminal(): void {
    if (shellTerminalInitialized) return;
    shellTerminalInitialized = true;

    debugLog('TERMINAL', 'info', 'Lazy-initializing shell terminal (view is now visible)');

    termShell = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: {
            background: '#000000',
            foreground: '#ffffff',
            cursor: '#ffffff',
            cursorAccent: '#000000',
            selectionBackground: 'rgba(255, 255, 255, 0.3)',
            black: '#000000',
            red: '#e06c75',
            green: '#98c379',
            yellow: '#d19a66',
            blue: '#61afef',
            magenta: '#c678dd',
            cyan: '#56b6c2',
            white: '#abb2bf',
            brightBlack: '#5c6370',
            brightRed: '#e06c75',
            brightGreen: '#98c379',
            brightYellow: '#d19a66',
            brightBlue: '#61afef',
            brightMagenta: '#c678dd',
            brightCyan: '#56b6c2',
            brightWhite: '#ffffff'
        },
        allowTransparency: false,
        scrollback: 100000
    });

    fitAddonShell = new FitAddon();
    termShell.loadAddon(fitAddonShell);

    const terminalShellEl = document.getElementById('terminal-shell');
    if (terminalShellEl) {
        termShell.open(terminalShellEl);
        fitAddonShell.fit();

        // Setup touch scroll for shell terminal
        setupTouchScroll(termShell, terminalShellEl);
    }

    // Register onData handler for shell terminal
    termShell.onData((data) => {
        debugLog('TERMINAL', 'info', 'termShell.onData called', {
            dataLength: data.length,
            dataHex: Array.from(data).map(c => c.charCodeAt(0).toString(16)).join(' '),
            wsOpen: ws && ws.readyState === WebSocket.OPEN,
            activeTerminal: activeTerminal
        });
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'terminal_data',
                terminal: 'terminal',
                data: btoa(data)
            }));
            debugLog('TERMINAL', 'info', 'termShell data sent to WebSocket');
        } else {
            debugLog('TERMINAL', 'warn', 'termShell data NOT sent - WebSocket not open');
        }
    });

    // Send terminal size
    sendTerminalSize('terminal');

    // Debug: Track terminal focus events for shell terminal
    termShell.textarea?.addEventListener('focus', () => {
        debugLog('TERMINAL', 'info', 'Shell terminal textarea focused');
    });
    termShell.textarea?.addEventListener('blur', () => {
        debugLog('TERMINAL', 'info', 'Shell terminal textarea blurred');
    });

    debugLog('TERMINAL', 'info', 'Shell terminal initialized', {
        rows: termShell.rows,
        cols: termShell.cols,
        hasTextarea: !!termShell.textarea
    });
}

// Debug: Log LLM terminal initialization state
debugLog('TERMINAL', 'info', 'LLM terminal initialized', {
    llm: { rows: term.rows, cols: term.cols, hasTextarea: !!term.textarea },
    llmViewActive: document.getElementById('view-llm')?.classList.contains('active')
});

// Custom touch scroll handler for mobile momentum scrolling
// xterm.js doesn't support native momentum scrolling, so we implement it manually
function setupTouchScroll(terminal: Terminal, containerEl: HTMLElement): void {
    const viewport = containerEl.querySelector('.xterm-viewport') as HTMLElement | null;
    if (!viewport) return;

    let touchStartY = 0;
    let lastTouchY = 0;
    let lastTouchTime = 0;
    let velocityY = 0;
    let momentumAnimationId: number | null = null;
    let accumulatedDelta = 0;

    // Get line height with fallback
    function getLineHeight(): number {
        try {
            const core = (terminal as unknown as { _core?: { _renderService?: { dimensions?: { css?: { cell?: { height?: number } } } } } })._core;
            if (core && core._renderService && core._renderService.dimensions?.css?.cell?.height) {
                return Math.ceil(core._renderService.dimensions.css.cell.height) || 17;
            }
        } catch (e) {}
        // Fallback: estimate from font size (fontSize * ~1.2 line height)
        return Math.ceil(14 * 1.2);
    }

    // Cancel any ongoing momentum animation
    function cancelMomentum(): void {
        if (momentumAnimationId) {
            cancelAnimationFrame(momentumAnimationId);
            momentumAnimationId = null;
        }
    }

    viewport.addEventListener('touchstart', (e) => {
        cancelMomentum();
        if (e.touches.length === 1) {
            touchStartY = e.touches[0].clientY;
            lastTouchY = touchStartY;
            lastTouchTime = Date.now();
            velocityY = 0;
            accumulatedDelta = 0;
        }
    }, { passive: true });

    viewport.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1) {
            const currentY = e.touches[0].clientY;
            const currentTime = Date.now();
            const deltaY = lastTouchY - currentY;
            const deltaTime = currentTime - lastTouchTime;

            // Calculate velocity (pixels per millisecond)
            if (deltaTime > 0) {
                // Smooth velocity with weighted average
                velocityY = velocityY * 0.3 + (deltaY / deltaTime) * 0.7;
            }

            // Accumulate delta for sub-line movements
            accumulatedDelta += deltaY;

            const lineHeight = getLineHeight();
            const linesToScroll = Math.trunc(accumulatedDelta / lineHeight);

            if (linesToScroll !== 0) {
                terminal.scrollLines(linesToScroll);
                accumulatedDelta -= linesToScroll * lineHeight;
            }

            lastTouchY = currentY;
            lastTouchTime = currentTime;
        }
    }, { passive: true });

    viewport.addEventListener('touchend', () => {
        const lineHeight = getLineHeight();

        // Apply momentum if there's any meaningful velocity
        if (Math.abs(velocityY) > 0.1) {
            // Scale velocity for natural momentum feel
            let pixelVelocity = velocityY * 25;
            const friction = 0.96; // Higher = longer glide
            const minPixelVelocity = 0.3;
            let momentumDelta = 0;

            function momentumStep(): void {
                if (Math.abs(pixelVelocity) < minPixelVelocity) {
                    // Scroll any remaining accumulated distance
                    const finalLines = Math.round(momentumDelta / lineHeight);
                    if (finalLines !== 0) {
                        terminal.scrollLines(finalLines);
                    }
                    momentumAnimationId = null;
                    return;
                }

                momentumDelta += pixelVelocity;
                const linesToScroll = Math.trunc(momentumDelta / lineHeight);

                if (linesToScroll !== 0) {
                    terminal.scrollLines(linesToScroll);
                    momentumDelta -= linesToScroll * lineHeight;
                }

                pixelVelocity *= friction;
                momentumAnimationId = requestAnimationFrame(momentumStep);
            }

            momentumAnimationId = requestAnimationFrame(momentumStep);
        }
    }, { passive: true });
}

// Setup touch scroll for LLM terminal (shell terminal is set up in initShellTerminal)
const terminalContainer = document.getElementById('terminal');
if (terminalContainer) {
    setupTouchScroll(term, terminalContainer);
}

// Debug: Track terminal focus events for LLM terminal
term.textarea?.addEventListener('focus', () => {
    debugLog('TERMINAL', 'info', 'LLM terminal textarea focused');
});
term.textarea?.addEventListener('blur', () => {
    debugLog('TERMINAL', 'info', 'LLM terminal textarea blurred');
});

// Debug: Track focus changes to terminal textareas
document.addEventListener('focusin', (e) => {
    const isTerminal = e.target === term.textarea || e.target === termShell?.textarea;
    if (isTerminal) {
        debugLog('FOCUS', 'info', 'Terminal textarea focused');
    }
}, true);

// Track which terminal is active
let activeTerminal: 'llm' | 'terminal' = 'llm';

// WebSocket connection (declared early for use in resize handlers)
let ws: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

// Helper function to decode base64 to Uint8Array (handles UTF-8 properly)
function base64ToBytes(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

// Send terminal size to server
function sendTerminalSize(terminal: 'llm' | 'terminal'): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const t = terminal === 'terminal' ? termShell : term;
        if (!t) return; // Shell terminal not initialized yet
        const terminalId = terminal || activeTerminal;
        const resizeMessage = JSON.stringify({
            type: 'resize',
            terminal: terminalId,
            rows: t.rows,
            cols: t.cols
        });
        ws.send(resizeMessage);
    }
}

// Handle window resize
window.addEventListener('resize', () => {
    fitAddon.fit();
    if (fitAddonShell) fitAddonShell.fit();
    sendTerminalSize('llm');
    sendTerminalSize('terminal');
});

// Handle screen orientation change (mobile)
window.addEventListener('orientationchange', () => {
    setTimeout(() => {
        fitAddon.fit();
        if (fitAddonShell) fitAddonShell.fit();
        sendTerminalSize('llm');
        sendTerminalSize('terminal');
    }, 100);
});

// Handle mobile keyboard open/close using visualViewport API
function handleViewportResize(): void {
    if (window.visualViewport) {
        const viewport = window.visualViewport;
        const statusBarHeight = 32;
        const navBarHeight = 50;

        // Calculate available height for views
        const availableHeight = viewport.height - statusBarHeight - navBarHeight;

        // Resize all views
        document.querySelectorAll('.view').forEach(view => {
            (view as HTMLElement).style.height = `${availableHeight}px`;
            (view as HTMLElement).style.bottom = 'auto';
        });

        // Move nav bar and keyboard toolbar to stay above keyboard
        const navBar = document.getElementById('bottom-nav');
        const keyboardToolbar = document.getElementById('keyboard-toolbar');
        const offset = window.innerHeight - viewport.height;
        if (navBar) navBar.style.bottom = `${offset}px`;

        // Only move keyboard toolbar if it's visible (LLM view active)
        if (keyboardToolbar && keyboardToolbar.classList.contains('visible')) {
            keyboardToolbar.style.bottom = `${50 + offset}px`;
        }

        // Re-fit terminal to new dimensions
        if (activeTerminal === 'llm') {
            fitAddon.fit();
            sendTerminalSize('llm');
        } else if (activeTerminal === 'terminal' && fitAddonShell) {
            fitAddonShell.fit();
            sendTerminalSize('terminal');
        }
    }
}

// Set up visualViewport listeners for keyboard detection
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleViewportResize);
    window.visualViewport.addEventListener('scroll', handleViewportResize);
    // Initial setup
    handleViewportResize();
}

// Keyboard toolbar functionality
document.querySelectorAll('.key-btn').forEach(btn => {
    function handleKeyBtn(e: Event): void {
        e.preventDefault();
        e.stopPropagation();

        const action = (btn as HTMLElement).dataset.action;
        const key = (btn as HTMLElement).dataset.key;

        debugLog('TOOLBAR', 'info', 'Button pressed', { action, key });

        // Handle action buttons (scroll controls)
        if (action) {
            handleKeyboardAction(action);
            return;
        }

        // Handle key buttons (send sequences to terminal)
        const sequence = getBasicSequence(key || '');
        if (ws && ws.readyState === WebSocket.OPEN && sequence) {
            ws.send(JSON.stringify({
                type: 'terminal_data',
                terminal: activeTerminal,
                data: btoa(sequence)
            }));
        }
    }

    btn.addEventListener('mousedown', handleKeyBtn);
    btn.addEventListener('touchend', (e) => {
        btn.classList.remove('active');
        handleKeyBtn(e);
    });
    btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('active');
    }, { passive: false });
});

// Handle keyboard action buttons (pgup/pgdn/scroll)
function handleKeyboardAction(action: string): void {
    const terminal = activeTerminal === 'terminal' ? termShell : term;
    if (!terminal) return;

    debugLog('TOOLBAR', 'info', 'handleKeyboardAction', { action: action });

    switch (action) {
        case 'pgup':
            terminal.scrollPages(-1);
            break;
        case 'pgdn':
            terminal.scrollPages(1);
            break;
        case 'scroll-to-bottom':
            terminal.scrollToBottom();
            break;
    }

    // Action buttons don't need keyboard input.
    // Move focus to hidden element to prevent Android keyboard from appearing.
    // Note: blur() alone doesn't work - we need to actively focus something else.
    const focusTrap = document.getElementById('focus-trap') as HTMLElement | null;
    if (focusTrap) {
        focusTrap.focus();
    }
}

// Helper: Get basic (unmodified) escape sequence
function getBasicSequence(key: string): string {
    const sequences: Record<string, string> = {
        'up': '\x1b[A',
        'down': '\x1b[B',
        'right': '\x1b[C',
        'left': '\x1b[D',
        'esc': '\x1b',
        'enter': '\r',
        'ctrl-c': '\x03',
        'tab': '\t',
        'mode': '\x1b[Z'  // Shift+Tab
    };
    return sequences[key] || '';
}

// Initialize keyboard toolbar visibility (LLM view is default)
document.getElementById('keyboard-toolbar')?.classList.add('visible');

// Git View State
let gitViewInitialized = false;
let unstagedChanges: FileChange[] = [];
let stagedChanges: FileChange[] = [];
let discardConfirmState: Record<string, number> = {}; // Track which files are waiting for double-tap confirm

// Initialize Git view when switching to it
function initGitView(): void {
    if (gitViewInitialized) return;
    gitViewInitialized = true;

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

// Set up auto-resize behavior for commit input
function setupCommitInput(): void {
    const input = document.getElementById('commit-message') as HTMLTextAreaElement | null;
    if (!input) return;

    input.addEventListener('input', function(this: HTMLTextAreaElement) {
        // Reset height to calculate new height
        this.style.height = 'auto';

        // Set to scrollHeight, but respect min/max
        const newHeight = Math.min(Math.max(this.scrollHeight, 36), 120);
        this.style.height = newHeight + 'px';
    });
}

// Toggle accordion section (mutually exclusive)
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

// Load git status from bridge
function loadGitStatus(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Send git status command via WebSocket
    ws.send(JSON.stringify({ type: 'git_status' }));
}

// Parse git diff output
function parseDiff(diffText: string): DiffLine[] {
    const lines = diffText.split('\n');
    const result: DiffLine[] = [];

    for (const line of lines) {
        // Skip diff metadata headers
        if (line.startsWith('diff') ||
            line.startsWith('index') ||
            line.startsWith('---') ||
            line.startsWith('+++') ||
            line.startsWith('@@')) {
            continue;
        }

        if (line.startsWith('+')) {
            result.push({ type: 'added', content: line });
        } else if (line.startsWith('-')) {
            result.push({ type: 'removed', content: line });
        } else {
            result.push({ type: 'context', content: line });
        }
    }

    return result;
}

// HTML escape utility
function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Split highlighted HTML by newlines while preserving span tags
function splitHighlightedHTML(html: string): string[] {
    const lines: string[] = [];
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    let currentLine = '';
    const openTags: string[] = []; // Stack of open tag class names

    function walkNode(node: Node): void {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent || '';
            const parts = text.split('\n');

            for (let i = 0; i < parts.length; i++) {
                if (i > 0) {
                    // Close all open tags before pushing the line
                    for (let j = openTags.length - 1; j >= 0; j--) {
                        currentLine += '</span>';
                    }
                    lines.push(currentLine);
                    currentLine = '';

                    // Reopen tags for next line
                    for (const className of openTags) {
                        currentLine += `<span class="${className}">`;
                    }
                }
                currentLine += escapeHtml(parts[i]);
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as HTMLElement;
            if (element.tagName.toLowerCase() === 'span') {
                const className = element.className;
                currentLine += `<span class="${className}">`;
                openTags.push(className);

                // Process children
                for (const child of Array.from(element.childNodes)) {
                    walkNode(child);
                }

                currentLine += '</span>';
                openTags.pop();
            } else {
                // Process children of non-span elements
                for (const child of Array.from(element.childNodes)) {
                    walkNode(child);
                }
            }
        }
    }

    walkNode(tempDiv);

    // Push last line if exists
    if (currentLine) {
        lines.push(currentLine);
    }

    return lines;
}

// Apply syntax highlighting to diff lines
function highlightDiffLines(diffLines: DiffLine[], filePath: string): DiffLine[] {
    // Detect language from file extension
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
        'js': 'javascript', 'jsx': 'javascript', 'ts': 'typescript',
        'tsx': 'typescript', 'py': 'python', 'go': 'go', 'rs': 'rust',
        'java': 'java', 'c': 'c', 'cpp': 'cpp', 'cc': 'cpp', 'cxx': 'cpp',
        'h': 'c', 'hpp': 'cpp', 'css': 'css', 'scss': 'scss', 'sass': 'sass',
        'html': 'html', 'htm': 'html', 'xml': 'xml', 'json': 'json',
        'md': 'markdown', 'markdown': 'markdown', 'sh': 'bash', 'bash': 'bash',
        'yml': 'yaml', 'yaml': 'yaml', 'sql': 'sql', 'rb': 'ruby',
        'php': 'php', 'swift': 'swift', 'kt': 'kotlin', 'cs': 'csharp'
    };
    const language = langMap[ext] || '';

    // Extract raw code (without +/- prefixes)
    const codeLines = diffLines.map(line => {
        let code = line.content;
        // Remove leading +/- but preserve indentation
        if (code.startsWith('+') || code.startsWith('-')) {
            code = code.substring(1);
        }
        return code;
    });

    // Apply syntax highlighting to entire code block
    const tempDiv = document.createElement('div');
    const pre = document.createElement('pre');
    const code = document.createElement('code');

    if (language) {
        code.className = `language-${language}`;
    }

    code.textContent = codeLines.join('\n');
    pre.appendChild(code);
    tempDiv.appendChild(pre);

    // Highlight the code
    hljs.highlightElement(code);

    // Extract highlighted HTML and split back into lines
    const highlightedHTML = code.innerHTML;
    const highlightedLines = splitHighlightedHTML(highlightedHTML);

    // Match highlighted lines back to diff lines
    return diffLines.map((line, index) => ({
        ...line,
        highlightedContent: highlightedLines[index] ?? ''
    }));
}

// Render file change item
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

// Update unstaged changes display
function updateUnstagedChanges(files: FileChange[]): void {
    unstagedChanges = files;
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

// Update staged changes display
function updateStagedChanges(files: FileChange[]): void {
    stagedChanges = files;
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

// Git actions
function stageFile(filePath: string): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'git_stage', file: filePath }));
}

function unstageFile(filePath: string): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'git_unstage', file: filePath }));
}

function stageAll(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'git_stage_all' }));
}

function unstageAll(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'git_unstage_all' }));
}

function discardFile(btn: HTMLElement, filePath: string): void {
    // Implement double-tap confirmation
    const now = Date.now();
    const lastTap = discardConfirmState[filePath] || 0;

    if (now - lastTap < 2000) { // 2 second window for double tap
        // Confirmed - discard the file
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'git_discard', file: filePath }));
        delete discardConfirmState[filePath];
        btn.classList.remove('confirm');
    } else {
        // First tap - show confirmation state
        discardConfirmState[filePath] = now;
        btn.classList.add('confirm');
        btn.textContent = 'Tap again to confirm';

        // Reset after 2 seconds
        setTimeout(() => {
            if (discardConfirmState[filePath] === now) {
                delete discardConfirmState[filePath];
                btn.classList.remove('confirm');
                btn.textContent = 'Discard';
            }
        }, 2000);
    }
}

function pullChanges(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const pullBtn = document.getElementById('pull-btn') as HTMLButtonElement | null;
    if (pullBtn) {
        pullBtn.disabled = true;
        pullBtn.textContent = 'Pulling...';
    }

    ws.send(JSON.stringify({ type: 'git_pull' }));
}

function pushChanges(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const pushBtn = document.getElementById('push-btn') as HTMLButtonElement | null;
    if (pushBtn) {
        pushBtn.disabled = true;
        pushBtn.textContent = 'Pushing...';
    }

    ws.send(JSON.stringify({ type: 'git_push' }));
}

interface GitStatusMessage {
    type: 'git_status';
    unstaged?: FileChange[];
    staged?: FileChange[];
}

interface GitErrorMessage {
    type: 'git_error';
    error: string;
}

type GitMessage = GitStatusMessage | GitErrorMessage | { type: string };

// Handle Git messages from bridge
function handleGitMessage(msg: GitMessage): void {
    if (msg.type === 'git_status') {
        const statusMsg = msg as GitStatusMessage;
        updateUnstagedChanges(statusMsg.unstaged || []);
        updateStagedChanges(statusMsg.staged || []);
        // Refresh file list if we're on the code view to update unstaged highlighting
        if (document.getElementById('view-code')?.classList.contains('active') && currentPath) {
            listFiles(currentPath);
        }
    } else if (msg.type === 'git_stage_success' || msg.type === 'git_unstage_success' || msg.type === 'git_discard_success' || msg.type === 'git_stage_all_success' || msg.type === 'git_unstage_all_success') {
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

function updateStatus(status: string, message: string): void {
    if (statusEl) {
        statusEl.className = status;
        statusEl.textContent = message;
    }
}

// Flag to prevent concurrent connection attempts
let isConnecting = false;

function connect(): void {
    // Prevent concurrent connection attempts
    if (isConnecting) {
        debugLog('WS', 'info', 'Connection already in progress, skipping', {
            wsState: wsState
        });
        return;
    }
    isConnecting = true;

    currentCorrelationId = generateCorrelationId();
    connectionStartTime = Date.now();

    debugLog('WS', 'info', 'Starting connection', {
        attempt: reconnectAttempts,
        hasExistingWs: !!ws,
        existingWsState: ws ? ws.readyState : null
    });

    if (ws) {
        debugLog('WS', 'info', 'Closing existing WebSocket', {
            readyState: ws.readyState
        });
        ws.close();
    }

    setWsState(WS_STATES.CONNECTING, 'connect() called');
    updateStatus('connecting', 'Connecting to terminal...');

    try {
        const wsUrl = getWebSocketURL();

        debugLog('WS', 'info', 'Creating WebSocket', {
            url: wsUrl
        });

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            isConnecting = false;  // Connection complete
            const connectDuration = connectionStartTime ? Date.now() - connectionStartTime : 0;

            // Flush queued debug logs now that WebSocket is ready
            flushDebugLogQueue();

            debugLog('WS', 'info', 'WebSocket opened', {
                connectDuration: connectDuration
            });

            setWsState(WS_STATES.CONNECTED, 'onopen');
            updateStatus('connected', `Connected`);

            // Cancel any pending reconnect timeout - critical to prevent stale timeouts
            // from firing after successful connection
            if (reconnectTimeout) {
                debugLog('WS', 'info', 'Clearing stale reconnect timeout');
                clearTimeout(reconnectTimeout);
                reconnectTimeout = null;
            }

            // Reset reconnection backoff on successful connection
            reconnectAttempts = 0;

            // Start health monitoring
            startHealthCheck();

            // Send initial terminal size
            sendTerminalSize('llm');
            sendTerminalSize('terminal');
        };

        ws.onmessage = (event) => {
            // Handle text messages (session ID, file ops) vs binary (terminal output)
            if (typeof event.data === 'string') {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'pong') {
                        // Server heartbeat - update last pong time for health monitoring
                        const timeSinceLastPong = Date.now() - lastPongTime;
                        debugLog('HEALTH', 'debug', 'Pong received', {
                            timeSinceLastPong: timeSinceLastPong
                        });
                        lastPongTime = Date.now();
                    } else if (msg.type === 'terminal_data') {
                        // Route terminal data to correct terminal
                        // Decode base64 to bytes for proper UTF-8 handling
                        const data = base64ToBytes(msg.data);
                        if (msg.terminal === 'terminal') {
                            if (termShell) {
                                termShell.write(data);
                            }
                            // If termShell not initialized, data is lost but that's OK
                            // since user hasn't opened Terminal view yet
                        } else {
                            term.write(data);
                        }
                    } else if (msg.type === 'session' && msg.id) {
                        console.log('Session ID:', msg.id);
                        currentSessionId = msg.id;
                        // Register for push notifications (PWA Web Push)
                        registerWebPush();
                    } else if (msg.type === 'file_list' || msg.type === 'file_content' || msg.type === 'file_with_diff') {
                        handleFileMessage(msg);
                    } else if (msg.type && msg.type.startsWith('git_')) {
                        handleGitMessage(msg);
                    }
                } catch (e) {
                    // Not JSON, treat as text output
                    term.write(event.data);
                }
            } else if (event.data instanceof ArrayBuffer) {
                const data = new Uint8Array(event.data);
                term.write(data);
            } else if (event.data instanceof Blob) {
                event.data.arrayBuffer().then(buf => {
                    term.write(new Uint8Array(buf));
                });
            }
        };

        ws.onerror = (error) => {
            // Note: onerror is always followed by onclose, so don't reset isConnecting here
            // to avoid race conditions. Let onclose handle it.
            debugLog('WS', 'error', 'WebSocket error', {
                errorType: (error as Event).type,
                message: (error as ErrorEvent).message || 'No message',
                readyState: ws ? ws.readyState : null
            });
            updateStatus('disconnected', 'Connection error');
        };

        ws.onclose = (event) => {
            isConnecting = false;  // Connection attempt complete (failed or closed)
            const closeInfo = {
                code: event.code,
                reason: event.reason || 'No reason provided',
                wasClean: event.wasClean,
                codeMeaning: CLOSE_CODE_MEANINGS[event.code] || 'Unknown',
                timeSinceOpen: connectionStartTime ? Date.now() - connectionStartTime : null
            };

            debugLog('WS', 'warn', 'WebSocket closed', closeInfo);

            stopHealthCheck();
            setWsState(WS_STATES.DISCONNECTED, `Close code: ${event.code}`);

            const delay = getReconnectDelay();
            reconnectAttempts++;

            debugLog('WS', 'info', 'Scheduling reconnect', {
                delay: delay,
                nextAttempt: reconnectAttempts
            });

            updateStatus('disconnected', `Disconnected. Reconnecting in ${Math.round(delay/1000)}s...`);

            // Auto-reconnect with exponential backoff
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
            }
            reconnectTimeout = setTimeout(() => {
                setWsState(WS_STATES.RECONNECTING, 'reconnect timeout fired');
                connect();
            }, delay);
        };

    } catch (error) {
        isConnecting = false;  // Connection attempt failed
        debugLog('WS', 'error', 'Connection exception', {
            error: (error as Error).message,
            stack: (error as Error).stack
        });
        const delay = getReconnectDelay();
        reconnectAttempts++;
        updateStatus('disconnected', `Failed to connect. Retrying in ${Math.round(delay/1000)}s...`);

        // Retry connection with exponential backoff
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
        }
        reconnectTimeout = setTimeout(connect, delay);
    }
}

// Handle terminal input (registered once, uses current ws variable)
term.onData((data) => {
    debugLog('TERMINAL', 'info', 'term.onData (LLM) called', {
        dataLength: data.length,
        dataHex: Array.from(data).map(c => c.charCodeAt(0).toString(16)).join(' '),
        wsOpen: ws && ws.readyState === WebSocket.OPEN,
        activeTerminal: activeTerminal
    });
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'terminal_data',
            terminal: 'llm',
            data: btoa(data)
        }));
    }
});

// View switching
function switchView(viewName: string): void {
    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    // Show selected view
    document.getElementById(`view-${viewName}`)?.classList.add('active');
    document.querySelector(`[data-view="${viewName}"]`)?.classList.add('active');

    // Toggle keyboard toolbar visibility and adjust terminal height
    const keyboardToolbar = document.getElementById('keyboard-toolbar');
    const terminalContainerEl = document.getElementById('terminal-container');
    const terminalShellContainer = document.getElementById('terminal-shell-container');

    if (viewName === 'llm') {
        activeTerminal = 'llm';
        keyboardToolbar?.classList.add('visible');
        handleViewportResize();  // Immediately recalculate toolbar position
        if (terminalContainerEl) terminalContainerEl.style.bottom = '94px';
        setTimeout(() => {
            fitAddon.fit();
            sendTerminalSize('llm');
        }, 50);
    } else if (viewName === 'terminal') {
        activeTerminal = 'terminal';
        keyboardToolbar?.classList.add('visible');
        handleViewportResize();  // Immediately recalculate toolbar position
        if (terminalShellContainer) terminalShellContainer.style.bottom = '94px';

        // Lazy-initialize the shell terminal on first access (when view is visible)
        initShellTerminal();

        setTimeout(() => {
            if (fitAddonShell) {
                fitAddonShell.fit();
                sendTerminalSize('terminal');
            }

            // Debug: Log terminal state after fit
            debugLog('TERMINAL', 'info', 'Terminal view ready after fit', {
                rows: termShell?.rows,
                cols: termShell?.cols
            });
        }, 50);
    } else {
        keyboardToolbar?.classList.remove('visible');
        if (keyboardToolbar) keyboardToolbar.style.bottom = '';  // Clear stale inline style
        if (terminalContainerEl) terminalContainerEl.style.bottom = '50px';
        if (terminalShellContainer) terminalShellContainer.style.bottom = '50px';
    }

    // Load files when switching to Code view
    if (viewName === 'code') {
        if (ws && ws.readyState === WebSocket.OPEN) {
            loadGitStatus();
            if (!codeViewInitialized) {
                codeViewInitialized = true;
                listFiles(PROJECT_ROOT);
            }
            // Reload current file if viewer is active
            if (document.getElementById('code-viewer-panel')?.classList.contains('active') && currentFilePath) {
                readFileWithDiff(currentFilePath);
            }
        }
    }

    // Initialize Git view when switching to it
    if (viewName === 'git') {
        initGitView();
        // Always refresh git status when opening the view
        loadGitStatus();
    }
}

// Nav button click handlers
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView((btn as HTMLElement).dataset.view || ''));
});

// Start connection
connect();

// Handle page visibility (reconnect when coming back to the page)
document.addEventListener('visibilitychange', () => {
    const visibilityState = document.visibilityState;
    const hidden = document.hidden;

    debugLog('VISIBILITY', 'info', 'Visibility changed', {
        visibilityState: visibilityState,
        hidden: hidden,
        wsState: wsState,
        wsReadyState: ws ? ws.readyState : null,
        reconnectAttempts: reconnectAttempts,
        timeSinceLastPong: Date.now() - lastPongTime
    });

    if (hidden) {
        debugLog('VISIBILITY', 'info', 'Page hidden - stopping health checks');
        stopHealthCheck();
    } else {
        debugLog('VISIBILITY', 'info', 'Page visible - checking connection');

        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
            debugLog('VISIBILITY', 'info', 'Connection lost while hidden, reconnecting', {
                wsExists: !!ws,
                wsReadyState: ws ? ws.readyState : null
            });
            // Reset backoff when user returns to give quick reconnection
            reconnectAttempts = 0;
            connect();
        } else if (ws.readyState === WebSocket.OPEN) {
            debugLog('VISIBILITY', 'info', 'Connection still open, restarting health monitoring');
            // Connection still open - restart health monitoring
            startHealthCheck();
        } else if (ws.readyState === WebSocket.CONNECTING) {
            debugLog('VISIBILITY', 'info', 'Connection in progress, waiting');
        }
        // If CONNECTING, let the pending connection complete
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    stopHealthCheck();
    if (ws) {
        ws.close();
    }
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }
});

// Network status change handlers - detect airplane mode, wifi loss, etc.
window.addEventListener('offline', () => {
    debugLog('NETWORK', 'warn', 'Browser went offline', {
        wsState: wsState,
        wsReadyState: ws ? ws.readyState : null
    });

    // Update status immediately - don't wait for health check timeout
    setWsState(WS_STATES.DISCONNECTED, 'network offline');
    updateStatus('disconnected', 'Connection lost - offline');

    // Stop health checks and pending reconnects (they won't work offline)
    stopHealthCheck();
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    // Close the WebSocket - it's dead anyway
    if (ws) {
        ws.close();
    }
});

window.addEventListener('online', () => {
    debugLog('NETWORK', 'info', 'Browser came online', {
        wsState: wsState,
        wsReadyState: ws ? ws.readyState : null
    });

    // Network is back - reconnect immediately
    updateStatus('connecting', 'Network restored - reconnecting...');
    reconnectAttempts = 0;
    isConnecting = false;
    connect();
});

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js');
}

// Expose functions to window for onclick handlers in HTML
declare global {
    interface Window {
        navigateToFolder: typeof navigateToFolder;
        openFile: typeof openFile;
        showFileExplorer: typeof showFileExplorer;
        toggleSelectMode: typeof toggleSelectMode;
    }
}

window.navigateToFolder = navigateToFolder;
window.openFile = openFile;
window.showFileExplorer = showFileExplorer;
window.toggleSelectMode = toggleSelectMode;
