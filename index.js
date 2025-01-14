const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const routes = require("./api/routes");

const app = express();
const PORT = 3030;

// Middleware for parsing JSON
app.use(express.json());

// Configure CORS
app.use(
  cors({
    origin: "http://localhost:5173", // Allow requests from this origin
    credentials: true, // Allow credentials
  })
);

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Load services configuration
const servicesFilePath = path.join(__dirname, "services.json");
let services = [];

fs.readFile(servicesFilePath, "utf8", (err, data) => {
  if (err) {
    console.error("Failed to load services file:", err);
    process.exit(1);
  }
  services = JSON.parse(data);
});

// Load credentials configuration
const credentialsFilePath = path.join(__dirname, "credentials.json");
let credentials = {};

fs.readFile(credentialsFilePath, "utf8", (err, data) => {
  if (err) {
    console.error("Failed to load credentials file:", err);
    process.exit(1);
  }
  credentials = JSON.parse(data);
});

// Attach services and credentials globally (if required)
app.use((req, res, next) => {
  req.services = services;
  req.credentials = credentials;
  next();
});

// Use the routes
app.use("/api", routes);

// Start the server
app.listen(PORT, () => {
  console.log(`Service Status Dashboard running on http://localhost:${PORT}`);
});
