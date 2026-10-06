FROM opensearchproject/opensearch:3.6.0

# The full distribution bundles the plugins needed for local embedding and
# cross-encoder inference. Fail the build if a future base image omits them.
RUN set -eu; \
    plugins="$(/usr/share/opensearch/bin/opensearch-plugin list)"; \
    for plugin in opensearch-ml opensearch-neural-search opensearch-knn; do \
        echo "$plugins" | grep -Fx "$plugin"; \
    done

# Install required plugins
RUN /usr/share/opensearch/bin/opensearch-plugin install --batch analysis-icu && \
    /usr/share/opensearch/bin/opensearch-plugin install --batch repository-gcs

# Install jq for JSON parsing
USER root
RUN yum install -y jq && \
    yum clean all

# Copy custom scripts
COPY --chown=opensearch:opensearch docker/opensearch/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --chown=opensearch:opensearch docker/opensearch/restore-snapshot.sh /usr/local/bin/restore-snapshot.sh

# Make scripts executable
RUN chmod +x /usr/local/bin/entrypoint.sh && \
    chmod +x /usr/local/bin/restore-snapshot.sh

USER opensearch

# Use custom entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
