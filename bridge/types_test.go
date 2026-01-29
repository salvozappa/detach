package main

import (
	"encoding/json"
	"testing"
)

func TestWSMessage_UnmarshalJSON(t *testing.T) {
	tests := []struct {
		name         string
		input        string
		expectedType string
	}{
		{
			name:         "debug_log message",
			input:        `{"type":"debug_log","level":"debug","category":"HEALTH","message":"test"}`,
			expectedType: "debug_log",
		},
		{
			name:         "terminal_data message",
			input:        `{"type":"terminal_data","terminal":"llm","data":"aGVsbG8="}`,
			expectedType: "terminal_data",
		},
		{
			name:         "resize message",
			input:        `{"type":"resize","terminal":"terminal","rows":24,"cols":80}`,
			expectedType: "resize",
		},
		{
			name:         "git_status message",
			input:        `{"type":"git_status"}`,
			expectedType: "git_status",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var msg WSMessage
			err := json.Unmarshal([]byte(tt.input), &msg)
			if err != nil {
				t.Fatalf("Unmarshal failed: %v", err)
			}
			if msg.Type != tt.expectedType {
				t.Errorf("expected Type %q, got %q", tt.expectedType, msg.Type)
			}
			if len(msg.Payload) == 0 {
				t.Error("Payload should not be empty")
			}
			if string(msg.Payload) != tt.input {
				t.Errorf("Payload mismatch: expected %q, got %q", tt.input, string(msg.Payload))
			}
		})
	}
}

func TestWSMessage_UnmarshalJSON_InvalidJSON(t *testing.T) {
	var msg WSMessage
	err := json.Unmarshal([]byte("not valid json"), &msg)
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func TestWSMessage_TypeMatchesConstants(t *testing.T) {
	// Verify that parsed types match our constants
	tests := []struct {
		input    string
		constant string
	}{
		{`{"type":"debug_log"}`, MsgTypeDebugLog},
		{`{"type":"terminal_data"}`, MsgTypeTerminalData},
		{`{"type":"resize"}`, MsgTypeResize},
		{`{"type":"git_status"}`, MsgTypeGitStatus},
		{`{"type":"git_stage"}`, MsgTypeGitStage},
	}

	for _, tt := range tests {
		var msg WSMessage
		if err := json.Unmarshal([]byte(tt.input), &msg); err != nil {
			t.Fatalf("Unmarshal failed: %v", err)
		}
		if msg.Type != tt.constant {
			t.Errorf("Type %q does not match constant %q", msg.Type, tt.constant)
		}
	}
}
