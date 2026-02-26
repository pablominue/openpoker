# TexasSolver Web — Project Plan

## Goal
Fork `bupticybee/TexasSolver` (console branch) and wrap it with a modern web UI
served from Docker, accessible in the browser. Also includes hand history upload,
stats tracking, and a GTO trainer module.

## Architecture

```
Browser
  │
  ▼
[Frontend – React + Vite + TypeScript]  ← served via Nginx (no shadcn/ui; inline styles with CSS vars)
  │  (HTTP/REST)
  ▼
[Backend API – Python FastAPI]           ← api/ (SQLAlchemy 2.0 async, asyncpg)
  │  (spawns subprocess, reads output files)
  ├─► [PostgreSQL DB]                    ← hands, trainer_spots, training_sessions
  └─► [TexasSolver Console Binary]       ← compiled C++ in solver/
          │
          ▼
      [JSON strategy output file]
```

Docker Compose runs: `solver-api`, `frontend`, `db` (postgres).

## Project Structure

```
texassolver-web/
├── docker-compose.yml
├── api/                               # FastAPI backend
│   ├── Dockerfile
│   └── app/
│       ├── main.py                    # lifespan: create_all + seed_spots + background solving
│       ├── solver.py                  # Subprocess wrapper for TexasSolver binary
│       ├── trainer_spots.py           # GTO spot seeding and solving logic
│       ├── requirements.txt
│       ├── core/
│       │   └── deps.py                # get_db dependency
│       ├── db/
│       │   └── models.py              # Hand, TrainerSpot, TrainingSession (no User table)
│       ├── parsers/
│       │   └── pokerstars.py          # Hand history parser
│       └── routers/
│           ├── hands.py               # Upload, list, stats, /players, /reprocess
│           └── trainer.py             # Trainer session endpoints
├── solver/                            # Forked C++ TexasSolver (console branch)
│   └── resources/                     # Ranges, card comparer tables
└── frontend/                          # React application
    ├── Dockerfile
    ├── nginx.conf
    └── src/
        ├── api/
        │   ├── hands.ts
        │   └── trainer.ts
        ├── contexts/
        │   └── PlayerContext.tsx       # Selected player stored in localStorage
        ├── components/
        │   ├── AppNav.tsx              # Player selector dropdown (top-right)
        │   ├── StrategyViewer/         # Frequency charts + tree navigator
        │   └── ...
        └── pages/
            ├── HandsPage.tsx
            ├── StatsPage.tsx
            ├── TrainerPage.tsx
            └── SolvePage.tsx
```

## Tech Stack

| Layer      | Choice                        | Reason                                     |
|------------|-------------------------------|--------------------------------------------|
| Backend    | Python FastAPI                | Async, easy subprocess management          |
| ORM        | SQLAlchemy 2.0 async + asyncpg| Async postgres, typed queries              |
| Database   | PostgreSQL                    | Persistent hand history and trainer data   |
| Frontend   | React + Vite + TypeScript     | Modern, fast                               |
| Charts     | Recharts                      | Frequency/EV visualization                 |
| Container  | Docker Compose                | Three-service setup                        |
| Proxy      | Nginx                         | Serves frontend, proxies /api to backend   |

## Key Design Decisions

- **No authentication**: Players identified by PokerStars username (`player_name` column)
- `PlayerContext.tsx` stores selected player in localStorage; fetches from `GET /api/hands/players`
- All hands/stats/trainer endpoints take `player_name` as query param
- `hero_result` stored in **cents** (integer); frontend divides by `stakes_bb` to display bb
- `POST /api/hands/reprocess` re-parses stored `raw_text` with current parser (useful after bug fixes)

## API Endpoints

### Hands
- `POST /api/hands/upload` — Upload .txt hand history file
- `GET  /api/hands` — List hands (paginated, filterable by position)
- `GET  /api/hands/players` — List all distinct player names
- `GET  /api/hands/stats/summary` — VPIP, PFR, 3-bet, WTSD, win rate
- `GET  /api/hands/stats/by-position` — Per-position breakdown
- `POST /api/hands/reprocess` — Re-parse all raw_text with current parser
- `DELETE /api/hands/{id}` — Delete a hand

