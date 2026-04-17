// Package senders defines the neutral interface used by the journey executor
// to deliver messages. Both whatsapp.Manager and services.JourneyExecutor
// depend on this package, avoiding the import cycle that would arise if
// either of them owned the interface.
package senders

// MessageSender é a interface usada pelo JourneyExecutor para enviar
// mensagens via qualquer canal (WhatsApp, Instagram, etc.).
type MessageSender interface {
	SendText(instanceID, jid, text string) error
	SendButtons(instanceID, jid, text string, buttons []Button) error
	SendList(instanceID, jid, text, buttonText string, sections []ListSection) error
	SendMedia(instanceID, jid, mediaType, url, caption string) error
}

type Button struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

type ListSection struct {
	Title string    `json:"title"`
	Rows  []ListRow `json:"rows"`
}

type ListRow struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
}
