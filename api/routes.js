const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const SECRET_KEY = "your-secret-key";

const router = express.Router();

// Mock service and credential data
let services = [];
let credentials = {};

// Middleware to authenticate token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];
  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Invalid token" });
    }

    req.user = user;
    next();
  });
};

router.post("/login", (req, res) => {
  const { username, password } = req.body;
  const credentials = req.credentials; // Use credentials passed from the main app

  if (!credentials[username] || credentials[username] !== password) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: "1h" });
  res.json({ message: "Login successful", token });
});

// Services route
router.get("/services", authenticateToken, (req, res) => {
  const statusPromises = services.map(
    (service) =>
      new Promise((resolve) => {
        exec(
          `sudo systemctl is-active ${service.command}.service`,
          (error, stdout) => {
            resolve({
              id: service.id,
              name: service.name,
              description: service.description,
              status: error ? "inactive" : stdout.trim(),
              logs: Array.isArray(service.logs) ? service.logs : [], // Include logs
            });
          }
        );
      })
  );

  Promise.all(statusPromises)
    .then((results) => res.json(results))
    .catch((error) => res.status(500).json({ error: error.message }));
});

// Restart service route
router.post("/services/:id/restart", authenticateToken, (req, res) => {
  const service = services.find((s) => s.id === parseInt(req.params.id));

  if (!service) {
    return res.status(404).json({ error: "Service not found" });
  }

  exec(`sudo systemctl restart ${service.command}.service`, (error) => {
    if (error) {
      return res
        .status(500)
        .json({ error: `Failed to restart ${service.name}` });
    }
    res.json({ message: `${service.name} restarted successfully` });
  });
});

// Service logs route
router.get("/services/:id/logs", authenticateToken, (req, res) => {
  const service = services.find((s) => s.id === parseInt(req.params.id));

  if (!service) {
    return res.status(404).json({ error: "Service not found" });
  }

  const logFiles = Array.isArray(service.logs)
    ? service.logs
    : [service.logs].filter(Boolean);

  const logPromises = logFiles.map(
    (logFile) =>
      new Promise((resolve) => {
        fs.readFile(logFile, "utf8", (error, data) => {
          resolve({
            file: logFile,
            content: error ? `Failed to read: ${logFile}` : data,
          });
        });
      })
  );

  Promise.all(logPromises)
    .then((results) => res.json(results))
    .catch((error) => res.status(500).json({ error: error.message }));
});

// Log download route
router.get("/services/:id/logs/download", authenticateToken, (req, res) => {
  const service = services.find((s) => s.id === parseInt(req.params.id));

  if (!service) {
    return res.status(404).json({ error: "Service not found" });
  }

  const logFilePath = req.query.file;
  const logFiles = Array.isArray(service.logs) ? service.logs : [service.logs];

  if (!logFilePath || !logFiles.includes(logFilePath)) {
    return res.status(400).json({ error: "Invalid log file requested" });
  }

  const resolvedPath = path.resolve(logFilePath);

  fs.access(resolvedPath, fs.constants.R_OK, (err) => {
    if (err) {
      return res
        .status(500)
        .json({ error: `Failed to access log file: ${logFilePath}` });
    }
    res.download(resolvedPath, path.basename(resolvedPath), (downloadErr) => {
      if (downloadErr) {
        return res
          .status(500)
          .json({ error: `Failed to download log file: ${logFilePath}` });
      }
    });
  });
});

module.exports = router;
