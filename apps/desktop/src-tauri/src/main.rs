#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ipc;

use ipc::{CodexMode, CodexRequest, ErrorCode, Fault, Operation, Response, SearchScope, Sidecar};
use tauri::{path::BaseDirectory, Manager, RunEvent, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

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

#[tauri::command]
async fn context_index_status(
    id: String,
    project_id: String,
    context_id: Option<String>,
    sidecar: State<'_, Sidecar>,
) -> Result<Response, Fault> {
    sidecar
        .request(
            id,
            Operation::ContextIndexStatus {
                project_id: &project_id,
                context_id: context_id.as_deref(),
            },
        )
        .await
        .map_err(Fault::from)
}

#[tauri::command]
async fn context_index(
    id: String,
    project_id: String,
    context_id: String,
    force: bool,
    sidecar: State<'_, Sidecar>,
) -> Result<Response, Fault> {
    sidecar
        .request(
            id,
            Operation::ContextIndex {
                project_id: &project_id,
                context_id: &context_id,
                force,
            },
        )
        .await
        .map_err(Fault::from)
}

#[tauri::command]
async fn context_search(
    id: String,
    project_id: String,
    scope: SearchScope,
    context_id: Option<String>,
    query: String,
    offset: u32,
    sidecar: State<'_, Sidecar>,
) -> Result<Response, Fault> {
    sidecar
        .request(
            id,
            Operation::ContextSearch {
                project_id: &project_id,
                context_id: context_id.as_deref(),
                scope,
                query: &query,
                offset,
            },
        )
        .await
        .map_err(Fault::from)
}

#[tauri::command]
async fn context_source_preview(
    id: String,
    project_id: String,
    context_id: String,
    path: String,
    sha256: String,
    chunk: u32,
    sidecar: State<'_, Sidecar>,
) -> Result<Response, Fault> {
    sidecar
        .request(
            id,
            Operation::ContextSourcePreview {
                project_id: &project_id,
                context_id: &context_id,
                path: &path,
                sha256: &sha256,
                chunk,
            },
        )
        .await
        .map_err(Fault::from)
}

#[tauri::command]
async fn codex_request(
    id: String,
    mut request: CodexRequest,
    window: WebviewWindow,
    sidecar: State<'_, Sidecar>,
) -> Result<Response, Fault> {
    if let CodexRequest::Start {
        project_id,
        context_id,
        grant_id,
        manifest_digest,
        confirmed,
        unconfined_confirmed,
    } = &mut request
    {
        let approval_request = CodexRequest::Approval {
            project_id: project_id.clone(),
            context_id: context_id.clone(),
            grant_id: grant_id.clone(),
            manifest_digest: manifest_digest.clone(),
        };
        let approval = sidecar
            .request(id.clone(), Operation::Codex(&approval_request))
            .await?
            .codex_approval()?;
        if approval.grant_id != *grant_id || approval.manifest_digest != *manifest_digest {
            return Err(ErrorCode::InvalidResponse.into());
        }
        let dialog = match approval.mode {
            CodexMode::VerifiedIsolated => Some((
                "Autorizar consulta ao Codex",
                "Autoriza o envio da pergunta e das fontes da prévia para OpenAI Codex?".into(),
                "Autorizar envio",
            )),
            CodexMode::MockDevelopment => None,
            CodexMode::UnconfinedWorkspaceDevelopment => {
                let sources = approval
                    .sources
                    .iter()
                    .map(|source| format!("• {} ({} bytes)", source.path, source.bytes))
                    .collect::<Vec<_>>()
                    .join("\n");
                Some((
                    "Modo de desenvolvimento — acesso de leitura não isolado",
                    format!(
                        "O Codex será executado em modo somente leitura, mas essa configuração não garante que ele só consiga acessar os arquivos selecionados. Não utilize projetos confidenciais, credenciais ou dados sensíveis neste modo.\n\n\
                        Projeto {}\nCaptura {}\nSHA-256 {}\n\n\
                        Destino OpenAI Codex\nModo Workspace Dev\nIsolamento de leitura não verificado\n\n\
                        Arquivos selecionados\n{}\n\n{} bytes de fontes · {} bytes de entrada",
                        approval.project_name, context_id, approval.snapshot_digest,
                        sources, approval.source_bytes, approval.prompt_bytes,
                    ),
                    "Autorizar esta consulta",
                ))
            }
        };
        if let Some((title, message, button)) = dialog {
            let (sender, receiver) = tokio::sync::oneshot::channel();
            window
                .dialog()
                .message(message)
                .title(title)
                .parent(&window)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    button.into(),
                    "Cancelar".into(),
                ))
                .show(move |accepted| {
                    let _ = sender.send(accepted);
                });
            if !receiver.await.unwrap_or(false) {
                return Err(ErrorCode::CodexAuthorizationRequired.into());
            }
        }
        *confirmed = true;
        *unconfined_confirmed = matches!(approval.mode, CodexMode::UnconfinedWorkspaceDevelopment);
    }
    sidecar
        .request(id, Operation::Codex(&request))
        .await
        .map_err(Fault::from)
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
            context_validate,
            context_index_status,
            context_index,
            context_search,
            context_source_preview,
            codex_request
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
