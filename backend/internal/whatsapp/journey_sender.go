package whatsapp

import (
	"fmt"

	"github.com/uniq-chat/backend/internal/senders"
)

// ManagerMessageSender adapta *Manager à interface senders.MessageSender
// para desacoplar o JourneyExecutor do whatsmeow.
type ManagerMessageSender struct {
	m *Manager
}

// NewManagerSender cria um novo adapter
func NewManagerSender(m *Manager) *ManagerMessageSender {
	return &ManagerMessageSender{m: m}
}

func (s *ManagerMessageSender) SendText(instanceID, jid, text string) error {
	c := s.m.GetInstance(instanceID)
	if c == nil {
		return fmt.Errorf("instance %s not running", instanceID)
	}
	_, err := c.SendTextMessage(jid, text)
	return err
}

func (s *ManagerMessageSender) SendButtons(instanceID, jid, text string, buttons []senders.Button) error {
	c := s.m.GetInstance(instanceID)
	if c == nil {
		return fmt.Errorf("instance %s not running", instanceID)
	}
	items := make([]ButtonItem, 0, len(buttons))
	for _, b := range buttons {
		items = append(items, ButtonItem{ID: b.ID, Text: b.Text})
	}
	_, err := c.SendButtonsMessage(jid, text, "", items)
	return err
}

func (s *ManagerMessageSender) SendList(instanceID, jid, text, buttonText string, sections []senders.ListSection) error {
	c := s.m.GetInstance(instanceID)
	if c == nil {
		return fmt.Errorf("instance %s not running", instanceID)
	}
	listSections := make([]ListSection, 0, len(sections))
	for _, sec := range sections {
		rows := make([]ListRow, 0, len(sec.Rows))
		for _, r := range sec.Rows {
			rows = append(rows, ListRow{ID: r.ID, Title: r.Title, Description: r.Description})
		}
		listSections = append(listSections, ListSection{Title: sec.Title, Rows: rows})
	}
	_, err := c.SendListMessage(jid, text, "", buttonText, "", listSections)
	return err
}

func (s *ManagerMessageSender) SendMedia(instanceID, jid, mediaType, url, caption string) error {
	c := s.m.GetInstance(instanceID)
	if c == nil {
		return fmt.Errorf("instance %s not running", instanceID)
	}
	// URL-based media send — fallback = texto com link enquanto o canal de mídia
	// completo não está disponível diretamente no InstanceClient.
	_, err := c.SendTextMessage(jid, fmt.Sprintf("%s\n%s", caption, url))
	return err
}
