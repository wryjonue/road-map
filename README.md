# RoadMap

RoadMap is a website for reporting road hazards, viewing incident locations in the Province of Bataan.
---
## Features

- Browse a report feed with incident details, images, votes, and comments.
- Create incident reports with image upload and road-location snapping.
- View incidents on an interactive MapLibre GL map.
- Review dashboard metrics and a monthly incident chart powered by Chart.js.
- Use Clerk authentication and role-based access for users, authorities, and administrators.
- Allow authorities and administrators to move reports through their supported status transitions.
---
## Tech-stack Used: Cloudflare-Stack

- Cloudflare Vite Plugin for **Template**
- Cloudflare D1 for **Relational Database**
- Cloudflare R2 for **Object Storage**
- Cloudflare Wrangler for **Shipping**
- React 19 and React Router for **Frontend**
- Clerk for **Authentication**
- MapLibre GL + OpenStreetMap tiles for **2D Maps**
- Chart.js for **Dashboard Graphs**
- Geoapify for **Static Maps and Map Matching**
- Nominatim **Reverse Geocoding**
---
## Setup

Requirements: Node.js and npm.

Install dependencies:

```sh
npm install
```

Create a local `.dev.vars` file for Worker secrets and development configuration. Use placeholders or your own local values; do not commit this file or real secrets:

```dotenv
GEOAPIFY_API_KEY=your-server-side-geoapify-key
CLERK_JWT_KEY=your-clerk-jwt-key
CLERK_AUTHORIZED_PARTIES=http://localhost:5173
ALLOW_LOCAL_MOCK_AUTH=false
VITE_CLERK_PUBLISHABLE_KEY=pk_test_your-public-clerk-key
```

The Clerk publishable key is public and may also be supplied through the Vite environment or Wrangler configuration used by your deployment. Never put private Clerk keys or the Geoapify key in a `VITE_` variable.

Apply the local D1 migrations:

```sh
npx wrangler d1 migrations apply road-map-db --local
```

Start the development server:

```sh
npm run dev
```

For local-only testing without Clerk, mock authentication can be enabled with `ENVIRONMENT=development`, `ALLOW_LOCAL_MOCK_AUTH=true`, and the `X-Local-Mock-Auth: true` request header. Keep this disabled outside local development.
---
## Commands

```sh
npm run lint    # Run Oxlint
npm test        # Run Worker/report access tests
npm run build   # Build the Vite application
npm run preview  # Build and serve a local preview
```
---
## Disclaimer

> This website is submitted to **Mr. Lester John De Lemos**, **Ms. Christina Veneath Somo**, **Mr. Ezekiel Ortiguerra**, and **Mr. Manuel Lyttelton Nuevo** as part of the College of Computer Studies curriculum at the **Bataan Peninsula State University**. The website and source project are **not intended for public use and consumption** and is provided for **demonstration and development purposes** only. Verify incident information and follow applicable local laws and safety guidance before taking action.
