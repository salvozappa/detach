/**
 * Terminal management for LLM and Shell terminals.
 * Handles xterm.js setup, keyboard toolbar, touch scrolling, and viewport resizing.
 * Owns all terminal-related state.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { debugLog } from '../utils';
import { sendMessage, isConnected } from '../connection';

// ============================================================================
// Terminal State
// ============================================================================

let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let webLinksAddon: WebLinksAddon | null = null;
let termShell: Terminal | null = null;
let fitAddonShell: FitAddon | null = null;
let webLinksAddonShell: WebLinksAddon | null = null;
let shellTerminalInitialized = false;
let activeTerminal: 'llm' | 'terminal' = 'llm';

// Internal getters/setters
function getTerm(): Terminal | null {
    return term;
}
function setTerm(t: Terminal): void {
    term = t;
}
function getFitAddon(): FitAddon | null {
    return fitAddon;
}
function setFitAddon(f: FitAddon): void {
    fitAddon = f;
}
function getTermShell(): Terminal | null {
    return termShell;
}
function setTermShell(t: Terminal): void {
    termShell = t;
}
function getFitAddonShell(): FitAddon | null {
    return fitAddonShell;
}
function setFitAddonShell(f: FitAddon): void {
    fitAddonShell = f;
}
function isShellTerminalInitialized(): boolean {
    return shellTerminalInitialized;
}
function setShellTerminalInitialized(v: boolean): void {
    shellTerminalInitialized = v;
}
function getActiveTerminal(): 'llm' | 'terminal' {
    return activeTerminal;
}
function setActiveTerminal(t: 'llm' | 'terminal'): void {
    activeTerminal = t;
}

// ============================================================================
// Link Handler
// ============================================================================

/**
 * Handle link clicks/taps in terminal
 * Opens URLs in a new browser tab
 */
function handleLinkActivation(event: MouseEvent, uri: string): void {
    event.preventDefault();
    debugLog('TERMINAL', 'info', 'Link activated', { uri });

    // Open in new tab with security headers
    window.open(uri, '_blank', 'noopener,noreferrer');
}

// ============================================================================
// Terminal Theme Configuration
// ============================================================================

const TERMINAL_THEME = {
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
};

const TERMINAL_OPTIONS = {
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: TERMINAL_THEME,
    allowTransparency: false,
    scrollback: 100000
};

// ============================================================================
// Terminal Initialization
// ============================================================================

/**
 * Initialize the LLM terminal
 */
export function initLLMTerminal(): void {
    const term = new Terminal(TERMINAL_OPTIONS);
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon(handleLinkActivation);

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    setTerm(term);
    setFitAddon(fitAddon);

    const terminalEl = document.getElementById('terminal');
    if (terminalEl) {
        term.open(terminalEl);
        fitAddon.fit();

        // Setup touch scroll for LLM terminal
        setupTouchScroll(term, terminalEl);
    }

    // Debug: Track terminal focus events
    term.textarea?.addEventListener('focus', () => {
        debugLog('TERMINAL', 'info', 'LLM terminal textarea focused');
    });
    term.textarea?.addEventListener('blur', () => {
        debugLog('TERMINAL', 'info', 'LLM terminal textarea blurred');
    });

    debugLog('TERMINAL', 'info', 'LLM terminal initialized', {
        rows: term.rows,
        cols: term.cols,
        hasTextarea: !!term.textarea,
        llmViewActive: document.getElementById('view-llm')?.classList.contains('active')
    });

    // Register onData handler for LLM terminal
    term.onData((data) => {
        debugLog('TERMINAL', 'info', 'term.onData (LLM) called', {
            dataLength: data.length,
            dataHex: Array.from(data).map(c => c.charCodeAt(0).toString(16)).join(' '),
            wsOpen: isConnected(),
            activeTerminal: getActiveTerminal()
        });
        sendMessage({
            type: 'terminal_data',
            terminal: 'llm',
            data: btoa(data)
        });
    });
}

/**
 * Lazy-initialize the shell terminal when Terminal view is first opened
 */
export function initShellTerminal(): void {
    if (isShellTerminalInitialized()) return;
    setShellTerminalInitialized(true);

    debugLog('TERMINAL', 'info', 'Lazy-initializing shell terminal (view is now visible)');

    const termShell = new Terminal(TERMINAL_OPTIONS);
    const fitAddonShell = new FitAddon();
    const webLinksAddonShell = new WebLinksAddon(handleLinkActivation);

    termShell.loadAddon(fitAddonShell);
    termShell.loadAddon(webLinksAddonShell);

    setTermShell(termShell);
    setFitAddonShell(fitAddonShell);

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
            wsOpen: isConnected(),
            activeTerminal: getActiveTerminal()
        });
        const sent = sendMessage({
            type: 'terminal_data',
            terminal: 'terminal',
            data: btoa(data)
        });
        if (sent) {
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

// ============================================================================
// Terminal Size Management
// ============================================================================

/**
 * Send terminal size to server
 */
export function sendTerminalSize(terminal: 'llm' | 'terminal'): void {
    const t = terminal === 'terminal' ? getTermShell() : getTerm();
    if (!t) return; // Terminal not initialized yet

    sendMessage({
        type: 'resize',
        terminal: terminal,
        rows: t.rows,
        cols: t.cols
    });
}

/**
 * Handle window resize
 */
export function handleWindowResize(): void {
    const fitAddon = getFitAddon();
    const fitAddonShell = getFitAddonShell();

    if (fitAddon) fitAddon.fit();
    if (fitAddonShell) fitAddonShell.fit();
    sendTerminalSize('llm');
    sendTerminalSize('terminal');
}

/**
 * Handle screen orientation change (mobile)
 */
export function handleOrientationChange(): void {
    setTimeout(() => {
        handleWindowResize();
    }, 100);
}

/**
 * Handle mobile keyboard open/close using visualViewport API
 */
export function handleViewportResize(): void {
    if (!window.visualViewport) return;

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

    // Only move keyboard toolbar if it's visible
    if (keyboardToolbar && keyboardToolbar.classList.contains('visible')) {
        keyboardToolbar.style.bottom = `${50 + offset}px`;
    }

    // Re-fit terminal to new dimensions
    const activeTerminal = getActiveTerminal();
    if (activeTerminal === 'llm') {
        const fitAddon = getFitAddon();
        if (fitAddon) fitAddon.fit();
        sendTerminalSize('llm');
    } else if (activeTerminal === 'terminal') {
        const fitAddonShell = getFitAddonShell();
        if (fitAddonShell) fitAddonShell.fit();
        sendTerminalSize('terminal');
    }
}

// ============================================================================
// Touch Scroll Support
// ============================================================================

/**
 * Custom touch scroll handler for mobile momentum scrolling
 * xterm.js doesn't support native momentum scrolling, so we implement it manually
 */
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
        } catch (e) { /* ignore */ }
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

