/**
 * File navigation business logic: state management and operations.
 * Owns file browsing state and handles WebSocket messages.
 */

import { FileInfo, FileMessage, PROJECT_ROOT } from './types';
import { sendMessage } from './connection';

// ============================================================================
// State
// ============================================================================

let currentPath: string = PROJECT_ROOT;
let currentFilePath: string = '';
let initialized: boolean = false;

// ============================================================================
// Getters
// ============================================================================

export function getCurrentPath(): string {
    return currentPath;
}

export function getCurrentFilePath(): string {
    return currentFilePath;
}

export function isInitialized(): boolean {
    return initialized;
}

// ============================================================================
// Render Callbacks
// ============================================================================

type FileListCallback = (files: FileInfo[], path: string) => void;
type FileContentCallback = (content: string, filename: string) => void;
type DiffContentCallback = (diff: string, filename: string, hasDiff: boolean) => void;

let onFileList: FileListCallback | null = null;
let onFileContent: FileContentCallback | null = null;
let onDiffContent: DiffContentCallback | null = null;

/**
 * Register callback for file list updates
 */
export function onFileListChange(callback: FileListCallback): void {
    onFileList = callback;
}

/**
 * Register callback for file content
 */
export function onFileContentChange(callback: FileContentCallback): void {
    onFileContent = callback;
}

/**
 * Register callback for diff content
 */
export function onDiffContentChange(callback: DiffContentCallback): void {
    onDiffContent = callback;
}

// ============================================================================
// Operations
// ============================================================================

/**
 * Request file listing from server
 */
export function listFiles(path: string): void {
    sendMessage({ type: 'list_files', path });
}

/**
 * Request file content from server
 */
export function readFile(path: string): void {
    sendMessage({ type: 'read_file', path });
}

/**
 * Request file content with diff information
 */
export function readFileWithDiff(path: string): void {
    sendMessage({ type: 'read_file_with_diff', path });
}

/**
 * Navigate to a folder
 */
export function navigateTo(path: string): void {
    listFiles(path);
}

/**
 * Open a file for viewing
 */
export function openFile(path: string): void {
    currentFilePath = path;
    readFileWithDiff(path);
}

/**
 * Initialize files module (called on first code view activation)
 */
export function initialize(): void {
    if (initialized) return;
    initialized = true;
    listFiles(PROJECT_ROOT);
}

/**
 * Refresh current file list
 */
export function refresh(): void {
    if (currentPath) {
        listFiles(currentPath);
    }
}

/**
 * Reload current file if one is open
 */
export function reloadCurrentFile(): void {
    if (currentFilePath) {
        readFileWithDiff(currentFilePath);
    }
}

// ============================================================================
// Message Handler
// ============================================================================

/**
 * Handle file-related messages from WebSocket
 */
export function handleFileMessage(msg: FileMessage): void {
    if (msg.type === 'file_list') {
        if (msg.error) {
            console.error('File list error:', msg.error);
            return;
        }
        currentPath = msg.path;
        if (onFileList) {
            onFileList(msg.files || [], msg.path);
        }
    } else if (msg.type === 'file_content') {
        if (msg.error) {
            console.error('File read error:', msg.error);
            return;
        }
        const filename = msg.path.split('/').pop() || '';
        if (onFileContent) {
            onFileContent(msg.content, filename);
        }
    } else if (msg.type === 'file_with_diff') {
        if (msg.error) {
            console.error('File read error:', msg.error);
            return;
        }
        const filename = msg.path.split('/').pop() || '';
        if (onDiffContent) {
            onDiffContent(msg.diff, filename, msg.hasDiff);
        }
    }
}
