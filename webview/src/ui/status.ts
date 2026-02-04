/**
 * Connection status display module.
 */

/**
 * Update the connection status display
 */
export function updateStatus(status: string, message: string): void {
  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.className = status;
    statusEl.textContent = message;
  }
}