// ============================================================================
// Keyboard Toolbar
// ============================================================================

/**
 * Handle keyboard action buttons (pgup/pgdn/scroll)
 */
function handleKeyboardAction(action: string): void {
    const activeTerminal = getActiveTerminal();
    const terminal = activeTerminal === 'terminal' ? getTermShell() : getTerm();
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
    const focusTrap = document.getElementById('focus-trap') as HTMLElement | null;
    if (focusTrap) {
        focusTrap.focus();
    }
}

/**
 * Get basic (unmodified) escape sequence for a key
 */
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

/**
 * Initialize keyboard toolbar event handlers
 */
export function initKeyboardToolbar(): void {
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
            if (sequence) {
                sendMessage({
                    type: 'terminal_data',
                    terminal: getActiveTerminal(),
                    data: btoa(sequence)
                });
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
}

/**
 * Setup viewport listeners for keyboard detection
 */
export function initViewportListeners(): void {
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleViewportResize);
        window.visualViewport.addEventListener('scroll', handleViewportResize);
        // Initial setup
        handleViewportResize();
    }

    window.addEventListener('resize', handleWindowResize);
    window.addEventListener('orientationchange', handleOrientationChange);
}

/**
 * Setup focus tracking for terminal textareas
 */
export function initFocusTracking(): void {
    document.addEventListener('focusin', (e) => {
        const term = getTerm();
        const termShell = getTermShell();
        const isTerminal = e.target === term?.textarea || e.target === termShell?.textarea;
        if (isTerminal) {
            debugLog('FOCUS', 'info', 'Terminal textarea focused');
        }
    }, true);
}

// ============================================================================
// Terminal Data Handler
// ============================================================================

/**
 * Handle incoming terminal data from WebSocket
 */
export function handleTerminalData(terminal: string, data: Uint8Array): void {
    if (terminal === 'terminal') {
        const termShell = getTermShell();
        if (termShell) {
            termShell.write(data);
        }
        // If termShell not initialized, data is lost but that's OK
        // since user hasn't opened Terminal view yet
    } else {
        const term = getTerm();
        if (term) {
            term.write(data);
        }
    }
}

// ============================================================================
// View Switching Support
// ============================================================================

/**
 * Update terminal view when switching to LLM view
 */
export function activateLLMView(): void {
    setActiveTerminal('llm');
    const keyboardToolbar = document.getElementById('keyboard-toolbar');
    const terminalContainerEl = document.getElementById('terminal-container');

    keyboardToolbar?.classList.add('visible');
    handleViewportResize();
    if (terminalContainerEl) terminalContainerEl.style.bottom = '94px';

    setTimeout(() => {
        const fitAddon = getFitAddon();
        if (fitAddon) fitAddon.fit();
        sendTerminalSize('llm');
    }, 50);
}

/**
 * Update terminal view when switching to Terminal view
 */
export function activateTerminalView(): void {
    setActiveTerminal('terminal');
    const keyboardToolbar = document.getElementById('keyboard-toolbar');
    const terminalShellContainer = document.getElementById('terminal-shell-container');

    keyboardToolbar?.classList.add('visible');
    handleViewportResize();
    if (terminalShellContainer) terminalShellContainer.style.bottom = '94px';

    // Lazy-initialize the shell terminal on first access
    initShellTerminal();

    setTimeout(() => {
        const fitAddonShell = getFitAddonShell();
        if (fitAddonShell) {
            fitAddonShell.fit();
            sendTerminalSize('terminal');
        }

        debugLog('TERMINAL', 'info', 'Terminal view ready after fit', {
            rows: getTermShell()?.rows,
            cols: getTermShell()?.cols
        });
    }, 50);
}

/**
 * Deactivate terminal-specific UI elements
 */
export function deactivateTerminalViews(): void {
    const keyboardToolbar = document.getElementById('keyboard-toolbar');
    const terminalContainerEl = document.getElementById('terminal-container');
    const terminalShellContainer = document.getElementById('terminal-shell-container');

    keyboardToolbar?.classList.remove('visible');
    if (keyboardToolbar) keyboardToolbar.style.bottom = '';
    if (terminalContainerEl) terminalContainerEl.style.bottom = '50px';
    if (terminalShellContainer) terminalShellContainer.style.bottom = '50px';
}

/**
 * Focus the LLM terminal
 */
export function focusLLMTerminal(): void {
    const term = getTerm();
    if (term) term.focus();
}

/**
 * Send text to the LLM terminal
 */
export function sendToLLMTerminal(text: string): void {
    sendMessage({
        type: 'terminal_data',
        terminal: 'llm',
        data: btoa(text)
    });
}
