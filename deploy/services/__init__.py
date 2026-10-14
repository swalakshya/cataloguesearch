"""Allow-listed local services, in dependency order."""
from .base import Service
from .docker import DockerService
from .opensearch import OpenSearchService
from .applications import APIService, ChatService, UIService

SERVICE_TYPES = (DockerService, OpenSearchService, APIService, ChatService, UIService)
