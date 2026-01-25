package main

import (
	"strconv"
	"strings"
)

// List files in a directory
func (s *Session) listFiles(path string) ([]FileInfo, error) {
	// Use ls -la with specific format for parsing
	output, err := s.executeCommand("ls -la " + path)
	if err != nil {
		return nil, err
	}

	var files []FileInfo
	lines := strings.Split(output, "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "total") {
			continue
		}

		// Parse ls -la output: drwxr-xr-x 2 user group 4096 Jan 1 12:00 filename
		fields := strings.Fields(line)
		if len(fields) < 9 {
			continue
		}

		name := strings.Join(fields[8:], " ")
		if name == "." || name == ".." || name == ".claude" {
			continue
		}

		isDir := strings.HasPrefix(fields[0], "d")
		size, _ := strconv.ParseInt(fields[4], 10, 64)

		files = append(files, FileInfo{
			Name:  name,
			IsDir: isDir,
			Size:  size,
		})
	}

	return files, nil
}

// Read file content
func (s *Session) readFile(path string) (string, error) {
	return s.executeCommand("cat " + path)
}
