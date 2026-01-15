// Configuration - use same host as the page is served from
const WS_HOST = window.location.hostname || 'localhost';
const WS_PORT = '8081';

// Authentication - HARDCODED FOR NOW
const USERNAME = 'detach-dev';

// Exponential backoff reconnection
const RECONNECT_BASE_DELAY = 1000;  // Start at 1 second
const RECONNECT_MAX_DELAY = 30000;  // Max 30 seconds
let reconnectAttempts = 0;

// Connection health monitoring
let lastPongTime = Date.now();
let healthCheckInterval = null;

function getReconnectDelay() {
    const delay = Math.min(
        RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts),
        RECONNECT_MAX_DELAY
    );
    // Add jitter to prevent thundering herd
    return delay + Math.random() * 1000;
}

function startHealthCheck() {
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
    }
    lastPongTime = Date.now();
    healthCheckInterval = setInterval(() => {
        const timeSinceLastPong = Date.now() - lastPongTime;
        if (timeSinceLastPong > 45000) {
            console.log('Connection appears stale (no pong for 45s), reconnecting...');
            if (ws) {
                ws.close();
            }
        }
    }, 15000);
}

function stopHealthCheck() {
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
    }
}

// Session persistence
const SESSION_KEY = 'detach_session_id';

// Code view state
const PROJECT_ROOT = '~/projects/sample';
let currentPath = PROJECT_ROOT;
let codeViewInitialized = false;

// Selection mode state
let selectModeActive = false;
let selectedLines = new Set();
let currentFilePath = '';
let selectionPhase = 'none'; // 'none' | 'first' | 'range'

// Code view functions
function listFiles(path) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'list_files', path: path }));
    }
}

function readFile(path) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'read_file', path: path }));
    }
}

function readFileWithDiff(path) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'read_file_with_diff', path: path }));
    }
}

function renderFileList(files, path) {
    const fileList = document.getElementById('file-list');
    const currentPathEl = document.getElementById('current-path');

    currentPath = path;
    currentPathEl.textContent = path;

    // Build set of unstaged file paths and directories containing unstaged files
    const unstagedPaths = new Set(unstagedChanges.map(f => f.path));
    const dirsWithUnstaged = new Set();
    const untrackedDirPrefixes = []; // Untracked directories - all contents are unstaged
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
    const isInsideUntrackedDir = (relPath) => {
        return untrackedDirPrefixes.some(prefix => relPath.startsWith(prefix));
    };

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

        if (file.is_dir) {
            html += `
                <div class="file-item${hasUnstagedChanges ? ' has-unstaged-changes' : ''}" onclick="navigateToFolder('${fullPath}')">
                    <span class="file-icon">${icon}</span>
                    <span class="file-name">${file.name}</span>
                </div>
            `;
        } else {
            html += `
                <div class="file-item${hasUnstagedChanges ? ' has-unstaged-changes' : ''}" onclick="openFile('${fullPath}', '${file.name}')">
                    <span class="file-icon">${icon}</span>
                    <span class="file-name">${file.name}</span>
                    <span class="file-size">${size}</span>
                </div>
            `;
        }
    }

    fileList.innerHTML = html;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function navigateToFolder(path) {
    listFiles(path);
}

function openFile(path, filename) {
    document.getElementById('code-filename').textContent = filename;
    currentFilePath = path;
    readFileWithDiff(path);
}

function showCodeViewer(content, filename) {
    const codeEl = document.getElementById('code-content');
    const normalContainer = document.getElementById('code-content-normal');
    const diffContainer = document.getElementById('code-content-diff');

    // Show normal view, hide diff view
    normalContainer.style.display = 'block';
    diffContainer.style.display = 'none';

    codeEl.textContent = content;

    // Auto-detect language and highlight
    delete codeEl.dataset.highlighted;
    hljs.highlightElement(codeEl);

    // Switch panels
    document.getElementById('file-explorer-panel').classList.remove('active');
    document.getElementById('code-viewer-panel').classList.add('active');
}

