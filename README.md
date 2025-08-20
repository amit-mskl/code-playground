# Code Playground

A full-stack SQL playground application with React frontend and Node.js backend.

## Project Structure

```
code-playground/
├── client/          # React frontend application
├── server/          # Node.js backend API
├── package.json     # Root package.json with workspace configuration
└── README.md        # This file
```

## Features

- Interactive SQL query editor with Monaco Editor
- PostgreSQL database connectivity
- User authentication and activity logging
- Real-time query execution
- Schema exploration tools

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- PostgreSQL database
- npm or yarn

### Installation

1. Clone or navigate to this repository
2. Install all dependencies:
   ```bash
   npm run install:all
   ```

### Environment Setup

Create a `.env` file in the `server/` directory with your database configuration:

```env
DB_HOST=your_postgres_host
DB_PORT=5432
DB_NAME=your_database_name
DB_USER=your_username
DB_PASSWORD=your_password

SUPABASE_HOST=your_supabase_host
SUPABASE_PORT=5432
SUPABASE_DB=your_supabase_db
SUPABASE_USER=your_supabase_user
SUPABASE_PASSWORD=your_supabase_password
```

### Development

To start both client and server in development mode:

```bash
npm run dev
```

This will start:
- Client on http://localhost:3000
- Server on http://localhost:3001

### Individual Commands

- Start only the client: `npm run dev:client`
- Start only the server: `npm run dev:server`
- Build the client: `npm run build`
- Run tests: `npm run test`

## API Endpoints

- `GET /api/test` - Test server connection
- `GET /api/tables` - Get database tables
- `POST /api/query` - Execute SQL queries
- `GET /api/schema/:tableName` - Get table schema
- `POST /api/signup` - User registration
- `POST /api/login` - User authentication
- `POST /api/log-activity` - Log user activity

## Technology Stack

### Frontend
- React 19
- Monaco Editor
- CSS3

### Backend
- Node.js
- Express.js
- PostgreSQL
- CORS

## Contributing

1. Make changes in the appropriate `client/` or `server/` directory
2. Test your changes locally
3. Ensure all tests pass
4. Submit a pull request

## License

ISC