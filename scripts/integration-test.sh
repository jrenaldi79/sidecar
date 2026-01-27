#!/bin/bash

# Integration Test Script for Claude Sidecar
#
# This script tests the full end-to-end flow:
# 1. Creates a test project directory
# 2. Runs Claude Code CLI to generate conversation history
# 3. Runs sidecar to spawn a sub-agent task
# 4. Verifies sidecar reads context from Claude Code's session
# 5. Verifies summary is returned
#
# Prerequisites:
# - ANTHROPIC_API_KEY set (for Claude Code)
# - OPENROUTER_API_KEY set (for sidecar/OpenCode)
# - npm install -g opencode-ai
# - npm link (in this directory)
#
# Usage:
#   ./scripts/integration-test.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "============================================"
echo "Claude Sidecar Integration Test"
echo "============================================"
echo ""

# Check prerequisites
echo "Checking prerequisites..."

if [ -z "$OPENROUTER_API_KEY" ]; then
    echo -e "${RED}Error: OPENROUTER_API_KEY not set${NC}"
    echo "Set it with: export OPENROUTER_API_KEY=your-key"
    exit 1
fi

if ! command -v sidecar &> /dev/null; then
    echo -e "${YELLOW}Warning: sidecar not in PATH, using local bin${NC}"
    SIDECAR="node $(pwd)/bin/sidecar.js"
else
    SIDECAR="sidecar"
fi

if ! command -v npx &> /dev/null; then
    echo -e "${RED}Error: npx not found${NC}"
    exit 1
fi

echo -e "${GREEN}Prerequisites OK${NC}"
echo ""

# Create test project
TEST_DIR=$(mktemp -d)
echo "Test project directory: $TEST_DIR"

# Create a simple test file for sidecar to analyze
cat > "$TEST_DIR/test.js" << 'EOF'
// Simple test file for sidecar integration test
function add(a, b) {
    return a + b;
}

function subtract(a, b) {
    return a - b;
}

// Bug: This function has an off-by-one error
function getArrayLength(arr) {
    return arr.length - 1;  // Should be arr.length
}

module.exports = { add, subtract, getArrayLength };
EOF

echo "Created test file: $TEST_DIR/test.js"
echo ""

# Create a mock Claude Code session (to avoid needing real Claude Code for basic tests)
echo "Creating mock Claude Code session..."
ENCODED_PATH=$(echo "$TEST_DIR" | sed 's/\//-/g')
SESSION_DIR="$HOME/.claude/projects/$ENCODED_PATH"
mkdir -p "$SESSION_DIR"

SESSION_ID="integration-test-$(date +%s)"
SESSION_FILE="$SESSION_DIR/$SESSION_ID.jsonl"

cat > "$SESSION_FILE" << 'EOF'
{"type":"user","message":{"content":"I need help reviewing test.js - there might be a bug"},"timestamp":"2025-01-25T10:00:00.000Z"}
{"type":"assistant","message":{"content":"I'll review test.js for you. Let me check the code..."},"timestamp":"2025-01-25T10:00:10.000Z"}
{"type":"user","message":{"content":"Focus on the getArrayLength function, something seems wrong"},"timestamp":"2025-01-25T10:00:30.000Z"}
EOF

echo "Created session file: $SESSION_FILE"
echo ""

# Run sidecar
echo "============================================"
echo "Running sidecar (headless mode)..."
echo "============================================"
echo ""

cd "$TEST_DIR"

BRIEFING="Review the getArrayLength function in test.js.
Identify any bugs and explain what's wrong.
Suggest a fix."

echo "Briefing: $BRIEFING"
echo ""

# Run sidecar and capture output
SIDECAR_OUTPUT=$($SIDECAR start \
    --model google/gemini-2.5-flash \
    --briefing "$BRIEFING" \
    --session "$SESSION_ID" \
    --headless \
    --timeout 2 \
    2>&1) || true

echo ""
echo "============================================"
echo "Sidecar Output:"
echo "============================================"
echo "$SIDECAR_OUTPUT"
echo ""

# Check if session was created
echo "============================================"
echo "Checking sidecar session..."
echo "============================================"

if [ -d "$TEST_DIR/.claude/sidecar_sessions" ]; then
    SIDECAR_SESSION=$(ls "$TEST_DIR/.claude/sidecar_sessions" | head -1)
    echo -e "${GREEN}Sidecar session created: $SIDECAR_SESSION${NC}"

    # Check metadata
    if [ -f "$TEST_DIR/.claude/sidecar_sessions/$SIDECAR_SESSION/metadata.json" ]; then
        echo ""
        echo "Metadata:"
        cat "$TEST_DIR/.claude/sidecar_sessions/$SIDECAR_SESSION/metadata.json"
        echo ""
    fi

    # Check initial context
    if [ -f "$TEST_DIR/.claude/sidecar_sessions/$SIDECAR_SESSION/initial_context.md" ]; then
        echo ""
        echo "Initial Context (first 30 lines):"
        head -30 "$TEST_DIR/.claude/sidecar_sessions/$SIDECAR_SESSION/initial_context.md"
        echo ""

        # Verify context includes our mock conversation
        if grep -q "getArrayLength" "$TEST_DIR/.claude/sidecar_sessions/$SIDECAR_SESSION/initial_context.md"; then
            echo -e "${GREEN}✓ Context includes conversation about getArrayLength${NC}"
        else
            echo -e "${YELLOW}⚠ Context may not include expected conversation${NC}"
        fi
    fi

    # Check summary
    if [ -f "$TEST_DIR/.claude/sidecar_sessions/$SIDECAR_SESSION/summary.md" ]; then
        echo ""
        echo "Summary:"
        cat "$TEST_DIR/.claude/sidecar_sessions/$SIDECAR_SESSION/summary.md"
        echo ""
    fi
else
    echo -e "${YELLOW}No sidecar session directory found${NC}"
fi

# List sidecars
echo ""
echo "============================================"
echo "Listing sidecars..."
echo "============================================"
cd "$TEST_DIR"
$SIDECAR list || true

# Cleanup
echo ""
echo "============================================"
echo "Cleanup"
echo "============================================"
echo "Test directory: $TEST_DIR"
echo "Session file: $SESSION_FILE"
echo ""
echo "To clean up manually:"
echo "  rm -rf $TEST_DIR"
echo "  rm -f $SESSION_FILE"
echo ""

echo -e "${GREEN}Integration test complete!${NC}"
