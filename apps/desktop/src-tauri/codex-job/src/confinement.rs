//! Offline controls for the proposed Windows read boundary. The optional CLI
//! diagnostic checks a staged executable and an empty CODEX_HOME offline.

use crate::{
    create_job, owned,
    win_process::{command_line, duplicate_inheritable, wide, Attributes},
};
use std::{
    env,
    ffi::c_void,
    fs,
    io::{self, Read},
    os::windows::{ffi::OsStrExt, fs::OpenOptionsExt, io::AsRawHandle},
    path::{Path, PathBuf},
    ptr, thread,
};
use windows_sys::{
    core::GUID,
    Win32::{
        Foundation::{ERROR_ACCESS_DENIED, ERROR_SUCCESS, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT},
        Security::{
            Authorization::{
                GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW, EXPLICIT_ACCESS_W,
                GRANT_ACCESS, SE_FILE_OBJECT, TRUSTEE_IS_SID,
            },
            CreateWellKnownSid, FreeSid, GetTokenInformation,
            Isolation::{CreateAppContainerProfile, DeleteAppContainerProfile},
            TokenIsAppContainer, WinBuiltinAnyPackageSid, DACL_SECURITY_INFORMATION, PSID,
            SECURITY_CAPABILITIES, SECURITY_MAX_SID_SIZE, TOKEN_QUERY,
        },
        Storage::FileSystem::{
            GetFinalPathNameByHandleW, FILE_FLAG_BACKUP_SEMANTICS, FILE_GENERIC_EXECUTE,
            FILE_GENERIC_READ, FILE_NAME_OPENED, VOLUME_NAME_NT,
        },
        System::{
            Com::CoCreateGuid,
            JobObjects::{
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_ACTIVE_PROCESS,
                JOB_OBJECT_LIMIT_JOB_MEMORY, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JOB_OBJECT_LIMIT_PROCESS_TIME,
            },
            SystemInformation::GetWindowsDirectoryW,
            Threading::{
                CreateProcessW, GetExitCodeProcess, OpenProcessToken, ResumeThread,
                WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED,
                CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, PROCESS_INFORMATION,
                PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_JOB_LIST,
                PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, STARTF_USESTDHANDLES, STARTUPINFOEXW,
            },
            WindowsProgramming::PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT,
        },
    },
};

const AUTHORIZED: &str = "authorized.txt";
const CANARY: &str = "canary.txt";
const AUTHORIZED_BYTES: &[u8] = b"laplace-authorized-fixture";
const CANARY_BYTES: &[u8] = b"laplace-external-fixture";

struct Scratch {
    path: PathBuf,
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let allowed = self.path.join("allowed");
        for result in [
            fs::remove_file(allowed.join("probe.exe")),
            fs::remove_file(allowed.join("codex.exe")),
            fs::remove_file(allowed.join(AUTHORIZED)),
            fs::remove_file(self.path.join(CANARY)),
            fs::remove_dir(allowed),
            fs::remove_dir(&self.path),
        ] {
            if let Err(error) = result {
                if error.kind() != io::ErrorKind::NotFound {
                    eprintln!("LPAC probe cleanup failed: {:?}", error.kind());
                }
            }
        }
    }
}

struct Container {
    sid: PSID,
    name: Vec<u16>,
}

impl Drop for Container {
    fn drop(&mut self) {
        unsafe { FreeSid(self.sid) };
        let result = unsafe { DeleteAppContainerProfile(self.name.as_ptr()) };
        if result < 0 {
            eprintln!("LPAC profile cleanup failed: 0x{result:08x}");
        }
    }
}

struct LocalMemory(*mut c_void);

impl Drop for LocalMemory {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::LocalFree(self.0) };
    }
}

fn success(result: u32) -> io::Result<()> {
    if result == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(io::Error::from_raw_os_error(result as i32))
    }
}

fn stage<T>(operation: &str, result: io::Result<T>) -> io::Result<T> {
    result.map_err(|error| io::Error::other(format!("{operation}: {error}")))
}

// Apply the grant only to newly created probe paths. Existing grants are
// still needed for the launching user and Windows system services.
fn allow_read(path: &Path, sid: PSID, mask: u32) -> io::Result<()> {
    let path = wide(path);
    let mut acl = ptr::null_mut();
    let mut descriptor = ptr::null_mut();
    unsafe {
        success(GetNamedSecurityInfoW(
            path.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            ptr::null_mut(),
            ptr::null_mut(),
            &mut acl,
            ptr::null_mut(),
            &mut descriptor,
        ))?;
        let _descriptor = LocalMemory(descriptor);
        if acl.is_null() {
            return Err(io::Error::other("probe path has a null DACL"));
        }
        let mut access = EXPLICIT_ACCESS_W {
            grfAccessPermissions: mask,
            grfAccessMode: GRANT_ACCESS,
            ..Default::default()
        };
        access.Trustee.TrusteeForm = TRUSTEE_IS_SID;
        access.Trustee.ptstrName = sid.cast();
        let mut updated = ptr::null_mut();
        success(SetEntriesInAclW(1, &access, acl, &mut updated))?;
        let _updated = LocalMemory(updated.cast());
        success(SetNamedSecurityInfoW(
            path.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            ptr::null_mut(),
            ptr::null_mut(),
            updated,
            ptr::null_mut(),
        ))
    }
}

