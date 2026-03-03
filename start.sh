#!/bin/sh
# Re-exec with bash if running under sh (happens when CRLF corrupts shebang)
[ -z "$BASH_VERSION" ] && exec bash "$0" "$@"

# =============================================================================
# OpenPoker -- Laptop startup script (WSL2 / Linux, RTX4060)
# Default test model: qwen2.5:7b
#
# Usage:
#   ./start.sh              first run  (install ollama, pull models, build)
#   ./start.sh --fast       skip pull/build, just start containers
#   ./start.sh --rebuild    force docker rebuild, keep DB data
#   ./start.sh --reset      wipe DB volumes + rebuild from scratch
#   ./start.sh --model=X    override chat model
# =============================================================================

set -eu

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
CHAT_MODEL="${OLLAMA_MODEL:-qwen2.5:7b}"
EMBED_MODEL="${OLLAMA_EMBED_MODEL:-nomic-embed-text}"
OLLAMA_PORT=11434
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$SCRIPT_DIR/.logs"

FAST=false
REBUILD=false
RESET=false

# ---------------------------------------------------------------------------
# Colours (disabled if not a terminal)
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; CYAN=''; BOLD=''; NC=''
fi

log_info()  { printf "${CYAN}[INFO]${NC}  %s\n" "$*"; }
log_ok()    { printf "${GREEN}[OK]${NC}    %s\n" "$*"; }
log_warn()  { printf "${YELLOW}[WARN]${NC}  %s\n" "$*"; }
log_error() { printf "${RED}[ERROR]${NC} %s\n" "$*" >&2; exit 1; }
log_step()  { printf "\n${BOLD}%s${NC}\n" "==> $*"; }

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --fast)     FAST=true ;;
    --rebuild)  REBUILD=true ;;
    --reset)    RESET=true ;;
    --model=*)  CHAT_MODEL="${arg#--model=}" ;;
    --help|-h)
      printf "Usage: %s [--fast] [--rebuild] [--reset] [--model=NAME]\n\n" "$0"
      printf "  --fast        Skip model pull and docker build\n"
      printf "  --rebuild     Force docker image rebuild (keeps DB data)\n"
      printf "  --reset       Wipe all DB volumes and rebuild from scratch\n"
      printf "  --model=X     Override chat model  (default: qwen2.5:7b)\n\n"
      printf "  Environment overrides:\n"
      printf "    OLLAMA_MODEL=qwen2.5:14b ./start.sh\n"
      exit 0 ;;
    *)
      log_error "Unknown argument: $arg  (run with --help for usage)" ;;
  esac
done

mkdir -p "$LOG_DIR"

# ---------------------------------------------------------------------------
# 1. Detect environment
# ---------------------------------------------------------------------------
log_step "Detecting environment"

IS_WSL=false
if grep -qi microsoft /proc/version 2>/dev/null; then
  IS_WSL=true
  log_ok "Running inside WSL2"
else
  log_ok "Running on native Linux"
fi

if command -v nvidia-smi >/dev/null 2>&1; then
  GPU_INFO=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -1 || printf "unknown")
  log_ok "GPU: $GPU_INFO"
else
  log_warn "nvidia-smi not found -- Ollama will use CPU (inference will be slow)"
fi

# ---------------------------------------------------------------------------
# 2. Install Ollama if missing
# ---------------------------------------------------------------------------
log_step "Checking Ollama"

if command -v ollama >/dev/null 2>&1; then
  log_ok "Ollama already installed: $(ollama --version 2>&1 | head -1)"
else
  log_info "Ollama not found -- installing via official script..."
  if ! command -v curl >/dev/null 2>&1; then
    log_error "curl is required to install Ollama. Install it with: sudo apt install curl"
  fi
  curl -fsSL https://ollama.com/install.sh | sh
  log_ok "Ollama installed: $(ollama --version 2>&1 | head -1)"
fi

# ---------------------------------------------------------------------------
# 3. Start Ollama server
# ---------------------------------------------------------------------------
log_step "Starting Ollama server"

ollama_running() {
  curl -sf "http://localhost:${OLLAMA_PORT}/api/tags" >/dev/null 2>&1
}

if ollama_running; then
  log_ok "Ollama already running on port $OLLAMA_PORT"
else
  # Try systemd first (native Linux), fall back to manual start (WSL2)
  if systemctl is-active --quiet ollama 2>/dev/null; then
    log_ok "Ollama systemd service is active"
  else
    OLLAMA_LOG="$LOG_DIR/ollama.log"
    log_info "Starting Ollama in background (log: $OLLAMA_LOG)..."
    nohup ollama serve >"$OLLAMA_LOG" 2>&1 &
    printf "%s\n" "$!" >"$LOG_DIR/ollama.pid"

    log_info "Waiting for Ollama to be ready (up to 30s)..."
    i=0
    while [ "$i" -lt 30 ]; do
      if ollama_running; then
        log_ok "Ollama is ready"
        break
      fi
      i=$((i + 1))
      if [ "$i" -eq 30 ]; then
        log_error "Ollama did not start in 30s. Check: $OLLAMA_LOG"
      fi
      sleep 1
    done
  fi
fi

# ---------------------------------------------------------------------------
# 4. Pull models
# ---------------------------------------------------------------------------
log_step "Pulling AI models"

if [ "$FAST" = "true" ]; then
  log_warn "--fast: skipping model pull"
else
  log_info "Pulling chat model: $CHAT_MODEL"
  log_info "(First download can be 4-8 GB -- this may take a few minutes)"
  ollama pull "$CHAT_MODEL"
  log_ok "Chat model ready: $CHAT_MODEL"

  log_info "Pulling embedding model: $EMBED_MODEL"
  ollama pull "$EMBED_MODEL"
  log_ok "Embedding model ready: $EMBED_MODEL"