// diff2html configuration - line-by-line is more mobile-friendly
const diff2htmlConfig = {
    drawFileList: false,
    fileListToggle: false,
    fileContentToggle: false,
    matching: 'lines',
    outputFormat: 'line-by-line',
    synchronisedScroll: true,
    highlight: true,
    renderNothingWhenEmpty: false,
    colorScheme: 'dark',
};

function showDiffViewer(diff, filename, hasChanges = true) {
    const normalContainer = document.getElementById('code-content-normal');
    const diffContainer = document.getElementById('code-content-diff');

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
        el.dataset.line = index;
    });

    // Clear selection when viewing new file
    clearSelection();

    // Switch panels
    document.getElementById('file-explorer-panel').classList.remove('active');
    document.getElementById('code-viewer-panel').classList.add('active');
}

function showFileExplorer() {
    document.getElementById('code-viewer-panel').classList.remove('active');
    document.getElementById('file-explorer-panel').classList.add('active');

    // Reset select mode when leaving code viewer
    if (selectModeActive) {
        selectModeActive = false;
        document.getElementById('code-select-toggle').classList.remove('active');
        document.getElementById('code-content-diff').classList.remove('select-mode');
        clearSelection();
    }
}

// Selection mode functions
function toggleSelectMode() {
    selectModeActive = !selectModeActive;
    const btn = document.getElementById('code-select-toggle');
    const diffContainer = document.getElementById('code-content-diff');

    if (selectModeActive) {
        btn.classList.add('active');
        diffContainer.classList.add('select-mode');
    } else {
        btn.classList.remove('active');
        diffContainer.classList.remove('select-mode');
        clearSelection();
    }
}

function clearSelection() {
    selectedLines.clear();
    document.querySelectorAll('.d2h-code-line-ctn.selected').forEach(el => {
        el.classList.remove('selected');
    });
    selectionPhase = 'none';
    updateSendToLLMButton();
}

function selectLine(lineNumber) {
    const lineEl = document.querySelector(`.d2h-code-line-ctn[data-line="${lineNumber}"]`);
    if (lineEl) {
        selectedLines.add(lineNumber);
        lineEl.classList.add('selected');
    }
}

function updateSendToLLMButton() {
    const btn = document.getElementById('send-to-llm-btn');

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
    const diffContainer = document.getElementById('code-content-diff');
    const containerRect = diffContainer.getBoundingClientRect();
    const lineRect = lastLineEl.getBoundingClientRect();

    // Calculate position relative to the code-viewer-panel (which has position: relative via .code-panel)
    const scrollTop = diffContainer.scrollTop;
    const topPosition = lineRect.bottom - containerRect.top + scrollTop + 8;

    btn.style.display = 'block';
    btn.style.top = topPosition + 'px';
}

function handleLineClick(lineNumber) {
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
document.getElementById('code-content-diff').addEventListener('click', (e) => {
    const lineEl = e.target.closest('.d2h-code-line-ctn');
    if (lineEl && lineEl.dataset.line !== undefined) {
        handleLineClick(parseInt(lineEl.dataset.line, 10));
    }
});

// Send to LLM button click handler
document.getElementById('send-to-llm-btn').addEventListener('click', () => {
    if (selectedLines.size === 0 || !currentFilePath) return;

    // Get line range (convert to 1-based for display)
    const sortedLines = Array.from(selectedLines).sort((a, b) => a - b);
    const startLine = sortedLines[0] + 1;
    const endLine = sortedLines[sortedLines.length - 1] + 1;

    // Create reference string
    let reference;
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
    document.getElementById('code-select-toggle').classList.remove('active');
    document.getElementById('code-content-diff').classList.remove('select-mode');
    clearSelection();
});

function performCommit() {
    const messageInput = document.getElementById('commit-message');
    const message = messageInput.value.trim();

    if (!message) {
        alert('Please enter a commit message');
        return;
    }

    const commitBtn = document.getElementById('commit-btn');

    // Send commit request via WebSocket
    ws.send(JSON.stringify({
        type: 'git_commit',
        message: message
    }));

    // Disable button to prevent double-submit
    commitBtn.disabled = true;
    commitBtn.textContent = 'Committing...';
}

function handleFileMessage(msg) {
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
        showCodeViewer(msg.content, msg.path.split('/').pop());
    } else if (msg.type === 'file_with_diff') {
        if (msg.error) {
            console.error('File read error:', msg.error);
            return;
        }

        const filename = msg.path.split('/').pop();

        // Always use diff view for consistency
        // hasChanges controls whether we show two line number columns or one
        showDiffViewer(msg.diff, filename, msg.hasDiff);
    }
}

