use crate::{
    create_job, owned,
    win_process::{command_line, drain_job, duplicate_inheritable, wide, Attributes},
};
use std::{
    ffi::OsString,
    fs::File,
    io::{self, Read},
    os::windows::io::AsRawHandle,
    path::Path,
    ptr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
};
use windows_sys::Win32::{
    Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT},
    System::{
        JobObjects::{JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE},
        Threading::{
            CreateProcessW, GetExitCodeProcess, OpenProcess, ResumeThread, WaitForSingleObject,
            CREATE_NO_WINDOW, CREATE_SUSPENDED, EXTENDED_STARTUPINFO_PRESENT, INFINITE,
            PROCESS_INFORMATION, PROCESS_SYNCHRONIZE, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
            PROC_THREAD_ATTRIBUTE_JOB_LIST, STARTF_USESTDHANDLES, STARTUPINFOEXW,
        },
    },
};

pub fn run(pid: u32, executable: &Path, arguments: Vec<OsString>) -> io::Result<i32> {
    let args: Vec<&str> = arguments
        .iter()
        .map(|arg| arg.to_str().ok_or(io::ErrorKind::InvalidInput))
        .collect::<Result<_, _>>()?;
    if !executable.is_absolute()
        || !executable
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("git.exe"))
        || args.len() > 64
        || !args.contains(&"clone")
    {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    let parent = owned(unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) })?;
    let cancelled = Arc::new(AtomicBool::new(false));
    let signal = Arc::clone(&cancelled);
    thread::Builder::new().spawn(move || {
        unsafe { WaitForSingleObject(parent.as_raw_handle(), INFINITE) };
        signal.store(true, Ordering::Release);
    })?;
    let signal = Arc::clone(&cancelled);
    thread::Builder::new().spawn(move || {
        let _ = io::stdin().read(&mut [0u8]);
        signal.store(true, Ordering::Release);
    })?;

    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let job = create_job(&limits)?;
    let job_list = [job.as_raw_handle()];
    let closed_input = File::open("NUL")?;
    let stdin = duplicate_inheritable(closed_input.as_raw_handle())?;
    let stdout = duplicate_inheritable(io::stdout().as_raw_handle())?;
    let stderr = duplicate_inheritable(io::stderr().as_raw_handle())?;
    let handles = [
        stdin.as_raw_handle(),
        stdout.as_raw_handle(),
        stderr.as_raw_handle(),
    ];
    let mut attrs = Attributes::new(2)?;
    unsafe {
        attrs.add(PROC_THREAD_ATTRIBUTE_HANDLE_LIST, &handles)?;
        attrs.add(PROC_THREAD_ATTRIBUTE_JOB_LIST, &job_list)?;
    }
    let mut startup = STARTUPINFOEXW::default();
    startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = handles[0];
    startup.StartupInfo.hStdOutput = handles[1];
    startup.StartupInfo.hStdError = handles[2];
    startup.lpAttributeList = attrs.as_ptr();
    let mut info = PROCESS_INFORMATION::default();
    let mut command = command_line(executable, &args);
    if unsafe {
        CreateProcessW(
            wide(executable).as_ptr(),
            command.as_mut_ptr(),
            ptr::null(),
            ptr::null(),
            1,
            CREATE_NO_WINDOW | CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT,
            ptr::null(),
            ptr::null(),
            &startup.StartupInfo,
            &mut info,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let process = owned(info.hProcess)?;
    let process_thread = owned(info.hThread)?;
    if unsafe { ResumeThread(process_thread.as_raw_handle()) } != 1 {
        return Err(io::Error::last_os_error());
    }

    let mut outcome = 125;
    while !cancelled.load(Ordering::Acquire) {
        match unsafe { WaitForSingleObject(process.as_raw_handle(), 100) } {
            WAIT_OBJECT_0 => {
                let mut code = 0;
                if unsafe { GetExitCodeProcess(process.as_raw_handle(), &mut code) } == 0 {
                    return Err(io::Error::last_os_error());
                }
                outcome = i32::from(code != 0);
                break;
            }
            WAIT_TIMEOUT => continue,
            _ => return Err(io::Error::last_os_error()),
        }
    }
    drain_job(job.as_raw_handle(), 125)?;
    Ok(outcome)
}
