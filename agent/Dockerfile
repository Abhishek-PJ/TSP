FROM python:3.11-slim
WORKDIR /app

# install curl (and ca-certificates) so the healthcheck can run
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn","server:app","--host","0.0.0.0","--port","8000"]
