# YouTube Scheduler Application - Backend

## Overview
This backend application is built using Node.js and Express. It serves as the server-side component for the YouTube Scheduler application, allowing users to schedule video uploads to their YouTube channels.

## Project Structure
```
backend
├── src
│   ├── controllers
│   │   └── scheduleController.js
│   ├── models
│   │   └── schedule.js
│   ├── routes
│   │   └── scheduleRoutes.js
│   ├── services
│   │   └── youtubeService.js
│   └── app.js
├── package.json
```

## Installation
1. Clone the repository:
   ```
   git clone <repository-url>
   ```
2. Navigate to the backend directory:
   ```
   cd youtube-scheduler-app/backend
   ```
3. Install the dependencies:
   ```
   npm install
   ```

## Usage
To start the backend server, run:
```
npm start
```
The server will run on `http://localhost:5000` by default.

## API Endpoints
- `POST /api/schedule`: Create a new schedule.
- `GET /api/schedule`: Retrieve all schedules.

## Dependencies
- Express: Web framework for Node.js.
- Mongoose: MongoDB object modeling tool.
- dotenv: Module to load environment variables.

## Contributing
Feel free to submit issues or pull requests for any improvements or features you would like to see.

## License
This project is licensed under the MIT License.

## YouTube Status Poller (added)

A lightweight poller was added to periodically check YouTube upload processing status and update `VideoSchedule.platformStatus.youtube`.

- Enable it by setting `ENABLE_STATUS_POLLER=true` in your environment before starting the backend.
- The poller runs immediately on startup and then every 3 minutes.
- It requires users to have a stored YouTube refresh token.

This is intentionally simple; for production consider moving this to a job queue for retries and visibility.