function getWebSocketURL() {
    const params = new URLSearchParams({ user: USERNAME });
    const sessionId = localStorage.getItem(SESSION_KEY);
    if (sessionId) {
        params.set('session', sessionId);
    }

    // Use wss:// for HTTPS pages, ws:// for HTTP
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

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
        selection: 'rgba(255, 255, 255, 0.3)',
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
    scrollback: 10000,
    localEcho: false
});

// Fit addon for responsive terminal sizing
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);

// Open terminal
term.open(document.getElementById('terminal'));
fitAddon.fit();

// Initialize shell terminal
const termShell = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: {
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#ffffff',
        cursorAccent: '#000000',
        selection: 'rgba(255, 255, 255, 0.3)',
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
    scrollback: 10000,
    localEcho: false
});

const fitAddonShell = new FitAddon.FitAddon();
termShell.loadAddon(fitAddonShell);

termShell.open(document.getElementById('terminal-shell'));
fitAddonShell.fit();

// Track which terminal is active
let activeTerminal = 'llm';

// WebSocket connection (declared early for use in resize handlers)
let ws = null;
let reconnectTimeout = null;

// Helper function to decode base64 to Uint8Array (handles UTF-8 properly)
function base64ToBytes(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

// Send terminal size to server
function sendTerminalSize(terminal) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const t = terminal === 'terminal' ? termShell : term;
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
    fitAddonShell.fit();
    sendTerminalSize('llm');
    sendTerminalSize('terminal');
});

// Handle screen orientation change (mobile)
window.addEventListener('orientationchange', () => {
    setTimeout(() => {
        fitAddon.fit();
        fitAddonShell.fit();
        sendTerminalSize('llm');
        sendTerminalSize('terminal');
    }, 100);
});

// Handle mobile keyboard open/close using visualViewport API
function handleViewportResize() {
    if (window.visualViewport) {
        const viewport = window.visualViewport;
        const statusBarHeight = 32;
        const navBarHeight = 50;

        // Calculate available height for views
        const availableHeight = viewport.height - statusBarHeight - navBarHeight;

        // Resize all views
        document.querySelectorAll('.view').forEach(view => {
            view.style.height = `${availableHeight}px`;
            view.style.bottom = 'auto';
        });

        // Move nav bar and keyboard toolbar to stay above keyboard
        const navBar = document.getElementById('bottom-nav');
        const keyboardToolbar = document.getElementById('keyboard-toolbar');
        const offset = window.innerHeight - viewport.height;
        navBar.style.bottom = `${offset}px`;

        // Only move keyboard toolbar if it's visible (LLM view active)
        if (keyboardToolbar.classList.contains('visible')) {
            keyboardToolbar.style.bottom = `${50 + offset}px`;
        }

        // Re-fit terminal to new dimensions
        if (activeTerminal === 'llm') {
            fitAddon.fit();
            sendTerminalSize('llm');
        } else if (activeTerminal === 'terminal') {
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
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const key = btn.dataset.key;
        const sequence = getBasicSequence(key);

        // Send sequence if valid
        if (ws && ws.readyState === WebSocket.OPEN && sequence) {
            ws.send(JSON.stringify({
                type: 'terminal_data',
                terminal: activeTerminal,
                data: btoa(sequence)
            }));
        }
    });
});

// Helper: Get basic (unmodified) escape sequence
function getBasicSequence(key) {
    const sequences = {
        'up': '\x1b[A',
        'down': '\x1b[B',
        'right': '\x1b[C',
        'left': '\x1b[D',
        'esc': '\x1b',
        'enter': '\r',
        'ctrl-c': '\x03'
    };
    return sequences[key] || '';
}

