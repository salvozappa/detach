package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"

	firebase "firebase.google.com/go"
	"firebase.google.com/go/messaging"
	webpush "github.com/SherClockHolmes/webpush-go"
	"google.golang.org/api/option"
)

var (
	// FCM (Android) token storage
	fcmTokens             = make(map[string]string) // sessionID -> FCM token
	fcmTokensMu           sync.RWMutex
	fcmServiceAccountPath = getEnv("FCM_SERVICE_ACCOUNT_PATH", "")
	fcmClient             *messaging.Client
	fcmInitOnce           sync.Once

	// Web Push (PWA) subscription storage
	webPushSubscriptions   = make(map[string]WebPushSubscription) // sessionID -> subscription
	webPushMu              sync.RWMutex
	webPushSubscriptionsFile = getEnv("WEB_PUSH_SUBSCRIPTIONS_FILE", "/app/data/web-push-subscriptions.json")
	vapidPublicKey         = getEnv("VAPID_PUBLIC_KEY", "")
	vapidPrivateKey        = getEnv("VAPID_PRIVATE_KEY", "")
	vapidSubject           = getEnv("VAPID_SUBJECT", "mailto:admin@detach.it")
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

// initWebPush loads existing web push subscriptions from file
func initWebPush() {
	if vapidPublicKey == "" || vapidPrivateKey == "" {
		log.Printf("[WebPush] VAPID keys not configured, web push notifications disabled")
		return
	}

	// Load existing subscriptions from file
	loadWebPushSubscriptions()
	log.Printf("[WebPush] Initialized with %d existing subscriptions", len(webPushSubscriptions))
}

// loadWebPushSubscriptions loads subscriptions from JSON file
func loadWebPushSubscriptions() {
	webPushMu.Lock()
	defer webPushMu.Unlock()

	data, err := os.ReadFile(webPushSubscriptionsFile)
	if err != nil {
		if os.IsNotExist(err) {
			log.Printf("[WebPush] No existing subscriptions file, starting fresh")
			return
		}
		log.Printf("[WebPush] Error reading subscriptions file: %v", err)
		return
	}

	if err := json.Unmarshal(data, &webPushSubscriptions); err != nil {
		log.Printf("[WebPush] Error parsing subscriptions file: %v", err)
		return
	}
}

// saveWebPushSubscriptions saves subscriptions to JSON file
func saveWebPushSubscriptions() {
	webPushMu.RLock()
	data, err := json.MarshalIndent(webPushSubscriptions, "", "  ")
	webPushMu.RUnlock()

	if err != nil {
		log.Printf("[WebPush] Error marshaling subscriptions: %v", err)
		return
	}

	if err := os.WriteFile(webPushSubscriptionsFile, data, 0644); err != nil {
		log.Printf("[WebPush] Error writing subscriptions file: %v", err)
		return
	}
}

// registerWebPushSubscription stores a web push subscription for a session
func registerWebPushSubscription(sessionID string, subscription WebPushSubscription) {
	webPushMu.Lock()
	webPushSubscriptions[sessionID] = subscription
	webPushMu.Unlock()

	// Persist to file
	saveWebPushSubscriptions()
	log.Printf("[WebPush] Registered subscription for session %s", sessionID)
}

// handleHookNotification receives hook events from the sandbox and sends push notifications
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

	// Send FCM notifications (Android)
	sendFCMNotifications(req.HookType, req.Title, req.Body)

	// Send Web Push notifications (PWA)
	sendWebPushNotifications(req.HookType, req.Title, req.Body)

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}

// sendFCMNotifications sends push notifications to all registered Android devices
func sendFCMNotifications(hookType, title, body string) {
	// Initialize FCM if needed
	if err := initFCM(); err != nil || fcmClient == nil {
		log.Printf("[FCM] FCM not configured, skipping Android notifications")
		return
	}

	// Get all registered FCM tokens
	fcmTokensMu.RLock()
	tokens := make(map[string]string)
	for k, v := range fcmTokens {
		tokens[k] = v
	}
	fcmTokensMu.RUnlock()

	if len(tokens) == 0 {
		log.Printf("[FCM] No FCM tokens registered")
		return
	}

	// Send notifications in background
	for sessionID, token := range tokens {
		go sendFCMNotification(sessionID, token, hookType, title, body)
	}
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

// sendWebPushNotifications sends push notifications to all registered PWA subscribers
func sendWebPushNotifications(hookType, title, body string) {
	if vapidPublicKey == "" || vapidPrivateKey == "" {
		log.Printf("[WebPush] VAPID keys not configured, skipping web push notifications")
		return
	}

	// Get all registered subscriptions
	webPushMu.RLock()
	subscriptions := make(map[string]WebPushSubscription)
	for k, v := range webPushSubscriptions {
		subscriptions[k] = v
	}
	webPushMu.RUnlock()

	if len(subscriptions) == 0 {
		log.Printf("[WebPush] No web push subscriptions registered")
		return
	}

	// Send notifications in background
	for sessionID, subscription := range subscriptions {
		go sendWebPushNotification(sessionID, subscription, hookType, title, body)
	}
}

// sendWebPushNotification sends a push notification via Web Push protocol
func sendWebPushNotification(sessionID string, subscription WebPushSubscription, hookType, title, body string) {
	// Create notification payload
	payload, err := json.Marshal(map[string]string{
		"hookType": hookType,
		"title":    title,
		"body":     body,
	})
	if err != nil {
		log.Printf("[WebPush] Error marshaling payload for session %s: %v", sessionID, err)
		return
	}

	// Create webpush subscription object
	s := &webpush.Subscription{
		Endpoint: subscription.Endpoint,
		Keys: webpush.Keys{
			P256dh: subscription.Keys.P256dh,
			Auth:   subscription.Keys.Auth,
		},
	}

	// Send the notification
	resp, err := webpush.SendNotification(payload, s, &webpush.Options{
		Subscriber:      vapidSubject,
		VAPIDPublicKey:  vapidPublicKey,
		VAPIDPrivateKey: vapidPrivateKey,
		TTL:             60,
	})
	if err != nil {
		log.Printf("[WebPush] Failed to send notification to session %s: %v", sessionID, err)
		// Remove invalid subscriptions (410 Gone means subscription expired)
		if resp != nil && resp.StatusCode == 410 {
			webPushMu.Lock()
			delete(webPushSubscriptions, sessionID)
			webPushMu.Unlock()
			saveWebPushSubscriptions()
			log.Printf("[WebPush] Removed expired subscription for session %s", sessionID)
		}
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		log.Printf("[WebPush] Sent notification to session %s (hook=%s, title=%q)", sessionID, hookType, title)
	} else {
		log.Printf("[WebPush] Unexpected response for session %s: %d", sessionID, resp.StatusCode)
	}
}

// truncateToken returns the first 20 characters of a token for logging
func truncateToken(token string) string {
	if len(token) > 20 {
		return token[:20]
	}
	return token
}
