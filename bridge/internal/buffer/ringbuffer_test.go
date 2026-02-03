package buffer

import (
	"fmt"
	"sync"
	"testing"
)

func TestRingBuffer_New(t *testing.T) {
	rb := New(100)
	if rb == nil {
		t.Fatal("expected non-nil RingBuffer")
	}
	if rb.size != 100 {
		t.Errorf("expected size 100, got %d", rb.size)
	}
	if len(rb.data) != 0 {
		t.Errorf("expected empty data, got %d bytes", len(rb.data))
	}
}

func TestRingBuffer_Write_UnderCapacity(t *testing.T) {
	rb := New(10)
	rb.Write([]byte("hello"))

	got := rb.GetAll()
	if string(got) != "hello" {
		t.Errorf("expected 'hello', got %q", string(got))
	}
}

func TestRingBuffer_Write_ExactCapacity(t *testing.T) {
	rb := New(5)
	rb.Write([]byte("hello"))

	got := rb.GetAll()
	if string(got) != "hello" {
		t.Errorf("expected 'hello', got %q", string(got))
	}
}

func TestRingBuffer_Write_OverCapacity(t *testing.T) {
	rb := New(5)
	rb.Write([]byte("hello")) // 5 bytes, at capacity
	rb.Write([]byte("world")) // 5 more bytes, over capacity

	got := rb.GetAll()
	if string(got) != "world" {
		t.Errorf("expected 'world', got %q", string(got))
	}
}

func TestRingBuffer_Write_MultipleWrites(t *testing.T) {
	rb := New(20)
	rb.Write([]byte("hello"))
	rb.Write([]byte(" "))
	rb.Write([]byte("world"))

	got := rb.GetAll()
	if string(got) != "hello world" {
		t.Errorf("expected 'hello world', got %q", string(got))
	}
}

func TestRingBuffer_Write_PartialOverflow(t *testing.T) {
	rb := New(10)
	rb.Write([]byte("hello")) // 5 bytes
	rb.Write([]byte("world")) // 5 more, exactly at 10
	rb.Write([]byte("!"))     // 1 more, total 11, keep last 10

	got := rb.GetAll()
	if string(got) != "elloworld!" {
		t.Errorf("expected 'elloworld!', got %q", string(got))
	}
}

func TestRingBuffer_GetAll_ReturnsCopy(t *testing.T) {
	rb := New(10)
	rb.Write([]byte("hello"))

	got := rb.GetAll()
	// Modify the returned slice
	got[0] = 'X'

	// Original buffer should be unchanged
	got2 := rb.GetAll()
	if string(got2) != "hello" {
		t.Errorf("buffer was modified, expected 'hello', got %q", string(got2))
	}
}

func TestRingBuffer_GetAll_EmptyBuffer(t *testing.T) {
	rb := New(10)
	got := rb.GetAll()

	if len(got) != 0 {
		t.Errorf("expected empty slice, got %d bytes", len(got))
	}
}

func TestRingBuffer_Concurrent(t *testing.T) {
	rb := New(1024)
	var wg sync.WaitGroup

	// Multiple writers
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				rb.Write([]byte(fmt.Sprintf("writer-%d-msg-%d\n", n, j)))
			}
		}(i)
	}

	// Multiple readers
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				_ = rb.GetAll()
			}
		}()
	}

	wg.Wait()
	// If we get here without race detector complaining, test passes
}

func TestRingBuffer_LargeWrite(t *testing.T) {
	rb := New(5)
	// Write more than capacity in a single write
	rb.Write([]byte("abcdefghij")) // 10 bytes

	got := rb.GetAll()
	if string(got) != "fghij" {
		t.Errorf("expected 'fghij', got %q", string(got))
	}
}
