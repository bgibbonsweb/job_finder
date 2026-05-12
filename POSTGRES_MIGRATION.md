# PostgreSQL Migration Guide

This guide walks you through migrating Job Finder from JSON file storage to PostgreSQL.

## What's Migrating

Before: Local JSON files + encrypted storage
- `private/app-data.enc` - User data (passwords, sessions, resumes, bookmarks)
- In-memory cache for company audits

After: PostgreSQL database
- Persistent, scalable user data
- Built-in session management
- Automatic backups
- Easy multi-instance deployment

## Prerequisites

1. **PostgreSQL client installed**
   ```bash
   brew install postgresql  # macOS
   # or
   apt-get install postgresql-client  # Linux
   ```

2. **Database URL** - either local or cloud:
   ```bash
   # Local development
   postgresql://localhost/job_finder
   
   # Railway production
   postgresql://user:pass@host:5432/railway
   ```

## Local Development Setup

### 1. Create Local Database
```bash
createdb job_finder
```

### 2. Initialize Schema
```bash
export DATABASE_URL="postgresql://localhost/job_finder"
npm run db:init
```

This creates all tables:
- users, sessions, resumes, user_jobs, company_audits, user_preferences

### 3. Migrate Existing Data (optional)
If you have existing JSON data to move:
```bash
npm run db:migrate
```

This:
- Reads `private/app-data.enc`
- Imports users, resumes, bookmarks, sessions into PostgreSQL

### 4. Start Server with Database
```bash
export DATABASE_URL="postgresql://localhost/job_finder"
npm start
```

Server will now:
- Store all user data in PostgreSQL
- Keep company audit cache fresh
- Auto-cleanup expired sessions

## Production Deployment (Railway)

### 1. Add PostgreSQL to Railway
1. Go to your Railway project
2. Click "New" → "Database" → "PostgreSQL"
3. Railway auto-creates DATABASE_URL variable

### 2. Initialize Remote Database
```bash
# Get your Railway PostgreSQL URL from dashboard
export DATABASE_URL="postgresql://user:pass@host:5432/railway"

# Initialize schema
npm run db:init

# Migrate existing data if any
npm run db:migrate
```

### 3. Deploy Backend
Push your code to GitHub:
```bash
git add -A
git commit -m "Add PostgreSQL migration"
git push origin main
```

Railway auto-deploys and connects to PostgreSQL via `DATABASE_URL` variable.

## Verify Migration

### Check Tables Created
```bash
psql $DATABASE_URL
```

```sql
\dt  -- list tables

SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public';
```

### Check Data
```sql
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM resumes;
SELECT COUNT(*) FROM user_jobs WHERE is_bookmarked = TRUE;
```

### Test Authentication
1. Visit your app: `https://your-domain.app`
2. Sign up with test account
3. Check database:
   ```sql
   SELECT * FROM users WHERE email = 'test@example.com';
   SELECT * FROM sessions WHERE user_id = 'your-user-id';
   ```

## Troubleshooting

### "relation users does not exist"
Solution: Run `npm run db:init` with DATABASE_URL set

### "connection refused"
Solution: Check DATABASE_URL is correct and database is running
```bash
psql $DATABASE_URL -c "SELECT 1"
```

### "permission denied"
Solution: Check database user has permissions
```bash
psql -U postgres -h host -d railway
```

### "SSL error"
Solution: Add `?sslmode=require` to DATABASE_URL:
```bash
postgresql://user:pass@host:5432/railway?sslmode=require
```

### Slow queries
Solution: Check indexes were created
```sql
\d resumes  -- show table with indexes
SELECT * FROM pg_indexes WHERE tablename = 'user_jobs';
```

## Database Schema

### users
```sql
id SERIAL PRIMARY KEY
user_id TEXT UNIQUE
email TEXT UNIQUE
password_hash TEXT
password_salt TEXT
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

### sessions
```sql
id SERIAL PRIMARY KEY
user_id TEXT REFERENCES users
session_token TEXT UNIQUE
expires_at TIMESTAMPTZ
created_at TIMESTAMPTZ
last_accessed_at TIMESTAMPTZ
```

### resumes
```sql
id SERIAL PRIMARY KEY
user_id TEXT REFERENCES users
resume_id TEXT UNIQUE
name TEXT
text TEXT
profile_label TEXT
source_name TEXT
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

### user_jobs
```sql
id SERIAL PRIMARY KEY
user_id TEXT REFERENCES users
job_id TEXT
is_bookmarked BOOLEAN
is_hidden BOOLEAN
hidden_company TEXT
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
UNIQUE(user_id, job_id)
```

### company_audits
```sql
id SERIAL PRIMARY KEY
company_name TEXT UNIQUE
audit_data JSONB
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

### user_preferences
```sql
id SERIAL PRIMARY KEY
user_id TEXT UNIQUE REFERENCES users
last_search_state JSONB
score_weights JSONB
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

## Performance

All tables have indexes on:
- `user_id` - for per-user queries
- `session_token` - for session lookups
- `expires_at` - for session cleanup
- `updated_at` - for cache invalidation

Connection pooling: max 20 concurrent connections

## Rollback (If Needed)

If you need to go back to JSON:
1. Stop the server
2. Unset DATABASE_URL environment variable
3. JSON files still exist locally
4. Restart server

Old JSON data in `private/app-data.enc` is preserved.

## Next Steps

1. Monitor database usage in Railway dashboard
2. Set up automated backups
3. Review slow queries in PostgreSQL logs
4. Scale connections if needed

## Support

- [PostgreSQL Docs](https://www.postgresql.org/docs/)
- [Railway PostgreSQL Guide](https://docs.railway.app/guides/databases)
- [Node pg Module](https://node-postgres.com/)
