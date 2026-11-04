// The Updates tab in Settings. Newest first. Add an entry here whenever a batch of work ships.
// `status`: 'dev' = in this copy but still being proven; leave it out once it has held up in real use.
export const CHANGELOG = [
  {
    version: '0.9', date: '2026-11-04', title: 'Watch party', status: 'dev',
    summary: 'The room now runs the show: the owner picks and presses play, and everyone else just has to be there.',
    groups: {
      New: [
        'Same file for everyone: the owner\'s copy chooses the exact release and the whole room plays it.',
        'Ready gate: nobody starts until everyone has buffered, then all start together on a shared clock. The owner can skip the wait.',
        'The player opens by itself for everyone in the room as soon as a title is picked.',
        'Mini player: Back shrinks the player to a corner and keeps it running, so returning is instant and still in sync.',
        'Leave and come back within 3 minutes without reloading anything.',
        'Immersive room panel: who is watching, their sync offset in milliseconds, how much they have buffered, chat and owner controls.',
        'Live cursors with profile pictures, placed on the picture itself so everyone points at the same spot.',
        'Room holds with "Waiting for Mia" when someone is stuck buffering. The owner can turn this off.',
        'A notice and a soft chime when someone joins, leaves, goes to the lobby or comes back. Can be turned off.',
        'Updates tab: this page.',
      ],
      Improved: [
        'Buffers minutes ahead instead of about 2.5 seconds, even while paused, and jumps inside the buffer are instant.',
        'Only one tab per person runs the room player, so tabs no longer fight over your status.',
        'Seeks land on a real keyframe, so every viewer restarts on the same frame.',
        'Drift is removed with tiny speed changes, checked five times a second.',
        'Sound blocked by the browser no longer stops playback: it starts muted with a "Tap for sound" button.',
      ],
      Fixed: ['Room play and pause state reached browsers late, which threw off sync.'],
      'Known limits': [
        'Closing the browser or reloading the page still has to rebuffer.',
        'Not yet proven with real friends on real streams.',
      ],
    },
  },
  {
    version: '0.8', date: '2026-11-04', title: 'Rooms that last',
    summary: 'Rooms survive everyone leaving, and friend states are live.',
    groups: {
      New: [
        'Rooms pause where they were when the last player closes, and stay available under Your rooms.',
        'Rooms come back even if the relay restarts, because each IronHide keeps its own saved copy, including the chat.',
        'Room owner: keeps control, gets host back on returning, cannot be kicked, and can hand the room over.',
        'Kick people from a room. They cannot rejoin it.',
        'See friends\' rooms in your list and join without a code.',
        'Live states: watching, paused, buffering, tabbed out.',
        'Audio sync control in the web player, for Bluetooth delay.',
        'Sign out and start fresh, and start another profile on this Mac from Settings.',
        'Temporary profiles leave friends\' lists on their own. Removing one wipes it everywhere.',
      ],
      Improved: ['Removing a friend now works both ways.', 'Friends list shows what people watch, with poster and full title.', 'The rail counts friends online instead of service nodes.'],
      Fixed: [
        'Seeking inside buffered video jumped to 0:00 and caused a re-seek loop.',
        'A "Watching" status could stay stuck after someone left.',
        'A new profile could land on a different relay and never find its friends.',
      ],
    },
  },
  {
    version: '0.7', date: '2026-11-04', title: 'Hosted relay',
    summary: 'Friends run their own IronHide and meet through one small relay. No video goes through it.',
    groups: {
      New: ['Relay deployed on Render, with a people list and unique names online.', 'First-run name screen.'],
      Improved: ['Every install connects to the shared relay with no setup.', 'API keys are hidden in error messages.'],
      Fixed: ['Streams on an unreachable download node are skipped automatically.'],
      'Known limits': ['Hosting the whole app was tried and dropped: browsers cannot play most releases directly, and it would send all the video through one server.'],
    },
  },
  {
    version: '0.6', date: '2026-11-04', title: 'Avatar studio',
    summary: 'Make your profile picture yours.',
    groups: {
      New: ['Photo upload.', '16 animated decorations that sit outside the avatar.', '20 polygon shapes, a faceted bevel frame and low-poly shading.', 'Gradients and one-click looks.'],
      Fixed: ['Circles squished into blobs.', 'Search cards with long titles stretching.', 'The phone bottom bar running off the screen.'],
    },
  },
  {
    version: '0.5', date: '2026-11-04', title: 'Together',
    summary: 'The first version of watching with friends.',
    groups: { New: ['Friends by code.', 'Rooms with a code and invites.', 'Live chat and floating reactions.', 'A small relay for friend, room and chat messages.'] },
  },
  {
    version: '0.4', date: '2026-11-04', title: 'Web player',
    summary: 'Watch in the browser as well as mpv.',
    groups: {
      New: ['In-browser player: direct play where possible, GPU transcode where not.', 'Scrub preview frames.', 'Built-in trailer player.', 'Choose mpv or the web player in Settings.'],
      Improved: ['Title details became a centered popup.', 'Card size and layout settings.', 'Settings save automatically.'],
      Fixed: ['The page scrolling behind open popups.'],
    },
  },
  {
    version: '0.3', date: '2026-11-04', title: 'IronHide on the web',
    summary: 'The web app rebuilt from scratch, using TorBox and your Trakt harvester.',
    groups: {
      New: ['Floating left rail and ambient color that follows the poster.', 'Launch indicator and a smooth hand-off to mpv.', 'Shelves from the Trakt harvester.', 'Settings for profile, appearance, playback, connectors and nodes.'],
      Improved: ['TorBox replaces Real-Debrid as the main debrid service.', 'History carried over from the CLI.'],
      Fixed: ['mpv launching without progress tracking or subtitles.'],
    },
  },
  {
    version: '0.2', date: '2026-11-03', title: 'One core service',
    summary: 'One long-running service owns everything, with the first web interface on top.',
    groups: { New: ['Core daemon, with the MCP server as a thin client.', 'First browse UI: catalog, search, title page and stream picker.'] },
  },
  {
    version: '0.1', date: '2026-04-20', title: 'First release',
    summary: 'Where it started: search and stream from Claude Code.',
    groups: { New: ['IronHide MCP server and CLI.', 'Streams in mpv with full remote control.', 'Watch history, resume, ratings and a taste profile.'] },
  },
];
