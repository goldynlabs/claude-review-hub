#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
node scripts/dev.mjs "$@"
