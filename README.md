# AI Place Canvas

A collaborative, real-time canvas inspired by Reddit Place where users can generate AI images on tiles. Built with Next.js 14, TypeScript, Supabase, and CometAPI.

## Features

- 🎨 **100x100 tile canvas** - Large shared grid visible to all users
- 🤖 **AI Image Generation** - Generate images using Google Nano Banana (Gemini 2.5 Flash Image) via CometAPI
- 🔒 **Tile Locking** - 90-second lock during generation to prevent conflicts
- ⏱️ **User Cooldowns** - 120-second cooldown after successful placement
- 🔄 **Real-time Updates** - Canvas updates live for all users via Supabase Realtime
- 📜 **Tile History** - View history of changes for each tile
- 🎯 **One Active Job** - Users can only have one generation in progress at a time

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes, Supabase (Postgres, Realtime, Storage, Auth)
- **Image Generation**: CometAPI (Google Nano Banana / Gemini 2.5 Flash Image)
- **Worker**: Node.js script with tsx for processing generation jobs

## Prerequisites

- Node.js 18+ and npm
- A Supabase account and project
- A CometAPI account and API key

## Setup Instructions

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd collaborative-canvas
npm install
```

### 2. Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the migration file:
   - Copy contents of `supabase/migrations/001_initial_schema.sql`
   - Paste and execute in Supabase SQL Editor
3. Go to **Storage** and create a new bucket:
   - Name: `tile-images`
   - Public: Yes (so images can be accessed)
   - File size limit: 5MB (or as needed)
4. Get your Supabase credentials:
   - Go to **Settings** → **API**
   - Copy `Project URL` (NEXT_PUBLIC_SUPABASE_URL)
   - Copy `anon public` key (NEXT_PUBLIC_SUPABASE_ANON_KEY)
   - Copy `service_role` key (SUPABASE_SERVICE_ROLE_KEY) - keep this secret!

### 3. Enable Realtime

1. In Supabase dashboard, go to **Database** → **Replication**
2. Enable replication for `canvas_tiles` table
3. This allows real-time updates to propagate to clients

### 4. Configure Environment Variables

Create a `.env.local` file in the root directory:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# CometAPI Configuration
COMETAPI_KEY=sk-vitDDsgwwVwYpXpNn0ANDpxQvqy5mFC1noQb4ltonHw5tvg0

# Node Environment
NODE_ENV=development
```

### 5. Run the Application

**Terminal 1 - Next.js Dev Server:**
```bash
npm run dev
```

**Terminal 2 - Worker (processes generation jobs):**
```bash
npm run worker
```

The app will be available at `http://localhost:3000`

## Project Structure

```
/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   ├── tiles/        # Tile locking endpoint
│   │   └── jobs/          # Job creation/cancellation
│   ├── auth/              # Auth callback handler
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Main canvas page
├── components/            # React components
│   ├── Canvas.tsx        # Main canvas with pan/zoom
│   ├── Tile.tsx          # Individual tile rendering
│   ├── TileModal.tsx     # Prompt input modal
│   └── TileHistory.tsx   # History display
├── lib/                   # Utilities and config
│   ├── constants.ts       # App constants
│   ├── types.ts           # TypeScript types
│   ├── image-generation.ts # CometAPI integration
│   └── supabase/          # Supabase clients
├── supabase/
│   └── migrations/        # Database migrations
├── worker/
│   └── index.ts           # Job processing worker
└── README.md
```

## How It Works

### User Flow

1. **Sign In**: User signs in with email (magic link via Supabase Auth)
2. **Select Tile**: User clicks on a tile on the canvas
3. **Lock Tile**: System attempts to lock the tile for 90 seconds
4. **Enter Prompt**: User enters a text prompt (max 200 chars)
5. **Create Job**: System validates:
   - User has no active jobs
   - User cooldown has expired
   - User owns the tile lock
6. **Process Job**: Worker picks up the job, generates image via CometAPI, uploads to Supabase Storage
7. **Update Canvas**: Tile is updated with new image, history is recorded, cooldown is set
8. **Real-time Sync**: All users see the update instantly via Supabase Realtime

### Database Schema

- **canvas_tiles**: Current state of each tile (image URL, prompt, lock info)
- **tile_history**: Audit trail of all tile changes
- **generation_jobs**: Queue for async image generation
- **user_cooldowns**: Tracks user cooldown periods

### Concurrency Controls

- **Tile Locking**: Atomic SQL UPDATE ensures only one user can lock a tile
- **One Active Job**: Database query prevents users from creating multiple jobs
- **Cooldown**: Enforced at database level with timestamp checks
- **Optimistic Locking**: Version field on tiles (for future use)

## API Endpoints

### POST `/api/tiles/lock`
Locks a tile for the current user.

**Request:**
```json
{
  "x": 10,
  "y": 20
}
```

**Response:**
```json
{
  "success": true,
  "lock_until": "2024-01-01T12:00:00Z",
  "lock_by": "user-uuid"
}
```

### POST `/api/jobs/create`
Creates a new image generation job.

**Request:**
```json
{
  "x": 10,
  "y": 20,
  "prompt": "a beautiful sunset over mountains"
}
```

**Response:**
```json
{
  "success": true,
  "job": {
    "id": "job-uuid",
    "x": 10,
    "y": 20,
    "prompt": "a beautiful sunset over mountains",
    "status": "queued",
    "created_at": "2024-01-01T12:00:00Z"
  }
}
```

### POST `/api/jobs/cancel`
Cancels a user's own job.

**Request:**
```json
{
  "jobId": "job-uuid"
}
```

## Worker Script

The worker script (`worker/index.ts`) runs continuously and:

1. Polls for queued jobs every 5 seconds
2. Marks job as "running"
3. Calls CometAPI to generate image
4. Downloads and uploads image to Supabase Storage
5. Updates tile, records history, sets cooldown, clears lock
6. Handles errors gracefully

Run with: `npm run worker`

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only) | Yes |
| `COMETAPI_KEY` | CometAPI API key | Yes |
| `NODE_ENV` | Node environment (development/production) | No |

## Deployment

### Vercel (Recommended)

1. Push code to GitHub
2. Import project in Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

### Worker Deployment

For production, deploy the worker as a separate service:

- **Option 1**: Vercel Cron Jobs (if supported)
- **Option 2**: Railway, Render, or similar platform
- **Option 3**: Docker container on any cloud provider

Make sure the worker has access to all environment variables.

## Troubleshooting

### Images not generating
- Check CometAPI key is correct
- Verify worker is running
- Check worker logs for errors
- Ensure Supabase Storage bucket exists and is public

### Real-time updates not working
- Verify Realtime is enabled for `canvas_tiles` table
- Check browser console for WebSocket errors
- Ensure Supabase project has Realtime enabled

### Lock acquisition failing
- Check if tile is already locked by another user
- Verify user is authenticated
- Check API route logs

## License

MIT

## Contributing

Contributions welcome! Please open an issue or pull request.
