"""Manages solver subprocess execution and job lifecycle."""

import asyncio
import json
import os
import uuid
from pathlib import Path
from typing import Optional

from models import JobStatus
import logging

JOBS_DIR = Path("/app/jobs")
SOLVER_BIN = Path("/app/console_solver")

# In-memory job store (sufficient for single-instance deployment)
_jobs: dict[str, dict] = {}

# Limit concurrent solves to avoid OOM on the host
_semaphore = asyncio.Semaphore(2)

logger = logging.getLogger("SOLVER")


def create_job() -> str:
    job_id = str(uuid.uuid4())
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    _jobs[job_id] = {
        "status": JobStatus.pending,
        "progress": [],
        "error": None,
    }
    return job_id


def get_job(job_id: str) -> Optional[dict]:
    return _jobs.get(job_id)


def job_dir(job_id: str) -> Path:
    return JOBS_DIR / job_id


def config_path(job_id: str) -> Path:
    return job_dir(job_id) / "config.txt"


def result_path(job_id: str) -> Path:
    return job_dir(job_id) / "result.json"


async def run_solver(job_id: str) -> None:
    """Run the solver binary for a job. Updates job state in-place."""
    job = _jobs[job_id]
    cfg = config_path(job_id)
    result = result_path(job_id)

    async with _semaphore:
        job["status"] = JobStatus.running
        try:
            proc = await asyncio.create_subprocess_exec(
                str(SOLVER_BIN),
                "-i", str(cfg),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(job_dir(job_id)),
            )

            async for raw_line in proc.stdout:
                line = raw_line.decode("utf-8", errors="replace").rstrip()
                job["progress"].append(line)

            await proc.wait()

            if proc.returncode != 0:
                job["status"] = JobStatus.failed
                job["error"] = f"Solver exited with code {proc.returncode}"
            elif not result.exists():
                job["status"] = JobStatus.failed
                job["error"] = "Solver finished but result file was not created"
            else:
                job["status"] = JobStatus.done

        except Exception as exc:
            logger.error(f"Error running solver for job {job_id}: {exc}")
            job["status"] = JobStatus.failed
            job["error"] = str(exc)


def load_result(job_id: str) -> dict:
    path = result_path(job_id)
    if not path.exists():
        raise FileNotFoundError(f"Result not found for job {job_id}")
    with open(path, "r") as f:
        return json.load(f)
