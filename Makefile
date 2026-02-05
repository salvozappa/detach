.PHONY: setup dev check-setup rebuild-webview rebuild-bridge rebuild

setup:
	@mkdir -p keys
	@test -f keys/bridge || (echo "Generating keys/bridge..." && ssh-keygen -t ed25519 -f keys/bridge -N "" -C "detach-bridge-dev" -q)
	@test -f keys/deploy_key || (echo "Generating keys/deploy_key..." && ssh-keygen -t ed25519 -f keys/deploy_key -N "" -C "detach-deploy-dev" -q)
	@test -f .env || (echo "Generating .env..." && echo "DETACH_TOKEN=$$(openssl rand -base64 32 | tr -d '/+=' | head -c 43)" > .env)
	@echo ""
	@echo "Setup complete. Next steps:"
	@echo "1. Add keys/deploy_key.pub to your GitHub repo as a deploy key (for private repos)"
	@echo "2. Run: make dev (or docker compose up --build)"
	@echo "3. Open: http://localhost:8080?token=$$(grep DETACH_TOKEN .env | cut -d= -f2)"

dev: check-setup
	docker compose up --build

check-setup:
	@missing=""; \
	test -f keys/bridge || missing="$$missing keys/bridge"; \
	test -f keys/bridge.pub || missing="$$missing keys/bridge.pub"; \
	test -f keys/deploy_key || missing="$$missing keys/deploy_key"; \
	test -f keys/deploy_key.pub || missing="$$missing keys/deploy_key.pub"; \
	test -f .env || missing="$$missing .env"; \
	if [ -n "$$missing" ]; then \
		echo "Error: Missing required files:$$missing"; \
		echo ""; \
		echo "Run 'make setup' to generate them."; \
		exit 1; \
	fi

rebuild-webview:
	docker compose build webview && docker compose up -d webview

rebuild-bridge:
	docker compose build bridge && docker compose up -d bridge

rebuild:
	docker compose build && docker compose up -d
