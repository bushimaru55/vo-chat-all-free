FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    cmake \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git

WORKDIR /opt/whisper.cpp
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --config Release -j$(nproc) \
    && if [ -f /opt/whisper.cpp/build/bin/whisper-cli ]; then \
         ln -sf /opt/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli; \
       elif [ -f /opt/whisper.cpp/build/bin/main ]; then \
         ln -sf /opt/whisper.cpp/build/bin/main /usr/local/bin/whisper-cli; \
       else \
         echo "whisper-cli binary not found" && ls -la /opt/whisper.cpp/build/bin && exit 1; \
       fi

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app /app/app

EXPOSE 9000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9000"]
