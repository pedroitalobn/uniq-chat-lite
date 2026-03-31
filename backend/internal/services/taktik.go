package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/config"
	"gorm.io/gorm"
)

// TaktikService communicates with the taktik-bot Python wrapper service.
type TaktikService struct {
	baseURL    string
	httpClient *http.Client
	db         *gorm.DB
}

func NewTaktikService(db *gorm.DB) *TaktikService {
	baseURL := config.AppConfig.TaktikBaseURL
	if baseURL == "" {
		baseURL = "http://localhost:8090"
	}
	return &TaktikService{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 120 * time.Second,
		},
		db: db,
	}
}

// ─── Generic request helpers ──────────────────────────────────────────

type taktikResponse struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data,omitempty"`
	Error   string          `json:"error,omitempty"`
}

func (t *TaktikService) post(endpoint string, payload interface{}) (*taktikResponse, error) {
	body, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", t.baseURL+endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("taktik unavailable: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	var tr taktikResponse
	json.Unmarshal(respBody, &tr)

	if !tr.Success {
		return &tr, fmt.Errorf("taktik error: %s", tr.Error)
	}
	return &tr, nil
}

func (t *TaktikService) get(endpoint string) (*taktikResponse, error) {
	req, err := http.NewRequest("GET", t.baseURL+endpoint, nil)
	if err != nil {
		return nil, err
	}

	resp, err := t.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("taktik unavailable: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	var tr taktikResponse
	json.Unmarshal(respBody, &tr)
	return &tr, nil
}

// ─── Instagram: DM ────────────────────────────────────────────────────

func (t *TaktikService) InstagramSendDM(accountUsername, targetUsername, message string) (map[string]interface{}, error) {
	tr, err := t.post("/instagram/dm/send", map[string]interface{}{
		"account": accountUsername,
		"target":  targetUsername,
		"message": message,
	})
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	json.Unmarshal(tr.Data, &result)
	return result, nil
}

func (t *TaktikService) InstagramReadDMs(accountUsername string, limit int) ([]map[string]interface{}, error) {
	if limit <= 0 {
		limit = 20
	}
	tr, err := t.get(fmt.Sprintf("/instagram/dm/read?account=%s&limit=%d", accountUsername, limit))
	if err != nil {
		return nil, err
	}
	var result []map[string]interface{}
	json.Unmarshal(tr.Data, &result)
	return result, nil
}

// ─── Instagram: Follow / Unfollow ─────────────────────────────────────

func (t *TaktikService) InstagramFollow(accountUsername, targetUsername string) (map[string]interface{}, error) {
	tr, err := t.post("/instagram/follow", map[string]interface{}{
		"account": accountUsername,
		"target":  targetUsername,
	})
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	json.Unmarshal(tr.Data, &result)
	return result, nil
}

func (t *TaktikService) InstagramUnfollow(accountUsername, targetUsername string) (map[string]interface{}, error) {
	tr, err := t.post("/instagram/unfollow", map[string]interface{}{
		"account": accountUsername,
		"target":  targetUsername,
	})
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	json.Unmarshal(tr.Data, &result)
	return result, nil
}

// ─── Instagram: Scraping ──────────────────────────────────────────────

func (t *TaktikService) InstagramScrapeFollowers(accountUsername, targetUsername string, limit int) ([]map[string]interface{}, error) {
	if limit <= 0 {
		limit = 100
	}
	tr, err := t.post("/instagram/scrape/followers", map[string]interface{}{
		"account": accountUsername,
		"target":  targetUsername,
		"limit":   limit,
	})
	if err != nil {
		return nil, err
	}
	var result []map[string]interface{}
	json.Unmarshal(tr.Data, &result)
	return result, nil
}

func (t *TaktikService) InstagramScrapeHashtag(accountUsername, hashtag string, limit int) ([]map[string]interface{}, error) {
	if limit <= 0 {
		limit = 100
	}
	tr, err := t.post("/instagram/scrape/hashtag", map[string]interface{}{
		"account": accountUsername,
		"hashtag": hashtag,
		"limit":   limit,
	})
	if err != nil {
		return nil, err
	}
	var result []map[string]interface{}
	json.Unmarshal(tr.Data, &result)
	return result, nil
}

func (t *TaktikService) InstagramScrapePostLikers(accountUsername, postURL string, limit int) ([]map[string]interface{}, error) {
	if limit <= 0 {
		limit = 100
	}
	tr, err := t.post("/instagram/scrape/post-likers", map[string]interface{}{
		"account":  accountUsername,
		"post_url": postURL,
		"limit":    limit,
	})
	if err != nil {
		return nil, err
	}
	var result []map[string]interface{}
	json.Unmarshal(tr.Data, &result)
	return result, nil
}

// ─── Instagram: Profile ───────────────────────────────────────────────

func (t *TaktikService) InstagramGetProfile(accountUsername, targetUsername string) (map[string]interface{}, error) {
	tr, err := t.get(fmt.Sprintf("/instagram/profile?account=%s&target=%s", accountUsername, targetUsername))
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	json.Unmarshal(tr.Data, &result)
	return result, nil
}

func (t *TaktikService) InstagramGetFollowers(accountUsername string, limit int) ([]map[string]interface{}, error) {
	if limit <= 0 {
		limit = 100
	}
	tr, err := t.get(fmt.Sprintf("/instagram/followers?account=%s&limit=%d", accountUsername, limit))
	if err != nil {
		return nil, err
	}
	var result []map[string]interface{}
	json.Unmarshal(tr.Data, &result)
	return result, nil
}

// ─── Instagram: Content ───────────────────────────────────────────────

func (t *TaktikService) InstagramPublishPost(accountUsername, imagePath, caption string) (map[string]interface{}, error) {
	tr, err := t.post("/instagram/post", map[string]interface{}{
		"account": accountUsername,
		"image":   imagePath,
		"caption": caption,
	})
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	json.Unmarshal(tr.Data, &result)
	return result, nil
}

func (t *TaktikService) InstagramPublishStory(accountUsername, imagePath string) (map[string]interface{}, error) {
	tr, err := t.post("/instagram/story", map[string]interface{}{
		"account": accountUsername,
		"image":   imagePath,
	})
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	json.Unmarshal(tr.Data, &result)
	return result, nil
}

// ─── TikTok: DM ───────────────────────────────────────────────────────

func (t *TaktikService) TikTokSendDM(accountUsername, targetUsername, message string) (map[string]interface{}, error) {
	tr, err := t.post("/tiktok/dm/send", map[string]interface{}{
		"account": accountUsername,
		"target":  targetUsername,
		"message": message,
	})
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	json.Unmarshal(tr.Data, &result)
	return result, nil
}

func (t *TaktikService) TikTokReadDMs(accountUsername string, limit int) ([]map[string]interface{}, error) {
	if limit <= 0 {
		limit = 20
	}
	tr, err := t.get(fmt.Sprintf("/tiktok/dm/read?account=%s&limit=%d", accountUsername, limit))
	if err != nil {
		return nil, err
	}
	var result []map[string]interface{}
	json.Unmarshal(tr.Data, &result)
	return result, nil
}

// ─── TikTok: Follow / Unfollow ────────────────────────────────────────

func (t *TaktikService) TikTokFollow(accountUsername, targetUsername string) (map[string]interface{}, error) {
	tr, err := t.post("/tiktok/follow", map[string]interface{}{
		"account": accountUsername,
		"target":  targetUsername,
	})
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	json.Unmarshal(tr.Data, &result)
	return result, nil
}

func (t *TaktikService) TikTokUnfollow(accountUsername, targetUsername string) (map[string]interface{}, error) {
	tr, err := t.post("/tiktok/unfollow", map[string]interface{}{
		"account": accountUsername,
		"target":  targetUsername,
	})
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	json.Unmarshal(tr.Data, &result)
	return result, nil
}

// ─── TikTok: Scraping ─────────────────────────────────────────────────

func (t *TaktikService) TikTokScrapeFollowers(accountUsername, targetUsername string, limit int) ([]map[string]interface{}, error) {
	if limit <= 0 {
		limit = 100
	}
	tr, err := t.post("/tiktok/scrape/followers", map[string]interface{}{
		"account": accountUsername,
		"target":  targetUsername,
		"limit":   limit,
	})
	if err != nil {
		return nil, err
	}
	var result []map[string]interface{}
	json.Unmarshal(tr.Data, &result)
	return result, nil
}

func (t *TaktikService) TikTokScrapeHashtag(accountUsername, hashtag string, limit int) ([]map[string]interface{}, error) {
	if limit <= 0 {
		limit = 100
	}
	tr, err := t.post("/tiktok/scrape/hashtag", map[string]interface{}{
		"account": accountUsername,
		"hashtag": hashtag,
		"limit":   limit,
	})
	if err != nil {
		return nil, err
	}
	var result []map[string]interface{}
	json.Unmarshal(tr.Data, &result)
	return result, nil
}

// ─── Health Check ─────────────────────────────────────────────────────

func (t *TaktikService) HealthCheck() bool {
	tr, err := t.get("/health")
	if err != nil {
		log.Warn().Err(err).Msg("Taktik service unreachable")
		return false
	}
	return tr.Success
}

// ─── Save scraped targets to DB ───────────────────────────────────────

func (t *TaktikService) SaveScrapedTargets(userID uuid.UUID, platform, source, sourceValue string, rawTargets []map[string]interface{}) int {
	count := 0
	for _, raw := range rawTargets {
		username, _ := raw["username"].(string)
		if username == "" {
			continue
		}
		fullName, _ := raw["full_name"].(string)
		bio, _ := raw["bio"].(string)
		picURL, _ := raw["profile_pic_url"].(string)
		followers, _ := raw["followers"].(float64)
		following, _ := raw["following"].(float64)
		posts, _ := raw["posts"].(float64)
		isPrivate, _ := raw["is_private"].(bool)
		isVerified, _ := raw["is_verified"].(bool)

		target := map[string]interface{}{
			"user_id":         userID,
			"platform":        platform,
			"username":        username,
			"full_name":       fullName,
			"bio":             bio,
			"profile_pic_url": picURL,
			"followers":       int(followers),
			"following":       int(following),
			"posts":           int(posts),
			"is_private":      isPrivate,
			"is_verified":     isVerified,
			"source":          source,
			"scraped_from":    sourceValue,
			"scraped_at":      time.Now(),
			"created_at":      time.Now(),
			"updated_at":      time.Now(),
		}

		// Upsert by platform + username
		var existing struct{ ID uuid.UUID }
		if t.db.Table("social_targets").
			Select("id").
			Where("platform = ? AND username = ? AND user_id = ?", platform, username, userID).
			First(&existing).Error != nil {
			target["id"] = uuid.New()
			t.db.Table("social_targets").Create(&target)
			count++
		} else {
			t.db.Table("social_targets").Where("id = ?", existing.ID).Updates(target)
		}
	}
	return count
}
