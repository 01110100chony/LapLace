fn main() {
    let commands = tauri_build::AppManifest::new().commands(&[
        "service_health",
        "workspace_list",
        "workspace_add_local",
        "project_select",
        "project_inspect",
        "project_relocate",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(commands))
        .expect("falha ao configurar o host Tauri");
}
