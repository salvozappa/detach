/**
 * Centralized state management for the application.
 * All mutable state is stored here with getters/setters for controlled access.
 */

import { WsState, WS_STATES, FileChange, PROJECT_ROOT } from "./types";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

// ============================================================================
// Connection State
// ============================================================================

let ws: WebSocket | null = null;
let wsState: WsState = WS_STATES.DISCONNECTED;
let currentSessionId: string | null = null;
let reconnectAttempts = 0;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let isConnecting = false;
let lastStateChange = Date.now();
let connectionStartTime: number | null = null;

// Health check
let lastPongTime = Date.now();
let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

// Correlation ID for tracking connection attempts
let connectionAttemptId = 0;
let currentCorrelationId: string | null = null;

export function getWs(): WebSocket | null {
  return ws;
}
export function setWs(newWs: WebSocket | null): void {
  ws = newWs;
}

export function getWsState(): WsState {
  return wsState;
}
export function setWsStateValue(state: WsState): void {
  wsState = state;
}

export function getCurrentSessionId(): string | null {
  return currentSessionId;
}
export function setCurrentSessionId(id: string | null): void {
  currentSessionId = id;
}

export function getReconnectAttempts(): number {
  return reconnectAttempts;
}
export function setReconnectAttempts(n: number): void {
  reconnectAttempts = n;
}
export function incrementReconnectAttempts(): void {
  reconnectAttempts++;
}

export function getReconnectTimeout(): ReturnType<typeof setTimeout> | null {
  return reconnectTimeout;
}
export function setReconnectTimeout(
  t: ReturnType<typeof setTimeout> | null,
): void {
  reconnectTimeout = t;
}

export function getIsConnecting(): boolean {
  return isConnecting;
}
export function setIsConnecting(v: boolean): void {
  isConnecting = v;
}

export function getLastStateChange(): number {
  return lastStateChange;
}
export function setLastStateChange(t: number): void {
  lastStateChange = t;
}

export function getConnectionStartTime(): number | null {
  return connectionStartTime;
}
export function setConnectionStartTime(t: number | null): void {
  connectionStartTime = t;
}

export function getLastPongTime(): number {
  return lastPongTime;
}
export function setLastPongTime(t: number): void {
  lastPongTime = t;
}

export function getHealthCheckInterval(): ReturnType<
  typeof setInterval
> | null {
  return healthCheckInterval;
}
export function setHealthCheckInterval(
  i: ReturnType<typeof setInterval> | null,
): void {
  healthCheckInterval = i;
}

export function getConnectionAttemptId(): number {
  return connectionAttemptId;
}
export function incrementConnectionAttemptId(): number {
  return ++connectionAttemptId;
}

export function getCurrentCorrelationId(): string | null {
  return currentCorrelationId;
}
export function setCurrentCorrelationId(id: string | null): void {
  currentCorrelationId = id;
}

// ============================================================================
// Terminal State
// ============================================================================

let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let termShell: Terminal | null = null;
let fitAddonShell: FitAddon | null = null;
let shellTerminalInitialized = false;
let activeTerminal: "llm" | "terminal" = "llm";

export function getTerm(): Terminal | null {
  return term;
}
export function setTerm(t: Terminal): void {
  term = t;
}

export function getFitAddon(): FitAddon | null {
  return fitAddon;
}
export function setFitAddon(f: FitAddon): void {
  fitAddon = f;
}

export function getTermShell(): Terminal | null {
  return termShell;
}
export function setTermShell(t: Terminal): void {
  termShell = t;
}

export function getFitAddonShell(): FitAddon | null {
  return fitAddonShell;
}
export function setFitAddonShell(f: FitAddon): void {
  fitAddonShell = f;
}

export function isShellTerminalInitialized(): boolean {
  return shellTerminalInitialized;
}
export function setShellTerminalInitialized(v: boolean): void {
  shellTerminalInitialized = v;
}

