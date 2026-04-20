package whatsapp

import (
	"encoding/json"
	"sync"

	"github.com/rs/zerolog/log"
)

// Event types for real-time updates
const (
	EventInstanceStatus     = "instance_status"
	EventMessageReceived    = "message_received"
	EventMessageSent        = "message_sent"
	EventConnectionLost     = "connection_lost"
	EventConnectionRestored = "connection_restored"
)

// Event represents a real-time event
type Event struct {
	Type      string      `json:"type"`
	Instance  string      `json:"instance,omitempty"`
	UserID    string      `json:"user_id,omitempty"`
	Workspace string      `json:"workspace,omitempty"`
	Payload   interface{} `json:"payload"`
}

// Hub manages WebSocket connections and broadcasts events
// It also provides methods to manage instance connections
type Hub struct {
	mu         sync.RWMutex
	rooms      map[string]map[*Client]bool // room ID -> clients
	broadcast  chan *Event
	register   chan *Client
	unregister chan *Client
	users      map[string]map[*Client]bool // user ID -> clients
	manager    *Manager
}

var globalHub *Hub

// NewHub creates a new event hub
func NewHub() *Hub {
	return &Hub{
		rooms:      make(map[string]map[*Client]bool),
		broadcast:  make(chan *Event, 4096),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		users:      make(map[string]map[*Client]bool),
		manager:    nil,
	}
}

// SetManager sets the manager for the hub
func (h *Hub) SetManager(m *Manager) {
	h.manager = m
}

// Client represents a WebSocket connection
type Client struct {
	hub    *Hub
	Conn   chan []byte
	userID string
	rooms  map[string]bool
}

func (c *Client) Send(data []byte) {
	select {
	case c.Conn <- data:
	default:
	}
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			if client.userID != "" {
				if h.users[client.userID] == nil {
					h.users[client.userID] = make(map[*Client]bool)
				}
				h.users[client.userID][client] = true
			}
			for room := range client.rooms {
				if h.rooms[room] == nil {
					h.rooms[room] = make(map[*Client]bool)
				}
				h.rooms[room][client] = true
			}
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if client.userID != "" {
				if clients, ok := h.users[client.userID]; ok {
					delete(clients, client)
					if len(clients) == 0 {
						delete(h.users, client.userID)
					}
				}
			}
			for room := range client.rooms {
				if clients, ok := h.rooms[room]; ok {
					delete(clients, client)
					if len(clients) == 0 {
						delete(h.rooms, room)
					}
				}
			}
			h.mu.Unlock()

		case event := <-h.broadcast:
			// Broadcast to all relevant clients
			h.mu.RLock()
			targets := make(map[*Client]bool)

			// If event has specific user, target that user
			if event.UserID != "" {
				if clients, ok := h.users[event.UserID]; ok {
					for c := range clients {
						targets[c] = true
					}
				}
			}

			// If event has workspace, target all users in that workspace
			if event.Workspace != "" {
				room := "workspace:" + event.Workspace
				if clients, ok := h.rooms[room]; ok {
					for c := range clients {
						targets[c] = true
					}
				}
			}

			// If event has instance, target all users with that instance
			if event.Instance != "" {
				room := "instance:" + event.Instance
				if clients, ok := h.rooms[room]; ok {
					for c := range clients {
						targets[c] = true
					}
				}
			}

			// If no specific target, broadcast to all
			if event.UserID == "" && event.Workspace == "" && event.Instance == "" {
				for _, clients := range h.users {
					for c := range clients {
						targets[c] = true
					}
				}
			}
			h.mu.RUnlock()

			data, _ := json.Marshal(event)
			for c := range targets {
				select {
				case c.Conn <- data:
				default:
				}
			}
		}
	}
}

// Subscribe connects a client to the hub
func (h *Hub) Subscribe(userID string) *Client {
	client := &Client{
		hub:    h,
		Conn:   make(chan []byte, 256),
		userID: userID,
		rooms:  make(map[string]bool),
	}
	h.register <- client
	return client
}

// Unsubscribe disconnects a client from the hub
func (h *Hub) Unsubscribe(client *Client) {
	h.unregister <- client
}

// JoinRoom adds client to a room
func (h *Hub) JoinRoom(client *Client, room string) {
	client.rooms[room] = true
	h.register <- client
}

// LeaveRoom removes client from a room
func (h *Hub) LeaveRoom(client *Client, room string) {
	delete(client.rooms, room)
	h.unregister <- client
}

// Broadcast sends an event to all relevant clients.
// Drops events silently when the buffer is saturated (e.g. during a
// whatsmeow history-sync burst) to avoid blocking the caller. High-value
// events (message.received etc.) are also persisted/dispatched via
// webhooks, so a dropped WS frame only affects live UI updates.
func (h *Hub) Broadcast(event *Event) {
	select {
	case h.broadcast <- event:
	default:
		log.Debug().Str("event_type", event.Type).Str("instance", event.Instance).
			Msg("broadcast channel full, dropping event")
	}
}

// BroadcastInstanceStatus sends instance status update to all users
func (h *Hub) BroadcastInstanceStatus(instanceID, status, phone string) {
	h.Broadcast(&Event{
		Type:     EventInstanceStatus,
		Instance: instanceID,
		Payload: map[string]string{
			"status": status,
			"phone":  phone,
		},
	})
}

// BroadcastMessage sends a message event
func (h *Hub) BroadcastMessage(instanceID, from, content string, isOutgoing bool) {
	eventType := EventMessageReceived
	if isOutgoing {
		eventType = EventMessageSent
	}
	h.Broadcast(&Event{
		Type:     eventType,
		Instance: instanceID,
		Payload: map[string]string{
			"from":    from,
			"content": content,
		},
	})
}

// StartHub starts the global hub
func StartHub() {
	globalHub = NewHub()
	go globalHub.run()
	log.Info().Msg("event hub started")
}

// GetHub returns the global hub
func GetHub() *Hub {
	return globalHub
}

// DisconnectInstance disconnects a specific instance
func (h *Hub) DisconnectInstance(instanceID string) {
	if h.manager != nil {
		h.manager.StopInstance(instanceID)
	}
}

// ReconnectInstance reconnects a specific instance
func (h *Hub) ReconnectInstance(instanceID string) {
	if h.manager != nil {
		h.manager.RefreshSettings(instanceID, nil)
	}
}
