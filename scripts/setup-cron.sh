#!/bin/bash
# Setup EventBridge Scheduler rules for warm-cache cron
# Runs on Israel business hours (Asia/Jerusalem timezone)
#
# Schedule:
#   Sun-Thu: 05:30, 08:00, 10:00, 12:00, 14:00, 16:00, 18:00
#   Fri:     05:30, 08:00, 10:00, 12:00
#   Sat:     none (Shabbat)
#
# Total: ~39 runs/week, ~170/month

set -euo pipefail

APP_URL="${APP_URL:?Set APP_URL to your App Runner endpoint, e.g. https://xxx.il-central-1.awsapprunner.com}"
CRON_SECRET="${CRON_SECRET:?Set CRON_SECRET to match the value in AWS Secrets Manager}"
ROLE_ARN="${SCHEDULER_ROLE_ARN:?Set SCHEDULER_ROLE_ARN to an IAM role that can invoke the target}"
REGION="${AWS_REGION:-il-central-1}"
GROUP_NAME="jan-parts-dashboard"

echo "Setting up EventBridge Scheduler for warm-cache..."
echo "  Target: ${APP_URL}/api/cron/warm-cache"
echo "  Region: ${REGION}"

# Create schedule group if it doesn't exist
aws scheduler create-schedule-group \
  --name "${GROUP_NAME}" \
  --region "${REGION}" 2>/dev/null || true

# Helper to create/update a schedule
create_schedule() {
  local name="$1"
  local expression="$2"
  local description="$3"

  echo "Creating schedule: ${name} (${expression})"

  aws scheduler create-schedule \
    --name "${name}" \
    --group-name "${GROUP_NAME}" \
    --schedule-expression "${expression}" \
    --schedule-expression-timezone "Asia/Jerusalem" \
    --flexible-time-window '{"Mode":"OFF"}' \
    --target "{
      \"Arn\": \"arn:aws:scheduler:::aws-sdk:eventbridge:putEvents\",
      \"RoleArn\": \"${ROLE_ARN}\",
      \"Input\": \"{}\",
      \"RetryPolicy\": {\"MaximumRetryAttempts\": 2}
    }" \
    --action-after-completion "NONE" \
    --state "ENABLED" \
    --region "${REGION}" 2>/dev/null || \
  aws scheduler update-schedule \
    --name "${name}" \
    --group-name "${GROUP_NAME}" \
    --schedule-expression "${expression}" \
    --schedule-expression-timezone "Asia/Jerusalem" \
    --flexible-time-window '{"Mode":"OFF"}' \
    --target "{
      \"Arn\": \"arn:aws:scheduler:::aws-sdk:eventbridge:putEvents\",
      \"RoleArn\": \"${ROLE_ARN}\",
      \"Input\": \"{}\",
      \"RetryPolicy\": {\"MaximumRetryAttempts\": 2}
    }" \
    --action-after-completion "NONE" \
    --state "ENABLED" \
    --region "${REGION}"
}

# Note: EventBridge Scheduler uses HTTP targets via Universal Targets.
# For App Runner, use a Lambda proxy or API Gateway.
# Alternative: use a simple Lambda that calls the warm-cache endpoint.

# Rule 1: Pre-open warm every workday at 05:30 (Sun-Fri)
create_schedule "warm-cache-preopen" \
  "cron(30 5 ? * SUN-FRI *)" \
  "Pre-open cache warm at 05:30 Sun-Fri"

# Rule 2: Business hours Sun-Thu every 2h (08,10,12,14,16,18)
create_schedule "warm-cache-business-sun-thu" \
  "cron(0 8,10,12,14,16,18 ? * SUN-THU *)" \
  "Business hours cache warm every 2h Sun-Thu"

# Rule 3: Friday business hours (08,10,12)
create_schedule "warm-cache-business-fri" \
  "cron(0 8,10,12 ? * FRI *)" \
  "Friday business hours cache warm"

echo ""
echo "Done! Created 3 schedules in group '${GROUP_NAME}'."
echo ""
echo "To verify:"
echo "  aws scheduler list-schedules --group-name ${GROUP_NAME} --region ${REGION}"
echo ""
echo "To test manually:"
echo "  curl -X POST ${APP_URL}/api/cron/warm-cache -H 'Authorization: Bearer ${CRON_SECRET}'"
echo ""
echo "NOTE: EventBridge Scheduler cannot directly call App Runner URLs."
echo "You need one of these approaches:"
echo "  1. Lambda proxy: Create a Lambda that POSTs to ${APP_URL}/api/cron/warm-cache"
echo "  2. API Gateway: Put an API Gateway in front of App Runner"
echo "  3. Use the App Runner URL directly with an HTTP target (requires VPC connector)"
