// Import necessary modules
const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const cors = require('cors');

const app = express();
const PORT = 3030;

// Middleware for parsing JSON and handling sessions
app.use(express.json());
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: {
    httpOnly: true, // Helps mitigate XSS attacks
    secure: true, // Set to true if using HTTPS
    sameSite: 'none', // Use 'none' if the frontend and backend are on different domains
  },
}));

// Configure CORS
app.use(cors({
  origin: 'http://localhost:5173', // Allow requests from this origin
  credentials: true, // Allow credentials (like cookies, authorization headers, etc.)
}));

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Load services configuration from a JSON file
const servicesFilePath = path.join(__dirname, 'services.json');
let services = [];

fs.readFile(servicesFilePath, 'utf8', (err, data) => {
    if (err) {
        console.error('Failed to load services file:', err);
        process.exit(1);
    }
    services = JSON.parse(data);
});

// Load user credentials from a JSON file
const credentialsFilePath = path.join(__dirname, 'credentials.json');
let credentials = {};

fs.readFile(credentialsFilePath, 'utf8', (err, data) => {
    if (err) {
        console.error('Failed to load credentials file:', err);
        process.exit(1);
    }
    credentials = JSON.parse(data);
});

// Login endpoint
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (!credentials[username] || credentials[username] !== password) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    req.session.authenticated = true;
    req.session.username = username;
    res.json({ message: 'Login successful' });
});

// Middleware to check authentication
const authenticate = (req, res, next) => {
    if (!req.session.authenticated) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

app.get('/services', authenticate, (req, res) => {
    const statusPromises = services.map(service =>
        new Promise(resolve => {
            exec(`sudo systemctl is-active ${service.command}.service`, (error, stdout) => {
                resolve({
                    id: service.id,
                    name: service.name,
                    description: service.description,
                    status: error ? 'inactive' : stdout.trim(),
                    logs: Array.isArray(service.logs) ? service.logs : [] // Include logs
                });
            });
        })
    );

    Promise.all(statusPromises)
        .then(results => res.json(results))
        .catch(error => res.status(500).json({ error: error.message }));
});

// Endpoint to restart a service
app.post('/services/:id/restart', authenticate, (req, res) => {
    const service = services.find(s => s.id === parseInt(req.params.id));

    if (!service) {
        return res.status(404).json({ error: 'Service not found' });
    }

    exec(`sudo systemctl restart ${service.command}.service`, (error) => {
        if (error) {
            return res.status(500).json({ error: `Failed to restart ${service.name}` });
        }
        res.json({ message: `${service.name} restarted successfully` });
    });
});

// Endpoint to get logs of a service
app.get('/services/:id/logs', authenticate, (req, res) => {
    const service = services.find(s => s.id === parseInt(req.params.id));

    if (!service) {
        return res.status(404).json({ error: 'Service not found' });
    }

    // Ensure logs is an array
    const logFiles = Array.isArray(service.logs) ? service.logs : [service.logs].filter(Boolean);

    const logPromises = logFiles.map(logFile =>
        new Promise(resolve => {
            fs.readFile(logFile, 'utf8', (error, data) => {
                resolve({
                    file: logFile,
                    content: error ? `Failed to read: ${logFile}` : data,
                });
            });
        })
    );

    Promise.all(logPromises)
        .then(results => res.json(results))
        .catch(error => res.status(500).json({ error: error.message }));
});


// Endpoint to download a specific log file
app.get('/services/:id/logs/download', authenticate, (req, res) => {
    const service = services.find(s => s.id === parseInt(req.params.id));

    if (!service) {
        return res.status(404).json({ error: 'Service not found' });
    }

    const logFilePath = req.query.file;
    const logFiles = Array.isArray(service.logs) ? service.logs : [service.logs];

    if (!logFilePath || !logFiles.includes(logFilePath)) {
        return res.status(400).json({ error: 'Invalid log file requested' });
    }

    const resolvedPath = path.resolve(logFilePath);

    fs.access(resolvedPath, fs.constants.R_OK, (err) => {
        if (err) {
            return res.status(500).json({ error: `Failed to access log file: ${logFilePath}` });
        }
        res.download(resolvedPath, path.basename(resolvedPath), (downloadErr) => {
            if (downloadErr) {
                return res.status(500).json({ error: `Failed to download log file: ${logFilePath}` });
            }
        });
    });
});



// Serve the application
app.listen(PORT, () => {
    console.log(`Service Status Dashboard running on http://localhost:${PORT}`);
});
