// server.js
require('dotenv').config();
const express = require('express');
const { Podcast } = require('podcast');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs').promises;
const yaml = require('js-yaml');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_TOKEN = process.env.SECRET_TOKEN || 'your-secret-token';
const AUDIO_DIR = path.join(__dirname, '.data', 'audio');
const METADATA_PATH = path.join(__dirname, '.data', 'metadata.yml');

// Load metadata function
async function loadMetadata() {
    try {
        const fileContents = await fs.readFile(METADATA_PATH, 'utf8');
        return yaml.load(fileContents) || { episodes: {}, podcast: {} };
    } catch (error) {
        console.log('No metadata file found or error reading it. Using defaults.');
        return { episodes: {}, podcast: {} };
    }
}

// Parse duration string to seconds
function parseDuration(duration) {
    if (!duration) return null;
    const parts = duration.split(':').map(Number);
    if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    }
    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return null;
}

// Get episode details combining filename parsing and metadata
function getEpisodeDetails(filename, metadata) {
    const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
    const defaultTitle = filename
        .replace(/^\d{4}-\d{2}-\d{2}_/, '')
        .replace(/\.mp3$/, '')
        .replace(/_/g, ' ');

    const episodeMetadata = metadata.episodes[filename] || {};

    return {
        filename,
        releaseDate: dateMatch ? new Date(dateMatch[1]) : null,
        title: episodeMetadata.title || defaultTitle,
        description: episodeMetadata.description || `Episode: ${defaultTitle}`,
        author: episodeMetadata.author,
        duration: parseDuration(episodeMetadata.duration),
        explicit: episodeMetadata.explicit,
        categories: episodeMetadata.categories || [],
        keywords: episodeMetadata.keywords || [],
        image: episodeMetadata.image
    };
}

// Initialize storage and create example metadata if needed
const initializeStorage = async () => {
    try {
        await fs.mkdir(path.join(__dirname, '.data'), { recursive: true });
        await fs.mkdir(AUDIO_DIR, { recursive: true });

        // Create example metadata file if it doesn't exist
        try {
            await fs.access(METADATA_PATH);
        } catch {
            const exampleMetadata = {
                podcast: {
                    title: "My Private Music Collection",
                    description: "A curated collection of amazing music",
                    author: "Your Name"
                },
                episodes: {
                    "YYYY-MM-DD_Example_Song.mp3": {
                        description: "Example episode metadata",
                        author: "Example Artist",
                        duration: "3:45"
                    }
                }
            };
            await fs.writeFile(METADATA_PATH, yaml.dump(exampleMetadata), 'utf8');
        }

        console.log('Storage directories and metadata initialized');
    } catch (error) {
        console.error('Error initializing storage:', error);
    }
};

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Middleware to check secret token
const checkSecret = (req, res, next) => {
    const token = req.query.token;
    if (token !== SECRET_TOKEN) {
        return res.status(403).json({ error: 'Invalid token' });
    }
    next();
};

// Check if an episode should be released
const shouldReleaseEpisode = (releaseDate) => {
    if (!releaseDate) return true;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return releaseDate <= now;
};

// Serve static files with release date check
app.use('/audio', checkSecret, (req, res, next) => {
    const filename = path.basename(req.path);
    const releaseDate = getEpisodeDetails(filename, {}).releaseDate;

    if (!shouldReleaseEpisode(releaseDate)) {
        return res.status(404).json({ error: 'Episode not yet available' });
    }

    express.static(AUDIO_DIR)(req, res, next);
});

// Generate RSS feed
app.get('/feed.xml', checkSecret, async (req, res) => {
    try {
        const metadata = await loadMetadata();
        const podcastMetadata = metadata.podcast || {};

        const feed = new Podcast({
            title: podcastMetadata.title || 'My Private Music Collection',
            description: podcastMetadata.description || 'A private collection of songs',
            feed_url: `${req.protocol}://${req.get('host')}/feed.xml?token=${SECRET_TOKEN}`,
            site_url: `${req.protocol}://${req.get('host')}`,
            author: podcastMetadata.author || 'Anonymous',
            copyright: podcastMetadata.copyright || `${new Date().getFullYear()} Anonymous`,
            language: podcastMetadata.language || 'en',
            ttl: '60',
            itunesAuthor: podcastMetadata.author,
            itunesEmail: podcastMetadata.email,
            itunesImage: podcastMetadata.image,
            itunesExplicit: podcastMetadata.explicit,
            itunesCategories: podcastMetadata.categories
        });

        const audioFiles = await fs.readdir(AUDIO_DIR);

        const episodes = audioFiles
            .filter(file => file.endsWith('.mp3'))
            .map(file => getEpisodeDetails(file, metadata))
            .sort((a, b) => (b.releaseDate || 0) - (a.releaseDate || 0));

        for (const episode of episodes) {
            if (shouldReleaseEpisode(episode.releaseDate)) {
                const stats = await fs.stat(path.join(AUDIO_DIR, episode.filename));

                feed.addItem({
                    title: episode.title,
                    description: episode.description,
                    url: `${req.protocol}://${req.get('host')}/audio/${episode.filename}?token=${SECRET_TOKEN}`,
                    date: episode.releaseDate || stats.mtime,
                    enclosure: {
                        url: `${req.protocol}://${req.get('host')}/audio/${episode.filename}?token=${SECRET_TOKEN}`,
                        size: stats.size,
                        type: 'audio/mpeg'
                    },
                    itunesAuthor: episode.author,
                    itunesDuration: episode.duration,
                    itunesExplicit: episode.explicit,
                    itunesSubtitle: episode.description,
                    itunesImage: episode.image,
                    itunesKeywords: episode.keywords
                });
            }
        }

        res.type('application/xml');
        res.send(feed.buildXml());
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Endpoint to list all episodes with metadata
app.get('/episodes', checkSecret, async (req, res) => {
    try {
        const metadata = await loadMetadata();
        const audioFiles = await fs.readdir(AUDIO_DIR);

        const episodes = audioFiles
            .filter(file => file.endsWith('.mp3'))
            .map(file => getEpisodeDetails(file, metadata))
            .sort((a, b) => (b.releaseDate || 0) - (a.releaseDate || 0));

        res.json({
            podcast: metadata.podcast || {},
            episodes: episodes
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

initializeStorage().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Upload your MP3 files to: ${AUDIO_DIR}`);
        console.log(`Metadata file location: ${METADATA_PATH}`);
    });
});