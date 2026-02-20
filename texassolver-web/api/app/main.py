"""TexasSolver Web API — FastAPI application entry point."""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from config_renderer import render_config
from models import JobStatus, JobStatusResponse, SolveRequest, SolveResponse
import solver as solver_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(
    title="TexasSolver Web API",
    description="REST + WebSocket API wrapping the TexasSolver GTO poker solver.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/api/solve", response_model=SolveResponse, status_code=202)
async def solve(request: SolveRequest) -> SolveResponse:
    """
    Submit a new solve job. Returns immediately with a job_id.
    The solver runs asynchronously in the background.
    """
    job_id = solver_service.create_job()

    # Write config file
    result_file = str(solver_service.result_path(job_id))
    config_content = render_config(request, result_file)
    cfg_path = solver_service.config_path(job_id)
    cfg_path.write_text(config_content)

    # Fire and forget — client polls /jobs/{id} or connects via WebSocket
    asyncio.create_task(solver_service.run_solver(job_id))

    return SolveResponse(job_id=job_id, status=JobStatus.pending)


@app.get("/api/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job(job_id: str) -> JobStatusResponse:
    """Poll job status and accumulated solver progress lines."""
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
    """Fetch the full strategy JSON result for a completed job."""
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
    """
    WebSocket endpoint for live progress streaming.
    Sends each new solver stdout line as a JSON message:
      {"line": "...", "status": "running"|"done"|"failed"}
    Closes when the job finishes.
    """
    job = solver_service.get_job(job_id)
    if job is None:
        await websocket.close(code=4004)
        return

    await websocket.accept()
    sent_count = 0

    try:
        while True:
            current_lines = job["progress"]
            # Send any new lines since last iteration
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
