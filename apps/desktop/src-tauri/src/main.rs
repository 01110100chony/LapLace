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
    let Some(path) = choose_folder(&window, "Selecionar repositório Git").await? else {
        return Ok(None);
    };
    Ok(Some(
        sidecar.request(id, Operation::Add { path: &path }).await?,
    ))
}

async fn choose_folder(window: &WebviewWindow, title: &str) -> Result<Option<String>, ErrorCode> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .dialog()
        .file()
        .set_title(title)
        .set_parent(window)
        .pick_folder(move |selection| {
            let _ = sender.send(selection);
        });
    let Some(selection) = receiver.await.map_err(|_| ErrorCode::DialogFailed)? else {
        return Ok(None);
    };
    let path = selection
        .into_path()
        .map_err(|_| ErrorCode::InvalidFolder)?;
    Ok(Some(
        path.into_os_string()
            .into_string()
            .map_err(|_| ErrorCode::InvalidFolder)?,
    ))
}

#[tauri::command]
async fn project_select(
    id: String,
    project_id: String,
    sidecar: State<'_, Sidecar>,
) -> Result<Response, Fault> {
    Ok(sidecar
        .request(
            id,
            Operation::Select {
                project_id: &project_id,
            },
        )
        .await?)
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

#[tauri::command]
async fn project_relocate(
    id: String,
    project_id: String,
    window: WebviewWindow,
    sidecar: State<'_, Sidecar>,
) -> Result<Option<Response>, Fault> {
    if !ipc::valid_id(&id) || !ipc::valid_project_id(&project_id) {
        return Err(ErrorCode::InvalidRequest.into());
    }
    let Some(path) = choose_folder(&window, "Relocalizar repositório Git").await? else {
        return Ok(None);
    };
    Ok(Some(
        sidecar
            .request(
                id,
                Operation::Relocate {
                    project_id: &project_id,
                    path: &path,
                },
            )
            .await?,
    ))
}

#[tauri::command]
async fn context_browse(
    id: String,
    project_id: String,
    folder: String,
    prefix: String,
    sidecar: State<'_, Sidecar>,
) -> Result<Response, Fault> {
    Ok(sidecar
        .request(
            id,
            Operation::ContextBrowse {
                project_id: &project_id,
                folder: &folder,
                prefix: &prefix,
            },
        )
        .await?)
}

#[tauri::command]
async fn context_capture(
    id: String,
    project_id: String,
    paths: Vec<String>,
    sidecar: State<'_, Sidecar>,
) -> Result<Response, Fault> {
    Ok(sidecar
        .request(
            id,
            Operation::ContextCapture {
                project_id: &project_id,
                paths: &paths,
            },
        )
        .await?)
}

#[tauri::command]
async fn context_list(
    id: String,
    project_id: String,
    before: Option<String>,
    sidecar: State<'_, Sidecar>,
) -> Result<Response, Fault> {
    Ok(sidecar
        .request(
            id,
            Operation::ContextList {
                project_id: &project_id,
                before: before.as_deref(),
            },
        )
        .await?)
}

#[tauri::command]
async fn context_get(
    id: String,
    project_id: String,
    context_id: String,
    sidecar: State<'_, Sidecar>,
) -> Result<Response, Fault> {
    Ok(sidecar
        .request(
            id,
            Operation::ContextGet {
                project_id: &project_id,
                context_id: &context_id,
            },
        )
        .await?)
}

#[tauri::command]
async fn context_validate(
    id: String,
    project_id: String,
    context_id: String,
    sidecar: State<'_, Sidecar>,
) -> Result<Response, Fault> {
    Ok(sidecar
        .request(
            id,
            Operation::ContextValidate {
                project_id: &project_id,
                context_id: &context_id,
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
            project_select,
            project_inspect,
            project_relocate,
            context_browse,
            context_capture,
            context_list,
            context_get,
            context_validate
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