// Initialize keyboard toolbar visibility (LLM view is default)
document.getElementById('keyboard-toolbar').classList.add('visible');

// Git View State
let gitViewInitialized = false;
let unstagedChanges = [];
let stagedChanges = [];
let discardConfirmState = {}; // Track which files are waiting for double-tap confirm

// Initialize Git view when switching to it
function initGitView() {
    if (gitViewInitialized) return;
    gitViewInitialized = true;

    // Set up accordion toggle
    document.querySelectorAll('.git-section-header').forEach(header => {
        header.addEventListener('click', () => toggleGitSection(header));
    });

    // Set up commit input auto-resize
    setupCommitInput();

    // Set up pull/push button handlers
    document.getElementById('pull-btn').onclick = pullChanges;
    document.getElementById('push-btn').onclick = pushChanges;

    // Load git status
    loadGitStatus();
}

// Set up auto-resize behavior for commit input
function setupCommitInput() {
    const input = document.getElementById('commit-message');

    input.addEventListener('input', function() {
        // Reset height to calculate new height
        this.style.height = 'auto';

        // Set to scrollHeight, but respect min/max
        const newHeight = Math.min(Math.max(this.scrollHeight, 36), 120);
        this.style.height = newHeight + 'px';
    });
}

// Toggle accordion section (mutually exclusive)
function toggleGitSection(header) {
    const section = header.dataset.section;
    const content = document.getElementById(`${section}-content`);
    const isCollapsed = header.classList.contains('collapsed');

    // Collapse all sections first
    document.querySelectorAll('.git-section-header').forEach(h => {
        h.classList.add('collapsed');
        const contentId = `${h.dataset.section}-content`;
        document.getElementById(contentId).classList.add('collapsed');
    });

    // If it was collapsed, expand it. If it was expanded, leave it collapsed.
    if (isCollapsed) {
        header.classList.remove('collapsed');
        content.classList.remove('collapsed');
    }
}

// Load git status from bridge
function loadGitStatus() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Send git status command via WebSocket
    ws.send(JSON.stringify({ type: 'git_status' }));
}

// Parse git diff output
function parseDiff(diffText) {
    const lines = diffText.split('\n');
    const result = [];

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
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Split highlighted HTML by newlines while preserving span tags
function splitHighlightedHTML(html) {
    const lines = [];
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    let currentLine = '';
    let openTags = []; // Stack of open tag class names

    function walkNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
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
                    for (let className of openTags) {
                        currentLine += `<span class="${className}">`;
                    }
                }
                currentLine += escapeHtml(parts[i]);
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName.toLowerCase() === 'span') {
                const className = node.className;
                currentLine += `<span class="${className}">`;
                openTags.push(className);

                // Process children
                for (let child of node.childNodes) {
                    walkNode(child);
                }

                currentLine += '</span>';
                openTags.pop();
            } else {
                // Process children of non-span elements
                for (let child of node.childNodes) {
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
function highlightDiffLines(diffLines, filePath) {
    // Detect language from file extension
    const ext = filePath.split('.').pop().toLowerCase();
    const langMap = {
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
        highlightedContent: highlightedLines[index] || escapeHtml(line.content)
    }));
}

