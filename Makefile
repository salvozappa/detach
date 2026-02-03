.PHONY: setup test build clean

# Default target - run setup
setup:
	@echo "Setting up git hooks..."
	@mkdir -p .git/hooks
	@cp scripts/pre-commit.sh .git/hooks/pre-commit
	@chmod +x .git/hooks/pre-commit
	@echo "Git hooks installed"
	@echo ""
	@echo "Setup complete! You're ready to develop."

test:
	@cd bridge && go test -v ./...

build:
	@mkdir -p bin
	@cd bridge && go build -o ../bin/bridge .

clean:
	@rm -rf bin
