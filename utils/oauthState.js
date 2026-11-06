import { randomBytes } from 'node:crypto';

// Store state in memory (you might want to use Redis in production)
const stateStore = new Map();

export const generateOAuthState = (userId) => {
    const state = randomBytes(32).toString('hex');
    stateStore.set(state, {
        userId,
        timestamp: Date.now()
    });
    
    // Cleanup old states (older than 5 minutes)
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    for (const [key, value] of stateStore.entries()) {
        if (value.timestamp < fiveMinutesAgo) {
            stateStore.delete(key);
        }
    }
    
    return state;
};

export const verifyOAuthState = (state) => {
    const stateData = stateStore.get(state);
    if (!stateData) {
        return null;
    }
    
    // Cleanup used state
    stateStore.delete(state);
    
    return stateData.userId;
};
