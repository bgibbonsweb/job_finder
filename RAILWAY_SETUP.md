# Railway Deployment Setup - Quick Start

## Step 1: Connect GitHub Repository
1. Go to https://railway.app
2. Click "New Project"
3. Select "GitHub" → Connect your GitHub account
4. Select the `bgibbonsweb/job_finder` repository
5. Railway will auto-detect this is a Node.js project

## Step 2: Configure Environment Variables
In Railway dashboard, go to your project → Variables tab and add:

```
NODE_ENV=production
PORT=3000
SESSION_SECRET=<generate-random-32-chars>
```

**Generate SESSION_SECRET:**
On your terminal run:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy the output and paste it as `SESSION_SECRET` value.

## Step 3: Configure Build & Start
In Railway dashboard → Settings:

- **Build Command**: Leave blank (Railway auto-detects npm scripts)
- **Start Command**: Leave blank (Railway uses `npm start`)

Railway will automatically:
1. Run `npm install` (root + frontend)
2. Run `npm start` which:
   - Builds the React frontend: `npm --prefix frontend run build`
   - Starts the Node.js server: `node server.js`

## Step 4: Deploy
Click "Deploy" button. Railway will:
1. Clone your repository
2. Install dependencies
3. Build the frontend
4. Start the server
5. Assign you a public URL like `https://your-project.railway.app`

## Step 5: Test the Deployment
Once deployed, visit: `https://your-project.railway.app`

You should see:
- ✅ Frontend loads with job search
- ✅ API endpoints work at `/api/jobs`
- ✅ Authentication works with `/api/auth/*` endpoints

## Monitoring & Debugging

**View Logs:**
- Railway Dashboard → Logs tab
- Watch for any build or runtime errors

**Common Issues:**

1. **"Frontend not yet built"** → The build step failed
   - Check logs for `npm run build` errors
   - Verify all dependencies installed

2. **"Port already in use"** → Railway auto-assigns PORT
   - Don't hardcode port; use `process.env.PORT`
   - Server already reads this ✅

3. **API errors** → Check environment variables
   - Ensure `SESSION_SECRET` is set
   - Verify `NODE_ENV=production`

## Optional: Add Database

If you want to persist user data across deployments (currently uses local JSON files):

1. **Add PostgreSQL** (Railway includes free tier):
   - Railway → Plugins → Add PostgreSQL
   - Add `DATABASE_URL` to variables

2. **Migrate storage** (future enhancement):
   - Replace `private/app-data.enc` with database
   - Use encrypted columns for sensitive data

## Production Checklist

- ✅ Environment variables configured
- ✅ SESSION_SECRET set to cryptographically random value
- ✅ NODE_ENV=production for secure cookies
- ✅ Frontend builds successfully
- ✅ Server serves static assets
- ✅ HTTPS auto-enabled (Railway provides)
- ✅ Logs accessible for debugging

## Next Steps

1. Monitor your Railway deployment for 24 hours
2. Test authentication flow (signup → login → bookmark)
3. Check job search performance
4. Review logs for any warnings

## Support Resources

- [Railway Docs](https://docs.railway.app)
- [Node.js on Railway](https://docs.railway.app/guides/nodejs)
- [Environment Variables](https://docs.railway.app/develop/variables)
