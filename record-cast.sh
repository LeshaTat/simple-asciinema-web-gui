#!/bin/bash
LOCKFILE="/tmp/asciinema_rec.lock"
if [ -f "$LOCKFILE" ]; then
  echo "Recording already in progress. Exiting."
  exit 1
fi

trap 'rm -f "$LOCKFILE"' EXIT
touch "$LOCKFILE"

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
asciinema rec "$CAST_FILE" -c "tmux attach || tmux"

# Stop timewarrior tracking when recording ends
if [ -n "$TAGS" ]; then
  timew stop
fi

# Run the maintenance script to compress older recordings
# (but not the one we just created, as it's the newest)
echo "Running maintenance on older recordings..."
npm --prefix "$(dirname "$0")" run maintain

echo "Running indexing..."
npm --prefix "$(dirname "$0")" run index
