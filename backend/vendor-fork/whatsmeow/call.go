// Copyright (c) 2021 Tulir Asokan
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

package whatsmeow

import (
	"context"
	"encoding/hex"
	"fmt"
	"strings"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"go.mau.fi/util/random"
	"google.golang.org/protobuf/proto"
)

func (cli *Client) handleCallEvent(ctx context.Context, node *waBinary.Node) {
	defer cli.maybeDeferredAck(ctx, node)()

	if len(node.GetChildren()) != 1 {
		cli.dispatchEvent(&events.UnknownCallEvent{Node: node})
		return
	}
	ag := node.AttrGetter()
	child := node.GetChildren()[0]
	cag := child.AttrGetter()
	basicMeta := types.BasicCallMeta{
		From:        ag.JID("from"),
		Timestamp:   ag.UnixTime("t"),
		CallCreator: cag.JID("call-creator"),
		CallID:      cag.String("call-id"),
		GroupJID:    cag.OptionalJIDOrEmpty("group-jid"),
	}
	if basicMeta.CallCreator.Server == types.HiddenUserServer {
		basicMeta.CallCreatorAlt = cag.OptionalJIDOrEmpty("caller_pn")
	} else {
		// This may not actually exist
		basicMeta.CallCreatorAlt = cag.OptionalJIDOrEmpty("caller_lid")
	}
	switch child.Tag {
	case "offer":
		cli.dispatchEvent(&events.CallOffer{
			BasicCallMeta: basicMeta,
			CallRemoteMeta: types.CallRemoteMeta{
				RemotePlatform: ag.String("platform"),
				RemoteVersion:  ag.String("version"),
			},
			Data: &child,
		})
	case "offer_notice":
		cli.dispatchEvent(&events.CallOfferNotice{
			BasicCallMeta: basicMeta,
			Media:         cag.String("media"),
			Type:          cag.String("type"),
			Data:          &child,
		})
	case "relaylatency":
		cli.dispatchEvent(&events.CallRelayLatency{
			BasicCallMeta: basicMeta,
			Data:          &child,
		})
	case "accept":
		cli.dispatchEvent(&events.CallAccept{
			BasicCallMeta: basicMeta,
			CallRemoteMeta: types.CallRemoteMeta{
				RemotePlatform: ag.String("platform"),
				RemoteVersion:  ag.String("version"),
			},
			Data: &child,
		})
	case "preaccept":
		cli.dispatchEvent(&events.CallPreAccept{
			BasicCallMeta: basicMeta,
			CallRemoteMeta: types.CallRemoteMeta{
				RemotePlatform: ag.String("platform"),
				RemoteVersion:  ag.String("version"),
			},
			Data: &child,
		})
	case "transport":
		cli.dispatchEvent(&events.CallTransport{
			BasicCallMeta: basicMeta,
			CallRemoteMeta: types.CallRemoteMeta{
				RemotePlatform: ag.String("platform"),
				RemoteVersion:  ag.String("version"),
			},
			Data: &child,
		})
	case "terminate":
		cli.dispatchEvent(&events.CallTerminate{
			BasicCallMeta: basicMeta,
			Reason:        cag.String("reason"),
			Data:          &child,
		})
	case "reject":
		cli.dispatchEvent(&events.CallReject{
			BasicCallMeta: basicMeta,
			Data:          &child,
		})
	default:
		cli.dispatchEvent(&events.UnknownCallEvent{Node: node})
	}
}

// OfferCall initiates a voice (or video) call to the given JID.
// The call is signaled via the WhatsApp binary protocol; actual audio is
// exchanged directly between devices (WebRTC/SRTP) — the server only carries
// the signaling.
func (cli *Client) OfferCall(ctx context.Context, callTo types.JID, video bool) error {
	ownID := cli.getOwnID()
	if ownID.IsEmpty() {
		return ErrNotLoggedIn
	}

	callID := strings.ToUpper(hex.EncodeToString(random.Bytes(16)))

	// Wrap a random 32-byte call key in a Call proto message and encrypt it
	// for the recipient devices (same E2E path as regular messages).
	callMsg := &waE2E.Message{Call: &waE2E.Call{CallKey: random.Bytes(32)}}
	plaintext, err := proto.Marshal(callMsg)
	if err != nil {
		return fmt.Errorf("failed to marshal call message: %w", err)
	}
	// DSM (device-sent message) copy for own devices
	dsmPlaintext, err := proto.Marshal(&waE2E.Message{
		DeviceSentMessage: &waE2E.DeviceSentMessage{
			DestinationJID: proto.String(callTo.String()),
			Message:        callMsg,
		},
	})
	if err != nil {
		return fmt.Errorf("failed to marshal DSM: %w", err)
	}

	destinationNodes, includeIdentity, err := cli.encryptMessageForDevices(
		ctx,
		[]types.JID{ownID, callTo},
		callID,
		plaintext,
		dsmPlaintext,
		nil,
	)
	if err != nil {
		return fmt.Errorf("failed to encrypt call offer: %w", err)
	}

	offerContent := []waBinary.Node{
		{Tag: "audio", Attrs: waBinary.Attrs{"enc": "opus", "rate": "16000"}},
		{Tag: "audio", Attrs: waBinary.Attrs{"enc": "opus", "rate": "8000"}},
	}
	if video {
		offerContent = append(offerContent, waBinary.Node{
			Tag: "video",
			Attrs: waBinary.Attrs{
				"orientation": "0", "screen_width": "1080", "screen_height": "2340",
				"device_orientation": "0", "enc": "vp8", "dec": "vp8",
			},
		})
	}
	offerContent = append(offerContent,
		waBinary.Node{Tag: "capability", Attrs: waBinary.Attrs{"ver": "1"}, Content: []byte{1, 4, 255, 131, 207, 4}},
		waBinary.Node{Tag: "destination", Content: destinationNodes},
		waBinary.Node{Tag: "encopt", Attrs: waBinary.Attrs{"keygen": "2"}},
		waBinary.Node{Tag: "net", Attrs: waBinary.Attrs{"medium": "3"}},
	)
	if includeIdentity {
		offerContent = append(offerContent, cli.makeDeviceIdentityNode())
	}

	return cli.sendNode(ctx, waBinary.Node{
		Tag:   "call",
		Attrs: waBinary.Attrs{"id": cli.GenerateMessageID(), "to": callTo},
		Content: []waBinary.Node{{
			Tag:     "offer",
			Attrs:   waBinary.Attrs{"call-id": callID, "call-creator": ownID},
			Content: offerContent,
		}},
	})
}

// RejectCall reject an incoming call.
func (cli *Client) RejectCall(ctx context.Context, callFrom types.JID, callID string) error {
	ownID := cli.getOwnID()
	if ownID.IsEmpty() {
		return ErrNotLoggedIn
	}
	ownID, callFrom = ownID.ToNonAD(), callFrom.ToNonAD()
	return cli.sendNode(ctx, waBinary.Node{
		Tag:   "call",
		Attrs: waBinary.Attrs{"id": cli.GenerateMessageID(), "from": ownID, "to": callFrom},
		Content: []waBinary.Node{{
			Tag:     "reject",
			Attrs:   waBinary.Attrs{"call-id": callID, "call-creator": callFrom, "count": "0"},
			Content: nil,
		}},
	})
}
