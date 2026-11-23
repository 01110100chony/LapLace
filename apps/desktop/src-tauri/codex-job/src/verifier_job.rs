use crate::{
    create_job, owned,
    win_process::{command_line, drain_job, duplicate_inheritable, wide, Attributes},
};
use std::{
    ffi::OsString,
    fs::File,
    io::{self, Read},
    os::windows::io::AsRawHandle,
    path::PathBuf,
    ptr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
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

const MIN_TIMEOUT_MS: u64 = 500;
const MAX_TIMEOUT_MS: u64 = 120_000;
const MAX_ARGS: usize = 32;

#[derive(Debug, PartialEq, Eq)]
pub struct VerifierCommand {
    pub pid: u32,
    pub timeout_ms: u64,
    pub executable: PathBuf,
    pub args: Vec<String>,
}

pub fn parse_args(mut args: impl Iterator<Item = OsString>) -> io::Result<VerifierCommand> {
    let pid: u32 = args
        .next()
        .and_then(|v| v.to_str()?.parse().ok())
        .filter(|&v| v > 0)
        .ok_or(io::ErrorKind::InvalidInput)?;
    let timeout_ms: u64 = args
        .next()
        .and_then(|v| v.to_str()?.parse().ok())
        .filter(|&ms| (MIN_TIMEOUT_MS..=MAX_TIMEOUT_MS).contains(&ms))
        .ok_or(io::ErrorKind::InvalidInput)?;
    let executable = PathBuf::from(args.next().ok_or(io::ErrorKind::InvalidInput)?);
    if !executable.is_absolute() {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    let collected: Vec<String> = args
        .map(|arg| {
            arg.into_string()
                .map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))
        })
        .collect::<Result<_, _>>()?;
    if collected.len() > MAX_ARGS {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    Ok(VerifierCommand {
        pid,
        timeout_ms,
        executable,
        args: collected,
    })
}

pub fn run(command_spec: VerifierCommand) -> io::Result<i32> {
    let parent = owned(unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, command_spec.pid) })?;
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

    let arg_refs: Vec<&str> = command_spec.args.iter().map(String::as_str).collect();
    let mut command = command_line(&command_spec.executable, &arg_refs);
    let mut info = PROCESS_INFORMATION::default();
    if unsafe {
        CreateProcessW(
            wide(&command_spec.executable).as_ptr(),
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

    let deadline = Instant::now() + Duration::from_millis(command_spec.timeout_ms);
    let (outcome, drain_code): (i32, u32) = loop {
        if cancelled.load(Ordering::Acquire) {
            break (125, 125);
        }
        if Instant::now() >= deadline {
            break (124, 124);
        }
        match unsafe { WaitForSingleObject(process.as_raw_handle(), 50) } {
            WAIT_OBJECT_0 => {
                let mut code = 0u32;
                if unsafe { GetExitCodeProcess(process.as_raw_handle(), &mut code) } == 0 {
                    return Err(io::Error::last_os_error());
                }
                break (i32::try_from(code).unwrap_or(1), code);
            }
            WAIT_TIMEOUT => continue,
            _ => return Err(io::Error::last_os_error()),
        }
    };

    drain_job(job.as_raw_handle(), drain_code)?;
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_verifier_arguments() {
        let parsed = parse_args(
            [
                "1234",
                "5000",
                r"C:\Windows\System32\cmd.exe",
                "/c",
                "echo ok",
            ]
            .into_iter()
            .map(OsString::from),
        )
        .expect("valid verifier arguments");
        assert_eq!(parsed.pid, 1234);
        assert_eq!(parsed.timeout_ms, 5000);
        assert_eq!(
            parsed.executable,
            PathBuf::from(r"C:\Windows\System32\cmd.exe")
        );
        assert_eq!(parsed.args, vec!["/c", "echo ok"]);
    }

    #[test]
    fn rejects_invalid_executable_or_timeout() {
        let rel = parse_args(
            ["1234", "5000", "node.exe", "-v"]
                .into_iter()
                .map(OsString::from),
        );
        assert!(rel.is_err());

        let too_short = parse_args(
            ["1234", "100", r"C:\Windows\System32\cmd.exe"]
                .into_iter()
                .map(OsString::from),
        );
        assert!(too_short.is_err());

        let too_long = parse_args(
            ["1234", "999999", r"C:\Windows\System32\cmd.exe"]
                .into_iter()
                .map(OsString::from),
        );
        assert!(too_long.is_err());
    }
}
