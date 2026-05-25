# Use lightweight Node.js base image
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy the backend dependency files first (for caching layers)
COPY backend/package*.json ./backend/

# Install backend dependencies
RUN cd backend && npm install

# Copy all application files (static frontend in root, backend files in backend/)
COPY . .

# Expose port (Cloud Run will inject PORT env, usually 8080)
EXPOSE 8080

# Run the server
CMD ["node", "backend/server.js"]
