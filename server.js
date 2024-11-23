// server.js - Fixed version
require('dotenv').config();
const express = require('express');
const { Podcast } = require('podcast');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const yaml = require('js-yaml');
const FileType = require('file-type');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_TOKEN = process.env.SECRET_TOKEN || 'your-secret-token';
const AUDIO_DIR = path.join(__dirname, 'data', 'audio');
const METADATA_PATH = path.join(__dirname, 'data', 'metadata.yml');

// Check if running on Glitch
const isGlitch = () => {
  return !!process.env.PROJECT_DOMAIN;
};

// Parse .glitch-assets file to get CDN URLs and track deletions
async function getGlitchAssets() {
  if (!isGlitch()) return { assets: new Map(), deletedFiles: new Set() };

  try {
    const content = await fsPromises.readFile('.glitch-assets', 'utf8');
    const assets = new Map();
    const deletedFiles = new Set();
    
    // First pass: collect all deletions
    content.split('\n')
      .filter(line => line.trim())
      .forEach(line => {
        try {
          const cleanLine = line.trim().replace(/,\s*$/, '');
          const asset = JSON.parse(cleanLine);
          
          if (asset.deleted && asset.uuid) {
            // Find the original asset with this UUID to get its filename
            const originalAsset = content.split('\n')
              .filter(l => l.trim())
              .map(l => JSON.parse(l.trim().replace(/,\s*$/, '')))
              .find(a => a.uuid === asset.uuid && a.name);
            
            if (originalAsset && originalAsset.name) {
              deletedFiles.add(originalAsset.name);
            }
          }
        } catch (error) {
          console.warn('Error processing deletion entry:', error);
        }
      });

    // Second pass: collect current assets
    content.split('\n')
      .filter(line => line.trim())
      .forEach(line => {
        try {
          const cleanLine = line.trim().replace(/,\s*$/, '');
          const asset = JSON.parse(cleanLine);
          
          if (asset.name && asset.url && !asset.deleted) {
            // Only add if the file hasn't been deleted
            if (!deletedFiles.has(asset.name)) {
              assets.set(asset.name, {
                url: asset.url,
                size: asset.size,
                uuid: asset.uuid
              });
            }
          }
        } catch (error) {
          console.warn('Error processing asset entry:', error);
        }
      });

    return { assets, deletedFiles };
  } catch (error) {
    console.warn('Error reading .glitch-assets:', error);
    return { assets: new Map(), deletedFiles: new Set() };
  }
}

const SUPPORTED_FORMATS = {
  'mp3': 'audio/mpeg',
  'm4a': 'audio/mp4',
  'opus': 'audio/opus',
  'ogg': 'audio/ogg',
  'mka': 'audio/x-matroska'
};

// Load metadata function
async function loadMetadata() {
  try {
    console.log('Looking for metadata file at:', METADATA_PATH);
    const fileContents = await fsPromises.readFile(METADATA_PATH, 'utf8');
    console.log('Metadata file found and loaded');
    const parsed = yaml.load(fileContents) || { episodes: {}, podcast: {} };
    console.log('Podcast title from metadata:', parsed.podcast?.title);
    console.log('Number of episodes in metadata:', Object.keys(parsed.episodes || {}).length);
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`Metadata file not found at ${METADATA_PATH}`);
    } else {
      console.error('Error parsing metadata:', error);
    }
    return { episodes: {}, podcast: {} };
  }
}

