/**
 * Toast notification system.
 * Owns toast state and handles display/queuing.
 */

import { ToastItem } from '../types';

// ============================================================================
// State
// ============================================================================

let toastQueue: ToastItem[] = [];
let activeToast: HTMLElement | null = null;

// ============================================================================
// Operations
// ============================================================================

/**
 * Show a toast notification
 */
export function showToast(
    message: string,
    type: string = 'success',
    duration: number = 3000
): void {
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

/**
 * Hide a toast notification
 */
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
        const next = toastQueue.shift();
        if (next) {
            showToast(next.message, next.type, next.duration);
        }
    }, 300);
}

/**
 * Initialize toast click handler
 */
export function initToastHandlers(): void {
    document.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('toast')) {
            hideToast(e.target as HTMLElement);
        }
    });
}