fi

# Sanity check
MODEL_BASE="${CHAT_MODEL%%:*}"
if ollama list 2>/dev/null | grep -q "$MODEL_BASE"; then
  log_ok "Model verified in Ollama: $CHAT_MODEL"
else
  log_warn "Model '$CHAT_MODEL' not listed yet -- it may still be downloading"
fi

# ---------------------------------------------------------------------------
# 5. Check Docker
# ---------------------------------------------------------------------------
log_step "Checking Docker"

if ! command -v docker >/dev/null 2>&1; then
  log_error "Docker not found. Install Docker Desktop (Windows + WSL2 backend): https://docs.docker.com/desktop/windows/"
fi

if ! docker info >/dev/null 2>&1; then
  log_error "Docker daemon is not responding. Start Docker Desktop first."
fi

log_ok "Docker: $(docker --version)"

if ! docker compose version >/dev/null 2>&1; then
  log_error "docker compose (v2 plugin) not found. Update Docker Desktop to 4.x+."
fi

log_ok "Docker Compose: $(docker compose version)"

# ---------------------------------------------------------------------------
# 6. Start Docker services
# ---------------------------------------------------------------------------
log_step "Starting Docker services"

cd "$SCRIPT_DIR"

export OLLAMA_MODEL="$CHAT_MODEL"
export OLLAMA_EMBED_MODEL="$EMBED_MODEL"
export OLLAMA_BASE_URL="http://host.docker.internal:${OLLAMA_PORT}"

log_info "OLLAMA_MODEL:    $OLLAMA_MODEL"
log_info "OLLAMA_EMBED:    $OLLAMA_EMBED_MODEL"
log_info "OLLAMA_BASE_URL: $OLLAMA_BASE_URL"
printf "\n"

if [ "$RESET" = "true" ]; then
  log_warn "--reset: wiping all Docker volumes (DB data will be lost)..."
  docker compose down --volumes --remove-orphans 2>/dev/null || true
  docker compose up --build -d

elif [ "$REBUILD" = "true" ]; then
  log_info "--rebuild: rebuilding images, keeping DB data..."
  docker compose down --remove-orphans 2>/dev/null || true
  docker compose up --build -d

elif [ "$FAST" = "true" ]; then
  log_info "--fast: starting existing containers..."
  docker compose up -d

else
  # Auto-detect: build only when needed
  if docker compose images 2>/dev/null | grep -q "texassolver\|openpoker"; then
    log_info "Images already built -- starting (use --rebuild to force rebuild)"
    docker compose up -d
  else
    log_info "No images found -- building from scratch..."
    docker compose up --build -d
  fi
fi

# ---------------------------------------------------------------------------
# 7. Wait for each service to become healthy
# ---------------------------------------------------------------------------
log_step "Waiting for services to be healthy"

wait_healthy() {
  local container="$1"
  local label="$2"
  local timeout="${3:-90}"
  local service="${4:-$container}"   # docker compose service name (may differ from container name)
  local elapsed=0

  log_info "Waiting for $label ($container)..."

  while [ "$elapsed" -lt "$timeout" ]; do
    # Check health status
    status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || printf "absent")

    case "$status" in
      healthy)
        log_ok "$label is healthy"
        return 0 ;;
      absent|"")
        # Container may not have a healthcheck -- check if it's at least running
        if docker ps --format='{{.Names}}' 2>/dev/null | grep -qx "$container"; then
          log_ok "$label is running (no healthcheck)"
          return 0
        fi ;;
      starting)
        : ;; # keep waiting
      unhealthy)
        log_warn "$label reported unhealthy -- check: docker compose logs $service"
        return 1 ;;
    esac

    elapsed=$((elapsed + 3))
    sleep 3
  done

  log_warn "$label did not become healthy within ${timeout}s"
  log_warn "  Check logs: docker compose logs $service"
  return 1
}

wait_healthy "texassolver-db"  "PostgreSQL"       60  "postgres"
wait_healthy "texassolver-api" "API (solver)"     90  "solver-api"
wait_healthy "openpoker-ai"    "AI RAG service"   90  "ai-service"
wait_healthy "texassolver-ui"  "Frontend (nginx)" 90  "frontend"

# ---------------------------------------------------------------------------
# 8. Summary
# ---------------------------------------------------------------------------
log_step "Ready"

printf "\n"
printf "  ${GREEN}Frontend:${NC}    http://localhost:3000\n"
printf "  ${GREEN}AI chat:${NC}     http://localhost:3000/ai\n"
printf "  ${GREEN}API docs:${NC}    http://localhost:8000/docs\n"
printf "  ${GREEN}AI service:${NC}  http://localhost:5001/health\n"
printf "  ${GREEN}Ollama:${NC}      http://localhost:%s\n" "$OLLAMA_PORT"
printf "\n"
printf "  ${CYAN}Chat model:${NC}  %s\n" "$OLLAMA_MODEL"
printf "  ${CYAN}Embed model:${NC} %s\n" "$OLLAMA_EMBED_MODEL"
printf "\n"
printf "  ${YELLOW}Useful commands:${NC}\n"
printf "    docker compose logs -f solver-api   # API logs\n"
printf "    docker compose logs -f ai-service   # RAG service logs\n"
if [ -f "$LOG_DIR/ollama.log" ]; then
printf "    tail -f %s  # Ollama logs\n" "$LOG_DIR/ollama.log"
fi
printf "\n"
printf "  ${YELLOW}Stop everything:${NC}\n"
printf "    docker compose down\n"
if [ -f "$LOG_DIR/ollama.pid" ]; then
printf "    kill \$(cat %s)  # stop Ollama\n" "$LOG_DIR/ollama.pid"
fi
printf "\n"

docker compose ps