// Render file change item
function renderFileChange(file, staged = false) {
    const diffLines = parseDiff(file.diff);

    // Apply syntax highlighting
    const highlightedLines = highlightDiffLines(diffLines, file.path);

    const diffHtml = highlightedLines.map(line => {
        let content = line.highlightedContent;

        // Determine line class and whether to add prefix
        let lineClass;
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
function updateUnstagedChanges(files) {
    unstagedChanges = files;
    const container = document.getElementById('unstaged-content');
    const count = document.getElementById('unstaged-count');

    count.textContent = files.length;

    if (files.length === 0) {
        container.innerHTML = '<div class="git-empty">No unstaged changes</div>';
        return;
    }

    container.innerHTML = files.map(f => renderFileChange(f, false)).join('');

    // Attach event listeners
    container.querySelectorAll('.git-action-btn.stage').forEach(btn => {
        btn.addEventListener('click', () => stageFile(btn.dataset.file));
    });

    container.querySelectorAll('.git-action-btn.discard').forEach(btn => {
        btn.addEventListener('click', () => discardFile(btn, btn.dataset.file));
    });
}

// Update staged changes display
function updateStagedChanges(files) {
    stagedChanges = files;
    const container = document.getElementById('staged-content');
    const count = document.getElementById('staged-count');
    const commitBtn = document.getElementById('commit-btn');
    const messageInput = document.getElementById('commit-message');

    count.textContent = files.length;

    // Enable/disable based on both staged files and message presence
    const updateCommitButton = () => {
        const hasMessage = messageInput.value.trim().length > 0;
        const hasStaged = files.length > 0;
        commitBtn.disabled = !(hasMessage && hasStaged);
    };

    updateCommitButton();
    commitBtn.onclick = performCommit;

    // Listen to input changes to enable/disable button
    messageInput.oninput = updateCommitButton;

    if (files.length === 0) {
        container.innerHTML = '<div class="git-empty">No staged changes</div>';
        return;
    }

    container.innerHTML = files.map(f => renderFileChange(f, true)).join('');

    // Attach event listeners
    container.querySelectorAll('.git-action-btn.unstage').forEach(btn => {
        btn.addEventListener('click', () => unstageFile(btn.dataset.file));
    });
}

// Git actions
function stageFile(filePath) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'git_stage', file: filePath }));
}

function unstageFile(filePath) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'git_unstage', file: filePath }));
}

function discardFile(btn, filePath) {
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

function pullChanges() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const pullBtn = document.getElementById('pull-btn');
    pullBtn.disabled = true;
    pullBtn.textContent = 'Pulling...';

    ws.send(JSON.stringify({ type: 'git_pull' }));
}

function pushChanges() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const pushBtn = document.getElementById('push-btn');
    pushBtn.disabled = true;
    pushBtn.textContent = 'Pushing...';

    ws.send(JSON.stringify({ type: 'git_push' }));
}

// Handle Git messages from bridge
function handleGitMessage(msg) {
    if (msg.type === 'git_status') {
        updateUnstagedChanges(msg.unstaged || []);
        updateStagedChanges(msg.staged || []);
        // Refresh file list if we're on the code view to update unstaged highlighting
        if (document.getElementById('view-code').classList.contains('active') && currentPath) {
            listFiles(currentPath);
        }
    } else if (msg.type === 'git_stage_success' || msg.type === 'git_unstage_success' || msg.type === 'git_discard_success') {
        // Reload git status after action
        loadGitStatus();
    } else if (msg.type === 'git_commit_success') {
        const commitBtn = document.getElementById('commit-btn');
        const messageInput = document.getElementById('commit-message');

        // Re-enable button and clear message
        commitBtn.disabled = false;
        commitBtn.textContent = 'Commit';
        messageInput.value = '';

        // Refresh git status
        loadGitStatus();
    } else if (msg.type === 'git_pull_success') {
        const pullBtn = document.getElementById('pull-btn');
        pullBtn.disabled = false;
        pullBtn.textContent = 'Pull';

        // Refresh git status to show new changes
        loadGitStatus();
    } else if (msg.type === 'git_push_success') {
        const pushBtn = document.getElementById('push-btn');
        pushBtn.disabled = false;
        pushBtn.textContent = 'Push';

        // Refresh git status
        loadGitStatus();
    } else if (msg.type === 'git_error') {
        console.error('Git error:', msg.error);
        alert('Error: ' + msg.error);

        // Re-enable all buttons
        const commitBtn = document.getElementById('commit-btn');
        const pullBtn = document.getElementById('pull-btn');
        const pushBtn = document.getElementById('push-btn');

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

function updateStatus(status, message) {
    statusEl.className = status;
    statusEl.textContent = message;
}

function connect() {
    if (ws) {
        ws.close();
    }

    updateStatus('connecting', 'Connecting to terminal...');

    try {
        const wsUrl = getWebSocketURL();
        const hasExistingSession = localStorage.getItem(SESSION_KEY) !== null;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            const sessionId = localStorage.getItem(SESSION_KEY);
            updateStatus('connected', `Connected`);
            if (!sessionId) {
                term.clear();
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
                        lastPongTime = Date.now();
                    } else if (msg.type === 'terminal_data') {
                        // Route terminal data to correct terminal
                        // Decode base64 to bytes for proper UTF-8 handling
                        const data = base64ToBytes(msg.data);
                        if (msg.terminal === 'terminal') {
                            termShell.write(data);
                        } else {
                            term.write(data);
                        }
                    } else if (msg.type === 'session' && msg.id) {
                        console.log('Session ID:', msg.id);
                        localStorage.setItem(SESSION_KEY, msg.id);
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
            console.error('WebSocket error:', error);
            updateStatus('disconnected', 'Connection error');
        };

        ws.onclose = () => {
            stopHealthCheck();
            const delay = getReconnectDelay();
            reconnectAttempts++;
            updateStatus('disconnected', `Disconnected. Reconnecting in ${Math.round(delay/1000)}s...`);

            // Auto-reconnect with exponential backoff
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
            }
            reconnectTimeout = setTimeout(connect, delay);
        };

    } catch (error) {
        console.error('Connection error:', error);
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
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'terminal_data',
            terminal: 'llm',
            data: btoa(data)
        }));
    }
});

