#!/bin/bash

# Define directories and paths
setup_environment() {
    WORKING_DIR=$1
    APPNAME=${2:-"defaultApp"}
    ENVIRONMENT=${3:-"defaultEnv"}
    LOG_DIR=$WORKING_DIR
    JSON_OUTPUT_DIR="$WORKING_DIR/tmp/tfjson"
    TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
    CSV_FILE="$LOG_DIR/drift_data_${APPNAME}_${ENVIRONMENT}.csv"
    ERROR_LOG="$LOG_DIR/error.log"
    SUMMARY_LOG="$LOG_DIR/summary_${APPNAME}_${ENVIRONMENT}.log"

    if [[ -z "$WORKING_DIR" || ! -d "$WORKING_DIR" ]]; then
        echo "Error: WORKING_DIR is mandatory and must be a valid directory."
        exit 1
    fi

    mkdir -p "$JSON_OUTPUT_DIR"

    # Debug Logging
    echo "Debug: APPNAME=$APPNAME, ENVIRONMENT=$ENVIRONMENT, WORKING_DIR=$WORKING_DIR"
    echo "Debug: CSV_FILE=$CSV_FILE"
    echo "Debug: SUMMARY_LOG=$SUMMARY_LOG"
}

# Validate JSON Directory
validate_json_directory() {
    if [[ ! -d "$JSON_OUTPUT_DIR" ]]; then
        echo "Error: Directory $JSON_OUTPUT_DIR does not exist." >> "$ERROR_LOG"
        exit 1
    fi

    JSON_FILES=$(find "$JSON_OUTPUT_DIR" -type f -name '*.json')
    if [[ -z "$JSON_FILES" ]]; then
        echo "Error: No JSON plan files found in $JSON_OUTPUT_DIR." >> "$ERROR_LOG"
        exit 1
    fi
}

# Process JSON Files
process_json_files() {
    for json_file in $JSON_FILES; do
        if ! jq empty "$json_file" > /dev/null 2>&1; then
            echo "Error: Invalid JSON file $json_file. Skipping." >> "$ERROR_LOG"
            continue
        fi
        echo "Processing $json_file"
        jq -r --arg appName "$APPNAME" --arg env "$ENVIRONMENT" '
            .resource_changes[]? |
            select(.change.actions[] != "no-op") |
            [
                $appName,                                         # AppName
                $env,                                             # Environment
                .address,                                         # Resource (resource address)
                .type,                                            # ResourceType (type of the resource)
                (.change.actions | join("/")),                    # ChangeAction (actions like "update", "create", "delete")
                (.change.actions | join("/")),                    # DriftType (same as ChangeAction, can adjust if needed)
                (now | todate),                                   # DetectedAt (current timestamp)
                (if (.change.actions | join("/") | contains("delete/create")) then "High"
                 elif (.change.actions | index("delete")) then "High"
                 elif (.change.actions | index("update")) then "Medium"
                 else "Low" end),                                 # Severity (dynamic based on action)
                (.change.before | tostring + " -> " + (.change.after | tostring)),  # Details (Before -> After)
                (.action_reason // "N/A"),                        # ActionReason (if available, otherwise "N/A"),
                (.change.before | tostring),                      # Before (resource state before change)
                (.change.after | tostring),                       # After (resource state after change),
                (if (.change.actions | index("create") or index("update") or index("delete")) then "true" else "false" end), # ResourcePlanned (true/false based on action)
                (try (
                    .change.before as $before |
                    .change.after as $after |
                    {
                      added: ($after | with_entries(select(.key | in($before) | not))),
                      removed: ($before | with_entries(select(.key | in($after) | not))),
                      modified: ($after | with_entries(select(.value != $before[.key] and (.key | in($before)))))
                    } |
                    del(.added | select(length == 0)) |
                    del(.removed | select(length == 0)) |
                    del(.modified | select(length == 0)) |
                    tostring
                ) catch "N/A")                                   # ActualChange (Filtered JSON difference between Before and After)
            ] | @csv
        ' "$json_file" >> "$CSV_FILE"
    done
}

# Generate Summary from CSV Output
generate_summary() {
    echo "Generating summary from CSV output..."
    echo "Summary of Changes in $APPNAME:$ENVIRONMENT" > "$SUMMARY_LOG"

    # Read CSV and generate summary
    tail -n +2 "$CSV_FILE" | awk -F, '{
        resource = $3;
        resource_type = $4;
        severity = $8;

        # Group by resource type and severity
        key = resource_type "|" severity;
        count[key]++;
        resources[key] = resources[key] ? resources[key] ", " resource : resource;
    } END {
        for (key in count) {
            split(key, parts, "|");
            resource_type = parts[1];
            severity = parts[2];
            printf("- %s Changes: %d changes (%s severity)\n", resource_type, count[key], severity);
            printf("  - Resources: %s\n", resources[key]);
        }
    }' >> "$SUMMARY_LOG"
}

# Main Script Execution
main() {
    setup_environment "$1" "$2" "$3"
    validate_json_directory
    echo "AppName,Environment,Resource,ResourceType,ChangeAction,DriftType,DetectedAt,Severity,Details,ActionReason,Before,After,ResourcePlanned,ActualChange" > "$CSV_FILE"
    process_json_files
    echo "##vso[task.setVariable variable=CSV_FILE_PATH]$CSV_FILE"
    echo "Displaying selected columns (AppName, Environment, Resource, ChangeAction, ActualChange):"
    mlr --csv cut -f AppName,Environment,Resource,ChangeAction,ActualChange "$CSV_FILE"
    generate_summary
    echo "Debug: Summary Statistics"
    cat "$SUMMARY_LOG"
}

main "$1" "$2" "$3"
