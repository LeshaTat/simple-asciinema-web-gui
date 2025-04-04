# Self-hosted Asciinema Player

A simple self-hosted web application for playing asciinema terminal recordings.

## Features

- Lists all .cast files in the `public/casts` directory
- Plays recordings in the browser using asciinema-player
- Simple and responsive interface
- Easy to deploy and use

## Installation

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Place your .cast files in the `public/casts` directory
4. Start the server:
   ```
   npm run serve
   ```
5. Open your browser and visit `http://localhost:3000`

## Usage

- View the list of available recordings on the homepage
- Click on any recording to play it
- Use the controls below the player to play, pause, or restart the recording
- Click "Back to List" to return to the recordings list

## Development

For development with auto-restart:

```
npm run dev
```

## License

ISC