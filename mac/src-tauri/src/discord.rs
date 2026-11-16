// Discord Rich Presence for the in-app player: "Watching <title>" on your Discord profile, with the poster,
// the episode, a live progress bar and an IMDb button, the same way Spotify or Crunchyroll show up there.
//
// Everything runs on one worker thread per playback, so Discord being slow, closed or restarted never touches
// the player. Turned on and off in Settings > Playback ("Show on Discord").
//
// The Orbie application on Discord's developer portal: its name is what Discord shows ("Watching Orbie").
// Public, like every app's. A different one can be set as "discord_client_id" in ~/.config/ironhide/config.json.
const DISCORD_APP_ID: &str = "1571624961829765170";

use std::{
    io::{Read, Write},
    net::TcpStream,
    sync::{
        mpsc::{channel, Receiver, RecvTimeoutError, Sender},
        Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use discord_rich_presence::{
    activity::{Activity, ActivityType, Assets, Button, StatusDisplayType, Timestamps},
    DiscordIpc, DiscordIpcClient,
};

enum Ev {
    State { title: String, duration: f64, position: f64, paused: bool },
    End,
}

static TX: Mutex<Option<Sender<Ev>>> = Mutex::new(None);

/// A playback started: spawn its presence worker (does nothing if turned off or not set up).
pub fn start() {
    let (tx, rx) = channel();
    if let Some(old) = TX.lock().unwrap().replace(tx) { let _ = old.send(Ev::End); }
    thread::Builder::new().name("discord".into()).spawn(move || worker(rx)).ok();
}

/// What the player shows now. Cheap: hands it to the worker.
pub fn update(title: &str, duration: f64, position: f64, paused: bool) {
    if let Some(tx) = TX.lock().unwrap().as_ref() {
        let _ = tx.send(Ev::State { title: title.to_string(), duration, position, paused });
    }
}

/// Playback ended: clear the status.
pub fn stop() {
    if let Some(tx) = TX.lock().unwrap().take() { let _ = tx.send(Ev::End); }
}

/// What the daemon knows about the title (fetched once per playback).
#[derive(Default)]
struct Meta {
    imdb: String,
    title: String,
    year: String,
    genres: Vec<String>,
    rating: Option<f64>,
    season: Option<u64>,
    episode: Option<u64>,
    episode_name: String,
}

fn worker(rx: Receiver<Ev>) {
    let Some(client_id) = client_id() else { return };
    if !enabled() { return; }
    let meta = fetch_meta();
    let mut ipc = DiscordIpcClient::new(&client_id);
    let mut connected = false;
    let mut retry_at = Instant::now();
    let mut pending: Option<(String, f64, f64, bool)> = None;

    loop {
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ev::State { title, duration, position, paused }) => pending = Some((title, duration, position, paused)),
            Ok(Ev::End) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }
        while let Ok(ev) = rx.try_recv() { // keep only the newest state
            match ev { Ev::State { title, duration, position, paused } => pending = Some((title, duration, position, paused)), Ev::End => { finish(&mut ipc, connected); return; } }
        }
        let Some((title, duration, position, paused)) = pending.as_ref() else { continue };
        // Discord not open (yet): try again now and then, quietly
        if !connected {
            if Instant::now() < retry_at { continue; }
            connected = ipc.connect().is_ok();
            if !connected { retry_at = Instant::now() + Duration::from_secs(15); continue; }
        }
        if ipc.set_activity(activity(&meta, title, *duration, *position, *paused)).is_err() {
            let _ = ipc.close(); // Discord was closed or restarted: reconnect on the next tick
            connected = false;
            continue;
        }
        pending = None;
    }
    finish(&mut ipc, connected);
}

fn finish(ipc: &mut DiscordIpcClient, connected: bool) {
    if connected { let _ = ipc.clear_activity(); let _ = ipc.close(); }
}

fn activity<'a>(m: &'a Meta, mpv_title: &'a str, duration: f64, position: f64, paused: bool) -> Activity<'a> {
    // series: the episode from the daemon, or S01E02 from the title mpv shows
    let (season, episode) = match (m.season, m.episode) { (Some(s), Some(e)) => (Some(s), Some(e)), _ => sxxexx(mpv_title) };
    let show = if !m.title.is_empty() { m.title.clone() } else { strip_sxxexx(mpv_title) };
    let show = if show.is_empty() { "Something good".to_string() } else { show };

    let mut state = match (season, episode) {
        (Some(s), Some(e)) if !m.episode_name.is_empty() => format!("S{s} · E{e} · {}", m.episode_name),
        (Some(s), Some(e)) => format!("Season {s} · Episode {e}"),
        _ => {
            let mut parts = Vec::new();
            if !m.year.is_empty() { parts.push(m.year.clone()); }
            if !m.genres.is_empty() { parts.push(m.genres.iter().take(2).cloned().collect::<Vec<_>>().join(", ")); }
            if parts.is_empty() { "Movie".into() } else { parts.join(" · ") }
        }
    };
    if paused { state = format!("Paused · {state}"); }
    state = clip(&state, 128);

    let mut large_text = show.clone();
    if !m.year.is_empty() { large_text.push_str(&format!(" ({})", m.year)); }
    if let Some(r) = m.rating { large_text.push_str(&format!(" · ★ {r:.1}")); }

    let mut a = Activity::new()
        .activity_type(ActivityType::Watching)
        .status_display_type(StatusDisplayType::Details) // the member list says "Watching Severance", not "Watching Orbie"
        .details(clip(&show, 128))
        .state(state);

    let imdb_ok = m.imdb.starts_with("tt") && m.imdb[2..].chars().all(|c| c.is_ascii_digit()) && m.imdb.len() > 2;
    let mut assets = Assets::new().large_text(clip(&large_text, 128));
    if imdb_ok {
        assets = assets.large_image(format!("https://images.metahub.space/poster/medium/{}/img", m.imdb));
        a = a.details_url(format!("https://www.imdb.com/title/{}/", m.imdb))
            .buttons(vec![Button::new("View on IMDb", format!("https://www.imdb.com/title/{}/", m.imdb))]);
    }
    a = a.assets(assets);

    // playing: a live progress bar (Discord counts it forward by itself); paused: no clock
    if !paused && duration > 0.0 {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
        let start = now - (position.max(0.0) * 1000.0) as i64;
        a = a.timestamps(Timestamps::new().start(start).end(start + (duration * 1000.0) as i64));
    }
    a
}

