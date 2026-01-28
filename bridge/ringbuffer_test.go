package main

import (
	"sync"
	"testing"
)

func TestNewRingBuffer(t *testing.T) {
	rb := NewRingBuffer(100)
	if rb == nil {
		t.Fatal("NewRingBuffer returned nil")
	}
	if rb.size != 100 {
		t.Errorf("expected size 100, got %d", rb.size)
	}
	if len(rb.data) != 0 {
		t.Errorf("expected empty data, got length %d", len(rb.data))
	}
	if cap(rb.data) != 100 {
		t.Errorf("expected capacity 100, got %d", cap(rb.data))
	}
}

func TestRingBuffer_WriteWithinCapacity(t *testing.T) {
	rb := NewRingBuffer(100)
	data := []byte("hello world")
	rb.Write(data)

	result := rb.GetAll()
	if string(result) != "hello world" {
		t.Errorf("expected 'hello world', got '%s'", string(result))
	}
}

func TestRingBuffer_WriteExceedsCapacity(t *testing.T) {
	rb := NewRingBuffer(10)
	rb.Write([]byte("0123456789ABCDE")) // 15 bytes, should keep last 10

	result := rb.GetAll()
	if string(result) != "56789ABCDE" {
		t.Errorf("expected '56789ABCDE', got '%s'", string(result))
	}
}

func TestRingBuffer_MultipleWrites(t *testing.T) {
	rb := NewRingBuffer(10)
	rb.Write([]byte("abc"))
	rb.Write([]byte("def"))
	rb.Write([]byte("ghi"))

	result := rb.GetAll()
	if string(result) != "abcdefghi" {
		t.Errorf("expected 'abcdefghi', got '%s'", string(result))
	}
}

func TestRingBuffer_MultipleWritesExceedCapacity(t *testing.T) {
	rb := NewRingBuffer(10)
	rb.Write([]byte("12345"))
	rb.Write([]byte("67890"))
	rb.Write([]byte("ABCDE")) // This should cause overflow

	result := rb.GetAll()
	if string(result) != "67890ABCDE" {
		t.Errorf("expected '67890ABCDE', got '%s'", string(result))
	}
}

func TestRingBuffer_GetAllReturnsCopy(t *testing.T) {
	rb := NewRingBuffer(100)
	rb.Write([]byte("original"))

	result := rb.GetAll()
	// Modify the returned slice
	result[0] = 'X'

	// Original buffer should be unchanged
	result2 := rb.GetAll()
	if string(result2) != "original" {
		t.Errorf("GetAll did not return a copy, buffer was modified to '%s'", string(result2))
	}
}

func TestRingBuffer_EmptyBuffer(t *testing.T) {
	rb := NewRingBuffer(100)
	result := rb.GetAll()
	if len(result) != 0 {
		t.Errorf("expected empty result, got length %d", len(result))
	}
}

func TestRingBuffer_ExactCapacity(t *testing.T) {
	rb := NewRingBuffer(5)
	rb.Write([]byte("12345"))

	result := rb.GetAll()
	if string(result) != "12345" {
		t.Errorf("expected '12345', got '%s'", string(result))
	}
}

func TestRingBuffer_Concurrent(t *testing.T) {
	rb := NewRingBuffer(1000)
	var wg sync.WaitGroup

	// Spawn multiple goroutines writing concurrently
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				rb.Write([]byte("data"))
			}
		}(i)
	}

	// Also read concurrently
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				rb.GetAll()
			}
		}()
	}

	wg.Wait()

	// Just verify we didn't panic and can still read
	result := rb.GetAll()
	if len(result) > 1000 {
		t.Errorf("buffer exceeded capacity: %d > 1000", len(result))
	}
}
