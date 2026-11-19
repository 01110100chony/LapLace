#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ipc;

use ipc::{ErrorCode, Fault, Operation, Response, Sidecar};
use tauri::{path::BaseDirectory, Manager, RunEvent, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
async fn service_health(id: String, sidecar: State<'_, Sidecar>) -> Result<Response, Fault> {
    Ok(sidecar.request(id, Operation::Health).await?)
}

#[tauri::command]
async fn workspace_list(id: String, sidecar: State<'_, Sidecar>) -> Result<Response, Fault> {
    Ok(sidecar.request(id, Operation::List).await?)
}

#[tauri::command]
async fn workspace_add_local(
    id: String,
    window: WebviewWindow,
    sidecar: State<'_, Sidecar>,
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
    Ok(Some(sidecar.request(id, Operation::Add { path }).await?))
}

#[tauri::command]
async fn project_inspect(
    id: String,
    project_id: String,
    sidecar: State<'_, Sidecar>,
) -> Result<Response, Fault> {
    Ok(sidecar
        .request(
            id,
            Operation::Inspect {
                project_id: &project_id,
            },
        )
        .await?)
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let runtime = app
                .path()
                .resolve("laplace-node.exe", BaseDirectory::Resource)?;
            let script = app
                .path()
                .resolve("sidecar/service.cjs", BaseDirectory::Resource)?;
            let data_dir = app.path().app_local_data_dir()?;
            app.manage(Sidecar::new(runtime, script, data_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            service_health,
            workspace_list,
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
