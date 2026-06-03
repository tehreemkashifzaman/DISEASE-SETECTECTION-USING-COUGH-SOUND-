const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');

const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());

const recordingDir = path.join(__dirname, '../recording');

// Ensure recording directory exists
fs.ensureDirSync(recordingDir);


const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Clear directory before saving new recording
        fs.emptyDirSync(recordingDir);
        cb(null, recordingDir);
    },
    filename: (req, file, cb) => {
        // Save as 'latest_recording' with its original extension
        const ext = path.extname(file.originalname);
        cb(null, `latest_recording${ext}`);
    }
});

const upload = multer({ storage: storage });

const { exec } = require('child_process');

app.post('/upload', upload.single('audio'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    console.log(`Saved recording: ${req.file.path}`);
    res.send({ message: 'Recording saved successfully', path: req.file.path });
});

app.post('/analyze', async (req, res) => {
    const scriptPath = path.join(__dirname, '../inference_server.py');
    const pythonPath = path.join(__dirname, '../data/.venv/Scripts/python.exe');
    const ffmpegPath = 'C:\\ffmpeg\\bin\\ffmpeg.exe';
    
    try {
        const files = await fs.readdir(recordingDir);
        if (files.length === 0) {
            return res.status(400).send({ error: 'No recording found to analyze' });
        }
        
        const inputFile = path.join(recordingDir, files[0]);
        const wavFile = path.join(recordingDir, 'processed_audio.wav');
        
        console.log(`Converting ${inputFile} to WAV...`);
        
        // Convert to WAV (16kHz, mono, as typically expected by many audio models)
        exec(`"${ffmpegPath}" -y -i "${inputFile}" -ar 16000 -ac 1 "${wavFile}"`, (convError, convStdout, convStderr) => {
            if (convError) {
                console.error(`Conversion error: ${convError}`);
                return res.status(500).send({ error: 'Audio conversion failed', details: convStderr });
            }

            console.log('Running inference on WAV file...');
            exec(`"${pythonPath}" "${scriptPath}" "${wavFile}"`, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Exec error: ${error}`);
                    return res.status(500).send({ error: 'Inference failed', details: stderr });
                }
                
                try {
                    const result = JSON.parse(stdout.trim());
                    if (result.error) {
                        return res.status(500).send({ error: result.error });
                    }
                    res.send(result);
                } catch (e) {
                    console.error('Failed to parse output:', stdout);
                    res.status(500).send({ error: 'Failed to parse inference results', output: stdout });
                }
            });
        });
    } catch (err) {
        console.error('Error reading recording directory:', err);
        res.status(500).send({ error: 'Internal server error' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
