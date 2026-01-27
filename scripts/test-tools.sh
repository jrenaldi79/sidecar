#!/bin/bash
# Test each OpenCode SDK tool through sidecar CLI
# This script empirically tests which tools are available and working

set -e

MODEL="${SIDECAR_TEST_MODEL:-openrouter/google/gemini-2.5-flash}"
TIMEOUT="${SIDECAR_TEST_TIMEOUT:-5}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SESSION_DIR="$HOME/.claude/sidecar_sessions"

echo "=========================================="
echo "OpenCode SDK Tool Testing via Sidecar CLI"
echo "=========================================="
echo "Model: $MODEL"
echo "Timeout: ${TIMEOUT}m"
echo "Project: $PROJECT_DIR"
echo ""

# Track results
declare -A RESULTS

run_test() {
    local test_name="$1"
    local briefing="$2"

    echo "=== Testing: $test_name ==="
    echo "Briefing: $briefing"
    echo ""

    # Run sidecar in headless mode
    local output
    if output=$(node "$PROJECT_DIR/bin/sidecar.js" start \
        --model "$MODEL" \
        --briefing "$briefing" \
        --headless \
        --timeout "$TIMEOUT" 2>&1); then
        echo "Result: SUCCESS"
        RESULTS["$test_name"]="SUCCESS"
    else
        echo "Result: FAILED"
        RESULTS["$test_name"]="FAILED"
    fi

    echo "Output (first 500 chars):"
    echo "$output" | head -c 500
    echo ""
    echo "---"
    echo ""
}

# Create a test file for edit/write tests
echo "Setting up test environment..."
echo "Original content" > "$PROJECT_DIR/test-tool-output.txt"

# Test 1: READ tool
run_test "read" "Read the file package.json and tell me the project name and version. Report what you found."

# Test 2: WRITE tool
run_test "write" "Create a new file called test-write-result.txt containing exactly: 'Write tool test successful at $(date)'. Confirm when done."

# Test 3: EDIT tool
run_test "edit" "Edit the file test-tool-output.txt and replace 'Original content' with 'Edited by sidecar'. Confirm when done."

# Test 4: LIST tool
run_test "list" "List all JavaScript files in the src/ directory. Show me the filenames you found."

# Test 5: BASH tool
run_test "bash" "Run the command 'node --version' and report the exact output."

# Test 6: WEB_FETCH tool
run_test "web_fetch" "Fetch the URL https://httpbin.org/get and tell me the 'origin' field from the JSON response."

# Test 7: LSP tool (goToDefinition)
run_test "lsp_definition" "Use the LSP goToDefinition feature to find where the function 'buildSystemPrompt' is defined in this project."

# Test 8: LSP tool (findReferences)
run_test "lsp_references" "Use the LSP findReferences feature to find all places where 'buildSystemPrompt' is called."

# Test 9: TODOWRITE/TODOREAD tools
run_test "todo" "Create a todo list with these items: 'Test read tool', 'Test write tool', 'Test bash tool'. Then read the todo list back and show me."

# Test 10: PATCH tool
cat > "$PROJECT_DIR/test-patch.patch" << 'PATCH'
--- a/test-tool-output.txt
+++ b/test-tool-output.txt
@@ -1 +1,2 @@
 Edited by sidecar
+Patched line added
PATCH
run_test "patch" "Apply the patch file test-patch.patch to this project. Confirm if successful."

# Cleanup
echo "Cleaning up test files..."
rm -f "$PROJECT_DIR/test-tool-output.txt"
rm -f "$PROJECT_DIR/test-write-result.txt"
rm -f "$PROJECT_DIR/test-patch.patch"

# Summary
echo ""
echo "=========================================="
echo "TEST RESULTS SUMMARY"
echo "=========================================="
for test_name in "${!RESULTS[@]}"; do
    printf "%-20s %s\n" "$test_name:" "${RESULTS[$test_name]}"
done

echo ""
echo "Check session logs for detailed tool calls:"
echo "ls -la $SESSION_DIR/"
echo ""
echo "To view a session's conversation:"
echo "cat $SESSION_DIR/<task_id>/conversation.jsonl | jq ."
