#!/bin/sh
set -e

echo "Starting Jan Parts Dashboard..."
echo "NODE_ENV: ${NODE_ENV}"
echo "AWS_REGION: ${AWS_REGION}"

exec "$@"
