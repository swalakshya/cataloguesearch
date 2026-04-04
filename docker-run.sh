#!/bin/bash

# Docker Compose wrapper script for CatalogueSearch
# Usage: ./docker-run.sh [local|prod] [up|down|build|logs]

set -e

# Default values
ENV=${1:-local}
ACTION=${2:-up}

# Validate environment
if [[ "$ENV" != "local" && "$ENV" != "prod" ]]; then
    echo "Error: Environment must be 'local' or 'prod'"
    echo "Usage: $0 [local|prod] [up|down|build|logs]"
    exit 1
fi

# Validate action
VALID_ACTIONS=("up" "down" "build" "logs" "restart" "build-api" "restart-api" "build-frontend" "restart-frontend" "build-shortener" "restart-shortener" "restart-svc" "push" "push-api" "push-frontend")
if ! [[ " ${VALID_ACTIONS[*]} " =~ " ${ACTION} " ]]; then
    echo "Error: Action must be one of: ${VALID_ACTIONS[*]}"
    echo "Usage: $0 [local|prod] [action]"
    exit 1
fi

# Set environment file
ENV_FILE=".env.$ENV"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "Error: Environment file $ENV_FILE not found"
    exit 1
fi

echo "Using environment: $ENV"
echo "Environment file: $ENV_FILE"
echo "Action: $ACTION"

# Run docker-compose with the specified environment
case $ACTION in
    "up")
        docker-compose --env-file "$ENV_FILE" up -d
        echo ""
        echo "Services are starting up..."
        echo "Frontend will be available at: http://localhost:3000"
        echo "API will be available at: http://localhost:8000"
        echo ""
        echo "Check logs with: $0 $ENV logs"
        ;;
    "down")
        docker-compose --env-file "$ENV_FILE" down
        ;;
    "build")
        docker-compose --env-file "$ENV_FILE" build
        ;;
    "build-api")
        echo "Building only the API service..."
        docker-compose --env-file "$ENV_FILE" build cataloguesearch-api
        ;;
    "restart-api")
        echo "Rebuilding and restarting only the API service..."
        docker-compose --env-file "$ENV_FILE" build cataloguesearch-api
        docker-compose --env-file "$ENV_FILE" down cataloguesearch-api
        docker-compose --env-file "$ENV_FILE" up -d --no-deps cataloguesearch-api
        echo "API service restarted. Available at: http://localhost:8000"
        ;;
    "restart")
        echo "Rebuilding and restarting all services..."
        docker-compose --env-file "$ENV_FILE" build
        docker-compose --env-file "$ENV_FILE" down
        docker-compose --env-file "$ENV_FILE" up -d
        echo "All services restarted."
        ;;
    "build-frontend")
        echo "Building only the frontend service..."
        docker-compose --env-file "$ENV_FILE" build cataloguesearch-frontend
        ;;
    "build-shortener")
        echo "Building only the shortener service..."
        docker-compose --env-file "$ENV_FILE" build url-shortener
        ;;
    "restart-frontend")
        echo "Rebuilding and restarting only the frontend service..."
        docker-compose --env-file "$ENV_FILE" build cataloguesearch-frontend
        docker-compose --env-file "$ENV_FILE" down cataloguesearch-frontend
        docker-compose --env-file "$ENV_FILE" up -d --no-deps cataloguesearch-frontend
        echo "Frontend service restarted. Available at: http://localhost:3000"
        ;;
    "restart-shortener")
        echo "Rebuilding and restarting only the shortener service..."
        docker-compose --env-file "$ENV_FILE" build url-shortener
        docker-compose --env-file "$ENV_FILE" down url-shortener
        docker-compose --env-file "$ENV_FILE" up -d --no-deps url-shortener
        echo "Shortener service restarted. Available at: http://localhost:8100"
        ;;
    "restart-svc")
        echo "Rebuilding and restarting frontend and backend services..."
        
        # Stop services first to free up resources
        echo "Stopping services..."
        docker-compose --env-file "$ENV_FILE" stop cataloguesearch-api cataloguesearch-frontend
        
        # Build images
        echo "Building API service..."
        docker-compose --env-file "$ENV_FILE" build cataloguesearch-api
        echo "Building frontend service..."
        docker-compose --env-file "$ENV_FILE" build cataloguesearch-frontend
        
        # Start API first, then frontend
        echo "Starting API service..."
        docker-compose --env-file "$ENV_FILE" down cataloguesearch-api
        docker-compose --env-file "$ENV_FILE" up -d --no-deps cataloguesearch-api
        echo "Waiting for API to stabilize..."
        sleep 5
        
        echo "Starting frontend service..."
        docker-compose --env-file "$ENV_FILE" down cataloguesearch-frontend
        docker-compose --env-file "$ENV_FILE" up -d --no-deps cataloguesearch-frontend
        
        echo ""
        echo "Frontend and backend services restarted successfully!"
        echo "Frontend available at: http://localhost:3000"
        echo "API available at: http://localhost:8000"
        ;;
    "logs")
        docker-compose --env-file "$ENV_FILE" logs -f
        ;;
    "push")
        echo "Building and pushing images to Docker Hub (swalakshya/cataloguesearch)..."
        echo "This will build the images and then push them to the repository defined in docker-compose.yml."
        echo "Please ensure you are logged in with 'docker login'."

        # Always build before pushing to ensure images are created and tagged correctly.
        docker-compose --env-file "$ENV_FILE" build
        docker-compose --env-file "$ENV_FILE" push
        echo "Images pushed successfully."
        ;;
    "push-api")
        echo "Building and pushing only API image to Docker Hub (swalakshya/cataloguesearch:api)..."
        echo "Please ensure you are logged in with 'docker login'."

        # Build and push only the API service
        docker-compose --env-file "$ENV_FILE" build cataloguesearch-api
        docker-compose --env-file "$ENV_FILE" push cataloguesearch-api
        echo "API image pushed successfully."
        ;;
    "push-frontend")
        echo "Building and pushing only frontend image to Docker Hub (swalakshya/cataloguesearch:frontend)..."
        echo "Please ensure you are logged in with 'docker login'."

        # Build and push only the frontend service
        docker-compose --env-file "$ENV_FILE" build cataloguesearch-frontend
        docker-compose --env-file "$ENV_FILE" push cataloguesearch-frontend
        echo "Frontend image pushed successfully."
        ;;
esac
