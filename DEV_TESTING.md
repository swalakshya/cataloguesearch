# Tests & Coverage on the local dashboard

Open **Dev → Tests & Coverage** (`http://localhost:4000/dev/tests`). Use **Run all tests** for Python, frontend and Chat, or run one suite. Jobs share the dashboard's exclusive queue and cancellation control. No production connection is used.

The page discovers test files before execution, without importing their code. Suite cards show colored status pills and a completed-file progress bar. Click a status pill to filter by suite and status; setup failures show a separate Blocked state and a shortcut to setup logs. Click a file to see only its captured output and test cases. Expand a case for its failure or skip reason. Runner and collection output belongs to each suite's **Suite setup / runner output** row. Cancelled or blocked runs distinguish unfinished files from passing files. A normal runner executes each suite, rather than creating a process per test file.

## Requirements and isolation

- **Python:** the dashboard virtualenv needs the normal test dependencies, including pytest-cov. Configuration comes from `tests/.env`, not `.env.local`. `--run-all` enables slow/integration tests, including tests that call Gemini, Ollama and OCR tools. These can require credentials, local models and paid API calls.
- **OpenSearch:** start Docker first. The runner accepts only a local Unix Docker endpoint. It starts/reconciles only `opensearch-test`, using `docker-compose.test.yml` and the existing local image (no automatic builds or pulls). The platform is taken from the existing local image, so an AMD64 image can run under OrbStack emulation on an ARM laptop. Test ports are localhost **19200/19600**, with a dedicated named data volume and `.dashboard/test-snapshots` mount. It remains running for reuse. Development OpenSearch is not stopped or reconfigured.
- **Frontend:** run `npm ci` in `frontend` when dependencies change. Vitest uses jsdom and the V8 coverage provider. The runner uses a clean environment, excluding the application's inherited API addresses.
- **Chat:** the sibling repository configured by `DEPLOY_CHAT_REPO` must have its Node dependencies installed. Configuration comes from `service/.env.test`. `TEST_MODE=true` enables its existing integration harness, which uses temporary databases and ephemeral local ports. Test files run sequentially to match its integration requirements. No sibling repository files are modified.

## Coverage

The source coverage view includes untested files in the configured scope and reports weighted line/branch totals separately for each suite. Select a source file to see a snapshot from that run, with uncovered lines marked red. Python coverage contexts list related test files; JavaScript coverage is suite-level and does not claim per-test attribution.

Python covers `backend`, `deploy`, `eval`, `ingest`, and `utils`, respecting `.coveragerc`. Frontend covers `src` JavaScript/JSX except tests and setup. Chat covers `service/src` JavaScript. Each suite displays its exclusions. Manual smoke scripts and MCP code without an automated suite are outside this inventory. Failed runs retain coverage when the runner can produce it; a stopped runner may have no coverage.

Reports and bounded per-file logs live in `.dashboard/testing/<run-id>`. The latest **10 runs** are retained; the general job history can outlive their detailed reports. Each file keeps about a **5 MB** log tail, and the shared viewer displays up to **10,000 lines / 5 MB**, with Copy and Latest controls. Structured results and source snapshots consume additional space; coverage HTML/LCOV/JSON artifacts are retained when produced. Existing shared job logs use their normal retention settings.

Dashboard code updates use the existing **Update dashboard** flow, which waits for active jobs to finish. Merely opening the Tests page does not require Docker, Node, OpenSearch, or importing pytest/coverage. These are needed only when running the corresponding suite.
