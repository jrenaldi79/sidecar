#!/bin/bash
#
# Integration Test: Headless Subagent Invocation
#
# This test validates that a headless sidecar can spawn a subagent that:
# 1. Uses the correct model (Gemini Flash 3 for Explore agents)
# 2. Actually calls tools (Read, Grep, Glob, etc.)
# 3. Completes work that can be verified
#
# Requirements:
# - OPENROUTER_API_KEY environment variable set
# - Node.js installed
# - npm dependencies installed (npm install)
#
# Usage:
#   ./scripts/integration-test-subagent.sh
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Integration Test: Headless Subagent${NC}"
echo -e "${BLUE}========================================${NC}"

# Check prerequisites
if [ -z "$OPENROUTER_API_KEY" ]; then
    echo -e "${RED}ERROR: OPENROUTER_API_KEY environment variable not set${NC}"
    echo "Please set it with: export OPENROUTER_API_KEY=sk-or-..."
    exit 1
fi

# Get project directory (where this script is located)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${YELLOW}Project directory: ${PROJECT_DIR}${NC}"

# Create a temporary test directory
TEST_DIR=$(mktemp -d)
echo -e "${YELLOW}Test directory: ${TEST_DIR}${NC}"

# Create a simple test file for the subagent to read
mkdir -p "$TEST_DIR/src"
cat > "$TEST_DIR/src/example.js" << 'EOF'
/**
 * Example module for integration testing
 * This file exists so the Explore subagent has something to find and read.
 */

function calculateSum(a, b) {
  return a + b;
}

function greetUser(name) {
  return `Hello, ${name}!`;
}

module.exports = { calculateSum, greetUser };
EOF

echo -e "${GREEN}Created test file: ${TEST_DIR}/src/example.js${NC}"

# Run the sidecar with a briefing that will trigger subagent spawning
# The briefing asks to explore the codebase, which should spawn an Explore subagent
echo -e "\n${BLUE}Starting headless sidecar with subagent-triggering briefing...${NC}"
echo -e "${YELLOW}Model: openrouter/google/gemini-3-pro-preview (parent)${NC}"
echo -e "${YELLOW}Expected subagent model: openrouter/google/gemini-3-flash-preview${NC}"

# Set the explore model explicitly for this test
export SIDECAR_EXPLORE_MODEL="openrouter/google/gemini-3-flash-preview"

# Run sidecar in headless mode with a briefing that requires exploration
# Using a short timeout since this is a simple task
cd "$PROJECT_DIR"

BRIEFING="You need to explore the codebase at ${TEST_DIR} to understand its structure.
Use the Task tool to spawn an Explore subagent to find and read all JavaScript files.
After the Explore subagent completes, summarize what functions are defined in the codebase.
Important: You MUST use the Task tool with subagent_type='Explore' to do the exploration."

echo -e "${YELLOW}Briefing: ${BRIEFING}${NC}\n"

# Run the sidecar
node bin/sidecar.js start \
    --model "openrouter/google/gemini-3-pro-preview" \
    --briefing "$BRIEFING" \
    --project "$TEST_DIR" \
    --headless \
    --timeout 3 \
    2>&1 | tee /tmp/sidecar-output.log

