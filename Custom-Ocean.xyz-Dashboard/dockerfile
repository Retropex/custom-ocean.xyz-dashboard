FROM python:3.9-slim

WORKDIR /app

# Install curl for healthcheck and other dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install dependencies first to leverage Docker cache.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire application.
COPY . .

# Run the minifier to process HTML templates.
RUN python minify.py

# Create a non-root user first.
RUN adduser --disabled-password --gecos '' appuser

# Change ownership of the /app directory so that appuser can write files.
RUN chown -R appuser:appuser /app

# Create a directory for logs with proper permissions
RUN mkdir -p /app/logs && chown -R appuser:appuser /app/logs

USER appuser

EXPOSE 5000

# Add environment variables for app configuration
ENV FLASK_ENV=production
ENV PYTHONUNBUFFERED=1
ENV PYTHON_UNBUFFERED=1

# Improve healthcheck reliability - use new health endpoint
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:5000/api/health || exit 1

# Use Gunicorn as the production WSGI server with improved settings
# For shared global state, we need to keep the single worker model but optimize other parameters
CMD ["gunicorn", "-b", "0.0.0.0:5000", "App:app", \
     "--workers=1", \
     "--threads=12", \
     "--timeout=600", \
     "--keep-alive=5", \
     "--log-level=info", \
     "--access-logfile=-", \
     "--error-logfile=-", \
     "--log-file=-", \
     "--graceful-timeout=60", \
     "--worker-tmp-dir=/dev/shm"]