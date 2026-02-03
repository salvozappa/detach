package executor

// MockExecutor is a test double for the Executor interface
type MockExecutor struct {
	// Responses maps command strings to their mock responses
	Responses map[string]MockResponse
	// CalledCommands records all commands that were executed
	CalledCommands []string
	// DefaultResponse is returned for commands not in Responses
	DefaultResponse MockResponse
}

// MockResponse holds the output and error for a mock command
type MockResponse struct {
	Output string
	Err    error
}

// NewMockExecutor creates a new MockExecutor with empty responses
func NewMockExecutor() *MockExecutor {
	return &MockExecutor{
		Responses:      make(map[string]MockResponse),
		CalledCommands: []string{},
	}
}

// Run implements the Executor interface
func (m *MockExecutor) Run(cmd string) (string, error) {
	m.CalledCommands = append(m.CalledCommands, cmd)
	if resp, ok := m.Responses[cmd]; ok {
		return resp.Output, resp.Err
	}
	return m.DefaultResponse.Output, m.DefaultResponse.Err
}

// AddResponse adds a mock response for a specific command
func (m *MockExecutor) AddResponse(cmd, output string, err error) {
	m.Responses[cmd] = MockResponse{Output: output, Err: err}
}

// WasCalled returns true if the command was executed
func (m *MockExecutor) WasCalled(cmd string) bool {
	for _, c := range m.CalledCommands {
		if c == cmd {
			return true
		}
	}
	return false
}

// CallCount returns the number of times a command was executed
func (m *MockExecutor) CallCount(cmd string) int {
	count := 0
	for _, c := range m.CalledCommands {
		if c == cmd {
			count++
		}
	}
	return count
}
