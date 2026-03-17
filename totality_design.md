# Totality Design Document

## Security Principles

- **Credential Isolation:** All API keys and tokens must be encrypted at rest using Electron's `safeStorage` (OS-level keyring).
- **Hardened IPC:** The renderer process must never have direct access to Node.js APIs. Communication must be through a strictly validated `contextBridge` using Zod schemas.
- **Fail-Fast Sanitization:** All user-provided inputs, including database filters and file paths, must be validated against schemas at the IPC boundary.
- **SQL Injection Prevention:** Direct SQL execution with user input is forbidden. All queries must use `db.prepare` with `?` placeholders.
- **Command Injection Prevention:** External binaries (e.g., FFprobe) must be invoked via `child_process.spawn` with an arguments array, avoiding shell contexts.
- **AI Sandboxing:** AI "tool use" must be limited to read-only operations and strictly sanitized. Prompt injection must be mitigated through robust system instructions and loop detection.

## Performance Principles

- **Worker Offloading:** Long-running or CPU-intensive tasks (FFprobe, scans) must be offloaded to worker threads or separate processes.
- **Asynchronous IO:** Database and file operations should minimize blocking of the main process's event loop.
- **AI Optimization:** Use high-performance "Flash" models for repetitive tasks and implement caching for expensive analysis.

## Core Architectural Decisions

- **Provider Pattern:** Media source abstraction allows adding new providers without changing core logic.
- **Zod Boundaries:** Runtime validation at every system boundary (IPC, API, DB) ensures data integrity.
- **Singleton Services:** Core services like `DatabaseService` and `GeminiService` use the singleton pattern for unified state management.