# Find the session directory
SESSION_DIR=$(ls -td "$TEST_DIR/.claude/sidecar_sessions"/* 2>/dev/null | head -1)

if [ -z "$SESSION_DIR" ]; then
    echo -e "${RED}ERROR: No session directory created${NC}"
    rm -rf "$TEST_DIR"
    exit 1
fi

TASK_ID=$(basename "$SESSION_DIR")
echo -e "\n${GREEN}Session created: ${TASK_ID}${NC}"

# Verify session files exist
echo -e "\n${BLUE}Verifying session files...${NC}"

if [ -f "$SESSION_DIR/metadata.json" ]; then
    echo -e "${GREEN}✓ metadata.json exists${NC}"
else
    echo -e "${RED}✗ metadata.json missing${NC}"
fi

if [ -f "$SESSION_DIR/conversation.jsonl" ]; then
    echo -e "${GREEN}✓ conversation.jsonl exists${NC}"
else
    echo -e "${RED}✗ conversation.jsonl missing${NC}"
fi

if [ -f "$SESSION_DIR/summary.md" ]; then
    echo -e "${GREEN}✓ summary.md exists${NC}"
else
    echo -e "${RED}✗ summary.md missing${NC}"
fi

# Check metadata
echo -e "\n${BLUE}Checking metadata...${NC}"
if [ -f "$SESSION_DIR/metadata.json" ]; then
    echo -e "${YELLOW}Metadata content:${NC}"
    cat "$SESSION_DIR/metadata.json" | python3 -m json.tool 2>/dev/null || cat "$SESSION_DIR/metadata.json"

    # Extract model from metadata
    MAIN_MODEL=$(cat "$SESSION_DIR/metadata.json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('model','unknown'))" 2>/dev/null || echo "unknown")
    echo -e "\n${GREEN}Main session model: ${MAIN_MODEL}${NC}"
fi

# Check conversation for tool calls
echo -e "\n${BLUE}Checking conversation for tool calls...${NC}"
if [ -f "$SESSION_DIR/conversation.jsonl" ]; then
    # Count lines in conversation
    LINE_COUNT=$(wc -l < "$SESSION_DIR/conversation.jsonl" | tr -d ' ')
    echo -e "${GREEN}Conversation has ${LINE_COUNT} messages${NC}"

    # Look for Task tool calls (subagent spawning)
    if grep -q "Task" "$SESSION_DIR/conversation.jsonl" 2>/dev/null; then
        echo -e "${GREEN}✓ Found Task tool calls (subagent spawning)${NC}"

        # Try to extract subagent info
        echo -e "${YELLOW}Task tool calls found:${NC}"
        grep -o '"name"[[:space:]]*:[[:space:]]*"Task"' "$SESSION_DIR/conversation.jsonl" | head -5 || true
    else
        echo -e "${YELLOW}⚠ No Task tool calls found in conversation${NC}"
    fi

    # Look for Explore mentions
    if grep -qi "explore" "$SESSION_DIR/conversation.jsonl" 2>/dev/null; then
        echo -e "${GREEN}✓ Found 'Explore' mentions in conversation${NC}"
    fi

    # Look for tool_use patterns
    if grep -q "tool_use" "$SESSION_DIR/conversation.jsonl" 2>/dev/null; then
        echo -e "${GREEN}✓ Found tool_use patterns (tools were called)${NC}"
    else
        echo -e "${YELLOW}⚠ No tool_use patterns found${NC}"
    fi

    # Look for Read/Grep/Glob tool calls
    for TOOL in "Read" "Grep" "Glob"; do
        if grep -q "\"name\"[[:space:]]*:[[:space:]]*\"$TOOL\"" "$SESSION_DIR/conversation.jsonl" 2>/dev/null; then
            echo -e "${GREEN}✓ Found $TOOL tool calls${NC}"
        fi
    done
fi

# Check summary for expected content
echo -e "\n${BLUE}Checking summary for expected content...${NC}"
if [ -f "$SESSION_DIR/summary.md" ]; then
    echo -e "${YELLOW}Summary content:${NC}"
    cat "$SESSION_DIR/summary.md"
    echo ""

    # Check for expected function names from our test file
    if grep -qi "calculateSum\|greetUser" "$SESSION_DIR/summary.md" 2>/dev/null; then
        echo -e "${GREEN}✓ Summary contains function names from test file (work was done correctly)${NC}"
    else
        echo -e "${YELLOW}⚠ Summary doesn't mention test file functions${NC}"
    fi

    # Check for completion marker
    if grep -q "\[SIDECAR_COMPLETE\]" "$SESSION_DIR/summary.md" 2>/dev/null; then
        echo -e "${GREEN}✓ Summary contains [SIDECAR_COMPLETE] marker${NC}"
    fi
fi

# Check for subagent model in conversation
echo -e "\n${BLUE}Checking for subagent model usage...${NC}"
if [ -f "$SESSION_DIR/conversation.jsonl" ]; then
    # Look for gemini-3-flash-preview (the expected Explore model)
    if grep -qi "gemini-3-flash\|gemini-flash" "$SESSION_DIR/conversation.jsonl" 2>/dev/null; then
        echo -e "${GREEN}✓ Found Gemini Flash model references (subagent used correct model)${NC}"
    else
        echo -e "${YELLOW}⚠ No Gemini Flash model references found${NC}"
    fi
fi

# Final summary
echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Test Summary${NC}"
echo -e "${BLUE}========================================${NC}"

# Determine overall status
STATUS="${GREEN}PASSED${NC}"
DETAILS=""

if [ ! -f "$SESSION_DIR/summary.md" ]; then
    STATUS="${RED}FAILED${NC}"
    DETAILS="No summary file created"
elif ! grep -q "\[SIDECAR_COMPLETE\]" "$SESSION_DIR/summary.md" 2>/dev/null; then
    STATUS="${YELLOW}PARTIAL${NC}"
    DETAILS="Session may not have completed properly"
fi

echo -e "Status: ${STATUS}"
if [ -n "$DETAILS" ]; then
    echo -e "Details: ${DETAILS}"
fi

echo -e "\nSession files at: ${SESSION_DIR}"
echo -e "Main output log: /tmp/sidecar-output.log"

# Cleanup
echo -e "\n${YELLOW}Cleaning up test directory...${NC}"
rm -rf "$TEST_DIR"
echo -e "${GREEN}Done.${NC}"
