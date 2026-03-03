"""Pathway RAG pipeline — watches the docs directory, embeds chunks, serves retrieval."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
from pathlib import Path
from typing import Any

import httpx
import numpy as np

from .config import CHUNK_OVERLAP, CHUNK_SIZE, DOCS_DIR, EMBED_MODEL, OLLAMA_BASE_URL, TOP_K

logger = logging.getLogger("RAG")


# ---------------------------------------------------------------------------
# Simple in-memory vector store (replaces heavy Pathway dependency for
# initial implementation; Pathway can be layered on top later for streaming)
# ---------------------------------------------------------------------------

class VectorStore:
    """Thread-safe in-memory vector store with cosine similarity retrieval."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._chunks: list[dict[str, Any]] = []   # {id, doc_id, text, filename, embedding}

    def upsert_document(self, doc_id: str, filename: str, chunks: list[str], embeddings: list[list[float]]) -> int:
        with self._lock:
            self._chunks = [c for c in self._chunks if c["doc_id"] != doc_id]
            for text, emb in zip(chunks, embeddings):
                self._chunks.append({
                    "id": hashlib.md5(f"{doc_id}:{text[:80]}".encode()).hexdigest(),
                    "doc_id": doc_id,
                    "filename": filename,
                    "text": text,
                    "embedding": emb,
                })
        return len(chunks)

    def remove_document(self, doc_id: str) -> None:
        with self._lock:
            self._chunks = [c for c in self._chunks if c["doc_id"] != doc_id]

    def retrieve(self, query_embedding: list[float], doc_ids: list[str] | None, top_k: int) -> list[dict]:
        with self._lock:
            pool = self._chunks
            if doc_ids:
                pool = [c for c in pool if c["doc_id"] in doc_ids]
            if not pool:
                return []

        q = np.array(query_embedding, dtype=np.float32)
        q_norm = q / (np.linalg.norm(q) + 1e-10)

        scored = []
        for chunk in pool:
            v = np.array(chunk["embedding"], dtype=np.float32)
            v_norm = v / (np.linalg.norm(v) + 1e-10)
            score = float(np.dot(q_norm, v_norm))
            scored.append((score, chunk))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [{"score": s, "text": c["text"], "filename": c["filename"], "doc_id": c["doc_id"]}
                for s, c in scored[:top_k]]

    @property
    def chunk_count(self) -> int:
        with self._lock:
            return len(self._chunks)

    def doc_ids(self) -> list[str]:
        with self._lock:
            return list({c["doc_id"] for c in self._chunks})


# Global store instance
store = VectorStore()


# ---------------------------------------------------------------------------
# Text chunking
# ---------------------------------------------------------------------------

def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping word-based chunks."""
    words = text.split()
    if not words:
        return []
    chunks = []
    start = 0
    while start < len(words):
        end = min(start + size, len(words))
        chunks.append(" ".join(words[start:end]))
        if end == len(words):
            break
        start += size - overlap
    return chunks


# ---------------------------------------------------------------------------
# PDF / text extraction
# ---------------------------------------------------------------------------

def extract_text(file_path: str, content_type: str) -> str:
    """Extract plain text from a PDF or text file."""
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(file_path)

    if content_type == "pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(str(path))
            pages = [page.extract_text() or "" for page in reader.pages]
            return "\n\n".join(pages)
        except Exception as exc:
            logger.error("PDF extraction failed for %s: %s", file_path, exc)
            return ""
    else:
        return path.read_text(encoding="utf-8", errors="replace")


# ---------------------------------------------------------------------------
# Ollama embeddings
# ---------------------------------------------------------------------------

def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a list of texts using the Ollama embedding endpoint (sync)."""
    embeddings = []
    url = f"{OLLAMA_BASE_URL}/api/embed"
    with httpx.Client(timeout=120.0) as client:
        for text in texts:
            try:
                resp = client.post(url, json={"model": EMBED_MODEL, "input": text})
                resp.raise_for_status()
                data = resp.json()
                # Ollama /api/embed returns {"embeddings": [[...]]}
                emb = data.get("embeddings", [[]])[0]
                embeddings.append(emb)
            except Exception as exc:
                logger.error("Embedding failed: %s", exc)
                embeddings.append([])
    return embeddings


async def embed_texts_async(texts: list[str]) -> list[list[float]]:
    """Async wrapper around Ollama embedding."""
    embeddings = []
    url = f"{OLLAMA_BASE_URL}/api/embed"
    async with httpx.AsyncClient(timeout=120.0) as client:
        for text in texts:
            try:
                resp = await client.post(url, json={"model": EMBED_MODEL, "input": text})
                resp.raise_for_status()
                data = resp.json()
                emb = data.get("embeddings", [[]])[0]
                embeddings.append(emb)
            except Exception as exc:
                logger.error("Embedding failed: %s", exc)
                embeddings.append([])
    return embeddings


# ---------------------------------------------------------------------------
# Index a document
# ---------------------------------------------------------------------------

async def index_document(doc_id: str, filename: str, file_path: str, content_type: str) -> int:
    """Extract, chunk, embed and store a document. Returns number of chunks."""
    text = extract_text(file_path, content_type)
    if not text.strip():
        logger.warning("No text extracted from %s", filename)
        store.remove_document(doc_id)
        return 0

    chunks = chunk_text(text)
    if not chunks:
        return 0

    logger.info("Indexing %s: %d chunks", filename, len(chunks))
    embeddings = await embed_texts_async(chunks)
    count = store.upsert_document(doc_id, filename, chunks, embeddings)
    logger.info("Indexed %s: %d chunks stored", filename, count)
    return count


def remove_document(doc_id: str) -> None:
    store.remove_document(doc_id)


async def retrieve(query: str, doc_ids: list[str] | None, top_k: int = TOP_K) -> list[dict]:
    """Embed query and retrieve top-k chunks."""
    embeddings = await embed_texts_async([query])
    if not embeddings or not embeddings[0]:
        return []
    return store.retrieve(embeddings[0], doc_ids, top_k)
