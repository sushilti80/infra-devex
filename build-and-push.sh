#!/bin/bash
set -e

# Configuration - Update these values
ACR_NAME=${ACR_NAME:-"your-acr-registry"}  # Replace with your Azure Container Registry name or set as env var
REGISTRY_URL="${ACR_NAME}.azurecr.io"
IMAGE_NAME="self-servicesurf"
IMAGE_TAG=${1:-$(git rev-parse --short HEAD)}  # Use provided tag or git commit hash

echo "🔧 Building Docker image: ${REGISTRY_URL}/${IMAGE_NAME}:${IMAGE_TAG}"
echo "📋 Note: Entra ID config is injected at runtime via server /config.js endpoint"
echo "   This supports FluxCD/Kustomize ConfigMap/Secret management"

# Login to Azure Container Registry
echo "🔑 Logging into Azure Container Registry..."
az acr login --name ${ACR_NAME}

# Build the Docker image with multi-stage build
echo "🏗️ Building optimized production image..."
docker build -t "${REGISTRY_URL}/${IMAGE_NAME}:${IMAGE_TAG}" .
docker tag "${REGISTRY_URL}/${IMAGE_NAME}:${IMAGE_TAG}" "${REGISTRY_URL}/${IMAGE_NAME}:latest"
docker tag "${REGISTRY_URL}/${IMAGE_NAME}:${IMAGE_TAG}" "${REGISTRY_URL}/${IMAGE_NAME}:latest"

# Push to Azure Container Registry
echo "📤 Pushing to Azure Container Registry..."
docker push "${REGISTRY_URL}/${IMAGE_NAME}:${IMAGE_TAG}"
docker push "${REGISTRY_URL}/${IMAGE_NAME}:latest"

echo "✅ Image built and pushed successfully!"
echo "   Image: ${REGISTRY_URL}/${IMAGE_NAME}:${IMAGE_TAG}"
echo "   Image: ${REGISTRY_URL}/${IMAGE_NAME}:latest"
echo ""
echo "📋 To use this image in your existing CI/CD pipeline:"
echo "   - Set the image tag to: ${REGISTRY_URL}/${IMAGE_NAME}:${IMAGE_TAG}"
echo ""
echo "🚀 To update a running deployment:"
echo "   kubectl set image deployment/self-servicesurf self-servicesurf=${REGISTRY_URL}/${IMAGE_NAME}:${IMAGE_TAG} -n your-namespace"
