// Import necessary modules
const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const session = require('express-session');

const app = express();
const PORT = 3000;

// Middleware for parsing JSON and handling sessions
app.use(express.json());
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
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

// Endpoint to get the status of all services
app.get('/services', authenticate, (req, res) => {
    const statusPromises = services.map(service =>
        new Promise(resolve => {
            exec(`systemctl is-active ${service.command}`, (error, stdout) => {
                resolve({
                    id: service.id,
                    name: service.name,
                    status: error ? 'inactive' : stdout.trim(),
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

    exec(`systemctl restart ${service.command}`, (error) => {
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

    fs.readFile(service.logs, 'utf8', (error, data) => {
        if (error) {
            return res.status(500).json({ error: `Failed to read logs for ${service.name}` });
        }
        res.json({ logs: data.split('\n') });
    });
});

// Endpoint to download log files
app.get('/services/:id/logs/download', authenticate, (req, res) => {
    const service = services.find(s => s.id === parseInt(req.params.id));

    if (!service) {
        return res.status(404).json({ error: 'Service not found' });
    }

    const logFilePath = path.resolve(service.logs);

    fs.access(logFilePath, fs.constants.R_OK, (err) => {
        if (err) {
            return res.status(500).json({ error: `Failed to access log file for ${service.name}` });
        }
        res.download(logFilePath, `${service.name}-log.txt`, (downloadErr) => {
            if (downloadErr) {
                return res.status(500).json({ error: `Failed to download log file for ${service.name}` });
            }
        });
    });
});

// Serve the application
app.listen(PORT, () => {
    console.log(`Service Status Dashboard running on http://localhost:${PORT}`);
});
