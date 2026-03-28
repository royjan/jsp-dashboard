#!/bin/bash

# Deploy script for pushing Docker image to ECR and creating/updating App Runner service
# Usage: ./deploy-apprunner.sh [tag]

set -e

# Configuration
ECR_REGISTRY="224072612352.dkr.ecr.eu-central-1.amazonaws.com"
ECR_REPOSITORY="jan-parts-dashboard"
IMAGE_NAME="jan-parts-dashboard"
AWS_REGION="eu-central-1"
SERVICE_NAME="jan-parts-dashboard"
DOMAIN="dashboard.jan.parts"
HOSTED_ZONE_ID="Z021997128UFF2MPJGHPZ"

# Get tag from argument or use timestamp
TAG=${1:-$(date +%Y%m%d-%H%M%S)}
FULL_IMAGE_NAME="${ECR_REGISTRY}/${ECR_REPOSITORY}:${TAG}"
LATEST_IMAGE_NAME="${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"

echo "Starting deployment process..."
echo "Image: ${FULL_IMAGE_NAME}"
echo "Latest: ${LATEST_IMAGE_NAME}"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo "Docker is not running. Please start Docker first."
    exit 1
fi

# 1. Ensure ECR repository exists
echo ""
echo ">>> Ensuring ECR repository exists..."
aws ecr describe-repositories --repository-names "$ECR_REPOSITORY" --region "$AWS_REGION" 2>/dev/null || \
  aws ecr create-repository --repository-name "$ECR_REPOSITORY" --region "$AWS_REGION"

# 2. Authenticate with ECR
echo ""
echo ">>> Authenticating with ECR..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}

if [ $? -ne 0 ]; then
    echo "ECR authentication failed. Check your AWS credentials."
    exit 1
fi

# 3. Build Docker image
echo ""
echo ">>> Building Docker image for x86_64..."
export DOCKER_BUILDKIT=1
docker build \
    --platform linux/amd64 \
    --provenance=false \
    --sbom=false \
    -t ${IMAGE_NAME} .

if [ $? -ne 0 ]; then
    echo "Docker build failed."
    exit 1
fi

# 4. Tag and push
echo ""
echo ">>> Tagging images..."
docker tag ${IMAGE_NAME} ${FULL_IMAGE_NAME}
docker tag ${IMAGE_NAME} ${LATEST_IMAGE_NAME}

echo ">>> Pushing image with tag: ${TAG}..."
DOCKER_CONTENT_TRUST=0 docker push ${FULL_IMAGE_NAME}

if [ $? -ne 0 ]; then
    echo "Failed to push tagged image."
    exit 1
fi

echo ">>> Pushing latest image..."
DOCKER_CONTENT_TRUST=0 docker push ${LATEST_IMAGE_NAME}

if [ $? -ne 0 ]; then
    echo "Failed to push latest image."
    exit 1
fi

# 5. Check if App Runner service already exists
echo ""
echo ">>> Checking for existing App Runner service..."
EXISTING_SERVICE=$(aws apprunner list-services --region ${AWS_REGION} \
  --query "ServiceSummaryList[?ServiceName=='${SERVICE_NAME}'].ServiceArn" --output text 2>/dev/null || echo "")

if [ -z "${EXISTING_SERVICE}" ] || [ "${EXISTING_SERVICE}" = "None" ]; then
    echo ">>> Creating new App Runner service..."
    cat > /tmp/apprunner-dashboard-config.json <<EOF
{
  "ServiceName": "${SERVICE_NAME}",
  "SourceConfiguration": {
    "ImageRepository": {
      "ImageIdentifier": "${LATEST_IMAGE_NAME}",
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
    "AutoDeploymentsEnabled": false
  },
  "InstanceConfiguration": {
    "Cpu": "1 vCPU",
    "Memory": "2 GB"
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

    SERVICE_ARN=$(aws apprunner create-service \
      --cli-input-json file:///tmp/apprunner-dashboard-config.json \
      --region ${AWS_REGION} \
      --query 'Service.ServiceArn' \
      --output text)

    rm -f /tmp/apprunner-dashboard-config.json
    echo "Created service: ${SERVICE_ARN}"
else
    SERVICE_ARN="${EXISTING_SERVICE}"
    echo ">>> Triggering deployment on existing service..."
    aws apprunner start-deployment --service-arn "${SERVICE_ARN}" --region ${AWS_REGION}
    echo "Deployment triggered on: ${SERVICE_ARN}"
fi

# 6. Wait for deployment
echo ""
echo ">>> Waiting for App Runner service to be running..."
while true; do
    STATUS=$(aws apprunner describe-service --service-arn "${SERVICE_ARN}" --region ${AWS_REGION} \
      --query "Service.Status" --output text)
    echo "  Status: ${STATUS}"
    if [ "${STATUS}" = "RUNNING" ]; then
        break
    fi
    if [ "${STATUS}" = "CREATE_FAILED" ] || [ "${STATUS}" = "DELETE_FAILED" ]; then
        echo "ERROR: Service failed with status ${STATUS}"
        exit 1
    fi
    sleep 15
done

# 7. Get service URL
SERVICE_URL=$(aws apprunner describe-service --service-arn "${SERVICE_ARN}" --region ${AWS_REGION} \
  --query "Service.ServiceUrl" --output text)
echo ""
echo "Service URL: https://${SERVICE_URL}"

# 8. Update Route53 DNS
echo ""
echo ">>> Updating Route53 DNS for ${DOMAIN}..."
aws route53 change-resource-record-sets \
  --hosted-zone-id "${HOSTED_ZONE_ID}" \
  --change-batch "{
    \"Changes\": [{
      \"Action\": \"UPSERT\",
      \"ResourceRecordSet\": {
        \"Name\": \"${DOMAIN}\",
        \"Type\": \"CNAME\",
        \"TTL\": 300,
        \"ResourceRecords\": [{\"Value\": \"${SERVICE_URL}\"}]
      }
    }]
  }"

echo ""
echo "=== Deployment complete! ==="
echo "App Runner URL: https://${SERVICE_URL}"
echo "Custom domain:  https://${DOMAIN}"
echo ""
echo "Monitor deployment:"
echo "  aws apprunner describe-service --service-arn ${SERVICE_ARN} --query 'Service.{Status:Status,ServiceUrl:ServiceUrl}' --output table"
echo ""
echo "To delete old Lightsail service after verification:"
echo "  aws lightsail delete-container-service --service-name ${SERVICE_NAME} --region eu-central-1"
