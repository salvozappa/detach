package notify

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"

	webpush "github.com/SherClockHolmes/webpush-go"

	"detach.it/bridge/internal/config"
	"detach.it/bridge/internal/types"
)

// HookNotificationRequest is the request body from the sandbox hook script
type HookNotificationRequest struct {
	HookType string `json:"hookType"` // "notification", "stop", "permission_request"
	Title    string `json:"title"`
	Body     string `json:"body"`
}

// Service handles web push notifications
type Service struct {
	subscriptions     map[string]types.WebPushSubscription
	mu                sync.RWMutex
	subscriptionsFile string
	vapidPublicKey    string
	vapidPrivateKey   string
	vapidSubject      string
}

// NewService creates a new notification service
func NewService() *Service {
	return &Service{
		subscriptions:     make(map[string]types.WebPushSubscription),
		subscriptionsFile: config.GetEnv("WEB_PUSH_SUBSCRIPTIONS_FILE", "/app/data/web-push-subscriptions.json"),
		vapidPublicKey:    config.GetEnv("VAPID_PUBLIC_KEY", ""),
		vapidPrivateKey:   config.GetEnv("VAPID_PRIVATE_KEY", ""),
		vapidSubject:      config.GetEnv("VAPID_SUBJECT", "mailto:admin@detach.it"),
	}
}

// Init loads existing web push subscriptions from file
func (s *Service) Init() {
	if s.vapidPublicKey == "" || s.vapidPrivateKey == "" {
		log.Printf("[WebPush] VAPID keys not configured, web push notifications disabled")
		return
	}

	// Load existing subscriptions from file
	s.loadSubscriptions()
	log.Printf("[WebPush] Initialized with %d existing subscriptions", len(s.subscriptions))
}

// loadSubscriptions loads subscriptions from JSON file
func (s *Service) loadSubscriptions() {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.subscriptionsFile)
	if err != nil {
		if os.IsNotExist(err) {
			log.Printf("[WebPush] No existing subscriptions file, starting fresh")
			return
		}
		log.Printf("[WebPush] Error reading subscriptions file: %v", err)
		return
	}

	if err := json.Unmarshal(data, &s.subscriptions); err != nil {
		log.Printf("[WebPush] Error parsing subscriptions file: %v", err)
		return
	}
}

// saveSubscriptions saves subscriptions to JSON file
func (s *Service) saveSubscriptions() {
	s.mu.RLock()
	data, err := json.MarshalIndent(s.subscriptions, "", "  ")
	s.mu.RUnlock()

	if err != nil {
		log.Printf("[WebPush] Error marshaling subscriptions: %v", err)
		return
	}

	if err := os.WriteFile(s.subscriptionsFile, data, 0644); err != nil {
		log.Printf("[WebPush] Error writing subscriptions file: %v", err)
		return
	}
}

// RegisterSubscription stores a web push subscription for a session
func (s *Service) RegisterSubscription(sessionID string, subscription types.WebPushSubscription) {
	s.mu.Lock()
	s.subscriptions[sessionID] = subscription
	s.mu.Unlock()

	// Persist to file
	s.saveSubscriptions()
	log.Printf("[WebPush] Registered subscription for session %s", sessionID)
}

// HandleHookNotification receives hook events from the sandbox and sends push notifications
func (s *Service) HandleHookNotification(w http.ResponseWriter, r *http.Request) {
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

	// Send Web Push notifications (PWA)
	s.sendNotifications(req.HookType, req.Title, req.Body)

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}

// sendNotifications sends push notifications to all registered PWA subscribers
func (s *Service) sendNotifications(hookType, title, body string) {
	if s.vapidPublicKey == "" || s.vapidPrivateKey == "" {
		log.Printf("[WebPush] VAPID keys not configured, skipping web push notifications")
		return
	}

	// Get all registered subscriptions
	s.mu.RLock()
	subscriptions := make(map[string]types.WebPushSubscription)
	for k, v := range s.subscriptions {
		subscriptions[k] = v
	}
	s.mu.RUnlock()

	if len(subscriptions) == 0 {
		log.Printf("[WebPush] No web push subscriptions registered")
		return
	}

	// Send notifications in background
	for sessionID, subscription := range subscriptions {
		go s.sendNotification(sessionID, subscription, hookType, title, body)
	}
}

// sendNotification sends a push notification via Web Push protocol
func (s *Service) sendNotification(sessionID string, subscription types.WebPushSubscription, hookType, title, body string) {
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
	sub := &webpush.Subscription{
		Endpoint: subscription.Endpoint,
		Keys: webpush.Keys{
			P256dh: subscription.Keys.P256dh,
			Auth:   subscription.Keys.Auth,
		},
	}

	// Send the notification
	resp, err := webpush.SendNotification(payload, sub, &webpush.Options{
		Subscriber:      s.vapidSubject,
		VAPIDPublicKey:  s.vapidPublicKey,
		VAPIDPrivateKey: s.vapidPrivateKey,
		TTL:             60,
	})
	if err != nil {
		log.Printf("[WebPush] Failed to send notification to session %s: %v", sessionID, err)
		// Remove invalid subscriptions (410 Gone means subscription expired)
		if resp != nil && resp.StatusCode == 410 {
			s.mu.Lock()
			delete(s.subscriptions, sessionID)
			s.mu.Unlock()
			s.saveSubscriptions()
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