fn clip(s: &str, n: usize) -> String {
    // Discord refuses fields shorter than 2 characters or longer than 128
    let mut out: String = s.chars().take(n).collect();
    while out.chars().count() < 2 { out.push(' '); }
    out
}

fn sxxexx(t: &str) -> (Option<u64>, Option<u64>) {
    let u = t.to_uppercase();
    for (i, _) in u.match_indices('S') {
        let rest = &u[i + 1..];
        let s: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if s.is_empty() { continue; }
        let after = &rest[s.len()..];
        if let Some(e) = after.strip_prefix('E') {
            let e: String = e.chars().take_while(|c| c.is_ascii_digit()).collect();
            if !e.is_empty() { return (s.parse().ok(), e.parse().ok()); }
        }
    }
    (None, None)
}

fn strip_sxxexx(t: &str) -> String {
    match t.rfind(" S") { Some(i) if sxxexx(&t[i..]).0.is_some() => t[..i].trim().to_string(), _ => t.trim().to_string() }
}

fn config_dir() -> String {
    std::env::var("IRONHIDE_HOME").unwrap_or_else(|_| format!("{}/.config/ironhide", std::env::var("HOME").unwrap_or_default()))
}

fn client_id() -> Option<String> {
    let from_env = std::env::var("IRONHIDE_DISCORD_CLIENT_ID").ok();
    let from_cfg = std::fs::read_to_string(format!("{}/config.json", config_dir())).ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v["discord_client_id"].as_str().map(str::to_string));
    from_env.or(from_cfg).map(|s| s.trim().to_string()).filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
        .or_else(|| Some(DISCORD_APP_ID.to_string()))
}

/// Settings > Playback > "Show on Discord" (on unless turned off).
fn enabled() -> bool {
    get_json("/api/settings").map(|v| v["playback"]["discordPresence"].as_bool() != Some(false)).unwrap_or(true)
}

fn fetch_meta() -> Meta {
    let mut m = Meta::default();
    if let Some(ps) = get_json("/api/playstate") { m.imdb = ps["imdbId"].as_str().unwrap_or("").to_string(); }
    let Some(info) = get_json("/api/info/now") else { return m };
    if info.get("error").is_some() { return m; }
    let s = |v: &serde_json::Value| v.as_str().unwrap_or("").to_string();
    m.title = s(&info["title"]);
    m.year = s(&info["year"]);
    m.genres = info["genres"].as_array().map(|a| a.iter().filter_map(|g| g.as_str().map(str::to_string)).collect()).unwrap_or_default();
    m.rating = info["rating"]["score"].as_f64().filter(|r| *r > 0.0);
    let ep = &info["episode"];
    m.season = ep["season"].as_u64();
    m.episode = ep["episode"].as_u64();
    m.episode_name = s(&ep["name"]);
    m
}

/// GET from the local daemon (plain HTTP on localhost, so no HTTP client crate).
fn get_json(path: &str) -> Option<serde_json::Value> {
    let mut s = TcpStream::connect_timeout(&"127.0.0.1:7676".parse().ok()?, Duration::from_secs(2)).ok()?;
    s.set_read_timeout(Some(Duration::from_secs(8))).ok()?;
    write!(s, "GET {path} HTTP/1.1\r\nHost: localhost:7676\r\nAccept: application/json\r\nConnection: close\r\n\r\n").ok()?;
    let mut raw = Vec::new();
    s.read_to_end(&mut raw).ok()?;
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = String::from_utf8_lossy(&raw[..split]).to_lowercase();
    if !head.starts_with("http/1.1 200") { return None; }
    let mut body = raw[split + 4..].to_vec();
    if head.contains("transfer-encoding: chunked") { body = dechunk(&body)?; }
    serde_json::from_slice(&body).ok()
}

fn dechunk(mut b: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    loop {
        let line_end = b.windows(2).position(|w| w == b"\r\n")?;
        let size = usize::from_str_radix(std::str::from_utf8(&b[..line_end]).ok()?.split(';').next()?.trim(), 16).ok()?;
        b = &b[line_end + 2..];
        if size == 0 { return Some(out); }
        out.extend_from_slice(b.get(..size)?);
        b = b.get(size + 2..)?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn episode_tags() {
        assert_eq!(sxxexx("Severance S02E03"), (Some(2), Some(3)));
        assert_eq!(sxxexx("Spaceballs"), (None, None));
        assert_eq!(strip_sxxexx("Severance S02E03"), "Severance");
        assert_eq!(strip_sxxexx("Spaceballs"), "Spaceballs");
        assert_eq!(dechunk(b"4\r\nWiki\r\n5\r\npedia\r\n0\r\n\r\n").unwrap(), b"Wikipedia");
    }
}
