# TexasSolver Web — Project Plan

## Goal
Fork `bupticybee/TexasSolver` (console branch) and wrap it with a modern web UI
served from Docker, accessible in the browser.

## Architecture

```
Browser
  │
  ▼
[Frontend – React + Vite + shadcn/ui]  ← served via Nginx
  │  (HTTP/REST + WebSocket)
  ▼
[Backend API – Python FastAPI]
  │  (spawns subprocess, reads output files)
  ▼
[TexasSolver Console Binary – compiled C++]
  │
  ▼
[JSON strategy output file]
```

Docker Compose runs two services: `solver-api` and `frontend`.

## Project Structure

```
texassolver-web/
├── CLAUDE.md
├── docker-compose.yml
├── solver/                        # Forked C++ solver (console branch)
│   ├── Dockerfile                 # Multi-stage: build C++ → Python runtime
│   ├── app/                       # FastAPI application
│   │   ├── main.py
│   │   ├── solver.py              # Subprocess wrapper
│   │   ├── config_renderer.py     # Renders .txt config from API params
│   │   └── models.py              # Pydantic request/response models
│   └── resources/                 # Solver resource files (ranges, samples)
└── frontend/                      # React application
    ├── Dockerfile
    ├── nginx.conf
    └── src/
        ├── components/
        │   ├── RangeEditor/       # 13×13 hand matrix
        │   ├── BoardSelector/     # Card picker
        │   ├── BetTreeBuilder/    # Bet/raise size configurator
        │   └── StrategyViewer/    # Frequency charts + tree navigator
        └── pages/
            ├── SolvePage.tsx
            └── ResultPage.tsx
```

## Tech Stack

| Layer      | Choice               | Reason                                      |
|------------|----------------------|---------------------------------------------|
| Backend    | Python FastAPI       | Async, easy subprocess + SSE/WebSocket      |
| Frontend   | React + Vite + shadcn/ui | Modern, fast, great component ecosystem |
| Charts     | Recharts             | Frequency/EV visualization                  |
| Container  | Docker Compose       | Simple two-service setup                    |
| Proxy      | Nginx                | Serves frontend, proxies /api to backend    |

## API Endpoints

- `POST /api/solve` — Submit solve job, returns `job_id`
- `GET  /api/jobs/{id}` — Poll job status + exploitability progress
- `GET  /api/jobs/{id}/result` — Fetch strategy JSON result
- `WS   /api/ws/{id}` — Live progress stream (exploitability %)

## Phases

### Phase 1 – Core Pipeline ✅ (current)
- [ ] Clone TexasSolver console branch into `solver/`
- [ ] Multi-stage Dockerfile: build C++ binary → Python FastAPI runtime
- [ ] FastAPI app with `/solve`, `/jobs/{id}`, `/jobs/{id}/result` endpoints
- [ ] Config file renderer (board, ranges, pot, stacks, bets → .txt)
- [ ] docker-compose.yml wiring both services
- [ ] Validate end-to-end: POST → solve → JSON result

### Phase 2 – Frontend Basics ✅
- [x] React app scaffold (Vite + TypeScript + Tailwind v4)
- [x] Multi-theme system: Dark, Midnight, Ocean, Poker, Light (CSS vars + ThemeContext)
- [x] Theme switcher in header with color swatches
- [x] Range editor — 13×13 hand matrix, drag-to-paint, right-click partial freq, parse/serialize
- [x] Board selector — visual card picker by suit/rank, street labels
- [x] Bet tree builder — interactive per-street/position/action size configurator
- [x] Tab navigation (Board, Ranges, Bet Sizes, Settings, Results)
- [x] Solve submission, WebSocket live progress, result download

### Phase 3 – Strategy Viewer ✅
- [x] SolverNode type system (action_node / chance_node, ComboStrategy, ActionEntry)
- [x] strategyUtils.ts: combo→cell mapping, action name inference, color palette, aggregation
- [x] ExploitabilityChart: Recharts line chart parsing "Total exploitability X precent" log lines
- [x] HandStrategyMatrix: 13×13 grid colored by dominant action, stacked mini-bar per cell, hover tooltip with per-action %
- [x] ActionBreakdown: stacked bar + legend showing range-wide action frequencies
- [x] StrategyViewer: breadcrumb tree navigator, action buttons with freq %, chance node card picker
- [x] Results tab: status row, live log while solving, convergence chart, Strategy Explorer on done

### Phase 4 – Polish
- [ ] Auth / API key protection (for server deployment)
- [ ] Job history + result caching
- [ ] Mobile-responsive layout
- [ ] Dark mode

## Key Notes

- Solve jobs can take several minutes — always async with job queue
- Strategy JSON files can be large — paginate/stream to frontend
- Cap concurrent solves (CPU-heavy) — use a simple semaphore in FastAPI
- Validate board + ranges in backend before spawning solver process
- Commercial use of solver code requires licensing (personal/research use is MIT)
