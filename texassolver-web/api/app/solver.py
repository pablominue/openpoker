"""Manages solver subprocess execution and job lifecycle."""

import asyncio
import json
import uuid
from pathlib import Path
from typing import Optional

from models import JobStatus
import logging

JOBS_DIR = Path("/app/jobs")
SOLVER_BIN = Path("/app/console_solver")

# In-memory job store (sufficient for single-instance deployment)
_jobs: dict[str, dict] = {}

# Limit concurrent solves to 1 — running multiple large trees simultaneously causes SIGSEGV
_semaphore = asyncio.Semaphore(1)

# 4MB line buffer — solver progress bars produce very long lines (no newline until iteration ends)
_STREAM_LIMIT = 4 * 1024 * 1024

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
                limit=_STREAM_LIMIT,
                cwd=str(SOLVER_BIN.parent),  # must run from /app to find resources/
            )

            async for raw_line in proc.stdout:
                line = raw_line.decode("utf-8", errors="replace").rstrip()
                # Only keep lines that contain useful info (iteration results, not progress bars)
                if any(kw in line for kw in ("Iter:", "exploitability", "time used", "SOLVING", "START")):
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


async def run_solver_path(cfg_path: Path, result_file: Path, work_dir: Path) -> None:
    """Run the solver binary for an arbitrary config path (used by trainer spot solving).
    Output is discarded — result goes directly to result_file."""
    async with _semaphore:
        try:
            proc = await asyncio.create_subprocess_exec(
                str(SOLVER_BIN),
                "-i", str(cfg_path),
                stdout=asyncio.subprocess.DEVNULL,  # discard all output; avoids StreamReader overflow
                stderr=asyncio.subprocess.DEVNULL,
                cwd=str(SOLVER_BIN.parent),  # must run from /app to find resources/
            )
            await proc.wait()
            if proc.returncode != 0:
                raise RuntimeError(f"Solver exited with code {proc.returncode}")
        except Exception:
            raise


def load_result(job_id: str) -> dict:
    path = result_path(job_id)
    if not path.exists():
        raise FileNotFoundError(f"Result not found for job {job_id}")
    with open(path, "r") as f:
        return json.load(f)
