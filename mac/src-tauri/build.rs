fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["player_cmd", "player_set", "player_close", "player_fullscreen", "player_pip", "player_drag"]),
        ),
    )
    .expect("tauri build");
}
