FROM opensearchproject/opensearch:3.3.1

# Unicode-aware tokenisation for Hindi and Gujarati. Use the base image's
# entrypoint; snapshot creation/restoration is managed by scripts/ separately.
RUN /usr/share/opensearch/bin/opensearch-plugin install --batch analysis-icu
