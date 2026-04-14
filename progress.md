# Project Progress: SEEVAr Referee Crawler

## Development Roadmap

- [x] Project Core Setup
    - [x] Add Prisma and TypeScript dependencies
    - [x] Initialize Prisma Client
    - [x] Configure environment variables
- [x] Step 1: Daily Match Schedule Scraper (`02:22 AM`)
    - [x] Implement K-League Schedule parser
    - [x] Save today's matches to DB
- [x] Step 2: Round Focus & Match Time Sync
    - [x] Update schedule scraper to extract Round numbers
    - [x] Implement `isFocus` logic (one per league)
    - [x] Implement match time synchronization
- [x] Step 3: Referee Information Scraper (`Kickoff - 70m`)
    - [x] Implement referee assignment extraction
    - [x] Handle referee creation and mapping
- [x] Step 3: Match Result Scraper (`Kickoff + 127m`)
    - [x] Extract scores and card counts
    - [x] Finalize match status and update database
- [x] Gemini AI Integration
    - [x] Vision-based extraction fallback for dynamic layouts
- [x] Scheduling & Reliability
    - [x] PM2 ecosystem setup
    - [x] Error logging and monitoring
- [x] Testing & Deployment
    - [x] Manual test with historic match data
    - [x] Deploy to Droplet

## Log
- 2026-04-10: Created development plan based on `seevar-crawling-automain-spec.md`.
- 2026-04-10: Implemented core scraper logic (Schedule, Referees, Results).
- 2026-04-10: Integrated Gemini 2.0 Flash vision-based fallback for dynamic content.
- 2026-04-10: Configured PM2 orchestration and cron scheduling.
- 2026-04-10: Completed implementation and provided walkthrough.