pub fn probe(cli: Option<&Path>) -> io::Result<()> {
    let mut id = GUID::default();
    let result = unsafe { CoCreateGuid(&mut id) };
    if result < 0 {
        return Err(io::Error::other(format!("CoCreateGuid: 0x{result:08x}")));
    }
    let name = format!(
        "laplace.probe.{:08x}{:04x}{:04x}{:016x}",
        id.data1,
        id.data2,
        id.data3,
        u64::from_be_bytes(id.data4),
    );
    let path = env::temp_dir().join(&name);
    stage("create scratch directory", fs::create_dir(&path))?;
    let root = Scratch { path };
    let allowed = root.path.join("allowed");
    fs::create_dir(&allowed)?;
    let executable = allowed.join("probe.exe");
    fs::copy(env::current_exe()?, &executable)?;
    fs::write(allowed.join(AUTHORIZED), AUTHORIZED_BYTES)?;
    fs::write(root.path.join(CANARY), CANARY_BYTES)?;
    if fs::read(allowed.join(AUTHORIZED))? != AUTHORIZED_BYTES
        || fs::read(root.path.join(CANARY))? != CANARY_BYTES
    {
        return Err(io::Error::other("baseline cannot read both fixtures"));
    }

    let name = wide(name);
    let display = wide("Laplace read boundary probe");
    let mut sid = ptr::null_mut();
    let result = unsafe {
        CreateAppContainerProfile(
            name.as_ptr(),
            display.as_ptr(),
            display.as_ptr(),
            ptr::null(),
            0,
            &mut sid,
        )
    };
    if result < 0 || sid.is_null() {
        return Err(io::Error::other(format!(
            "create temporary AppContainer profile: 0x{result:08x}"
        )));
    }
    let container = Container { sid, name };
    stage(
        "grant scratch traversal",
        allow_read(&root.path, container.sid, FILE_GENERIC_EXECUTE),
    )?;
    stage(
        "grant directory access",
        allow_read(
            &allowed,
            container.sid,
            FILE_GENERIC_READ | FILE_GENERIC_EXECUTE,
        ),
    )?;
    stage(
        "grant executable access",
        allow_read(
            &executable,
            container.sid,
            FILE_GENERIC_READ | FILE_GENERIC_EXECUTE,
        ),
    )?;
    stage(
        "grant fixture access",
        allow_read(&allowed.join(AUTHORIZED), container.sid, FILE_GENERIC_READ),
    )?;
    // A regular AppContainer can use this group. LPAC must still get access denied.
    let mut group = [0u32; SECURITY_MAX_SID_SIZE as usize / size_of::<u32>()];
    let mut group_size = SECURITY_MAX_SID_SIZE;
    let group = group.as_mut_ptr().cast();
    if unsafe {
        CreateWellKnownSid(
            WinBuiltinAnyPackageSid,
            ptr::null_mut(),
            group,
            &mut group_size,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    stage(
        "grant ordinary AppContainer access to canary",
        allow_read(&root.path.join(CANARY), group, FILE_GENERIC_READ),
    )?;
    let provider = if let Some(path) = cli {
        if !path.is_absolute()
            || !path
                .file_name()
                .is_some_and(|file| file.eq_ignore_ascii_case("codex.exe"))
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "expected an absolute codex.exe path",
            ));
        }
        let binary = allowed.join("codex.exe");
        fs::copy(path, &binary)?;
        stage(
            "grant staged Codex access",
            allow_read(
                &binary,
                container.sid,
                FILE_GENERIC_READ | FILE_GENERIC_EXECUTE,
            ),
        )?;
        Some(binary)
    } else {
        None
    };
    let memory_limit = if provider.is_some() { 768 } else { 64 } * 1024 * 1024;
    let (controls, diagnostics) = capture(
        &executable,
        &allowed,
        &container,
        &["--laplace-codex-boundary-read"],
        memory_limit,
    )?;
    print!("{diagnostics}");
    match controls {
        0 => {}
        3 => return Err(io::Error::other("authorized fixture was unreadable")),
        4 => return Err(io::Error::other("external fixture was readable")),
        6 => {
            return Err(io::Error::other(
                "CODEX_HOME is missing from the probe environment",
            ))
        }
        5 => {
            return Err(io::Error::other(
                "external read returned a result other than access denied",
            ))
        }
        0xc000_0142 => {
            return Err(io::Error::other(
                "controls exited with 0xc0000142 (STATUS_DLL_INIT_FAILED under LPAC child initialization; no ACLs relaxed)",
            ))
        }
        _ => {
            return Err(io::Error::other(format!(
                "controls exited with 0x{controls:08x}"
            )))
        }
    }
    if let Some(provider) = provider {
        let (code, output) = capture(
            &provider,
            &allowed,
            &container,
            &["--version"],
            memory_limit,
        )?;
        let version = output.lines().find_map(|line| {
            let version = line.strip_prefix("codex-cli ")?;
            (!version.is_empty()
                && version.len() <= 32
                && version
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b".-".contains(&byte)))
            .then_some(version)
        });
        let Some(version) = version.filter(|_| code == 0) else {
            return Err(io::Error::other(format!(
                "Codex version check failed (0x{code:08x})"
            )));
        };
        println!("codex-cli {version}");
        let (code, output) = capture(
            &provider,
            &allowed,
            &container,
            &[
                "-c",
                r#"cli_auth_credentials_store="file""#,
                "login",
                "status",
            ],
            memory_limit,
        )?;
        let status = if code == 1 && output.contains("failed to canonicalize CODEX_HOME") {
            "CODEX_HOME canonicalization failed"
        } else if code == 1
            && output
                .lines()
                .any(|line| line.eq_ignore_ascii_case("Not logged in"))
        {
            "not logged in"
        } else {
            return Err(io::Error::other(format!(
                "unexpected status for empty CODEX_HOME (0x{code:08x})"
            )));
        };
        println!("Offline Codex login status: {status}");
    }
    Ok(())
}

