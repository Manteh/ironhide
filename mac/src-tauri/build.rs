fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["player_cmd", "player_set", "player_close", "player_ambient", "player_fullscreen", "player_pip", "player_drag", "win_zoom", "open_external", "retry_boot", "open_log"]),
        ),
    )
    .expect("tauri build");
}
