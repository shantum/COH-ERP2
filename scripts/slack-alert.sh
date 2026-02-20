#!/bin/bash
# Reusable Slack alert sender for COH-ERP server monitoring
# Usage: ./slack-alert.sh <level> <title> <message>
# Levels: info, warning, error, success

WEBHOOK_URL="${SLACK_WEBHOOK_URL:?SLACK_WEBHOOK_URL not set}"
HOSTNAME=$(hostname)

LEVEL="${1:-info}"
TITLE="${2:-Server Alert}"
MESSAGE="${3:-No details}"

case "$LEVEL" in
  success) COLOR="#2eb886" EMOJI=":white_check_mark:" ;;
  error)   COLOR="#dc3545" EMOJI=":rotating_light:" ;;
  warning) COLOR="#ffc107" EMOJI=":warning:" ;;
  *)       COLOR="#2196f3" EMOJI=":information_source:" ;;
esac

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

curl -s -X POST "$WEBHOOK_URL" \
  -H 'Content-type: application/json' \
  -d "{
    \"attachments\": [{
      \"color\": \"$COLOR\",
      \"blocks\": [
        {
          \"type\": \"section\",
          \"text\": {
            \"type\": \"mrkdwn\",
            \"text\": \"$EMOJI *$TITLE*\n$MESSAGE\"
          }
        },
        {
          \"type\": \"context\",
          \"elements\": [{
            \"type\": \"mrkdwn\",
            \"text\": \"$HOSTNAME | $TIMESTAMP\"
          }]
        }
      ]
    }]
  }" > /dev/null 2>&1
