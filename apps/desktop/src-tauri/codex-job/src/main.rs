mod confinement;

use std::{
    ffi::{OsStr, OsString},
    io,
    os::windows::{
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::CommandExt,
    },
    path::Path,
    process::{self, Command, Stdio},
    ptr, thread,
};
use windows_sys::Win32::{
    Foundation::HANDLE,
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_JOB_MEMORY, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Threading::{
            GetCurrentProcess, OpenProcess, WaitForSingleObject, CREATE_NO_WINDOW, INFINITE,
            PROCESS_SYNCHRONIZE,
        },
    },
};

fn main() {
    let mut args = std::env::args_os().skip(1);
    match args.next().as_deref() {
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
        Some(mode) if mode == OsStr::new("--laplace-codex-boundary-read") => {
            process::exit(confinement::read_controls());
        }
        Some(mode) if mode == OsStr::new("--laplace-codex-job") => {}
        _ => return,
    }
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
