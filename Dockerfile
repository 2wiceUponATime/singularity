FROM ubuntu:25.10@sha256:36bbb8adc0662496d3e314bc8a25cb41c0c2e42ed25daaa07f8369d36d16f082

RUN apt-get update && apt-get install -y curl git

RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y nodejs

RUN curl -fsSL https://ollama.com/install.sh | sh

# ARG OLLAMA_MODEL
# RUN --mount=type=cache,target=/root/.ollama --mount=type=cache,target=/usr/local/share/ollama \
#     ollama serve & \
#     until curl -s http://localhost:11434/api/version >/dev/null; do sleep 1; done && \
#     echo "Pulling model ${OLLAMA_MODEL}..." && \
#     ollama pull "${OLLAMA_MODEL}" || (echo "Failed to pull model ${OLLAMA_MODEL}" && exit 1) && \
#     echo "Successfully pulled model ${OLLAMA_MODEL}" && \
#     ollama list


ARG GIT_USERNAME
ARG GIT_EMAIL
RUN git config --global init.defaultBranch main && \
    git config --global user.name "${GIT_USERNAME}" && \
    git config --global user.email "${GIT_EMAIL}"


WORKDIR /root/app

COPY app/package*.json ./
RUN npm install

RUN npx gitignore node
RUN echo -en "\n\n# Saved messages\nmessages.json" >> .gitignore

COPY app/ ./

# RUN git init && git add . && git commit -m "Initial commit"

COPY main.bash /root/
RUN chmod +x /root/main.bash

WORKDIR /app
CMD ["/root/main.bash"]