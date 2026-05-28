FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    cmake \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt

RUN git clone --depth 1 https://github.com/ggml-org/llama.cpp.git

WORKDIR /opt/llama.cpp

RUN cmake -B build \
    -DLLAMA_BUILD_SERVER=ON \
    -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --config Release -j$(nproc)

RUN ln -s /opt/llama.cpp/build/bin/llama-server /usr/local/bin/llama-server

EXPOSE 8080

CMD ["llama-server", "--host", "0.0.0.0", "--port", "8080"]
