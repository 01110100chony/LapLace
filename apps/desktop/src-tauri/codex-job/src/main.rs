use std::{
    ffi::OsString,
    io,
    os::windows::{
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::CommandExt,
    },
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
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--laplace-codex-job")) {
        return;
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
    // Both constructors used here return non-inheritable owned handles.
    Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}

fn run(pid: u32, executable: OsString, args: impl Iterator<Item = OsString>) -> io::Result<i32> {
    let parent = owned(unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) })?;
    let job = owned(unsafe { CreateJobObjectW(ptr::null(), ptr::null()) })?;
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags =
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_JOB_MEMORY;
    limits.JobMemoryLimit = 768 * 1024 * 1024;
    // Assign the helper first so every descendant starts inside the job.
    // No breakaway flag or inheritable job handle is granted.
    unsafe {
        if SetInformationJobObject(
            job.as_raw_handle(),
            JobObjectExtendedLimitInformation,
            ptr::from_ref(&limits).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
            || AssignProcessToJobObject(job.as_raw_handle(), GetCurrentProcess()) == 0
        {
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
