# ─── Stage 1: Build the C++ solver binary ────────────────────────────────────
FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    libgomp1 \
    git \
    python3 \
    python3-dev \
    python3-distutils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy solver source from the submodule (build context = texassolver-web/)
COPY solver/CMakeLists.txt .
COPY solver/src/ src/
COPY solver/include/ include/
COPY solver/ext/ ext/
COPY solver/resources/ resources/
COPY solver/test/ test/

RUN cmake -B build_output -DCMAKE_BUILD_TYPE=Release . \
    && cmake --build build_output --target console_solver -j$(nproc)

# ─── Stage 2: Python FastAPI runtime ─────────────────────────────────────────
FROM python:3.12-slim AS runtime

RUN apt-get update && apt-get install -y \
    libgomp1 \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy compiled binary
COPY --from=builder /build/build_output/console_solver /app/console_solver
RUN chmod +x /app/console_solver

# Copy solver resources (hand ranges, sample files)
COPY --from=builder /build/resources /app/resources

# Install Python dependencies
COPY api/app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy FastAPI application
COPY api/app/ .

# Jobs and results stored here (mount as volume in production)
RUN mkdir -p /app/jobs /app/jobs/library

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
