# Use Node.js 20 Alpine as the base image
FROM node:20-alpine

# Set the working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy the rest of the application code
COPY . .

# Build the app for production
RUN npm run build

# Expose the port (adjust if your app uses a different port)
EXPOSE 5173

# Command to run the app
CMD ["npm", "run", "dev"]