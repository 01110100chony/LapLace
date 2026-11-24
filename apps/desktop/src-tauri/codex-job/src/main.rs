#[cfg(not(feature = "clone-only"))]
mod confinement;
#[cfg(feature = "clone-only")]
mod managed_clone;
#[cfg(not(feature = "clone-only"))]
mod verifier_job;
mod win_process;

use std::{
    ffi::OsStr,
    io,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    path::Path,
    process, ptr,
};
#[cfg(not(feature = "clone-only"))]
use std::{
    ffi::OsString,
    os::windows::process::CommandExt,
    process::{Command, Stdio},
    thread,
};
#[cfg(not(feature = "clone-only"))]
use windows_sys::Win32::System::{
    JobObjects::{
        AssignProcessToJobObject, JOB_OBJECT_LIMIT_JOB_MEMORY, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    },
    Threading::{
        GetCurrentProcess, OpenProcess, WaitForSingleObject, CREATE_NO_WINDOW, INFINITE,
        PROCESS_SYNCHRONIZE,
    },
};
use windows_sys::Win32::{
    Foundation::HANDLE,
    System::JobObjects::{
        CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    },
};

fn main() {
    let mut args = std::env::args_os().skip(1);
    match args.next().as_deref() {
        #[cfg(not(feature = "clone-only"))]
        Some(mode) if mode == OsStr::new("--laplace-codex-boundary-probe") => {
            let executable = args.next();
            if args.next().is_some() {
                eprintln!("Usage: --laplace-codex-boundary-probe [absolute codex.exe]");
                process::exit(1);
            }
            match confinement::probe(executable.as_deref().map(Path::new)) {
                Ok(()) => println!("LPAC: authorized read succeeded; external read denied"),
                Err(error) => {
                    eprintln!("LPAC probe failed: {error}");
                    process::exit(1);
                }
            }
            return;
        }
        #[cfg(not(feature = "clone-only"))]
        Some(mode) if mode == OsStr::new("--laplace-codex-boundary-read") => {
            process::exit(confinement::read_controls());
        }
        #[cfg(feature = "clone-only")]
        Some(mode) if mode == OsStr::new("--laplace-clone-job") => {
            let pid = args.next().and_then(|value| value.to_str()?.parse().ok());
            if let (Some(pid), Some(executable)) = (pid, args.next()) {
                match managed_clone::run(pid, Path::new(&executable), args.collect()) {
                    Ok(code) => process::exit(code),
                    Err(error) => eprintln!("[laplace:clone] job_failed ({:?})", error.kind()),
                }
            }
            process::exit(126);
        }
        #[cfg(not(feature = "clone-only"))]
        Some(mode) if mode == OsStr::new("--laplace-verifier-job") => {
            match verifier_job::parse_args(args) {
                Ok(command_spec) => match verifier_job::run(command_spec) {
                    Ok(code) => process::exit(code),
                    Err(error) => eprintln!("[laplace:verifier] job_failed ({:?})", error.kind()),
                },
                Err(error) => eprintln!("[laplace:verifier] invalid_args ({:?})", error.kind()),
            }
            process::exit(126);
        }
        #[cfg(not(feature = "clone-only"))]
        Some(mode) if mode == OsStr::new("--laplace-codex-job") => {}
        _ => process::exit(126),
    }
    #[cfg(not(feature = "clone-only"))]
    run_codex_job(args);
}

#[cfg(not(feature = "clone-only"))]
fn run_codex_job(mut args: impl Iterator<Item = OsString>) {
    let pid = args.next().and_then(|value| value.to_str()?.parse().ok());
    let executable = args.next();
    if let (Some(pid), Some(executable)) = (pid, executable) {
        match run(pid, executable, args) {
            Ok(code) => process::exit(code),
            Err(error) => eprintln!("[laplace:codex] job_failed ({:?})", error.kind()),
        }
    }
    process::exit(125);
}

fn owned(handle: HANDLE) -> io::Result<OwnedHandle> {
    if handle.is_null() {
        return Err(io::Error::last_os_error());
    }
    // The Win32 calls that pass handles here transfer ownership to the caller.
    Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}

#[cfg(not(feature = "clone-only"))]
fn run(pid: u32, executable: OsString, args: impl Iterator<Item = OsString>) -> io::Result<i32> {
    let parent = owned(unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) })?;
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags =
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_JOB_MEMORY;
    limits.JobMemoryLimit = 768 * 1024 * 1024;
    let job = create_job(&limits)?;
    // Assign the helper first so every descendant starts inside the job.
    // No breakaway flag or inheritable job handle is granted.
    unsafe {
        if AssignProcessToJobObject(job.as_raw_handle(), GetCurrentProcess()) == 0 {
            return Err(io::Error::last_os_error());
        }
    }
    thread::Builder::new().spawn(move || {
        unsafe { WaitForSingleObject(parent.as_raw_handle(), INFINITE) };
        process::exit(125);
    })?;
    let status = Command::new(executable)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status();
    // Keep the job handle until process exit so the provider's status reaches
    // Node. Windows closes the handle at exit and terminates any descendants.
    process::exit(status.map_or(125, |status| status.code().unwrap_or(126)));
}

fn create_job(limits: &JOBOBJECT_EXTENDED_LIMIT_INFORMATION) -> io::Result<OwnedHandle> {
    let job = owned(unsafe { CreateJobObjectW(ptr::null(), ptr::null()) })?;
    if unsafe {
        SetInformationJobObject(
            job.as_raw_handle(),
            JobObjectExtendedLimitInformation,
            ptr::from_ref(limits).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(job)
}

#[cfg(test)]
pub(crate) fn mode_supported(mode: &str) -> bool {
    if cfg!(feature = "clone-only") {
        mode == "--laplace-clone-job"
    } else {
        matches!(
            mode,
            "--laplace-codex-boundary-probe"
                | "--laplace-codex-boundary-read"
                | "--laplace-codex-job"
                | "--laplace-verifier-job"
        )
    }
}

#[cfg(test)]
mod tests {
    use super::mode_supported;

    #[test]
    fn helper_binaries_enforce_mutually_exclusive_modes() {
        if cfg!(feature = "clone-only") {
            assert!(mode_supported("--laplace-clone-job"));
            assert!(!mode_supported("--laplace-codex-job"));
            assert!(!mode_supported("--laplace-verifier-job"));
            assert!(!mode_supported("--laplace-codex-boundary-probe"));
            assert!(!mode_supported("--laplace-codex-boundary-read"));
        } else {
            assert!(!mode_supported("--laplace-clone-job"));
            assert!(mode_supported("--laplace-codex-job"));
            assert!(mode_supported("--laplace-verifier-job"));
            assert!(mode_supported("--laplace-codex-boundary-probe"));
            assert!(mode_supported("--laplace-codex-boundary-read"));
        }
    }
}
