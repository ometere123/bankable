#!/usr/bin/env bash
# Starts a fresh LOCAL chain-1990 Hardhat node (fixture for end-to-end tests of the live runner). Prints the node PID.
set -euo pipefail
cd "$(dirname "$0")/../../contracts"
for p in $(pgrep -f "hardhat/internal/cli/bootstrap.js node" || true); do kill "$p"; done; sleep 1
HARDHAT_CHAIN_ID=1990 HARDHAT_INITIAL_DATE=2025-12-01T00:00:00Z NODE_NO_WARNINGS=1 nohup npx hardhat node --hostname 127.0.0.1 --port 8545 > "${1:-/tmp/hhnode.log}" 2>&1 &
echo $! ; sleep 8
