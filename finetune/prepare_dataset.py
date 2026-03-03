#!/usr/bin/env python3
"""
Prepare fine-tuning dataset from exported JSONL.

Converts the export_data.py output into training formats:
  - Alpaca (for llama.cpp fine-tuning via scripts/finetune.py)
  - ChatML (for Ollama-compatible models via Unsloth / MLX-LM)
  - GGUF-ready splits (train/val/test)

Usage:
    python prepare_dataset.py --input data/export.jsonl \
                               --output-dir data/prepared \
                               --format chatml \
                               --supervised-only
"""

import argparse
import json
import os
import random
import sys
from pathlib import Path


def load_jsonl(path: str) -> list[dict]:
    records = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return records


def to_alpaca(record: dict) -> dict:
    """Alpaca format: {instruction, input, output}"""
    return {
        "instruction": record.get("instruction", ""),
        "input": record.get("input", ""),
        "output": record.get("output", ""),
    }


def to_chatml(record: dict) -> dict:
    """ChatML format: {messages: [{role, content}]}"""
    messages = []
    system = record.get("system", "")
    if system:
        messages.append({"role": "system", "content": system})
    instruction = record.get("instruction", "")
    inp = record.get("input", "")
    user_content = instruction
    if inp:
        user_content = f"{instruction}\n\n{inp}"
    messages.append({"role": "user", "content": user_content})
    messages.append({"role": "assistant", "content": record.get("output", "")})
    return {"messages": messages}


def to_llama3_instruct(record: dict) -> str:
    """Llama 3 instruct format (for direct text fine-tuning with llama.cpp)."""
    system = record.get("system", "")
    instruction = record.get("instruction", "")
    inp = record.get("input", "")
    output = record.get("output", "")
    user = f"{instruction}\n\n{inp}" if inp else instruction
    parts = []
    if system:
        parts.append(f"<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n{system}<|eot_id|>")
    parts.append(f"<|start_header_id|>user<|end_header_id|>\n\n{user}<|eot_id|>")
    parts.append(f"<|start_header_id|>assistant<|end_header_id|>\n\n{output}<|eot_id|>")
    return "".join(parts)


def split_dataset(records: list[dict], train_ratio: float = 0.9, val_ratio: float = 0.05) -> tuple[list, list, list]:
    shuffled = records.copy()
    random.shuffle(shuffled)
    n = len(shuffled)
    train_end = int(n * train_ratio)
    val_end = train_end + int(n * val_ratio)
    return shuffled[:train_end], shuffled[train_end:val_end], shuffled[val_end:]


def write_jsonl(records: list[dict], path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"  Wrote {len(records)} records to {path}")


def write_text(lines: list[str], path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"  Wrote {len(lines)} text records to {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare fine-tuning dataset")
    parser.add_argument("--input", required=True, help="Input JSONL from export_data.py")
    parser.add_argument("--output-dir", default="data/prepared", help="Output directory")
    parser.add_argument("--format", choices=["alpaca", "chatml", "llama3"], default="chatml",
                        help="Output format: alpaca (llama.cpp), chatml (Unsloth/MLX), llama3 (text)")
    parser.add_argument("--supervised-only", action="store_true",
                        help="Only include records marked as supervised (has expert output)")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    random.seed(args.seed)

    print(f"Loading {args.input}...")
    records = load_jsonl(args.input)
    print(f"  Loaded {len(records)} records")

    if args.supervised_only:
        records = [r for r in records if r.get("metadata", {}).get("supervised", True)]
        print(f"  After supervised filter: {len(records)} records")

    if not records:
        print("No records to process. Exiting.")
        sys.exit(0)

    train, val, test = split_dataset(records)
    print(f"  Split: {len(train)} train / {len(val)} val / {len(test)} test")

    out = args.output_dir
    fmt = args.format

    if fmt == "alpaca":
        for split_name, split_data in [("train", train), ("val", val), ("test", test)]:
            converted = [to_alpaca(r) for r in split_data]
            write_jsonl(converted, f"{out}/alpaca_{split_name}.jsonl")

    elif fmt == "chatml":
        for split_name, split_data in [("train", train), ("val", val), ("test", test)]:
            converted = [to_chatml(r) for r in split_data]
            write_jsonl(converted, f"{out}/chatml_{split_name}.jsonl")

    elif fmt == "llama3":
        for split_name, split_data in [("train", train), ("val", val), ("test", test)]:
            lines = [to_llama3_instruct(r) for r in split_data]
            write_text(lines, f"{out}/llama3_{split_name}.txt")

    print(f"\nDataset prepared in {out}/")
    print("Next steps:")
    print("  - For MLX fine-tuning (Mac):  mlx_lm.lora --model <hf-model> --train --data data/prepared/")
    print("  - For llama.cpp fine-tuning:  see llama.cpp/examples/finetune/")
    print("  - For Unsloth:               see https://github.com/unslothai/unsloth")
    print("  After training, convert to GGUF and load with: ollama create my-poker-coach -f Modelfile")


if __name__ == "__main__":
    main()
