# OpenPoker — Fine-tuning Tooling

Standalone scripts for fine-tuning a local Ollama model on your poker data.

## When to fine-tune

Fine-tuning is **not required** for the AI agent to work well — the base model
already has strong poker knowledge. Fine-tuning is useful when you want:

- The model to always respond in a specific coaching style
- Domain adaptation to your specific stake/format (e.g. 6-max Zoom NL10)
- Improved responses on GTO spot analysis after labelling your trainer sessions

## Data quality requirement

The `export_data.py` script exports two types of records:

| Type | Supervised | Notes |
|---|---|---|
| GTO trainer sessions | Yes — GTO score from solver | Ready to use for fine-tuning |
| Raw hand histories | No — needs expert annotation | Require human review before training |

For effective fine-tuning, you need at minimum **1,000–5,000 supervised records**.
The trainer sessions automatically become supervised once solved by TexasSolver.

## Workflow

### 1. Export data

```bash
pip install -r requirements.txt

# Export supervised trainer sessions only (recommended to start)
python export_data.py \
  --db-url postgresql://solver:solverpass@localhost:5432/solverdb \
  --player "YourPlayerName" \
  --output data/export.jsonl \
  --supervised-only
```

### 2. Prepare dataset

```bash
# ChatML format — best for Qwen2.5, Mistral, Llama 3
python prepare_dataset.py \
  --input data/export.jsonl \
  --output-dir data/prepared \
  --format chatml \
  --supervised-only
```

### 3. Fine-tune

#### Option A: MLX-LM (Mac Studio M2Max — recommended)

```bash
pip install mlx-lm

mlx_lm.lora \
  --model mlx-community/Qwen2.5-14B-Instruct-4bit \
  --train \
  --data data/prepared/ \
  --iters 1000 \
  --batch-size 4 \
  --lora-layers 16
```

#### Option B: Unsloth (Linux/Windows with GPU — RTX4060)

```bash
pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
# See https://github.com/unslothai/unsloth for training script
```

#### Option C: llama.cpp (CPU fine-tuning — slower)

```bash
# Build llama.cpp with CUDA or Metal support
# Run examples/finetune/finetune.cpp with the llama3 format output
```

### 4. Convert to GGUF and load into Ollama

```bash
# MLX path: convert to GGUF
mlx_lm.fuse --model mlx-community/Qwen2.5-14B-Instruct-4bit --adapter-path adapters/
python llama.cpp/convert_hf_to_gguf.py fused_model/ --outfile poker-coach.gguf

# Create Ollama Modelfile
cat > Modelfile <<EOF
FROM ./poker-coach.gguf
SYSTEM "You are an expert poker coach specialised in No-Limit Texas Hold'em GTO strategy."
EOF

ollama create poker-coach -f Modelfile

# Update OLLAMA_MODEL in docker-compose.yml or .env:
# OLLAMA_MODEL=poker-coach
```

## Files

| File | Purpose |
|---|---|
| `export_data.py` | Export hands + trainer sessions from PostgreSQL to JSONL |
| `prepare_dataset.py` | Convert JSONL to Alpaca / ChatML / Llama3 format, split train/val/test |
| `requirements.txt` | Python dependencies (no ML framework — install separately) |
