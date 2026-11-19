#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ipc;

use std::{collections::HashMap, sync::Mutex};

use ipc::{ErrorCode, Fault, Response, Sidecar};
use tauri::{path::BaseDirectory, Manager, RunEvent, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct Projects(Mutex<HashMap<String, String>>);

#[tauri::command]
async fn service_health(id: String, sidecar: State<'_, Sidecar>) -> Result<Response, Fault> {
    Ok(sidecar.request(id, "health", None).await?)
}

#[tauri::command]
async fn workspace_add_local(
    id: String,
    window: WebviewWindow,
    sidecar: State<'_, Sidecar>,
    projects: State<'_, Projects>,
) -> Result<Option<Response>, Fault> {
    if !ipc::valid_id(&id) {
        return Err(ErrorCode::InvalidRequest.into());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .dialog()
        .file()
        .set_title("Selecionar repositório Git")
        .set_parent(&window)
        .pick_folder(move |selection| {
            let _ = sender.send(selection);
        });
    let Some(selection) = receiver.await.map_err(|_| ErrorCode::DialogFailed)? else {
        return Ok(None);
    };
    let path = selection
        .into_path()
        .map_err(|_| ErrorCode::InvalidFolder)?;
    let path = path.to_str().ok_or(ErrorCode::InvalidFolder)?;
    let response = sidecar
        .request(id, "workspace.addLocal", Some(path))
        .await?;
    if let Some(project) = response.project() {
        projects
            .0
            .lock()
            .map_err(|_| ErrorCode::ServiceUnavailable)?
            .insert(project.id.clone(), project.root.clone());
    }
    Ok(Some(response))
}

#[tauri::command]
async fn project_inspect(
    id: String,
    project_id: String,
    sidecar: State<'_, Sidecar>,
    projects: State<'_, Projects>,
) -> Result<Response, Fault> {
    let path = projects
        .0
        .lock()
        .map_err(|_| ErrorCode::ServiceUnavailable)?
        .get(&project_id)
        .cloned()
        .ok_or(ErrorCode::ProjectUnavailable)?;
    let response = sidecar.request(id, "project.inspect", Some(&path)).await?;
    if response
        .project()
        .is_some_and(|project| project.id != project_id)
    {
        return Err(ErrorCode::ProjectUnavailable.into());
    }
    Ok(response)
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Projects::default())
        .setup(|app| {
            let runtime = app
                .path()
                .resolve("laplace-node.exe", BaseDirectory::Resource)?;
            let script = app
                .path()
                .resolve("sidecar/service.cjs", BaseDirectory::Resource)?;
            app.manage(Sidecar::new(runtime, script));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            service_health,
            workspace_add_local,
            project_inspect
        ])
        .build(tauri::generate_context!())
        .expect("falha ao inicializar a janela do Laplace");

    app.run(|handle, event| {
        if matches!(event, RunEvent::Exit) {
            let sidecar = handle.state::<Sidecar>();
            tauri::async_runtime::block_on(sidecar.shutdown());
        }
    });
}