export function getActiveTerminal(): "llm" | "terminal" {
  return activeTerminal;
}
export function setActiveTerminal(t: "llm" | "terminal"): void {
  activeTerminal = t;
}

// ============================================================================
// Code View State
// ============================================================================

let currentPath = PROJECT_ROOT;
let currentFilePath = "";
let codeViewInitialized = false;

// Selection mode
let selectModeActive = false;
let selectedLines = new Set<number>();
let selectionPhase: "none" | "first" | "range" = "none";

export function getCurrentPath(): string {
  return currentPath;
}
export function setCurrentPath(p: string): void {
  currentPath = p;
}

export function getCurrentFilePath(): string {
  return currentFilePath;
}
export function setCurrentFilePath(p: string): void {
  currentFilePath = p;
}

export function isCodeViewInitialized(): boolean {
  return codeViewInitialized;
}
export function setCodeViewInitialized(v: boolean): void {
  codeViewInitialized = v;
}

export function isSelectModeActive(): boolean {
  return selectModeActive;
}
export function setSelectModeActive(v: boolean): void {
  selectModeActive = v;
}

export function getSelectedLines(): Set<number> {
  return selectedLines;
}
export function clearSelectedLines(): void {
  selectedLines.clear();
}
export function addSelectedLine(n: number): void {
  selectedLines.add(n);
}

export function getSelectionPhase(): "none" | "first" | "range" {
  return selectionPhase;
}
export function setSelectionPhase(p: "none" | "first" | "range"): void {
  selectionPhase = p;
}

// ============================================================================
// Git View State
// ============================================================================

let gitViewInitialized = false;
let unstagedChanges: FileChange[] = [];
let stagedChanges: FileChange[] = [];
let discardConfirmState: Record<string, number> = {};

export function isGitViewInitialized(): boolean {
  return gitViewInitialized;
}
export function setGitViewInitialized(v: boolean): void {
  gitViewInitialized = v;
}

export function getUnstagedChanges(): FileChange[] {
  return unstagedChanges;
}
export function setUnstagedChanges(changes: FileChange[]): void {
  unstagedChanges = changes;
}

export function getStagedChanges(): FileChange[] {
  return stagedChanges;
}
export function setStagedChanges(changes: FileChange[]): void {
  stagedChanges = changes;
}

export function getDiscardConfirmState(): Record<string, number> {
  return discardConfirmState;
}
export function setDiscardConfirmTime(file: string, time: number): void {
  discardConfirmState[file] = time;
}
export function clearDiscardConfirmState(file: string): void {
  delete discardConfirmState[file];
}

// ============================================================================
// Toast State
// ============================================================================

import type { ToastItem } from "./types";

let toastQueue: ToastItem[] = [];
let activeToast: HTMLElement | null = null;

export function getToastQueue(): ToastItem[] {
  return toastQueue;
}
export function addToastToQueue(item: ToastItem): void {
  toastQueue.push(item);
}
export function shiftToastFromQueue(): ToastItem | undefined {
  return toastQueue.shift();
}

export function getActiveToast(): HTMLElement | null {
  return activeToast;
}
export function setActiveToast(el: HTMLElement | null): void {
  activeToast = el;
}

// ============================================================================
// Debug Logging State
// ============================================================================

import type { WsLogEntry } from "./types";

let debugLogQueue: WsLogEntry[] = [];
let debugLogWsReady = false;

export function getDebugLogQueue(): WsLogEntry[] {
  return debugLogQueue;
}
export function pushDebugLog(entry: WsLogEntry): void {
  debugLogQueue.push(entry);
}
export function shiftDebugLog(): WsLogEntry | undefined {
  return debugLogQueue.shift();
}

export function isDebugLogWsReady(): boolean {
  return debugLogWsReady;
}
export function setDebugLogWsReady(v: boolean): void {
  debugLogWsReady = v;
}
