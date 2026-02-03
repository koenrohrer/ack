# Contributing to ACK

Whether it's a bug fix, a new feature, or a docs improvement -- contributions are welcome.

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 18+ |
| VS Code | 1.105+ |
| npm | 9+ |

---

## Getting Started

```bash
git clone https://github.com/koenrohrer/ack.git
cd ack
npm install
```

### Run in development mode

```bash
npm run dev
```

This starts the extension compiler and webview bundler in watch mode with type checking. Changes rebuild automatically.

### Launch the Extension Development Host

Press **F5** in VS Code (or run the `Launch Extension` configuration). A new VS Code window opens with ACK loaded from your local build.

### Run tests

```bash
npm run test:unit          # Vitest unit tests
npm run test:integration   # VS Code integration tests (requires Extension Development Host)
```

### Lint

```bash
npm run lint               # ESLint across src/
```

---

## Project Structure

```
src/
├── extension.ts                 Extension entry point -- activation, command registration
├── adapters/
│   ├── adapter.registry.ts      Maps agent names to their adapters
│   └── claude-code/
│       ├── claude-code.adapter.ts   Implements the adapter interface for Claude Code
│       ├── paths.ts                 Resolves config file locations per platform
│       ├── schemas.ts               Zod schemas for config validation
│       ├── parsers/                 Read config files → normalized tool models
│       └── writers/                 Normalized tool models → write config files
├── types/                       Shared types and enums
├── utils/                       JSON helpers, platform detection, markdown
├── views/
│   ├── tool-tree/               Sidebar tree data provider and commands
│   ├── marketplace/             React webview -- browse and install tools
│   ├── config-panel/            React webview -- edit agent settings
│   ├── file-watcher.*           Watches config files for external changes
│   └── shared/                  Base CSS shared across webviews
└── test/
    └── unit/                    Vitest tests for services, parsers, writers

media/
├── ack-logo.png                 Extension icon
└── icons/                       Tree view icons (dark + light variants)

dist/                            Compiled output (git-ignored)
```

### Key concepts

- **Adapters** abstract away agent-specific config formats. The Claude Code adapter knows where files live, how to parse them, and how to write changes back. Adding a new agent means adding a new adapter.
- **Parsers** read raw JSON/JSONC into a normalized `Tool` model. **Writers** do the reverse.
- **Webviews** (marketplace, config panel) are React apps bundled separately by esbuild. They communicate with the extension host through `postMessage`.
- **The tool tree** is a standard VS Code `TreeDataProvider` backed by the adapter's parsed output.

---

## Build Scripts

| Script | What it does |
|--------|-------------|
| `npm run dev` | Watch mode -- compiles extension + webviews + type check in parallel |
| `npm run compile` | One-shot build (extension + webviews) |
| `npm run package` | Minified production build |
| `npm run lint` | Run ESLint |
| `npm run test:unit` | Run Vitest unit tests |
| `npm run test:integration` | Run VS Code integration tests |
| `npm run check-types` | TypeScript type check without emit |

---

## Submitting a Pull Request

1. **Fork and branch** -- Create a feature branch from `master`
2. **Make your changes** -- Keep the scope focused; one feature or fix per PR
3. **Follow conventions** -- Use [conventional commits](https://www.conventionalcommits.org/):
   - `feat:` -- New feature
   - `fix:` -- Bug fix
   - `refactor:` -- Code change that neither fixes a bug nor adds a feature
   - `test:` -- Adding or updating tests
   - `docs:` -- Documentation only
   - `chore:` -- Maintenance (dependencies, build config)
4. **Test your changes** -- Run `npm run lint` and `npm run test:unit` before pushing
5. **Open the PR** -- Describe what changed and why

---

## Adding a New Agent Adapter

ACK's adapter pattern makes it straightforward to support new agents:

1. Create a directory under `src/adapters/<agent-name>/`
2. Implement the adapter interface (see `src/types/adapter.ts`)
3. Add parsers for each tool type the agent supports
4. Add writers for each tool type
5. Register the adapter in `src/adapters/adapter.registry.ts`
6. Add tests under `src/test/unit/`

The Claude Code adapter (`src/adapters/claude-code/`) serves as the reference implementation.

---

## Reporting Bugs

Open an issue at [github.com/koenrohrer/ack/issues](https://github.com/koenrohrer/ack/issues) with:

- Steps to reproduce
- Expected vs. actual behavior
- VS Code version and OS
- Relevant error output from the developer console (`Help > Toggle Developer Tools`)

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
