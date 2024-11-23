# 🎄 Advent Podcast Server 🎧

Create your own private podcast feed with scheduled episodes! Perfect for advent calendars, daily music releases, or any time-based audio content. Each audio file is released based on its filename date - it's like magic! ✨

## 🚀 Quick Start

1. Remix this project on Glitch
2. Set your secret token in `.env`:
   ```
   SECRET_TOKEN=your-super-secret-string
   ```
3. Upload your MP3 files to `.data/audio` with this naming pattern:
   ```
   YYYY-MM-DD_Episode_Title.mp3
   
   For example:
   2024-12-01_First_Day_Of_Christmas.mp3
   2024-12-24_Christmas_Eve_Special.mp3
   ```

🎉 That's it! Your podcast is ready at:
```
https://your-project-name.glitch.me/feed.xml?token=your-super-secret-string
```

## 🎸 Adding Episode Details (Optional)

Want to add descriptions, artist info, or duration? Create `.data/metadata.yml`:

```yaml
podcast:
  title: "My Awesome Advent Calendar"
  description: "24 days of musical surprises"
  author: "Santa's Little Helper"

episodes:
  "2024-12-01_First_Day_Of_Christmas.mp3":
    description: "A partridge in a pear tree 🎵"
    author: "The Christmas Band"
    duration: "3:45"
    
  "2024-12-24_Christmas_Eve_Special.mp3":
    description: "The grand finale! 🎄"
    author: "Santa & The Reindeer"
    duration: "5:30"
    categories: 
      - Holiday
      - Jazz
```

## 📱 Adding to Your Podcast App

1. Copy your feed URL:
   ```
   https://your-project-name.glitch.me/feed.xml?token=your-super-secret-string
   ```

2. Add it to your favorite podcast app:
   - Apple Podcasts: Library → Add a Show → Add URL
   - Overcast: + → Add URL
   - Pocket Casts: Search → Add URL
   - Spotify: Coming soon! 🤞

## 🔍 Useful Endpoints

- Check your episodes:
  ```
  /episodes?token=your-super-secret-string
  ```
- Direct MP3 access:
  ```
  /audio/YYYY-MM-DD_Episode_Title.mp3?token=your-super-secret-string
  ```

## 💡 Pro Tips

- Episodes are released at midnight based on the date in the filename
- Files without dates are always available
- Keep your token secret - it's your podcast's VIP pass! 🎟️
- Store files in `.data/audio` - they won't be included in remixes
- The free Glitch plan has a 200MB storage limit - perfect for an advent calendar! 

## 🎯 Coming Soon

- [ ] Cover art support
- [ ] Web interface for metadata editing (accepting Github PRs 🤝)
- [ ] Automatic file cleanup (accepting Github PRs 🤝)
- [ ] Episode analytics (accepting Github PRs 🤝)

## 🐛 Troubleshooting

Nothing playing? Check that:
1. Your files are in `.data/audio`
2. Filenames follow the `YYYY-MM-DD_Title.mp3` format
3. The release date has arrived
4. Your token is correct

## 🤝 Contributing

Found a bug? Want to add a feature? PRs welcome! 

## 📜 License

MIT - Go wild! 🎉

---

Made with 🎵 by [Your Name]

*P.S. If you make something cool with this, let me know! I'd love to hear about it!* 🎧