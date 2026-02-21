ENV_PROVIDER ?= infisical
ENV ?= dev

.PHONY: env-list env-run

env-list:
ifeq ($(ENV_PROVIDER),infisical)
	infisical secrets --env=$(ENV) --path=/
else
	@echo "Unsupported ENV_PROVIDER: $(ENV_PROVIDER)"
	@echo "Supported providers: infisical"
	@exit 1
endif

env-run:
ifndef CMD
	$(error CMD is required. Example: make env-run ENV=dev CMD="python3 -m scripts.notion.sync_docs")
endif
ifeq ($(ENV_PROVIDER),infisical)
	infisical run --env=$(ENV) -- $(CMD)
else
	@echo "Unsupported ENV_PROVIDER: $(ENV_PROVIDER)"
	@echo "Supported providers: infisical"
	@exit 1
endif