fn capture(
    executable: &Path,
    cwd: &Path,
    container: &Container,
    args: &[&str],
    memory_limit: usize,
) -> io::Result<(u32, String)> {
    const MAX_OUTPUT: u64 = 48 * 1024;
    let input = fs::File::open("NUL")?;
    let (read, write) = io::pipe()?;
    let stdio = [
        duplicate_inheritable(input.as_raw_handle())?,
        duplicate_inheritable(write.as_raw_handle())?,
        duplicate_inheritable(write.as_raw_handle())?,
    ];
    drop(write);
    let reader = thread::Builder::new().spawn(move || {
        let mut output = Vec::new();
        read.take(MAX_OUTPUT + 1).read_to_end(&mut output)?;
        if output.len() as u64 > MAX_OUTPUT {
            return Err(io::Error::other("diagnostic output limit exceeded"));
        }
        Ok(String::from_utf8_lossy(&output).into_owned())
    })?;
    let handles = stdio.each_ref().map(AsRawHandle::as_raw_handle);
    let result = launch(
        executable,
        cwd,
        container,
        args,
        Some(&handles),
        memory_limit,
    );
    drop(stdio);
    let output = reader
        .join()
        .map_err(|_| io::Error::other("diagnostic reader failed"))??;
    Ok((result?, output))
}

