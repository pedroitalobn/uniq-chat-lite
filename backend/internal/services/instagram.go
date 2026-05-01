package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type InstagramService struct {
	db         *gorm.DB
	baseURL    string
	httpClient *http.Client
	mu         sync.RWMutex
	sessions   map[string]*InstagramSession
}

type InstagramSession struct {
	InstanceID  string
	Username    string
	Password    string
	DeviceID    string
	SessionData []byte
	LoggedIn    bool
	LastActive  time.Time
}

type InstagramUser struct {
	PK         int64  `json:"pk"`
	Username   string `json:"username"`
	FullName   string `json:"full_name"`
	ProfilePic string `json:"profile_pic_url"`
	IsPrivate  bool   `json:"is_private"`
	Followers  int    `json:"follower_count"`
	Following  int    `json:"following_count"`
}

type InboxResponse struct {
	Threads []Thread `json:"threads"`
}

type Thread struct {
	ThreadID int64                    `json:"thread_id"`
	Messages []ThreadMessage          `json:"messages"`
	Users    map[string]InstagramUser `json:"users"`
}

type ThreadMessage struct {
	MessageID int64  `json:"message_id"`
	UserID    int64  `json:"user_id"`
	Text      string `json:"text"`
	Timestamp int64  `json:"timestamp"`
	ItemType  string `json:"item_type"`
}

type SendDMResponse struct {
	MessageID int64  `json:"message_id"`
	ThreadID  int64  `json:"thread_id"`
	Status    string `json:"status"`
}

type LoginResponse struct {
	Username             string   `json:"username"`
	PK                   string   `json:"pk"`
	ProfilePic           string   `json:"profile_pic_url"`
	Session              []byte   `json:"session"`
	Status               string   `json:"status"`
	ChallengeType        string   `json:"challenge_type"`
	Options              []string `json:"options"`
	APIPath              string   `json:"api_path"`
	Message              string   `json:"message"`
	PhoneMask            string   `json:"phone_mask"`
	EmailMask            string   `json:"email_mask"`
	CanResend            bool     `json:"can_resend"`
	ExternalVerification bool     `json:"external_verification"`
}

type bridgeResponse struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data"`
	Error   string          `json:"error"`
}

// BridgeError wraps errors returned by the Instagram bridge (business errors from Instagram,
// e.g. wrong password). Distinct from connectivity errors so callers can return 422 vs 502.
type BridgeError struct{ Message string }

func (e *BridgeError) Error() string { return e.Message }

func NewInstagramService(db *gorm.DB) *InstagramService {
	baseURL := config.AppConfig.InstagramBaseURL
	if baseURL == "" {
		baseURL = "http://uniqchat-instagram-bridge:8091"
	}
	log.Info().Str("instagram_bridge_url", baseURL).Msg("initializing Instagram service")
	return &InstagramService{
		db:         db,
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 60 * time.Second},
		sessions:   make(map[string]*InstagramSession),
	}
}

func (s *InstagramService) doRequest(ctx context.Context, method, path string, payload interface{}, out interface{}) error {
	url := s.baseURL + path
	log.Debug().Str("method", method).Str("url", url).Msg("instagram bridge request")
	var body *bytes.Reader
	if payload == nil {
		body = bytes.NewReader(nil)
	} else {
		b, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("failed to marshal payload: %w", err)
		}
		log.Debug().Str("payload", string(b)).Msg("instagram bridge request body")
		body = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		log.Error().Err(err).Str("url", url).Msg("instagram bridge connection failed")
		return fmt.Errorf("instagram bridge unavailable: %w", err)
	}
	defer resp.Body.Close()

	log.Debug().Int("status", resp.StatusCode).Str("url", url).Msg("instagram bridge response status")
	var bridge bridgeResponse
	if err := json.NewDecoder(resp.Body).Decode(&bridge); err != nil {
		return fmt.Errorf("failed to decode bridge response: %w", err)
	}
	if !bridge.Success {
		if bridge.Error == "" {
			bridge.Error = "bridge request failed"
		}
		log.Warn().Str("error", bridge.Error).Str("url", url).Msg("instagram bridge error")
		return &BridgeError{Message: bridge.Error}
	}
	if out != nil && len(bridge.Data) > 0 {
		if err := json.Unmarshal(bridge.Data, out); err != nil {
			return fmt.Errorf("failed to decode bridge payload: %w", err)
		}
	}
	return nil
}

