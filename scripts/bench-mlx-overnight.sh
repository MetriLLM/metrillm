#!/usr/bin/env bash
# Overnight MLX benchmark script for LM Studio
# Downloads, benchmarks, and cleans up MLX models one by one
# Max 12B params, non-thinking mode, MLX priority
# Cleans up each model after bench to avoid disk saturation
set -euo pipefail

cd "$(dirname "$0")/.."

LOG_FILE="scripts/mlx-bench-$(date +%Y%m%d-%H%M%S).log"
touch "$LOG_FILE"

MIN_DISK_GB=15  # Minimum free disk space before downloading a new model

log() {
  echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# Load env vars for Supabase upload
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

check_disk_space() {
  local free_gb
  free_gb=$(df -g / | tail -1 | awk '{print $4}')
  if [ "$free_gb" -lt "$MIN_DISK_GB" ]; then
    log "WARNING: Only ${free_gb} GB free (minimum: ${MIN_DISK_GB} GB). Skipping download."
    return 1
  fi
  log "Disk space OK: ${free_gb} GB free"
  return 0
}

BENCH_CMD=(npm run dev -- bench --backend lm-studio --no-thinking --share --ci-no-menu)
FAILED=()
SUCCEEDED=()
SKIPPED=()

bench_loaded_model() {
  local model_id="$1"
  local desc="$2"

  log "━━━ Benchmarking: $desc ($model_id) ━━━"

  # Unload everything, then load the target
  lms unload --all 2>&1 | tee -a "$LOG_FILE" || true
  sleep 3
  log "Loading $model_id..."
  lms load "$model_id" 2>&1 | tee -a "$LOG_FILE" || true
  sleep 5

  # Run benchmark
  if "${BENCH_CMD[@]}" --model "$model_id" 2>&1 | tee -a "$LOG_FILE"; then
    log "SUCCESS: $desc ($model_id)"
    SUCCEEDED+=("$desc")
  else
    log "FAIL: $desc benchmark error"
    FAILED+=("$desc (bench failed)")
  fi

  # Unload
  lms unload --all 2>&1 | tee -a "$LOG_FILE" || true
  sleep 3
}

download_bench_cleanup() {
  local search_name="$1"
  local max_size_gb="$2"
  local desc="$3"

  log "━━━ Download + Bench + Cleanup: $desc ($search_name, MLX) ━━━"

  # Check disk space
  if ! check_disk_space; then
    SKIPPED+=("$desc (low disk)")
    return 1
  fi

  # Download MLX model (auto-approve)
  log "Downloading $search_name (MLX)..."
  if ! lms get "$search_name" --mlx -y 2>&1 | tee -a "$LOG_FILE"; then
    log "SKIP $desc: download failed or cancelled"
    FAILED+=("$desc (download failed)")
    return 1
  fi

  # Refresh model list and find the newly downloaded model
  sleep 2
  local lms_output
  lms_output=$(lms ls 2>/dev/null)

  # Try to find the model by search name (various patterns)
  local model_id=""

  while IFS= read -r line; do
    local id
    id=$(echo "$line" | awk '{print $1}')

    # Skip header lines, embedding models
    [[ "$id" == "LLM" || "$id" == "EMBEDDING" || "$id" == "You" || -z "$id" ]] && continue

    # Check if this line matches our search name (case-insensitive)
    local search_lower="${search_name,,}"
    local id_lower="${id,,}"
    if [[ "$id_lower" == *"${search_lower//-/}"* ]] || \
       [[ "$id_lower" == *"${search_lower}"* ]] || \
       [[ "$id_lower" == *"$(echo "$search_lower" | sed 's/-/./g')"* ]]; then
      model_id="$id"
      break
    fi
  done <<< "$lms_output"

  if [ -z "$model_id" ]; then
    log "SKIP $desc: could not find model in lms ls after download"
    FAILED+=("$desc (not in lms ls)")
    return 1
  fi

  # Bench it
  bench_loaded_model "$model_id" "$desc"

  # Cleanup: delete the downloaded model to free disk space
  log "Cleaning up $desc..."
  lms unload --all 2>&1 || true
  sleep 2

  # Find and delete the model directory
  local model_dir
  for dir in ~/.lmstudio/models/mlx-community/ ~/.lmstudio/models/lmstudio-community/ ~/.lmstudio/models/*/; do
    if [ -d "$dir" ]; then
      while IFS= read -r -d '' mdir; do
        local dirname
        dirname=$(basename "$mdir")
        local dirname_lower="${dirname,,}"
        if [[ "$dirname_lower" == *"${search_lower//-/}"* ]] || \
           [[ "$dirname_lower" == *"${search_lower}"* ]]; then
          local size_before
          size_before=$(du -sh "$mdir" 2>/dev/null | awk '{print $1}')
          rm -rf "$mdir"
          log "  Deleted $dirname ($size_before)"
        fi
      done < <(find "$dir" -maxdepth 1 -type d -print0 2>/dev/null)
    fi
  done

  return 0
}

# ── Main ──

log "╔════════════════════════════════════════════╗"
log "║  MetriLLM — MLX Overnight Benchmark       ║"
log "║  $(date '+%Y-%m-%d %H:%M')                            ║"
log "║  Backend: LM Studio | Mode: --no-thinking ║"
log "║  Strategy: download → bench → delete      ║"
log "╚════════════════════════════════════════════╝"
log ""

# ── Phase 1: Bench phi-4-mini-reasoning (already downloaded) ──
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "  Phase 1: Bench already-downloaded model"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log ""

bench_loaded_model "microsoft/phi-4-mini-reasoning" "Phi 4 Mini Reasoning (3.8B MLX)"

# Cleanup phi-4-mini after bench
log "Cleaning up Phi 4 Mini..."
rm -rf ~/.lmstudio/models/lmstudio-community/Phi-4-mini-reasoning-MLX-4bit 2>/dev/null && log "  Deleted phi-4-mini (2 Go)" || true
log ""

# ── Phase 2: Download, bench, and cleanup MLX models one by one ──
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "  Phase 2: Download → Bench → Cleanup (MLX)"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log ""

# Format: "search_name|max_size_gb|description"
# Priority: MLX models, max 12B, no-thinking mode
# Alternating sizes to keep things interesting
NEW_MODELS=(
  # ── Phi family ──
  "phi-4-mini|4|Phi 4 Mini 3.8B"

  # ── Mistral family ──
  "mistral-7b-instruct|7|Mistral 7B Instruct v0.3"
  "mistral-nemo-instruct|10|Mistral Nemo 12B"

  # ── Qwen 2.5 family (not yet benched) ──
  "qwen2.5-7b-instruct|7|Qwen 2.5 7B Instruct"
  "qwen2.5-3b-instruct|4|Qwen 2.5 3B Instruct"
  "qwen2.5-1.5b-instruct|3|Qwen 2.5 1.5B Instruct"
  "qwen2.5-coder-7b-instruct|7|Qwen 2.5 Coder 7B"

  # ── DeepSeek R1 distills ──
  "deepseek-r1-distill-qwen-7b|7|DeepSeek R1 Distill Qwen 7B"

  # ── Gemma 2 family ──
  "gemma-2-9b|8|Gemma 2 9B IT"
  "gemma-2-2b|3|Gemma 2 2B IT"

  # ── Small models ──
  "smollm2-1.7b-instruct|3|SmolLM2 1.7B"

  # ── Llama family (new versions) ──
  "llama-3.3-8b|7|Llama 3.3 8B"

  # ── StarCoder / code models ──
  "starcoder2-7b|7|StarCoder2 7B"

  # ── InternLM ──
  "internlm2.5-7b-chat|7|InternLM 2.5 7B"
)

for entry in "${NEW_MODELS[@]}"; do
  IFS='|' read -r search_name max_gb desc <<< "$entry"
  download_bench_cleanup "$search_name" "$max_gb" "$desc" || true
  log ""
done

# ── Summary ──
log ""
log "╔════════════════════════════════════════════╗"
log "║  Overnight Session Complete                ║"
log "║  $(date '+%Y-%m-%d %H:%M')                            ║"
log "╚════════════════════════════════════════════╝"
log ""
log "Succeeded (${#SUCCEEDED[@]}):"
for m in "${SUCCEEDED[@]}"; do
  log "  ✓ $m"
done
if [ ${#FAILED[@]} -gt 0 ]; then
  log ""
  log "Failed (${#FAILED[@]}):"
  for m in "${FAILED[@]}"; do
    log "  ✗ $m"
  done
fi
if [ ${#SKIPPED[@]} -gt 0 ]; then
  log ""
  log "Skipped (${#SKIPPED[@]}):"
  for m in "${SKIPPED[@]}"; do
    log "  ○ $m"
  done
fi
log ""
log "Full log: $LOG_FILE"
log "Done!"
