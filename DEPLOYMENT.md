# Job Finder - Deployment Guide

## Quick Start - Railway

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/job_finder.git
   git push -u origin main
   ```

2. **Connect to Railway**
   - Visit https://railway.app
   - Click "New Project" → "Deploy from GitHub"
   - Select your repository
   - Railway auto-detects Node.js backend

3. **Configure Environment**
   - Go to project settings
   - Add variables from `.env.example`
   - Set `SESSION_SECRET` to a strong random value
   - Set `NODE_ENV=production`

4. **Deployment**
   - Railway auto-deploys on git push
   - Your app will be live at `https://your-project.up.railway.app`

## Environment Setup

Copy `.env.example` to `.env` and fill in production values:
```bash
cp .env.example .env
```

Never commit `.env` file to git.

## Database Migration (Future)

Current app uses local JSON files. To scale to production:

1. **Option A: PostgreSQL (Recommended)**
   - Railway includes free PostgreSQL
   - Replace `private/app-data.enc` with database tables

2. **Option B: Keep JSON with Cloud Storage**
   - Use Railway's Volumes for persistent storage
   - Or migrate `private/` folder to S3

## Production Checklist

- [ ] Environment variables configured
- [ ] SESSION_SECRET set to random 32+ char value
- [ ] Database/storage option chosen
- [ ] CORS origins configured if needed
- [ ] Session cookie secure flag enabled (auto in production)
- [ ] HTTPS enforced (auto with Railway/Render)

## Monitoring

- Railway provides logs dashboard
- Monitor for authentication errors
- Track storage usage growth

## Support Links

- Railway Docs: https://docs.railway.app
- Render Docs: https://render.com/docs
- Node.js Best Practices: https://nodejs.org/en/docs/guides/nodejs-web-app-without-dependencies/
