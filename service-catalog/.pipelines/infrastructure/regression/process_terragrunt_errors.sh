#!/bin/bash

# Define paths
WORKING_DIR=$1
ERROR_LOG_FILE="$WORKING_DIR/terragrunt_plan_error.log"
JSON_OUTPUT_FILE="$WORKING_DIR/terragrunt_plan_error_analysis.json"
CSV_OUTPUT_FILE="$WORKING_DIR/terragrunt_plan_error_analysis.csv"

# Function to remove special characters and escape quotes for JSON
remove_special_characters() {
    echo "$1" | sed -e 's/\x1b\[[0-9;]*m//g' | tr -d '│╵' | tr -s ' '
}


escape_json() {
    echo "$1" | sed 's/"/\\"/g'
}

# Initialize empty JSON and CSV files
echo "[]" > "$JSON_OUTPUT_FILE"
echo "Module,ErrorMessage,App,Environment,DateTime" > "$CSV_OUTPUT_FILE"

# Process the log file to extract errors and their associated modules
process_log_file() {
    log_file=$1
    current_module=""
    current_app=""
    current_environment=""
    capturing_error=false
    current_error=""
    current_datetime=""

    while IFS= read -r line; do
        # Check if the line contains a module name (prefix) and extract app, environment, and module
        if [[ "$line" =~ prefix=\[(.*)\] ]]; then
            full_path="${BASH_REMATCH[1]}"
            current_module=$(echo "$full_path" | awk -F'/' '{print $NF}')
            current_environment=$(echo "$full_path" | awk -F'/' '{print $(NF-1)}')  # Extract environment
            current_app=$(echo "$full_path" | awk -F'/' '{print $(NF-2)}')  # Extract app
        fi

        # Capture timestamp for current error
        if [[ "$line" =~ ^time= ]]; then
            current_datetime=$(echo "$line" | awk '{print $1}' | sed 's/time=//')
        fi

        # Start capturing error details when "Error:" is detected
        if [[ "$line" =~ "Error:" ]]; then
            capturing_error=true
            current_error="$line"
        elif [[ "$capturing_error" == true ]]; then
            # Stop capturing when a new timestamp or module line is encountered
            if [[ "$line" =~ ^time= ]] || [[ "$line" =~ prefix=\[.*\] ]]; then
                capturing_error=false

                # Clean and escape the error message
                cleaned_error=$(remove_special_characters "$current_error")
                escaped_error=$(escape_json "$cleaned_error")
                datetime=${current_datetime:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}  # Use stored datetime or current timestamp

                # Log the extracted information
                echo "Processing error for module: $current_module in app: $current_app, environment: $current_environment"

                # Create a temporary JSON object and append it to the JSON file
                temp_json=$(mktemp)
                echo "{\"module\": \"$current_module\", \"status\": \"error\", \"error_message\": \"$escaped_error\", \"app\": \"$current_app\", \"environment\": \"$current_environment\", \"datetime\": \"$datetime\"}" > "$temp_json"
                jq '. += [input]' "$JSON_OUTPUT_FILE" "$temp_json" > temp.json && mv temp.json "$JSON_OUTPUT_FILE"
                rm "$temp_json"

                # Append to CSV file
                echo "$current_module,\"$cleaned_error\",\"$current_app\",\"$current_environment\",$datetime" >> "$CSV_OUTPUT_FILE"

                # Reset the error capture
                current_error=""
                current_datetime=""
            else
                # Continue appending to the error message
                current_error="$current_error $line"
            fi
        fi
    done < "$log_file"

    # Handle any remaining error that wasn't closed by a timestamp
    if [[ "$capturing_error" == true ]]; then
        cleaned_error=$(remove_special_characters "$current_error")
        escaped_error=$(escape_json "$cleaned_error")
        datetime=${current_datetime:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}

        # Append the last error to the JSON and CSV outputs
        temp_json=$(mktemp)
        echo "{\"module\": \"$current_module\", \"status\": \"error\", \"error_message\": \"$escaped_error\", \"app\": \"$current_app\", \"environment\": \"$current_environment\", \"datetime\": \"$datetime\"}" > "$temp_json"
        jq '. += [input]' "$JSON_OUTPUT_FILE" "$temp_json" > temp.json && mv temp.json "$JSON_OUTPUT_FILE"
        rm "$temp_json"

        # Append to CSV
        echo "$current_module,\"$cleaned_error\",\"$current_app\",\"$current_environment\",$datetime" >> "$CSV_OUTPUT_FILE"
    fi
}

# Check if the log file exists and process it
if [[ -f "$ERROR_LOG_FILE" ]]; then
    process_log_file "$ERROR_LOG_FILE"
else
    echo "Log file not found!"
    exit 1
fi

# Display JSON and CSV outputs for debugging
echo "Generated JSON content:"
cat "$JSON_OUTPUT_FILE"

echo "Generated CSV content:"
cat "$CSV_OUTPUT_FILE"
