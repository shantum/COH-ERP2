#!/bin/bash
# Kill all dev processes then start fresh
DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$DIR/dev-kill.sh"
bash "$DIR/dev-start.sh"