### Solver
- `POST /api/solve` — Submit solve job, returns `job_id`
- `GET  /api/jobs/{id}` — Poll job status + exploitability progress
- `GET  /api/jobs/{id}/result` — Fetch strategy JSON result
- `WS   /api/ws/{id}` — Live progress stream (exploitability %)

### Trainer
- `POST /api/trainer/sessions` — Start a training session
- `GET  /api/trainer/sessions/{id}/spot` — Get next spot to train
- `POST /api/trainer/sessions/{id}/answer` — Submit answer

## Parser — Known Pitfalls (`parsers/pokerstars.py`)

Two bugs were found and fixed (both cause wildly inflated `hero_result`):

1. **Windows line endings** (`\r\n`) — `re.split(r"\n{2,}", content)` fails to split files
   exported on Windows because `\r\n\r\n` has no two consecutive bare `\n`.
   **Fix**: normalize line endings at the top of `parse_file`:
   `content = content.replace("\r\n", "\n").replace("\r", "\n")`

2. **Single-digit hours in timestamp** — `_RE_HEADER` used `\d{2}:\d{2}:\d{2}` for time,
   which fails to match hands played between midnight and 9am (e.g. `0:14:44`, `9:05:00`).
   Those hands are not detected as new-hand headers and get merged into the previous hand.
   **Fix**: changed to `\d{1,2}:\d{2}:\d{2}` in `_RE_HEADER`.

   Together these bugs could accumulate all collect events from an entire session into one
   "hand", producing results like +1128bb at €0.05/€0.10 stakes.

## Phases

### Phase 1 – Core Pipeline ✅
- [x] Clone TexasSolver console branch into `solver/`
- [x] Multi-stage Dockerfile: build C++ binary → Python FastAPI runtime
- [x] FastAPI app with solve/jobs endpoints
- [x] Config file renderer (board, ranges, pot, stacks, bets → .txt)
- [x] docker-compose.yml wiring all services
- [x] Validate end-to-end: POST → solve → JSON result

### Phase 2 – Frontend Basics ✅
- [x] React app scaffold (Vite + TypeScript)
- [x] Multi-theme system (CSS vars + ThemeContext)
- [x] Range editor — 13×13 hand matrix, drag-to-paint, right-click partial freq
- [x] Board selector — visual card picker by suit/rank, street labels
- [x] Bet tree builder — per-street/position/action size configurator
- [x] Solve submission, WebSocket live progress, result download

### Phase 3 – Strategy Viewer ✅
- [x] SolverNode type system (action_node / chance_node, ComboStrategy, ActionEntry)
- [x] HandStrategyMatrix: 13×13 grid colored by dominant action, stacked mini-bar per cell
- [x] ActionBreakdown: stacked bar + legend showing range-wide action frequencies
- [x] StrategyViewer: breadcrumb tree navigator, action buttons, chance node card picker
- [x] Results tab: status row, live log, convergence chart, Strategy Explorer

### Phase 4 – Hand History & Stats ✅
- [x] PostgreSQL schema: Hand, TrainerSpot, TrainingSession (no auth)
- [x] PokerStars hand history parser (Zoom 6-max NL, English format)
- [x] Upload endpoint with duplicate detection
- [x] HandsPage: file/folder upload, paginated table, delete
- [x] StatsPage: VPIP/PFR/3-bet/WTSD/win-rate summary + by-position breakdown
- [x] Player selector in AppNav, PlayerContext
- [x] `/reprocess` endpoint to fix existing data after parser bug fixes

### Phase 5 – GTO Trainer ✅
- [x] TrainerSpot seeding from curated spot list
- [x] Background solver: auto-solves pending spots at startup
- [x] TrainerPage: spot display, action selection, feedback
- [x] Training sessions with player_name

### Phase 6A — Trainer V2 (High Impact, Medium Effort)
1. Visual Poker Table

SVG oval table with 6 labeled seats (UTG/HJ/CO/BTN/SB/BB)
Hero seat highlighted with hole cards shown
Board cards shown in center with pot amount
Action history displayed along a timeline above the table
RNG dice icon for mixed-strategy decisions
2. Range Matrix Sidebar

