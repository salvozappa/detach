package buffer

import "sync"

// RingBuffer stores recent output for replay on reconnect
type RingBuffer struct {
	data []byte
	size int
	mu   sync.Mutex
}

// New creates a RingBuffer with the specified maximum size
func New(size int) *RingBuffer {
	return &RingBuffer{
		data: make([]byte, 0, size),
		size: size,
	}
}

// Write appends data to the buffer, discarding oldest data if necessary
func (rb *RingBuffer) Write(p []byte) {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	rb.data = append(rb.data, p...)
	if len(rb.data) > rb.size {
		rb.data = rb.data[len(rb.data)-rb.size:]
	}
}

// GetAll returns a copy of all buffered data
func (rb *RingBuffer) GetAll() []byte {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	result := make([]byte, len(rb.data))
	copy(result, rb.data)
	return result
}
