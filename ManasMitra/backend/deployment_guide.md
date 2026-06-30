# Pre-screening API Deployment Guide

This guide details how to deploy the FastAPI backend service to various hosting platforms so that third-party applications can call the endpoints described in [api_integration_guide.md](file:///c:/Users/hp/Downloads/ManasMitra/backend/api_integration_guide.md).

---

## 1. Key Deployment Considerations

### 🔑 Environment Variables
You must set the following environment variables in your hosting environment:
*   `GROQ_API_KEY`: Your Groq API key (to enable backend-side inference).

### 💾 SQLite Persistence (Crucial!)
Because the backend uses SQLite (`db.sqlite3`), deploying to stateless hosting (like AWS ECS Fargate or standard Google Cloud Run) will wipe user conversations and evaluation metrics whenever the container restarts.
*   **Recommended**: Attach a persistent disk/volume to the directory `/app/` (or wherever your SQLite database file resides) or mount `db.sqlite3` externally.
*   **Alternative**: If scale is required, migrate the connection logic in `get_db()` in [main.py](file:///c:/Users/hp/Downloads/ManasMitra/backend/main.py#L31-L37) to PostgreSQL or MySQL.

---

## 2. Deployment Options

### Option A: PaaS (Render / Railway / Fly.io) - *easiest*
Platform-as-a-Service environments automatically build your repository from Git and deploy it.

#### Deploying on Render:
1.  Go to [Render Dashboard](https://dashboard.render.com/) and create a **Web Service**.
2.  Connect your GitHub repository.
3.  Set the following configuration:
    *   **Runtime**: `Python` (or `Docker` using the provided [Dockerfile](file:///c:/Users/hp/Downloads/ManasMitra/backend/Dockerfile))
    *   **Build Command**: `pip install -r backend/requirements.txt`
    *   **Start Command**: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT` (adjust path to match root folder setup)
4.  Add **Environment Variables**:
    *   `GROQ_API_KEY` = `gsk_your_groq_api_key`
5.  To persist the database, go to the **Disk** section and mount a persistent disk at path `/app/data`, then update `DB_FILE` in `main.py` to point to `/app/data/db.sqlite3`.

---

### Option B: Containerized (Docker / AWS / GCP)
We have provided a [Dockerfile](file:///c:/Users/hp/Downloads/ManasMitra/backend/Dockerfile) in the backend directory.

#### Local Build & Run:
To test the production container locally:
```bash
# Build the Docker image
docker build -t pre-screening-backend ./backend

# Run the container (binding SQLite to host folder for persistence)
docker run -d -p 8000:8000 \
  -e GROQ_API_KEY="gsk_..." \
  -v $(pwd)/backend_data:/app \
  pre-screening-backend
```

#### Deploying Container to AWS (Elastic Container Service / App Runner):
1.  Push the built image to **Amazon ECR** (Elastic Container Registry).
2.  Deploy to **AWS App Runner** or **AWS ECS**.
3.  Ensure you pass `GROQ_API_KEY` as an environment variable in the container definitions.
4.  Expose port `8000` to the internet.

---

### Option C: Virtual Private Server (VPS: DigitalOcean / EC2)
For absolute control, host on a Linux instance using Systemd and Nginx as a reverse proxy.

#### 1. Setup the Service:
Create a systemd unit file on your VPS at `/etc/systemd/system/prescreening.service`:
```ini
[Unit]
Description=FastAPI Pre-screening Service
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/ManasMitra/backend
Environment="GROQ_API_KEY=gsk_..."
ExecStart=/home/ubuntu/ManasMitra/backend/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 4
Restart=always

[Install]
WantedBy=multi-user.target
```

Start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable prescreening
sudo systemctl start prescreening
```

#### 2. Reverse Proxy with Nginx:
Configure Nginx to route traffic from public port 80/443 to port 8000. Add this server block to `/etc/nginx/sites-available/default`:
```nginx
server {
    listen 80;
    server_name your-api-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Reload Nginx: `sudo systemctl restart nginx`

---

## 3. Verifying the Deployment

Once deployed, you can verify your service is accessible by making a simple request using cURL replacing `localhost:8000` with your deployed domain name:

```bash
curl -X GET https://your-api-domain.com/api/documents
```
If successful, it returns the list of active clinical prescreening reference guides loaded on the server.