func (s *InstagramService) Login(ctx context.Context, instanceID, username, password, proxyURL string) (*LoginResponse, error) {
	session := &InstagramSession{
		InstanceID: instanceID,
		Username:   username,
		Password:   password,
		DeviceID:   generateDeviceID(username),
	}

	payload := map[string]interface{}{
		"instance_id": instanceID,
		"username":    username,
		"password":    password,
		"device":      session.DeviceID,
	}
	if proxyURL != "" {
		payload["proxy"] = proxyURL
	}

	var loginResp LoginResponse
	err := s.doRequest(ctx, http.MethodPost, "/instagram/login", payload, &loginResp)
	if err != nil {
		return nil, err
	}
	if loginResp.Status == "" {
		loginResp.Status = "connected"
	}

	session.LoggedIn = true
	session.SessionData = loginResp.Session
	s.mu.Lock()
	s.sessions[instanceID] = session
	s.mu.Unlock()

	log.Info().Str("username", username).Str("instance", instanceID).Msg("instagram logged in")
	return &loginResp, nil
}

func (s *InstagramService) Logout(ctx context.Context, instanceID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.sessions[instanceID]; !exists {
		return nil
	}

	_ = s.doRequest(ctx, http.MethodPost, "/instagram/logout", map[string]interface{}{"instance_id": instanceID}, nil)
	delete(s.sessions, instanceID)
	log.Info().Str("instance", instanceID).Msg("instagram logged out")
	return nil
}

func (s *InstagramService) SendDM(ctx context.Context, instanceID, recipient, message string) (*SendDMResponse, error) {
	session := s.getSession(instanceID)
	if session == nil || !session.LoggedIn {
		return nil, fmt.Errorf("not logged in")
	}

	var dmResp SendDMResponse
	err := s.doRequest(ctx, http.MethodPost, "/instagram/dm/send", map[string]interface{}{
		"instance_id": instanceID,
		"username":    session.Username,
		"recipient":   recipient,
		"message":     message,
	}, &dmResp)
	if err != nil {
		return nil, err
	}
	return &dmResp, nil
}

func (s *InstagramService) GetInbox(ctx context.Context, instanceID string) (*InboxResponse, error) {
	session := s.getSession(instanceID)
	if session == nil || !session.LoggedIn {
		return nil, fmt.Errorf("not logged in")
	}

	var inbox InboxResponse
	q := url.Values{}
	q.Set("instance_id", instanceID)
	q.Set("username", session.Username)
	err := s.doRequest(ctx, http.MethodGet, "/instagram/dm/read?"+q.Encode(), nil, &inbox)
	if err != nil {
		return nil, err
	}
	return &inbox, nil
}

func (s *InstagramService) GetProfile(ctx context.Context, instanceID, targetUsername string) (*InstagramUser, error) {
	session := s.getSession(instanceID)
	if session == nil || !session.LoggedIn {
		return nil, fmt.Errorf("not logged in")
	}

	var user InstagramUser
	q := url.Values{}
	q.Set("instance_id", instanceID)
	q.Set("username", session.Username)
	q.Set("target", targetUsername)
	err := s.doRequest(ctx, http.MethodGet, "/instagram/profile?"+q.Encode(), nil, &user)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *InstagramService) Follow(ctx context.Context, instanceID, targetUsername string) error {
	session := s.getSession(instanceID)
	if session == nil || !session.LoggedIn {
		return fmt.Errorf("not logged in")
	}
	return s.doRequest(ctx, http.MethodPost, "/instagram/follow", map[string]interface{}{
		"instance_id": instanceID,
		"username":    session.Username,
		"target":      targetUsername,
	}, nil)
}

func (s *InstagramService) Unfollow(ctx context.Context, instanceID, targetUsername string) error {
	session := s.getSession(instanceID)
	if session == nil || !session.LoggedIn {
		return fmt.Errorf("not logged in")
	}
	return s.doRequest(ctx, http.MethodPost, "/instagram/unfollow", map[string]interface{}{
		"instance_id": instanceID,
		"username":    session.Username,
		"target":      targetUsername,
	}, nil)
}

func (s *InstagramService) GetSession(instanceID string) *InstagramSession {
	s.mu.RLock()
	session := s.sessions[instanceID]
	s.mu.RUnlock()
	if session != nil {
		return session
	}

	var instance models.Instance
	if err := s.db.Select("instagram_username").Where("id = ?", instanceID).First(&instance).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			log.Warn().Err(err).Str("instance", instanceID).Msg("failed to load instagram instance")
		}
		return nil
	}

	if instance.InstagramUsername == "" {
		return nil
	}

	restored := &InstagramSession{
		InstanceID: instanceID,
		Username:   instance.InstagramUsername,
		LoggedIn:   true,
		LastActive: time.Now(),
	}

	s.mu.Lock()
	s.sessions[instanceID] = restored
	s.mu.Unlock()
	return restored
}

