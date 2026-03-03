"""Configuration for the Pathway RAG service."""

import os

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
DOCS_DIR = os.getenv("DOCS_DIR", "/app/ai_docs")
PORT = int(os.getenv("PORT", "5001"))
TOP_K = int(os.getenv("RAG_TOP_K", "6"))
CHUNK_SIZE = int(os.getenv("RAG_CHUNK_SIZE", "512"))
CHUNK_OVERLAP = int(os.getenv("RAG_CHUNK_OVERLAP", "64"))
