FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    libgl1 \
    libglib2.0-0 \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY . .

# Build frontend SPA
RUN cd frontend && npm install && npm run build

# Expose port and start server
EXPOSE 8001
CMD ["sh", "-c", "gunicorn -w 1 -k uvicorn.workers.UvicornWorker main:app --bind 0.0.0.0:${PORT:-8001} --timeout 120"]
