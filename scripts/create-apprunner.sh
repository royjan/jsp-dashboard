#!/bin/bash

# Script to create App Runner service for jan-parts-dashboard
# Usage: ./scripts/create-apprunner.sh
# Run this once, then use ./scripts/deploy.sh for subsequent deploys

set -e

SERVICE_NAME="jan-parts-dashboard"
ECR_IMAGE="224072612352.dkr.ecr.eu-central-1.amazonaws.com/jan-parts-dashboard:latest"
AWS_REGION="eu-central-1"
ACCESS_ROLE_ARN="arn:aws:iam::224072612352:role/service-role/AppRunnerECRAccessRole"
INSTANCE_ROLE_ARN="arn:aws:iam::224072612352:role/AppRunner"

echo "Creating App Runner service: ${SERVICE_NAME}"

# Check if service already exists
EXISTING_SERVICE=$(aws apprunner list-services --region ${AWS_REGION} --query "ServiceSummaryList[?ServiceName=='${SERVICE_NAME}'].ServiceArn" --output text 2>/dev/null || echo "")

if [ ! -z "${EXISTING_SERVICE}" ] && [ "${EXISTING_SERVICE}" != "None" ]; then
    echo "Service ${SERVICE_NAME} already exists!"
    echo "Service ARN: ${EXISTING_SERVICE}"
    echo ""
    echo "To trigger a new deployment, run:"
    echo "  aws apprunner start-deployment --service-arn ${EXISTING_SERVICE} --region ${AWS_REGION}"
    exit 0
fi

cat > /tmp/apprunner-dashboard-config.json <<EOF
{
  "ServiceName": "${SERVICE_NAME}",
  "SourceConfiguration": {
    "ImageRepository": {
      "ImageIdentifier": "${ECR_IMAGE}",
      "ImageConfiguration": {
        "Port": "3000",
        "RuntimeEnvironmentVariables": {
          "NODE_ENV": "production",
          "HOSTNAME": "0.0.0.0",
          "PORT": "3000",
          "AWS_REGION": "${AWS_REGION}"
        }
      },
      "ImageRepositoryType": "ECR"
    },
    "AutoDeploymentsEnabled": true,
    "AuthenticationConfiguration": {
      "AccessRoleArn": "${ACCESS_ROLE_ARN}"
    }
  },
  "InstanceConfiguration": {
    "Cpu": "1 vCPU",
    "Memory": "2 GB",
    "InstanceRoleArn": "${INSTANCE_ROLE_ARN}"
  },
  "HealthCheckConfiguration": {
    "Protocol": "HTTP",
    "Path": "/",
    "Interval": 10,
    "Timeout": 5,
    "HealthyThreshold": 1,
    "UnhealthyThreshold": 5
  },
  "Tags": [
    {
      "Key": "Application",
      "Value": "jan-parts-dashboard"
    }
  ]
}
EOF

echo "Creating App Runner service..."

SERVICE_ARN=$(aws apprunner create-service \
  --cli-input-json file:///tmp/apprunner-dashboard-config.json \
  --region ${AWS_REGION} \
  --query 'Service.ServiceArn' \
  --output text)

rm -f /tmp/apprunner-dashboard-config.json

if [ $? -eq 0 ]; then
    echo "App Runner service created successfully!"
    echo "Service ARN: ${SERVICE_ARN}"
    echo ""
    echo "Check service status:"
    echo "  aws apprunner describe-service --service-arn ${SERVICE_ARN} --query 'Service.{Status:Status,ServiceUrl:ServiceUrl}' --output table"
    echo ""
    echo "Service URL will be available once status is RUNNING"
else
    echo "Failed to create App Runner service"
    exit 1
fi
