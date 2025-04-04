#!/bin/bash

# Get all arguments as tags
TAGS="$@"
TAG_SUFFIX=""

# Format tags for filename (replace spaces with hyphens)
if [ -n "$TAGS" ]; then
  TAG_SUFFIX="_tags_$(echo $TAGS | tr ' ' '-')"
fi

# Create timestamp for the filename
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
CAST_DIR="$(dirname "$0")/public/casts"
CAST_FILE="$CAST_DIR/asciinema_$TIMESTAMP$TAG_SUFFIX.cast"

# Ensure the casts directory exists
mkdir -p "$CAST_DIR"

# Start timewarrior tracking with provided tags
if [ -n "$TAGS" ]; then
  timew start $TAGS
fi

# Start recording with asciinema using tmux attach
asciinema rec "$CAST_FILE" -c "tmux attach"

# Stop timewarrior tracking when recording ends
if [ -n "$TAGS" ]; then
  timew stop
fi