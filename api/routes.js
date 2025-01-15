const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require('uuid'); // Import UUID generator
const SECRET_KEY = "your-secret-key";

const router = express.Router();

// Mock service and credential data
let services = [];

const authenticateToken = (req, res, next) => {
  const token = req.cookies.authToken; // Extract token from cookie

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

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

  // Set the cookie with HTTP-only and Secure flags
  res.cookie("authToken", token, {
    httpOnly: true, // Prevents JavaScript access
    secure: true,
    sameSite: "none", // Adjust based on your frontend-backend relationship
    maxAge: 60 * 60 * 1000, // 1 hour
  });

  res.json({ message: "Login successful" });
});

// Services route
router.get("/services", authenticateToken, (req, res) => {
  const services = req.services;
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
  const services = req.services;
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
  const services = req.services;
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
  const services = req.services;
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

router.post("/notify", (req, res) => {
  const { user, re: subject, message } = req.body;
  
  if (!user || !subject || !message) {
      return res.status(400).json({ error: "Missing required fields" });
  }

  const notification = {
      id: uuidv4(), // Generate a unique ID for each notification
      timestamp: new Date().toISOString(),
      user,
      re: subject,
      message,
      read: false,
      completed: false
  };

  const filename = `${notification.id}.json`; // Include the UUID in the filename for uniqueness
  const filepath = path.join(__dirname, '../notifications', filename);

  // Ensure the notifications directory exists
  if (!fs.existsSync(path.join(__dirname, '../notifications'))) {
      fs.mkdirSync(path.join(__dirname, '../notifications'), { recursive: true });
  }

  // Write the JSON data to a file
  fs.writeFile(filepath, JSON.stringify(notification, null, 2), 'utf8', (err) => {
      if (err) {
          console.error('Failed to write file', err);
          return res.status(500).send({ error: 'Failed to save notification' });
      }
      res.json({ message: 'Notification received and stored', id: notification.id });
  });
});

router.get("/notifications", authenticateToken, (req, res) => {
  const directoryPath = path.join(__dirname, "../notifications");

  // Check if the notifications directory exists
  if (!fs.existsSync(directoryPath)) {
    return res.status(404).json({ error: "No notifications found." });
  }

  // Read all files in the notifications directory
  fs.readdir(directoryPath, (err, files) => {
    if (err) {
      console.error("Failed to read directory", err);
      return res
        .status(500)
        .json({ error: "Failed to retrieve notifications" });
    }

    // Filter for JSON files only
    const jsonFiles = files.filter(
      (file) => path.extname(file).toLowerCase() === ".json"
    );
    const notifications = [];

    // Read each file and parse JSON content
    jsonFiles.forEach((file, index) => {
      fs.readFile(
        path.join(directoryPath, file),
        "utf8",
        (readErr, content) => {
          if (readErr) {
            console.error(`Failed to read file: ${file}`, readErr);
            return res
              .status(500)
              .json({ error: `Failed to read notification file: ${file}` });
          }
          try {
            notifications.push(JSON.parse(content));
          } catch (parseErr) {
            console.error(`Error parsing JSON from file: ${file}`, parseErr);
          }

          // When last file is processed, send all notifications
          if (index === jsonFiles.length - 1) {
            res.json(notifications);
          }
        }
      );
    });

    // In case there are no JSON files
    if (jsonFiles.length === 0) {
      res.json(notifications);
    }
  });
});

router.patch("/notifications/:id", (req, res) => {
  const { id } = req.params;
  const { read, completed } = req.body;

  // Validate input
  if (typeof read !== 'boolean' || typeof completed !== 'boolean') {
      return res.status(400).json({ error: "Invalid input. 'read' and 'completed' must be boolean values." });
  }

  const directoryPath = path.join(__dirname, '../notifications');
  const targetFile = fs.readdirSync(directoryPath).find(file => file.includes(id));

  if (!targetFile) {
      return res.status(404).json({ error: "Notification not found." });
  }

  const filepath = path.join(directoryPath, targetFile);
  fs.readFile(filepath, 'utf8', (err, data) => {
      if (err) {
          console.error('Failed to read file', err);
          return res.status(500).json({ error: 'Failed to read notification file' });
      }

      try {
          const notification = JSON.parse(data);
          notification.read = read;
          notification.completed = completed;

          fs.writeFile(filepath, JSON.stringify(notification, null, 2), 'utf8', (writeErr) => {
              if (writeErr) {
                  console.error('Failed to write file', writeErr);
                  return res.status(500).json({ error: 'Failed to update notification' });
              }
              res.json({ message: 'Notification updated successfully' });
          });
      } catch (parseErr) {
          console.error('Error parsing JSON', parseErr);
          return res.status(500).json({ error: 'Error processing notification data' });
      }
  });
});


module.exports = router;
