#!/bin/bash

# Create timestamp for the filename
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
CAST_DIR="$(dirname "$0")/public/casts"
CAST_FILE="$CAST_DIR/asciinema_$TIMESTAMP.cast"

# Ensure the casts directory exists
mkdir -p "$CAST_DIR"

# Start recording with asciinema using tmux attach
asciinema rec "$CAST_FILE" -c "tmux attach"