package types

import (
	"encoding/json"
	"testing"
)

func TestWSMessage_UnmarshalJSON_ValidMessage(t *testing.T) {
	input := `{"type":"terminal_data","terminal":"llm","data":"SGVsbG8="}`
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
	input := `{"type":"resize","terminal":"llm","rows":24,"cols":80}`
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

func TestWSMessage_CanParsePayloadAfterUnmarshal(t *testing.T) {
	input := `{"type":"resize","terminal":"llm","rows":24,"cols":80}`
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

	if resize.Terminal != "llm" {
		t.Errorf("expected terminal 'llm', got %q", resize.Terminal)
	}
	if resize.Rows != 24 {
		t.Errorf("expected rows 24, got %d", resize.Rows)
	}
	if resize.Cols != 80 {
		t.Errorf("expected cols 80, got %d", resize.Cols)
	}
}
