"""TexasSolver Web API — FastAPI application entry point."""

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, update

from config_renderer import render_config
from db.base import AsyncSessionLocal
from models import JobStatus, JobStatusResponse, SolveRequest, SolveResponse, BetSizeConfig
import solver as solver_service

from routers import hands, trainer as trainer_router
from trainer_spots import seed_spots

logger = logging.getLogger("API")
LIBRARY_DIR = Path("/app/jobs/library")


async def _run_migrations() -> None:
    """Create / migrate DB tables using SQLAlchemy metadata (idempotent)."""
    try:
        from db.base import engine, Base
        import db.models  # noqa: F401 — registers all ORM models on Base.metadata

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database schema up to date.")
    except Exception as exc:
        logger.error("Could not apply DB schema: %s", exc)
        raise


async def _solve_one_spot(spot_id: object) -> None:
    """Solve a single trainer spot, update its status in DB when done."""
    from db.models import TrainerSpot

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(TrainerSpot).where(TrainerSpot.id == spot_id))
        spot = res.scalar_one_or_none()
        if not spot or spot.solve_status != "pending":
            return
        spot.solve_status = "solving"
        await db.commit()
        spot_key = spot.spot_key
        spot_board = spot.board
        spot_pot = spot.pot
        spot_stack = spot.effective_stack
        spot_range_ip = spot.range_ip
        spot_range_oop = spot.range_oop
        spot_bet_sizes_json = spot.bet_sizes_json

    spot_dir = LIBRARY_DIR / spot_key
    spot_dir.mkdir(parents=True, exist_ok=True)
    result_file = str(spot_dir / "result.json")
    cfg_path = spot_dir / "config.txt"

    bet_sizes = [BetSizeConfig(**bs) for bs in spot_bet_sizes_json]
    req = SolveRequest(
        pot=spot_pot,
        effective_stack=spot_stack,
        board=spot_board,
        range_ip=spot_range_ip,
        range_oop=spot_range_oop,
        bet_sizes=bet_sizes,
        thread_num=2,       # safe for Docker (prevents OOM with 4+ threads)
        accuracy=1.0,       # tight convergence for trainer quality
        max_iteration=150,
        dump_rounds=2,      # flop + turn; river tree causes OOM in Docker (can raise to 3 with ≥8GB RAM)
        allin_threshold=0.67,
    )
    cfg_path.write_text(render_config(req, result_file))

    try:
        await solver_service.run_solver_path(cfg_path=cfg_path, result_file=Path(result_file), work_dir=spot_dir)
        solved_ok = Path(result_file).exists()
    except Exception as exc:
        logger.error("Spot %s solve failed: %s", spot_key, exc)
        solved_ok = False

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(TrainerSpot).where(TrainerSpot.id == spot_id))
        spot = res.scalar_one_or_none()
        if spot:
            spot.solve_status = "ready" if solved_ok else "failed"
            spot.result_path = result_file if solved_ok else None
            spot.solved_at = datetime.now(timezone.utc) if solved_ok else None
            await db.commit()

    if solved_ok:
        logger.info("Trainer spot ready: %s", spot_key)
    else:
        logger.warning("Trainer spot failed: %s", spot_key)


async def _solve_pending_spots() -> None:
    """Queue solving tasks for all pending trainer spots."""
    from db.models import TrainerSpot

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(TrainerSpot).where(TrainerSpot.solve_status == "pending"))
        pending = res.scalars().all()

    if not pending:
        logger.info("Trainer: no pending spots to solve.")
        return

    logger.info("Trainer: queuing %d spot(s) for background solving.", len(pending))
    for spot in pending:
        asyncio.create_task(_solve_one_spot(spot.id))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Apply DB migrations
    await _run_migrations()

    # Seed trainer spot library (idempotent)
    async with AsyncSessionLocal() as db:
        await seed_spots(db)

    # Reset any spots stuck in "solving" from a previous crashed run
    from db.models import TrainerSpot
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(TrainerSpot)
            .where(TrainerSpot.solve_status == "solving")
            .values(solve_status="pending")
        )
        await db.commit()
        logger.info("Reset any stuck 'solving' spots back to 'pending'.")

    # Background-solve pending spots (lazy, each uses solver semaphore)
    asyncio.create_task(_solve_pending_spots())

    yield


app = FastAPI(
    title="TexasSolver Web API",
    description="REST + WebSocket API wrapping the TexasSolver GTO poker solver.",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(hands.router)
app.include_router(trainer_router.router)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/api/solve", response_model=SolveResponse, status_code=202)
async def solve(request: SolveRequest) -> SolveResponse:
    job_id = solver_service.create_job()
    result_file = str(solver_service.result_path(job_id))
    config_content = render_config(request, result_file)
    cfg_path = solver_service.config_path(job_id)
    cfg_path.write_text(config_content)
    asyncio.create_task(solver_service.run_solver(job_id))
    return SolveResponse(job_id=job_id, status=JobStatus.pending)


@app.get("/api/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job(job_id: str) -> JobStatusResponse:
    job = solver_service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobStatusResponse(
        job_id=job_id,
        status=job["status"],
        progress=job["progress"],
        error=job["error"],
    )


@app.get("/api/jobs/{job_id}/result")
async def get_result(job_id: str) -> dict:
    job = solver_service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] == JobStatus.failed:
        raise HTTPException(status_code=500, detail=job["error"])
    if job["status"] != JobStatus.done:
        raise HTTPException(status_code=409, detail="Job not finished yet")
    try:
        result = solver_service.load_result(job_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Result file not found")
    return result


@app.websocket("/api/ws/{job_id}")
async def ws_progress(websocket: WebSocket, job_id: str) -> None:
    job = solver_service.get_job(job_id)
    if job is None:
        await websocket.close(code=4004)
        return
    await websocket.accept()
    sent_count = 0
    try:
        while True:
            current_lines = job["progress"]
            if len(current_lines) > sent_count:
                for line in current_lines[sent_count:]:
                    await websocket.send_json({"line": line, "status": job["status"]})
                sent_count = len(current_lines)
            status = job["status"]
            if status in (JobStatus.done, JobStatus.failed):
                await websocket.send_json({"line": None, "status": status, "error": job["error"]})
                break
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        pass
    finally:
        await websocket.close()