13×13 hand grid (reuse HandStrategyMatrix component from SolvePage)
Colored by dominant GTO action for current node
Hero's specific combo highlighted with a border
Visible during play AND in result review
3. EV & Decision Quality

After submitting action: show EV of chosen action vs best action
Grade each decision: Best Move / Correct (≥75% GTO) / Inaccuracy (40–75%) / Wrong (<40%) / Blunder (<10%)
Running session tally in sidebar (like GTO Wizard's left panel)
4. Action History Breadcrumb

Show full action sequence: BB Check → BTN Bet 3.5bb → BB Call → Turn: Kh → …
Lets players understand where they are in the hand
5. "Change Move" Flow

After seeing feedback, offer a Change Move button to replay from the same spot
Continues to the end of the hand → enables deeper study
### Phase 6B — Browse Mode (High Impact, High Effort)
6. Spot Browser Page (/browse)

Pick any solved trainer spot from the library
Display the full game tree like the existing SolvePage Strategy Explorer
Navigate IP/OOP node by node, see range matrix update at each node
Filters: position matchup, board texture, street
7. Range Visualizer

For any node in the tree: show full 13×13 range matrix for current actor
Breakdown bar: action frequencies across the whole range
Combo detail panel: click any cell → see exact frequencies for each combo
### Phase 6C — Analytics & Progression (Medium Effort)
8. Advanced Stats Page

WWSF (Won When Saw Flop), Aggression Factor, C-bet %, Fold-to-cbet %
Positional heatmap: win rate / VPIP by position
Result over time chart (moving average)
9. Trainer Progress Dashboard

Session history table with score, spot, date
Score trend chart (last 20 sessions)
Weakness heatmap: which spot types have lowest GTO score
10. Spaced Repetition

Spots with lower avg GTO score shown more frequently
Track per-spot EMA score in DB
"Focus Mode": only show spots below a threshold score
### Phase 6D — Custom Spots (Future)
11. Custom Spot Creator

User defines preflop action, board, ranges, bet sizes
Submits to solver queue, result saved to personal library
Shared spot library (public/private toggle)

### Recommended implementation order: 6A (table + matrix + EV grading) → 6B (browse) → 6C (analytics) → 6D (custom spots).

### Phase 7 – Ranges ✅
- [x] `PlayerRange` DB model (player_name + scenario_key + range_str, unique constraint)
- [x] `GET /api/ranges` — fetch all ranges for a player (returns defaults for unset scenarios)
- [x] `PUT /api/ranges/{scenario_key}` — save/update a range for a player
- [x] `GET /api/ranges/deviation` — compare played hands to defined ranges (open/3bet/call adherence)
- [x] `GET /api/ranges/villain/{villain_name}/stats` — parse raw hand history to extract villain positional VPIP/PFR/3-bet + estimated ranges
- [x] `RangesPage` (`/ranges`) — left scenario tree (grouped: Opens, vs EP, vs HJ, vs CO, vs BTN, vs SB) + right RangeEditor panel; tabs for "My Ranges" and "Villain Ranges"
- [x] Default GTO-approximate starting ranges pre-seeded in frontend (not DB) for all 35 scenarios
- [x] Range Deviation section on StatsPage — per-scenario adherence table + summary score
- [x] AppNav "Ranges" link + App.tsx route

Scenario key convention:
- Opens: `open_EP`, `open_HJ`, `open_CO`, `open_BTN`, `open_SB`
- 3-bets: `3bet_{hero_pos}_vs_{raiser_pos}` (e.g. `3bet_BTN_vs_CO`)
- Calls: `call_{hero_pos}_vs_{raiser_pos}` (e.g. `call_BB_vs_BTN`)


## Key Notes

- Solver MUST run from `/app` (its install dir) to find `resources/` — job dir as CWD causes SIGSEGV
- Solver stdout overflows asyncio 64KB buffer — use `DEVNULL` for trainer spots; `limit=4MB` for user solves
- Concurrent solver processes crash — semaphore is 1 (only one at a time)
- Large bet size trees OOM-kill the solver — use 1 size per action; `thread_num=2`
- Trainer spots stuck in "solving" at restart — startup resets "solving"→"pending"
- DB schema changes require `docker compose down -v && docker compose up --build` in dev
- Commercial use of solver code requires licensing (personal/research use is MIT)
