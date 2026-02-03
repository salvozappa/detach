package files

import (
	"errors"
	"testing"

	"detach.it/bridge/internal/executor"
)

func TestNewExplorer(t *testing.T) {
	mock := executor.NewMockExecutor()
	explorer := NewExplorer(mock, "/project")

	if explorer == nil {
		t.Fatal("expected non-nil Explorer")
	}
	if explorer.workingDir != "/project" {
		t.Errorf("expected workingDir '/project', got %q", explorer.workingDir)
	}
}

func TestExplorer_List_ParsesLsOutput(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("ls -la /project", `total 16
drwxr-xr-x  3 user group 4096 Jan  1 10:00 .
drwxr-xr-x  5 user group 4096 Jan  1 09:00 ..
-rw-r--r--  1 user group 1234 Jan  1 10:00 README.md
drwxr-xr-x  2 user group 4096 Jan  1 10:00 src
`, nil)
	mock.AddResponse("cd /project && git check-ignore 'README.md' 'src' 2>/dev/null", "", nil)

	explorer := NewExplorer(mock, "/project")
	files, err := explorer.List("/project")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(files))
	}

	// Check README.md
	if files[0].Name != "README.md" {
		t.Errorf("expected first file 'README.md', got %q", files[0].Name)
	}
	if files[0].IsDir {
		t.Error("expected README.md to not be a directory")
	}
	if files[0].Size != 1234 {
		t.Errorf("expected size 1234, got %d", files[0].Size)
	}

	// Check src
	if files[1].Name != "src" {
		t.Errorf("expected second file 'src', got %q", files[1].Name)
	}
	if !files[1].IsDir {
		t.Error("expected src to be a directory")
	}
}

func TestExplorer_List_SkipsDotEntries(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("ls -la /project", `total 8
drwxr-xr-x  3 user group 4096 Jan  1 10:00 .
drwxr-xr-x  5 user group 4096 Jan  1 09:00 ..
-rw-r--r--  1 user group  100 Jan  1 10:00 file.txt
`, nil)
	mock.AddResponse("cd /project && git check-ignore 'file.txt' 2>/dev/null", "", nil)

	explorer := NewExplorer(mock, "/project")
	files, err := explorer.List("/project")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("expected 1 file (dot entries filtered), got %d", len(files))
	}
	if files[0].Name != "file.txt" {
		t.Errorf("expected 'file.txt', got %q", files[0].Name)
	}
}

func TestExplorer_List_SkipsClaudeDir(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("ls -la /project", `total 8
drwxr-xr-x  2 user group 4096 Jan  1 10:00 .claude
-rw-r--r--  1 user group  100 Jan  1 10:00 file.txt
`, nil)
	mock.AddResponse("cd /project && git check-ignore 'file.txt' 2>/dev/null", "", nil)

	explorer := NewExplorer(mock, "/project")
	files, err := explorer.List("/project")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("expected 1 file (.claude filtered), got %d", len(files))
	}
	if files[0].Name != "file.txt" {
		t.Errorf("expected 'file.txt', got %q", files[0].Name)
	}
}

func TestExplorer_List_HandlesSpacesInFilenames(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("ls -la /project", `total 8
-rw-r--r--  1 user group  100 Jan  1 10:00 my file name.txt
`, nil)
	mock.AddResponse("cd /project && git check-ignore 'my file name.txt' 2>/dev/null", "", nil)

	explorer := NewExplorer(mock, "/project")
	files, err := explorer.List("/project")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("expected 1 file, got %d", len(files))
	}
	if files[0].Name != "my file name.txt" {
		t.Errorf("expected 'my file name.txt', got %q", files[0].Name)
	}
}

func TestExplorer_List_EmptyDirectory(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("ls -la /project/empty", `total 0
drwxr-xr-x  2 user group 4096 Jan  1 10:00 .
drwxr-xr-x  3 user group 4096 Jan  1 10:00 ..
`, nil)

	explorer := NewExplorer(mock, "/project")
	files, err := explorer.List("/project/empty")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(files) != 0 {
		t.Errorf("expected 0 files, got %d", len(files))
	}
}

func TestExplorer_List_SkipsMalformedLines(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("ls -la /project", `total 8
bad line
-rw-r--r--  1 user group  100 Jan  1 10:00 file.txt
short
`, nil)
	mock.AddResponse("cd /project && git check-ignore 'file.txt' 2>/dev/null", "", nil)

	explorer := NewExplorer(mock, "/project")
	files, err := explorer.List("/project")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("expected 1 file (malformed lines skipped), got %d", len(files))
	}
}

func TestExplorer_List_MarksIgnoredFiles(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("ls -la /project", `total 8
-rw-r--r--  1 user group  100 Jan  1 10:00 file.txt
drwxr-xr-x  2 user group 4096 Jan  1 10:00 node_modules
`, nil)
	mock.AddResponse("cd /project && git check-ignore 'file.txt' 'node_modules' 2>/dev/null", "node_modules\n", nil)

	explorer := NewExplorer(mock, "/project")
	files, err := explorer.List("/project")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(files))
	}

	// file.txt should not be ignored
	if files[0].IsIgnored {
		t.Error("expected file.txt to not be ignored")
	}

	// node_modules should be ignored
	if !files[1].IsIgnored {
		t.Error("expected node_modules to be ignored")
	}
}

func TestExplorer_List_SubdirectoryRelativePaths(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("ls -la /project/src", `total 8
-rw-r--r--  1 user group  100 Jan  1 10:00 main.go
`, nil)
	// When listing /project/src, paths should be relative: src/main.go
	mock.AddResponse("cd /project && git check-ignore 'src/main.go' 2>/dev/null", "", nil)

	explorer := NewExplorer(mock, "/project")
	files, err := explorer.List("/project/src")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("expected 1 file, got %d", len(files))
	}
}

func TestExplorer_List_Error(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("ls -la /nonexistent", "", errors.New("ls: cannot access '/nonexistent': No such file or directory"))

	explorer := NewExplorer(mock, "/project")
	_, err := explorer.List("/nonexistent")

	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestExplorer_Read_Success(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cat /project/file.txt", "file content here", nil)

	explorer := NewExplorer(mock, "/project")
	content, err := explorer.Read("/project/file.txt")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if content != "file content here" {
		t.Errorf("expected 'file content here', got %q", content)
	}
}

func TestExplorer_Read_Error(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cat /project/nonexistent.txt", "", errors.New("cat: /project/nonexistent.txt: No such file or directory"))

	explorer := NewExplorer(mock, "/project")
	_, err := explorer.Read("/project/nonexistent.txt")

	if err == nil {
		t.Fatal("expected error, got nil")
	}
}