fn launch(
    executable: &Path,
    cwd: &Path,
    container: &Container,
    args: &[&str],
    stdio: Option<&[HANDLE; 3]>,
    memory_limit: usize,
) -> io::Result<u32> {
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
        | JOB_OBJECT_LIMIT_JOB_MEMORY
        | JOB_OBJECT_LIMIT_PROCESS_TIME;
    limits.BasicLimitInformation.ActiveProcessLimit = 1;
    limits.BasicLimitInformation.PerProcessUserTimeLimit = 2 * 10_000_000;
    limits.JobMemoryLimit = memory_limit;
    let job = stage("create probe job", create_job(&limits))?;
    let job_list = [job.as_raw_handle()];
    let policy = PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT;
    let capabilities = SECURITY_CAPABILITIES {
        AppContainerSid: container.sid,
        ..Default::default()
    };
    let mut attrs = Attributes::new(if stdio.is_some() { 4 } else { 3 })?;
    unsafe {
        attrs.add(PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, &capabilities)?;
        attrs.add(
            PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY,
            &policy,
        )?;
        attrs.add(PROC_THREAD_ATTRIBUTE_JOB_LIST, &job_list)?;
    }
    let mut startup = STARTUPINFOEXW::default();
    startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    if let Some(handles) = stdio {
        unsafe { attrs.add(PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handles)? };
        let [input, output, error] = *handles;
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = input;
        startup.StartupInfo.hStdOutput = output;
        startup.StartupInfo.hStdError = error;
    }
    startup.lpAttributeList = attrs.as_ptr();
    let mut info = PROCESS_INFORMATION::default();
    let mut command = command_line(executable, args);
    // Use the fixture for profile variables and the OS for SystemRoot.
    // The child receives no user environment or authentication state.
    let mut windows = [0u16; 260];
    let count =
        unsafe { GetWindowsDirectoryW(windows.as_mut_ptr(), windows.len() as u32) } as usize;
    if count == 0 || count >= windows.len() {
        return Err(io::Error::other("could not resolve SystemRoot"));
    }
    let mut environment = Vec::new();
    for key in [
        "APPDATA",
        "CODEX_HOME",
        "HOME",
        "LOCALAPPDATA",
        "SYSTEMROOT",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "WINDIR",
    ] {
        environment.extend(key.encode_utf16());
        environment.push(u16::from(b'='));
        if matches!(key, "SYSTEMROOT" | "WINDIR") {
            environment.extend_from_slice(&windows[..count]);
        } else {
            environment.extend(cwd.as_os_str().encode_wide());
        }
        environment.push(0);
    }
    environment.push(0);
    let created = unsafe {
        CreateProcessW(
            wide(executable).as_ptr(),
            command.as_mut_ptr(),
            ptr::null(),
            ptr::null(),
            stdio.is_some().into(),
            CREATE_NO_WINDOW
                | CREATE_SUSPENDED
                | CREATE_UNICODE_ENVIRONMENT
                | EXTENDED_STARTUPINFO_PRESENT,
            environment.as_mut_ptr().cast(),
            wide(cwd).as_ptr(),
            &startup.StartupInfo,
            &mut info,
        )
    };
    if created == 0 {
        return Err(io::Error::other(format!(
            "launch AppContainer: {}",
            io::Error::last_os_error()
        )));
    }
    let process = owned(info.hProcess)?;
    let thread = owned(info.hThread)?;
    verify_container(process.as_raw_handle())?;
    if unsafe { ResumeThread(thread.as_raw_handle()) } != 1 {
        return Err(io::Error::other(
            "could not resume the verified AppContainer",
        ));
    }
    match unsafe { WaitForSingleObject(process.as_raw_handle(), 20_000) } {
        WAIT_OBJECT_0 => {}
        WAIT_TIMEOUT => {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "LPAC child timed out",
            ))
        }
        _ => return Err(io::Error::last_os_error()),
    }
    let mut code = 0;
    if unsafe { GetExitCodeProcess(process.as_raw_handle(), &mut code) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(code)
}

fn verify_container(process: windows_sys::Win32::Foundation::HANDLE) -> io::Result<()> {
    let mut token = ptr::null_mut();
    if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let token = owned(token)?;
    let mut enabled = 0u32;
    let mut bytes = 0;
    if unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenIsAppContainer,
            ptr::from_mut(&mut enabled).cast(),
            size_of::<u32>() as u32,
            &mut bytes,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    if enabled != 1 {
        return Err(io::Error::other("child token is not an AppContainer"));
    }
    Ok(())
}

pub fn read_controls() -> i32 {
    let Some(home) = env::var_os("CODEX_HOME").map(PathBuf::from) else {
        return 6;
    };
    eprintln!(
        "CODEX_HOME metadata: {:?}",
        fs::metadata(&home).map(|m| m.is_dir())
    );
    eprintln!(
        "CODEX_HOME canonicalize: {:?}",
        home.canonicalize().map(|_| ())
    );
    let opened = fs::OpenOptions::new()
        .access_mode(0)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(&home);
    match opened {
        Err(error) => eprintln!("CODEX_HOME open: {error:?}"),
        Ok(file) => {
            for flags in [
                0,
                FILE_NAME_OPENED,
                VOLUME_NAME_NT,
                FILE_NAME_OPENED | VOLUME_NAME_NT,
            ] {
                let mut path = [0u16; 1024];
                let count = unsafe {
                    GetFinalPathNameByHandleW(
                        file.as_raw_handle(),
                        path.as_mut_ptr(),
                        path.len() as u32,
                        flags,
                    )
                };
                if count == 0 {
                    eprintln!(
                        "CODEX_HOME GetFinalPathNameByHandleW({flags}): {:?}",
                        io::Error::last_os_error()
                    );
                } else {
                    eprintln!("CODEX_HOME GetFinalPathNameByHandleW({flags}): ok");
                }
            }
        }
    }
    if !matches!(fs::read(AUTHORIZED), Ok(bytes) if bytes == AUTHORIZED_BYTES) {
        return 3;
    }
    match fs::File::open(Path::new("..").join(CANARY)) {
        Err(error) if error.raw_os_error() == Some(ERROR_ACCESS_DENIED as i32) => 0,
        Ok(_) => 4,
        Err(_) => 5,
    }
}
