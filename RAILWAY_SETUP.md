# Railway Deployment Setup - PostgreSQL Edition

## Step 1: Add PostgreSQL Database
1. Go to your Railway project dashboard
2. Click "New" → Select "Database" → Choose "PostgreSQL"
3. Railway creates the database and provides `DATABASE_URL` in your project variables automatically
4. Note the connection string for later

## Step 2: Connect GitHub Repository
1. In your Railway project, click "New" → "GitHub Repo"
2. Select the `bgibbonsweb/job_finder` repository
3. Railway auto-detects this is a Node.js project with PostgreSQL

## Step 3: Configure Environment Variables
In Railway dashboard, go to Variables tab and add:

```
NODE_ENV=production
PORT=3000
SESSION_SECRET=<generate-random-32-chars>
DATABASE_URL=<railway-provides-this-auto>
```

**Railway Note:** DATABASE_URL is automatically set when you add PostgreSQL. Don't override it.

**Generate SESSION_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Step 4: Initialize Database Schema
Before deployment, prepare the database:

1. Get your Railway PostgreSQL URL from the dashboard
2. In your local terminal, run:
```bash
export DATABASE_URL="postgresql://user:pass@host:5432/railway"
npm run db:init
npm run db:migrate
```

This:
- Creates all database tables
- Migrates any existing data from JSON files
- Sets up indexes for performance

## Step 5: Deploy
Click "Deploy" button. Railway will:
1. Install dependencies (root + frontend)
2. Build React frontend
3. Start Node.js server connected to PostgreSQL
4. Assign you a public URL

## Step 6: Test the Deployment
Visit: `https://your-project.railway.app`

You should see:
- ✅ Frontend loads
- ✅ Sign up/login works (data persists in PostgreSQL)
- ✅ Bookmarks save to database
- ✅ Job search works

## Production Checklist

- ✅ PostgreSQL database added
- ✅ DATABASE_URL configured
- ✅ SESSION_SECRET set to random value
- ✅ NODE_ENV=production
- ✅ Database initialized with `npm run db:init`
- ✅ Data migrated with `npm run db:migrate`
- ✅ Frontend builds successfully
- ✅ HTTPS auto-enabled

## Database Tables

- `users` - Email & password
- `sessions` - Login tokens
- `resumes` - User resumes
- `user_jobs` - Bookmarks & hidden jobs
- `company_audits` - Cache
- `user_preferences` - Search state

## Debugging

**View logs:**
- Railway Dashboard → Logs tab

**Common issues:**

1. **"relation users does not exist"** → Run `npm run db:init`
2. **"connection refused"** → Check DATABASE_URL is set
3. **"port already in use"** → Server uses `process.env.PORT` ✅

## Support

- [Railway Docs](https://docs.railway.app)
- [PostgreSQL Guide](https://docs.railway.app/guides/databases)
