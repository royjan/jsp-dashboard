#!/bin/bash

# Deploy script for pushing Docker image to ECR
# Usage: ./scripts/deploy.sh [tag]

set -e

# Configuration
ECR_REGISTRY="224072612352.dkr.ecr.eu-central-1.amazonaws.com"
ECR_REPOSITORY="jan-parts-dashboard"
IMAGE_NAME="jan-parts-dashboard"
AWS_REGION="eu-central-1"

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

echo "Authenticating with ECR..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}

if [ $? -ne 0 ]; then
    echo "ECR authentication failed. Check your AWS credentials."
    exit 1
fi

echo "Building Docker image for x86_64..."
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

echo "Tagging images..."
docker tag ${IMAGE_NAME} ${FULL_IMAGE_NAME}
docker tag ${IMAGE_NAME} ${LATEST_IMAGE_NAME}

echo "Pushing image with tag: ${TAG}..."
DOCKER_CONTENT_TRUST=0 docker push ${FULL_IMAGE_NAME}

if [ $? -ne 0 ]; then
    echo "Failed to push tagged image."
    exit 1
fi

echo "Pushing latest image..."
DOCKER_CONTENT_TRUST=0 docker push ${LATEST_IMAGE_NAME}

if [ $? -ne 0 ]; then
    echo "Failed to push latest image."
    exit 1
fi

echo "Deployment successful!"
echo "Tagged image: ${FULL_IMAGE_NAME}"
echo "Latest image: ${LATEST_IMAGE_NAME}"
echo ""
echo "Images pushed to ECR successfully!"
echo "App Runner will automatically detect the new image and deploy it"
echo "Service: jan-parts-dashboard (eu-central-1)"
echo "Auto-deployment typically takes 2-5 minutes"
