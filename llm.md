# OpenPoker — AI / LLM Setup

## Quick start (laptop, RTX4060 8GB)

```bash
# First run — installs Ollama, pulls models, builds Docker
./start.sh

# Subsequent runs — skip pull/rebuild
./start.sh --fast

# Force rebuild images (after code changes, keeps DB data)
./start.sh --rebuild

# Fresh start — wipes DB and rebuilds
./start.sh --reset

# Use a different model
./start.sh --model=mistral-nemo:12b
```

Navigate to **http://localhost:3000/ai** and select a player to chat.

---

## Models

| Machine | Chat model | VRAM | Quality |
|---|---|---|---|
| RTX4060 8GB (test) | `qwen2.5:7b` | ~4.5GB | Good — fast |
| RTX4060 8GB (prod) | `qwen2.5:14b` | ~8.1GB | Better — tight |
| Mac Studio 64GB | `qwen2.5:32b` | ~20GB | Excellent |

Embedding model (for RAG): `nomic-embed-text` (~300MB, CPU)

---

## Mac Studio launch

```bash
# Pull on host
ollama pull qwen2.5:32b
ollama pull nomic-embed-text

# Launch with larger model
OLLAMA_MODEL=qwen2.5:32b ./start.sh --rebuild
```

---

## Manual steps (if start.sh fails)

```bash
# 1. Install Ollama (Linux/WSL2)
curl -fsSL https://ollama.com/install.sh | sh

# 2. Start Ollama
ollama serve &

# 3. Pull models
ollama pull qwen2.5:7b        # test
ollama pull nomic-embed-text  # embeddings

# 4. Start Docker (first time — wipes DB)
docker compose down -v && docker compose up --build

# 4b. Start Docker (subsequent runs — keeps data)
OLLAMA_MODEL=qwen2.5:7b docker compose up --build
```

---

## Troubleshooting

**Ollama not reachable from Docker containers**
```bash
# Check extra_hosts is set in docker-compose.yml for solver-api and ai-service:
#   extra_hosts:
#     - "host.docker.internal:host-gateway"

# Test from inside a container
docker exec texassolver-api curl -s http://host.docker.internal:11434/api/tags
```

**Out of VRAM on RTX4060**
```bash
# Switch to 7b
OLLAMA_MODEL=qwen2.5:7b docker compose up -d
# Or force CPU
OLLAMA_NUM_GPU=0 ollama serve &
```

**RAG embeddings slow**
- `nomic-embed-text` runs on CPU by default — this is normal (~1-3s per chunk)
- Embedding only happens once per document upload; retrieval is fast

**DB schema errors on upgrade**
```bash
docker compose down -v && docker compose up --build
```

**Check AI service logs**
```bash
docker compose logs -f ai-service
docker compose logs -f solver-api
```