async function getAudioFileType(filePath) {
  try {
    const fileType = await FileType.fromFile(filePath);
    if (!fileType) return null;

    // Map detected MIME types to our supported formats
    const mimeTypeMap = {
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/opus': 'opus',
      'audio/ogg': 'opus', // Handle Opus in Ogg container
      'audio/x-matroska': 'opus' // Handle Opus in MKA container
    };

    return mimeTypeMap[fileType.mime];
  } catch (error) {
    console.error('Error detecting file type:', error);
    return null;
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
function getEpisodeDetails(filename, metadata = { episodes: {} }) {
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
    const dataDir = path.join(__dirname, 'data');
    console.log('Initializing storage in:', dataDir);
    
    // Create directories
    await fsPromises.mkdir(dataDir, { recursive: true });
    await fsPromises.mkdir(AUDIO_DIR, { recursive: true });
    
    // Check if metadata file exists
    try {
      await fsPromises.access(METADATA_PATH);
      console.log('Existing metadata file found');
      
      // Validate the existing metadata
      const metadata = await loadMetadata();
      if (!metadata || !metadata.podcast) {
        console.warn('Metadata file exists but might be invalid');
      }
    } catch {
      console.log('No metadata file found, creating example');
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
      await fsPromises.writeFile(METADATA_PATH, yaml.dump(exampleMetadata), 'utf8');
    }
    
    console.log('Storage directories and metadata initialized');
  } catch (error) {
    console.error('Error initializing storage:', error);
    throw error;
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
app.use('/audio', checkSecret, async (req, res, next) => {
  try {
    const metadata = await loadMetadata();
    const filename = path.basename(req.path);
    const filePath = path.join(AUDIO_DIR, filename);

    // Check if we're on Glitch and have a CDN URL for this file
    if (isGlitch()) {
      const { assets, deletedFiles } = await getGlitchAssets();
      
      // Check if the file was deleted
      if (deletedFiles.has(filename)) {
        return res.status(404).json({ error: 'File not found' });
      }

      const assetInfo = assets.get(filename);
      if (assetInfo?.url) {
        // Redirect to CDN URL if available
        return res.redirect(assetInfo.url);
      }
    }

    try {
      await fsPromises.access(filePath);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }

    const extension = filename.toLowerCase().split('.').pop();
    if (!SUPPORTED_FORMATS.hasOwnProperty(extension)) {
      return res.status(400).json({ error: 'Unsupported file format' });
    }

    const episode = getEpisodeDetails(filename, metadata);
    if (!shouldReleaseEpisode(episode.releaseDate)) {
      return res.status(404).json({ error: 'Episode not yet available' });
    }

    // Verify the file type matches the extension
    const actualType = await getAudioFileType(filePath);
    const expectedType = extension;
    
    if (actualType && actualType !== expectedType && actualType !== 'opus') {
      console.warn(`Warning: File ${filename} has mismatched type. Extension: ${extension}, Actual: ${actualType}`);
    }

    // Set the correct content type
    res.type(SUPPORTED_FORMATS[extension]);
    
    // Stream the file
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (error) {
    console.error('Error serving audio:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Generate RSS feed
app.get('/feed.xml', checkSecret, async (req, res) => {
  try {
    const metadata = await loadMetadata();
    const podcastMetadata = metadata.podcast || {};
    const { assets, deletedFiles } = await getGlitchAssets();

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

    let audioFiles;
    if (isGlitch()) {
      // When on Glitch, only use files that exist in glitch-assets and aren't deleted
      audioFiles = Array.from(assets.keys())
        .filter(filename => {
          const ext = filename.toLowerCase().split('.').pop();
          return SUPPORTED_FORMATS.hasOwnProperty(ext) && !deletedFiles.has(filename);
        })
        .map(filename => getEpisodeDetails(filename, metadata))
        .sort((a, b) => (b.releaseDate || 0) - (a.releaseDate || 0));
    } else {
      // When not on Glitch, use local files
      audioFiles = (await fsPromises.readdir(AUDIO_DIR))
        .filter(file => {
          const ext = file.toLowerCase().split('.').pop();
          return SUPPORTED_FORMATS.hasOwnProperty(ext);
        })
        .map(file => getEpisodeDetails(file, metadata))
        .sort((a, b) => (b.releaseDate || 0) - (a.releaseDate || 0));
    }
    
    for (const episode of audioFiles) {
      if (shouldReleaseEpisode(episode.releaseDate)) {
        const extension = episode.filename.toLowerCase().split('.').pop();
        
        // Get the appropriate URL and size for the audio file
        let audioUrl, fileSize;
        if (isGlitch()) {
          // On Glitch, use CDN URL directly
          const assetInfo = assets.get(episode.filename);
          if (!assetInfo?.url) continue; // Skip if no valid URL
          
          audioUrl = assetInfo.url;
          fileSize = assetInfo.size;
        } else {
          // Not on Glitch, use local file with token
          audioUrl = `${req.protocol}://${req.get('host')}/audio/${episode.filename}?token=${SECRET_TOKEN}`;
          const stats = await fsPromises.stat(path.join(AUDIO_DIR, episode.filename));
          fileSize = stats.size;
        }

        feed.addItem({
          title: episode.title,
          description: episode.description,
          url: audioUrl,
          date: episode.releaseDate || new Date(),
          enclosure: {
            url: audioUrl,
            size: fileSize || 0,
            type: SUPPORTED_FORMATS[extension]
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
    console.error('Error generating feed:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Endpoint to list all episodes with metadata
app.get('/episodes', checkSecret, async (req, res) => {
  try {
    const metadata = await loadMetadata();
    const { assets, deletedFiles } = await getGlitchAssets();
    
    let audioFiles;
    if (isGlitch()) {
      // When on Glitch, only list files that exist in glitch-assets and aren't deleted
      audioFiles = Array.from(assets.keys())
        .filter(file => {
          const ext = file.toLowerCase().split('.').pop();
          return SUPPORTED_FORMATS.hasOwnProperty(ext) && !deletedFiles.has(file);
        })
        .map(file => getEpisodeDetails(file, metadata))
        .sort((a, b) => (b.releaseDate || 0) - (a.releaseDate || 0));
    } else {
      // When not on Glitch, list local files
      audioFiles = (await fsPromises.readdir(AUDIO_DIR))
        .filter(file => file.endsWith('.mp3'))
        .map(file => getEpisodeDetails(file, metadata))
        .sort((a, b) => (b.releaseDate || 0) - (a.releaseDate || 0));
    }
    
    res.json({
      podcast: metadata.podcast || {},
      episodes: audioFiles
    });
  } catch (error) {
    console.error('Error listing episodes:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add basic favicon route to prevent 404s
app.get('/favicon.ico', (req, res) => res.status(204).end());

initializeStorage().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    if (isGlitch()) {
      console.log('Running on Glitch.com - will use CDN URLs when available');
    } else {
      console.log(`Upload your MP3 files to: ${AUDIO_DIR}`);
    }
    console.log(`Metadata file location: ${METADATA_PATH}`);
  });
});

app.get('/debug/metadata', checkSecret, async (req, res) => {
  try {
    const metadata = await loadMetadata();
    const { assets, deletedFiles } = await getGlitchAssets();
    res.json({
      metadataPath: METADATA_PATH,
      metadata: metadata,
      audioDir: AUDIO_DIR,
      exists: await fsPromises.access(METADATA_PATH).then(() => true).catch(() => false),
      isGlitch: isGlitch(),
      glitchAssets: Object.fromEntries(assets),
      deletedFiles: Array.from(deletedFiles)
    });
  } catch (error) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});
