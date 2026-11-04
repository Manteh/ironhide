// The Updates tab in Settings. Newest first. Add an entry here whenever a batch of work ships.
// `status`: 'dev' = in this copy but still being proven; leave it out once it has held up in real use.
export const CHANGELOG = [
  {
    version: '0.9', range: 'e78d3be..HEAD', work: true, date: '2026-11-04', title: 'Watch party', status: 'dev',
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
        'A proper 3-2-1 before a film starts, on the room\'s shared clock, so everyone sees the same number.',
        'Profile: open it from your picture in the sidebar. What you watched, favourites, hours, your list, upcoming episodes, medals and friends.',
        'Friend profiles: click a friend to see their stats, favourites, list and medals. The last copy still opens when they are offline, and you can turn sharing off.',
        'Friends replaces Together: friends, what they are doing and rooms in one place. Friends see each other\'s rooms and just join, no codes.',
        'New catalogs: New (by year, back to 1950), Top rated, Hidden gems and Surprise me, with a Movies / Series switch, genre, sort, minimum rating and Hide watched.',
        'For You now follows the genres you actually watch, skips what you have seen, and changes every half hour or on Shuffle.',
        'Streams settings: your own audio languages, subtitles, which versions to hide, sorting and how many to load.',
        'Updates button in the corner, with a mark when something new has landed.',
        'Updates tab: this page.',
      ],
      Improved: [
        'The web player and rooms now pick 1080p first. mpv keeps 4K.',
        'Buffers minutes ahead instead of about 2.5 seconds, even while paused, and jumps inside the buffer are instant.',
        'Only one tab per person runs the room player, so tabs no longer fight over your status.',
        'Seeks land on a real keyframe, so every viewer restarts on the same frame.',
        'Drift is removed with tiny speed changes, checked five times a second.',
        'Sound blocked by the browser no longer stops playback: it starts muted with a "Tap for sound" button.',
      ],
      Fixed: [
        'Room play and pause state reached browsers late, which threw off sync.',
        'Seeking on big files did nothing for a long time: streams now keep real timestamps, so no lookup is needed.',
        'Esc and the end of a film fought the room reopening the player.',
        'Playing something on your own was cancelled by the room.',
        'Opening by itself covered whatever you were doing: it now starts in the corner.',
        '"Start now" appeared even when waiting would start it anyway. Now it only appears once someone else is holding things up.',
        'The room panel flickered and repainted over the video every second, which made 4K harder to play. Press I in the player to see real fps.',
        '"Connection refused" errors: a release that fails is marked Not working for 30 minutes and the next one starts instead.',
        'Duplicate buttons removed. Sound timing moved into the Audio menu.',
        'A dropped connection ended the movie instead of reconnecting.',
        'Preview-frame workers flooded the debrid server. They are now gentle, and off in rooms.',
      ],
      'Known limits': [
        'Closing the browser or reloading the page still has to rebuffer.',
        'Not yet proven with real friends on real streams.',
      ],
    },
  },
  {
    version: '0.8', range: '3579456..e78d3be', date: '2026-11-04', title: 'Rooms that last',
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
    version: '0.7', commits: ['847cc65', 'a063b46', '66c5bb0', '8f7c39b', '3f9d6df'], date: '2026-11-04', title: 'Hosted relay',
    summary: 'Friends run their own IronHide and meet through one small relay. No video goes through it.',
    groups: {
      New: ['Relay deployed on Render, with a people list and unique names online.', 'First-run name screen.'],
      Improved: ['Every install connects to the shared relay with no setup.', 'API keys are hidden in error messages.'],
      Fixed: ['Streams on an unreachable download node are skipped automatically.'],
      'Known limits': ['Hosting the whole app was tried and dropped: browsers cannot play most releases directly, and it would send all the video through one server.'],
    },
  },
  {
    version: '0.6', commits: ['197d304', '0ab785a', '28803bb', 'e29f44e', '3579456'], date: '2026-11-04', title: 'Avatar studio',
    summary: 'Make your profile picture yours.',
    groups: {
      New: ['Photo upload.', '16 animated decorations that sit outside the avatar.', '20 polygon shapes, a faceted bevel frame and low-poly shading.', 'Gradients and one-click looks.'],
      Fixed: ['Circles squished into blobs.', 'Search cards with long titles stretching.', 'The phone bottom bar running off the screen.'],
    },
  },
  {
    version: '0.5', range: 'e3b41a8..0e47c6f', date: '2026-11-04', title: 'Together',
    summary: 'The first version of watching with friends.',
    groups: { New: ['Friends by code.', 'Rooms with a code and invites.', 'Live chat and floating reactions.', 'A small relay for friend, room and chat messages.'] },
  },
  {
    version: '0.4', range: 'b8affa0..e3b41a8', date: '2026-11-04', title: 'Web player',
    summary: 'Watch in the browser as well as mpv.',
    groups: {
      New: ['In-browser player: direct play where possible, GPU transcode where not.', 'Scrub preview frames.', 'Built-in trailer player.', 'Choose mpv or the web player in Settings.'],
      Improved: ['Title details became a centered popup.', 'Card size and layout settings.', 'Settings save automatically.'],
      Fixed: ['The page scrolling behind open popups.'],
    },
  },
  {
    version: '0.3', range: 'ed94f94..b8affa0', date: '2026-11-04', title: 'IronHide on the web',
    summary: 'The web app rebuilt from scratch, using TorBox and your Trakt harvester.',
    groups: {
      New: ['Floating left rail and ambient color that follows the poster.', 'Launch indicator and a smooth hand-off to mpv.', 'Shelves from the Trakt harvester.', 'Settings for profile, appearance, playback, connectors and nodes.'],
      Improved: ['TorBox replaces Real-Debrid as the main debrid service.', 'History carried over from the CLI.'],
      Fixed: ['mpv launching without progress tracking or subtitles.'],
    },
  },
  {
    version: '0.2', range: '7fd7d8a..ed94f94', date: '2026-11-03', title: 'One core service',
    summary: 'One long-running service owns everything, with the first web interface on top.',
    groups: { New: ['Core daemon, with the MCP server as a thin client.', 'First browse UI: catalog, search, title page and stream picker.'] },
  },
  {
    version: '0.1', commits: ['8785579', '7fd7d8a'], date: '2026-04-20', title: 'First release',
    summary: 'Where it started: search and stream from Claude Code.',
    groups: { New: ['IronHide MCP server and CLI.', 'Streams in mpv with full remote control.', 'Watch history, resume, ratings and a taste profile.'] },
  },
];
