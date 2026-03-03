"""Pathway RAG service — FastAPI app exposing /retrieve and /index endpoints."""

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import pipeline
from .config import DOCS_DIR, PORT

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("RAG-API")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path(DOCS_DIR).mkdir(parents=True, exist_ok=True)
    logger.info("RAG service ready. Docs dir: %s", DOCS_DIR)
    yield


app = FastAPI(title="OpenPoker RAG Service", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class RetrieveRequest(BaseModel):
    query: str
    doc_ids: Optional[list[str]] = None
    top_k: int = 6


class RetrieveResult(BaseModel):
    score: float
    text: str
    filename: str
    doc_id: str


class IndexRequest(BaseModel):
    doc_id: str
    filename: str
    file_path: str
    content_type: str  # "pdf" | "text"


class RemoveRequest(BaseModel):
    doc_id: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "chunks_indexed": pipeline.store.chunk_count,
        "documents": pipeline.store.doc_ids(),
    }


@app.post("/retrieve", response_model=list[RetrieveResult])
async def retrieve(req: RetrieveRequest) -> list[RetrieveResult]:
    """Semantic search over indexed documents."""
    if not req.query.strip():
        return []
    results = await pipeline.retrieve(req.query, req.doc_ids, req.top_k)
    return [RetrieveResult(**r) for r in results]


@app.post("/index")
async def index(req: IndexRequest) -> dict:
    """Index (or re-index) a document. Runs embedding synchronously."""
    if not Path(req.file_path).exists():
        raise HTTPException(status_code=404, detail=f"File not found: {req.file_path}")
    chunk_count = await pipeline.index_document(
        doc_id=req.doc_id,
        filename=req.filename,
        file_path=req.file_path,
        content_type=req.content_type,
    )
    return {"doc_id": req.doc_id, "chunks": chunk_count, "status": "indexed"}


@app.post("/remove")
async def remove(req: RemoveRequest) -> dict:
    """Remove a document from the vector index."""
    pipeline.remove_document(req.doc_id)
    return {"doc_id": req.doc_id, "status": "removed"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=PORT, reload=False)
