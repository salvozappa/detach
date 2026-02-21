package types

import (
	"encoding/json"
	"testing"
)

func TestWSMessage_UnmarshalJSON_ValidMessage(t *testing.T) {
	input := `{"type":"terminal_data","terminal":"agent","data":"SGVsbG8="}`
	var msg WSMessage
	err := json.Unmarshal([]byte(input), &msg)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if msg.Type != MsgTypeTerminalData {
		t.Errorf("expected type %q, got %q", MsgTypeTerminalData, msg.Type)
	}
}

func TestWSMessage_UnmarshalJSON_PreservesPayload(t *testing.T) {
	input := `{"type":"resize","terminal":"agent","rows":24,"cols":80}`
	var msg WSMessage
	err := json.Unmarshal([]byte(input), &msg)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if string(msg.Payload) != input {
		t.Errorf("payload not preserved\nexpected: %s\ngot: %s", input, string(msg.Payload))
	}
}

func TestWSMessage_UnmarshalJSON_InvalidJSON(t *testing.T) {
	input := `{not valid json}`
	var msg WSMessage
	err := json.Unmarshal([]byte(input), &msg)

	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
}

func TestWSMessage_UnmarshalJSON_MissingType(t *testing.T) {
	input := `{"data":"some data"}`
	var msg WSMessage
	err := json.Unmarshal([]byte(input), &msg)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if msg.Type != "" {
		t.Errorf("expected empty type, got %q", msg.Type)
	}
}

func TestWSMessage_UnmarshalJSON_AllMessageTypes(t *testing.T) {
	tests := []struct {
		name     string
		msgType  string
		constant string
	}{
		{"terminal_data", "terminal_data", MsgTypeTerminalData},
		{"resize", "resize", MsgTypeResize},
		{"list_files", "list_files", MsgTypeListFiles},
		{"read_file", "read_file", MsgTypeReadFile},
		{"read_file_with_diff", "read_file_with_diff", MsgTypeReadFileWithDiff},
		{"git_status", "git_status", MsgTypeGitStatus},
		{"git_stage", "git_stage", MsgTypeGitStage},
		{"git_unstage", "git_unstage", MsgTypeGitUnstage},
		{"git_stage_all", "git_stage_all", MsgTypeGitStageAll},
		{"git_unstage_all", "git_unstage_all", MsgTypeGitUnstageAll},
		{"git_discard", "git_discard", MsgTypeGitDiscard},
		{"git_commit", "git_commit", MsgTypeGitCommit},
		{"git_pull", "git_pull", MsgTypeGitPull},
		{"git_push", "git_push", MsgTypeGitPush},
		{"register_web_push", "register_web_push", MsgTypeRegisterWebPush},
		{"debug_log", "debug_log", MsgTypeDebugLog},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := `{"type":"` + tt.msgType + `"}`
			var msg WSMessage
			err := json.Unmarshal([]byte(input), &msg)

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if msg.Type != tt.constant {
				t.Errorf("expected type %q, got %q", tt.constant, msg.Type)
			}
		})
	}
}

func TestTerminalDataMessage_RoundTrip(t *testing.T) {
	// Verify TerminalDataMessage serializes/deserializes with "agent" terminal value
	original := TerminalDataMessage{
		Type:     "terminal_data",
		Terminal: "agent",
		Data:     "SGVsbG8=",
	}
	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}

	var decoded TerminalDataMessage
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	if decoded.Terminal != "agent" {
		t.Errorf("expected terminal 'agent', got %q", decoded.Terminal)
	}
	if decoded.Type != "terminal_data" {
		t.Errorf("expected type 'terminal_data', got %q", decoded.Type)
	}
	if decoded.Data != "SGVsbG8=" {
		t.Errorf("expected data 'SGVsbG8=', got %q", decoded.Data)
	}
}

func TestResizeMessage_BothTerminalValues(t *testing.T) {
	tests := []struct {
		name     string
		terminal string
	}{
		{"agent", "agent"},
		{"terminal", "terminal"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := `{"type":"resize","terminal":"` + tt.terminal + `","rows":24,"cols":80}`
			var msg ResizeMessage
			if err := json.Unmarshal([]byte(input), &msg); err != nil {
				t.Fatalf("unmarshal error: %v", err)
			}
			if msg.Terminal != tt.terminal {
				t.Errorf("expected terminal %q, got %q", tt.terminal, msg.Terminal)
			}
		})
	}
}

func TestWSMessage_CanParsePayloadAfterUnmarshal(t *testing.T) {
	input := `{"type":"resize","terminal":"agent","rows":24,"cols":80}`
	var msg WSMessage
	err := json.Unmarshal([]byte(input), &msg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Now parse the payload into the specific message type
	var resize ResizeMessage
	err = json.Unmarshal(msg.Payload, &resize)
	if err != nil {
		t.Fatalf("failed to parse payload: %v", err)
	}

	if resize.Terminal != "agent" {
		t.Errorf("expected terminal 'agent', got %q", resize.Terminal)
	}
	if resize.Rows != 24 {
		t.Errorf("expected rows 24, got %d", resize.Rows)
	}
	if resize.Cols != 80 {
		t.Errorf("expected cols 80, got %d", resize.Cols)
	}
}
