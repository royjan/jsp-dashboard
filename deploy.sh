#!/bin/bash
set -euo pipefail

SERVICE_NAME="jan-parts-dashboard"
REGION="eu-central-1"
POWER="small"
SCALE=1
PORT=3000
DOMAIN="dashboard.jan.parts"
HOSTED_ZONE_ID="Z021997128UFF2MPJGHPZ"
CERT_NAME="dashboard-jan-parts-cert"
IMAGE_LABEL="app"

echo "=== Deploying $SERVICE_NAME to AWS Lightsail Containers ==="

# 1. Build Docker image
echo ""
echo ">>> Building Docker image..."
docker build --platform linux/amd64 -t "$SERVICE_NAME" .

# 2. Create Lightsail container service (if not exists)
echo ""
echo ">>> Checking if container service exists..."
if aws lightsail get-container-services --service-name "$SERVICE_NAME" --region "$REGION" > /dev/null 2>&1; then
  echo "Container service already exists."
else
  echo "Creating container service..."
  aws lightsail create-container-service \
    --service-name "$SERVICE_NAME" \
    --power "$POWER" \
    --scale "$SCALE" \
    --region "$REGION"

  echo "Waiting for container service to become active..."
  while true; do
    STATE=$(aws lightsail get-container-services \
      --service-name "$SERVICE_NAME" \
      --region "$REGION" \
      --query "containerServices[0].state" \
      --output text)
    echo "  State: $STATE"
    if [ "$STATE" = "READY" ] || [ "$STATE" = "ACTIVE" ]; then
      break
    fi
    sleep 10
  done
fi

# 3. Push image to Lightsail
echo ""
echo ">>> Pushing image to Lightsail..."
aws lightsail push-container-image \
  --service-name "$SERVICE_NAME" \
  --label "$IMAGE_LABEL" \
  --image "$SERVICE_NAME:latest" \
  --region "$REGION"

# Get the pushed image URI
IMAGE_URI=$(aws lightsail get-container-images \
  --service-name "$SERVICE_NAME" \
  --region "$REGION" \
  --query "containerImages[0].image" \
  --output text)
echo "Pushed image: $IMAGE_URI"

# 4. Create SSL certificate for custom domain
echo ""
echo ">>> Setting up SSL certificate for $DOMAIN..."
if aws lightsail get-certificates --certificate-name "$CERT_NAME" --region "$REGION" > /dev/null 2>&1; then
  echo "Certificate already exists."
else
  echo "Creating certificate..."
  aws lightsail create-certificate \
    --certificate-name "$CERT_NAME" \
    --domain-name "$DOMAIN" \
    --region "$REGION"
fi

# Get DNS validation records
echo "Fetching certificate DNS validation records..."
CERT_INFO=$(aws lightsail get-certificates \
  --certificate-name "$CERT_NAME" \
  --region "$REGION" \
  --query "certificates[0].certificateDetail")

CERT_STATUS=$(echo "$CERT_INFO" | jq -r '.status')
echo "Certificate status: $CERT_STATUS"

if [ "$CERT_STATUS" = "PENDING_VALIDATION" ]; then
  VALIDATION_NAME=$(echo "$CERT_INFO" | jq -r '.domainValidationRecords[0].resourceRecord.name')
  VALIDATION_VALUE=$(echo "$CERT_INFO" | jq -r '.domainValidationRecords[0].resourceRecord.value')

  echo "Adding DNS validation record..."
  aws route53 change-resource-record-sets \
    --hosted-zone-id "$HOSTED_ZONE_ID" \
    --change-batch "{
      \"Changes\": [{
        \"Action\": \"UPSERT\",
        \"ResourceRecordSet\": {
          \"Name\": \"$VALIDATION_NAME\",
          \"Type\": \"CNAME\",
          \"TTL\": 300,
          \"ResourceRecords\": [{\"Value\": \"$VALIDATION_VALUE\"}]
        }
      }]
    }"

  echo "Waiting for certificate validation..."
  while true; do
    STATUS=$(aws lightsail get-certificates \
      --certificate-name "$CERT_NAME" \
      --region "$REGION" \
      --query "certificates[0].certificateDetail.status" \
      --output text)
    echo "  Certificate status: $STATUS"
    if [ "$STATUS" = "ISSUED" ]; then
      break
    fi
    sleep 15
  done
fi

# 5. Deploy container with custom domain
echo ""
echo ">>> Deploying container..."
aws lightsail create-container-service-deployment \
  --service-name "$SERVICE_NAME" \
  --region "$REGION" \
  --containers "{
    \"$SERVICE_NAME\": {
      \"image\": \"$IMAGE_URI\",
      \"ports\": {\"$PORT\": \"HTTP\"},
      \"environment\": {
        \"NODE_ENV\": \"production\",
        \"HOSTNAME\": \"0.0.0.0\",
        \"PORT\": \"$PORT\",
        \"AWS_REGION\": \"$REGION\"
      }
    }
  }" \
  --public-endpoint "{
    \"containerName\": \"$SERVICE_NAME\",
    \"containerPort\": $PORT,
    \"healthCheck\": {
      \"path\": \"/\",
      \"intervalSeconds\": 30,
      \"timeoutSeconds\": 5,
      \"healthyThreshold\": 2,
      \"unhealthyThreshold\": 3
    }
  }"

# 6. Attach custom domain
echo ""
echo ">>> Attaching custom domain $DOMAIN..."
# Update service with public domain
aws lightsail update-container-service \
  --service-name "$SERVICE_NAME" \
  --region "$REGION" \
  --public-domain-names "{\"$CERT_NAME\": [\"$DOMAIN\"]}" || true

# 7. Create Route53 record
echo ""
echo ">>> Setting up Route53 DNS record..."
SERVICE_URL=$(aws lightsail get-container-services \
  --service-name "$SERVICE_NAME" \
  --region "$REGION" \
  --query "containerServices[0].url" \
  --output text | sed 's|https://||' | sed 's|/$||')

echo "Service URL: $SERVICE_URL"

aws route53 change-resource-record-sets \
  --hosted-zone-id "$HOSTED_ZONE_ID" \
  --change-batch "{
    \"Changes\": [{
      \"Action\": \"UPSERT\",
      \"ResourceRecordSet\": {
        \"Name\": \"$DOMAIN\",
        \"Type\": \"CNAME\",
        \"TTL\": 300,
        \"ResourceRecords\": [{\"Value\": \"$SERVICE_URL\"}]
      }
    }]
  }"

# 8. Wait for deployment
echo ""
echo ">>> Waiting for deployment to complete..."
while true; do
  STATE=$(aws lightsail get-container-services \
    --service-name "$SERVICE_NAME" \
    --region "$REGION" \
    --query "containerServices[0].state" \
    --output text)
  echo "  Service state: $STATE"
  if [ "$STATE" = "RUNNING" ] || [ "$STATE" = "READY" ] || [ "$STATE" = "ACTIVE" ]; then
    break
  fi
  if [ "$STATE" = "DEPLOYING" ]; then
    sleep 15
    continue
  fi
  sleep 10
done

echo ""
echo "=== Deployment complete! ==="
echo "Lightsail URL: https://$SERVICE_URL"
echo "Custom domain: https://$DOMAIN"
echo ""
echo "Note: DNS propagation may take a few minutes."