func (s *InstagramService) getSession(instanceID string) *InstagramSession {
	return s.GetSession(instanceID)
}

func (s *InstagramService) SaveSession(instanceID string, data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if session, exists := s.sessions[instanceID]; exists {
		session.SessionData = data
		session.LastActive = time.Now()
	}
	return nil
}

func (s *InstagramService) IsLoggedIn(instanceID string) bool {
	session := s.getSession(instanceID)
	return session != nil && session.LoggedIn
}

func (s *InstagramService) PublishPost(ctx context.Context, instanceID, imageURL, videoURL, caption string) (*PublishResponse, error) {
	session := s.getSession(instanceID)
	if session == nil || !session.LoggedIn {
		return nil, fmt.Errorf("not logged in")
	}

	var resp PublishResponse
	err := s.doRequest(ctx, http.MethodPost, "/instagram/post", map[string]interface{}{
		"instance_id": instanceID,
		"username":    session.Username,
		"image_url":   imageURL,
		"video_url":   videoURL,
		"caption":     caption,
	}, &resp)
	return &resp, err
}

func (s *InstagramService) UploadStory(ctx context.Context, instanceID, imageURL, videoURL, caption string) (*PublishResponse, error) {
	session := s.getSession(instanceID)
	if session == nil || !session.LoggedIn {
		return nil, fmt.Errorf("not logged in")
	}

	var resp PublishResponse
	err := s.doRequest(ctx, http.MethodPost, "/instagram/story", map[string]interface{}{
		"instance_id": instanceID,
		"username":    session.Username,
		"image_url":   imageURL,
		"video_url":   videoURL,
		"caption":     caption,
	}, &resp)
	return &resp, err
}

func (s *InstagramService) GetUserMedia(ctx context.Context, instanceID, username string) (*UserMediaResponse, error) {
	session := s.getSession(instanceID)
	if session == nil || !session.LoggedIn {
		return nil, fmt.Errorf("not logged in")
	}

	var resp UserMediaResponse
	err := s.doRequest(ctx, http.MethodGet, fmt.Sprintf("/instagram/media?instance_id=%s&username=%s", instanceID, username), nil, &resp)
	return &resp, err
}

func (s *InstagramService) LikeMedia(ctx context.Context, instanceID, mediaID string) error {
	session := s.getSession(instanceID)
	if session == nil || !session.LoggedIn {
		return fmt.Errorf("not logged in")
	}

	return s.doRequest(ctx, http.MethodPost, "/instagram/like", map[string]interface{}{
		"instance_id": instanceID,
		"username":    session.Username,
		"media_id":    mediaID,
	}, nil)
}

func (s *InstagramService) ChallengeVerify(ctx context.Context, instanceID, apiPath, code, method string) (map[string]interface{}, error) {
	session := s.getSession(instanceID)
	if session == nil {
		return nil, fmt.Errorf("not logged in")
	}

	var resp map[string]interface{}
	err := s.doRequest(ctx, http.MethodPost, "/instagram/challenge", map[string]interface{}{
		"instance_id": instanceID,
		"username":    session.Username,
		"api_path":    apiPath,
		"code":        code,
		"method":      method,
	}, &resp)
	return resp, err
}

func (s *InstagramService) ChallengeResend(ctx context.Context, instanceID, apiPath, method string) error {
	session := s.getSession(instanceID)
	if session == nil {
		return fmt.Errorf("not logged in")
	}

	return s.doRequest(ctx, http.MethodPost, "/instagram/challenge/resend", map[string]interface{}{
		"instance_id": instanceID,
		"username":    session.Username,
		"api_path":    apiPath,
		"method":      method,
	}, nil)
}

type PublishResponse struct {
	MediaID  string `json:"media_id"`
	MediaPK  string `json:"media_pk"`
	Code     string `json:"code"`
	Status   string `json:"status"`
	URL      string `json:"url,omitempty"`
}

type UserMediaResponse struct {
	Medias []MediaItem `json:"medias"`
}

type MediaItem struct {
	PK           string `json:"pk"`
	ID           string `json:"id"`
	Code         string `json:"code"`
	MediaType    int    `json:"media_type"`
	ThumbnailURL string `json:"thumbnail_url"`
	LikeCount    int    `json:"like_count"`
	CommentCount int    `json:"comment_count"`
	Caption      string `json:"caption"`
	TakenAt      string `json:"taken_at"`
}

type CommentResponse struct {
	CommentID string `json:"comment_id"`
	Text      string `json:"text"`
	Status    string `json:"status"`
}

