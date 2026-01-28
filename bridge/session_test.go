package main

import (
	"encoding/hex"
	"testing"
)

func TestGenerateSessionID_Length(t *testing.T) {
	id := generateSessionID()
	// 16 bytes encoded as hex = 32 characters
	if len(id) != 32 {
		t.Errorf("expected session ID length 32, got %d", len(id))
	}
}

func TestGenerateSessionID_HexFormat(t *testing.T) {
	id := generateSessionID()
	_, err := hex.DecodeString(id)
	if err != nil {
		t.Errorf("session ID is not valid hex: %v", err)
	}
}

func TestGenerateSessionID_Uniqueness(t *testing.T) {
	ids := make(map[string]bool)
	for i := 0; i < 100; i++ {
		id := generateSessionID()
		if ids[id] {
			t.Errorf("duplicate session ID generated: %s", id)
		}
		ids[id] = true
	}
}

func TestGenerateSessionID_NotEmpty(t *testing.T) {
	id := generateSessionID()
	if id == "" {
		t.Error("session ID should not be empty")
	}
	// Also check it's not all zeros (extremely unlikely but sanity check)
	if id == "00000000000000000000000000000000" {
		t.Error("session ID appears to be all zeros")
	}
}
