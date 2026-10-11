# Family-standard entry points (BG§7); each maps to an npm script.
build:
	npm run build

lint:
	npm run lint && npm run typecheck

test:
	npm test && npm run test:bun

e2e:
	npm run test:e2e

docs:
	npm run build && npm run docs:gen

publish:
	npm publish

.PHONY: build lint test e2e docs publish
