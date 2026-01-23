package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"

	firebase "firebase.google.com/go"
	"firebase.google.com/go/messaging"
	"google.golang.org/api/option"
)

var (
	fcmTokens           = make(map[string]string) // sessionID -> FCM token
	fcmTokensMu         sync.RWMutex
	fcmServiceAccountPath = getEnv("FCM_SERVICE_ACCOUNT_PATH", "")
	fcmClient           *messaging.Client
	fcmInitOnce         sync.Once
)

// HookNotificationRequest is the request body from the sandbox hook script
type HookNotificationRequest struct {
	HookType string `json:"hookType"` // "notification", "stop", "permission_request"
	Title    string `json:"title"`
	Body     string `json:"body"`
}

// initFCM initializes the Firebase Admin SDK
func initFCM() error {
	var initErr error
	fcmInitOnce.Do(func() {
		if fcmServiceAccountPath == "" {
			log.Printf("[FCM] FCM_SERVICE_ACCOUNT_PATH not configured, push notifications disabled")
			return
		}

		opt := option.WithCredentialsFile(fcmServiceAccountPath)
		app, err := firebase.NewApp(context.Background(), nil, opt)
		if err != nil {
			log.Printf("[FCM] Failed to initialize Firebase app: %v", err)
			initErr = err
			return
		}

		client, err := app.Messaging(context.Background())
		if err != nil {
			log.Printf("[FCM] Failed to get messaging client: %v", err)
			initErr = err
			return
		}

		fcmClient = client
		log.Printf("[FCM] Firebase Admin SDK initialized successfully")
	})
	return initErr
}

// handleHookNotification receives hook events from the sandbox and sends FCM notifications
func handleHookNotification(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req HookNotificationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("[HOOK] Invalid hook notification request: %v", err)
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	log.Printf("[HOOK] Received %s hook: title=%q, body=%q", req.HookType, req.Title, req.Body)

	// Initialize FCM if needed
	if err := initFCM(); err != nil || fcmClient == nil {
		log.Printf("[HOOK] FCM not configured, skipping push notification")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","message":"fcm not configured"}`))
		return
	}

	// Send to all registered FCM tokens
	fcmTokensMu.RLock()
	tokens := make(map[string]string)
	for k, v := range fcmTokens {
		tokens[k] = v
	}
	fcmTokensMu.RUnlock()

	if len(tokens) == 0 {
		log.Printf("[HOOK] No FCM tokens registered, skipping push notification")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","message":"no tokens registered"}`))
		return
	}

	// Send notifications in background
	for sessionID, token := range tokens {
		go sendFCMNotification(sessionID, token, req.HookType, req.Title, req.Body)
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}

// sendFCMNotification sends a push notification via Firebase Cloud Messaging
func sendFCMNotification(sessionID, token, hookType, title, body string) {
	if fcmClient == nil {
		log.Printf("[FCM] FCM client not initialized for session %s", sessionID)
		return
	}

	message := &messaging.Message{
		Token: token,
		Data: map[string]string{
			"hookType": hookType,
			"title":    title,
			"body":     body,
		},
		Android: &messaging.AndroidConfig{
			Priority: "high",
		},
	}

	ctx := context.Background()
	response, err := fcmClient.Send(ctx, message)
	if err != nil {
		log.Printf("[FCM] Failed to send notification to session %s: %v", sessionID, err)
		return
	}

	log.Printf("[FCM] Sent notification to session %s (hook=%s, title=%q, messageId=%s)", sessionID, hookType, title, response)
}

// truncateToken returns the first 20 characters of a token for logging
func truncateToken(token string) string {
	if len(token) > 20 {
		return token[:20]
	}
	return token
}
