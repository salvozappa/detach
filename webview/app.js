// Configuration - use same host as the page is served from
const WS_HOST = window.location.hostname || 'localhost';
const WS_PORT = '8081';

// Authentication - HARDCODED FOR NOW
const USERNAME = 'detach-dev';

const RECONNECT_DELAY = 3000; // 3 seconds

// Session persistence
const SESSION_KEY = 'detach_session_id';

// Code view state
const PROJECT_ROOT = '~/projects/sample';
let currentPath = PROJECT_ROOT;
let codeViewInitialized = false;

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

function renderFileList(files, path) {
    const fileList = document.getElementById('file-list');
    const currentPathEl = document.getElementById('current-path');

    currentPath = path;
    currentPathEl.textContent = path;

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

    // Sort: folders first, then files
    const sorted = [...files].sort((a, b) => {
        if (a.is_dir && !b.is_dir) return -1;
        if (!a.is_dir && b.is_dir) return 1;
        return a.name.localeCompare(b.name);
    });

    for (const file of sorted) {
        const icon = file.is_dir ? '📁' : '📄';
        const size = file.is_dir ? '' : formatFileSize(file.size);
        const fullPath = path + '/' + file.name;

        if (file.is_dir) {
            html += `
                <div class="file-item" onclick="navigateToFolder('${fullPath}')">
                    <span class="file-icon">${icon}</span>
                    <span class="file-name">${file.name}</span>
                </div>
            `;
        } else {
            html += `
                <div class="file-item" onclick="openFile('${fullPath}', '${file.name}')">
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
    readFile(path);
}

function showCodeViewer(content, filename) {
    const codeEl = document.getElementById('code-content');
    codeEl.textContent = content;

    // Auto-detect language and highlight
    delete codeEl.dataset.highlighted;
    hljs.highlightElement(codeEl);

    // Switch panels
    document.getElementById('file-explorer-panel').classList.remove('active');
    document.getElementById('code-viewer-panel').classList.add('active');
}

function showFileExplorer() {
    document.getElementById('code-viewer-panel').classList.remove('active');
    document.getElementById('file-explorer-panel').classList.add('active');
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
    }
}

function getWebSocketURL() {
    const params = new URLSearchParams({ user: USERNAME });
    const sessionId = localStorage.getItem(SESSION_KEY);
    if (sessionId) {
        params.set('session', sessionId);
    }
    return `ws://${WS_HOST}:${WS_PORT}?${params.toString()}`;
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

// WebSocket connection (declared early for use in resize handlers)
let ws = null;
let reconnectTimeout = null;

// Send terminal size to server
function sendTerminalSize() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const resizeMessage = JSON.stringify({
            type: 'resize',
            rows: term.rows,
            cols: term.cols
        });
        ws.send(resizeMessage);
    }
}

// Handle window resize
window.addEventListener('resize', () => {
    fitAddon.fit();
    sendTerminalSize();
});

// Handle screen orientation change (mobile)
window.addEventListener('orientationchange', () => {
    setTimeout(() => {
        fitAddon.fit();
        sendTerminalSize();
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
        fitAddon.fit();
        sendTerminalSize();
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
        let sequence = '';

        switch(key) {
            case 'up': sequence = '\x1b[A'; break;
            case 'down': sequence = '\x1b[B'; break;
            case 'right': sequence = '\x1b[C'; break;
            case 'left': sequence = '\x1b[D'; break;
            case 'esc': sequence = '\x1b'; break;
            case 'enter': sequence = '\r'; break;
        }

        if (ws && ws.readyState === WebSocket.OPEN && sequence) {
            ws.send(sequence);
        }
    });
});

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

    // Load git status
    loadGitStatus();
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

        // Add prefix for added/removed lines
        if (line.type === 'added' || line.type === 'removed') {
            const prefix = line.type === 'added' ? '+' : '-';
            content = `<span class="diff-prefix">${prefix}</span>${content}`;
        }

        return `<div class="git-diff-line ${line.type}">${content}</div>`;
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

    count.textContent = files.length;
    commitBtn.disabled = files.length === 0;

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

// Handle Git messages from bridge
function handleGitMessage(msg) {
    if (msg.type === 'git_status') {
        updateUnstagedChanges(msg.unstaged || []);
        updateStagedChanges(msg.staged || []);
    } else if (msg.type === 'git_stage_success' || msg.type === 'git_unstage_success' || msg.type === 'git_discard_success') {
        // Reload git status after action
        loadGitStatus();
    } else if (msg.type === 'git_error') {
        console.error('Git error:', msg.error);
        // TODO: Show error to user
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
            if (sessionId) {
                updateStatus('connected', `Reconnected to session`);
            } else {
                updateStatus('connected', `Connected to ${WS_HOST}:${WS_PORT}`);
                term.clear();
            }

            // Send initial terminal size
            sendTerminalSize();

            // Auto-hide status after 2 seconds when connected
            setTimeout(() => {
                statusEl.style.opacity = '0.7';
            }, 2000);
        };

        ws.onmessage = (event) => {
            // Handle text messages (session ID, file ops) vs binary (terminal output)
            if (typeof event.data === 'string') {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'session' && msg.id) {
                        console.log('Session ID:', msg.id);
                        localStorage.setItem(SESSION_KEY, msg.id);
                    } else if (msg.type === 'file_list' || msg.type === 'file_content') {
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
            updateStatus('disconnected', `Disconnected. Reconnecting in ${RECONNECT_DELAY/1000}s...`);
            statusEl.style.opacity = '1';

            // Auto-reconnect
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
            }
            reconnectTimeout = setTimeout(connect, RECONNECT_DELAY);
        };

    } catch (error) {
        console.error('Connection error:', error);
        updateStatus('disconnected', `Failed to connect: ${error.message}`);

        // Retry connection
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
        }
        reconnectTimeout = setTimeout(connect, RECONNECT_DELAY);
    }
}

// Handle terminal input (registered once, uses current ws variable)
term.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
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

    if (viewName === 'llm') {
        keyboardToolbar.classList.add('visible');
        terminalContainer.style.bottom = '94px';
        setTimeout(() => {
            fitAddon.fit();
            sendTerminalSize();
        }, 50);
    } else {
        keyboardToolbar.classList.remove('visible');
        terminalContainer.style.bottom = '50px';
    }

    // Load files when switching to Code view
    if (viewName === 'code') {
        if (!codeViewInitialized && ws && ws.readyState === WebSocket.OPEN) {
            codeViewInitialized = true;
            listFiles(PROJECT_ROOT);
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
    if (!document.hidden && ws && ws.readyState !== WebSocket.OPEN) {
        connect();
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (ws) {
        ws.close();
    }
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }
});