termShell.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'terminal_data',
            terminal: 'terminal',
            data: btoa(data)
        }));
    }
});

// View switching
function switchView(viewName) {
    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    // Show selected view
    document.getElementById(`view-${viewName}`).classList.add('active');
    document.querySelector(`[data-view="${viewName}"]`).classList.add('active');

    // Toggle keyboard toolbar visibility and adjust terminal height
    const keyboardToolbar = document.getElementById('keyboard-toolbar');
    const terminalContainer = document.getElementById('terminal-container');
    const terminalShellContainer = document.getElementById('terminal-shell-container');

    if (viewName === 'llm') {
        activeTerminal = 'llm';
        keyboardToolbar.classList.add('visible');
        handleViewportResize();  // Immediately recalculate toolbar position
        terminalContainer.style.bottom = '94px';
        setTimeout(() => {
            fitAddon.fit();
            sendTerminalSize('llm');
        }, 50);
    } else if (viewName === 'terminal') {
        activeTerminal = 'terminal';
        keyboardToolbar.classList.add('visible');
        handleViewportResize();  // Immediately recalculate toolbar position
        terminalShellContainer.style.bottom = '94px';
        setTimeout(() => {
            fitAddonShell.fit();
            sendTerminalSize('terminal');
        }, 50);
    } else {
        keyboardToolbar.classList.remove('visible');
        keyboardToolbar.style.bottom = '';  // Clear stale inline style
        terminalContainer.style.bottom = '50px';
        terminalShellContainer.style.bottom = '50px';
    }

    // Load files when switching to Code view
    if (viewName === 'code') {
        if (ws && ws.readyState === WebSocket.OPEN) {
            // Load git status so we can highlight files with unstaged changes
            loadGitStatus();
            if (!codeViewInitialized) {
                codeViewInitialized = true;
                listFiles(PROJECT_ROOT);
            }
        }
    }

    // Initialize Git view when switching to it
    if (viewName === 'git') {
        initGitView();
    }
}

// Nav button click handlers
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// Start connection
connect();

// Handle page visibility (reconnect when coming back to the page)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Page hidden - stop health checks to save battery on mobile
        stopHealthCheck();
    } else {
        // Page visible - check connection and reconnect if needed
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
            // Reset backoff when user returns to give quick reconnection
            reconnectAttempts = 0;
            connect();
        } else if (ws.readyState === WebSocket.OPEN) {
            // Connection still open - restart health monitoring
            startHealthCheck();
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
