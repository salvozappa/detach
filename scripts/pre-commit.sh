#!/bin/bash
# Pre-commit hook for Detach.it
# Runs go mod tidy, gofmt, go vet, and go test before allowing commit

set -e

echo "Running pre-commit checks..."

# Change to bridge directory (where go.mod lives)
cd bridge

# --- 1. Run go mod tidy ---
echo "1. Running go mod tidy..."
go mod tidy

# Check if go.mod was modified and stage it if it exists
MODIFIED_DEPS=""
if [ -f "go.mod" ] && ! git diff --exit-code go.mod > /dev/null 2>&1; then
    MODIFIED_DEPS="bridge/go.mod"
fi

if [ -n "$MODIFIED_DEPS" ]; then
    echo "⚠ go mod tidy modified dependency files - automatically staging changes"
    cd ..
    git add $MODIFIED_DEPS
    cd bridge
    echo "✓ go mod tidy passed (files staged)"
else
    echo "✓ go mod tidy passed"
fi

# --- 2. Run gofmt ---
echo "2. Running gofmt..."

# Capture the list of files that gofmt modifies
# -l lists files, -w writes changes
FORMATTED_FILES=$(gofmt -l -w .)

if [ -n "$FORMATTED_FILES" ]; then
    echo "⚠ gofmt formatted the following files - automatically staging changes:"
    echo "$FORMATTED_FILES"

    # Stage the formatted files (with bridge/ prefix)
    cd ..
    echo "$FORMATTED_FILES" | while read file; do
        git add "bridge/$file"
    done
    cd bridge

    echo "✓ gofmt passed (files staged)"
else
    echo "✓ gofmt passed"
fi

# --- 3. Run go vet ---
echo "3. Running go vet..."
if ! go vet ./...; then
    echo "Error: go vet found issues"
    exit 1
fi
echo "✓ go vet passed"

# --- 4. Run tests ---
echo "4. Running tests..."
if ! go test -v ./...; then
    echo "Error: Tests failed"
    exit 1
fi
echo "✓ All tests passed"

echo ""
echo "All pre-commit checks passed!"
