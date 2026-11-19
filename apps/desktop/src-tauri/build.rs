fn main() {
    let commands = tauri_build::AppManifest::new().commands(&[
        "service_health",
        "workspace_list",
        "workspace_add_local",
        "project_inspect",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(commands))
        .expect("falha ao configurar o host Tauri");
}
