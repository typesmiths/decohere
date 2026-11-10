FROM decohere-devcontainer-image

# The base image ends as the node user, and its build arguments don't carry over: this image
# declares its own, runs its steps as root, and hands back to that user at the end.
ARG USERNAME=node

USER root

# A volume copies the mode of the folder it's mounted over, and a Dev Container changes node's
# user ID to match the host's, so node_modules is writable by any user ID.
RUN mkdir -p /workspace-name/node_modules && chown ${USERNAME}:${USERNAME} /workspace-name/node_modules && chmod 777 /workspace-name/node_modules

USER ${USERNAME}
