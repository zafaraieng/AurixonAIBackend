import 'dotenv/config';
import mongoose from 'mongoose';
import app from './app.js';
import schedulerService from './services/schedulerService.js';

const PORT = process.env.PORT || 4000;

async function start() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected');
    
    // Start the Instagram scheduler
    schedulerService.start();
    console.log('Instagram scheduler started');
    
    // Create HTTP server
    const server = app.listen(PORT, () => {
      console.log(`API listening on port ${PORT}`);
      // Log the effective client URL for debugging redirect issues
      console.log('Effective CLIENT_URL:', process.env.CLIENT_URL || 'https://aurixon.vercel.app');
    });

    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use`);
        process.exit(1);
      } else {
        console.error('Server error:', error);
      }
    });

    // Handle process shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received. Shutting down gracefully');
      server.close(() => {
        console.log('Process terminated');
      });
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received. Shutting down gracefully');
      server.close(() => {
        console.log('Process terminated');
        process.exit(0);
      });
    });
    
    return server;
  } catch (err) {
    console.error('Failed to start server:', {
      name: err.name,
      message: err.message,
      code: err.code,
      stack: err.stack
    });
    process.exit(1);
  }
}

start();
