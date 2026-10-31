#!/usr/bin/env bash
# Starter Tollbugata Profits-webappen.
# Eksempler:
#   ./start.sh                 # åpner http://127.0.0.1:8501 i nettleseren
#   ./start.sh --no-browser    # start uten å åpne nettleseren
#   ./start.sh --port 9000     # velg annen port
set -euo pipefail

cd "$(dirname "$0")"

if [ -x .venv/bin/python ]; then
    PYTHON=.venv/bin/python
else
    PYTHON=python3
fi

exec "$PYTHON" app.py "$@"
