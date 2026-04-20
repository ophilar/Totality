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

## Testability Principles

- **No Global Mocks:** Tests must verify actual code paths including database transactions and network logic. Avoid `vi.mock()` for core business logic.
- **Environment Agnosticism:** Services must be designed to run in diverse environments (Production, Test, CLI) by allowing configuration via environment variables or settings (e.g., base URL overrides, custom database paths).
- **In-Memory Integration:** Favor real in-memory SQLite databases over mocks for repository and service tests to ensure query correctness and schema integrity.

## Active Optimization Principles

- **Atomic File Operations:** When modifying or replacing media files (e.g., transcoding), use a "Write-Rename-Cleanup" pattern with backup support to prevent data loss.
- **AI-Augmented Transcoding:** Leverage LLMs (Gemini) to determine optimal per-video encoding parameters, balancing quality and compression beyond generic presets.
- **Safe Deduplication:** Automatic file deletion is strictly opt-in. The system should identify and recommend actions, but manual confirmation is the default for destructive operations.

## Architectural Standardization (v0.4.4)

- **IPC Channel Naming:** All IPC channels must follow a colon-separated resource-based naming convention (e.g., `db:media:list`, `monitoring:status`). Dot-notation is deprecated and must only exist as temporary aliases for backward compatibility.
- **1:1 UI Update Mandate:** To ensure maximum responsiveness, backend services (scanners, analyzers) must notify the renderer on every single item processed (1:1 ratio). Throttling must be handled by the renderer or specialized IPC utility layers, not the business logic.
- **Reactive Background Analysis:** Adding or updating service configurations (e.g., TMDB or Gemini API keys) must automatically trigger relevant background analysis for the existing library without requiring a manual full scan.
- **Non-Blocking Discovery:** Media scanning and discovery must proceed using local metadata even if external services (TMDB, Gemini, FFmpeg) are unconfigured or fail. Background analysis is an enhancement, not a prerequisite for core library visibility.
