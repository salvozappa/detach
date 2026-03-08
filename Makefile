.PHONY: setup

setup:
	@mkdir -p keys
	@test -f keys/bridge || (echo "Generating keys/bridge..." && ssh-keygen -t ed25519 -f keys/bridge -N "" -C "detach-bridge-dev" -q)
	@test -f keys/deploy_key || (echo "Generating keys/deploy_key..." && ssh-keygen -t ed25519 -f keys/deploy_key -N "" -C "detach-deploy-dev" -q)
	@test -f .env || (echo "Generating .env..." && echo "DETACH_TOKEN=$$(openssl rand -base64 32 | tr -d '/+=' | head -c 43)" > .env)
	@echo ""
	@echo "Setup complete. Next steps:"
	@echo "1. Add keys/deploy_key.pub to your GitHub repo as a deploy key (for private repos)"
	@echo "2. Run: docker compose up --build"
	@echo "3. Open: http://localhost:8080?token=$$(grep DETACH_TOKEN .env | cut -d= -f2)"
