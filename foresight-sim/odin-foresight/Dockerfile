FROM python:3.12-slim

# LightGBM requires libgomp1 on Linux
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api/       ./api/
COPY data/      ./data/
COPY features/  ./features/
COPY model/     ./model/
COPY training/  ./training/

# Ensure the saved model symlink points to the correct version
RUN rm -rf ./model/saved/latest \
    && ln -s foresight_20260312_0702 ./model/saved/latest

CMD ["sh", "-c", "uvicorn api.app:app --host 0.0.0.0 --port ${PORT:-8001}"]