type CommentsResponse struct {
	Comments []CommentItem `json:"comments"`
}

type CommentItem struct {
	PK        string          `json:"pk"`
	User      InstagramUser   `json:"user"`
	Text      string          `json:"text"`
	CreatedAt string          `json:"created_at"`
	LikeCount int             `json:"like_count"`
}

type SearchUsersResponse struct {
	Users []InstagramUser `json:"users"`
}

type HashtagResponse struct {
	Hashtag string      `json:"hashtag"`
	Medias  []MediaItem `json:"medias"`
}

type ThreadResponse struct {
	ThreadID string          `json:"thread_id"`
	Messages []ThreadMessage `json:"messages"`
}

func (s *InstagramService) Unlike(ctx context.Context, instanceID, mediaID string) error {
	session := s.getSession(instanceID)
	if session == nil || !session.LoggedIn {
		return fmt.Errorf("not logged in")
	}
	return s.doRequest(ctx, http.MethodPost, "/instagram/unlike", map[string]interface{}{
		"instance_id": instanceID,
		"username":    session.Username,
		"media_id":    mediaID,
	}, nil)
}

func (s *InstagramService) Comment(ctx context.Context, instanceID, mediaID, text string) (*CommentResponse, error) {
	session := s.getSession(instanceID)
	if session == nil || !session.LoggedIn {
		return nil, fmt.Errorf("not logged in")
	}
	var resp CommentResponse
	err := s.doRequest(ctx, http.MethodPost, "/instagram/comment", map[string]interface{}{
		"instance_id": instanceID,
		"username":    session.Username,
		"media_id":    mediaID,
		"text":        text,
	}, &resp)
	return &resp, err
}

func (s *InstagramService) GetComments(ctx context.Context, instanceID, mediaID string, amount int) (*CommentsResponse, error) {
	session := s.getSession(instanceID)
	if session == nil || !session.LoggedIn {
		return nil, fmt.Errorf("not logged in")
	}
	q := url.Values{}
	q.Set("instance_id", instanceID)
	q.Set("media_id", mediaID)
	q.Set("amount", fmt.Sprintf("%d", amount))
	var resp CommentsResponse
	err := s.doRequest(ctx, http.MethodGet, "/instagram/comments?"+q.Encode(), nil, &resp)
	return &resp, err
}

func (s *InstagramService) ReplyDM(ctx context.Context, instanceID, threadID, text string) error {
	session := s.getSession(instanceID)
	if session == nil || !session.LoggedIn {
		return fmt.Errorf("not logged in")
	}
	return s.doRequest(ctx, http.MethodPost, "/instagram/dm/reply", map[string]interface{}{
		"instance_id": instanceID,
		"thread_id":   threadID,
		"text":        text,
	}, nil)
}

func (s *InstagramService) GetThread(ctx context.Context, instanceID, threadID string) (*ThreadResponse, error) {
	session := s.getSession(instanceID)
	if session == nil || !session.LoggedIn {
		return nil, fmt.Errorf("not logged in")
	}
	q := url.Values{}
	q.Set("instance_id", instanceID)
	q.Set("thread_id", threadID)
	var resp ThreadResponse
	err := s.doRequest(ctx, http.MethodGet, "/instagram/dm/thread?"+q.Encode(), nil, &resp)
	return &resp, err
}

func (s *InstagramService) SearchUsers(ctx context.Context, instanceID, query string) (*SearchUsersResponse, error) {
	session := s.getSession(instanceID)
	if session == nil || !session.LoggedIn {
		return nil, fmt.Errorf("not logged in")
	}
	q := url.Values{}
	q.Set("instance_id", instanceID)
	q.Set("query", query)
	var resp SearchUsersResponse
	err := s.doRequest(ctx, http.MethodGet, "/instagram/search/users?"+q.Encode(), nil, &resp)
	return &resp, err
}

func (s *InstagramService) GetHashtag(ctx context.Context, instanceID, hashtag, tab string, amount int) (*HashtagResponse, error) {
	session := s.getSession(instanceID)
	if session == nil || !session.LoggedIn {
		return nil, fmt.Errorf("not logged in")
	}
	q := url.Values{}
	q.Set("instance_id", instanceID)
	q.Set("hashtag", hashtag)
	q.Set("tab", tab)
	q.Set("amount", fmt.Sprintf("%d", amount))
	var resp HashtagResponse
	err := s.doRequest(ctx, http.MethodGet, "/instagram/hashtag?"+q.Encode(), nil, &resp)
	return &resp, err
}

func generateDeviceID(username string) string {
	return fmt.Sprintf("android-%s", uuid.New().String()[:8])
}
